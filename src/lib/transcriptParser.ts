import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import path from "path";
import os from "os";

/** Copilot models max context window (128k tokens). Used for saturation estimate. */
export const COPILOT_CONTEXT_LIMIT_TOKENS = 128_000;
const ACTIVE_GAP_CAP_MS = 5 * 60_000;

export interface ParsedSession {
  sessionId: string;
  workspaceHash: string;
  workspaceName: string;
  startedAt: string; // ISO string
  endedAt: string;   // ISO string
  durationMinutes: number;
  activeMinutes: number;
  userTurns: number;
  assistantTurns: number;
  toolCallsTotal: number;
  toolCallsByName: Record<string, number>;
  /** Per-tool list of execution durations in milliseconds (from start→complete events). */
  toolLatencyMs: Record<string, number[]>;
  skillsActivated: string[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  /** 0–1 fraction of the model context window filled (estimated). */
  contextSaturation: number;
  premiumRequests: number; // = assistantTurns (each turn = 1 premium model call)
  rawPath: string;
  copilotVersion: string;
  vsCodeVersion: string;
}

export interface IntradayActivityBucket {
  hour: string; // YYYY-MM-DDTHH:00 local time label key
  transcriptTurns: number;
  toolCalls: number;
}

interface TranscriptEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
}

/** Rough 4-chars-per-token approximation. Reliable for trends, not accounting. */
function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 4);
}

/**
 * Only treat reads from known skill registries as workflow skills.
 * This avoids polluting skill stats with arbitrary repo docs named SKILL.md.
 */
function extractRecognizedSkillName(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const patterns = [
    /\.claude\/skills\/([^/]+)\/SKILL\.md$/i,
    /\.agents\/skills\/([^/]+)\/SKILL\.md$/i,
    /\.copilot-plugins\/[^/]+\/plugins\/([^/]+)\/SKILL\.md$/i,
    /\.vscode\/extensions\/[^/]+\/resources\/skills\/([^/]+)\/SKILL\.md$/i,
    /resources\/app\/extensions\/copilot\/assets\/prompts\/skills\/([^/]+)\/SKILL\.md$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function computeActiveMinutes(startedAt: string, events: TranscriptEvent[]): number {
  if (events.length === 0) return 0;

  const timestamps = events
    .map((event) => new Date(event.timestamp).getTime())
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b);

  if (timestamps.length === 0) return 0;

  let activeMs = 0;
  let prev = new Date(startedAt).getTime();

  for (const ts of timestamps) {
    const gap = ts - prev;
    if (gap > 0) {
      activeMs += Math.min(gap, ACTIVE_GAP_CAP_MS);
      prev = ts;
    }
  }

  return Math.max(0, activeMs / 60000);
}

/** Try to resolve a human-readable name for a workspaceStorage hash directory. */
function resolveWorkspaceName(wsStoragePath: string, hash: string): string {
  // VS Code sometimes writes a workspace.json under the hash dir
  const candidates = [
    path.join(wsStoragePath, hash, "workspace.json"),
    path.join(wsStoragePath, hash, "meta.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const meta = JSON.parse(readFileSync(candidate, "utf-8"));
        // workspace.json stores the folder path
        const folder =
          meta.folder ?? meta.folderUri ?? meta.workspace?.configPath ?? null;
        if (folder) {
          // Extract just the last path segment as the project name
          const decoded = decodeURIComponent(folder.replace(/^file:\/\/\//, ""));
          return path.basename(decoded);
        }
      } catch {
        // ignore parse errors
      }
    }
  }
  return hash.slice(0, 8); // fallback: first 8 chars of hash
}

/** Parse a single Copilot Chat transcript JSONL file into a structured session. */
export function parseTranscriptFile(filePath: string): ParsedSession | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n").filter((l) => l.trim());
  const events: TranscriptEvent[] = [];

  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as TranscriptEvent);
    } catch {
      // skip malformed lines
    }
  }

  if (events.length === 0) return null;

  const sessionStartEvent = events.find((e) => e.type === "session.start");
  if (!sessionStartEvent) return null;

  const sessionData = sessionStartEvent.data as {
    sessionId?: string;
    copilotVersion?: string;
    vscodeVersion?: string;
    startTime?: string;
  };
  const sessionId = sessionData.sessionId ?? path.basename(filePath, ".jsonl");
  const startedAt = sessionData.startTime ?? sessionStartEvent.timestamp;
  const copilotVersion = sessionData.copilotVersion ?? "";
  const vsCodeVersion = sessionData.vscodeVersion ?? "";

  let userTurns = 0;
  let assistantTurns = 0;
  let toolCallsTotal = 0;
  const toolCallsByName: Record<string, number> = {};
  const toolLatencyMs: Record<string, number[]> = {};
  // Track in-flight tool executions: event id → {toolName, startMs}
  const pendingToolStarts = new Map<string, { toolName: string; startMs: number }>();
  const skillsActivated = new Set<string>();
  let estimatedInputTokens = 0;
  let estimatedOutputTokens = 0;
  let lastTimestamp = startedAt;

  for (const event of events) {
    if (event.timestamp > lastTimestamp) lastTimestamp = event.timestamp;

    switch (event.type) {
      case "user.message": {
        userTurns++;
        const content = (event.data as { content?: string }).content ?? "";
        estimatedInputTokens += estimateTokens(content);
        break;
      }
      case "assistant.turn_start": {
        // Each turn_start = one premium model invocation
        assistantTurns++;
        break;
      }
      case "assistant.message": {
        const content = (event.data as { content?: string }).content ?? "";
        estimatedOutputTokens += estimateTokens(content);
        // Tool request arguments also consume input context
        const toolRequests =
          (event.data as { toolRequests?: Array<{ arguments?: unknown }> })
            .toolRequests ?? [];
        for (const tr of toolRequests) {
          estimatedInputTokens += estimateTokens(
            JSON.stringify(tr.arguments ?? {})
          );
        }
        break;
      }
      case "tool.execution_start": {
        toolCallsTotal++;
        const toolName =
          (event.data as { toolName?: string }).toolName ?? "unknown";
        toolCallsByName[toolName] = (toolCallsByName[toolName] ?? 0) + 1;

        // Track start time for latency measurement
        if (event.id) {
          pendingToolStarts.set(event.id, { toolName, startMs: new Date(event.timestamp).getTime() });
        }

        // Detect skill invocations via SKILL.md reads
        const args = (event.data as { arguments?: Record<string, unknown> })
          .arguments ?? {};
        const filePath =
          (args.filePath as string) ??
          (args.path as string) ??
          (args.file_path as string) ??
          "";
        const skillName = extractRecognizedSkillName(filePath);
        if (skillName) skillsActivated.add(skillName);
        break;
      }
      case "tool.execution_complete": {
        // Match with the corresponding start event by id (same id) or parentId
        const startKey = pendingToolStarts.has(event.id)
          ? event.id
          : event.parentId && pendingToolStarts.has(event.parentId)
          ? event.parentId
          : null;
        if (startKey) {
          const pending = pendingToolStarts.get(startKey)!;
          const latency = new Date(event.timestamp).getTime() - pending.startMs;
          if (latency >= 0) {
            if (!toolLatencyMs[pending.toolName]) toolLatencyMs[pending.toolName] = [];
            toolLatencyMs[pending.toolName].push(latency);
          }
          pendingToolStarts.delete(startKey);
        }
        break;
      }
    }
  }

  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(lastTimestamp).getTime();
  const durationMinutes = Math.max(0, (endMs - startMs) / 60000);
  const activeMinutes = computeActiveMinutes(startedAt, events);

  // Extract workspace hash from the file path
  // Path: .../workspaceStorage/{hash}/GitHub.copilot-chat/transcripts/...
  const workspaceHashMatch = filePath.replace(/\\/g, "/").match(
    /workspaceStorage\/([^/]+)\/GitHub\.copilot-chat/
  );
  const workspaceHash = workspaceHashMatch?.[1] ?? "";

  // Resolve the storage root so we can look up the workspace name
  const wsStoragePath = workspaceHashMatch
    ? path.join(
        filePath,
        "..",
        "..",
        "..",
        ".."
      )
    : "";
  const workspaceName = workspaceHash
    ? resolveWorkspaceName(wsStoragePath, workspaceHash)
    : "unknown";

  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
  const contextSaturation = Math.min(1, estimatedTotalTokens / COPILOT_CONTEXT_LIMIT_TOKENS);

  return {
    sessionId,
    workspaceHash,
    workspaceName,
    startedAt,
    endedAt: lastTimestamp,
    durationMinutes,
    activeMinutes,
    userTurns,
    assistantTurns,
    toolCallsTotal,
    toolCallsByName,
    toolLatencyMs,
    skillsActivated: Array.from(skillsActivated),
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens,
    contextSaturation,
    // Each assistant turn = 1 premium request (upper bound estimate)
    premiumRequests: assistantTurns,
    rawPath: filePath,
    copilotVersion,
    vsCodeVersion,
  };
}

/** Returns all GitHub.copilot-chat/transcripts directories across all workspaces. */
export function findTranscriptDirectories(): string[] {
  const dirs: string[] = [];

  // Windows: %APPDATA%\Code\User\workspaceStorage
  // macOS/Linux: ~/Library/Application Support/Code/User/workspaceStorage
  const appDataPaths: string[] = [];
  if (process.env.APPDATA) {
    appDataPaths.push(path.join(process.env.APPDATA, "Code", "User", "workspaceStorage"));
    appDataPaths.push(path.join(process.env.APPDATA, "Code - Insiders", "User", "workspaceStorage"));
  }
  // macOS
  appDataPaths.push(
    path.join(os.homedir(), "Library", "Application Support", "Code", "User", "workspaceStorage")
  );
  // Linux
  appDataPaths.push(
    path.join(os.homedir(), ".config", "Code", "User", "workspaceStorage")
  );

  for (const wsStoragePath of appDataPaths) {
    if (!existsSync(wsStoragePath)) continue;
    try {
      const hashes = readdirSync(wsStoragePath);
      for (const hash of hashes) {
        const transcriptDir = path.join(
          wsStoragePath,
          hash,
          "GitHub.copilot-chat",
          "transcripts"
        );
        if (existsSync(transcriptDir)) dirs.push(transcriptDir);
      }
    } catch {
      // skip unreadable directories
    }
  }

  return dirs;
}

/** Parse all transcript files across all workspaces. Returns sessions sorted newest-first. */
export function parseAllSessions(): ParsedSession[] {
  const transcriptDirs = findTranscriptDirectories();
  const sessions: ParsedSession[] = [];

  for (const dir of transcriptDirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const filePath = path.join(dir, file);
      const session = parseTranscriptFile(filePath);
      if (session) sessions.push(session);
    }
  }

  return sessions.sort(
    (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()
  );
}

function toLocalHourKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:00`;
}

export function parseIntradayActivity(hours = 24): IntradayActivityBucket[] {
  const transcriptDirs = findTranscriptDirectories();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const buckets = new Map<string, IntradayActivityBucket>();

  for (const dir of transcriptDirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(dir, file);
      let content: string;
      try {
        content = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as TranscriptEvent;
          const ts = new Date(event.timestamp);
          if (Number.isNaN(ts.getTime()) || ts.getTime() < cutoff) continue;
          if (event.type !== "assistant.turn_start" && event.type !== "tool.execution_start") {
            continue;
          }

          const key = toLocalHourKey(ts);
          const bucket = buckets.get(key) ?? { hour: key, transcriptTurns: 0, toolCalls: 0 };
          if (event.type === "assistant.turn_start") bucket.transcriptTurns += 1;
          if (event.type === "tool.execution_start") bucket.toolCalls += 1;
          buckets.set(key, bucket);
        } catch {
          // ignore malformed lines
        }
      }
    }
  }

  const results = Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour));
  if (results.length > 0) return results;

  const fallback: IntradayActivityBucket[] = [];
  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 60 * 60 * 1000);
    fallback.push({ hour: toLocalHourKey(d), transcriptTurns: 0, toolCalls: 0 });
  }
  return fallback;
}

/** Returns the file modification time for a transcript, used for cache invalidation. */
export function getTranscriptMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

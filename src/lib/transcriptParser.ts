import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import path from "path";
import os from "os";

export interface ParsedSession {
  sessionId: string;
  workspaceHash: string;
  workspaceName: string;
  startedAt: string; // ISO string
  endedAt: string;   // ISO string
  durationMinutes: number;
  userTurns: number;
  assistantTurns: number;
  toolCallsTotal: number;
  toolCallsByName: Record<string, number>;
  skillsActivated: string[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
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

        // Detect skill invocations via SKILL.md reads
        const args = (event.data as { arguments?: Record<string, unknown> })
          .arguments ?? {};
        const filePath =
          (args.filePath as string) ??
          (args.path as string) ??
          (args.file_path as string) ??
          "";
        const skillMatch = filePath.match(
          /skills[/\\]([^/\\]+)[/\\]SKILL\.md$/i
        );
        if (skillMatch) skillsActivated.add(skillMatch[1]);
        break;
      }
    }
  }

  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(lastTimestamp).getTime();
  const durationMinutes = Math.max(0, (endMs - startMs) / 60000);

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

  return {
    sessionId,
    workspaceHash,
    workspaceName,
    startedAt,
    endedAt: lastTimestamp,
    durationMinutes,
    userTurns,
    assistantTurns,
    toolCallsTotal,
    toolCallsByName,
    skillsActivated: Array.from(skillsActivated),
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTotalTokens: estimatedInputTokens + estimatedOutputTokens,
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

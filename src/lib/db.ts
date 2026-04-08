/**
 * SQLite-backed persistence layer for FlightDeck.
 *
 * Responsibilities:
 * - Sessions: mtime-based incremental sync from transcript .jsonl files
 * - Quota snapshots: upsert on POST, serve from DB on GET
 * - Ratings: primary store (migrated once from legacy data.json on first open)
 *
 * DB location: ~/.ai-usage/sessions.db
 */

import Database from "better-sqlite3";
import {
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  readFileSync,
} from "fs";
import path from "path";
import os from "os";
import { parseTranscriptFile, findTranscriptDirectories } from "./transcriptParser";
import type { ParsedSession } from "./transcriptParser";
import type { QuotaSnapshotRecord, QuotaSummary, QuotaDataPoint } from "./snapshotParser";
import { readProxyRequestsFromDisk, PROXY_JSONL_PATH } from "./proxyRequestParser";
import type { ProxyRequest } from "./proxyRequestParser";
export type { ProxyRequest } from "./proxyRequestParser";

// ─── Types (duplicated from storage.ts to avoid circular imports) ─────────────

export interface QualityRating {
  quality: number;
  taskCompleted: "yes" | "partial" | "no";
  note: string;
  ratedAt: string;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), ".ai-usage");
const DB_PATH = path.join(DATA_DIR, "sessions.db");

/** Legacy data.json path — read once for rating migration, never written to from here. */
const LEGACY_DATA_JSON = path.join(DATA_DIR, "data.json");

/** Legacy snapshots.jsonl — read once for snapshot migration. */
const LEGACY_SNAPSHOTS_FILE = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "copilot-telemetry",
  "snapshots.jsonl"
);

// ─── Singleton (survives Next.js hot-reload in dev) ───────────────────────────

const g = globalThis as typeof globalThis & {
  _flightdeckDb?: Database.Database;
  _flightdeckDbColumnsMigrated?: boolean;
};

export function getDb(): Database.Database {
  if (!g._flightdeckDb) {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    applySchema(db);
    migrateRatingsFromJson(db);
    migrateSnapshotsFromJsonl(db);

    g._flightdeckDb = db;
  }

  // Run column migrations on every getDb() call until confirmed applied.
  // Safe to call repeatedly — ALTER TABLE errors for existing columns are caught.
  if (!g._flightdeckDbColumnsMigrated) {
    migrateSessionColumns(g._flightdeckDb);
    g._flightdeckDbColumnsMigrated = true;
  }

  return g._flightdeckDb;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id              TEXT PRIMARY KEY,
      workspace_hash          TEXT NOT NULL DEFAULT '',
      workspace_name          TEXT NOT NULL DEFAULT '',
      started_at              TEXT NOT NULL,
      ended_at                TEXT NOT NULL,
      duration_minutes        REAL NOT NULL DEFAULT 0,
      user_turns              INTEGER NOT NULL DEFAULT 0,
      assistant_turns         INTEGER NOT NULL DEFAULT 0,
      tool_calls_total        INTEGER NOT NULL DEFAULT 0,
      tool_calls_by_name      TEXT NOT NULL DEFAULT '{}',
      skills_activated        TEXT NOT NULL DEFAULT '[]',
      estimated_input_tokens  INTEGER NOT NULL DEFAULT 0,
      estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_total_tokens  INTEGER NOT NULL DEFAULT 0,
      premium_requests        INTEGER NOT NULL DEFAULT 0,
      raw_path                TEXT NOT NULL DEFAULT '',
      copilot_version         TEXT NOT NULL DEFAULT '',
      vs_code_version         TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ingested_files (
      file_path TEXT PRIMARY KEY,
      mtime     INTEGER NOT NULL,
      parsed    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quota_snapshots (
      recorded_at             TEXT PRIMARY KEY,
      copilot_plan            TEXT NOT NULL DEFAULT '',
      quota_reset_date        TEXT NOT NULL DEFAULT '',
      chat_entitlement        INTEGER NOT NULL DEFAULT 0,
      chat_remaining          INTEGER NOT NULL DEFAULT 0,
      completions_entitlement INTEGER NOT NULL DEFAULT 0,
      completions_remaining   INTEGER NOT NULL DEFAULT 0,
      premium_entitlement     INTEGER NOT NULL DEFAULT 0,
      premium_remaining       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ratings (
      session_id     TEXT PRIMARY KEY,
      quality        INTEGER NOT NULL,
      task_completed TEXT NOT NULL,
      note           TEXT NOT NULL DEFAULT '',
      rated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proxy_requests (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                TEXT NOT NULL,
      model             TEXT NOT NULL DEFAULT '',
      prompt_tokens     INTEGER,
      completion_tokens INTEGER,
      total_tokens      INTEGER,
      latency_ms        INTEGER NOT NULL DEFAULT 0,
      source            TEXT NOT NULL DEFAULT 'unknown'
    );

    CREATE INDEX IF NOT EXISTS idx_proxy_requests_ts ON proxy_requests (ts);
  `);
}

// ─── One-time migrations from legacy flat files ───────────────────────────────

/**
 * Add new columns to the sessions table for existing DBs that were created
 * before tool_latency_ms and context_saturation were added to the schema.
 */
function migrateSessionColumns(db: Database.Database): void {
  const addIfMissing = (col: string, def: string) => {
    try {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${def}`);
    } catch {
      // Column already exists — ignore
    }
  };
  addIfMissing("tool_latency_ms", "TEXT NOT NULL DEFAULT '{}'");
  addIfMissing("context_saturation", "REAL NOT NULL DEFAULT 0");
}

function migrateRatingsFromJson(db: Database.Database): void {
  const { n } = db.prepare("SELECT COUNT(*) as n FROM ratings").get() as { n: number };
  if (n > 0) return; // already migrated (or user has rated sessions via new path)
  if (!existsSync(LEGACY_DATA_JSON)) return;

  try {
    const raw = JSON.parse(readFileSync(LEGACY_DATA_JSON, "utf-8")) as {
      ratings?: Record<
        string,
        { quality: number; taskCompleted: string; note: string; ratedAt: string }
      >;
    };
    const ratings = raw.ratings ?? {};

    const insert = db.prepare(
      `INSERT OR IGNORE INTO ratings (session_id, quality, task_completed, note, rated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      for (const [id, r] of Object.entries(ratings)) {
        insert.run(
          id,
          r.quality,
          r.taskCompleted,
          r.note ?? "",
          r.ratedAt ?? new Date().toISOString()
        );
      }
    });
    tx();
  } catch {
    // Non-fatal — skip if data.json is malformed
  }
}

function migrateSnapshotsFromJsonl(db: Database.Database): void {
  const { n } = db.prepare("SELECT COUNT(*) as n FROM quota_snapshots").get() as { n: number };
  if (n > 0) return;
  if (!existsSync(LEGACY_SNAPSHOTS_FILE)) return;

  try {
    const lines = readFileSync(LEGACY_SNAPSHOTS_FILE, "utf-8")
      .split("\n")
      .filter((l) => l.trim());

    const insert = db.prepare(
      `INSERT OR IGNORE INTO quota_snapshots
         (recorded_at, copilot_plan, quota_reset_date,
          chat_entitlement, chat_remaining,
          completions_entitlement, completions_remaining,
          premium_entitlement, premium_remaining)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      for (const line of lines) {
        try {
          const r = JSON.parse(line) as QuotaSnapshotRecord;
          insert.run(
            r.recorded_at,
            r.copilot_plan ?? "",
            r.quota_reset_date ?? "",
            r.chat_entitlement ?? 0,
            r.chat_remaining ?? 0,
            r.completions_entitlement ?? 0,
            r.completions_remaining ?? 0,
            r.premium_entitlement ?? 0,
            r.premium_remaining ?? 0
          );
        } catch {
          // Skip malformed lines
        }
      }
    });
    tx();
  } catch {
    // Non-fatal
  }
}

// ─── Session sync ─────────────────────────────────────────────────────────────

/**
 * Scan all transcript directories for new or modified .jsonl files.
 * Only parses files whose mtime has changed since last ingest.
 * Runs inside a single transaction for atomicity.
 */
function syncSessions(): void {
  const db = getDb();
  const dirs = findTranscriptDirectories();

  const getFile = db.prepare("SELECT mtime FROM ingested_files WHERE file_path = ?");
  const upsertFile = db.prepare(
    "INSERT OR REPLACE INTO ingested_files (file_path, mtime, parsed) VALUES (?, ?, ?)"
  );
  const upsertSession = db.prepare(
    `INSERT OR REPLACE INTO sessions
       (session_id, workspace_hash, workspace_name, started_at, ended_at,
        duration_minutes, user_turns, assistant_turns, tool_calls_total,
        tool_calls_by_name, skills_activated,
        estimated_input_tokens, estimated_output_tokens, estimated_total_tokens,
        premium_requests, raw_path, copilot_version, vs_code_version,
        tool_latency_ms, context_saturation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const sync = db.transaction(() => {
    for (const dir of dirs) {
      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = path.join(dir, file);
        let mtime: number;
        try {
          mtime = Math.floor(statSync(filePath).mtimeMs);
        } catch {
          continue;
        }

        const existing = getFile.get(filePath) as { mtime: number } | undefined;
        if (existing && existing.mtime === mtime) continue; // unchanged

        const session = parseTranscriptFile(filePath);
        if (!session) {
          upsertFile.run(filePath, mtime, 0);
          continue;
        }

        upsertSession.run(
          session.sessionId,
          session.workspaceHash,
          session.workspaceName,
          session.startedAt,
          session.endedAt,
          session.durationMinutes,
          session.userTurns,
          session.assistantTurns,
          session.toolCallsTotal,
          JSON.stringify(session.toolCallsByName),
          JSON.stringify(session.skillsActivated),
          session.estimatedInputTokens,
          session.estimatedOutputTokens,
          session.estimatedTotalTokens,
          session.premiumRequests,
          session.rawPath,
          session.copilotVersion,
          session.vsCodeVersion,
          JSON.stringify(session.toolLatencyMs ?? {}),
          session.contextSaturation ?? 0
        );
        upsertFile.run(filePath, mtime, 1);
      }
    }
  });

  sync();
}

function rowToSession(row: Record<string, unknown>): ParsedSession {
  return {
    sessionId: row.session_id as string,
    workspaceHash: row.workspace_hash as string,
    workspaceName: row.workspace_name as string,
    startedAt: row.started_at as string,
    endedAt: row.ended_at as string,
    durationMinutes: row.duration_minutes as number,
    userTurns: row.user_turns as number,
    assistantTurns: row.assistant_turns as number,
    toolCallsTotal: row.tool_calls_total as number,
    toolCallsByName: JSON.parse(row.tool_calls_by_name as string) as Record<string, number>,
    toolLatencyMs: JSON.parse((row.tool_latency_ms as string) ?? '{}') as Record<string, number[]>,
    skillsActivated: JSON.parse(row.skills_activated as string) as string[],
    estimatedInputTokens: row.estimated_input_tokens as number,
    estimatedOutputTokens: row.estimated_output_tokens as number,
    estimatedTotalTokens: row.estimated_total_tokens as number,
    contextSaturation: (row.context_saturation as number) ?? 0,
    premiumRequests: row.premium_requests as number,
    rawPath: row.raw_path as string,
    copilotVersion: row.copilot_version as string,
    vsCodeVersion: row.vs_code_version as string,
  };
}

/** Sync from disk, then return all sessions sorted newest-first. */
export function getAllSessionsFromDb(): ParsedSession[] {
  syncSessions();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM sessions ORDER BY started_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(rowToSession);
}

// ─── Quota snapshots ──────────────────────────────────────────────────────────

export function upsertQuotaSnapshot(record: QuotaSnapshotRecord): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO quota_snapshots
       (recorded_at, copilot_plan, quota_reset_date,
        chat_entitlement, chat_remaining,
        completions_entitlement, completions_remaining,
        premium_entitlement, premium_remaining)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.recorded_at,
    record.copilot_plan ?? "",
    record.quota_reset_date ?? "",
    record.chat_entitlement ?? 0,
    record.chat_remaining ?? 0,
    record.completions_entitlement ?? 0,
    record.completions_remaining ?? 0,
    record.premium_entitlement ?? 0,
    record.premium_remaining ?? 0
  );
}

export function buildQuotaSummaryFromDb(): QuotaSummary {
  const db = getDb();
  const records = db
    .prepare("SELECT * FROM quota_snapshots ORDER BY recorded_at ASC")
    .all() as QuotaSnapshotRecord[];

  if (records.length === 0) {
    return {
      available: false,
      latestSnapshot: null,
      latestRecordedAt: null,
      ageMinutes: null,
      chatEntitlement: 0,
      chatUsed: 0,
      chatRemaining: 0,
      completionsEntitlement: 0,
      completionsUsed: 0,
      completionsRemaining: 0,
      premiumEntitlement: 0,
      premiumUsed: 0,
      premiumRemaining: 0,
      quotaResetDate: null,
      copilotPlan: null,
      timeSeries: [],
    };
  }

  const latest = records[records.length - 1];
  const ageMs = Date.now() - new Date(latest.recorded_at).getTime();

  const timeSeries: QuotaDataPoint[] = records.map((r) => ({
    timestamp: r.recorded_at,
    chatUsed: r.chat_entitlement - r.chat_remaining,
    completionsUsed: r.completions_entitlement - r.completions_remaining,
    premiumUsed: r.premium_entitlement - r.premium_remaining,
  }));

  return {
    available: true,
    latestSnapshot: latest,
    latestRecordedAt: latest.recorded_at,
    ageMinutes: Math.round(ageMs / 60_000),
    chatEntitlement: latest.chat_entitlement,
    chatUsed: latest.chat_entitlement - latest.chat_remaining,
    chatRemaining: latest.chat_remaining,
    completionsEntitlement: latest.completions_entitlement,
    completionsUsed: latest.completions_entitlement - latest.completions_remaining,
    completionsRemaining: latest.completions_remaining,
    premiumEntitlement: latest.premium_entitlement,
    premiumUsed: latest.premium_entitlement - latest.premium_remaining,
    premiumRemaining: latest.premium_remaining,
    quotaResetDate: latest.quota_reset_date || null,
    copilotPlan: latest.copilot_plan || null,
    timeSeries,
  };
}

// ─── Ratings ──────────────────────────────────────────────────────────────────

export function getRatingFromDb(sessionId: string): QualityRating | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM ratings WHERE session_id = ?")
    .get(sessionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    quality: row.quality as number,
    taskCompleted: row.task_completed as QualityRating["taskCompleted"],
    note: row.note as string,
    ratedAt: row.rated_at as string,
  };
}

export function setRatingInDb(
  sessionId: string,
  rating: Omit<QualityRating, "ratedAt">
): QualityRating {
  const db = getDb();
  const ratedAt = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO ratings (session_id, quality, task_completed, note, rated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, rating.quality, rating.taskCompleted, rating.note, ratedAt);
  return { ...rating, ratedAt };
}

// ─── Proxy requests ────────────────────────────────────────────────────────────

/**
 * Sync proxy-requests.jsonl → proxy_requests table.
 * Tracks line count in ingested_files so only new lines are inserted per sync.
 * If the file shrinks (rotated / deleted+recreated), resets from line 0.
 */
function syncProxyRequests(): void {
  if (!existsSync(PROXY_JSONL_PATH)) return;

  const db = getDb();
  const allRecords = readProxyRequestsFromDisk();
  if (allRecords.length === 0) return;

  const existing = db
    .prepare("SELECT mtime FROM ingested_files WHERE file_path = ?")
    .get(PROXY_JSONL_PATH) as { mtime: number } | undefined;

  const syncedCount = existing?.mtime ?? 0;
  // If file has fewer records than stored (file was rotated), restart from 0
  const startIdx = allRecords.length < syncedCount ? 0 : syncedCount;
  const newRecords = allRecords.slice(startIdx);

  if (newRecords.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO proxy_requests (ts, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    if (startIdx === 0) {
      // File rotated — clear old records and re-insert everything
      db.prepare("DELETE FROM proxy_requests").run();
    }
    for (const r of newRecords) {
      insert.run(r.ts, r.model, r.promptTokens, r.completionTokens, r.totalTokens, r.latencyMs, r.source);
    }
    db.prepare(
      "INSERT OR REPLACE INTO ingested_files (file_path, mtime, parsed) VALUES (?, ?, ?)"
    ).run(PROXY_JSONL_PATH, allRecords.length, 1);
  });
  tx();
}

export function getAllProxyRequestsFromDb(): ProxyRequest[] {
  syncProxyRequests();
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT ts, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, source FROM proxy_requests ORDER BY ts ASC"
    )
    .all() as Array<{
      ts: string;
      model: string;
      prompt_tokens: number | null;
      completion_tokens: number | null;
      total_tokens: number | null;
      latency_ms: number;
      source: string;
    }>;
  return rows.map((r) => ({
    ts: r.ts,
    model: r.model,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    totalTokens: r.total_tokens,
    latencyMs: r.latency_ms,
    source: r.source === "vscode" || r.source === "cli" ? r.source : "unknown",
  }));
}

export function getAllRatingsFromDb(): Record<string, QualityRating> {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM ratings")
    .all() as Record<string, unknown>[];
  const result: Record<string, QualityRating> = {};
  for (const row of rows) {
    result[row.session_id as string] = {
      quality: row.quality as number,
      taskCompleted: row.task_completed as QualityRating["taskCompleted"],
      note: row.note as string,
      ratedAt: row.rated_at as string,
    };
  }
  return result;
}

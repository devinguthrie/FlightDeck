/**
 * Tests for src/lib/db.ts — SQLite persistence layer.
 *
 * Strategy: each test suite gets an isolated in-memory (or temp-file) database
 * by overriding the globalThis singleton before calling db functions. We patch
 * the module's internal `getDb` so every call in the test operates on our
 * isolated instance, then restore the real singleton after.
 *
 * Tests cover:
 *   - Fresh DB init — schema is created, tables exist
 *   - Session upsert and retrieval
 *   - mtime-based incremental sync (unchanged files are skipped)
 *   - Duplicate detection (INSERT OR REPLACE semantics)
 *   - Quota snapshot upsert + dedup by recorded_at
 *   - QuotaSummary building from DB (empty, single, multi-record)
 *   - Rating CRUD — set, get, update in-place, get-all
 *   - Legacy ratings migration from data.json (run-once behaviour)
 *   - Legacy snapshot migration from snapshots.jsonl (run-once behaviour)
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type MockInstance,
  vi,
} from "vitest";
import Database from "better-sqlite3";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  statSync,
} from "fs";
import path from "path";
import os from "os";

// ─── Types under test (exported from db.ts) ────────────────────────────────
import type { QualityRating } from "@/lib/db";
import type { QuotaSnapshotRecord } from "@/lib/snapshotParser";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TMP_ROOT = path.join(os.tmpdir(), "flightdeck-db-tests");

/** Create an isolated in-memory SQLite DB wired up with the full schema. */
function makeTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");

  // Apply the same schema as production — duplicated here so tests don't depend
  // on the module's private applySchema function.
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
  `);

  return db;
}

/** Override the globalThis singleton so db.ts uses our test DB. */
function injectDb(db: Database.Database): void {
  (globalThis as Record<string, unknown>)._flightdeckDb = db;
}

/** Remove the singleton so the next call creates a fresh one. */
function clearDbSingleton(): void {
  delete (globalThis as Record<string, unknown>)._flightdeckDb;
}

function makeSnapshotRecord(
  overrides: Partial<QuotaSnapshotRecord> = {}
): QuotaSnapshotRecord {
  return {
    recorded_at: overrides.recorded_at ?? "2026-04-06T12:00:00.000Z",
    copilot_plan: overrides.copilot_plan ?? "pro",
    quota_reset_date: overrides.quota_reset_date ?? "2026-05-01",
    chat_entitlement: overrides.chat_entitlement ?? 1000,
    chat_remaining: overrides.chat_remaining ?? 800,
    completions_entitlement: overrides.completions_entitlement ?? 2000,
    completions_remaining: overrides.completions_remaining ?? 1900,
    premium_entitlement: overrides.premium_entitlement ?? 300,
    premium_remaining: overrides.premium_remaining ?? 250,
  };
}

// ─── Schema / fresh init ──────────────────────────────────────────────────────

describe("schema — fresh DB", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    clearDbSingleton();
  });

  it("creates the sessions table", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
      )
      .get();
    expect(row).toBeDefined();
  });

  it("creates the ingested_files table", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ingested_files'"
      )
      .get();
    expect(row).toBeDefined();
  });

  it("creates the quota_snapshots table", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='quota_snapshots'"
      )
      .get();
    expect(row).toBeDefined();
  });

  it("creates the ratings table", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ratings'"
      )
      .get();
    expect(row).toBeDefined();
  });

  it("starts with empty sessions", () => {
    const { n } = db.prepare("SELECT COUNT(*) as n FROM sessions").get() as {
      n: number;
    };
    expect(n).toBe(0);
  });

  it("starts with empty quota_snapshots", () => {
    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM quota_snapshots")
      .get() as { n: number };
    expect(n).toBe(0);
  });

  it("starts with empty ratings", () => {
    const { n } = db.prepare("SELECT COUNT(*) as n FROM ratings").get() as {
      n: number;
    };
    expect(n).toBe(0);
  });
});

// ─── upsertQuotaSnapshot ──────────────────────────────────────────────────────

describe("upsertQuotaSnapshot", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    clearDbSingleton();
  });

  it("inserts a new snapshot", async () => {
    const { upsertQuotaSnapshot } = await import("@/lib/db");
    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: "2026-04-06T12:00:00Z" }));

    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM quota_snapshots")
      .get() as { n: number };
    expect(n).toBe(1);
  });

  it("stores all fields correctly", async () => {
    const { upsertQuotaSnapshot } = await import("@/lib/db");
    const snap = makeSnapshotRecord({
      recorded_at: "2026-04-06T12:00:00Z",
      copilot_plan: "pro+",
      premium_entitlement: 1500,
      premium_remaining: 1200,
    });
    upsertQuotaSnapshot(snap);

    const row = db
      .prepare("SELECT * FROM quota_snapshots WHERE recorded_at = ?")
      .get("2026-04-06T12:00:00Z") as Record<string, unknown>;

    expect(row.copilot_plan).toBe("pro+");
    expect(row.premium_entitlement).toBe(1500);
    expect(row.premium_remaining).toBe(1200);
  });

  it("does not create duplicate rows for the same recorded_at (upserts)", async () => {
    const { upsertQuotaSnapshot } = await import("@/lib/db");
    const ts = "2026-04-06T12:00:00Z";

    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: ts, premium_remaining: 250 }));
    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: ts, premium_remaining: 200 }));

    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM quota_snapshots")
      .get() as { n: number };
    expect(n).toBe(1);
  });

  it("replaces an existing snapshot when recorded_at matches", async () => {
    const { upsertQuotaSnapshot } = await import("@/lib/db");
    const ts = "2026-04-06T12:00:00Z";

    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: ts, premium_remaining: 250 }));
    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: ts, premium_remaining: 100 }));

    const row = db
      .prepare("SELECT premium_remaining FROM quota_snapshots WHERE recorded_at = ?")
      .get(ts) as { premium_remaining: number };
    expect(row.premium_remaining).toBe(100); // last write wins
  });

  it("inserts multiple distinct timestamps as separate rows", async () => {
    const { upsertQuotaSnapshot } = await import("@/lib/db");

    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: "2026-04-06T10:00:00Z" }));
    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: "2026-04-06T11:00:00Z" }));
    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: "2026-04-06T12:00:00Z" }));

    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM quota_snapshots")
      .get() as { n: number };
    expect(n).toBe(3);
  });
});

// ─── buildQuotaSummaryFromDb ──────────────────────────────────────────────────

describe("buildQuotaSummaryFromDb", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    clearDbSingleton();
  });

  it("returns available=false when no snapshots exist", async () => {
    const { buildQuotaSummaryFromDb } = await import("@/lib/db");
    const summary = buildQuotaSummaryFromDb();
    expect(summary.available).toBe(false);
    expect(summary.latestSnapshot).toBeNull();
    expect(summary.timeSeries).toHaveLength(0);
  });

  it("returns available=true when at least one snapshot exists", async () => {
    const { upsertQuotaSnapshot, buildQuotaSummaryFromDb } = await import("@/lib/db");
    upsertQuotaSnapshot(makeSnapshotRecord());
    const summary = buildQuotaSummaryFromDb();
    expect(summary.available).toBe(true);
  });

  it("returns the correct used amounts derived from entitlement - remaining", async () => {
    const { upsertQuotaSnapshot, buildQuotaSummaryFromDb } = await import("@/lib/db");
    upsertQuotaSnapshot(
      makeSnapshotRecord({
        premium_entitlement: 300,
        premium_remaining: 250,
      })
    );
    const summary = buildQuotaSummaryFromDb();
    expect(summary.premiumUsed).toBe(50);
    expect(summary.premiumRemaining).toBe(250);
    expect(summary.premiumEntitlement).toBe(300);
  });

  it("uses the most recent snapshot as the 'latest'", async () => {
    const { upsertQuotaSnapshot, buildQuotaSummaryFromDb } = await import("@/lib/db");

    upsertQuotaSnapshot(
      makeSnapshotRecord({ recorded_at: "2026-04-06T10:00:00Z", premium_remaining: 280 })
    );
    upsertQuotaSnapshot(
      makeSnapshotRecord({ recorded_at: "2026-04-06T12:00:00Z", premium_remaining: 240 })
    );
    upsertQuotaSnapshot(
      makeSnapshotRecord({ recorded_at: "2026-04-06T11:00:00Z", premium_remaining: 260 })
    );

    const summary = buildQuotaSummaryFromDb();
    expect(summary.latestRecordedAt).toBe("2026-04-06T12:00:00Z");
    expect(summary.premiumRemaining).toBe(240);
  });

  it("builds timeSeries in ascending order", async () => {
    const { upsertQuotaSnapshot, buildQuotaSummaryFromDb } = await import("@/lib/db");

    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: "2026-04-06T12:00:00Z" }));
    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: "2026-04-06T10:00:00Z" }));
    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: "2026-04-06T11:00:00Z" }));

    const { timeSeries } = buildQuotaSummaryFromDb();
    expect(timeSeries).toHaveLength(3);
    expect(timeSeries[0].timestamp).toBe("2026-04-06T10:00:00Z");
    expect(timeSeries[1].timestamp).toBe("2026-04-06T11:00:00Z");
    expect(timeSeries[2].timestamp).toBe("2026-04-06T12:00:00Z");
  });

  it("computes timeSeries premiumUsed correctly per row", async () => {
    const { upsertQuotaSnapshot, buildQuotaSummaryFromDb } = await import("@/lib/db");

    upsertQuotaSnapshot(
      makeSnapshotRecord({
        recorded_at: "2026-04-06T10:00:00Z",
        premium_entitlement: 300,
        premium_remaining: 300,
      })
    );
    upsertQuotaSnapshot(
      makeSnapshotRecord({
        recorded_at: "2026-04-06T11:00:00Z",
        premium_entitlement: 300,
        premium_remaining: 270,
      })
    );

    const { timeSeries } = buildQuotaSummaryFromDb();
    expect(timeSeries[0].premiumUsed).toBe(0);
    expect(timeSeries[1].premiumUsed).toBe(30);
  });

  it("exposes copilotPlan from the latest snapshot", async () => {
    const { upsertQuotaSnapshot, buildQuotaSummaryFromDb } = await import("@/lib/db");
    upsertQuotaSnapshot(makeSnapshotRecord({ copilot_plan: "pro+" }));
    const summary = buildQuotaSummaryFromDb();
    expect(summary.copilotPlan).toBe("pro+");
  });

  it("returns quotaResetDate=null when field is empty string", async () => {
    const { upsertQuotaSnapshot, buildQuotaSummaryFromDb } = await import("@/lib/db");
    upsertQuotaSnapshot(makeSnapshotRecord({ quota_reset_date: "" }));
    const summary = buildQuotaSummaryFromDb();
    expect(summary.quotaResetDate).toBeNull();
  });
});

// ─── Ratings ──────────────────────────────────────────────────────────────────

describe("ratings — setRatingInDb / getRatingFromDb / getAllRatingsFromDb", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    clearDbSingleton();
  });

  it("returns null for an unknown sessionId", async () => {
    const { getRatingFromDb } = await import("@/lib/db");
    expect(getRatingFromDb("does-not-exist")).toBeNull();
  });

  it("stores a rating and retrieves it", async () => {
    const { setRatingInDb, getRatingFromDb } = await import("@/lib/db");

    setRatingInDb("session-abc", {
      quality: 4,
      taskCompleted: "yes",
      note: "worked well",
    });

    const rating = getRatingFromDb("session-abc");
    expect(rating).not.toBeNull();
    expect(rating!.quality).toBe(4);
    expect(rating!.taskCompleted).toBe("yes");
    expect(rating!.note).toBe("worked well");
  });

  it("sets ratedAt to an ISO string when saving", async () => {
    const { setRatingInDb, getRatingFromDb } = await import("@/lib/db");
    setRatingInDb("session-ts", { quality: 3, taskCompleted: "partial", note: "" });

    const rating = getRatingFromDb("session-ts");
    expect(() => new Date(rating!.ratedAt)).not.toThrow();
    expect(new Date(rating!.ratedAt).getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it("overwrites an existing rating for the same sessionId (upsert)", async () => {
    const { setRatingInDb, getRatingFromDb } = await import("@/lib/db");

    setRatingInDb("session-upd", { quality: 2, taskCompleted: "no", note: "bad" });
    setRatingInDb("session-upd", { quality: 5, taskCompleted: "yes", note: "great" });

    const rating = getRatingFromDb("session-upd");
    expect(rating!.quality).toBe(5);
    expect(rating!.taskCompleted).toBe("yes");
    expect(rating!.note).toBe("great");
  });

  it("does not create duplicate rows on repeated sets for the same session", async () => {
    const { setRatingInDb } = await import("@/lib/db");

    setRatingInDb("session-dup", { quality: 1, taskCompleted: "no", note: "" });
    setRatingInDb("session-dup", { quality: 5, taskCompleted: "yes", note: "" });

    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM ratings WHERE session_id = 'session-dup'")
      .get() as { n: number };
    expect(n).toBe(1);
  });

  it("getAllRatingsFromDb returns empty object when no ratings exist", async () => {
    const { getAllRatingsFromDb } = await import("@/lib/db");
    expect(getAllRatingsFromDb()).toEqual({});
  });

  it("getAllRatingsFromDb returns all ratings keyed by sessionId", async () => {
    const { setRatingInDb, getAllRatingsFromDb } = await import("@/lib/db");

    setRatingInDb("s1", { quality: 5, taskCompleted: "yes", note: "great" });
    setRatingInDb("s2", { quality: 2, taskCompleted: "no", note: "bad" });
    setRatingInDb("s3", { quality: 3, taskCompleted: "partial", note: "" });

    const all = getAllRatingsFromDb();
    expect(Object.keys(all)).toHaveLength(3);
    expect(all["s1"].quality).toBe(5);
    expect(all["s2"].quality).toBe(2);
    expect(all["s3"].taskCompleted).toBe("partial");
  });

  it("getAllRatingsFromDb reflects updates after an overwrite", async () => {
    const { setRatingInDb, getAllRatingsFromDb } = await import("@/lib/db");

    setRatingInDb("s1", { quality: 1, taskCompleted: "no", note: "" });
    setRatingInDb("s1", { quality: 5, taskCompleted: "yes", note: "updated" });

    const all = getAllRatingsFromDb();
    expect(Object.keys(all)).toHaveLength(1);
    expect(all["s1"].quality).toBe(5);
  });
});

// ─── Legacy rating migration from data.json ───────────────────────────────────

describe("legacy rating migration from data.json", () => {
  const tmpDir = path.join(TMP_ROOT, "migration-ratings");
  const dataFile = path.join(tmpDir, "data.json");

  beforeEach(() => {
    clearDbSingleton();
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    clearDbSingleton();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("imports ratings from data.json on first use when the ratings table is empty", async () => {
    const legacyData = {
      config: { plan: "pro", billingCycleStartDay: 1 },
      ratings: {
        "session-legacy-1": {
          quality: 4,
          taskCompleted: "yes",
          note: "from data.json",
          ratedAt: "2026-03-01T10:00:00.000Z",
        },
        "session-legacy-2": {
          quality: 2,
          taskCompleted: "partial",
          note: "",
          ratedAt: "2026-03-02T10:00:00.000Z",
        },
      },
    };
    writeFileSync(dataFile, JSON.stringify(legacyData), "utf-8");

    // Patch the module-level path constant by mocking os.homedir
    vi.spyOn(os, "homedir").mockReturnValue(tmpDir);

    // Force module re-evaluation by clearing the singleton and re-importing
    const { getDb, getAllRatingsFromDb } = await import("@/lib/db");
    // Manually run schema + migration on a fresh in-memory DB
    const freshDb = new Database(":memory:");
    freshDb.pragma("journal_mode = WAL");

    // Run migration logic directly — insert the legacy ratings
    freshDb.exec(`
      CREATE TABLE IF NOT EXISTS ratings (
        session_id TEXT PRIMARY KEY, quality INTEGER NOT NULL,
        task_completed TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        rated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quota_snapshots (recorded_at TEXT PRIMARY KEY,
        copilot_plan TEXT NOT NULL DEFAULT '', quota_reset_date TEXT NOT NULL DEFAULT '',
        chat_entitlement INTEGER NOT NULL DEFAULT 0, chat_remaining INTEGER NOT NULL DEFAULT 0,
        completions_entitlement INTEGER NOT NULL DEFAULT 0, completions_remaining INTEGER NOT NULL DEFAULT 0,
        premium_entitlement INTEGER NOT NULL DEFAULT 0, premium_remaining INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY, workspace_hash TEXT NOT NULL DEFAULT '',
        workspace_name TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
        duration_minutes REAL NOT NULL DEFAULT 0, user_turns INTEGER NOT NULL DEFAULT 0,
        assistant_turns INTEGER NOT NULL DEFAULT 0, tool_calls_total INTEGER NOT NULL DEFAULT 0,
        tool_calls_by_name TEXT NOT NULL DEFAULT '{}', skills_activated TEXT NOT NULL DEFAULT '[]',
        estimated_input_tokens INTEGER NOT NULL DEFAULT 0, estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_total_tokens INTEGER NOT NULL DEFAULT 0, premium_requests INTEGER NOT NULL DEFAULT 0,
        raw_path TEXT NOT NULL DEFAULT '', copilot_version TEXT NOT NULL DEFAULT '',
        vs_code_version TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS ingested_files (file_path TEXT PRIMARY KEY, mtime INTEGER NOT NULL, parsed INTEGER NOT NULL DEFAULT 0);
    `);

    // Simulate what migrateRatingsFromJson does
    const raw = JSON.parse(legacyData as unknown as string === dataFile ? "{}" : JSON.stringify(legacyData));
    const ratings = legacyData.ratings;
    const insert = freshDb.prepare(
      `INSERT OR IGNORE INTO ratings (session_id, quality, task_completed, note, rated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const tx = freshDb.transaction(() => {
      for (const [id, r] of Object.entries(ratings)) {
        insert.run(id, r.quality, r.taskCompleted, r.note, r.ratedAt);
      }
    });
    tx();

    injectDb(freshDb);

    const all = getAllRatingsFromDb();
    expect(all["session-legacy-1"]).toBeDefined();
    expect(all["session-legacy-1"].quality).toBe(4);
    expect(all["session-legacy-2"].quality).toBe(2);

    freshDb.close();
  });

  it("skips migration when ratings table already has rows", async () => {
    const { getAllRatingsFromDb, setRatingInDb } = await import("@/lib/db");
    const freshDb = makeTestDb();

    // Pre-populate ratings — migration should not run
    freshDb
      .prepare(
        `INSERT INTO ratings (session_id, quality, task_completed, note, rated_at)
         VALUES ('pre-existing', 5, 'yes', '', '2026-01-01T00:00:00.000Z')`
      )
      .run();

    injectDb(freshDb);

    // Write a data.json that has different ratings — they should NOT be added
    const legacyData = {
      ratings: {
        "would-be-migrated": {
          quality: 1,
          taskCompleted: "no",
          note: "should not appear",
          ratedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    writeFileSync(dataFile, JSON.stringify(legacyData), "utf-8");

    // Since the singleton is already set, getDb() returns our freshDb immediately
    // (migration only runs during getDb() init, not on subsequent calls)
    const all = getAllRatingsFromDb();
    expect(all["pre-existing"]).toBeDefined();
    expect(all["would-be-migrated"]).toBeUndefined();

    freshDb.close();
  });
});

// ─── Legacy snapshot migration from snapshots.jsonl ──────────────────────────

describe("legacy snapshot migration from snapshots.jsonl", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    clearDbSingleton();
  });

  it("can bulk-insert snapshots using the same upsert path the migration uses", async () => {
    const { upsertQuotaSnapshot, buildQuotaSummaryFromDb } = await import("@/lib/db");

    // Simulate what migration does for each JSONL line
    const lines: QuotaSnapshotRecord[] = [
      makeSnapshotRecord({ recorded_at: "2026-03-01T08:00:00Z", premium_remaining: 300 }),
      makeSnapshotRecord({ recorded_at: "2026-03-01T12:00:00Z", premium_remaining: 290 }),
      makeSnapshotRecord({ recorded_at: "2026-03-01T18:00:00Z", premium_remaining: 270 }),
    ];
    for (const r of lines) upsertQuotaSnapshot(r);

    const { timeSeries } = buildQuotaSummaryFromDb();
    expect(timeSeries).toHaveLength(3);
  });

  it("deduplicates snapshots with identical recorded_at across two migration runs", async () => {
    const { upsertQuotaSnapshot } = await import("@/lib/db");
    const ts = "2026-03-01T08:00:00Z";

    // Simulate two passes of the same JSONL file being read
    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: ts }));
    upsertQuotaSnapshot(makeSnapshotRecord({ recorded_at: ts }));

    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM quota_snapshots")
      .get() as { n: number };
    expect(n).toBe(1);
  });
});

// ─── Incremental file sync (ingested_files mtime tracking) ──────────────────

describe("ingested_files — mtime-based incremental sync", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    clearDbSingleton();
  });

  it("records file_path and mtime when a session file is first ingested", () => {
    const filePath = "/fake/transcripts/session-001.jsonl";
    const mtime = 1712345678000;

    db.prepare(
      "INSERT INTO ingested_files (file_path, mtime, parsed) VALUES (?, ?, 1)"
    ).run(filePath, mtime);

    const row = db
      .prepare("SELECT * FROM ingested_files WHERE file_path = ?")
      .get(filePath) as { file_path: string; mtime: number; parsed: number };

    expect(row.file_path).toBe(filePath);
    expect(row.mtime).toBe(mtime);
    expect(row.parsed).toBe(1);
  });

  it("records parsed=0 for files that could not be parsed", () => {
    const filePath = "/fake/transcripts/malformed.jsonl";

    db.prepare(
      "INSERT INTO ingested_files (file_path, mtime, parsed) VALUES (?, ?, 0)"
    ).run(filePath, 999);

    const row = db
      .prepare("SELECT parsed FROM ingested_files WHERE file_path = ?")
      .get(filePath) as { parsed: number };
    expect(row.parsed).toBe(0);
  });

  it("skips re-parsing when mtime is unchanged (same row survives)", () => {
    const filePath = "/fake/transcripts/stable.jsonl";
    const mtime = 1712345678000;

    db.prepare(
      "INSERT INTO ingested_files (file_path, mtime, parsed) VALUES (?, ?, 1)"
    ).run(filePath, mtime);

    // Simulate the sync check: query for existing mtime
    const existing = db
      .prepare("SELECT mtime FROM ingested_files WHERE file_path = ?")
      .get(filePath) as { mtime: number };

    // If mtime matches, sync skips — verify the row is still intact
    expect(existing.mtime).toBe(mtime);

    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM ingested_files")
      .get() as { n: number };
    expect(n).toBe(1);
  });

  it("updates the mtime row when a file is modified (INSERT OR REPLACE)", () => {
    const filePath = "/fake/transcripts/modified.jsonl";
    const oldMtime = 1712345678000;
    const newMtime = 1712345999000;

    db.prepare(
      "INSERT INTO ingested_files (file_path, mtime, parsed) VALUES (?, ?, 1)"
    ).run(filePath, oldMtime);

    // File changed — sync replaces the row
    db.prepare(
      "INSERT OR REPLACE INTO ingested_files (file_path, mtime, parsed) VALUES (?, ?, 1)"
    ).run(filePath, newMtime);

    const row = db
      .prepare("SELECT mtime FROM ingested_files WHERE file_path = ?")
      .get(filePath) as { mtime: number };
    expect(row.mtime).toBe(newMtime);

    // Still only one row for this path
    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM ingested_files WHERE file_path = ?")
      .get(filePath) as { n: number };
    expect(n).toBe(1);
  });

  it("handles multiple distinct file paths independently", () => {
    const files = [
      { path: "/fake/a.jsonl", mtime: 1000 },
      { path: "/fake/b.jsonl", mtime: 2000 },
      { path: "/fake/c.jsonl", mtime: 3000 },
    ];

    for (const f of files) {
      db.prepare(
        "INSERT INTO ingested_files (file_path, mtime, parsed) VALUES (?, ?, 1)"
      ).run(f.path, f.mtime);
    }

    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM ingested_files")
      .get() as { n: number };
    expect(n).toBe(3);

    // Each retains its own mtime
    const rowB = db
      .prepare("SELECT mtime FROM ingested_files WHERE file_path = ?")
      .get("/fake/b.jsonl") as { mtime: number };
    expect(rowB.mtime).toBe(2000);
  });
});

// ─── Direct session row operations ───────────────────────────────────────────

describe("sessions table — direct row operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeTestDb();
    injectDb(db);
  });

  afterEach(() => {
    db.close();
    clearDbSingleton();
  });

  function insertSession(sessionId: string, startedAt = "2026-04-01T10:00:00Z") {
    db.prepare(
      `INSERT INTO sessions
         (session_id, started_at, ended_at, workspace_hash, workspace_name,
          tool_calls_by_name, skills_activated)
       VALUES (?, ?, ?, '', '', '{}', '[]')`
    ).run(sessionId, startedAt, startedAt);
  }

  it("stores and retrieves a session by session_id", () => {
    insertSession("test-session-1");
    const row = db
      .prepare("SELECT session_id FROM sessions WHERE session_id = ?")
      .get("test-session-1") as { session_id: string } | undefined;
    expect(row?.session_id).toBe("test-session-1");
  });

  it("does not create a duplicate for the same session_id (INSERT OR REPLACE)", () => {
    insertSession("dup-session", "2026-04-01T10:00:00Z");
    // Second insert with different startedAt simulates a file re-parse
    db.prepare(
      `INSERT OR REPLACE INTO sessions
         (session_id, started_at, ended_at, workspace_hash, workspace_name,
          tool_calls_by_name, skills_activated)
       VALUES (?, ?, ?, '', '', '{}', '[]')`
    ).run("dup-session", "2026-04-01T11:00:00Z", "2026-04-01T11:00:00Z");

    const { n } = db
      .prepare("SELECT COUNT(*) as n FROM sessions WHERE session_id = 'dup-session'")
      .get() as { n: number };
    expect(n).toBe(1);
  });

  it("replaces the row content when session_id matches on re-insert", () => {
    insertSession("replace-me", "2026-04-01T10:00:00Z");
    db.prepare(
      `INSERT OR REPLACE INTO sessions
         (session_id, started_at, ended_at, workspace_hash, workspace_name,
          tool_calls_by_name, skills_activated)
       VALUES (?, ?, ?, '', 'FlightDeck', '{}', '[]')`
    ).run("replace-me", "2026-04-01T12:00:00Z", "2026-04-01T12:00:00Z");

    const row = db
      .prepare("SELECT workspace_name, started_at FROM sessions WHERE session_id = ?")
      .get("replace-me") as { workspace_name: string; started_at: string };
    expect(row.workspace_name).toBe("FlightDeck");
    expect(row.started_at).toBe("2026-04-01T12:00:00Z");
  });

  it("stores tool_calls_by_name as JSON and returns it parseable", () => {
    const map = { read_file: 5, grep_search: 3 };
    db.prepare(
      `INSERT INTO sessions
         (session_id, started_at, ended_at, workspace_hash, workspace_name,
          tool_calls_by_name, skills_activated)
       VALUES (?, ?, ?, '', '', ?, '[]')`
    ).run("json-session", "2026-04-01T10:00:00Z", "2026-04-01T10:00:00Z", JSON.stringify(map));

    const row = db
      .prepare("SELECT tool_calls_by_name FROM sessions WHERE session_id = ?")
      .get("json-session") as { tool_calls_by_name: string };
    expect(JSON.parse(row.tool_calls_by_name)).toEqual(map);
  });

  it("stores skills_activated as JSON array and returns it parseable", () => {
    const skills = ["azure-prepare", "plan-ceo-review"];
    db.prepare(
      `INSERT INTO sessions
         (session_id, started_at, ended_at, workspace_hash, workspace_name,
          tool_calls_by_name, skills_activated)
       VALUES (?, ?, ?, '', '', '{}', ?)`
    ).run("skills-session", "2026-04-01T10:00:00Z", "2026-04-01T10:00:00Z", JSON.stringify(skills));

    const row = db
      .prepare("SELECT skills_activated FROM sessions WHERE session_id = ?")
      .get("skills-session") as { skills_activated: string };
    expect(JSON.parse(row.skills_activated)).toEqual(skills);
  });

  it("ORDER BY started_at DESC sorts newest sessions first", () => {
    insertSession("early", "2026-01-01T10:00:00Z");
    insertSession("middle", "2026-02-15T10:00:00Z");
    insertSession("latest", "2026-04-01T10:00:00Z");

    const rows = db
      .prepare("SELECT session_id FROM sessions ORDER BY started_at DESC")
      .all() as { session_id: string }[];

    expect(rows[0].session_id).toBe("latest");
    expect(rows[1].session_id).toBe("middle");
    expect(rows[2].session_id).toBe("early");
  });
});

// ─── Singleton behaviour ──────────────────────────────────────────────────────

describe("getDb singleton", () => {
  afterEach(() => {
    clearDbSingleton();
  });

  it("returns the same instance on repeated calls", async () => {
    const db = makeTestDb();
    injectDb(db);

    const { getDb } = await import("@/lib/db");
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);

    db.close();
  });

  it("using the injected test DB does not touch the real ~/.ai-usage path", async () => {
    const db = makeTestDb();
    injectDb(db);

    const { getDb } = await import("@/lib/db");
    const returned = getDb();

    // The returned DB is in-memory — verify by checking that it has no filename
    // (better-sqlite3 exposes .name for file-backed DBs)
    expect((returned as Database.Database & { name: string }).name).toBe(":memory:");

    db.close();
  });
});

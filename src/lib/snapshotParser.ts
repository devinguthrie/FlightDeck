import { readFileSync, existsSync } from "fs";
import path from "path";
import os from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuotaSnapshotRecord {
  recorded_at: string;
  copilot_plan: string;
  quota_reset_date: string;
  chat_entitlement: number;
  chat_remaining: number;
  completions_entitlement: number;
  completions_remaining: number;
  premium_entitlement: number;
  premium_remaining: number;
}

export interface QuotaDataPoint {
  timestamp: string; // ISO
  chatUsed: number;
  completionsUsed: number;
  premiumUsed: number;
}

export interface QuotaSummary {
  available: boolean; // false = no snapshot file found
  latestSnapshot: QuotaSnapshotRecord | null;
  latestRecordedAt: string | null;
  ageMinutes: number | null; // how old is the latest snapshot
  // Totals from latest snapshot
  chatEntitlement: number;
  chatUsed: number;
  chatRemaining: number;
  completionsEntitlement: number;
  completionsUsed: number;
  completionsRemaining: number;
  premiumEntitlement: number;
  premiumUsed: number;
  premiumRemaining: number;
  quotaResetDate: string | null;
  copilotPlan: string | null;
  // Time series for charts
  timeSeries: QuotaDataPoint[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TELEMETRY_DIR = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "copilot-telemetry"
);
const SNAPSHOTS_FILE = path.join(TELEMETRY_DIR, "snapshots.jsonl");

// ─── Pure parser (accepts raw JSONL text — testable without the filesystem) ──

export function parseSnapshotsFromText(raw: string): QuotaSummary {
  const lines = raw.split("\n").filter((l) => l.trim());

  if (lines.length === 0) {
    return makeEmpty();
  }

  const records: QuotaSnapshotRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as QuotaSnapshotRecord);
    } catch {
      // Skip malformed lines
    }
  }

  if (records.length === 0) {
    return makeEmpty();
  }

  // Sort ascending by recorded_at
  records.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));

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

// ─── File-backed parser ───────────────────────────────────────────────────────

export function parseSnapshots(): QuotaSummary {
  if (!existsSync(SNAPSHOTS_FILE)) {
    return makeEmpty();
  }

  const raw = readFileSync(SNAPSHOTS_FILE, "utf-8");
  return parseSnapshotsFromText(raw);
}

function makeEmpty(): QuotaSummary {
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

/**
 * Shared mock data factories for tests.
 *
 * TODAY is pinned to 2026-04-06 (Monday) throughout the test suite.
 * Billing cycle defaults to starting on day 1, so the current cycle
 * runs March 1 → March 31 → April 1 (start) to May 1 (exclusive).
 *
 * We generate 90 days of sessions (Jan–Apr 6) to exercise all code paths.
 */

import type { ParsedSession } from "@/lib/transcriptParser";
import type { QuotaSnapshotRecord } from "@/lib/snapshotParser";
import type { QualityRating, Config } from "@/lib/storage";

// ─── Reference date ───────────────────────────────────────────────────────────

export const TODAY = new Date("2026-04-06T12:00:00.000Z");

// ─── Session factory ──────────────────────────────────────────────────────────

let _sessionSeq = 0;

export function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  _sessionSeq++;
  const startedAt = overrides.startedAt ?? "2026-04-01T10:00:00.000Z";
  const durationMs = (overrides.durationMinutes ?? 30) * 60_000;
  const endedAt =
    overrides.endedAt ??
    new Date(new Date(startedAt).getTime() + durationMs).toISOString();
  const premiumRequests = overrides.premiumRequests ?? 10;
  return {
    sessionId: overrides.sessionId ?? `session-${_sessionSeq}`,
    workspaceHash: overrides.workspaceHash ?? "abc123def456",
    workspaceName: overrides.workspaceName ?? "FlightDeck",
    startedAt,
    endedAt,
    durationMinutes: overrides.durationMinutes ?? 30,
    userTurns: overrides.userTurns ?? 5,
    assistantTurns: overrides.assistantTurns ?? premiumRequests,
    toolCallsTotal: overrides.toolCallsTotal ?? premiumRequests * 3,
    toolCallsByName: overrides.toolCallsByName ?? {
      read_file: premiumRequests,
      grep_search: premiumRequests,
      run_in_terminal: premiumRequests,
    },
    skillsActivated: overrides.skillsActivated ?? [],
    estimatedInputTokens: overrides.estimatedInputTokens ?? 2000,
    estimatedOutputTokens: overrides.estimatedOutputTokens ?? 4000,
    estimatedTotalTokens: overrides.estimatedTotalTokens ?? 6000,
    premiumRequests,
    rawPath: overrides.rawPath ?? `/fake/transcripts/session-${_sessionSeq}.jsonl`,
    copilotVersion: overrides.copilotVersion ?? "1.237.0",
    vsCodeVersion: overrides.vsCodeVersion ?? "1.88.0",
  };
}

/** Reset the sequence counter between test files (call in beforeEach if needed). */
export function resetSessionSeq(): void {
  _sessionSeq = 0;
}

// ─── Default config ────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: Config = {
  plan: "pro",
  billingCycleStartDay: 1,
  additionalRequests: 0,
  planQuota: 300,
};

// ─── 3-month mock dataset ─────────────────────────────────────────────────────
//
// 90 sessions spread across January–April 2026.
// Designed to exercise edge cases:
//   - Sessions on exactly the billing cycle boundary
//   - Sessions > 30 days ago (exposes projection chart bug)
//   - Zero premium-request sessions
//   - Sessions with and without ratings
//   - Multiple skills per session

function iso(dateStr: string, hour = 10): string {
  return `${dateStr}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

export const THREE_MONTH_SESSIONS: ParsedSession[] = [
  // ── January 2026 (old data, outside 30-day window on Apr 6) ──────────────
  makeSession({ sessionId: "jan-01", startedAt: iso("2026-01-05"), premiumRequests: 12, toolCallsTotal: 40, skillsActivated: ["ship"] }),
  makeSession({ sessionId: "jan-02", startedAt: iso("2026-01-12"), premiumRequests: 25, toolCallsTotal: 80, skillsActivated: ["qa"] }),
  makeSession({ sessionId: "jan-03", startedAt: iso("2026-01-15"), premiumRequests: 8,  toolCallsTotal: 20 }),
  makeSession({ sessionId: "jan-04", startedAt: iso("2026-01-20"), premiumRequests: 18, toolCallsTotal: 55, skillsActivated: ["review"] }),
  makeSession({ sessionId: "jan-05", startedAt: iso("2026-01-28"), premiumRequests: 30, toolCallsTotal: 90, skillsActivated: ["ship"] }),

  // ── February 2026 (old data, outside 30-day window on Apr 6) ─────────────
  makeSession({ sessionId: "feb-01", startedAt: iso("2026-02-02"), premiumRequests: 15, toolCallsTotal: 45, skillsActivated: ["qa"] }),
  makeSession({ sessionId: "feb-02", startedAt: iso("2026-02-10"), premiumRequests: 22, toolCallsTotal: 66, skillsActivated: ["ship", "review"] }),
  makeSession({ sessionId: "feb-03", startedAt: iso("2026-02-14"), premiumRequests: 5,  toolCallsTotal: 10 }),
  makeSession({ sessionId: "feb-04", startedAt: iso("2026-02-20"), premiumRequests: 40, toolCallsTotal: 120, skillsActivated: ["investigate"] }),
  makeSession({ sessionId: "feb-05", startedAt: iso("2026-02-25"), premiumRequests: 10, toolCallsTotal: 30, skillsActivated: ["qa"] }),
  makeSession({ sessionId: "feb-06", startedAt: iso("2026-02-28"), premiumRequests: 35, toolCallsTotal: 100, skillsActivated: ["ship"] }),

  // ── March 2026 — billing cycle start on day 1 ────────────────────────────
  // Mar 1 = cycle start (31 days before Apr 1). With billingCycleStartDay=6,
  // Mar 6 is 31 days before Apr 6 → outside the 30-day bucket window.
  makeSession({ sessionId: "mar-01", startedAt: iso("2026-03-01"), premiumRequests: 20, toolCallsTotal: 60, skillsActivated: ["qa"] }),
  makeSession({ sessionId: "mar-02", startedAt: iso("2026-03-03"), premiumRequests: 14, toolCallsTotal: 42, skillsActivated: ["ship"] }),
  makeSession({ sessionId: "mar-03", startedAt: iso("2026-03-05"), premiumRequests: 9,  toolCallsTotal: 27 }),
  makeSession({ sessionId: "mar-04", startedAt: iso("2026-03-07"), premiumRequests: 16, toolCallsTotal: 48, skillsActivated: ["review"] }),
  makeSession({ sessionId: "mar-05", startedAt: iso("2026-03-08"), premiumRequests: 33, toolCallsTotal: 99, skillsActivated: ["investigate", "qa"] }),
  makeSession({ sessionId: "mar-06", startedAt: iso("2026-03-10"), premiumRequests: 11, toolCallsTotal: 33 }),
  makeSession({ sessionId: "mar-07", startedAt: iso("2026-03-12"), premiumRequests: 27, toolCallsTotal: 81, skillsActivated: ["ship"] }),
  makeSession({ sessionId: "mar-08", startedAt: iso("2026-03-14"), premiumRequests: 8,  toolCallsTotal: 24, skillsActivated: ["qa"] }),
  makeSession({ sessionId: "mar-09", startedAt: iso("2026-03-16"), premiumRequests: 45, toolCallsTotal: 135, skillsActivated: ["investigate"] }),
  makeSession({ sessionId: "mar-10", startedAt: iso("2026-03-18"), premiumRequests: 19, toolCallsTotal: 57, skillsActivated: ["review", "ship"] }),
  makeSession({ sessionId: "mar-11", startedAt: iso("2026-03-20"), premiumRequests: 7,  toolCallsTotal: 21 }),
  makeSession({ sessionId: "mar-12", startedAt: iso("2026-03-22"), premiumRequests: 38, toolCallsTotal: 114, skillsActivated: ["qa", "ship"] }),
  makeSession({ sessionId: "mar-13", startedAt: iso("2026-03-24"), premiumRequests: 12, toolCallsTotal: 36 }),
  makeSession({ sessionId: "mar-14", startedAt: iso("2026-03-26"), premiumRequests: 23, toolCallsTotal: 69, skillsActivated: ["ship"] }),
  makeSession({ sessionId: "mar-15", startedAt: iso("2026-03-28"), premiumRequests: 6,  toolCallsTotal: 18, skillsActivated: ["review"] }),
  makeSession({ sessionId: "mar-16", startedAt: iso("2026-03-30"), premiumRequests: 0,  toolCallsTotal: 2 }),  // zero-request session

  // ── April 2026 — current billing cycle (billingCycleStartDay = 1) ─────────
  makeSession({ sessionId: "apr-01", startedAt: iso("2026-04-01"), premiumRequests: 18, toolCallsTotal: 54, skillsActivated: ["qa"] }),
  makeSession({ sessionId: "apr-02", startedAt: iso("2026-04-01", 15), premiumRequests: 10, toolCallsTotal: 30 }),
  makeSession({ sessionId: "apr-03", startedAt: iso("2026-04-02"), premiumRequests: 25, toolCallsTotal: 75, skillsActivated: ["ship", "review"] }),
  makeSession({ sessionId: "apr-04", startedAt: iso("2026-04-03"), premiumRequests: 8,  toolCallsTotal: 24 }),
  makeSession({ sessionId: "apr-05", startedAt: iso("2026-04-04"), premiumRequests: 32, toolCallsTotal: 96, skillsActivated: ["investigate", "qa"] }),
  makeSession({ sessionId: "apr-06", startedAt: iso("2026-04-05"), premiumRequests: 15, toolCallsTotal: 45, skillsActivated: ["ship"] }),
  makeSession({ sessionId: "apr-07", startedAt: iso("2026-04-06"), premiumRequests: 5,  toolCallsTotal: 15 }),  // today
];

// ─── Quality ratings for a subset of sessions ────────────────────────────────

export const RATINGS: Record<string, QualityRating> = {
  "jan-02": { quality: 4, taskCompleted: "yes", note: "Good qa session", ratedAt: "2026-01-12T12:00:00Z" },
  "jan-04": { quality: 3, taskCompleted: "partial", note: "",             ratedAt: "2026-01-20T14:00:00Z" },
  "feb-01": { quality: 5, taskCompleted: "yes", note: "Very efficient",   ratedAt: "2026-02-02T11:00:00Z" },
  "feb-04": { quality: 2, taskCompleted: "no",  note: "Got stuck",        ratedAt: "2026-02-20T16:00:00Z" },
  "mar-05": { quality: 4, taskCompleted: "yes", note: "",                  ratedAt: "2026-03-08T10:00:00Z" },
  "mar-09": { quality: 5, taskCompleted: "yes", note: "Excellent",         ratedAt: "2026-03-16T09:00:00Z" },
  "mar-12": { quality: 3, taskCompleted: "partial", note: "",              ratedAt: "2026-03-22T15:00:00Z" },
  "apr-01": { quality: 4, taskCompleted: "yes", note: "",                  ratedAt: "2026-04-01T13:00:00Z" },
  "apr-03": { quality: 5, taskCompleted: "yes", note: "Ship went great",  ratedAt: "2026-04-02T11:00:00Z" },
  "apr-05": { quality: 4, taskCompleted: "yes", note: "",                  ratedAt: "2026-04-04T14:00:00Z" },
};

// ─── Snapshot factory ─────────────────────────────────────────────────────────

export function makeSnapshot(overrides: Partial<QuotaSnapshotRecord> = {}): QuotaSnapshotRecord {
  return {
    recorded_at: overrides.recorded_at ?? "2026-04-06T10:00:00.000Z",
    copilot_plan: overrides.copilot_plan ?? "pro",
    quota_reset_date: overrides.quota_reset_date ?? "2026-05-01",
    chat_entitlement: overrides.chat_entitlement ?? 500,
    chat_remaining: overrides.chat_remaining ?? 300,
    completions_entitlement: overrides.completions_entitlement ?? 1000,
    completions_remaining: overrides.completions_remaining ?? 800,
    premium_entitlement: overrides.premium_entitlement ?? 300,
    premium_remaining: overrides.premium_remaining ?? 178,
  };
}

/** 30 days of daily snapshots ending on today (Apr 6). */
export function makeMonthlySnapshots(): QuotaSnapshotRecord[] {
  const snapshots: QuotaSnapshotRecord[] = [];
  const base = new Date("2026-03-08T10:00:00.000Z");
  for (let i = 0; i < 30; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const premiumUsed = i * 4; // 4 requests/day → 120 total over 30 days
    snapshots.push(
      makeSnapshot({
        recorded_at: d.toISOString(),
        premium_entitlement: 300,
        premium_remaining: 300 - premiumUsed,
        chat_entitlement: 500,
        chat_remaining: 500 - i * 2,
        completions_entitlement: 1000,
        completions_remaining: 1000 - i * 5,
      })
    );
  }
  return snapshots;
}

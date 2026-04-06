# Copilot Telemetry Collector — VS Code Extension Plan

## Problem

The dashboard currently relies on `.jsonl` transcript files for all data. These have two critical blind spots:

1. **Inline completions are completely invisible.** Every tab-completion accepted is untracked.
2. **Quota data is approximate.** `assistant_turns` is a proxy for premium requests, not the real number from GitHub's billing system.

A thin VS Code extension can solve both by calling the same internal API the marketplace usage-tracker extensions already use.

---

## The API (Confirmed Working)

```
GET https://api.github.com/copilot_internal/user
Authorization: Bearer <github_oauth_token>
```

VS Code already holds a GitHub OAuth token via `vscode.authentication.getSession("github", ["user:email"])`. No new auth setup needed.

### Response — the fields we care about

```jsonc
{
  "copilot_plan": "individual",         // "individual" | "business" | "enterprise"
  "quota_reset_date_utc": "2026-05-01T00:00:00Z",
  "quota_snapshots": {
    "chat": {
      "entitlement": 300,              // monthly quota for chat
      "quota_remaining": 182,          // remaining right now
      "percent_remaining": 60.7,
      "timestamp_utc": "2026-04-05T14:32:00Z"   // when this snapshot was taken
    },
    "completions": {
      "entitlement": 8000,             // monthly quota for inline completions
      "quota_remaining": 7241,
      "percent_remaining": 90.5,
      "timestamp_utc": "2026-04-05T14:32:00Z"
    },
    "premium_interactions": {
      "entitlement": 300,              // combined premium quota
      "quota_remaining": 182,
      "percent_remaining": 60.7,
      "timestamp_utc": "2026-04-05T14:32:00Z"
    }
  }
}
```

**Key insight:** `completions.entitlement - completions.quota_remaining` gives the real inline completion count since the billing cycle started. We can track the delta between snapshots to get per-hour/per-day consumption.

---

## Architecture

```
┌─────────────────────────────────────┐
│         VS Code Extension           │
│  copilot-telemetry-collector        │
│                                     │
│  Every 15 min (configurable):       │
│    GET copilot_internal/user        │
│    → Append snapshot to .jsonl      │
│    → POST to localhost:3000 (opt)   │
└──────────────┬──────────────────────┘
               │ writes
               ▼
  %APPDATA%\copilot-telemetry\snapshots.jsonl

               │ reads
               ▼
┌─────────────────────────────────────┐
│      Next.js Dashboard              │
│                                     │
│  /api/quota-snapshots               │
│    → parse snapshots.jsonl          │
│    → return time-series data        │
│                                     │
│  New component: QuotaChart          │
│    → chat vs completions over time  │
│    → real quota remaining widget    │
└─────────────────────────────────────┘
```

### Why a file, not just HTTP POST?

- The dashboard server may not be running when VS Code is open
- File persists across dashboard restarts
- No port conflicts or auth needed between the two processes
- Identical pattern to how transcripts already work

---

## Extension Structure

New folder at repo root: `vscode-extension/`

```
vscode-extension/
├── package.json          # Extension manifest
├── tsconfig.json
├── src/
│   └── extension.ts      # ~150 lines
└── .vscodeignore
```

### `extension.ts` responsibilities

1. **Activate** — register a periodic poll (default: 15 min)
2. **`fetchSnapshot()`** — call `copilot_internal/user` with the VS Code GitHub session token
3. **`appendSnapshot()`** — write one JSON line to `%APPDATA%\copilot-telemetry\snapshots.jsonl`
4. **Optional: `postToServer()`** — POST the snapshot to `localhost:3000/api/quota-snapshots` for live updates
5. **Status bar item** — shows current `premium_interactions` percentage (like the marketplace extensions, but ours feeds our dashboard)
6. **Command: `copilotTelemetry.refreshNow`** — manual trigger

### Snapshot file format (one JSON object per line)

```json
{
  "recorded_at": "2026-04-05T14:32:00.000Z",
  "copilot_plan": "individual",
  "quota_reset_date": "2026-05-01T00:00:00Z",
  "chat_entitlement": 300,
  "chat_remaining": 182,
  "completions_entitlement": 8000,
  "completions_remaining": 7241,
  "premium_entitlement": 300,
  "premium_remaining": 182
}
```

---

## Dashboard Changes

### 1. New API route: `/api/quota-snapshots`

**File:** `src/app/api/quota-snapshots/route.ts`

Reads `%APPDATA%\copilot-telemetry\snapshots.jsonl` and returns:
- Current quota remaining (real, not estimated from turns)
- Time-series for the billing cycle: `[{ timestamp, chatUsed, completionsUsed, premiumUsed }]`
- Delta per period (hourly/daily) by diffing consecutive snapshots

### 2. New component: `QuotaChart.tsx`

A dual-line Recharts chart showing:
- Chat requests consumed over time (cumulative)
- Inline completions consumed over time (cumulative)
- Reference line for quota limit

This replaces the `assistant_turns` estimate in the projection chart with real data once snapshots are available. Falls back to estimate-only mode when no snapshots exist.

### 3. Update `ProjectionChart.tsx`

When snapshot data is available, use real `premium_remaining` for the projection instead of the transcript-based estimate. The two sources should converge — if they diverge significantly, it indicates multi-device usage.

### 4. Update stats summary widget

Replace the "~X requests estimated" label with "X requests (confirmed from GitHub)" when snapshot data is fresh (< 1 hour old).

---

## Data This Unlocks

| Metric | Before | After |
|---|---|---|
| Inline completions count | ❌ Invisible | ✅ `completions_entitlement - completions_remaining` |
| Real quota remaining | ⚠️ Estimated via `assistant_turns` | ✅ Direct from GitHub |
| Quota consumption over time | ⚠️ 1-day buckets from transcripts | ✅ 15-min snapshots |
| Multi-model usage | ❌ All turns look the same | ✅ chat vs premium_interactions split |
| Projection accuracy | ⚠️ Based on turn proxy | ✅ Based on actual quota burn |

---

## Build & Install Plan

The extension will be built as a `.vsix` and installed locally — no marketplace publishing needed.

```powershell
# From vscode-extension/
npm install
npx vsce package
# → copilot-telemetry-collector-1.0.0.vsix

# Install in VS Code:
# Extensions panel → ··· menu → Install from VSIX
```

VS Code will auto-activate it on startup. No reload needed after first install if the extension is already in the extensions folder.

---

## Implementation Phases

### Phase 1 — Extension scaffold (today)
- [ ] Create `vscode-extension/` with `package.json` and `tsconfig.json`
- [ ] Implement `extension.ts`: auth → fetch → append to `.jsonl`  
- [ ] Status bar item showing real `premium_interactions` %
- [ ] Build + install `.vsix`

### Phase 2 — Dashboard integration (today/tomorrow)
- [ ] Create `src/lib/snapshotParser.ts` (mirrors `transcriptParser.ts` pattern)
- [ ] Create `src/app/api/quota-snapshots/route.ts`
- [ ] Create `src/components/QuotaChart.tsx`
- [ ] Add `QuotaChart` to main dashboard page
- [ ] Update projection to use real quota data when snapshots available

### Phase 3 — Polish (optional)
- [ ] Sub-day bucketing on `ActivityTimeline` (already fully possible from transcript timestamps)
- [ ] HTTP POST from extension to dashboard for real-time updates (WebSocket or SSE-based live refresh)
- [ ] Divergence alert: warn when transcript estimate vs real quota differs by > 20% (multi-device detection)

---

## Out of Scope

- **Per-request inline completion detail** — the API only gives cumulative quota consumed, not individual events. Resolving individual completions would require the proxy approach.
- **Accepted vs rejected inline completions ratio** — same limitation; needs proxy.
- **Marketplace publishing** — local `.vsix` install is sufficient; publishing requires Microsoft review.

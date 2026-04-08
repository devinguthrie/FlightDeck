# FlightDeck — Monitoring Your Copilot CLI Usage

This document explains what FlightDeck measures, where each piece of data comes from, and how to verify everything is working.

---

## A Note on OpenTelemetry and the Copilot CLI

The [GitHub Copilot SDK OpenTelemetry docs](https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry) are **not** relevant to the interactive `copilot` terminal CLI. That page covers the Copilot SDK — a separate tool for developers building applications that programmatically drive the CLI as a subprocess. When used that way, the SDK can pass an OTEL endpoint to the CLI process it launches.

**The interactive `copilot` CLI has no user-facing OTEL configuration.** There is no `~/.copilot/config.json` field for it, no documented environment variable, and no `/help monitoring` slash command.

FlightDeck covers the monitoring gap with two local data sources described below.

---

## Data Sources

### 1. VS Code Transcript Files

**What they are:** JSONL event logs written by the GitHub Copilot VS Code extension after each chat session.

**Where they live:**
```
%APPDATA%\Code\User\workspaceStorage\{hash}\GitHub.copilot-chat\transcripts\*.jsonl
```

The `{hash}` folder varies per workspace. FlightDeck scans all workspace storage hashes automatically — no configuration needed.

**What FlightDeck extracts:**

| Metric | How |
|---|---|
| `assistant_turns` | Count of `assistant.turn_start` events — primary proxy for premium requests |
| `tool_calls_total` | Count of `tool.execution_start` events |
| `tool_calls_by_name` | Grouped by `toolName` field — shows which tools ran most |
| `skills_activated` | Tool calls where the path matches a `SKILL.md` file |
| `session_duration_minutes` | Last event timestamp minus first event timestamp |
| `estimated_tokens` | Total message character count ÷ 4 (industry-standard approximation) |

**Limitation:** Transcripts are only written by VS Code + Copilot Chat. Sessions from the Copilot CLI terminal tool (`copilot`) are not captured by transcript files.

---

### 2. Quota Snapshot Files (VS Code Extension)

**What they are:** Periodic snapshots of real quota data from the GitHub Copilot API, written by the companion VS Code extension (`vscode-extension/`).

**Where they live:**
```
%APPDATA%\copilot-telemetry\snapshots.jsonl
```

**What each snapshot contains:**

```json
{
  "recorded_at": "2026-04-07T20:00:00.000Z",
  "copilot_plan": "individual",
  "quota_reset_date": "2026-05-01T00:00:00Z",
  "chat_entitlement": 300,
  "chat_remaining": 147,
  "completions_entitlement": 8000,
  "completions_remaining": 7241,
  "premium_entitlement": 300,
  "premium_remaining": 147
}
```

**What FlightDeck derives from this:**

| Metric | Formula |
|---|---|
| Real quota used | `entitlement - remaining` |
| Inline completions used | `completions_entitlement - completions_remaining` |
| Time-series burn rate | Delta between consecutive snapshots |
| Projection accuracy | Cross-check against transcript-based `assistant_turns` estimate |

**Limitation:** Snapshots are point-in-time. Between polls, usage is interpolated. Default poll interval is 15 minutes.

---

## Configuration

### VS Code Extension Settings

Open VS Code Settings (`Ctrl+,`) and search **"FlightDeck Telemetry"**:

| Setting | Default | Description |
|---|---|---|
| `copilotTelemetry.pollIntervalMinutes` | `15` | How often to call the GitHub Copilot quota API |
| `copilotTelemetry.dashboardPort` | `3000` | Port for live push to FlightDeck dashboard (`0` = disabled) |

These are defined in `vscode-extension/package.json` under `contributes.configuration`.

### Dashboard Config

Stored in `~\.ai-usage\data.json` under the `config` key. Editable via the Settings panel in the dashboard UI:

| Field | Description |
|---|---|
| `plan` | Your Copilot plan (`free`, `pro`, `pro+`, `business`) |
| `billingCycleStartDay` | Day of month when your quota resets (find at github.com/settings/billing) |
| `additionalRequests` | Optional override if you've purchased additional quota |
| `planQuota` | Effective monthly quota (auto-set from plan selection) |

---

## Verifying the Extension Is Running

1. Check the VS Code status bar — look for `$(graph) XX%` in the bottom-right
2. Run the command **"Copilot Telemetry: Refresh Now"** from the Command Palette (`Ctrl+Shift+P`)
3. Open the Output panel (`View → Output`) and select **"Copilot Telemetry"** from the dropdown
4. Check that `%APPDATA%\copilot-telemetry\snapshots.jsonl` exists and is being appended to

---

## Verifying Dashboard Data

Open `http://localhost:3000` while `npm run dev` is running. The Stats Cards at the top of the page show:

- **Requests This Month** — sourced from quota snapshots (real) or transcript estimates (fallback)
- **Data source indicator** — "confirmed from GitHub" when snapshots are fresh (< 1 hour), "estimated" otherwise

If the two sources diverge significantly (> 20%), it likely indicates multi-device usage — sessions from another machine are consuming quota that transcripts on this machine don't reflect.

---

## Full Data File Map

| File | Written by | Read by | Contents |
|---|---|---|---|
| `%APPDATA%\copilot-telemetry\snapshots.jsonl` | VS Code extension | Dashboard `/api/quota-snapshots` | Quota snapshots every N minutes |
| `%APPDATA%\Code\User\workspaceStorage\*\GitHub.copilot-chat\transcripts\*.jsonl` | VS Code Copilot Chat | Dashboard `/api/sessions` | Full session event logs |
| `~\.ai-usage\data.json` | Dashboard | Dashboard | Config, quality ratings, session cache |
| `~\.copilot\config.json` | Copilot CLI | Copilot CLI | CLI settings (plugins, auth — not for FlightDeck) |

---

## Further Reading

- [DATA_POINTS.md](DATA_POINTS.md) — complete catalog of every metric, its source, and its strategic value
- [EXTENSION_PLAN.md](EXTENSION_PLAN.md) — architecture of the VS Code extension and its API
- [DESIGN.md](DESIGN.md) — overall dashboard design and ROI calculation methodology

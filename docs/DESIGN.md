# AI Usage Dashboard — Design Document

## Purpose

Local web dashboard for VS Code Copilot usage tracking. Primary goal: measure the ROI of AI tooling decisions (skills, harnesses, prompts) by correlating premium request consumption with output quality over time.

**The core question it answers**: *"Did using skill X produce better output per request than not using it?"*

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Browser (localhost:3000)                            │
│  ┌─────────────────────────────────────────────────┐│
│  │  Next.js Dashboard (React + Recharts)           ││
│  │  ActivityTimeline | ProjectionChart | Breakdown ││
│  │  SessionList with Quality Rating UI             ││
│  └──────────────────┬──────────────────────────────┘│
└─────────────────────│───────────────────────────────┘
                      │ fetch()
┌─────────────────────▼───────────────────────────────┐
│  Next.js API Routes (Node.js server, localhost)     │
│  /api/sessions    → Parsed session list             │
│  /api/stats       → Aggregated daily counts         │
│  /api/config      → Plan settings, billing date     │
│  /api/rate        → POST quality rating             │
└───────────┬─────────────────────┬───────────────────┘
            │                     │
┌───────────▼────────┐  ┌─────────▼──────────────────┐
│  VS Code Transcripts│  │  ~/.ai-usage/data.json     │
│  AppData\Roaming\   │  │  - quality ratings         │
│  Code\User\         │  │  - user config             │
│  workspaceStorage\  │  │  - session cache metadata  │
│  *\copilot-chat\    │  └────────────────────────────┘
│  transcripts\*.jsonl│
└────────────────────┘
```

---

## Data Flow

### Read Path (Dashboard Load)
1. User opens `localhost:3000`
2. Browser calls `GET /api/sessions`
3. API route scans `workspaceStorage\*\GitHub.copilot-chat\transcripts\*.jsonl`
4. Each `.jsonl` is parsed into a `ParsedSession` object
5. Sessions are enriched with quality ratings from `~/.ai-usage/data.json`
6. Response returned as JSON array

### Write Path (Quality Rating)
1. User clicks stars on a session card
2. Browser calls `POST /api/sessions/{id}/rate` with `{ rating: 1-5, note?: string }`
3. API route writes to `~/.ai-usage/data.json`
4. UI optimistically updates

### Config Path
1. User sets plan type and billing cycle start date in settings widget
2. Saved to `~/.ai-usage/data.json` under `config` key
3. All projection math uses this config

---

## File Structure

```
AiUsageDashboard/
├── docs/
│   ├── DESIGN.md          (this file)
│   └── DATA_POINTS.md     (data reference)
├── src/
│   ├── app/
│   │   ├── layout.tsx     (root layout, viewport meta)
│   │   ├── page.tsx       (main dashboard page)
│   │   └── api/
│   │       ├── sessions/
│   │       │   ├── route.ts           (GET all sessions)
│   │       │   └── [id]/
│   │       │       └── rate/route.ts  (POST rating)
│   │       ├── stats/route.ts         (GET aggregated stats)
│   │       └── config/route.ts        (GET/PUT config)
│   ├── lib/
│   │   ├── transcriptParser.ts  (JSONL parser)
│   │   ├── storage.ts           (data.json read/write)
│   │   └── pricing.ts           (plan quotas + cost math)
│   └── components/
│       ├── ActivityTimeline.tsx   (Chart 1)
│       ├── ProjectionChart.tsx    (Chart 2)
│       ├── ToolBreakdown.tsx      (Chart 3)
│       ├── SessionList.tsx        (Session table with ratings)
│       ├── StatsCards.tsx         (KPI header cards)
│       └── ConfigPanel.tsx        (Plan/billing settings)
├── package.json
├── tsconfig.json
├── next.config.ts
└── tailwind.config.ts
```

---

## Component Design

### StatsCards (header row)
Four KPI cards:
- **Requests This Month**: `N / plan_quota` with progress bar
- **Requests Remaining**: Number + "~X days at current pace"
- **Projected Exhaustion**: Date, or "✓ within cycle" if on track
- **Sessions This Month**: Count + avg quality rating badge (if rated)

### Chart 1: Activity Timeline
- **Type**: Bar chart
- **X-axis**: Time buckets (today=hourly, 7d=daily, 30d=daily)
- **Y-axis**: Premium requests (= assistant_turns)
- **Controls**: Range selector [Today | 7 days | 30 days | This cycle]
- **Color**: Solid bars colored by whether session had skills activated
- **Tooltip**: Show session IDs, tool call count, skills used

### Chart 2: Projection Chart
- **Type**: ComposedChart (lines + area)
- **X-axis**: Calendar dates (current billing cycle)
- **Elements**:
  - Blue area: Actual cumulative requests (solid, from billing start to today)
  - Orange dashed line: Projected trend (from today to exhaustion or cycle end)
  - Red horizontal dashed line: Plan quota limit
  - Grey vertical line: Projected exhaustion date (if before cycle end)
- **Controls**: "Average over last [1|3|7|14] days" selector for projection window
- **Annotation**: "At this pace, you'll exhaust on Apr 22 (18 days)"

### Chart 3: Tool & Skill Breakdown
- **Type**: Horizontal bar chart (sorted by frequency)
- **Data**: Top 10 tool names by call count, last 30 days
- **Segment**: Split bar — red segment highlights skill-reading tool calls
- **Companion table**: Skill name | Times used | Avg requests in those sessions | Avg quality (if rated)

### SessionList
- Table of last 50 sessions
- Columns: Date | Duration | Requests | Tools | Skills | Quality
- Quality column: 5-star rating component (click to rate, instant save)
- Row expand: Show full session detail (message count, all tool calls, link to transcript)
- Filter: "Only unrated" toggle

### ConfigPanel (collapsible)
Fields:
- **Plan**: [Free (50) | Pro (300) | Pro+ (1500) | Business (300/user)]
- **Billing Cycle Start Day**: Number 1–28 (day of month)
- **Additional Purchased Requests**: Optional override for extra quota

---

## Key Technical Decisions

### Why JSON file storage (not SQLite)
- Zero native module compilation issues on Windows
- Sufficient for expected data volume (< 1000 sessions over a year)
- Easily inspectable with any text editor
- Tradeoff: No complex joins — but all queries needed are simple aggregations

### Why transcript file scanning (not webhook/hook augmentation)
- Zero setup required — transcripts exist already
- Works retroactively (can parse past sessions from before this dashboard existed)
- Hook augmentation is a Phase 2 enhancement for Claude Code support

### Why Next.js (not plain HTML)
- API routes give server-side file access inside the same project
- Hot reload during development
- Easy to add auth or sharing later if going open-source
- Recharts has excellent Next.js support

### Token estimation approach
`estimatedTokens = characterCount / 4`

This is the industry-standard rough approximation (OpenAI's own documentation uses this rule for English text). Actual tokenization varies by model and language but is reliable for trend analysis. All displayed estimates are labeled `~N` or shown with a `(est.)` badge.

### Premium request estimation
`premiumRequests = assistantTurnCount`

Each `assistant.turn_start` event = one model invocation = one premium request consumed (assuming premium model was selected, which is the default for Claude Sonnet). This is an upper bound: some turns may use the base model (GPT-5 mini) if the user switched models. Labeled as "~N requests (est.)" in the UI.

---

## ROI Calculation (Phase 2 — requires rating data)

Once quality ratings accumulate:

```
qualityPerRequest(session) = quality_rating / assistant_turns

roiBySkill(skillName) = {
  with_skill:    avg(qualityPerRequest) for sessions where skills_activated contains skillName
  without_skill: avg(qualityPerRequest) for sessions where skills_activated is empty
  delta:         with_skill - without_skill  // positive = skill helps ROI
}
```

A `skill_roi_delta > 0` means using that skill gets you more output quality per request.
A `skill_roi_delta < 0` means the skill inflates request count without improving quality — investigate reducing its scope.

This requires ~30 rated sessions minimum per condition to be meaningful. A "data confidence" indicator will show how many sessions each measurement is based on.

---

## Data Storage Schema

### `~/.ai-usage/data.json`
```json
{
  "config": {
    "plan": "pro",
    "billingCycleStartDay": 1,
    "additionalRequests": 0,
    "planQuota": 300
  },
  "ratings": {
    "{sessionId}": {
      "quality": 4,
      "taskCompleted": "yes",
      "note": "Built the login component",
      "ratedAt": "2026-04-04T21:00:00Z"
    }
  },
  "sessionCache": {
    "{sessionId}": {
      "lastModifiedAt": 1712345678,
      "parsedAt": 1712345700
    }
  }
}
```

---

## Setup Instructions

```bash
cd AiUsageDashboard
npm install
npm run dev
```

Open `http://localhost:3000`. On first load:
1. Click the settings gear (top right)
2. Select your Copilot plan
3. Set your billing cycle start day (find at github.com/settings/billing)
4. Dashboard auto-scans your transcript files

No environment variables required. No API keys. All data stays local.

---

## Future Phases

| Phase | Feature | Requires |
|---|---|---|
| 2 | Claude Code CLI tracking | Extend `track-telemetry.ps1` to write local SQLite events |
| 2 | Per-tool latency tracking | Parse `tool.execution_start` + `_complete` timestamp pairs |
| 3 | Model inference from request IDs | Parse `toolu_bdrk_*` vs `chatcmpl-*` patterns (unverified heuristic) |
| 3 | Inline suggestion acceptance rate | Parse VS Code Copilot extension log files |
| 4 | Local HTTPS proxy for exact tokens | mitmproxy-style interceptor; requires cert trust |
| 4 | Export to CSV | One-click data export for external analysis |
| 5 | Multi-user / team mode | Auth layer + shared SQLite; requires backend |

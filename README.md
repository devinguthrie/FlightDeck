# FlightDeck

Local Copilot analytics for people who care about output quality, workflow efficiency, and premium quota burn.

This project runs fully on your machine and combines two data sources:

1. VS Code transcript files (behavioral usage)
2. Quota snapshots from a VS Code extension (billed usage)

No external database. No hosted telemetry backend. No cloud lock-in.

## Why This Exists

Raw Copilot usage counts are not enough.

This dashboard helps you answer practical questions:

- Are my premium requests improving outcomes?
- Which tools/skills produce higher quality per request?
- How quickly am I burning premium quota this cycle?
- Is transcript-estimated activity diverging from billed usage?

## Features

- Transcript parser for local Copilot chat sessions
- Quota snapshot ingestion from extension polling of GitHub Copilot internal quota endpoint
- Session list with per-session quality ratings (1 to 5)
- ROI and efficiency metrics
- Time-window filtering and trend charts
- Projection chart for estimated premium exhaustion

## Repo Layout

- `src/app` - Next.js app and API routes
- `src/components` - dashboard panels and charts
- `src/lib` - parsers and shared analytics logic
- `vscode-extension` - companion extension that polls quota snapshots
- `docs` - design notes, metric definitions, extension plan

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Data Sources

### 1) Transcript Data (automatic)

Read from:

```text
%APPDATA%\Code\User\workspaceStorage\{hash}\GitHub.copilot-chat\transcripts\*.jsonl
```

The dashboard scans all workspace storage hashes.

### 2) Quota Snapshot Data (extension)

Read from:

```text
%APPDATA%\copilot-telemetry\snapshots.jsonl
```

Each snapshot includes `chat`, `completions`, and `premium_interactions` quota fields.

## Extension Setup

1. Build the extension package from `vscode-extension`:

```bash
npm install
npm run compile
npm run package
```

2. Install the generated `.vsix` in VS Code:

- Open VS Code
- Open Extensions view
- Click the `...` menu (top-right)
- Select `Install from VSIX...`
- Choose `vscode-extension/copilot-telemetry-collector-1.0.0.vsix`

3. Reload VS Code:

- Run `Developer: Reload Window` from the Command Palette

4. Sign in to GitHub in VS Code if prompted.

5. Verify it is running:

- Check the status bar for a graph icon and a percentage (for example `$(graph) 42%`)
- Run command `Copilot Telemetry: Refresh Now`
- Open Output panel and select `Copilot Telemetry` to view logs

The extension:

- Polls quota on an interval
- Writes JSONL snapshots locally
- Optionally POSTs to `http://localhost:3000/api/quota-snapshots`
- Shows premium usage percent in the VS Code status bar

## API Endpoints

- `GET /api/stats` - aggregated metrics for charts/cards
- `GET /api/sessions` - parsed session list
- `POST /api/sessions/[id]/rate` - persist rating updates
- `GET /api/quota-snapshots` - quota timeseries and latest snapshot
- `POST /api/quota-snapshots` - ingest snapshot records
- `GET/POST /api/config` - local dashboard config

## Local Storage

Dashboard config + ratings:

```text
~\.ai-usage\data.json
```

Extension snapshots:

```text
%APPDATA%\copilot-telemetry\snapshots.jsonl
```

## Product Name

This project is named `FlightDeck`.

## Notes

- Transcript-derived counts and billed premium usage are intentionally tracked separately.
- If numbers diverge, that is signal, not always error.
- Browser extensions that mutate HTML (for example Dark Reader) can trigger dev-only hydration warnings.

## Docs

- [docs/DESIGN.md](docs/DESIGN.md)
- [docs/DATA_POINTS.md](docs/DATA_POINTS.md)
- [docs/EXTENSION_PLAN.md](docs/EXTENSION_PLAN.md)

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

interface QuotaSnapshot {
  entitlement: number;
  quota_remaining: number;
  percent_remaining: number;
  overage_count: number;
  overage_permitted: boolean;
  unlimited: boolean;
  timestamp_utc: string;
}

interface CopilotApiResponse {
  login: string;
  copilot_plan: string;
  quota_reset_date_utc: string;
  quota_snapshots: {
    chat: QuotaSnapshot;
    completions: QuotaSnapshot;
    premium_interactions: QuotaSnapshot;
  };
}

/** One line written to snapshots.jsonl */
interface SnapshotRecord {
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

// ─── Constants ───────────────────────────────────────────────────────────────

const COPILOT_API_URL = "https://api.github.com/copilot_internal/user";
const TELEMETRY_DIR = path.join(os.homedir(), "AppData", "Roaming", "copilot-telemetry");
const SNAPSHOTS_FILE = path.join(TELEMETRY_DIR, "snapshots.jsonl");

let out: vscode.OutputChannel;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  out = vscode.window.createOutputChannel("Copilot Telemetry");
  context.subscriptions.push(out);

  // Ensure output directory exists
  ensureTelemetryDir();

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    -999,
  );
  statusBar.command = "copilotTelemetry.refreshNow";
  statusBar.tooltip = "FlightDeck Telemetry — click to refresh";
  statusBar.text = "$(graph) …";
  statusBar.show();

  let intervalHandle: ReturnType<typeof setInterval> | undefined;

  function getIntervalMs(): number {
    const minutes = vscode.workspace
      .getConfiguration("copilotTelemetry")
      .get<number>("pollIntervalMinutes", 15);
    return Math.max(1, minutes) * 60 * 1000;
  }

  function startPolling() {
    if (intervalHandle !== undefined) {
      clearInterval(intervalHandle);
    }
    intervalHandle = setInterval(() => runPoll(statusBar, context), getIntervalMs());
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("copilotTelemetry.refreshNow", async () => {
      await runPoll(statusBar, context);
    }),
    vscode.commands.registerCommand("copilotTelemetry.showLog", () => {
      vscode.window.showInformationMessage(`Snapshot log: ${SNAPSHOTS_FILE}`);
      if (fs.existsSync(SNAPSHOTS_FILE)) {
        vscode.env.openExternal(vscode.Uri.file(SNAPSHOTS_FILE));
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("copilotTelemetry.pollIntervalMinutes")) {
        startPolling();
      }
    }),
    { dispose: () => intervalHandle !== undefined && clearInterval(intervalHandle) },
    statusBar,
  );

  // Initial poll + start timer
  runPoll(statusBar, context);
  startPolling();
}

export function deactivate() {
  // Cleanup via disposables
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

async function runPoll(
  statusBar: vscode.StatusBarItem,
  context: vscode.ExtensionContext,
): Promise<void> {
  statusBar.text = "$(sync~spin) Copilot…";

  const { data: apiData, error } = await fetchCopilotQuota();

  if (!apiData) {
    statusBar.text = "$(graph) $(error)";
    statusBar.tooltip = `Copilot Telemetry: ${error ?? "unable to fetch quota"}\nClick to retry`;
    out.appendLine(`[${new Date().toISOString()}] Poll failed: ${error}`);
    return;
  }

  const record = buildRecord(apiData);
  appendSnapshot(record);
  out.appendLine(`[${new Date().toISOString()}] Snapshot written: premium ${record.premium_remaining}/${record.premium_entitlement} remaining`);
  await maybePushToDashboard(record, context);
  updateStatusBar(statusBar, record);
}

async function fetchCopilotQuota(): Promise<{ data: CopilotApiResponse | null; error?: string }> {
  try {
    // Try silent first; prompt if not signed in yet
    let session = await vscode.authentication.getSession(
      "github",
      ["user:email"],
      { createIfNone: false },
    );

    if (!session) {
      // One-time prompt on first run
      session = await vscode.authentication.getSession(
        "github",
        ["user:email"],
        { createIfNone: true },
      );
    }

    if (!session) {
      return { data: null, error: "No GitHub session — sign in to VS Code with GitHub" };
    }

    out.appendLine(`[${new Date().toISOString()}] Using GitHub account: ${session.account.label}`);

    const response = await fetch(COPILOT_API_URL, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "User-Agent": "copilot-telemetry-collector/1.0",
        Accept: "application/json",
      },
    });

    out.appendLine(`[${new Date().toISOString()}] API response: HTTP ${response.status}`);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      out.appendLine(`  Response body: ${body.slice(0, 500)}`);
      const hint =
        response.status === 401 ? "token rejected — try signing out and back in to GitHub in VS Code" :
        response.status === 403 ? "access denied — your account may not have a Copilot subscription" :
        response.status === 404 ? "endpoint not found — API may have changed" :
        `HTTP ${response.status}`;
      return { data: null, error: hint };
    }

    const json = (await response.json()) as CopilotApiResponse;
    out.appendLine(`  plan=${json.copilot_plan}, premium_remaining=${json.quota_snapshots?.premium_interactions?.quota_remaining}`);
    return { data: json };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out.appendLine(`[${new Date().toISOString()}] Fetch exception: ${msg}`);
    return { data: null, error: msg };
  }
}

function buildRecord(data: CopilotApiResponse): SnapshotRecord {
  const { chat, completions, premium_interactions } = data.quota_snapshots;
  return {
    recorded_at: new Date().toISOString(),
    copilot_plan: data.copilot_plan ?? "unknown",
    quota_reset_date: data.quota_reset_date_utc ?? "",
    chat_entitlement: chat?.entitlement ?? 0,
    chat_remaining: chat?.quota_remaining ?? 0,
    completions_entitlement: completions?.entitlement ?? 0,
    completions_remaining: completions?.quota_remaining ?? 0,
    premium_entitlement: premium_interactions?.entitlement ?? 0,
    premium_remaining: premium_interactions?.quota_remaining ?? 0,
  };
}

function appendSnapshot(record: SnapshotRecord): void {
  try {
    ensureTelemetryDir();
    fs.appendFileSync(SNAPSHOTS_FILE, JSON.stringify(record) + "\n", "utf-8");
  } catch (err) {
    console.error("[CopilotTelemetry] Write error:", err);
  }
}

async function maybePushToDashboard(
  record: SnapshotRecord,
  context: vscode.ExtensionContext,
): Promise<void> {
  const port = vscode.workspace
    .getConfiguration("copilotTelemetry")
    .get<number>("dashboardPort", 3000);

  if (!port) {
    return;
  }

  try {
    const res = await fetch(`http://localhost:${port}/api/quota-snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      // Dashboard may not be running — silent fail
      console.warn(`[CopilotTelemetry] Dashboard push returned ${res.status}`);
    }
  } catch {
    // Dashboard not running — ignore
  }
}

function updateStatusBar(statusBar: vscode.StatusBarItem, record: SnapshotRecord): void {
  const used = record.premium_entitlement - record.premium_remaining;
  const pct =
    record.premium_entitlement > 0
      ? Math.round((used / record.premium_entitlement) * 100)
      : 0;

  statusBar.text = `$(graph) ${pct}%`;
  statusBar.tooltip = [
    `Premium requests: ${used} / ${record.premium_entitlement} used (${pct}%)`,
    `Inline completions: ${record.completions_entitlement - record.completions_remaining} / ${record.completions_entitlement} used`,
    `Chat: ${record.chat_entitlement - record.chat_remaining} / ${record.chat_entitlement} used`,
    ``,
    `Quota resets: ${record.quota_reset_date ? new Date(record.quota_reset_date).toLocaleDateString() : "unknown"}`,
    `Last updated: ${new Date(record.recorded_at).toLocaleTimeString()}`,
    ``,
    `Click to refresh now`,
  ].join("\n");
}

function ensureTelemetryDir(): void {
  if (!fs.existsSync(TELEMETRY_DIR)) {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
  }
}

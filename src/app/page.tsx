"use client";

import { useCallback, useEffect, useState } from "react";
import ActivityTimeline from "@/components/ActivityTimeline";
import ProjectionChart from "@/components/ProjectionChart";
import QuotaChart from "@/components/QuotaChart";
import RoiExplorationPanel from "@/components/RoiExplorationPanel";
import ToolBreakdown from "@/components/ToolBreakdown";
import SessionList from "@/components/SessionList";
import ConfigPanel from "@/components/ConfigPanel";
import TokenVolumeChart from "@/components/TokenVolumeChart";
import type { PlanKey } from "@/lib/pricing";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Config {
  plan: PlanKey;
  billingCycleStartDay: number;
  additionalRequests: number;
  planQuota: number;
}

interface DailyBucket {
  date: string;
  requests: number;
  sessions: number;
  toolCalls: number;
  skills: string[];
  inputTokens: number;
  outputTokens: number;
}

interface IntradayBucket {
  hour: string;
  transcriptTurns: number;
  toolCalls: number;
}

interface ProjectionPoint {
  date: string;
  actual: number | null;
  projected: number | null;
}

interface StatsData {
  cycleStart: string;
  cycleEnd: string;
  requestsThisCycle: number;
  planQuota: number;
  requestsRemaining: number;
  daysRemainingEstimate: number | null;
  projectedExhaustionDate: string | null;
  dailyBurnRate: number;
  cycleUserTurns: number;
  cycleAssistantTurns: number;
  cycleToolCalls: number;
  cycleDurationMinutes: number;
  premiumBurnPerUserPrompt: number | null;
  requestDensityPerMinute: number;
  toolOverheadRatio: number;
  promptEfficiencyPer100Turns: number | null;
  qualityToolOverheadCorrelation: number | null;
  dailyBuckets: DailyBucket[];
  intradayBuckets: IntradayBucket[];
  projectionPoints: ProjectionPoint[];
  topTools: Array<{ name: string; count: number }>;
  skillStats: Array<{
    name: string;
    sessions: number;
    avgRequests: number;
    avgQuality: number | null;
    sampleSize: number;
    qualityPer100Req: number | null;
    liftVsBaseline: number | null;
  }>;
  marginalQualityCurve: Array<{
    bucket: string;
    minRequests: number;
    maxRequests: number;
    sessions: number;
    avgQuality: number | null;
    avgRequests: number;
  }>;
  totalSessions: number;
  totalRequests: number;
  totalRated: number;
  avgQuality: number | null;
  sevenDayRequests: number;
  sevenDayBurnRate: number;
  avgContextSaturation: number | null;
  toolLatencies: Array<{
    name: string;
    count: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
  }>;
  proxyStats: {
    totalRequests: number;
    cliRequests: number;
    vscodeRequests: number;
    proxyActive: boolean;
    cliActive: boolean;
    lastCapturedAt: string | null;
    modelBreakdown: Array<{ model: string; count: number; avgLatencyMs: number; totalPromptTokens: number; totalCompletionTokens: number }>;
    tokenAccuracy: {
      exactTotalTokens: number;
      estimatedTotalTokens: number;
      accuracyRatio: number;
    } | null;
  };
  outputInputRatio: number | null;
  topWorkspacesByTokens: Array<{ workspace: string; inputTokens: number; outputTokens: number }>;
}

interface QuotaDataPoint {
  timestamp: string;
  chatUsed: number;
  completionsUsed: number;
  premiumUsed: number;
}

interface QuotaSummary {
  available: boolean;
  latestRecordedAt: string | null;
  ageMinutes: number | null;
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
  timeSeries: QuotaDataPoint[];
}

interface Session {
  sessionId: string;
  workspaceName: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  premiumRequests: number;
  toolCallsTotal: number;
  skillsActivated: string[];
  estimatedTotalTokens: number;
  rating: {
    quality: number;
    taskCompleted: string;
    note: string;
  } | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map the GitHub copilot_plan string (or entitlement count) to a local PlanKey. */
function inferPlanKey(
  copilotPlan: string | null,
  entitlement: number
): "free" | "pro" | "pro+" | "business" | null {
  if (copilotPlan) {
    const lower = copilotPlan.toLowerCase();
    if (lower.includes("pro_plus") || lower.includes("copilot_pro_plus")) return "pro+";
    if (lower.includes("business") || lower.includes("enterprise")) return "business";
    if (lower.includes("pro")) return "pro";
    if (lower.includes("free")) return "free";
  }
  if (entitlement >= 1000) return "pro+";
  if (entitlement === 300) return "pro";
  if (entitlement === 50) return "free";
  return null;
}
/** Format a token count as a human-readable string (K / M suffix). */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}
// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  color,
  progress,
}: {
  label: string;
  value: string;
  sub?: string;
  color: "blue" | "green" | "amber" | "purple";
  progress?: number; // 0–1
}) {
  const colors = {
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    green: "bg-green-50 border-green-200 text-green-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
  };
  const bar = {
    blue: "bg-blue-400",
    green: "bg-green-400",
    amber: "bg-amber-400",
    purple: "bg-purple-400",
  };

  return (
    <div className={`rounded-lg border p-4 ${colors[color]}`}>
      <p className="text-xs font-medium opacity-70 mb-1 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold leading-none">{value}</p>
      {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
      {progress !== undefined && (
        <div className="mt-3 h-1.5 bg-white/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${bar[color]}`}
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const [avgDays, setAvgDays] = useState(7);
  const [timeRange, setTimeRange] = useState<"7d" | "30d">("7d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [workspaceList, setWorkspaceList] = useState<string[]>([]);

  const loadStats = useCallback(async () => {
    try {
      const wsParam = selectedWorkspace ? `&workspace=${encodeURIComponent(selectedWorkspace)}` : "";
      const res = await fetch(`/api/stats?avgDays=${avgDays}${wsParam}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as StatsData;
      setStats(data);
      // Only update the workspace list from unfiltered loads so the dropdown isn't cleared
      if (!selectedWorkspace) {
        setWorkspaceList(data.topWorkspacesByTokens.map((w) => w.workspace));
      }
    } catch (e) {
      setError(String(e));
    }
  }, [avgDays, selectedWorkspace]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      setSessions((await res.json()) as Session[]);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      setConfig((await res.json()) as Config);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/quota-snapshots", { cache: "no-store" });
      if (!res.ok) return; // silent — extension may not be installed yet
      setQuota((await res.json()) as QuotaSummary);
    } catch {
      // Extension not yet installed — ignore
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadStats(), loadSessions(), loadConfig(), loadQuota()]).finally(() =>
      setLoading(false)
    );
    // Initial load only. avgDays changes are handled by the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload stats when avgDays or workspace filter changes
  useEffect(() => {
    if (!loading) loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avgDays, selectedWorkspace]);

  // Auto-sync plan when quota data shows a different entitlement than the stored config.
  // This handles mid-cycle plan upgrades (e.g., Pro → Pro+).
  useEffect(() => {
    if (!quota?.available || !config) return;
    const inferred = inferPlanKey(quota.copilotPlan, quota.premiumEntitlement);
    if (!inferred || inferred === config.plan) return;
    fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: inferred }),
    })
      .then((r) => r.json())
      .then((updated) => {
        setConfig(updated as Config);
        loadStats();
      })
      .catch(() => {});
    // Only run when quota or config identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quota?.copilotPlan, quota?.premiumEntitlement, config?.plan]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 animate-pulse">Loading transcript data…</p>
      </div>
    );
  }

  if (error || !stats || !config) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-3">
        <p className="text-red-500 font-medium">Failed to load data</p>
        <p className="text-gray-500 text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-blue-600 text-sm underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const billedPremiumUsed = quota?.available ? quota.premiumUsed : null;

  // When a user upgrades plans mid-cycle, GitHub resets premiumUsed to 0 on the
  // new plan. Detect this by finding a snapshot where premiumUsed drops by >30
  // units AND >40% — a clear reset, not normal variation. Slice to post-reset
  // only so burn rate / projection calcs don't see a negative delta.
  const postResetTimeSeries = (() => {
    if (!quota?.available || quota.timeSeries.length === 0) return quota?.timeSeries ?? [];
    const sorted = [...quota.timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let lastResetIdx = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].premiumUsed;
      const curr = sorted[i].premiumUsed;
      if (prev > 30 && curr < prev * 0.6 && prev - curr > 30) {
        lastResetIdx = i;
      }
    }
    return lastResetIdx > 0 ? sorted.slice(lastResetIdx) : sorted;
  })();
  const hadQuotaReset = quota?.available === true &&
    postResetTimeSeries.length < (quota?.timeSeries.length ?? 0);

  const effectiveUsed = quota?.available ? quota.premiumUsed : stats.requestsThisCycle;
  const effectiveQuota = quota?.available ? quota.premiumEntitlement : stats.planQuota;
  const effectiveRemaining = quota?.available
    ? Math.max(0, quota.premiumRemaining)
    : stats.requestsRemaining;
  const effectiveUsagePct = effectiveQuota > 0 ? effectiveUsed / effectiveQuota : 0;

  const billedBurnInfo = (() => {
    if (!quota?.available || postResetTimeSeries.length < 2) return null;

    // postResetTimeSeries is already sorted ascending
    const end = new Date(postResetTimeSeries[postResetTimeSeries.length - 1].timestamp).getTime();
    const start = end - avgDays * 24 * 60 * 60 * 1000;
    const window = postResetTimeSeries.filter((p) => new Date(p.timestamp).getTime() >= start);
    if (window.length >= 2) {
      const first = window[0].premiumUsed;
      const last = window[window.length - 1].premiumUsed;
      const elapsedMs =
        new Date(window[window.length - 1].timestamp).getTime() -
        new Date(window[0].timestamp).getTime();
      if (elapsedMs > 0) {
        const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
        if (elapsedDays >= 1) {
          return {
            rate: Math.max(0, (last - first) / elapsedDays),
            basis: `billed recent avg (${elapsedDays.toFixed(1)}d coverage)`,
          };
        }
      }
    }

    const latest = postResetTimeSeries[postResetTimeSeries.length - 1];
    // Elapsed from the reset point (or cycle start if no reset) to now
    const epochStart = hadQuotaReset
      ? new Date(postResetTimeSeries[0].timestamp).getTime()
      : new Date(stats.cycleStart).getTime();
    const cycleElapsedMs = end - epochStart;
    if (cycleElapsedMs <= 0) return null;
    const cycleElapsedDays = cycleElapsedMs / (24 * 60 * 60 * 1000);
    if (cycleElapsedDays <= 0) return null;

    return {
      rate: Math.max(0, latest.premiumUsed / cycleElapsedDays),
      basis: `billed ${hadQuotaReset ? "post-upgrade" : "cycle"} avg (${cycleElapsedDays.toFixed(1)}d elapsed)`,
    };
  })();

  const effectiveDailyBurn = billedBurnInfo?.rate ?? stats.dailyBurnRate;
  const effectiveDailyBurnLabel = billedBurnInfo?.basis ?? `estimated avg (last ${avgDays}d)`;
  const effectiveDaysRemaining =
    effectiveRemaining > 0 && effectiveDailyBurn > 0
      ? effectiveRemaining / effectiveDailyBurn
      : null;
  const cycleEndDate = new Date(stats.cycleEnd);
  const effectiveProjectedExhaustionDate =
    effectiveRemaining <= 0
      ? new Date()
      : effectiveDaysRemaining !== null
      ? new Date(Date.now() + effectiveDaysRemaining * 24 * 60 * 60 * 1000)
      : null;
  const projectedWithinCycle =
    effectiveProjectedExhaustionDate !== null && effectiveProjectedExhaustionDate <= cycleEndDate;
  const effectiveProjectionPoints = (() => {
    if (!quota?.available || postResetTimeSeries.length === 0) {
      return stats.projectionPoints;
    }

    const toDateStr = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const addDays = (d: Date, n: number) => {
      const next = new Date(d);
      next.setDate(next.getDate() + n);
      return next;
    };

    // Build day → max premiumUsed from post-reset snapshots only.
    // Using post-reset data means the "actual" line starts from 0 after the plan
    // upgrade rather than showing the old-plan values, so the projection line
    // connects cleanly to where the actual line ends.
    const byDay = new Map<string, number>();
    for (const point of postResetTimeSeries) {
      const key = toDateStr(new Date(point.timestamp));
      const current = byDay.get(key);
      if (current === undefined || point.premiumUsed > current) {
        byDay.set(key, point.premiumUsed);
      }
    }

    const firstSnapshotDay = [...byDay.keys()].sort()[0];
    const latestSnapshotDay = [...byDay.keys()].sort().slice(-1)[0];
    // latestUsed comes from the newest post-reset snapshot — matches byDay end value.
    const latestUsed = quota.premiumUsed;
    const points: ProjectionPoint[] = [];
    let carryActual: number | null = null;

    for (let day = new Date(stats.cycleStart); day <= cycleEndDate; day = addDays(day, 1)) {
      const key = toDateStr(day);
      if (key < firstSnapshotDay) {
        points.push({ date: key, actual: null, projected: null });
        continue;
      }

      if (key <= latestSnapshotDay) {
        if (byDay.has(key)) {
          carryActual = byDay.get(key) ?? carryActual;
        }
        points.push({ date: key, actual: carryActual, projected: null });
        continue;
      }

      const daysAfterLatest =
        (new Date(key + "T00:00:00").getTime() - new Date(latestSnapshotDay + "T00:00:00").getTime()) /
        (24 * 60 * 60 * 1000);
      points.push({
        date: key,
        actual: null,
        projected: Math.round((latestUsed + effectiveDailyBurn * daysAfterLatest) * 10) / 10,
      });
    }

    return points;
  })();

  const billedCoverageDays = (() => {
    if (!quota?.available || postResetTimeSeries.length < 2) return null;
    const start = new Date(postResetTimeSeries[0].timestamp).getTime();
    const end = new Date(postResetTimeSeries[postResetTimeSeries.length - 1].timestamp).getTime();
    const elapsedDays = (end - start) / (24 * 60 * 60 * 1000);
    return elapsedDays > 0 ? elapsedDays : 0;
  })();

  // 7-day rolling from billed quota time series when available; else transcript estimate.
  const sevenDayBilledRequests = (() => {
    if (!quota?.available || postResetTimeSeries.length === 0) return null;
    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const latest = postResetTimeSeries[postResetTimeSeries.length - 1];
    const before = postResetTimeSeries.filter((p) => new Date(p.timestamp).getTime() <= sevenDaysAgoMs);
    const ref = before.length > 0 ? before[before.length - 1] : postResetTimeSeries[0];
    return Math.max(0, latest.premiumUsed - ref.premiumUsed);
  })();
  const effectiveSevenDayRequests = sevenDayBilledRequests ?? stats.sevenDayRequests;
  const sevenDaySourceLabel = sevenDayBilledRequests !== null ? "billed" : "est.";
  const effectiveSevenDayBurnRate =
    sevenDayBilledRequests !== null
      ? Math.round((sevenDayBilledRequests / 7) * 10) / 10
      : stats.sevenDayBurnRate;

  // VS Code extension is "active" when the most recent quota snapshot is under 30 min old.
  const vscodeExtActive = quota?.available === true && (quota.ageMinutes ?? 999) < 30;

  const projectionConfidenceLabel = (() => {
    if (!quota?.available) return "Transcript estimate only";
    if (billedCoverageDays === null) return "Waiting for more billed snapshots";
    if (billedCoverageDays < 0.25) return "Low confidence, less than 6h billed coverage";
    if (billedCoverageDays < 1) return "Medium confidence, less than 1 day billed coverage";
    if (billedCoverageDays < 3) return "Good confidence, early billed coverage";
    return "High confidence, multi-day billed coverage";
  })();

  const cycleStartLabel = new Date(stats.cycleStart).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const cycleEndLabel = new Date(stats.cycleEnd).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">FlightDeck</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              VS Code Copilot · {config.plan.toUpperCase()} plan ·{" "}
              Billing cycle: {cycleStartLabel} – {cycleEndLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* VS Code extension status */}
            {quota !== null && (
              <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
                vscodeExtActive
                  ? "bg-purple-50 border-purple-200 text-purple-700"
                  : "bg-gray-50 border-gray-200 text-gray-400"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  vscodeExtActive ? "bg-purple-500" : "bg-gray-300"
                }`} />
                VS Code Ext
              </div>
            )}
            {/* Proxy server status */}
            {stats && (
              <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
                stats.proxyStats.proxyActive
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-gray-50 border-gray-200 text-gray-400"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  stats.proxyStats.proxyActive ? "bg-green-500" : "bg-gray-300"
                }`} />
                Proxy
              </div>
            )}
            {/* Copilot CLI status */}
            {stats && (
              <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium ${
                stats.proxyStats.cliActive
                  ? "bg-blue-50 border-blue-200 text-blue-700"
                  : "bg-gray-50 border-gray-200 text-gray-400"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  stats.proxyStats.cliActive ? "bg-blue-500" : "bg-gray-300"
                }`} />
                Copilot CLI
              </div>
            )}
            {/* Project filter dropdown */}
            {workspaceList.length > 1 && (
              <select
                value={selectedWorkspace ?? ""}
                onChange={(e) => setSelectedWorkspace(e.target.value || null)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-300"
                title="Filter transcript metrics by project"
              >
                <option value="">All projects</option>
                {workspaceList.map((ws) => (
                  <option key={ws} value={ws}>{ws}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => {
                loadStats();
                loadSessions();
                loadQuota();
              }}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
              title="Refresh data"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
            <ConfigPanel
              config={config}
              onSaved={(c) => {
                setConfig(c);
                loadStats();
              }}
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KpiCard
            label={quota?.available ? "Premium Used This Cycle" : "Transcript Turns This Cycle"}
            value={`${effectiveUsed.toFixed(1)} / ${effectiveQuota}`}
            sub={`${(effectiveUsagePct * 100).toFixed(2)}% of quota used${quota?.available ? " (billed)" : " (estimated)"}${selectedWorkspace ? " · account-wide, not project-scoped" : ""}`}
            color="blue"
            progress={effectiveUsagePct}
          />
          <KpiCard
            label="Sessions / Avg Quality"
            value={`${stats.totalSessions}`}
            sub={
              stats.avgQuality !== null
                ? `Avg quality: ${stats.avgQuality}/5 (${stats.totalRated} rated)`
                : `${stats.totalRated} rated — start rating sessions below`
            }
            color="purple"
          />
        </div>

        {/* 7-day rolling + Context saturation KPI row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KpiCard
            label="7-Day Rolling Requests"
            value={`${effectiveSevenDayRequests}`}
            sub={`${effectiveSevenDayBurnRate}/day avg · ${sevenDaySourceLabel} · independent of billing cycle${selectedWorkspace ? " · account-wide, not project-scoped" : ""}`}
            color="green"
          />
          <KpiCard
            label="Avg Context Depth"
            value={
              stats.avgContextSaturation !== null
                ? `${(stats.avgContextSaturation * 100).toFixed(1)}%`
                : "No data"
            }
            sub={`Estimated % of 128k context window filled per session`}
            color="amber"
            progress={stats.avgContextSaturation ?? undefined}
          />
        </div>

        {/* Token accuracy + output/input ratio KPIs — shown when proxy has data */}
        {(stats.proxyStats.tokenAccuracy || stats.outputInputRatio !== null) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stats.proxyStats.tokenAccuracy && (
              <KpiCard
                label={`CLI vs VS Code Usage${selectedWorkspace ? " (account-wide)" : ""}`}
                value={`${stats.proxyStats.cliRequests} CLI · ${Math.max(0, stats.totalRequests - stats.proxyStats.cliRequests)} VS Code`}
                sub={`CLI: ${(stats.proxyStats.tokenAccuracy.exactTotalTokens / 1000).toFixed(0)}k tokens exact · VS Code: ~${(stats.proxyStats.tokenAccuracy.estimatedTotalTokens / 1000).toFixed(0)}k tokens estimated (transcript heuristic — system prompts & file context not captured, likely undercounted) · ${stats.totalRequests} total requests`}
                color="purple"
              />
            )}
            {stats.outputInputRatio !== null && (
              <KpiCard
                label={`Output / Input Ratio (CLI)${selectedWorkspace ? " (account-wide)" : ""}`}
                value={`${stats.outputInputRatio}×`}
                sub={`Completion tokens per prompt token from MITM proxy · ${fmtTokens(stats.proxyStats.modelBreakdown.reduce((s, m) => s + m.totalCompletionTokens, 0))} completion ÷ ${fmtTokens(stats.proxyStats.modelBreakdown.reduce((s, m) => s + m.totalPromptTokens, 0))} prompt`}
                color="green"
              />
            )}
          </div>
        )}

        <RoiExplorationPanel
          dailyBuckets={stats.dailyBuckets}
          quotaTimeSeries={quota?.timeSeries ?? []}
          intradayBuckets={stats.intradayBuckets}
          cycleUserTurns={stats.cycleUserTurns}
          cycleAssistantTurns={stats.cycleAssistantTurns}
          cycleToolCalls={stats.cycleToolCalls}
          cycleDurationMinutes={stats.cycleDurationMinutes}
          premiumBurnPerUserPrompt={stats.premiumBurnPerUserPrompt}
          toolOverheadRatio={stats.toolOverheadRatio}
          promptEfficiencyPer100Turns={stats.promptEfficiencyPer100Turns}
          qualityToolOverheadCorrelation={stats.qualityToolOverheadCorrelation}
          marginalQualityCurve={stats.marginalQualityCurve}
          quotaAgeMinutes={quota?.ageMinutes ?? null}
          totalRated={stats.totalRated}
          skillStats={stats.skillStats}
        />

        {/* Charts */}
        {quota?.available && (
          <QuotaChart
            timeSeries={quota.timeSeries}
            chatEntitlement={quota.chatEntitlement}
            completionsEntitlement={quota.completionsEntitlement}
            premiumEntitlement={quota.premiumEntitlement}
            ageMinutes={quota.ageMinutes}
            quotaResetDate={quota.quotaResetDate}
          />
        )}

        <ActivityTimeline
          data={stats.dailyBuckets}
          range={timeRange}
          onRangeChange={setTimeRange}
        />

        <ProjectionChart
          points={effectiveProjectionPoints}
          comparisonPoints={quota?.available ? stats.projectionPoints : undefined}
          planQuota={effectiveQuota}
          exhaustionDate={projectedWithinCycle && effectiveProjectedExhaustionDate
            ? (() => {
                const year = effectiveProjectedExhaustionDate.getFullYear();
                const month = String(effectiveProjectedExhaustionDate.getMonth() + 1).padStart(2, "0");
                const day = String(effectiveProjectedExhaustionDate.getDate()).padStart(2, "0");
                return `${year}-${month}-${day}`;
              })()
            : null}
          dailyBurnRate={effectiveDailyBurn}
          avgDays={avgDays}
          onAvgDaysChange={setAvgDays}
          sourceLabel={quota?.available ? "Billed premium usage" : "Transcript-estimated turns"}
          coverageDays={billedCoverageDays}
          confidenceLabel={projectionConfidenceLabel}
        />

        <ToolBreakdown topTools={stats.topTools} skillStats={stats.skillStats} />

        <TokenVolumeChart
          dailyBuckets={stats.dailyBuckets}
          topWorkspacesByTokens={stats.topWorkspacesByTokens}
        />

        {/* Tool latency table */}
        {stats.toolLatencies.length > 0 && (
          <div className="rounded-lg bg-white border border-gray-200 p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Tool Latency</h2>
            <p className="text-xs text-gray-500 mb-4">
              Execution time per tool call — P50 / P95 across all recorded sessions
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                    <th className="pb-2 pr-4">Tool</th>
                    <th className="pb-2 pr-4 text-right">Calls</th>
                    <th className="pb-2 pr-4 text-right">Avg</th>
                    <th className="pb-2 pr-4 text-right">P50</th>
                    <th className="pb-2 text-right">P95</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stats.toolLatencies.map((t) => (
                    <tr key={t.name} className="hover:bg-gray-50">
                      <td className="py-1.5 pr-4 font-mono text-xs text-gray-700">{t.name}</td>
                      <td className="py-1.5 pr-4 text-right text-gray-500">{t.count}</td>
                      <td className="py-1.5 pr-4 text-right text-gray-500">{t.avgMs}ms</td>
                      <td className="py-1.5 pr-4 text-right text-gray-700">{t.p50Ms}ms</td>
                      <td className={`py-1.5 text-right font-medium ${
                        t.p95Ms > 10000 ? "text-red-600" : t.p95Ms > 5000 ? "text-amber-600" : "text-gray-700"
                      }`}>
                        {t.p95Ms}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CLI Activity panel — shown when proxy is set up (any data ever recorded) */}
        {stats.proxyStats.totalRequests > 0 && (
          <div className="rounded-lg bg-white border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold text-gray-900">Proxy Capture</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                stats.proxyStats.proxyActive
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-gray-50 border-gray-200 text-gray-400"
              }`}>
                {stats.proxyStats.proxyActive ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              {stats.proxyStats.totalRequests} total requests intercepted
              {stats.proxyStats.lastCapturedAt && (
                <> · last at {new Date(stats.proxyStats.lastCapturedAt).toLocaleString()}</>
              )}
            </p>

            {/* Model breakdown */}
            {stats.proxyStats.modelBreakdown.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                      <th className="pb-2 pr-4">Model</th>
                      <th className="pb-2 pr-4 text-right">Requests</th>
                      <th className="pb-2 pr-4 text-right">% of Total</th>
                      <th className="pb-2 pr-4 text-right">Prompt Tokens</th>
                      <th className="pb-2 pr-4 text-right">Completion Tokens</th>
                      <th className="pb-2 text-right">Avg Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {stats.proxyStats.modelBreakdown.map((m) => (
                      <tr key={m.model} className="hover:bg-gray-50">
                        <td className="py-1.5 pr-4 font-mono text-xs text-gray-700">{m.model}</td>
                        <td className="py-1.5 pr-4 text-right text-gray-500">{m.count}</td>
                        <td className="py-1.5 pr-4 text-right text-gray-500">
                          {Math.round((m.count / Math.max(1, stats.proxyStats.totalRequests)) * 100)}%
                        </td>
                        <td className="py-1.5 pr-4 text-right text-gray-500">
                          {m.totalPromptTokens > 0 ? fmtTokens(m.totalPromptTokens) : "—"}
                        </td>
                        <td className="py-1.5 pr-4 text-right text-gray-500">
                          {m.totalCompletionTokens > 0 ? fmtTokens(m.totalCompletionTokens) : "—"}
                        </td>
                        <td className="py-1.5 text-right text-gray-700">{m.avgLatencyMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Proxy setup prompt — shown when proxy not yet configured */}
        {stats.proxyStats.totalRequests === 0 && (
          <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-5">
            <h2 className="text-sm font-semibold text-gray-600 mb-1">MITM Proxy — not set up</h2>
            <p className="text-xs text-gray-500">
              Run <code className="bg-white px-1 py-0.5 rounded border text-xs">scripts\Start-CopilotProxy.ps1</code> to
              capture exact token counts and track Copilot CLI (including multi-agent) requests.
              CLI sessions are invisible without the proxy.
            </p>
          </div>
        )}

        {/* Session list with quality ratings */}
        <SessionList
          sessions={selectedWorkspace ? sessions.filter((s) => s.workspaceName === selectedWorkspace) : sessions}
          onRated={() => {
            loadSessions();
            loadStats();
          }}
        />
      </main>
    </div>
  );
}

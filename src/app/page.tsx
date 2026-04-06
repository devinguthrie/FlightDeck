"use client";

import { useCallback, useEffect, useState } from "react";
import ActivityTimeline from "@/components/ActivityTimeline";
import ProjectionChart from "@/components/ProjectionChart";
import QuotaChart from "@/components/QuotaChart";
import RoiExplorationPanel from "@/components/RoiExplorationPanel";
import ToolBreakdown from "@/components/ToolBreakdown";
import SessionList from "@/components/SessionList";
import ConfigPanel from "@/components/ConfigPanel";
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

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/stats?avgDays=${avgDays}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      setStats((await res.json()) as StatsData);
    } catch (e) {
      setError(String(e));
    }
  }, [avgDays]);

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

  // Reload stats when avgDays changes
  useEffect(() => {
    if (!loading) loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avgDays]);

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

  const effectiveUsed = quota?.available ? quota.premiumUsed : stats.requestsThisCycle;
  const effectiveQuota = quota?.available ? quota.premiumEntitlement : stats.planQuota;
  const effectiveRemaining = quota?.available
    ? Math.max(0, quota.premiumRemaining)
    : stats.requestsRemaining;
  const effectiveUsagePct = effectiveQuota > 0 ? effectiveUsed / effectiveQuota : 0;

  const billedBurnInfo = (() => {
    if (!quota?.available || quota.timeSeries.length < 2) return null;

    const sorted = [...quota.timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const end = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const start = end - avgDays * 24 * 60 * 60 * 1000;
    const window = sorted.filter((p) => new Date(p.timestamp).getTime() >= start);
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

    const latest = sorted[sorted.length - 1];
    const cycleElapsedMs = end - new Date(stats.cycleStart).getTime();
    if (cycleElapsedMs <= 0) return null;
    const cycleElapsedDays = cycleElapsedMs / (24 * 60 * 60 * 1000);
    if (cycleElapsedDays <= 0) return null;

    return {
      rate: Math.max(0, latest.premiumUsed / cycleElapsedDays),
      basis: `billed cycle avg (${cycleElapsedDays.toFixed(1)}d elapsed)`,
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
    if (!quota?.available || quota.timeSeries.length === 0) {
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

    const byDay = new Map<string, number>();
    for (const point of [...quota.timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
      const key = toDateStr(new Date(point.timestamp));
      const current = byDay.get(key);
      if (current === undefined || point.premiumUsed > current) {
        byDay.set(key, point.premiumUsed);
      }
    }

    const firstSnapshotDay = [...byDay.keys()].sort()[0];
    const latestSnapshotDay = [...byDay.keys()].sort().slice(-1)[0];
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
    if (!quota?.available || quota.timeSeries.length < 2) return null;
    const sorted = [...quota.timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const start = new Date(sorted[0].timestamp).getTime();
    const end = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const elapsedDays = (end - start) / (24 * 60 * 60 * 1000);
    return elapsedDays > 0 ? elapsedDays : 0;
  })();

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
          <div className="flex items-center gap-3">
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
            sub={`${(effectiveUsagePct * 100).toFixed(0)}% of quota used${quota?.available ? " (billed)" : " (estimated)"}`}
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

        <RoiExplorationPanel
          dailyBuckets={stats.dailyBuckets}
          intradayBuckets={stats.intradayBuckets}
          quotaTimeSeries={quota?.timeSeries ?? []}
          cycleUserTurns={stats.cycleUserTurns}
          cycleAssistantTurns={stats.cycleAssistantTurns}
          cycleToolCalls={stats.cycleToolCalls}
          cycleDurationMinutes={stats.cycleDurationMinutes}
          premiumBurnPerUserPrompt={stats.premiumBurnPerUserPrompt}
          requestDensityPerMinute={stats.requestDensityPerMinute}
          toolOverheadRatio={stats.toolOverheadRatio}
          promptEfficiencyPer100Turns={stats.promptEfficiencyPer100Turns}
          qualityToolOverheadCorrelation={stats.qualityToolOverheadCorrelation}
          marginalQualityCurve={stats.marginalQualityCurve}
          quotaAgeMinutes={quota?.ageMinutes ?? null}
          totalRated={stats.totalRated}
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

        {/* Session list with quality ratings */}
        <SessionList
          sessions={sessions}
          onRated={() => {
            loadSessions();
            loadStats();
          }}
        />
      </main>
    </div>
  );
}

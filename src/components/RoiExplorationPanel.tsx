"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
} from "recharts";

interface DailyBucket {
  date: string;
  requests: number;
  sessions: number;
  skills: string[];
}

interface QuotaDataPoint {
  timestamp: string;
  premiumUsed: number;
}

interface MarginalQualityBucket {
  bucket: string;
  sessions: number;
  avgQuality: number | null;
  avgRequests: number;
}

interface SkillStat {
  name: string;
  sessions: number;
  avgRequests: number;
  avgQuality: number | null;
  sampleSize: number;
  qualityPer100Req: number | null;
  liftVsBaseline: number | null;
}

interface Props {
  dailyBuckets: DailyBucket[];
  quotaTimeSeries: QuotaDataPoint[];
  intradayBuckets: Array<{ hour: string; transcriptTurns: number; toolCalls: number }>;
  cycleUserTurns: number;
  cycleAssistantTurns: number;
  cycleToolCalls: number;
  cycleDurationMinutes: number;
  premiumBurnPerUserPrompt: number | null;
  toolOverheadRatio: number;
  promptEfficiencyPer100Turns: number | null;
  qualityToolOverheadCorrelation: number | null;
  marginalQualityCurve: MarginalQualityBucket[];
  quotaAgeMinutes: number | null;
  totalRated: number;
  skillStats: SkillStat[];
}

function trustScoreFromAge(ageMinutes: number | null): number {
  if (ageMinutes === null) return 0;
  if (ageMinutes <= 10) return 100;
  if (ageMinutes >= 24 * 60) return 0;
  const pct = 100 - ((ageMinutes - 10) / (24 * 60 - 10)) * 100;
  return Math.max(0, Math.round(pct));
}

function toDayKey(ts: string): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toHourKey(ts: string): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:00`;
}

function fmtHourLabel(key: string): string {
  const today = toDayKey(new Date().toISOString());
  const keyDate = key.slice(0, 10);
  const time = key.slice(11, 16);
  if (keyDate === today) return time;
  const d = new Date(keyDate + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + time;
}

function fmtDay(day: string): string {
  const d = new Date(day + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildPremiumDailyDeltas(timeSeries: QuotaDataPoint[]): Record<string, number> {
  if (timeSeries.length < 2) return {};

  const sorted = [...timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byDay = new Map<string, { first: number; last: number }>();

  for (const p of sorted) {
    const day = toDayKey(p.timestamp);
    const cur = byDay.get(day);
    if (!cur) {
      byDay.set(day, { first: p.premiumUsed, last: p.premiumUsed });
    } else {
      byDay.set(day, { first: cur.first, last: p.premiumUsed });
    }
  }

  const out: Record<string, number> = {};
  for (const [day, v] of byDay.entries()) {
    out[day] = Math.max(0, v.last - v.first);
  }
  return out;
}

function buildPremiumHourlyDeltas(timeSeries: QuotaDataPoint[]): Record<string, number> {
  if (timeSeries.length < 2) return {};

  const sorted = [...timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byHour = new Map<string, { first: number; last: number }>();

  for (const p of sorted) {
    const key = toHourKey(p.timestamp);
    const cur = byHour.get(key);
    if (!cur) {
      byHour.set(key, { first: p.premiumUsed, last: p.premiumUsed });
    } else {
      byHour.set(key, { first: cur.first, last: p.premiumUsed });
    }
  }

  const out: Record<string, number> = {};
  for (const [key, v] of byHour.entries()) {
    out[key] = Math.max(0, v.last - v.first);
  }
  return out;
}

function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1).filter((v): v is number => v !== null);
    return slice.length > 0 ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

type TimeWindow = "3h" | "12h" | "24h" | "7d" | "14d" | "30d";
const WIN_LABELS: TimeWindow[] = ["3h", "12h", "24h", "7d", "14d", "30d"];
function windowToHours(w: TimeWindow): number {
  const map: Record<TimeWindow, number> = { "3h": 3, "12h": 12, "24h": 24, "7d": 168, "14d": 336, "30d": 720 };
  return map[w];
}
function windowToDays(w: TimeWindow): number | null {
  const map: Partial<Record<TimeWindow, number>> = { "7d": 7, "14d": 14, "30d": 30 };
  return map[w] ?? null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoiExplorationPanel({
  dailyBuckets,
  quotaTimeSeries,
  intradayBuckets,
  cycleUserTurns,
  cycleAssistantTurns,
  cycleToolCalls,
  cycleDurationMinutes,
  premiumBurnPerUserPrompt,
  toolOverheadRatio,
  promptEfficiencyPer100Turns,
  qualityToolOverheadCorrelation,
  marginalQualityCurve,
  quotaAgeMinutes,
  totalRated,
  skillStats,
}: Props) {
  const trustScore = trustScoreFromAge(quotaAgeMinutes);
  const latestBilledPremium =
    quotaTimeSeries.length > 0
      ? quotaTimeSeries[quotaTimeSeries.length - 1].premiumUsed
      : null;
  const cycleTurnsPerPremium =
    latestBilledPremium !== null && latestBilledPremium > 0
      ? cycleAssistantTurns / latestBilledPremium
      : null;

  // ─── 30-day efficiency trend with 7d MA ───────────────────────────────────
  const premiumTrend = useMemo(() => {
    const premiumDaily = buildPremiumDailyDeltas(quotaTimeSeries);
    const rows = dailyBuckets
      .slice(-30)
      .map((d) => {
        const billedPremium = premiumDaily[d.date] ?? null;
        const turnsPerPremium =
          billedPremium && billedPremium > 0 ? d.requests / billedPremium : null;
        return {
          date: d.date,
          label: fmtDay(d.date),
          transcriptTurns: d.requests,
          billedPremium,
          turnsPerPremium,
          sessions: d.sessions,
          skills: d.skills,
        };
      })
      .filter((d) => d.transcriptTurns > 0 || d.billedPremium !== null);

    const maValues = movingAverage(rows.map((r) => r.turnsPerPremium), 7);
    return rows.map((r, i) => ({ ...r, ma7: maValues[i] }));
  }, [dailyBuckets, quotaTimeSeries]);

  // ─── 7d vs prev-7d comparison ─────────────────────────────────────────────
  const { recent7avg, prev7avg } = useMemo(() => {
    const withRatio = premiumTrend.filter((d) => d.turnsPerPremium !== null);
    const last7 = withRatio.slice(-7);
    const prev7 = withRatio.slice(-14, -7);
    const avg = (arr: typeof last7) =>
      arr.length > 0
        ? arr.reduce((s, d) => s + (d.turnsPerPremium ?? 0), 0) / arr.length
        : null;
    return { recent7avg: avg(last7), prev7avg: avg(prev7) };
  }, [premiumTrend]);

  // ─── Best ratio days ───────────────────────────────────────────────────────
  const bestDays = useMemo(
    () =>
      [...premiumTrend]
        .filter((d) => d.turnsPerPremium !== null)
        .sort((a, b) => (b.turnsPerPremium ?? 0) - (a.turnsPerPremium ?? 0))
        .slice(0, 5),
    [premiumTrend]
  );

  // ─── Session depth vs efficiency ──────────────────────────────────────────
  const depthEfficiency = useMemo(() => {
    const buckets = [
      { label: "1–10 req/session", min: 1, max: 10 },
      { label: "11–30 req/session", min: 11, max: 30 },
      { label: "31–60 req/session", min: 31, max: 60 },
      { label: "61+ req/session", min: 61, max: Infinity },
    ];
    return buckets.map((b) => {
      const days = premiumTrend.filter((d) => {
        if (d.sessions === 0 || d.turnsPerPremium === null) return false;
        const avgDepth = d.transcriptTurns / d.sessions;
        return avgDepth >= b.min && avgDepth <= b.max;
      });
      const avgRatio =
        days.length > 0
          ? days.reduce((s, d) => s + (d.turnsPerPremium ?? 0), 0) / days.length
          : null;
      return { bucket: b.label, days: days.length, avgTurnsPerPremium: avgRatio };
    });
  }, [premiumTrend]);

  // ─── High-efficiency skill frequency ──────────────────────────────────────
  const skillEfficiencyInsight = useMemo(() => {
    const withRatio = premiumTrend.filter((d) => d.turnsPerPremium !== null);
    if (withRatio.length < 6) return null;

    const sorted = [...withRatio].sort(
      (a, b) => (b.turnsPerPremium ?? 0) - (a.turnsPerPremium ?? 0)
    );
    const topN = Math.max(3, Math.ceil(sorted.length * 0.33));
    const bottomN = topN;
    const topDays = sorted.slice(0, topN);
    const bottomDays = sorted.slice(-bottomN);

    const freq = (days: typeof topDays) => {
      const counts: Record<string, number> = {};
      for (const d of days) {
        for (const s of d.skills) {
          counts[s] = (counts[s] ?? 0) + 1;
        }
      }
      return counts;
    };

    const topFreq = freq(topDays);
    const bottomFreq = freq(bottomDays);
    const allSkills = new Set([...Object.keys(topFreq), ...Object.keys(bottomFreq)]);
    const lifts = [...allSkills]
      .map((skill) => {
        const topRate = (topFreq[skill] ?? 0) / topN;
        const botRate = (bottomFreq[skill] ?? 0) / bottomN;
        return { skill, topRate, botRate, lift: topRate - botRate };
      })
      .filter((s) => s.topRate >= 0.2)
      .sort((a, b) => b.lift - a.lift);

    return lifts.length > 0 ? lifts.slice(0, 3) : null;
  }, [premiumTrend]);

  // ─── All premium snapshots (full history, windowed in intradaySlice) ────────────────────
  const intradaySnapshots = useMemo(() => {
    const sorted = [...quotaTimeSeries].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );
    return sorted.map((p, i) => ({
      time: fmtTime(p.timestamp),
      premiumUsed: p.premiumUsed,
      ts: p.timestamp,
      delta: i === 0 ? null : Math.max(0, p.premiumUsed - sorted[i - 1].premiumUsed),
    }));
  }, [quotaTimeSeries]);

  // ─── Today's gap stats (always based on last 24h of snapshots) ────────────────────
  const todayStats = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayBucket = dailyBuckets.find((d) => d.date === todayKey) ?? null;
    const todayTurns = todayBucket?.requests ?? null;
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    const last24h = intradaySnapshots.filter(
      (p) => new Date(p.ts).getTime() >= cutoff24h
    );
    const first = last24h[0]?.premiumUsed ?? null;
    const last =
      last24h.length > 1 ? last24h[last24h.length - 1].premiumUsed : null;
    const todayPremiumDelta =
      first !== null && last !== null ? Math.max(0, last - first) : null;
    const todayRatio =
      todayTurns !== null && todayPremiumDelta !== null && todayPremiumDelta > 0
        ? todayTurns / todayPremiumDelta
        : null;
    return { todayTurns, todayPremiumDelta, todayRatio };
  }, [dailyBuckets, intradaySnapshots]);

  // ─── Top skills by quality efficiency ─────────────────────────────────────
  const topSkillsByEfficiency = useMemo(
    () =>
      [...skillStats]
        .filter((s) => s.qualityPer100Req !== null && s.sampleSize >= 2)
        .sort((a, b) => (b.qualityPer100Req ?? 0) - (a.qualityPer100Req ?? 0))
        .slice(0, 4),
    [skillStats]
  );

  const [trendWindow, setTrendWindow] = useState<TimeWindow>("30d");
  const [intradayWindow, setIntradayWindow] = useState<TimeWindow>("24h");

  const trendSlice = useMemo(
    () => premiumTrend.slice(-( windowToDays(trendWindow) ?? 7)),
    [premiumTrend, trendWindow]
  );

  // ─── Hourly turns/premium trend (for sub-day windows) ─────────────────────
  const hourlyTrend = useMemo(() => {
    const premiumByHour = buildPremiumHourlyDeltas(quotaTimeSeries);
    return intradayBuckets.map((bucket) => {
      const billedPremium = premiumByHour[bucket.hour] ?? null;
      const turnsPerPremium =
        billedPremium && billedPremium > 0 ? bucket.transcriptTurns / billedPremium : null;
      return {
        ...bucket,
        label: fmtHourLabel(bucket.hour),
        billedPremium,
        turnsPerPremium,
      };
    });
  }, [quotaTimeSeries, intradayBuckets]);

  const hourlyTrendSlice = useMemo(() => {
    const hours = windowToHours(trendWindow);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return hourlyTrend.filter((r) => new Date(r.hour).getTime() >= cutoff);
  }, [hourlyTrend, trendWindow]);

  const intradaySlice = useMemo(() => {
    const cutoffMs = windowToHours(intradayWindow) * 60 * 60 * 1000;
    const cutoff = Date.now() - cutoffMs;
    const filtered = intradaySnapshots.filter(
      (p) => new Date(p.ts).getTime() >= cutoff
    );
    return filtered.map((p, i) => ({
      ...p,
      delta:
        i === 0
          ? null
          : Math.max(0, p.premiumUsed - filtered[i - 1].premiumUsed),
    }));
  }, [intradaySnapshots, intradayWindow]);

  const correlationLabel =
    qualityToolOverheadCorrelation === null
      ? "Not enough rated sessions"
      : qualityToolOverheadCorrelation > 0.2
      ? "Higher tool overhead correlates with better quality"
      : qualityToolOverheadCorrelation < -0.2
      ? "Higher tool overhead correlates with lower quality"
      : "Tool overhead has weak quality relationship";

  const trendPct =
    recent7avg !== null && prev7avg !== null && prev7avg > 0
      ? ((recent7avg - prev7avg) / prev7avg) * 100
      : null;

  return (
    <div className="rounded-lg bg-white border border-gray-200 p-5 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">ROI Exploration</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Transcript turns per billed premium — find what makes the lines diverge
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-800">Live now:</span> premium burn, work depth, quota trust, and trend analysis.
        {totalRated === 0 ? (
          <span> Quality-based ROI is waiting on your first session ratings.</span>
        ) : (
          <span> Quality ROI active from {totalRated} rated session{totalRated === 1 ? "" : "s"}.</span>
        )}
      </div>

      {/* Core metric row */}
      <div>
        <p className="px-1 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Key metrics</p>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <Metric
            label="Turns / Premium (Cycle)"
            value={cycleTurnsPerPremium !== null ? cycleTurnsPerPremium.toFixed(2) : "-"}
            sub="transcript turns per billed unit"
            highlight
          />
          <Metric
            label="Last 7 days avg"
            value={recent7avg !== null ? recent7avg.toFixed(2) : "-"}
            sub={
              trendPct !== null
                ? `${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(0)}% vs prev 7d`
                : "not enough overlap data"
            }
            trend={trendPct}
          />
          <Metric
            label="Transcript Turns (Cycle)"
            value={cycleAssistantTurns.toLocaleString()}
            sub="assistant.turn_start count"
          />
          <Metric
            label="Billed Premium (Cycle)"
            value={latestBilledPremium !== null ? latestBilledPremium.toFixed(1) : "-"}
            sub="GitHub quota snapshot cumulative"
          />
        </div>
      </div>
      <div>
        <p className="px-1 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Cost &amp; efficiency signals</p>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <Metric
            label="Premium / User Prompt"
            value={premiumBurnPerUserPrompt !== null ? premiumBurnPerUserPrompt.toFixed(3) : "-"}
            sub="billed premium per user turn"
          />
          <Metric
            label="Work Depth per Turn"
            value={toolOverheadRatio.toFixed(3)}
            sub="tool calls per assistant turn"
          />
          <Metric
            label="Prompt Efficiency"
            value={promptEfficiencyPer100Turns !== null ? promptEfficiencyPer100Turns.toFixed(2) : "-"}
            sub="quality pts per 100 user turns"
          />
          <Metric
            label="Quota Trust"
            value={`${trustScore}%`}
            sub={quotaAgeMinutes !== null ? `snapshot age ${quotaAgeMinutes}m` : "no live quota snapshot"}
          />
        </div>
      </div>

      {/* Best ratio days callout */}
      {bestDays.length > 0 && (
        <div className="border border-purple-100 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-2">
            Your best efficiency days — what to replicate
          </p>
          <div className="space-y-1">
            {bestDays.map((d) => (
              <div key={d.date} className="flex items-center gap-3 text-xs text-purple-900">
                <span className="w-16 shrink-0 font-medium">{d.label}</span>
                <span className="font-bold text-purple-700">{d.turnsPerPremium?.toFixed(2)}x</span>
                <span className="text-purple-500">
                  {d.transcriptTurns} transcript · {d.billedPremium?.toFixed(1)} billed
                  {d.skills.length > 0 && (
                    <span className="ml-1 text-purple-400">· {d.skills.join(", ")}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skill insight cards */}
      {((skillEfficiencyInsight && skillEfficiencyInsight.length > 0) ||
        topSkillsByEfficiency.length > 0) && (
        <details open className="border border-gray-100 rounded-lg">
          <summary className="px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none uppercase tracking-wide">
            Skill analysis
          </summary>
          <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-4">
          {skillEfficiencyInsight && skillEfficiencyInsight.length > 0 && (
            <div className="border border-green-100 rounded-lg bg-green-50 px-4 py-3">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">
                Skills driving high efficiency days
              </p>
              <div className="space-y-1">
                {skillEfficiencyInsight.map((s) => (
                  <div key={s.skill} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-green-900">{s.skill}</span>
                    <span className="text-green-600">
                      {(s.topRate * 100).toFixed(0)}% of top days
                      {s.botRate > 0 && (
                        <span className="text-green-400 ml-1">
                          vs {(s.botRate * 100).toFixed(0)}% of low days
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-green-500 mt-2">
                These skills appear most often on your highest turns/premium days.
              </p>
            </div>
          )}

          {topSkillsByEfficiency.length > 0 && (
            <div className="border border-blue-100 rounded-lg bg-blue-50 px-4 py-3">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">
                Best quality per request (rated sessions)
              </p>
              <div className="space-y-1">
                {topSkillsByEfficiency.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-blue-900">{s.name}</span>
                    <span className="text-blue-600">
                      {s.qualityPer100Req?.toFixed(1)} q/100req
                      <span className="text-blue-400 ml-1">({s.sampleSize} rated)</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-blue-500 mt-2">
                Most output quality per premium request.
              </p>
            </div>
          )}
        </div>
        </details>
      )}

      {/* Live intraday premium burn — collapsible */}
      <details className="border border-gray-100 rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none uppercase tracking-wide">
          Premium calls today (live)
          <span className="ml-2 text-[11px] text-gray-400 font-normal normal-case tracking-normal">
            {intradaySlice.length > 0
              ? `· ${intradaySlice.length} snapshots · last ${intradayWindow}`
              : `· no snapshots in last ${intradayWindow}`}
          </span>
        </summary>
        <div className="p-3 space-y-3">
          {/* Window buttons + gap summary cards */}
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-gray-400">Window</p>
            <div className="flex gap-1">
              {WIN_LABELS.map((w) => (
                <button
                  key={w}
                  onClick={() => setIntradayWindow(w)}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    intradayWindow === w
                      ? "bg-green-600 text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded border border-gray-100 px-2.5 py-2 bg-white">
              <p className="text-[11px] text-gray-500">Transcript turns today</p>
              <p className="font-semibold text-gray-800">
                {todayStats.todayTurns !== null ? todayStats.todayTurns.toLocaleString() : "—"}
              </p>
            </div>
            <div className="rounded border border-gray-100 px-2.5 py-2 bg-white">
              <p className="text-[11px] text-gray-500">Premium burned ({intradayWindow})</p>
              <p className="font-semibold text-gray-800">
                {intradaySlice.length >= 2
                  ? Math.max(0, intradaySlice[intradaySlice.length - 1].premiumUsed - intradaySlice[0].premiumUsed).toFixed(2)
                  : "—"}
              </p>
            </div>
            <div className="rounded border border-purple-100 px-2.5 py-2 bg-purple-50">
              <p className="text-[11px] text-purple-600">Turns / Premium today</p>
              <p className="font-semibold text-purple-800">
                {todayStats.todayRatio !== null ? `${todayStats.todayRatio.toFixed(1)}×` : "—"}
              </p>
            </div>
          </div>
          {/* Snapshot chart */}
          {intradaySlice.length < 2 ? (
            <p className="text-xs text-gray-400 py-6 text-center">
              No snapshots in this window — try a wider range.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={intradaySlice} margin={{ top: 2, right: 40, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis yAxisId="cumul" tick={{ fontSize: 11, fill: "#10b981" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="delta" orientation="right" tick={{ fontSize: 11, fill: "#f59e0b" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                  formatter={(value: unknown, name: string) => {
                    const num = Number(value);
                    const lbl = name === "premiumUsed" ? "Premium (cumulative)" : "Burn per interval";
                    return [Number.isFinite(num) ? num.toFixed(2) : "-", lbl] as [string, string];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(v) => (v === "premiumUsed" ? "Premium (cumulative)" : "Burn per interval")}
                />
                <Line yAxisId="cumul" type="monotone" dataKey="premiumUsed" stroke="#10b981" strokeWidth={2} dot={false} connectNulls={false} />
                <Line yAxisId="delta" type="monotone" dataKey="delta" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls={false} strokeDasharray="3 2" />
              </LineChart>
            </ResponsiveContainer>
          )}
          <p className="text-[11px] text-gray-400">
            Green = cumulative premium level · amber dashed = burn per snapshot interval. Flat green = efficient session.
          </p>
        </div>
      </details>

      {/* Charts */}
      <details open className="border border-gray-100 rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none uppercase tracking-wide">
          Premium efficiency trend
        </summary>
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Premium efficiency trend ({trendWindow})
            </p>
            <div className="flex gap-1">
              {WIN_LABELS.map((w) => (
                <button
                  key={w}
                  onClick={() => setTrendWindow(w)}
                  className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                    trendWindow === w
                      ? "bg-purple-600 text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          {windowToDays(trendWindow) === null ? (
            /* Sub-day mode: transcript-driven hourly turns/premium */
            hourlyTrendSlice.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">
                No hourly data in the last {trendWindow}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={hourlyTrendSlice} margin={{ top: 2, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                    formatter={(value: unknown, name: string) => {
                      if (value === null || value === undefined) return ["-", name];
                      const num = Number(value);
                      return [Number.isFinite(num) ? num.toFixed(2) : "-", name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="transcriptTurns" name="Transcript Turns" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="billedPremium" name="Billed Premium" stroke="#10b981" strokeWidth={2} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="turnsPerPremium" name="Turns per Premium" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            )
          ) : premiumTrend.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">
              No quota + transcript overlap yet
            </p>
          ) : premiumTrend.filter((d) => d.turnsPerPremium !== null).length < 2 ? (
            <div className="py-8 text-center space-y-1">
              <p className="text-sm text-gray-600">Only one overlap day so far</p>
              <p className="text-xs text-gray-400">
                The trend becomes meaningful with 2+ days of billed snapshots.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendSlice} margin={{ top: 2, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                  formatter={(value: unknown, name: string) => {
                    if (value === null || value === undefined) return ["-", name];
                    const num = Number(value);
                    const lbl =
                      name === "turnsPerPremium"
                        ? "Turns/Premium"
                        : name === "ma7"
                        ? "7d MA"
                        : name === "transcriptTurns"
                        ? "Transcript Turns"
                        : name === "billedPremium"
                        ? "Billed Premium"
                        : name;
                    return [Number.isFinite(num) ? num.toFixed(2) : "-", lbl];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(v) =>
                    v === "turnsPerPremium"
                      ? "Turns/Premium"
                      : v === "ma7"
                      ? "7d MA"
                      : v === "transcriptTurns"
                      ? "Transcript Turns"
                      : v === "billedPremium"
                      ? "Billed Premium"
                      : v
                  }
                />
                <Line type="monotone" dataKey="transcriptTurns" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="billedPremium" stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="turnsPerPremium" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="ma7" stroke="#7c3aed" strokeWidth={1} dot={false} connectNulls={false} strokeDasharray="2 2" opacity={0.6} />
              </LineChart>
            </ResponsiveContainer>
          )}
          <p className="text-[11px] text-gray-400 mt-1">
            {windowToDays(trendWindow) === null
              ? "Purple = turns/premium · blue = transcript turns · green = billed premium (hourly)"
              : "Purple solid = turns/premium · dashed = 7d MA · blue/green = raw components"}
          </p>
        </div>
      </details>

      <details open className="border border-gray-100 rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none uppercase tracking-wide">
          Session depth vs efficiency
        </summary>
        <div className="p-3">
          {depthEfficiency.every((b) => b.days === 0) ? (
            <p className="text-xs text-gray-400 py-8 text-center">
              Not enough overlap data yet
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={depthEfficiency} margin={{ top: 2, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                  formatter={(value: unknown, name: string) => {
                    if (name === "avgTurnsPerPremium") {
                      const num = Number(value);
                      return [Number.isFinite(num) ? num.toFixed(2) : "-", "Avg Turns/Premium"] as [string, string];
                    }
                    if (name === "days") return [String(value ?? ""), "Days in bucket"] as [string, string];
                    return [String(value ?? ""), name] as [string, string];
                  }}
                />
                <Bar dataKey="avgTurnsPerPremium" name="avgTurnsPerPremium" fill="#7c3aed" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="text-[11px] text-gray-500 mt-1">
            Avg requests per session bucketed. Taller = better turns/premium ratio on those days.
          </p>
        </div>
      </details>

      {/* Quality analysis — collapsed */}
      <details className="border border-gray-100 rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none uppercase tracking-wide">
          Quality analysis (marginal returns + correlation)
        </summary>
        <div className="p-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Marginal quality gain curve
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={marginalQualityCurve} margin={{ top: 2, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(value: number, name: string) => {
                  if (name === "avgQuality") return [value?.toFixed(2), "Avg Quality"];
                  if (name === "sessions") return [value, "Rated Sessions"];
                  return [value, name];
                }}
              />
              <Bar dataKey="avgQuality" name="avgQuality" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-gray-500 mt-1">
            {correlationLabel}
            {qualityToolOverheadCorrelation !== null && (
              <span className="ml-1">(corr={qualityToolOverheadCorrelation.toFixed(3)})</span>
            )}
          </p>
          {marginalQualityCurve.every((b) => b.sessions === 0) && (
            <p className="text-[11px] text-gray-400 mt-1">Rate sessions to activate quality metrics.</p>
          )}
        </div>
      </details>

      {/* Raw cycle stats — collapsed */}
      <details className="border border-gray-100 rounded-lg">
        <summary className="px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer select-none uppercase tracking-wide">
          Raw cycle stats
        </summary>
        <div className="p-3 grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatRow label="Cycle user turns" value={cycleUserTurns.toLocaleString()} />
          <StatRow label="Cycle assistant turns" value={cycleAssistantTurns.toLocaleString()} />
          <StatRow label="Cycle tool calls" value={cycleToolCalls.toLocaleString()} />
          <StatRow label="Cycle minutes" value={cycleDurationMinutes.toFixed(1)} />
        </div>
      </details>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Metric({
  label,
  value,
  sub,
  highlight,
  trend,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  trend?: number | null;
}) {
  const trendColor =
    trend == null
      ? ""
      : trend > 0
      ? "text-emerald-600"
      : trend < 0
      ? "text-red-500"
      : "text-gray-500";

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        highlight ? "border-purple-200 bg-purple-50" : "border-gray-200 bg-gray-50"
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={`text-lg font-semibold leading-none mt-1 ${
          highlight ? "text-purple-700" : "text-gray-900"
        }`}
      >
        {value}
      </p>
      <p className={`text-[11px] mt-1 ${trend != null ? trendColor : "text-gray-500"}`}>
        {sub}
      </p>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-100 px-2.5 py-2 bg-white">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="font-semibold text-gray-800">{value}</p>
    </div>
  );
}

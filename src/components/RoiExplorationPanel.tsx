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
  ReferenceLine,
} from "recharts";

interface DailyBucket {
  date: string;
  requests: number;
  sessions: number;
  skills: string[];
}

interface QuotaDataPoint {
  timestamp: string;
  chatUsed: number;
  completionsUsed: number;
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
  chatEntitlement: number | null;
  completionsEntitlement: number | null;
  premiumEntitlement: number | null;
  quotaResetDate: string | null;
  intradayBuckets: Array<{ hour: string; transcriptTurns: number; toolCalls: number }>;
  cycleUserTurns: number;
  cycleAssistantTurns: number;
  cycleToolCalls: number;
  cycleDurationMinutes: number;
  cycleActiveMinutes: number;
  premiumBurnPerUserPrompt: number | null;
  toolOverheadRatio: number;
  promptEfficiencyPer100Turns: number | null;
  qualityToolOverheadCorrelation: number | null;
  marginalQualityCurve: MarginalQualityBucket[];
  quotaAgeMinutes: number | null;
  totalRated: number;
  skillStats: SkillStat[];
  hideTitle?: boolean;
  embedded?: boolean;
  showPremiumUsage?: boolean;
  // Premium Used This Cycle
  effectiveUsed?: number;
  effectiveQuota?: number;
  quotaAvailable?: boolean;
  selectedWorkspace?: string | null;
  // CLI vs VS Code Usage
  proxyTokenAccuracy?: {
    cliRequests: number;
    vscodeRequests: number;
    exactTotalTokens: number;
    estimatedTotalTokens: number;
    totalRequests: number;
  } | null;
}

interface PremiumUsagePanelProps {
  dailyBuckets: DailyBucket[];
  quotaTimeSeries: QuotaDataPoint[];
  chatEntitlement: number | null;
  completionsEntitlement: number | null;
  premiumEntitlement: number | null;
  quotaResetDate: string | null;
  intradayBuckets: Array<{ hour: string; transcriptTurns: number; toolCalls: number }>;
  quotaAgeMinutes: number | null;
  hideTitle?: boolean;
  embedded?: boolean;
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
type RangeKey = "3h" | "12h" | "24h" | "7d" | "30d" | "cycle" | "all";
type GranularityKey = "raw" | "hourly" | "daily";

function windowToHours(w: TimeWindow): number {
  const map: Record<TimeWindow, number> = { "3h": 3, "12h": 12, "24h": 24, "7d": 168, "14d": 336, "30d": 720 };
  return map[w];
}
function windowToDays(w: TimeWindow): number | null {
  const map: Partial<Record<TimeWindow, number>> = { "7d": 7, "14d": 14, "30d": 30 };
  return map[w] ?? null;
}

function formatTooltipLabel(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatAxisLabel(ts: string, granularity: GranularityKey, range: RangeKey): string {
  const d = new Date(ts);
  if (range === "3h" || range === "12h" || range === "24h") {
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (granularity === "daily" || range === "7d" || range === "30d" || range === "cycle" || range === "all") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (granularity === "hourly") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toRangeStart(range: RangeKey, quotaResetDate: string | null): Date | null {
  const now = new Date();

  if (range === "all") return null;
  if (range === "3h") return new Date(now.getTime() - 3 * 60 * 60 * 1000);
  if (range === "12h") return new Date(now.getTime() - 12 * 60 * 60 * 1000);
  if (range === "24h") return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (range === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (range === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (range === "cycle" && quotaResetDate) {
    const reset = new Date(quotaResetDate);
    const cycleStart = new Date(reset);
    cycleStart.setMonth(cycleStart.getMonth() - 1);
    return cycleStart;
  }

  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

function applyRange(
  data: QuotaDataPoint[],
  range: RangeKey,
  quotaResetDate: string | null,
): QuotaDataPoint[] {
  const start = toRangeStart(range, quotaResetDate);
  if (!start) return data;
  return data.filter((d) => new Date(d.timestamp).getTime() >= start.getTime());
}

function bucketTimestamp(ts: string, granularity: GranularityKey): string {
  const d = new Date(ts);
  if (granularity === "daily") {
    d.setHours(0, 0, 0, 0);
  } else if (granularity === "hourly") {
    d.setMinutes(0, 0, 0);
  }
  return d.toISOString();
}

function applyGranularity(data: QuotaDataPoint[], granularity: GranularityKey): QuotaDataPoint[] {
  if (granularity === "raw") return data;

  const buckets = new Map<string, QuotaDataPoint>();
  for (const point of data) {
    const key = bucketTimestamp(point.timestamp, granularity);
    const existing = buckets.get(key);
    if (!existing || point.timestamp > existing.timestamp) {
      buckets.set(key, point);
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function buildAxisTicks(
  data: Array<{ timestamp: string }>,
  range: RangeKey,
  granularity: GranularityKey,
): string[] {
  if (data.length === 0) return [];

  const targetCount =
    range === "3h" || range === "12h" || (range === "24h" && granularity !== "daily")
      ? 8
      : range === "7d"
        ? 7
        : 6;

  if (data.length <= targetCount) {
    return data.map((point) => point.timestamp);
  }

  const step = (data.length - 1) / (targetCount - 1);
  const ticks = new Set<string>();

  for (let i = 0; i < targetCount; i += 1) {
    const index = Math.round(i * step);
    ticks.add(data[index].timestamp);
  }

  ticks.add(data[0].timestamp);
  ticks.add(data[data.length - 1].timestamp);

  return Array.from(ticks);
}

export function PremiumUsagePanel({
  dailyBuckets,
  quotaTimeSeries,
  chatEntitlement,
  completionsEntitlement,
  premiumEntitlement,
  quotaResetDate,
  intradayBuckets,
  quotaAgeMinutes,
  hideTitle = false,
  embedded = false,
}: PremiumUsagePanelProps) {
  const [range, setRange] = useState<RangeKey>("7d");
  const [granularity, setGranularity] = useState<GranularityKey>("raw");
  const latestBilledPremium =
    quotaTimeSeries.length > 0
      ? quotaTimeSeries[quotaTimeSeries.length - 1].premiumUsed
      : null;
  const premiumUsagePct =
    latestBilledPremium !== null && premiumEntitlement !== null && premiumEntitlement > 0
      ? Math.round((latestBilledPremium / premiumEntitlement) * 100)
      : null;
  const freshLabel =
    quotaAgeMinutes === null
      ? null
      : quotaAgeMinutes < 2
      ? "just now"
      : quotaAgeMinutes < 60
      ? `${quotaAgeMinutes}m ago`
      : `${Math.round(quotaAgeMinutes / 60)}h ago`;
  const resetLabel = quotaResetDate
    ? new Date(quotaResetDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  const filteredQuotaSeries = useMemo(
    () => applyRange(quotaTimeSeries, range, quotaResetDate),
    [quotaTimeSeries, range, quotaResetDate],
  );
  const chartData = useMemo(
    () => applyGranularity(filteredQuotaSeries, granularity),
    [filteredQuotaSeries, granularity],
  );
  const chartDataWithDelta = useMemo(
    () =>
      chartData.map((point, index) => ({
        ...point,
        delta:
          index === 0
            ? null
            : Math.max(0, point.premiumUsed - chartData[index - 1].premiumUsed),
      })),
    [chartData],
  );
  const axisTicks = useMemo(
    () => buildAxisTicks(chartDataWithDelta, range, granularity),
    [chartDataWithDelta, granularity, range],
  );
  const availableSpanDays = useMemo(() => {
    if (quotaTimeSeries.length < 2) return 0;
    const sorted = [...quotaTimeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const start = new Date(sorted[0].timestamp).getTime();
    const end = new Date(sorted[sorted.length - 1].timestamp).getTime();
    return Math.max(0, (end - start) / (24 * 60 * 60 * 1000));
  }, [quotaTimeSeries]);
  const windowPremiumBurn =
    filteredQuotaSeries.length >= 2
      ? Math.max(
          0,
          filteredQuotaSeries[filteredQuotaSeries.length - 1].premiumUsed - filteredQuotaSeries[0].premiumUsed,
        )
      : null;
  const intradaySnapshots = useMemo(() => {
    const sorted = [...quotaTimeSeries].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );
    return sorted.map((p, i) => ({
      premiumUsed: p.premiumUsed,
      ts: p.timestamp,
      delta: i === 0 ? null : Math.max(0, p.premiumUsed - sorted[i - 1].premiumUsed),
    }));
  }, [quotaTimeSeries]);
  const todayStats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    const intradayTodayTurns = intradayBuckets
      .filter((bucket) => new Date(bucket.hour).getTime() >= startOfTodayMs)
      .reduce((sum, bucket) => sum + bucket.transcriptTurns, 0);

    const fallbackTodayKey = [
      startOfToday.getFullYear(),
      String(startOfToday.getMonth() + 1).padStart(2, "0"),
      String(startOfToday.getDate()).padStart(2, "0"),
    ].join("-");
    const todayBucket = dailyBuckets.find((d) => d.date === fallbackTodayKey) ?? null;
    const todayTurns =
      intradayTodayTurns > 0 ? intradayTodayTurns : todayBucket?.requests ?? null;

    const beforeToday = intradaySnapshots.filter(
      (snapshot) => new Date(snapshot.ts).getTime() < startOfTodayMs
    );
    const duringToday = intradaySnapshots.filter(
      (snapshot) => new Date(snapshot.ts).getTime() >= startOfTodayMs
    );
    const baselineSnapshot =
      beforeToday.length > 0
        ? beforeToday[beforeToday.length - 1]
        : duringToday[0] ?? null;
    const latestTodaySnapshot =
      duringToday.length > 0 ? duringToday[duringToday.length - 1] : null;
    const todayPremiumDelta =
      baselineSnapshot !== null && latestTodaySnapshot !== null
        ? Math.max(0, latestTodaySnapshot.premiumUsed - baselineSnapshot.premiumUsed)
        : null;
    const todayRatio =
      todayTurns !== null && todayPremiumDelta !== null && todayPremiumDelta > 0
        ? todayTurns / todayPremiumDelta
        : null;
    return { todayTurns, todayPremiumDelta, todayRatio };
  }, [dailyBuckets, intradayBuckets, intradaySnapshots]);

  const windowTranscriptTurns = useMemo(() => {
    const rangeStart = toRangeStart(range, quotaResetDate);
    const startMs = rangeStart ? rangeStart.getTime() : 0;
    return intradayBuckets
      .filter((b) => new Date(b.hour).getTime() >= startMs)
      .reduce((sum, b) => sum + b.transcriptTurns, 0);
  }, [range, quotaResetDate, intradayBuckets]);

  const windowRatio =
    windowTranscriptTurns > 0 && windowPremiumBurn !== null && windowPremiumBurn > 0
      ? windowTranscriptTurns / windowPremiumBurn
      : null;

  const rangeShortLabel: string =
    range === "cycle" ? "cycle" :
    range === "all" ? "all time" :
    range;

  return (
    <div className={`${embedded ? "bg-white p-5 space-y-4" : "rounded-lg bg-white border border-gray-200 p-5 space-y-4"}`}>
      {!hideTitle && <h2 className="text-lg font-semibold text-gray-900">Premium Usage</h2>}
      <p className="text-[11px] text-gray-400">
        {chartData.length > 0
          ? `${chartData.length} point${chartData.length === 1 ? "" : "s"} · ${range} · ${granularity}`
          : "No quota snapshots yet"}
      </p>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-gray-500">
          Real usage from GitHub Copilot API · snapshots every 15 min via VS Code extension
          {freshLabel && <span className="ml-2 text-gray-400">Last updated {freshLabel}</span>}
        </p>
        {resetLabel && (
          <div className="shrink-0 text-right text-[11px] text-gray-500">
            <span className="font-medium">Quota resets</span>
            <br />
            {resetLabel}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-3">
        
        <div className="rounded border border-gray-100 px-2.5 py-2 bg-white min-w-0">
          <p className="text-[11px] text-gray-500">Transcript turns ({rangeShortLabel})</p>
          <p className="font-semibold text-gray-800 truncate">
            {windowTranscriptTurns > 0 ? windowTranscriptTurns.toLocaleString() : "—"}
          </p>
        </div>
        <div className="rounded border border-gray-100 px-2.5 py-2 bg-white min-w-0">
          <p className="text-[11px] text-gray-500">Premium burned ({rangeShortLabel})</p>
          <p className="font-semibold text-gray-800 truncate">
            {windowPremiumBurn !== null ? windowPremiumBurn.toFixed(2) : "—"}
          </p>
        </div>
        <div className="rounded border border-purple-100 px-2.5 py-2 bg-purple-50 min-w-0">
          <p className="text-[11px] text-purple-600">Turns / Premium ({rangeShortLabel})</p>
          <p className="font-semibold text-purple-800 truncate">
            {windowRatio !== null ? `${windowRatio.toFixed(1)}×` : "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-gray-400">View</span>
          <div className="flex items-center gap-1 rounded-md bg-gray-100 p-1">
            {([
              ["raw", "Raw"],
              ["hourly", "Hourly"],
              ["daily", "Daily"],
            ] as Array<[GranularityKey, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setGranularity(key)}
                className={`px-2.5 py-1 text-xs rounded ${
                  granularity === key
                    ? "bg-white border border-gray-300 text-gray-800"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-gray-400">Range</span>
          <div className="flex items-center gap-1 rounded-md bg-gray-100 p-1">
            {([
              ["3h", "3h"],
              ["12h", "12h"],
              ["24h", "24h"],
              ["7d", "7d"],
              ["30d", "30d"],
              ["cycle", "Cycle"],
              ["all", "All"],
            ] as Array<[RangeKey, string]>).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                className={`px-2.5 py-1 text-xs rounded ${
                  range === key
                    ? "bg-white border border-gray-300 text-gray-800"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {availableSpanDays < 1 && (
        <p className="text-[11px] text-gray-400">
          Only {Math.max(1, Math.round(availableSpanDays * 24))}h of quota history so far, so some ranges will look identical until more snapshots accumulate.
        </p>
      )}

      {chartData.length < 2 ? (
        <p className="py-6 text-center text-xs text-gray-400">
          Not enough data for this filter yet. Try a wider range or click “Copilot Telemetry: Refresh Now” in VS Code.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartDataWithDelta} margin={{ top: 4, right: 40, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="timestamp"
              ticks={axisTicks}
              tick={{ fontSize: 11, fill: "#6b7280" }}
              axisLine={false}
              tickLine={false}
              interval={0}
              minTickGap={24}
              tickFormatter={(value) => formatAxisLabel(String(value), granularity, range)}
            />
            <YAxis yAxisId="usage" tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
            <YAxis
              yAxisId="delta"
              orientation="right"
              tick={{ fontSize: 11, fill: "#f59e0b" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
              labelFormatter={(value) => formatTooltipLabel(String(value))}
              formatter={(value: unknown, name: string) => {
                const num = Number(value);
                const labelMap: Record<string, string> = {
                  premiumUsed: "Premium used",
                  delta: "Burn per interval",
                  chatUsed: "Chat used",
                  completionsUsed: "Inline completions",
                };
                return [Number.isFinite(num) ? num.toFixed(2) : "-", labelMap[name] ?? name] as [string, string];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {premiumEntitlement !== null && premiumEntitlement > 0 && (
              <ReferenceLine
                yAxisId="usage"
                y={premiumEntitlement}
                stroke="#93c5fd"
                strokeDasharray="4 4"
                label={{ value: `Limit ${premiumEntitlement}`, fontSize: 10, fill: "#93c5fd" }}
              />
            )}
            <Line
              yAxisId="usage"
              type="monotone"
              dataKey="premiumUsed"
              name="Premium used"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            {chatEntitlement !== null && chatEntitlement > 0 && (
              <Line
                yAxisId="usage"
                type="monotone"
                dataKey="chatUsed"
                name="Chat used"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}
            {completionsEntitlement !== null && completionsEntitlement > 0 && (
              <Line
                yAxisId="usage"
                type="monotone"
                dataKey="completionsUsed"
                name="Inline completions"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}
            <Line
              yAxisId="delta"
              type="monotone"
              dataKey="delta"
              name="Burn per interval"
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              strokeDasharray="3 2"
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      <p className="text-[11px] text-gray-400">
        Blue = cumulative premium used · amber dashed = burn per interval.
      </p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoiExplorationPanel({
  dailyBuckets,
  quotaTimeSeries,
  chatEntitlement,
  completionsEntitlement,
  premiumEntitlement,
  quotaResetDate,
  intradayBuckets,
  cycleUserTurns,
  cycleAssistantTurns,
  cycleToolCalls,
  cycleDurationMinutes,
  cycleActiveMinutes,
  premiumBurnPerUserPrompt,
  toolOverheadRatio,
  promptEfficiencyPer100Turns,
  qualityToolOverheadCorrelation,
  marginalQualityCurve,
  quotaAgeMinutes,
  totalRated,
  skillStats,
  hideTitle = false,
  embedded = false,
  showPremiumUsage = true,
  effectiveUsed,
  effectiveQuota,
  quotaAvailable,
  selectedWorkspace,
  proxyTokenAccuracy,
}: Props) {
  const hasQualitySignal = totalRated >= 5;
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

  // ─── Top skills by quality efficiency ─────────────────────────────────────
  const topSkillsByEfficiency = useMemo(
    () =>
      hasQualitySignal
        ? [...skillStats]
            .filter((s) => s.qualityPer100Req !== null && s.sampleSize >= 2)
            .sort((a, b) => (b.qualityPer100Req ?? 0) - (a.qualityPer100Req ?? 0))
            .slice(0, 4)
        : [],
    [hasQualitySignal, skillStats]
  );

  const trendPct =
    recent7avg !== null && prev7avg !== null && prev7avg > 0
      ? ((recent7avg - prev7avg) / prev7avg) * 100
      : null;

  return (
    <div className={`${embedded ? "bg-white p-5 space-y-5" : "rounded-lg bg-white border border-gray-200 p-5 space-y-5"}`}>
      {!hideTitle && <h2 className="text-lg font-semibold text-gray-900">ROI Exploration</h2>}

      {/* Core metric row */}
      <div>
        <p className="px-1 pb-1.5 text-[11px] font-medium text-gray-500 uppercase tracking-wide">Key metrics</p>
        <div className="grid grid-cols-2 min-[900px]:grid-cols-4 gap-2.5">
          {effectiveUsed !== undefined && effectiveQuota !== undefined && (
            <Metric
              label={quotaAvailable ? "Premium Used This Cycle" : "Transcript Turns This Cycle"}
              value={`${effectiveUsed.toFixed(1)} / ${effectiveQuota}`}
              sub={`${effectiveQuota > 0 ? ((effectiveUsed / effectiveQuota) * 100).toFixed(2) : "0.00"}% of quota used${quotaAvailable ? " (billed)" : " (estimated)"}${selectedWorkspace ? " · account-wide" : ""}`}
              color="blue"
              progress={effectiveQuota > 0 ? effectiveUsed / effectiveQuota : 0}
            />
          )}
          {proxyTokenAccuracy != null && (
            <Metric
              label={`CLI vs VS Code Usage${selectedWorkspace ? " (account-wide)" : ""}`}
              value={`${proxyTokenAccuracy.cliRequests >= 1000 ? (proxyTokenAccuracy.cliRequests / 1000).toFixed(1) + "k" : proxyTokenAccuracy.cliRequests} CLI · ${proxyTokenAccuracy.vscodeRequests >= 1000 ? (proxyTokenAccuracy.vscodeRequests / 1000).toFixed(1) + "k" : proxyTokenAccuracy.vscodeRequests} VSC`}
              sub={`CLI: ${(proxyTokenAccuracy.exactTotalTokens / 1000).toFixed(0)}k · VSC: ~${(proxyTokenAccuracy.estimatedTotalTokens / 1000).toFixed(0)}k est.`}
              color="green"
            />
          )}
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

        </div>
      </div>
      
      {showPremiumUsage && (
        <PremiumUsagePanel
          embedded
          hideTitle
          dailyBuckets={dailyBuckets}
          quotaTimeSeries={quotaTimeSeries}
          chatEntitlement={chatEntitlement}
          completionsEntitlement={completionsEntitlement}
          premiumEntitlement={premiumEntitlement}
          quotaResetDate={quotaResetDate}
          intradayBuckets={intradayBuckets}
          quotaAgeMinutes={quotaAgeMinutes}
        />
      )}

      {/* Best ratio days + skills driving efficiency — same row */}
      {(bestDays.length > 0 || (skillEfficiencyInsight && skillEfficiencyInsight.length > 0)) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
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
                Recognized workflow skills that appear most often on your highest turns/premium days.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Best quality per request — standalone row */}
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
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Metric({
  label,
  value,
  sub,
  highlight,
  trend,
  color,
  progress,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  trend?: number | null;
  color?: "blue" | "purple" | "green";
  progress?: number;
}) {
  const trendColor =
    trend == null
      ? ""
      : trend > 0
      ? "text-emerald-600"
      : trend < 0
      ? "text-red-500"
      : "text-gray-500";

  const isBlue = color === "blue";
  const isPurple = color === "purple" || highlight;
  const isGreen = color === "green";

  const containerCls = isBlue
    ? "border-blue-200 bg-blue-50"
    : isPurple
    ? "border-purple-200 bg-purple-50"
    : isGreen
    ? "border-green-200 bg-green-50"
    : "border-gray-200 bg-gray-50";

  const valueCls = isBlue
    ? "text-blue-700"
    : isPurple
    ? "text-purple-700"
    : isGreen
    ? "text-green-700"
    : "text-gray-900";

  const barCls = isBlue ? "bg-blue-400" : isPurple ? "bg-purple-400" : isGreen ? "bg-green-400" : "bg-gray-400";

  return (
    <div className={`rounded-lg border px-2.5 py-2 ${containerCls}`}>
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-base font-semibold leading-none md:text-lg ${valueCls}`}>
        {value}
      </p>
      <p className={`mt-1 text-[10px] leading-tight ${trend != null ? trendColor : "text-gray-500"}`}>
        {sub}
      </p>
      {progress !== undefined && (
        <div className="mt-2 h-1 bg-white/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barCls}`}
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
      )}
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

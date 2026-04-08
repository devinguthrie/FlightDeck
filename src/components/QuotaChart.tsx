"use client";

import { useMemo, useState } from "react";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";

interface QuotaDataPoint {
  timestamp: string;
  chatUsed: number;
  completionsUsed: number;
  premiumUsed: number;
}

interface Props {
  timeSeries: QuotaDataPoint[];
  chatEntitlement: number;
  completionsEntitlement: number;
  premiumEntitlement: number;
  ageMinutes: number | null;
  quotaResetDate: string | null;
}

type RangeKey = "24h" | "7d" | "30d" | "cycle" | "all";
type GranularityKey = "raw" | "hourly" | "daily";

function formatTooltipLabel(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatAxisLabel(ts: string, granularity: GranularityKey, range: RangeKey): string {
  const d = new Date(ts);
  if (range === "24h") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (range === "7d" && granularity !== "daily") {
    return d.toLocaleDateString("en-US", { weekday: "short" }) +
      " " +
      d.toLocaleTimeString("en-US", { hour: "numeric" });
  }
  if (granularity === "daily") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (granularity === "hourly") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString("en-US", { hour: "numeric" });
  }
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

type ChartPoint = QuotaDataPoint;

function toRangeStart(range: RangeKey, quotaResetDate: string | null): Date | null {
  const now = new Date();

  if (range === "all") return null;
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

// Deduplicate by day for x-axis readability when there are many points
function downsampleForAxis(data: ChartPoint[]): ChartPoint[] {
  if (data.length <= 30) return data;
  const step = Math.ceil(data.length / 30);
  return data.filter((_, i) => i % step === 0 || i === data.length - 1);
}

export default function QuotaChart({
  timeSeries,
  chatEntitlement,
  completionsEntitlement,
  premiumEntitlement,
  ageMinutes,
  quotaResetDate,
}: Props) {
  const [range, setRange] = useState<RangeKey>("7d");
  const [granularity, setGranularity] = useState<GranularityKey>("raw");

  const filtered = useMemo(
    () => applyRange(timeSeries, range, quotaResetDate),
    [timeSeries, range, quotaResetDate],
  );

  const chartData = useMemo(
    () => applyGranularity(filtered, granularity),
    [filtered, granularity],
  );

  const availableSpanDays = useMemo(() => {
    if (timeSeries.length < 2) return 0;
    const sorted = [...timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const start = new Date(sorted[0].timestamp).getTime();
    const end = new Date(sorted[sorted.length - 1].timestamp).getTime();
    return Math.max(0, (end - start) / (24 * 60 * 60 * 1000));
  }, [timeSeries]);

  const axisData = useMemo(() => downsampleForAxis(chartData), [chartData]);
  const axisLabels = useMemo(() => new Set(axisData.map((d) => d.timestamp)), [axisData]);
  const chartKey = `${range}-${granularity}-${chartData.length}`;

  const freshLabel =
    ageMinutes === null
      ? null
      : ageMinutes < 2
      ? "just now"
      : ageMinutes < 60
      ? `${ageMinutes}m ago`
      : `${Math.round(ageMinutes / 60)}h ago`;

  const resetLabel = quotaResetDate
    ? new Date(quotaResetDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <div className="rounded-lg bg-white border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Quota Consumption{" "}
            <span className="text-xs font-normal text-green-600 ml-1">● Live</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Real usage from GitHub Copilot API · snapshots every 15 min via VS Code extension
            {freshLabel && (
              <span className="ml-2 text-gray-400">Last updated {freshLabel}</span>
            )}
          </p>
        </div>
        {resetLabel && (
          <div className="text-xs text-gray-500 text-right">
            <span className="font-medium">Quota resets</span>
            <br />
            {resetLabel}
          </div>
        )}
      </div>

      {/* Summary pills + filter controls on the same row */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 mt-3">
        <div className="flex flex-wrap items-center gap-2">
          {premiumEntitlement > 0 && (
            <Pill
              color="blue"
              label="Premium"
              used={timeSeries[timeSeries.length - 1]?.premiumUsed ?? 0}
              total={premiumEntitlement}
            />
          )}
          {chatEntitlement > 0 && (
            <Pill
              color="purple"
              label="Chat"
              used={timeSeries[timeSeries.length - 1]?.chatUsed ?? 0}
              total={chatEntitlement}
            />
          )}
          {completionsEntitlement > 0 && (
            <Pill
              color="green"
              label="Inline completions"
              used={timeSeries[timeSeries.length - 1]?.completionsUsed ?? 0}
              total={completionsEntitlement}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
            {([
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

          <div className="flex items-center gap-1 bg-gray-100 rounded-md p-1">
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

          <div className="text-xs text-gray-500">
            {chartData.length} pt{chartData.length === 1 ? "" : "s"} · {range} · {granularity}
          </div>
        </div>
      </div>

      {availableSpanDays < 1 && (
        <p className="text-[11px] text-gray-400 mb-3">
          Only {Math.max(1, Math.round(availableSpanDays * 24))}h of quota history so far, so some range filters will look identical until more snapshots accumulate.
        </p>
      )}

      {chartData.length < 2 ? (
        <div className="flex items-center justify-center h-48 text-sm text-gray-400">
          Not enough data for this filter yet.
          <br />
          Try a wider range or click &ldquo;Copilot Telemetry: Refresh Now&rdquo; in VS Code.
        </div>
      ) : (
        <>
          {/* Premium + Chat chart */}
          <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">
            Premium &amp; Chat requests
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart key={chartKey} data={chartData} margin={{ top: 4, right: 16, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                key={`x-${chartKey}`}
                dataKey="timestamp"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                tickFormatter={(v) =>
                  axisLabels.has(v) ? formatAxisLabel(v, granularity, range) : ""
                }
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                labelFormatter={(value) => formatTooltipLabel(String(value))}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {premiumEntitlement > 0 && (
                <ReferenceLine
                  y={premiumEntitlement}
                  stroke="#93c5fd"
                  strokeDasharray="4 4"
                  label={{ value: `Limit ${premiumEntitlement}`, fontSize: 10, fill: "#93c5fd" }}
                />
              )}
              <Line
                type="monotone"
                dataKey="premiumUsed"
                name="Premium used"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="chatUsed"
                name="Chat used"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Completions chart (separate scale) */}
          {completionsEntitlement > 0 && (
            <>
              <p className="text-xs text-gray-400 mt-5 mb-1 font-medium uppercase tracking-wide">
                Inline completions used
              </p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart key={`completions-${chartKey}`} data={chartData} margin={{ top: 4, right: 16, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    key={`x-completions-${chartKey}`}
                    dataKey="timestamp"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    tickFormatter={(v) =>
                      axisLabels.has(v) ? formatAxisLabel(v, granularity, range) : ""
                    }
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                    labelFormatter={(value) => formatTooltipLabel(String(value))}
                  />
                  {completionsEntitlement > 0 && (
                    <ReferenceLine
                      y={completionsEntitlement}
                      stroke="#6ee7b7"
                      strokeDasharray="4 4"
                      label={{
                        value: `Limit ${completionsEntitlement}`,
                        fontSize: 10,
                        fill: "#6ee7b7",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="completionsUsed"
                    name="Completions used"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Pill({
  color,
  label,
  used,
  total,
}: {
  color: "blue" | "purple" | "green";
  label: string;
  used: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const colors = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
    green: "bg-green-50 text-green-700 border-green-200",
  };
  const bars = {
    blue: "bg-blue-400",
    purple: "bg-purple-400",
    green: "bg-green-400",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs min-w-[120px] ${colors[color]}`}>
      <div className="font-medium mb-0.5">{label}</div>
      <div className="tabular-nums">
        {used} / {total} <span className="opacity-60">({pct}%)</span>
      </div>
      <div className="mt-1.5 h-1 bg-white/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${bars[color]}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

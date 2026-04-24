"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";

interface DailyBucket {
  date: string;
  requests: number;
  sessions: number;
  toolCalls: number;
}

interface QuotaDataPoint {
  timestamp: string;
  premiumUsed: number;
}

interface HourlyBucket {
  hour: string;
  transcriptTurns: number;
  toolCalls: number;
}

interface Props {
  dailyBuckets: DailyBucket[];
  quotaTimeSeries: QuotaDataPoint[];
  intradayBuckets: HourlyBucket[];
  projectScopedComparison?: boolean;
  hideTitle?: boolean;
  embedded?: boolean;
}

type TimeWindow = "3h" | "12h" | "24h" | "7d" | "14d" | "30d";
type DailyTimeWindow = Extract<TimeWindow, "7d" | "14d" | "30d">;
type HourlyTimeWindow = Extract<TimeWindow, "3h" | "12h" | "24h">;

const WIN_LABELS: TimeWindow[] = ["3h", "12h", "24h", "7d", "14d", "30d"];

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

function fmtDay(day: string): string {
  const d = new Date(day + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtHourLabel(key: string): string {
  const today = toDayKey(new Date().toISOString());
  const keyDate = key.slice(0, 10);
  const time = key.slice(11, 16);
  if (keyDate === today) return time;
  const d = new Date(keyDate + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + time;
}

function formatTooltipLabel(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function buildPremiumDailyDeltas(timeSeries: QuotaDataPoint[]): Record<string, number> {
  if (timeSeries.length < 2) return {};

  const sorted = [...timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byDay = new Map<string, { first: number; last: number }>();

  for (const point of sorted) {
    const day = toDayKey(point.timestamp);
    const current = byDay.get(day);
    if (!current) {
      byDay.set(day, { first: point.premiumUsed, last: point.premiumUsed });
    } else {
      byDay.set(day, { first: current.first, last: point.premiumUsed });
    }
  }

  const out: Record<string, number> = {};
  for (const [day, values] of byDay.entries()) {
    out[day] = Math.max(0, values.last - values.first);
  }
  return out;
}

function buildPremiumHourlyDeltas(timeSeries: QuotaDataPoint[]): Record<string, number> {
  if (timeSeries.length < 2) return {};

  const sorted = [...timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byHour = new Map<string, { first: number; last: number }>();

  for (const point of sorted) {
    const key = toHourKey(point.timestamp);
    const current = byHour.get(key);
    if (!current) {
      byHour.set(key, { first: point.premiumUsed, last: point.premiumUsed });
    } else {
      byHour.set(key, { first: current.first, last: point.premiumUsed });
    }
  }

  const out: Record<string, number> = {};
  for (const [key, values] of byHour.entries()) {
    out[key] = Math.max(0, values.last - values.first);
  }
  return out;
}

function movingAverage(values: Array<number | null>, window: number): Array<number | null> {
  return values.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = values.slice(start, index + 1).filter((value): value is number => value !== null);
    return slice.length > 0 ? slice.reduce((sum, value) => sum + value, 0) / slice.length : null;
  });
}

function classifyDay(transcriptTurns: number, billedPremium: number | null): string {
  if (transcriptTurns === 0 && (billedPremium ?? 0) > 0) return "Billing without transcript";
  if (transcriptTurns > 0 && (!billedPremium || billedPremium === 0)) return "Transcript without billing";
  if (!billedPremium || billedPremium <= 0) return "No overlap";

  const ratio = transcriptTurns / billedPremium;
  if (ratio >= 12) return "High divergence";
  if (ratio <= 3) return "Tight coupling";
  return "Typical gap";
}

function windowToHours(window: TimeWindow): number {
  const map: Record<TimeWindow, number> = {
    "3h": 3,
    "12h": 12,
    "24h": 24,
    "7d": 168,
    "14d": 336,
    "30d": 720,
  };
  return map[window];
}

function windowToDays(window: TimeWindow): number | null {
  if (window === "7d") return 7;
  if (window === "14d") return 14;
  if (window === "30d") return 30;
  return null;
}

function buildCenteredDailySlice<T extends { date: string }>(
  rows: T[],
  window: DailyTimeWindow,
  focusDate: string | null,
): T[] {
  const days = windowToDays(window) ?? rows.length;
  if (rows.length <= days) return rows;
  if (!focusDate) return rows.slice(-days);

  const focusIndex = rows.findIndex((row) => row.date === focusDate);
  if (focusIndex === -1) return rows.slice(-days);

  const halfWindow = Math.floor(days / 2);
  const maxStart = rows.length - days;
  const start = Math.max(0, Math.min(focusIndex - halfWindow, maxStart));
  return rows.slice(start, start + days);
}

function buildFocusedHourlySlice<T extends { hour: string; date: string }>(
  rows: T[],
  window: HourlyTimeWindow,
  focusDate: string | null,
  now: number,
): T[] {
  const hours = windowToHours(window);
  if (rows.length <= hours) return rows;

  if (!focusDate) {
    const cutoff = now - hours * 60 * 60 * 1000;
    const recentRows = rows.filter((row) => {
      const rowTime = new Date(row.hour).getTime();
      return rowTime >= cutoff && rowTime <= now;
    });
    return recentRows.length > 0 ? recentRows : rows.slice(-hours);
  }

  const dayRows = rows.filter((row) => row.date === focusDate);
  if (dayRows.length === 0) return rows.slice(-hours);

  return dayRows.slice(-Math.min(hours, dayRows.length));
}

type TrendRow = {
  date: string;
  label: string;
  transcriptTurns: number;
  billedPremium: number | null;
  turnsPerPremium: number | null;
  sessions: number;
  toolCalls: number;
  classification: string;
  ma7?: number | null;
};

function HighlightDot({
  cx,
  cy,
  payload,
  stroke,
  activeDate,
}: {
  cx?: number;
  cy?: number;
  payload?: { date?: string };
  stroke?: string;
  activeDate: string | null;
}) {
  if (!activeDate || !payload?.date || payload.date !== activeDate || cx === undefined || cy === undefined) {
    return null;
  }

  return <circle cx={cx} cy={cy} r={4} fill="#ffffff" stroke={stroke ?? "#7c3aed"} strokeWidth={2} />;
}

type HighlightDotProps = {
  key?: string | number;
  cx?: number;
  cy?: number;
  payload?: { date?: string };
  stroke?: string;
};

function renderHighlightDot(props: HighlightDotProps, activeDate: string | null) {
  const { key, ...dotProps } = props;
  return <HighlightDot key={key} {...dotProps} activeDate={activeDate} />;
}

export default function DivergencePanel({
  dailyBuckets,
  quotaTimeSeries,
  intradayBuckets,
  projectScopedComparison = false,
  hideTitle = false,
  embedded = false,
}: Props) {
  const [trendWindow, setTrendWindow] = useState<TimeWindow>("24h");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const rows = useMemo(() => {
    const premiumDaily = buildPremiumDailyDeltas(quotaTimeSeries);
    const computedRows = dailyBuckets
      .map((bucket) => {
        const billedPremium = premiumDaily[bucket.date] ?? null;
        const turnsPerPremium = billedPremium && billedPremium > 0 ? bucket.requests / billedPremium : null;
        return {
          date: bucket.date,
          label: fmtDay(bucket.date),
          transcriptTurns: bucket.requests,
          billedPremium,
          sessions: bucket.sessions,
          toolCalls: bucket.toolCalls,
          turnsPerPremium,
          classification: classifyDay(bucket.requests, billedPremium),
        };
      })
      .filter((row) => row.transcriptTurns > 0 || (row.billedPremium ?? 0) > 0);

    const maValues = movingAverage(computedRows.map((row) => row.turnsPerPremium), 7);
    return computedRows.map((row, index) => ({ ...row, ma7: maValues[index] })) as TrendRow[];
  }, [dailyBuckets, quotaTimeSeries]);

  const overlapRows = rows.filter((row) => row.billedPremium !== null && row.billedPremium > 0);
  const transcriptOnlyDays = rows.filter(
    (row) => row.transcriptTurns > 0 && (!row.billedPremium || row.billedPremium === 0),
  ).length;
  const highDivergenceDays = overlapRows.filter((row) => (row.turnsPerPremium ?? 0) >= 12).length;
  const topDivergenceDays = [...rows]
    .filter((row) => row.turnsPerPremium !== null)
    .sort((a, b) => (b.turnsPerPremium ?? 0) - (a.turnsPerPremium ?? 0))
    .slice(0, 5);

  const hourlyTrend = useMemo(() => {
    const premiumByHour = buildPremiumHourlyDeltas(quotaTimeSeries);
    return intradayBuckets.map((bucket) => {
      const billedPremium = premiumByHour[bucket.hour] ?? null;
      const turnsPerPremium =
        billedPremium && billedPremium > 0 ? bucket.transcriptTurns / billedPremium : null;
      return {
        ...bucket,
        date: bucket.hour.slice(0, 10),
        label: fmtHourLabel(bucket.hour),
        billedPremium,
        turnsPerPremium,
      };
    });
  }, [intradayBuckets, quotaTimeSeries]);

  const hourlyTrendSlice = useMemo(() => {
    if (windowToDays(trendWindow) !== null) return hourlyTrend;
    return buildFocusedHourlySlice(hourlyTrend, trendWindow as HourlyTimeWindow, selectedDate, now);
  }, [hourlyTrend, now, selectedDate, trendWindow]);

  const trendSlice = useMemo(() => {
    const dailyWindow = windowToDays(trendWindow);
    if (dailyWindow === null) return rows;
    return buildCenteredDailySlice(rows, trendWindow as DailyTimeWindow, selectedDate);
  }, [rows, selectedDate, trendWindow]);

  const highlightedTrendRow =
    windowToDays(trendWindow) === null || !selectedDate
      ? null
      : trendSlice.find((row) => row.date === selectedDate) ?? null;

  function handleWindowChange(window: TimeWindow) {
    setTrendWindow(window);
  }

  function handleFocusDate(date: string) {
    setSelectedDate(date);
  }

  function handleResetToToday() {
    setSelectedDate(null);
  }

  if (rows.length === 0) return null;

  return (
    <div className={`${embedded ? "bg-white p-5 space-y-4" : "rounded-lg bg-white border border-gray-200 p-5 space-y-4"}`}>
      <div>
        {!hideTitle && <h2 className="text-lg font-semibold text-gray-900">Transcript vs Billed Divergence</h2>}
        <p className="text-xs text-gray-500 mt-0.5">
          Divergence days now drive the same premium efficiency trend instead of duplicating it.
        </p>
        {projectScopedComparison && (
          <p className="mt-2 inline-block rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
            Transcript turns are project-filtered, but billed premium is still account-wide.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard
          label="Overlap Days"
          value={String(overlapRows.length)}
          sub="days with transcript and billed data"
          tone="blue"
        />
        <MetricCard
          label="Transcript-Only Days"
          value={String(transcriptOnlyDays)}
          sub="turns recorded but billed delta stayed flat"
          tone="amber"
        />
        <MetricCard
          label="High-Divergence Days"
          value={String(highDivergenceDays)}
          sub="12+ transcript turns per billed unit"
          tone="green"
        />
      </div>

      <div className="rounded-lg border border-gray-100">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Premium efficiency trend ({trendWindow})
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleResetToToday}
              disabled={!selectedDate}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                selectedDate
                  ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  : "bg-gray-50 text-gray-300 cursor-not-allowed"
              }`}
            >
              Today
            </button>
            {WIN_LABELS.map((window) => (
              <button
                key={window}
                type="button"
                onClick={() => handleWindowChange(window)}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  trendWindow === window
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {window}
              </button>
            ))}
          </div>
        </div>

        <div className="p-3">
          {windowToDays(trendWindow) === null ? (
            hourlyTrendSlice.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-400">No hourly data in the last {trendWindow}</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={hourlyTrendSlice} margin={{ top: 2, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="volume"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="ratio"
                    orientation="right"
                    tick={{ fontSize: 11, fill: "#7c3aed" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                    labelFormatter={(label) => String(label)}
                    formatter={(value: unknown, name: string) => {
                      const num = Number(value);
                      const labels: Record<string, string> = {
                        transcriptTurns: "Transcript Turns",
                        billedPremium: "Billed Premium",
                        turnsPerPremium: "Turns / Premium",
                      };
                      return [Number.isFinite(num) ? num.toFixed(2) : "-", labels[name] ?? name] as [string, string];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    yAxisId="volume"
                    type="monotone"
                    dataKey="transcriptTurns"
                    name="Transcript Turns"
                    stroke="#3b82f6"
                    strokeWidth={1.75}
                    dot={false}
                    connectNulls={false}
                    strokeDasharray="4 2"
                  />
                  <Line
                    yAxisId="volume"
                    type="monotone"
                    dataKey="billedPremium"
                    name="Billed Premium"
                    stroke="#10b981"
                    strokeWidth={1.75}
                    dot={false}
                    connectNulls={false}
                    strokeDasharray="4 2"
                  />
                  <Line
                    yAxisId="ratio"
                    type="monotone"
                    dataKey="turnsPerPremium"
                    name="Turns / Premium"
                    stroke="#7c3aed"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )
          ) : trendSlice.filter((row) => row.turnsPerPremium !== null).length < 2 ? (
            <div className="space-y-1 py-8 text-center">
              <p className="text-sm text-gray-600">Not enough overlap yet for a divergence trend.</p>
              <p className="text-xs text-gray-400">
                The chart becomes meaningful with 2+ days of billed snapshots.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={trendSlice} margin={{ top: 2, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="volume"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="ratio"
                  orientation="right"
                  tick={{ fontSize: 11, fill: "#7c3aed" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                  labelFormatter={(label) => String(label)}
                  formatter={(value: unknown, name: string) => {
                    if (value === null || value === undefined) return ["-", name];
                    const num = Number(value);
                    const labels: Record<string, string> = {
                      transcriptTurns: "Transcript Turns",
                      billedPremium: "Billed Premium",
                      turnsPerPremium: "Turns / Premium",
                      ma7: "7d MA",
                    };
                    return [Number.isFinite(num) ? num.toFixed(2) : "-", labels[name] ?? name] as [string, string];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {highlightedTrendRow && (
                  <ReferenceArea
                    x1={highlightedTrendRow.label}
                    x2={highlightedTrendRow.label}
                    strokeOpacity={0}
                    fill="#ede9fe"
                    fillOpacity={0.35}
                  />
                )}
                <Line
                  yAxisId="volume"
                  type="monotone"
                  dataKey="transcriptTurns"
                  name="Transcript Turns"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  dot={(props) => renderHighlightDot(props, selectedDate)}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  strokeDasharray="4 2"
                />
                <Line
                  yAxisId="volume"
                  type="monotone"
                  dataKey="billedPremium"
                  name="Billed Premium"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  dot={(props) => renderHighlightDot(props, selectedDate)}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  strokeDasharray="4 2"
                />
                <Line
                  yAxisId="ratio"
                  type="monotone"
                  dataKey="turnsPerPremium"
                  name="Turns / Premium"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  dot={(props) => renderHighlightDot(props, selectedDate)}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
                <Line
                  yAxisId="ratio"
                  type="monotone"
                  dataKey="ma7"
                  name="7d MA"
                  stroke="#7c3aed"
                  strokeWidth={1}
                  dot={false}
                  connectNulls={false}
                  strokeDasharray="2 2"
                  opacity={0.6}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}

          <p className="mt-1 text-[11px] text-gray-400">
            {windowToDays(trendWindow) === null
              ? "Purple = turns/premium on the right axis · blue/green = hourly components"
              : "Purple = turns/premium on the right axis · dashed purple = 7d MA · blue/green = raw components"}
          </p>
        </div>
      </div>

      {topDivergenceDays.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Top divergence days</p>
            <p className="text-[11px] text-gray-400">Click to focus a day within the current range.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="pb-2 font-medium">Day</th>
                  <th className="pb-2 font-medium text-right">Transcript</th>
                  <th className="pb-2 font-medium text-right">Billed</th>
                  <th className="pb-2 font-medium text-right">Turns / Premium</th>
                  <th className="pb-2 font-medium">Read</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {topDivergenceDays.map((row) => {
                  const isSelected = row.date === selectedDate;
                  const isHovered = row.date === hoveredDate;
                  return (
                    <tr
                      key={row.date}
                      tabIndex={0}
                      aria-selected={row.date === selectedDate}
                      className={`cursor-pointer outline-none ${
                        isSelected ? "bg-purple-50" : isHovered ? "bg-gray-50" : "hover:bg-gray-50"
                      }`}
                      onMouseEnter={() => setHoveredDate(row.date)}
                      onMouseLeave={() => setHoveredDate((current) => (current === row.date ? null : current))}
                      onFocus={() => setHoveredDate(row.date)}
                      onBlur={() => setHoveredDate((current) => (current === row.date ? null : current))}
                      onClick={() => handleFocusDate(row.date)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleFocusDate(row.date);
                        }
                      }}
                    >
                      <td className={`py-2 ${isSelected ? "font-medium text-purple-700" : "text-gray-700"}`}>{row.label}</td>
                      <td className="py-2 text-right text-gray-600">{row.transcriptTurns}</td>
                      <td className="py-2 text-right text-gray-600">{row.billedPremium?.toFixed(1) ?? "-"}</td>
                      <td className="py-2 text-right font-semibold text-purple-700">{row.turnsPerPremium?.toFixed(2)}x</td>
                      <td className="py-2 text-xs text-gray-500">{row.classification}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "blue" | "green" | "amber";
}) {
  const tones = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-green-200 bg-green-50 text-green-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${tones[tone]}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] opacity-80">{sub}</p>
    </div>
  );
}

"use client";

import { useMemo } from "react";
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
}

interface IntradayBucket {
  hour: string;
  transcriptTurns: number;
  toolCalls: number;
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

interface Props {
  dailyBuckets: DailyBucket[];
  intradayBuckets: IntradayBucket[];
  quotaTimeSeries: QuotaDataPoint[];
  cycleUserTurns: number;
  cycleAssistantTurns: number;
  cycleToolCalls: number;
  cycleDurationMinutes: number;
  premiumBurnPerUserPrompt: number | null;
  requestDensityPerMinute: number;
  toolOverheadRatio: number;
  promptEfficiencyPer100Turns: number | null;
  qualityToolOverheadCorrelation: number | null;
  marginalQualityCurve: MarginalQualityBucket[];
  quotaAgeMinutes: number | null;
  totalRated: number;
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

function toLocalHourKeyFromTimestamp(ts: string): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:00`;
}

function formatHourLabel(hourKey: string): string {
  const d = new Date(hourKey);
  return d.toLocaleTimeString("en-US", { hour: "numeric" });
}

function buildPremiumHourlyDeltas(timeSeries: QuotaDataPoint[]): Record<string, number> {
  if (timeSeries.length < 2) return {};

  const sorted = [...timeSeries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const byHour = new Map<string, { first: number; last: number }>();

  for (const p of sorted) {
    const key = toLocalHourKeyFromTimestamp(p.timestamp);
    const current = byHour.get(key);
    if (!current) {
      byHour.set(key, { first: p.premiumUsed, last: p.premiumUsed });
    } else {
      byHour.set(key, { first: current.first, last: p.premiumUsed });
    }
  }

  const out: Record<string, number> = {};
  for (const [hour, v] of byHour.entries()) {
    out[hour] = Math.max(0, v.last - v.first);
  }
  return out;
}

export default function RoiExplorationPanel({
  dailyBuckets,
  intradayBuckets,
  quotaTimeSeries,
  cycleUserTurns,
  cycleAssistantTurns,
  cycleToolCalls,
  cycleDurationMinutes,
  premiumBurnPerUserPrompt,
  requestDensityPerMinute,
  toolOverheadRatio,
  promptEfficiencyPer100Turns,
  qualityToolOverheadCorrelation,
  marginalQualityCurve,
  quotaAgeMinutes,
  totalRated,
}: Props) {
  const trustScore = trustScoreFromAge(quotaAgeMinutes);
  const latestBilledPremium = quotaTimeSeries.length > 0 ? quotaTimeSeries[quotaTimeSeries.length - 1].premiumUsed : null;
  const cycleEstimatorGap =
    latestBilledPremium !== null ? cycleAssistantTurns - latestBilledPremium : null;
  const cycleTurnsPerPremium =
    latestBilledPremium !== null && latestBilledPremium > 0
      ? cycleAssistantTurns / latestBilledPremium
      : null;

  const premiumTrend = useMemo(() => {
    const premiumDaily = buildPremiumDailyDeltas(quotaTimeSeries);

    return dailyBuckets
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
        };
      })
      .filter((d) => d.transcriptTurns > 0 || d.billedPremium !== null);
  }, [dailyBuckets, quotaTimeSeries]);

  const intradayTrend = useMemo(() => {
    const premiumHourly = buildPremiumHourlyDeltas(quotaTimeSeries);
    return intradayBuckets.map((bucket) => {
      const billedPremium = premiumHourly[bucket.hour] ?? null;
      const turnsPerPremium =
        billedPremium && billedPremium > 0 ? bucket.transcriptTurns / billedPremium : null;
      return {
        ...bucket,
        label: formatHourLabel(bucket.hour),
        billedPremium,
        turnsPerPremium,
      };
    }).filter((b) => b.transcriptTurns > 0 || b.billedPremium !== null);
  }, [intradayBuckets, quotaTimeSeries]);

  const correlationLabel =
    qualityToolOverheadCorrelation === null
      ? "Not enough rated sessions"
      : qualityToolOverheadCorrelation > 0.2
      ? "Higher tool overhead tends to correlate with better quality"
      : qualityToolOverheadCorrelation < -0.2
      ? "Higher tool overhead tends to correlate with lower quality"
      : "Tool overhead has weak quality relationship";

  const latestPremiumDay = premiumTrend[premiumTrend.length - 1] ?? null;

  return (
    <div className="rounded-lg bg-white border border-gray-200 p-5 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">ROI Exploration</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Cost, quality, and efficiency signals to identify what helps vs hurts
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-800">Live now:</span> premium burn, density, overhead, quota trust, and overlap status.
        {totalRated === 0 ? (
          <span> Quality-based ROI is waiting on your first session ratings.</span>
        ) : (
          <span> Quality-based ROI is active from {totalRated} rated session{totalRated === 1 ? "" : "s"}.</span>
        )}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <Metric label="Premium / User Prompt" value={premiumBurnPerUserPrompt !== null ? premiumBurnPerUserPrompt.toFixed(3) : "-"} sub="billed premium per user turn" />
        <Metric label="Request Density" value={requestDensityPerMinute.toFixed(3)} sub="assistant turns per minute" />
        <Metric label="Tool Overhead" value={toolOverheadRatio.toFixed(3)} sub="tool calls per assistant turn" />
        <Metric label="Prompt Efficiency" value={promptEfficiencyPer100Turns !== null ? promptEfficiencyPer100Turns.toFixed(2) : "-"} sub="quality points per 100 user turns" />
        <Metric label="Quota Trust" value={`${trustScore}%`} sub={quotaAgeMinutes !== null ? `snapshot age ${quotaAgeMinutes}m` : "no live quota snapshot"} />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Metric label="Transcript Turns (Cycle)" value={cycleAssistantTurns.toLocaleString()} sub="assistant.turn_start count" />
        <Metric label="Billed Premium (Cycle)" value={latestBilledPremium !== null ? latestBilledPremium.toFixed(1) : "-"} sub="GitHub quota snapshot cumulative" />
        <Metric label="Estimator Gap" value={cycleEstimatorGap !== null ? cycleEstimatorGap.toFixed(1) : "-"} sub="transcript turns minus billed premium" />
        <Metric label="Turns / Premium" value={cycleTurnsPerPremium !== null ? cycleTurnsPerPremium.toFixed(2) : "-"} sub="cycle transcript turns per billed premium" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="border border-gray-100 rounded-lg p-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Intraday premium efficiency (24h)
          </p>
          {intradayTrend.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No intraday overlap yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={intradayTrend} margin={{ top: 2, right: 8, left: -12, bottom: 0 }}>
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
                    return [Number.isFinite(num) ? num.toFixed(2) : "-", name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="transcriptTurns" name="Transcript Turns" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="billedPremium" name="Billed Premium" stroke="#10b981" strokeWidth={2} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="turnsPerPremium" name="Turns per Premium" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="border border-gray-100 rounded-lg p-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Premium efficiency trend (30d)
          </p>
          {premiumTrend.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No quota + transcript overlap yet</p>
          ) : premiumTrend.length === 1 ? (
            <div className="py-8 text-center space-y-1">
              <p className="text-sm text-gray-600">Only one overlap day so far</p>
              <p className="text-xs text-gray-500">
                {latestPremiumDay?.label}: transcript {latestPremiumDay?.transcriptTurns ?? 0}, billed {latestPremiumDay?.billedPremium ?? 0}
              </p>
              <p className="text-xs text-gray-400">Use the cycle comparison metrics above for immediate signal. This chart becomes a real trend once you have a second day of billed snapshots.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={premiumTrend} margin={{ top: 2, right: 8, left: -12, bottom: 0 }}>
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
                    const n = name === "turnsPerPremium" ? "Turns per Premium" : name;
                    if (value === null || value === undefined) return ["-", n];
                    const num = Number(value);
                    return [Number.isFinite(num) ? num.toFixed(2) : "-", n];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="turnsPerPremium" name="turnsPerPremium" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="border border-gray-100 rounded-lg p-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Marginal quality gain curve
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={marginalQualityCurve} margin={{ top: 2, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 5]}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
              />
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
            <p className="text-[11px] text-gray-400 mt-1">
              Quality-based ROI metrics stay empty until you rate some sessions.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 text-xs text-gray-600">
        <StatRow label="Cycle user turns" value={cycleUserTurns.toLocaleString()} />
        <StatRow label="Cycle assistant turns" value={cycleAssistantTurns.toLocaleString()} />
        <StatRow label="Cycle tool calls" value={cycleToolCalls.toLocaleString()} />
        <StatRow label="Cycle minutes" value={cycleDurationMinutes.toFixed(1)} />
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900 leading-none mt-1">{value}</p>
      <p className="text-[11px] text-gray-500 mt-1">{sub}</p>
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

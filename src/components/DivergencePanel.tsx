"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
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

interface Props {
  dailyBuckets: DailyBucket[];
  quotaTimeSeries: QuotaDataPoint[];
  projectScopedComparison?: boolean;
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
    const current = byDay.get(day);
    if (!current) {
      byDay.set(day, { first: p.premiumUsed, last: p.premiumUsed });
    } else {
      byDay.set(day, { first: current.first, last: p.premiumUsed });
    }
  }

  const out: Record<string, number> = {};
  for (const [day, values] of byDay.entries()) {
    out[day] = Math.max(0, values.last - values.first);
  }
  return out;
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

export default function DivergencePanel({
  dailyBuckets,
  quotaTimeSeries,
  projectScopedComparison = false,
}: Props) {
  const rows = useMemo(() => {
    const premiumDaily = buildPremiumDailyDeltas(quotaTimeSeries);
    return dailyBuckets
      .map((d) => {
        const billedPremium = premiumDaily[d.date] ?? null;
        const turnsPerPremium = billedPremium && billedPremium > 0 ? d.requests / billedPremium : null;
        return {
          date: d.date,
          label: fmtDay(d.date),
          transcriptTurns: d.requests,
          billedPremium,
          sessions: d.sessions,
          toolCalls: d.toolCalls,
          turnsPerPremium,
          classification: classifyDay(d.requests, billedPremium),
        };
      })
      .filter((d) => d.transcriptTurns > 0 || (d.billedPremium ?? 0) > 0);
  }, [dailyBuckets, quotaTimeSeries]);

  const overlapRows = rows.filter((r) => r.billedPremium !== null && r.billedPremium > 0);
  const transcriptOnlyDays = rows.filter((r) => r.transcriptTurns > 0 && (!r.billedPremium || r.billedPremium === 0)).length;
  const totalTranscriptTurns = overlapRows.reduce((sum, row) => sum + row.transcriptTurns, 0);
  const totalBilledPremium = overlapRows.reduce((sum, row) => sum + (row.billedPremium ?? 0), 0);
  const cycleTurnsPerPremium = totalBilledPremium > 0 ? totalTranscriptTurns / totalBilledPremium : null;
  const highDivergenceDays = overlapRows.filter((r) => (r.turnsPerPremium ?? 0) >= 12).length;
  const topDivergenceDays = [...rows]
    .filter((r) => r.turnsPerPremium !== null)
    .sort((a, b) => (b.turnsPerPremium ?? 0) - (a.turnsPerPremium ?? 0))
    .slice(0, 5);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg bg-white border border-gray-200 p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Transcript vs Billed Divergence</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Where activity and premium quota movement separate, that is usually the real workflow story.
        </p>
        {projectScopedComparison && (
          <p className="text-[11px] text-amber-700 mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 inline-block">
            Transcript turns are project-filtered, but billed premium is still account-wide.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard
          label="Turns / Billed"
          value={cycleTurnsPerPremium !== null ? `${cycleTurnsPerPremium.toFixed(2)}x` : "-"}
          sub="over overlap days"
          tone="purple"
        />
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

      {rows.length < 2 ? (
        <p className="text-sm text-gray-400 py-8 text-center">Not enough overlap yet for a divergence view.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={rows} margin={{ top: 2, right: 12, left: -12, bottom: 0 }}>
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
              formatter={(value: unknown, name: string) => {
                const num = Number(value);
                if (name === "turnsPerPremium") return [Number.isFinite(num) ? `${num.toFixed(2)}x` : "-", "Turns / Billed"] as [string, string];
                if (name === "transcriptTurns") return [String(value ?? "-"), "Transcript Turns"] as [string, string];
                return [Number.isFinite(num) ? num.toFixed(1) : "-", "Billed Premium"] as [string, string];
              }}
              labelFormatter={(label) => String(label)}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="volume" dataKey="transcriptTurns" name="Transcript Turns" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            <Bar yAxisId="volume" dataKey="billedPremium" name="Billed Premium" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Line yAxisId="ratio" type="monotone" dataKey="turnsPerPremium" name="Turns / Billed" stroke="#7c3aed" strokeWidth={2} dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {topDivergenceDays.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Top divergence days</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Day</th>
                  <th className="pb-2 font-medium text-right">Transcript</th>
                  <th className="pb-2 font-medium text-right">Billed</th>
                  <th className="pb-2 font-medium text-right">Turns / Billed</th>
                  <th className="pb-2 font-medium">Read</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {topDivergenceDays.map((row) => (
                  <tr key={row.date} className="hover:bg-gray-50">
                    <td className="py-2 text-gray-700">{row.label}</td>
                    <td className="py-2 text-right text-gray-600">{row.transcriptTurns}</td>
                    <td className="py-2 text-right text-gray-600">{row.billedPremium?.toFixed(1) ?? "-"}</td>
                    <td className="py-2 text-right font-semibold text-purple-700">{row.turnsPerPremium?.toFixed(2)}x</td>
                    <td className="py-2 text-xs text-gray-500">{row.classification}</td>
                  </tr>
                ))}
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
  tone: "blue" | "green" | "amber" | "purple";
}) {
  const tones = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-green-200 bg-green-50 text-green-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    purple: "border-purple-200 bg-purple-50 text-purple-700",
  };

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${tones[tone]}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-lg font-semibold leading-none mt-1">{value}</p>
      <p className="text-[11px] mt-1 opacity-80">{sub}</p>
    </div>
  );
}

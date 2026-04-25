"use client";

import { useMemo, useState } from "react";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import type { ProjectionPoint } from "@/lib/statsEngine";

interface Props {
  points: ProjectionPoint[];
  planQuota: number;
  exhaustionDate: string | null;
  dailyBurnRate: number;
  avgDays: number;
  onAvgDaysChange: (d: number) => void;
  sourceLabel?: string;
  coverageDays?: number | null;
  confidenceLabel?: string;
  hideTitle?: boolean;
  embedded?: boolean;
}

const AVG_OPTIONS = [1, 3, 7, 14, 30];

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ProjectionChart({
  points,
  planQuota,
  exhaustionDate,
  dailyBurnRate,
  avgDays,
  onAvgDaysChange,
  sourceLabel = "Billed premium usage",
  coverageDays = null,
  confidenceLabel,
  hideTitle = false,
  embedded = false,
}: Props) {
  const chartData = useMemo(() => {
    return points.map((p) => {
      return {
        ...p,
        label: fmtDate(p.date),
      };
    });
  }, [points]);
  const chartKey = `${avgDays}-${chartData.length}-${planQuota}`;

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className={`${embedded ? "bg-white p-5" : "rounded-lg bg-white border border-gray-200 p-5"}`}>
      <div className="flex items-center justify-between mb-1">
        <div>
          {!hideTitle && <h2 className="text-lg font-semibold text-gray-900">Premium Usage Projection</h2>}
          <p className="text-xs text-gray-500 mt-0.5">
            {sourceLabel} vs quota this billing cycle
          </p>
          {(coverageDays !== null || confidenceLabel) && (
            <p className="text-xs text-gray-400 mt-1">
              {coverageDays !== null && `Snapshot coverage: ${coverageDays.toFixed(1)}d`}
              {coverageDays !== null && confidenceLabel && <span className="mx-1">·</span>}
              {confidenceLabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Avg over</span>
          <div className="flex gap-1">
            {AVG_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onAvgDaysChange(d)}
                className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                  avgDays === d
                    ? "bg-orange-500 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {exhaustionDate && exhaustionDate <= points[points.length - 1]?.date ? (
        <p className="text-xs text-amber-600 font-medium mb-3">
          ⚠ At {dailyBurnRate.toFixed(1)}/day pace, quota exhausted on{" "}
          {fmtDate(exhaustionDate)}
        </p>
      ) : (
        <p className="text-xs text-green-600 font-medium mb-3">
          ✓ On track — {dailyBurnRate.toFixed(1)}/day burn rate, quota lasts through cycle
        </p>
      )}

      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart key={chartKey} data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            key={`x-${chartKey}`}
            dataKey="label"
            tick={{ fontSize: 10, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
            formatter={(val, name: string) => {
              const labels: Record<string, string> = {
                actual: "Actual",
                projected: "Projected",
              };
              return [val, labels[name] ?? name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />

          {/* Plan quota ceiling */}
          <ReferenceLine
            y={planQuota}
            stroke="#ef4444"
            strokeDasharray="6 3"
            label={{
              value: `Quota: ${planQuota}`,
              position: "insideTopLeft",
              fontSize: 11,
              fill: "#ef4444",
            }}
          />

          {/* Today marker */}
          <ReferenceLine
            x={fmtDate(today)}
            stroke="#9ca3af"
            strokeDasharray="4 3"
            label={{ value: "Today", position: "insideTopRight", fontSize: 10, fill: "#9ca3af" }}
          />

          {/* Projected exhaustion */}
          {exhaustionDate && (
            <ReferenceLine
              x={fmtDate(exhaustionDate)}
              stroke="#f97316"
              strokeDasharray="4 3"
              label={{
                value: "Exhaustion",
                position: "insideTopLeft",
                fontSize: 10,
                fill: "#f97316",
              }}
            />
          )}

          <Area
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke="#3b82f6"
            fill="#bfdbfe"
            connectNulls={false}
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="projected"
            name="Projected"
            stroke="#f97316"
            strokeDasharray="6 3"
            dot={false}
            strokeWidth={2}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

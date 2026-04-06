"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface DailyBucket {
  date: string;
  requests: number;
  sessions: number;
  toolCalls: number;
}

interface Props {
  data: DailyBucket[];
  range: "7d" | "30d";
  onRangeChange: (r: "7d" | "30d") => void;
}

const RANGES = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
] as const;

function formatDateLabel(dateStr: string, range: "7d" | "30d"): string {
  const d = new Date(dateStr + "T00:00:00");
  if (range === "7d") return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ActivityTimeline({ data, range, onRangeChange }: Props) {
  const filtered =
    range === "7d" ? data.slice(-7) : data;

  const chartData = filtered.map((d) => ({
    ...d,
    label: formatDateLabel(d.date, range),
  }));

  return (
    <div className="rounded-lg bg-white border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Transcript Activity Timeline</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Assistant turns and tool calls per day from local transcripts
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => onRangeChange(r.value)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                range === r.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
            formatter={(val: number, name: string) => {
              const labels: Record<string, string> = {
                requests: "Requests",
                toolCalls: "Tool Calls",
              };
              return [val, labels[name] ?? name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="requests" name="Requests" fill="#3b82f6" radius={[3, 3, 0, 0]} />
          <Bar dataKey="toolCalls" name="Tool Calls" fill="#93c5fd" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

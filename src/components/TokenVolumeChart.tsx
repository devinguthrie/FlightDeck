"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface DailyBucket {
  date: string;
  inputTokens: number;
  outputTokens: number;
}

interface WorkspaceTokens {
  workspace: string;
  inputTokens: number;
  outputTokens: number;
}

interface Props {
  dailyBuckets: DailyBucket[];
  topWorkspacesByTokens: WorkspaceTokens[];
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

function fmtDate(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function TokenVolumeChart({ dailyBuckets, topWorkspacesByTokens }: Props) {
  const hasTokenData = dailyBuckets.some((b) => b.inputTokens > 0 || b.outputTokens > 0);
  const hasWorkspaceData = topWorkspacesByTokens.length > 0;

  if (!hasTokenData && !hasWorkspaceData) return null;

  // Thin out x-axis labels — show approximately every 5 days to avoid overlap
  const dailyData = dailyBuckets.map((b) => ({
    date: fmtDate(b.date),
    Input: b.inputTokens,
    Output: b.outputTokens,
  }));

  const workspaceData = topWorkspacesByTokens.map((w) => ({
    workspace: w.workspace.length > 22 ? "\u2026" + w.workspace.slice(-20) : w.workspace,
    Input: w.inputTokens,
    Output: w.outputTokens,
  }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* Daily token stacked bar */}
      {hasTokenData && (
        <div className="rounded-lg bg-white border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Daily Token Volume</h2>
          <p className="text-xs text-gray-500 mb-4">
            Input and output tokens per day — last 30 days. VS Code counts are transcript
            estimates; CLI counts are exact from proxy.
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={fmtTokens}
                width={40}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(val: number, name: string) => [fmtTokens(val), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="square" iconSize={10} />
              <Bar dataKey="Input" stackId="tokens" fill="#3b82f6" />
              <Bar dataKey="Output" stackId="tokens" fill="#a78bfa" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top workspaces BY token volume */}
      {hasWorkspaceData && (
        <div className="rounded-lg bg-white border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Top Workspaces by Token Volume
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Estimated input + output tokens by workspace — all sessions
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={workspaceData}
              layout="vertical"
              margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={fmtTokens}
              />
              <YAxis
                type="category"
                dataKey="workspace"
                tick={{ fontSize: 10, fill: "#374151" }}
                axisLine={false}
                tickLine={false}
                width={130}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(val: number, name: string) => [fmtTokens(val), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="square" iconSize={10} />
              <Bar dataKey="Input" stackId="ws" fill="#3b82f6" />
              <Bar dataKey="Output" stackId="ws" fill="#a78bfa" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

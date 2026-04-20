"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface ToolCount {
  name: string;
  count: number;
}

interface SkillStats {
  name: string;
  sessions: number;
  avgRequests: number;
  avgQuality: number | null;
  sampleSize: number;
  qualityPer100Req: number | null;
  liftVsBaseline: number | null;
}

interface Props {
  topTools: ToolCount[];
  skillStats: SkillStats[];
  totalRated: number;
}

function qualityPerRequest(avgQuality: number | null, avgRequests: number): number | null {
  if (avgQuality === null || avgRequests <= 0) return null;
  // Scale to per-100 requests so tiny decimals are readable.
  return (avgQuality / avgRequests) * 100;
}

const SKILL_READERS = new Set([
  "read_file",
  "fetch_webpage",
  // tools commonly used to read SKILL.md files
]);

function isCoreSkillTool(name: string): boolean {
  return SKILL_READERS.has(name);
}

export default function ToolBreakdown({ topTools, skillStats, totalRated }: Props) {
  const hasQualitySignal = totalRated >= 5;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {/* Tool call frequency chart */}
      <div className="rounded-lg bg-white border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Top Tools Used</h2>
        <p className="text-xs text-gray-500 mb-4">All-time tool call frequency</p>
        {topTools.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No tool data yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={topTools}
              layout="vertical"
              margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10, fill: "#374151" }}
                axisLine={false}
                tickLine={false}
                width={120}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(val: number) => [val, "Calls"]}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {topTools.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={isCoreSkillTool(entry.name) ? "#f97316" : "#3b82f6"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Skill ROI table */}
      <div className="rounded-lg bg-white border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Skill Impact</h2>
        <p className="text-xs text-gray-500 mb-4">
          Recognized workflow skills only. Quality columns stay hidden until 5 rated sessions.
        </p>
        {!hasQualitySignal && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Quality lift is too noisy with {totalRated} rated session{totalRated === 1 ? "" : "s"}. FlightDeck now waits for 5+ ratings before showing quality comparisons.
          </div>
        )}
        {skillStats.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            No recognized skills detected yet. FlightDeck now ignores arbitrary repo SKILL.md files.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="pb-2 font-medium">Skill</th>
                  <th className="pb-2 font-medium text-right">Sessions</th>
                  <th className="pb-2 font-medium text-right">Avg Req</th>
                  {hasQualitySignal && (
                    <>
                      <th className="pb-2 font-medium text-right">Avg Quality</th>
                      <th className="pb-2 font-medium text-right">Quality/100 Req</th>
                      <th className="pb-2 font-medium text-right">Lift vs Baseline</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {skillStats.map((s) => (
                  <tr key={s.name} className="hover:bg-gray-50">
                    <td className="py-2 font-mono text-xs text-gray-800 truncate max-w-[160px]">
                      {s.name}
                    </td>
                    <td className="py-2 text-right text-gray-600">{s.sessions}</td>
                    <td className="py-2 text-right text-gray-600">{s.avgRequests}</td>
                    {hasQualitySignal && (
                      <>
                        <td className="py-2 text-right">
                          {s.avgQuality !== null ? (
                            <span
                              className={`font-semibold ${
                                s.avgQuality >= 4
                                  ? "text-green-600"
                                  : s.avgQuality >= 3
                                  ? "text-yellow-600"
                                  : "text-red-500"
                              }`}
                            >
                              {s.avgQuality}/5
                              <span className="text-gray-400 font-normal text-[10px] ml-1">
                                n={s.sampleSize}
                              </span>
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">no ratings yet</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {qualityPerRequest(s.avgQuality, s.avgRequests) !== null ? (
                            <span className="font-semibold text-indigo-600">
                              {qualityPerRequest(s.avgQuality, s.avgRequests)!.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">-</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {s.liftVsBaseline !== null ? (
                            <span
                              className={`font-semibold ${
                                s.liftVsBaseline >= 0 ? "text-green-600" : "text-red-500"
                              }`}
                            >
                              {s.liftVsBaseline > 0 ? "+" : ""}
                              {s.liftVsBaseline.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">-</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

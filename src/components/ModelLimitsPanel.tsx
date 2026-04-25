"use client";

import { useState, useEffect, useMemo } from "react";
import type { ModelLimit, RateLimitErrorSummary } from "@/lib/db";

type LimitSortKey = "contextWindow" | "maxOutput" | "requestsPerMinute" | "concurrent";

export function ModelLimitsPanel({ hideTitle = false, embedded = false }: { hideTitle?: boolean; embedded?: boolean }) {
  const [limits, setLimits] = useState<ModelLimit[]>([]);
  const [errors, setErrors] = useState<RateLimitErrorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [limitSortKey, setLimitSortKey] = useState<LimitSortKey>("contextWindow");
  const [limitSortDir, setLimitSortDir] = useState<"asc" | "desc">("desc");

  function handleLimitSort(key: LimitSortKey) {
    if (key === limitSortKey) {
      setLimitSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setLimitSortKey(key);
      setLimitSortDir("desc");
    }
  }

  const sortedLimits = useMemo(() => {
    const arr = [...limits];
    const dir = limitSortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (limitSortKey) {
        case "contextWindow":    return dir * (a.contextWindowTokens - b.contextWindowTokens);
        case "maxOutput":        return dir * ((a.maxOutputTokens ?? 0) - (b.maxOutputTokens ?? 0));
        case "requestsPerMinute": return dir * ((a.requestsPerMinute ?? 0) - (b.requestsPerMinute ?? 0));
        case "concurrent":       return dir * ((a.concurrentRequests ?? 0) - (b.concurrentRequests ?? 0));
        default:                 return 0;
      }
    });
    return arr;
  }, [limits, limitSortKey, limitSortDir]);

  useEffect(() => {
    const fetchLimits = async () => {
      try {
        const res = await fetch("/api/model-limits");
        if (res.ok) {
          const data = await res.json();
          setLimits(data.modelLimits || []);
          setErrors(data.rateLimitErrorGroups || []);
        }
      } catch (error) {
        console.error("Failed to fetch model limits:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLimits();
    const interval = setInterval(fetchLimits, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="p-4 text-gray-600">Loading model limits...</div>;
  }

  return (
    <div className={`${embedded ? "bg-white p-4" : "p-4 border border-gray-200 rounded-lg bg-white"}`}>
      {!hideTitle && <h2 className="text-xl font-bold mb-4">Model Constraints</h2>}

      {/* Model Limits Table */}
      {limits.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Discovered Limits</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Model</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleLimitSort("contextWindow")}>
                    Context Window {limitSortKey === "contextWindow" ? (limitSortDir === "asc" ? "↑" : "↓") : <span className="text-gray-300">↕</span>}
                  </th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleLimitSort("maxOutput")}>
                    Max Output {limitSortKey === "maxOutput" ? (limitSortDir === "asc" ? "↑" : "↓") : <span className="text-gray-300">↕</span>}
                  </th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleLimitSort("requestsPerMinute")}>
                    Requests/min {limitSortKey === "requestsPerMinute" ? (limitSortDir === "asc" ? "↑" : "↓") : <span className="text-gray-300">↕</span>}
                  </th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none hover:text-gray-700 whitespace-nowrap" onClick={() => handleLimitSort("concurrent")}>
                    Concurrent {limitSortKey === "concurrent" ? (limitSortDir === "asc" ? "↑" : "↓") : <span className="text-gray-300">↕</span>}
                  </th>
                  <th className="px-3 py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {sortedLimits.map((limit) => (
                  <tr key={limit.modelName} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{limit.modelName}</td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {limit.contextWindowTokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {limit.maxOutputTokens ? limit.maxOutputTokens.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {limit.requestsPerMinute ? limit.requestsPerMinute.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {limit.concurrentRequests ? limit.concurrentRequests.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {limit.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rate Limit Errors */}
      {errors.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-2">
            Rate Limit Events ({errors.length} grouped issue{errors.length === 1 ? "" : "s"} in last 7 days)
          </h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {errors.map((error) => (
              <details key={`${error.model}-${error.errorCode}-${error.errorMessage}`} className="rounded border border-amber-200 bg-amber-50">
                <summary className="cursor-pointer list-none p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-gray-700">{error.model}</span>
                        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          {error.count} event{error.count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-amber-900">
                        {error.errorCode}: {error.errorMessage}
                      </div>
                    </div>
                    <span className="text-xs text-gray-500">
                      Latest {new Date(error.latestTs).toLocaleString()}
                    </span>
                  </div>
                </summary>
                <div className="border-t border-amber-200 px-3 py-2">
                  <p className="mb-2 text-[11px] uppercase tracking-wide text-amber-700">Occurrences</p>
                  <div className="space-y-2">
                    {error.occurrences
                      .reduce<Array<{ ts: string; count: number; rateLimitRemaining: number | null; rateLimitReset: string | null }>>(
                        (acc, occ) => {
                          const existing = acc.find((g) => g.ts === occ.ts);
                          if (existing) { existing.count += 1; }
                          else { acc.push({ ts: occ.ts, count: 1, rateLimitRemaining: occ.rateLimitRemaining, rateLimitReset: occ.rateLimitReset }); }
                          return acc;
                        },
                        [],
                      )
                      .map((occurrence) => (
                        <div
                          key={`${error.model}-${error.errorCode}-${occurrence.ts}`}
                          className="rounded border border-white/80 bg-white/70 px-3 py-2 text-xs text-gray-600"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-700">{new Date(occurrence.ts).toLocaleString()}</span>
                            {occurrence.count > 1 && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                ×{occurrence.count}
                              </span>
                            )}
                          </div>
                          {(occurrence.rateLimitRemaining !== null || occurrence.rateLimitReset) && (
                            <div className="mt-1">
                              {occurrence.rateLimitRemaining !== null && `Remaining: ${occurrence.rateLimitRemaining}`}
                              {occurrence.rateLimitRemaining !== null && occurrence.rateLimitReset && " • "}
                              {occurrence.rateLimitReset && `Reset: ${new Date(occurrence.rateLimitReset).toLocaleTimeString()}`}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {limits.length === 0 && errors.length === 0 && (
        <div className="text-gray-500 text-center py-8">
          No model limits discovered yet. Limits will appear as they are discovered from API responses.
        </div>
      )}
    </div>
  );
}

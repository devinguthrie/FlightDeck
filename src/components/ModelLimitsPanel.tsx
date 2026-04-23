"use client";

import { useState, useEffect } from "react";

interface ModelLimit {
  modelName: string;
  contextWindowTokens: number;
  maxOutputTokens: number | null;
  requestsPerMinute: number | null;
  concurrentRequests: number | null;
  discoveredAt: string;
  lastUpdatedAt: string;
  source: string;
}

interface RateLimitError {
  model: string;
  errorCode: string;
  errorMessage: string;
  count: number;
  latestTs: string;
  occurrences: Array<{
    ts: string;
    rateLimitRemaining: number | null;
    rateLimitReset: string | null;
  }>;
}

export function ModelLimitsPanel({ hideTitle = false, embedded = false }: { hideTitle?: boolean; embedded?: boolean }) {
  const [limits, setLimits] = useState<ModelLimit[]>([]);
  const [errors, setErrors] = useState<RateLimitError[]>([]);
  const [loading, setLoading] = useState(true);

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
                  <th className="px-3 py-2 text-right">Context Window</th>
                  <th className="px-3 py-2 text-right">Max Output</th>
                  <th className="px-3 py-2 text-right">Requests/min</th>
                  <th className="px-3 py-2 text-right">Concurrent</th>
                  <th className="px-3 py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {limits.map((limit) => (
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
                    {error.occurrences.map((occurrence, index) => (
                      <div
                        key={`${error.model}-${error.errorCode}-${occurrence.ts}-${index}`}
                        className="rounded border border-white/80 bg-white/70 px-3 py-2 text-xs text-gray-600"
                      >
                        <div className="font-medium text-gray-700">{new Date(occurrence.ts).toLocaleString()}</div>
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

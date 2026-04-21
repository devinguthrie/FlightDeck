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
  ts: string;
  model: string;
  errorCode: string;
  errorMessage: string;
  rateLimitRemaining: number | null;
  rateLimitReset: string | null;
}

export function ModelLimitsPanel() {
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
          setErrors(data.recentRateLimitErrors || []);
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
    <div className="p-4 border border-gray-200 rounded-lg bg-white">
      <h2 className="text-xl font-bold mb-4">Model Constraints</h2>

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
            Rate Limit Events ({errors.length} in last 7 days)
          </h3>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {errors.map((error, idx) => (
              <div key={idx} className="p-3 bg-amber-50 border border-amber-200 rounded">
                <div className="flex justify-between items-start mb-1">
                  <span className="font-mono text-sm text-gray-700">{error.model}</span>
                  <span className="text-xs text-gray-500">
                    {new Date(error.ts).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm font-semibold text-amber-900 mb-1">
                  {error.errorCode}: {error.errorMessage}
                </div>
                {error.rateLimitRemaining !== null && (
                  <div className="text-xs text-gray-600">
                    Remaining: {error.rateLimitRemaining}
                    {error.rateLimitReset && ` • Reset: ${new Date(error.rateLimitReset).toLocaleTimeString()}`}
                  </div>
                )}
              </div>
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

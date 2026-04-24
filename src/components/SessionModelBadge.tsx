"use client";

import { useState, useEffect } from "react";

interface SessionModelInfo {
  sessionId: string;
  activeModel: string | null;
  usedModels: string[];
}

/**
 * Displays the active model and all models used during a session.
 * Updates in real-time as models are discovered.
 */
export function SessionModelBadge({ sessionId }: { sessionId: string }) {
  const [modelInfo, setModelInfo] = useState<SessionModelInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchModelInfo = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/active-model`);
        if (res.ok) {
          const data = await res.json();
          setModelInfo(data);
        }
      } catch (error) {
        console.error("Failed to fetch model info:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchModelInfo();
    // Poll every 5 seconds during active sessions
    const interval = setInterval(fetchModelInfo, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  if (loading || !modelInfo) {
    return null;
  }

  if (!modelInfo.activeModel && modelInfo.usedModels.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {modelInfo.activeModel && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-full text-xs font-medium text-blue-700">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0 animate-pulse" />
          {modelInfo.activeModel}
        </div>
      )}
      {modelInfo.usedModels.length > 1 && (
        <div className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-600">
          <span className="font-medium">{modelInfo.usedModels.length} models</span>
          <div className="hidden group-hover:block absolute bg-white border rounded-lg p-2 shadow-lg z-10">
            {modelInfo.usedModels.map((model) => (
              <div key={model} className="text-xs font-mono text-gray-700">
                {model}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

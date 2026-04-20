"use client";

import { useMemo, useState } from "react";

interface Session {
  sessionId: string;
  workspaceName: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  activeMinutes: number;
  premiumRequests: number;
  toolCallsTotal: number;
  skillsActivated: string[];
  estimatedTotalTokens: number;
  rating: {
    quality: number;
    taskCompleted: string;
    note: string;
  } | null;
}

interface Props {
  sessions: Session[];
  onRated: () => void; // trigger parent re-fetch
}

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          className={`text-lg leading-none transition-colors ${
            star <= (hover || value) ? "text-yellow-400" : "text-gray-200"
          }`}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(star)}
          aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function RatingCell({
  session,
  onRated,
}: {
  session: Session;
  onRated: () => void;
}) {
  const [quality, setQuality] = useState<number>(session.rating?.quality ?? 0);
  const [taskCompleted, setTaskCompleted] = useState<"yes" | "partial" | "no">(
    (session.rating?.taskCompleted as "yes" | "partial" | "no") ?? "yes"
  );
  const [note, setNote] = useState(session.rating?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  async function save() {
    if (quality === 0) return;
    setSaving(true);
    try {
      await fetch(`/api/sessions/${session.sessionId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quality, taskCompleted, note }),
      });
      onRated();
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {session.rating ? (
          <div
            className="flex gap-0.5 cursor-pointer"
            onClick={() => setOpen(true)}
            title="Click to update rating"
          >
            {[1, 2, 3, 4, 5].map((s) => (
              <span
                key={s}
                className={`text-base leading-none ${
                  s <= session.rating!.quality ? "text-yellow-400" : "text-gray-200"
                }`}
              >
                ★
              </span>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="text-xs text-blue-500 hover:text-blue-700 font-medium"
          >
            Rate
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-w-[200px] p-2 border border-gray-200 rounded-md bg-gray-50">
      <StarRating value={quality} onChange={setQuality} />
      <div className="flex gap-1">
        {(["yes", "partial", "no"] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setTaskCompleted(opt)}
            className={`px-2 py-0.5 text-xs rounded capitalize font-medium ${
              taskCompleted === opt
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-100"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
      />
      <div className="flex gap-1">
        <button
          onClick={save}
          disabled={saving || quality === 0}
          className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function SessionList({ sessions, onRated }: Props) {
  const [showUnratedOnly, setShowUnratedOnly] = useState(false);
  const [now] = useState(() => Date.now());

  const thresholds = useMemo(() => {
    const sortedRequests = [...sessions].map((s) => s.premiumRequests).sort((a, b) => a - b);
    const sortedDuration = [...sessions].map((s) => s.durationMinutes).sort((a, b) => a - b);
    const overheads = [...sessions]
      .map((s) => (s.premiumRequests > 0 ? s.toolCallsTotal / s.premiumRequests : 0))
      .sort((a, b) => a - b);

    function percentile(values: number[], p: number): number {
      if (values.length === 0) return 0;
      const idx = Math.min(values.length - 1, Math.floor(values.length * p));
      return values[idx];
    }

    return {
      highRequests: percentile(sortedRequests, 0.85),
      highDuration: percentile(sortedDuration, 0.85),
      highOverhead: percentile(overheads, 0.85),
    };
  }, [sessions]);

  const filtered = showUnratedOnly
    ? sessions.filter((s) => !s.rating)
    : sessions;

  function sessionFlags(s: Session): string[] {
    const flags: string[] = [];
    const overhead = s.premiumRequests > 0 ? s.toolCallsTotal / s.premiumRequests : 0;

    if (s.premiumRequests >= thresholds.highRequests && thresholds.highRequests > 0) {
      flags.push("High chatter");
    }
    if (overhead >= thresholds.highOverhead && thresholds.highOverhead > 0) {
      flags.push("Tool-heavy");
    }
    if (s.durationMinutes >= thresholds.highDuration && thresholds.highDuration > 0) {
      flags.push("Long-open");
    }
    if (s.rating && s.rating.quality <= 2 && s.premiumRequests >= thresholds.highRequests) {
      flags.push("Potential waste");
    }
    if (s.rating && s.rating.quality >= 4 && s.premiumRequests < thresholds.highRequests / 2) {
      flags.push("Efficient win");
    }

    return flags;
  }

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function fmtDuration(m: number): string {
    if (m < 1) return "<1 min";
    if (m < 60) return `${Math.round(m)}m`;
    return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  }

  function isRecentlyActive(iso: string): boolean {
    return now - new Date(iso).getTime() < 15 * 60 * 1000;
  }

  return (
    <div className="rounded-lg bg-white border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Sessions</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {sessions.length} sessions found — span is first-to-last event time, so long sessions can include idle time
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showUnratedOnly}
            onChange={(e) => setShowUnratedOnly(e.target.checked)}
            className="rounded"
          />
          Unrated only
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          {showUnratedOnly ? "All sessions are rated!" : "No sessions found yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="pb-2 font-medium">Last Activity</th>
                <th className="pb-2 font-medium">Workspace</th>
                <th className="pb-2 font-medium text-right">Req~</th>
                <th className="pb-2 font-medium text-right">Tools</th>
                <th className="pb-2 font-medium text-right">Tokens~</th>
                <th className="pb-2 font-medium text-right">Open Span</th>
                <th className="pb-2 font-medium">Skills</th>
                <th className="pb-2 font-medium">Flags</th>
                <th className="pb-2 font-medium">Quality</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.slice(0, 100).map((s) => (
                <tr key={s.sessionId} className="hover:bg-gray-50">
                  <td className="py-2.5 text-gray-700 text-xs whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span>{fmtTime(s.endedAt)}</span>
                      {isRecentlyActive(s.endedAt) && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-green-100 text-green-700 font-medium">
                          active
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400">started {fmtTime(s.startedAt)}</div>
                  </td>
                  <td className="py-2.5 text-gray-600 text-xs font-mono truncate max-w-[120px]">
                    {s.workspaceName}
                  </td>
                  <td className="py-2.5 text-right font-semibold text-blue-600">
                    {s.premiumRequests}
                  </td>
                  <td className="py-2.5 text-right text-gray-500">{s.toolCallsTotal}</td>
                  <td className="py-2.5 text-right text-gray-400 text-xs">
                    ~{(s.estimatedTotalTokens / 1000).toFixed(1)}k
                  </td>
                  <td className="py-2.5 text-right text-gray-500 text-xs whitespace-nowrap">
                    <div>{fmtDuration(s.durationMinutes)}</div>
                    <div className="text-[10px] text-gray-400">active {fmtDuration(s.activeMinutes)}</div>
                  </td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-1 max-w-[160px]">
                      {s.skillsActivated.map((skill) => (
                        <span
                          key={skill}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-purple-100 text-purple-700 font-mono"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5">
                    <div className="flex flex-wrap gap-1 max-w-[180px]">
                      {sessionFlags(s).length > 0 ? (
                        sessionFlags(s).map((flag) => (
                          <span
                            key={flag}
                            className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${
                              flag === "Potential waste"
                                ? "bg-red-100 text-red-700"
                                : flag === "Efficient win"
                                ? "bg-green-100 text-green-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {flag}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-gray-300">-</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5">
                    <RatingCell session={s} onRated={onRated} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <p className="text-xs text-gray-400 text-center mt-3">
              Showing 100 of {filtered.length} sessions
            </p>
          )}
        </div>
      )}
    </div>
  );
}

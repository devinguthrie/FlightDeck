"use client";

import { useState } from "react";
import { PLANS } from "@/lib/pricing";
import type { PlanKey } from "@/lib/pricing";

interface Config {
  plan: PlanKey;
  billingCycleStartDay: number;
  additionalRequests: number;
  planQuota: number;
}

interface Props {
  config: Config;
  onSaved: (c: Config) => void;
}

export default function ConfigPanel({ config, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<PlanKey>(config.plan);
  const [startDay, setStartDay] = useState(String(config.billingCycleStartDay));
  const [extra, setExtra] = useState(String(config.additionalRequests));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          billingCycleStartDay: Number(startDay),
          additionalRequests: Number(extra),
        }),
      });
      if (res.ok) {
        const saved = (await res.json()) as Config;
        onSaved(saved);
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
        title="Configure plan & billing"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Settings
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 bg-white border border-gray-200 rounded-xl shadow-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Plan Configuration</h3>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Copilot Plan</label>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value as PlanKey)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:border-blue-400"
              >
                {Object.entries(PLANS).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">
                Find your plan at github.com/settings/billing
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Billing Cycle Start Day
              </label>
              <input
                type="number"
                min={1}
                max={28}
                value={startDay}
                onChange={(e) => setStartDay(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:border-blue-400"
              />
              <p className="text-[10px] text-gray-400 mt-1">
                Day of month your billing cycle resets (1–28)
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Additional Purchased Requests
              </label>
              <input
                type="number"
                min={0}
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 text-sm bg-blue-600 text-white py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

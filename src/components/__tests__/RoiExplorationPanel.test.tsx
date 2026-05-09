// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RoiExplorationPanel, { buildAxisTicks } from "@/components/RoiExplorationPanel";

describe("buildAxisTicks", () => {
  it("creates multiple evenly spaced ticks for dense 24h raw charts", () => {
    const points = Array.from({ length: 96 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 3, 21, 0, index * 15)).toISOString(),
    }));

    const ticks = buildAxisTicks(points, "24h", "raw");

    expect(ticks).toHaveLength(8);
    expect(ticks[0]).toBe(points[0].timestamp);
    expect(ticks.at(-1)).toBe(points.at(-1)?.timestamp);
  });
});

describe("RoiExplorationPanel live stats", () => {
  it("defaults the live premium panel open and derives today's stats from intraday data", () => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T21:14:00.000Z"));

    render(
      <RoiExplorationPanel
        hideTitle
        embedded
        dailyBuckets={[]}
        quotaTimeSeries={[
          { timestamp: "2026-04-20T20:00:00.000Z", chatUsed: 0, completionsUsed: 0, premiumUsed: 100 },
          { timestamp: "2026-04-21T08:00:00.000Z", chatUsed: 0, completionsUsed: 0, premiumUsed: 108 },
          { timestamp: "2026-04-21T21:00:00.000Z", chatUsed: 0, completionsUsed: 0, premiumUsed: 112 },
        ]}
        chatEntitlement={0}
        completionsEntitlement={0}
        premiumEntitlement={300}
        quotaResetDate="2026-04-30T00:00:00.000Z"
        intradayBuckets={[
          { hour: "2026-04-21T10:00", transcriptTurns: 40, toolCalls: 3 },
          { hour: "2026-04-21T15:00", transcriptTurns: 60, toolCalls: 4 },
        ]}
        cycleUserTurns={0}
        cycleAssistantTurns={0}
        cycleToolCalls={0}
        cycleDurationMinutes={0}
        cycleActiveMinutes={0}
        premiumBurnPerUserPrompt={null}
        toolOverheadRatio={0}
        promptEfficiencyPer100Turns={null}
        qualityToolOverheadCorrelation={null}
        marginalQualityCurve={[]}
        quotaAgeMinutes={5}
        totalRated={0}
        skillStats={[]}
      />
    );

    expect(screen.getByText("Turns / Premium (7d)")).toBeInTheDocument();
    expect(screen.getByText("Transcript turns (7d)")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("12.00")).toBeInTheDocument();
    expect(screen.getByText("8.3×")).toBeInTheDocument();
    expect(screen.getByText(/Last updated 5m ago/)).toBeInTheDocument();
    expect(screen.getByText(/amber dashed = burn per interval/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "24h" })[0]);
    expect(screen.getByText("Premium burned (24h)")).toBeInTheDocument();
    expect(screen.getByText("4.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Daily" }));
    expect(screen.getByText(/1 points? · 24h · daily/)).toBeInTheDocument();

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});

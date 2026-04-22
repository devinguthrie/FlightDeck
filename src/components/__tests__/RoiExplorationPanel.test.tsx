// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RoiExplorationPanel from "@/components/RoiExplorationPanel";

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
          { timestamp: "2026-04-20T23:50:00.000Z", premiumUsed: 100 },
          { timestamp: "2026-04-21T08:00:00.000Z", premiumUsed: 108 },
          { timestamp: "2026-04-21T21:00:00.000Z", premiumUsed: 112 },
        ]}
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

    expect(screen.getByText("Transcript turns today")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("12.00")).toBeInTheDocument();
    expect(screen.getByText("8.3×")).toBeInTheDocument();

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});

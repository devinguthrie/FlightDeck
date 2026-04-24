// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import DivergencePanel from "@/components/DivergencePanel";

describe("DivergencePanel", () => {
  it("drops the turns-per-billed card and preserves the current range when clicking a day", () => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const dailyBuckets = Array.from({ length: 20 }, (_, index) => ({
      date: `2026-04-${String(index + 1).padStart(2, "0")}`,
      requests: index === 9 ? 320 : 60 + index,
      sessions: 1,
      toolCalls: 0,
    }));

    const quotaTimeSeries = dailyBuckets.flatMap((bucket, index) => {
      const base = 100 + index * 5;
      const delta = index === 9 ? 8 : 24;
      return [
        { timestamp: `${bucket.date}T08:00:00.000Z`, premiumUsed: base },
        { timestamp: `${bucket.date}T23:45:00.000Z`, premiumUsed: base + delta },
      ];
    });

    render(
      <DivergencePanel
        embedded
        hideTitle
        dailyBuckets={dailyBuckets}
        quotaTimeSeries={quotaTimeSeries}
        intradayBuckets={[]}
      />,
    );

    expect(screen.queryByText("Turns / Billed")).not.toBeInTheDocument();
    expect(screen.getByText("Premium efficiency trend (24h)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Apr 10"));

    expect(screen.getByText("Premium efficiency trend (24h)")).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  it("does not change the chart range on hover alone", () => {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const dailyBuckets = Array.from({ length: 20 }, (_, index) => ({
      date: `2026-04-${String(index + 1).padStart(2, "0")}`,
      requests: index === 9 ? 320 : 60 + index,
      sessions: 1,
      toolCalls: 0,
    }));

    const quotaTimeSeries = dailyBuckets.flatMap((bucket, index) => {
      const base = 100 + index * 5;
      const delta = index === 9 ? 8 : 24;
      return [
        { timestamp: `${bucket.date}T08:00:00.000Z`, premiumUsed: base },
        { timestamp: `${bucket.date}T23:45:00.000Z`, premiumUsed: base + delta },
      ];
    });

    render(
      <DivergencePanel
        embedded
        hideTitle
        dailyBuckets={dailyBuckets}
        quotaTimeSeries={quotaTimeSeries}
        intradayBuckets={[]}
      />,
    );

    const hoveredRow = screen.getByText("Apr 10");
    fireEvent.mouseEnter(hoveredRow.closest("tr")!);

    expect(screen.getByText("Premium efficiency trend (24h)")).toBeInTheDocument();

    fireEvent.mouseLeave(hoveredRow.closest("tr")!);

    expect(screen.getByText("Premium efficiency trend (24h)")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});

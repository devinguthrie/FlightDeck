// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ data, children }: { data: Array<{ label: string }>; children: ReactNode }) => (
    <div data-testid="chart-data">{JSON.stringify(data.map((row) => row.label))}{children}</div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Line: () => null,
  Bar: () => null,
  ReferenceArea: () => null,
}));

import DivergencePanel from "@/components/DivergencePanel";

describe("DivergencePanel windowing", () => {
  it("keeps the active daily range while shifting the slice to the selected day", () => {
    const dailyBuckets = Array.from({ length: 30 }, (_, index) => ({
      date: `2026-04-${String(index + 1).padStart(2, "0")}`,
      requests: index === 4 || index === 24 ? 320 : 60 + index,
      sessions: 1,
      toolCalls: 0,
    }));

    const quotaTimeSeries = dailyBuckets.flatMap((bucket, index) => {
      const base = 100 + index * 5;
      const delta = index === 4 || index === 24 ? 8 : 24;
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

    fireEvent.click(screen.getByText("7d"));
    fireEvent.click(screen.getByText("Apr 5"));
    expect(screen.getByText("Premium efficiency trend (7d)")).toBeInTheDocument();
    expect(screen.getByTestId("chart-data")).toHaveTextContent(
      JSON.stringify(["Apr 2", "Apr 3", "Apr 4", "Apr 5", "Apr 6", "Apr 7", "Apr 8"]),
    );

    fireEvent.click(screen.getByText("Apr 25"));
    expect(screen.getByText("Premium efficiency trend (7d)")).toBeInTheDocument();
    expect(screen.getByTestId("chart-data")).toHaveTextContent(
      JSON.stringify(["Apr 22", "Apr 23", "Apr 24", "Apr 25", "Apr 26", "Apr 27", "Apr 28"]),
    );

    fireEvent.click(screen.getByText("Today"));
    expect(screen.getByTestId("chart-data")).toHaveTextContent(
      JSON.stringify(["Apr 24", "Apr 25", "Apr 26", "Apr 27", "Apr 28", "Apr 29", "Apr 30"]),
    );
  });

  it("shows the selected day in hourly ranges without changing the chosen range", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T12:00:00.000Z"));

    const hourlyPoints = Array.from({ length: 72 }, (_, index) => {
      const day = index < 24 ? "2026-04-04" : index < 48 ? "2026-04-05" : "2026-04-06";
      const hour = String(index % 24).padStart(2, "0");
      return {
        hour: `${day}T${hour}:00`,
        transcriptTurns: 10 + index,
        toolCalls: 0,
      };
    });

    const dailyBuckets = [
      { date: "2026-04-04", requests: 120, sessions: 1, toolCalls: 0 },
      { date: "2026-04-05", requests: 160, sessions: 1, toolCalls: 0 },
      { date: "2026-04-06", requests: 140, sessions: 1, toolCalls: 0 },
    ];

    const quotaTimeSeries = hourlyPoints.flatMap((point, index) => [
      { timestamp: `${point.hour}:00.000Z`, premiumUsed: index * 2 },
      { timestamp: `${point.hour}:30.000Z`, premiumUsed: index * 2 + 1 },
    ]);

    render(
      <DivergencePanel
        embedded
        hideTitle
        dailyBuckets={dailyBuckets}
        quotaTimeSeries={quotaTimeSeries}
        intradayBuckets={hourlyPoints}
      />,
    );

    fireEvent.click(screen.getByText("Apr 5"));
    expect(screen.getByText("Premium efficiency trend (24h)")).toBeInTheDocument();
    expect(screen.getByTestId("chart-data")).toHaveTextContent("Apr 5 23:00");

    fireEvent.click(screen.getByText("12h"));
    expect(screen.getByText("Premium efficiency trend (12h)")).toBeInTheDocument();
    expect(screen.getByTestId("chart-data")).toHaveTextContent("Apr 5 12:00");
    expect(screen.getByTestId("chart-data")).not.toHaveTextContent("Apr 4 23:00");

    fireEvent.click(screen.getByText("3h"));
    expect(screen.getByText("Premium efficiency trend (3h)")).toBeInTheDocument();
    expect(screen.getByTestId("chart-data")).toHaveTextContent("Apr 5 21:00");

    fireEvent.click(screen.getByText("Today"));
    expect(screen.getByText("Premium efficiency trend (3h)")).toBeInTheDocument();
    expect(screen.getByTestId("chart-data")).not.toHaveTextContent("Apr 5");
    expect(screen.getByText("Today")).toBeDisabled();

    vi.useRealTimers();
  });
});

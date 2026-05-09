// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

let latestProjectionProps: { points?: Array<{ date: string; actual: number | null; projected: number | null }> } = {};

vi.mock("@/components/ActivityTimeline", () => ({
  default: () => <div>ActivityTimeline</div>,
}));
vi.mock("@/components/DivergencePanel", () => ({
  default: () => <div>DivergencePanel</div>,
}));
vi.mock("@/components/ProjectionChart", () => ({
  default: (props: { points: Array<{ date: string; actual: number | null; projected: number | null }> }) => {
    latestProjectionProps = props;
    return <div>ProjectionChart</div>;
  },
}));
vi.mock("@/components/QuotaChart", () => ({
  default: () => <div>QuotaChart</div>,
}));
vi.mock("@/components/RoiExplorationPanel", () => ({
  default: () => <div>RoiExplorationPanel</div>,
  PremiumUsagePanel: () => <div>PremiumUsagePanel</div>,
}));
vi.mock("@/components/ToolBreakdown", () => ({
  default: () => <div>ToolBreakdown</div>,
}));
vi.mock("@/components/SessionList", () => ({
  default: () => <div>SessionList</div>,
}));
vi.mock("@/components/TokenVolumeChart", () => ({
  default: () => <div>TokenVolumeChart</div>,
}));
vi.mock("@/components/ModelLimitsPanel", () => ({
  ModelLimitsPanel: () => <div>ModelLimitsPanel</div>,
}));

vi.mock("@/lib/useTheme", () => ({
  useTheme: () => ["light", vi.fn()] as const,
}));

import Dashboard from "@/app/page";

const STATS_RESPONSE = {
  cycleStart: "2026-04-01T00:00:00.000Z",
  cycleEnd: "2026-04-30T00:00:00.000Z",
  requestsThisCycle: 42,
  planQuota: 300,
  requestsRemaining: 258,
  daysRemainingEstimate: 20,
  projectedExhaustionDate: null,
  dailyBurnRate: 2,
  cycleUserTurns: 10,
  cycleAssistantTurns: 10,
  cycleToolCalls: 4,
  cycleDurationMinutes: 30,
  cycleActiveMinutes: 12,
  premiumBurnPerUserPrompt: 1,
  requestDensityPerMinute: 1,
  toolOverheadRatio: 0.4,
  promptEfficiencyPer100Turns: 1,
  qualityToolOverheadCorrelation: null,
  dailyBuckets: [],
  intradayBuckets: [],
  projectionPoints: [],
  topTools: [],
  skillStats: [],
  marginalQualityCurve: [],
  totalSessions: 1,
  totalRequests: 10,
  totalRated: 0,
  avgQuality: null,
  sevenDayRequests: 12,
  sevenDayBurnRate: 1.7,
  avgContextSaturation: null,
  toolLatencies: [],
  proxyStats: {
    totalRequests: 10,
    cliRequests: 3,
    vscodeRequests: 10,
    proxyActive: false,
    cliActive: false,
    lastCapturedAt: null,
    modelBreakdown: [
      {
        model: "gpt-4.1",
        count: 10,
        avgLatencyMs: 1234,
        totalPromptTokens: 24500000,
        totalCompletionTokens: 181000,
      },
    ],
    tokenAccuracy: {
      exactTotalTokens: 246750,
      estimatedTotalTokens: 331200,
      accuracyRatio: 0.74,
    },
  },
  outputInputRatio: 0.007,
  topWorkspacesByTokens: [],
};

const CONFIG_RESPONSE = {
  plan: "pro",
  billingCycleStartDay: 1,
  additionalRequests: 0,
  planQuota: 300,
};

describe("Dashboard page", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/stats")) {
        return {
          ok: true,
          json: async () => STATS_RESPONSE,
        } as Response;
      }
      if (url === "/api/sessions") {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }
      if (url === "/api/config") {
        return {
          ok: true,
          json: async () => CONFIG_RESPONSE,
        } as Response;
      }
      if (url === "/api/quota-snapshots") {
        return {
          ok: false,
        } as Response;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    latestProjectionProps = {};
  });

  it("keeps the proxy capture shell visible when no captures exist yet", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/stats")) {
        return {
          ok: true,
          json: async () => ({
            ...STATS_RESPONSE,
            proxyStats: {
              ...STATS_RESPONSE.proxyStats,
              totalRequests: 0,
              cliRequests: 0,
              modelBreakdown: [],
            },
          }),
        } as Response;
      }
      if (url === "/api/sessions") {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }
      if (url === "/api/config") {
        return {
          ok: true,
          json: async () => CONFIG_RESPONSE,
        } as Response;
      }
      if (url === "/api/quota-snapshots") {
        return {
          ok: false,
        } as Response;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<Dashboard />);

    expect(await screen.findByRole("button", { name: "Collapse Proxy Capture" })).toBeInTheDocument();
    expect(await screen.findByText("MITM Proxy — not set up")).toBeInTheDocument();
    expect(
      screen.getByText(/capture exact token counts and track Copilot CLI requests/i)
    ).toBeInTheDocument();
  });

  it("renders collapsible module buttons and collapses individual modules", async () => {
    render(<Dashboard />);

    expect(await screen.findByRole("button", { name: "Collapse Premium Usage Projection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Sessions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse KPIs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse Diagnostics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse Evidence" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Premium Usage Projection" }));

    expect(screen.getByRole("button", { name: "Expand Premium Usage Projection" })).toBeInTheDocument();
    expect(screen.queryByText("ProjectionChart")).not.toBeInTheDocument();
  });

  it("does not overwrite the saved plan from detected quota data", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/stats")) {
        return {
          ok: true,
          json: async () => STATS_RESPONSE,
        } as Response;
      }
      if (url === "/api/sessions") {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }
      if (url === "/api/config") {
        if (init?.method === "PUT") {
          throw new Error("Dashboard should not auto-save plan from quota data");
        }
        return {
          ok: true,
          json: async () => CONFIG_RESPONSE,
        } as Response;
      }
      if (url === "/api/quota-snapshots") {
        return {
          ok: true,
          json: async () => ({
            available: true,
            latestRecordedAt: "2026-04-21T12:00:00.000Z",
            ageMinutes: 5,
            chatEntitlement: 0,
            chatUsed: 0,
            chatRemaining: 0,
            completionsEntitlement: 0,
            completionsUsed: 0,
            completionsRemaining: 0,
            premiumEntitlement: 1500,
            premiumUsed: 20,
            premiumRemaining: 1480,
            quotaResetDate: "2026-04-20",
            copilotPlan: "business",
            timeSeries: [],
          }),
        } as Response;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<Dashboard />);

    expect(await screen.findByRole("button", { name: /settings/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input) === "/api/config" && init?.method === "PUT"
        )
      ).toBe(false)
    );
  });

  it("anchors the projected line to the latest billed usage point", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/stats")) {
        return {
          ok: true,
          json: async () => STATS_RESPONSE,
        } as Response;
      }
      if (url === "/api/sessions") {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }
      if (url === "/api/config") {
        return {
          ok: true,
          json: async () => CONFIG_RESPONSE,
        } as Response;
      }
      if (url === "/api/quota-snapshots") {
        return {
          ok: true,
          json: async () => ({
            available: true,
            latestRecordedAt: "2026-04-21T12:00:00.000Z",
            ageMinutes: 5,
            chatEntitlement: 0,
            chatUsed: 0,
            chatRemaining: 0,
            completionsEntitlement: 0,
            completionsUsed: 0,
            completionsRemaining: 0,
            premiumEntitlement: 1500,
            premiumUsed: 850,
            premiumRemaining: 650,
            quotaResetDate: "2026-04-18",
            copilotPlan: "pro+",
            timeSeries: [
              { timestamp: "2026-04-18T08:00:00.000Z", chatUsed: 0, completionsUsed: 0, premiumUsed: 300 },
              { timestamp: "2026-04-19T08:00:00.000Z", chatUsed: 0, completionsUsed: 0, premiumUsed: 700 },
              { timestamp: "2026-04-21T12:00:00.000Z", chatUsed: 0, completionsUsed: 0, premiumUsed: 850 },
            ],
          }),
        } as Response;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<Dashboard />);

    expect(await screen.findByText("ProjectionChart")).toBeInTheDocument();

    const points = latestProjectionProps.points ?? [];
    const lastActualPoint = [...points].reverse().find((point) => point.actual !== null);
    expect(lastActualPoint).toEqual({
      date: "2026-04-21",
      actual: 850,
      projected: 850,
    });
  });

  it("paginates tool latency with 10 rows per page", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/stats")) {
        return {
          ok: true,
          json: async () => ({
            ...STATS_RESPONSE,
            toolLatencies: Array.from({ length: 12 }, (_, index) => ({
              name: `tool-${index + 1}`,
              count: index + 1,
              avgMs: 100 + index,
              p50Ms: 90 + index,
              p95Ms: 150 + index,
            })),
          }),
        } as Response;
      }
      if (url === "/api/sessions") {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }
      if (url === "/api/config") {
        return {
          ok: true,
          json: async () => CONFIG_RESPONSE,
        } as Response;
      }
      if (url === "/api/quota-snapshots") {
        return {
          ok: false,
        } as Response;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<Dashboard />);

    // Default sort is count desc — tool-12 (count=12) first, tool-1 (count=1) last
    expect(await screen.findByText("tool-12")).toBeInTheDocument();
    expect(screen.getByText("tool-3")).toBeInTheDocument();
    expect(screen.queryByText("tool-1")).not.toBeInTheDocument();
    expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("tool-1")).toBeInTheDocument();
    expect(screen.getByText("tool-2")).toBeInTheDocument();
    expect(screen.queryByText("tool-12")).not.toBeInTheDocument();
  });
});

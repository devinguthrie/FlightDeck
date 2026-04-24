import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  parseIntradayActivityMock,
  getAllSessionsFromDbMock,
  getAllRatingsFromDbMock,
  getAllProxyRequestsFromDbMock,
  getConfigMock,
  computeStatsMock,
} = vi.hoisted(() => ({
  parseIntradayActivityMock: vi.fn(),
  getAllSessionsFromDbMock: vi.fn(),
  getAllRatingsFromDbMock: vi.fn(),
  getAllProxyRequestsFromDbMock: vi.fn(),
  getConfigMock: vi.fn(),
  computeStatsMock: vi.fn(),
}));

vi.mock("@/lib/transcriptParser", () => ({
  parseIntradayActivity: parseIntradayActivityMock,
}));

vi.mock("@/lib/db", () => ({
  getAllSessionsFromDb: getAllSessionsFromDbMock,
  getAllRatingsFromDb: getAllRatingsFromDbMock,
  getAllProxyRequestsFromDb: getAllProxyRequestsFromDbMock,
}));

vi.mock("@/lib/storage", () => ({
  getConfig: getConfigMock,
}));

vi.mock("@/lib/statsEngine", () => ({
  computeStats: computeStatsMock,
}));

import { GET, INTRADAY_HISTORY_HOURS } from "./route";

describe("GET /api/stats", () => {
  beforeEach(() => {
    parseIntradayActivityMock.mockReset();
    getAllSessionsFromDbMock.mockReset();
    getAllRatingsFromDbMock.mockReset();
    getAllProxyRequestsFromDbMock.mockReset();
    getConfigMock.mockReset();
    computeStatsMock.mockReset();

    parseIntradayActivityMock.mockReturnValue([]);
    getAllSessionsFromDbMock.mockReturnValue([]);
    getAllRatingsFromDbMock.mockReturnValue({});
    getAllProxyRequestsFromDbMock.mockReturnValue([]);
    getConfigMock.mockReturnValue({
      plan: "individual",
      additionalRequests: 0,
      billingCycleStartDay: 1,
    });
    computeStatsMock.mockReturnValue({ ok: true });
  });

  it("loads enough intraday history to support hourly slices for divergence days", async () => {
    const response = await GET({
      nextUrl: new URL("http://localhost/api/stats"),
    } as never);

    expect(response.status).toBe(200);
    expect(parseIntradayActivityMock).toHaveBeenCalledWith(INTRADAY_HISTORY_HOURS);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});

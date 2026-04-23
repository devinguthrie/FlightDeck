// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelLimitsPanel } from "@/components/ModelLimitsPanel";

describe("ModelLimitsPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("groups repeated rate limit errors into expandable summaries", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        modelLimits: [],
        rateLimitErrorGroups: [
          {
            model: "gpt-5.4",
            errorCode: "429",
            errorMessage: "Rate limit exceeded",
            count: 3,
            latestTs: "2026-04-21T18:00:00.000Z",
            occurrences: [
              {
                ts: "2026-04-21T18:00:00.000Z",
                rateLimitRemaining: 0,
                rateLimitReset: "2026-04-21T18:05:00.000Z",
              },
              {
                ts: "2026-04-21T17:55:00.000Z",
                rateLimitRemaining: 0,
                rateLimitReset: "2026-04-21T18:00:00.000Z",
              },
            ],
          },
        ],
      }),
    } as Response);

    render(<ModelLimitsPanel hideTitle />);

    expect(await screen.findByText(/rate limit events \(1 grouped issue in last 7 days\)/i)).toBeInTheDocument();
    expect(screen.getByText("3 events")).toBeInTheDocument();
    expect(screen.getByText(/429: Rate limit exceeded/i)).toBeInTheDocument();
    expect(screen.getByText("Occurrences")).toBeInTheDocument();
    expect(screen.getAllByText(/remaining: 0/i)).toHaveLength(2);
  });

  it("renders duplicate-timestamp occurrences without duplicate key warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        modelLimits: [],
        rateLimitErrorGroups: [
          {
            model: "gpt-4o-mini",
            errorCode: "429",
            errorMessage: "Rate limit exceeded",
            count: 2,
            latestTs: "2026-04-22T06:41:39.000Z",
            occurrences: [
              {
                ts: "2026-04-22T06:41:39.000Z",
                rateLimitRemaining: 0,
                rateLimitReset: "2026-04-22T06:46:39.000Z",
              },
              {
                ts: "2026-04-22T06:41:39.000Z",
                rateLimitRemaining: 0,
                rateLimitReset: "2026-04-22T06:46:39.000Z",
              },
            ],
          },
        ],
      }),
    } as Response);

    render(<ModelLimitsPanel hideTitle />);

    expect(await screen.findByText("2 events")).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Encountered two children with the same key"),
    );
  });
});

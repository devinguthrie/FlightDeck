// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";

import ConfigPanel from "@/components/ConfigPanel";

const CONFIG = {
  plan: "pro" as const,
  billingCycleStartDay: 1,
  additionalRequests: 0,
  planQuota: 300,
};

describe("ConfigPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves successfully and calls onSaved", async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => CONFIG,
    } as Response);

    render(<ConfigPanel config={CONFIG} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(CONFIG));
    await waitFor(() => expect(screen.queryByText("Plan Configuration")).not.toBeInTheDocument());
  });

  it("shows an inline error when save fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      text: async () => "Could not save settings.",
    } as Response);

    render(<ConfigPanel config={CONFIG} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save settings.");
    expect(screen.getByText("Plan Configuration")).toBeInTheDocument();
  });

  it("shows the detected billing plan as informational only", async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => CONFIG,
    } as Response);

    render(<ConfigPanel config={CONFIG} detectedPlan="business" onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));

    const planSelect = screen.getByRole("combobox", { name: /copilot plan/i });
    expect(planSelect).toBeEnabled();
    expect(
      screen.getByText(/live billing currently reports/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toHaveProperty("plan", "pro");
  });

  it("syncs form fields when config props change", async () => {
    const { rerender } = render(<ConfigPanel config={CONFIG} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));

    const startDayInput = screen.getByLabelText(/billing cycle start day/i);
    expect(startDayInput).toHaveValue(1);

    rerender(
      <ConfigPanel
        config={{
          ...CONFIG,
          plan: "business",
          billingCycleStartDay: 12,
          additionalRequests: 25,
          planQuota: 300,
        }}
        onSaved={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue("12")).toBeInTheDocument());
    expect(screen.getByDisplayValue("25")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("business");
  });
});

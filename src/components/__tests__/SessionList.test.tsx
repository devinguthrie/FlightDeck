// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SessionList from "@/components/SessionList";

const sessions = Array.from({ length: 30 }, (_, index) => ({
  sessionId: `session-${index + 1}`,
  workspaceName: `workspace-${index + 1}`,
  startedAt: "2026-04-21T10:00:00.000Z",
  endedAt: "2026-04-21T11:00:00.000Z",
  durationMinutes: 60,
  activeMinutes: 20,
  premiumRequests: index + 1,
  toolCallsTotal: index,
  skillsActivated: [],
  estimatedTotalTokens: 1000,
  activeModel: null,
  usedModels: [],
  rating: null,
}));

describe("SessionList pagination", () => {
  it("pages through long session lists", () => {
    render(<SessionList sessions={sessions} onRated={() => {}} />);

    expect(screen.getByText("workspace-1")).toBeInTheDocument();
    expect(screen.queryByText("workspace-30")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("workspace-30")).toBeInTheDocument();
    expect(screen.queryByText("workspace-1")).not.toBeInTheDocument();
  });
});

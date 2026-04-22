// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ToolBreakdown from "@/components/ToolBreakdown";

const skillStats = Array.from({ length: 10 }, (_, index) => ({
  name: `skill-${index + 1}`,
  sessions: index + 1,
  avgRequests: 5 + index,
  avgQuality: 4,
  sampleSize: 5,
  qualityPer100Req: 10 - index,
  liftVsBaseline: 1,
}));

describe("ToolBreakdown pagination", () => {
  it("paginates the skill impact table", () => {
    render(<ToolBreakdown topTools={[]} skillStats={skillStats} totalRated={5} />);

    expect(screen.getByText("skill-1")).toBeInTheDocument();
    expect(screen.queryByText("skill-10")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("skill-10")).toBeInTheDocument();
    expect(screen.queryByText("skill-1")).not.toBeInTheDocument();
  });
});

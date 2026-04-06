import { describe, it, expect } from "vitest";
import {
  PLANS,
  costPerRequest,
  estimateCost,
  daysRemaining,
  currentCycleStart,
  currentCycleEnd,
  formatCount,
} from "@/lib/pricing";

// Pin today so cycle tests are deterministic
const APR_6 = new Date("2026-04-06T12:00:00.000Z");
const APR_6_LOCAL = new Date(2026, 3, 6, 12, 0, 0); // month is 0-indexed

describe("costPerRequest", () => {
  it("returns 0 for the free plan", () => {
    expect(costPerRequest("free")).toBe(0);
  });

  it("returns correct cost for pro plan ($10 / 300 req)", () => {
    expect(costPerRequest("pro")).toBeCloseTo(10 / 300);
  });

  it("returns correct cost for pro+ plan ($39 / 1500 req)", () => {
    expect(costPerRequest("pro+")).toBeCloseTo(39 / 1500);
  });

  it("returns correct cost for business plan ($19 / 300 req)", () => {
    expect(costPerRequest("business")).toBeCloseTo(19 / 300);
  });

  it("business plan costs more per request than pro plan", () => {
    expect(costPerRequest("business")).toBeGreaterThan(costPerRequest("pro"));
  });

  it("pro+ plan has the lowest per-request cost of paid plans", () => {
    const proPlus = costPerRequest("pro+");
    expect(proPlus).toBeLessThan(costPerRequest("pro"));
    expect(proPlus).toBeLessThan(costPerRequest("business"));
  });
});

describe("estimateCost", () => {
  it("returns 0 for 0 requests on any plan", () => {
    expect(estimateCost(0, "pro")).toBe(0);
    expect(estimateCost(0, "pro+")).toBe(0);
    expect(estimateCost(0, "free")).toBe(0);
  });

  it("returns 0 for any count on free plan", () => {
    expect(estimateCost(9999, "free")).toBe(0);
  });

  it("is linear: double requests = double cost", () => {
    expect(estimateCost(100, "pro")).toBeCloseTo(estimateCost(50, "pro") * 2);
  });

  it("300 requests on pro plan costs exactly $10 (full month)", () => {
    expect(estimateCost(300, "pro")).toBeCloseTo(10, 6);
  });

  it("1500 requests on pro+ plan costs exactly $39 (full month)", () => {
    expect(estimateCost(1500, "pro+")).toBeCloseTo(39, 6);
  });
});

describe("daysRemaining", () => {
  it("returns null when burn rate is 0 (no usage recorded yet)", () => {
    expect(daysRemaining(50, "pro", 0, 0)).toBeNull();
  });

  it("returns null for negative burn rate", () => {
    expect(daysRemaining(50, "pro", 0, -1)).toBeNull();
  });

  it("returns 0 when quota is already exhausted", () => {
    // 300 used, 0 remaining, burn rate = 10/day → 0 days left
    expect(daysRemaining(300, "pro", 0, 10)).toBe(0);
  });

  it("returns 0 when over quota", () => {
    // 350 used on a 300-plan → still 0, not negative
    expect(daysRemaining(350, "pro", 0, 10)).toBe(0);
  });

  it("calculates remaining days correctly for pro plan", () => {
    // 150 used, 300 quota, 50/day → (300-150)/50 = 3 days
    expect(daysRemaining(150, "pro", 0, 50)).toBeCloseTo(3);
  });

  it("includes additionalRequests in total quota", () => {
    // 295 used, 300 base + 100 additional = 400 total, burn 5/day → 21 days
    expect(daysRemaining(295, "pro", 100, 5)).toBeCloseTo(21);
  });

  it("ignores additionalRequests for the free plan (0 base cost)", () => {
    // Free plan: 50 entitlement, 0 used, 1/day → 50 days
    expect(daysRemaining(0, "free", 0, 1)).toBe(50);
  });

  it("handles pro+ plan with large quota", () => {
    // 1000 used on pro+ (1500 total), burn 50/day → 10 days
    expect(daysRemaining(1000, "pro+", 0, 50)).toBeCloseTo(10);
  });
});

describe("currentCycleStart", () => {
  it("returns the start of the current month when billing day is 1 and today is mid-month", () => {
    const today = new Date(2026, 3, 15, 12, 0, 0); // April 15
    const start = currentCycleStart(1, today);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3); // April
    expect(start.getDate()).toBe(1);
  });

  it("returns this month when today IS the billing start day", () => {
    const today = new Date(2026, 3, 6, 12, 0, 0); // April 6 at noon
    const start = currentCycleStart(6, today);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3); // April
    expect(start.getDate()).toBe(6);
  });

  it("returns last month when today is before the billing start day", () => {
    // Today = April 5, billing day = 10 → cycle started March 10
    const today = new Date(2026, 3, 5, 12, 0, 0);
    const start = currentCycleStart(10, today);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(2); // March
    expect(start.getDate()).toBe(10);
  });

  it("handles year boundary: billing day 15, today = Jan 10", () => {
    const today = new Date(2026, 0, 10, 12, 0, 0); // Jan 10
    const start = currentCycleStart(15, today);
    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(11); // December
    expect(start.getDate()).toBe(15);
  });

  it("uses true current time when no today is passed", () => {
    // Smoke test: just confirm it returns a valid Date
    const start = currentCycleStart(1);
    expect(start).toBeInstanceOf(Date);
    expect(isNaN(start.getTime())).toBe(false);
  });
});

describe("currentCycleEnd", () => {
  it("end is exactly one month after start (billing day 1)", () => {
    const today = new Date(2026, 3, 6, 12, 0, 0); // April 6
    const start = currentCycleStart(1, today);
    const end = currentCycleEnd(1, today);
    const startMs = start.getTime();
    const endMs = end.getTime();
    // End should be May 1
    expect(end.getMonth()).toBe(4); // May
    expect(end.getDate()).toBe(1);
    expect(endMs).toBeGreaterThan(startMs);
  });

  it("handles year wrap: billing day 1, today = Dec 15", () => {
    const today = new Date(2025, 11, 15, 12, 0, 0); // Dec 15
    const end = currentCycleEnd(1, today);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(0); // January
    expect(end.getDate()).toBe(1);
  });

  it("end date is later than start date", () => {
    const today = new Date(2026, 3, 6, 12, 0, 0);
    const start = currentCycleStart(6, today);
    const end = currentCycleEnd(6, today);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

describe("formatCount", () => {
  it("formats numbers below 1000 as plain strings", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1)).toBe("1");
    expect(formatCount(999)).toBe("999");
  });

  it("formats 1000 as '1.0k'", () => {
    expect(formatCount(1000)).toBe("1.0k");
  });

  it("formats 1500 as '1.5k'", () => {
    expect(formatCount(1500)).toBe("1.5k");
  });

  it("formats 12345 as '12.3k'", () => {
    expect(formatCount(12345)).toBe("12.3k");
  });

  it("formats 1001 as '1.0k' (rounds down)", () => {
    // (1001 / 1000).toFixed(1) = "1.0"
    expect(formatCount(1001)).toBe("1.0k");
  });

  it("formats 9999 as '10.0k'", () => {
    expect(formatCount(9999)).toBe("10.0k");
  });
});

describe("PLANS constant", () => {
  it("has exactly 4 plans", () => {
    expect(Object.keys(PLANS).length).toBe(4);
  });

  it("free plan has price 0", () => {
    expect(PLANS.free.pricePerMonth).toBe(0);
  });

  it("every paid plan has a positive price and positive quota", () => {
    for (const [key, plan] of Object.entries(PLANS)) {
      if (key === "free") continue;
      expect(plan.pricePerMonth).toBeGreaterThan(0);
      expect(plan.premiumRequestsPerMonth).toBeGreaterThan(0);
    }
  });
});

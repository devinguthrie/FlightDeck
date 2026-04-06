export const PLANS = {
  free: {
    name: "Free",
    premiumRequestsPerMonth: 50,
    pricePerMonth: 0,
    label: "Free (50 req/mo)",
  },
  pro: {
    name: "Pro",
    premiumRequestsPerMonth: 300,
    pricePerMonth: 10,
    label: "Pro (300 req/mo — $10/mo)",
  },
  "pro+": {
    name: "Pro+",
    premiumRequestsPerMonth: 1500,
    pricePerMonth: 39,
    label: "Pro+ (1,500 req/mo — $39/mo)",
  },
  business: {
    name: "Business",
    premiumRequestsPerMonth: 300,
    pricePerMonth: 19,
    label: "Business (300 req/user/mo — $19/mo)",
  },
} as const;

export type PlanKey = keyof typeof PLANS;

/** Cost per single premium request in dollars. */
export function costPerRequest(planKey: PlanKey): number {
  const plan = PLANS[planKey];
  if (plan.pricePerMonth === 0) return 0;
  return plan.pricePerMonth / plan.premiumRequestsPerMonth;
}

/** Estimate the dollar cost of N premium requests on the given plan. */
export function estimateCost(requestCount: number, planKey: PlanKey): number {
  return requestCount * costPerRequest(planKey);
}

/**
 * Calculate how many days of quota remain at the given burn rate.
 * Returns null if burn rate is zero (no usage yet).
 */
export function daysRemaining(
  requestsUsed: number,
  planKey: PlanKey,
  additionalRequests: number,
  dailyBurnRate: number
): number | null {
  const plan = PLANS[planKey];
  const total = plan.premiumRequestsPerMonth + additionalRequests;
  const remaining = Math.max(0, total - requestsUsed);
  if (dailyBurnRate <= 0) return null;
  return remaining / dailyBurnRate;
}

/**
 * Given a billing cycle start day, return the start ISO datetime of the current billing cycle.
 */
export function currentCycleStart(startDay: number): Date {
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), startDay, 0, 0, 0);
  // If today is before the start day, the cycle started last month
  if (candidate > now) {
    candidate.setMonth(candidate.getMonth() - 1);
  }
  return candidate;
}

/**
 * Given a billing cycle start day, return the end ISO datetime of the current billing cycle.
 */
export function currentCycleEnd(startDay: number): Date {
  const start = currentCycleStart(startDay);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return end;
}

/** Format a number compactly: 1234 → "1.2k" */
export function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

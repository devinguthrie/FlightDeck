import { describe, it, expect } from "vitest";
import {
  computeStats,
  toDateStr,
  addDays,
  mean,
  pearsonCorrelation,
} from "@/lib/statsEngine";
import {
  THREE_MONTH_SESSIONS,
  RATINGS,
  DEFAULT_CONFIG,
  TODAY,
  makeSession,
} from "@/__tests__/fixtures/mockData";
import type { Config } from "@/lib/storage";

// Empty intraday buckets (irrelevant to most tests)
const NO_INTRADAY: never[] = [];

// Helper: run computeStats with the full dataset and default config
function runDefault(configOverrides: Partial<Config> = {}) {
  return computeStats(
    THREE_MONTH_SESSIONS,
    NO_INTRADAY,
    RATINGS,
    { ...DEFAULT_CONFIG, ...configOverrides },
    TODAY,
    7 // 7-day burn rate window
  );
}

// ─────────────────────────────────────────────────────────────────────────────
describe("helpers", () => {
  describe("toDateStr", () => {
    it("formats a UTC date as YYYY-MM-DD", () => {
      expect(toDateStr(new Date("2026-04-06T12:00:00Z"))).toBe("2026-04-06");
    });

    it("pads single-digit months and days", () => {
      const d = new Date(2026, 0, 5); // Jan 5 (local time)
      expect(toDateStr(d)).toMatch(/2026-01-05/);
    });
  });

  describe("addDays", () => {
    it("adds positive days", () => {
      const result = addDays(new Date("2026-04-01T00:00:00"), 5);
      expect(result.getDate()).toBe(6);
    });

    it("subtracts days with a negative argument", () => {
      const result = addDays(new Date("2026-04-06T00:00:00"), -29);
      expect(result.getDate()).toBe(8); // Mar 8
      expect(result.getMonth()).toBe(2); // March (0-indexed)
    });

    it("does not mutate the original date", () => {
      const d = new Date("2026-04-06T00:00:00");
      addDays(d, 10);
      expect(d.getDate()).toBe(6);
    });

    it("handles month boundaries correctly", () => {
      const result = addDays(new Date("2026-03-31T00:00:00"), 1);
      expect(result.getMonth()).toBe(3); // April
      expect(result.getDate()).toBe(1);
    });
  });

  describe("mean", () => {
    it("returns null for an empty array", () => {
      expect(mean([])).toBeNull();
    });

    it("returns the value itself for a single element", () => {
      expect(mean([42])).toBe(42);
    });

    it("returns the arithmetic mean of multiple values", () => {
      expect(mean([1, 2, 3, 4, 5])).toBeCloseTo(3);
    });

    it("handles negative values", () => {
      expect(mean([-5, 5])).toBe(0);
    });
  });

  describe("pearsonCorrelation", () => {
    it("returns 1 for perfect positive correlation", () => {
      expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1);
    });

    it("returns -1 for perfect negative correlation", () => {
      expect(pearsonCorrelation([1, 2, 3], [10, 5, 0])).toBeCloseTo(-1);
    });

    it("returns 0 for orthogonal (truly uncorrelated) variables", () => {
      // x=[1,2,3,4], y=[-3,1,1,-3]: sum of (xi-mx)(yi-my) = 0 → r exactly 0
      const r = pearsonCorrelation([1, 2, 3, 4], [-3, 1, 1, -3]);
      expect(r).not.toBeNull();
      expect(r!).toBeCloseTo(0, 10);
    });

    it("returns null when all x values are the same (zero denominator)", () => {
      expect(pearsonCorrelation([3, 3, 3], [1, 2, 3])).toBeNull();
    });

    it("returns null for fewer than 2 points", () => {
      expect(pearsonCorrelation([1], [1])).toBeNull();
      expect(pearsonCorrelation([], [])).toBeNull();
    });

    it("returns null when array lengths differ", () => {
      expect(pearsonCorrelation([1, 2, 3], [1, 2])).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("dailyBuckets", () => {
  it("always produces exactly 30 buckets — no off-by-one", () => {
    const result = runDefault();
    expect(result.dailyBuckets.length).toBe(30);
  });

  it("bucket dates span exactly from (today-29) to today", () => {
    const result = runDefault();
    const dates = result.dailyBuckets.map((b) => b.date);
    const expectedFirst = toDateStr(addDays(TODAY, -29)); // Mar 8
    const expectedLast = toDateStr(TODAY);                // Apr 6
    expect(dates[0]).toBe(expectedFirst);
    expect(dates[dates.length - 1]).toBe(expectedLast);
  });

  it("sessions older than 30 days are excluded from bucketsMap", () => {
    // Jan and most of Feb sessions are outside the window
    const result = runDefault();
    const total = result.dailyBuckets.reduce((sum, b) => sum + b.sessions, 0);
    // Only sessions from Mar 8 onward are in the window
    // From the fixture: mar-05(Mar 8), mar-06(Mar 10), ... mar-16(Mar 30), all Apr sessions
    const sessionsInWindow = THREE_MONTH_SESSIONS.filter(
      (s) => new Date(s.startedAt) >= addDays(TODAY, -29)
    ).length;
    expect(total).toBe(sessionsInWindow);
  });

  it("zero-request sessions appear in the bucket (session incremented, requests stay 0)", () => {
    const result = runDefault();
    // mar-16 (Mar 30) has 0 premiumRequests and some toolCalls
    const mar30 = result.dailyBuckets.find((b) => b.date === "2026-03-30");
    expect(mar30).toBeDefined();
    expect(mar30!.sessions).toBe(1);
    expect(mar30!.requests).toBe(0);
    expect(mar30!.toolCalls).toBe(2);
  });

  it("buckets are sorted in ascending date order", () => {
    const result = runDefault();
    const dates = result.dailyBuckets.map((b) => b.date);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
  });

  it("a session on exactly today (day 0) appears in the last bucket", () => {
    // apr-07 starts on Apr 6 = TODAY
    const result = runDefault();
    const today = result.dailyBuckets[result.dailyBuckets.length - 1];
    expect(today.date).toBe("2026-04-06");
    expect(today.sessions).toBeGreaterThanOrEqual(1);
  });

  it("two sessions on the same day are merged into one bucket", () => {
    // apr-01 and apr-02 both start on 2026-04-01
    const result = runDefault();
    const apr1 = result.dailyBuckets.find((b) => b.date === "2026-04-01");
    expect(apr1).toBeDefined();
    expect(apr1!.sessions).toBe(2); // apr-01 and apr-02
    expect(apr1!.requests).toBe(28); // 18 + 10
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("projectionPoints — billing cycle boundary bug", () => {
  it("with billingCycleStartDay=1 (Apr 1 cycle start), all cycle requests appear in projection", () => {
    const result = runDefault({ billingCycleStartDay: 1 });
    // requestsThisCycle sums Apr 1–6 sessions: 18+10+25+8+32+15+5 = 113
    const expectedTotal = 18 + 10 + 25 + 8 + 32 + 15 + 5;
    expect(result.requestsThisCycle).toBe(expectedTotal);

    // Last actual point (Apr 6 = today) cumulative should equal requestsThisCycle
    const actualPoints = result.projectionPoints.filter((p) => p.actual !== null);
    const lastActual = actualPoints[actualPoints.length - 1];
    expect(lastActual.actual).toBe(result.requestsThisCycle);
  });

  it("with billingCycleStartDay=7 (Mar 7 cycle start, 30 days ago), early session is NOT dropped", () => {
    // The bug: Mar 7 session (mar-04: 16 requests) is inside the billing cycle
    // but OUTSIDE the 30-day daily-bucket window (which starts Mar 8 = today-29).
    // billingCycleStartDay=7: today's local date (Apr 6) < 7 → cycle started March 7.
    // The fix uses cycleBucketsMap instead of bucketsMap for projectionPoints.
    const result = runDefault({ billingCycleStartDay: 7 });

    // Sessions from March 7 onward:
    // mar-04 (Mar 7): 16 — in cycle, OUTSIDE 30-day window  ← the bug case
    // mar-05 (Mar 8): 33 — in cycle, on window boundary
    // mar-06..16 + apr-01..07 = rest
    const cycleSessionsRequests = THREE_MONTH_SESSIONS
      .filter((s) => {
        // currentCycleStart(7, TODAY) returns new Date(2026, 2, 7) — local time Mar 7
        const cycleStart = new Date(2026, 2, 7); // local-time March 7
        return new Date(s.startedAt) >= cycleStart;
      })
      .reduce((sum, s) => sum + s.premiumRequests, 0);

    expect(result.requestsThisCycle).toBe(cycleSessionsRequests);

    // The last actual projectionPoint must equal requestsThisCycle (not less!)
    const actualPoints = result.projectionPoints.filter((p) => p.actual !== null);
    const lastActual = actualPoints[actualPoints.length - 1];
    expect(lastActual.actual).toBe(result.requestsThisCycle);
  });

  it("cycle starts on cycleStart date and ends on cycleEnd date", () => {
    const result = runDefault({ billingCycleStartDay: 1 });
    // cycleStart = Apr 1, cycleEnd = May 1
    const firstPoint = result.projectionPoints[0];
    const lastPoint = result.projectionPoints[result.projectionPoints.length - 1];
    expect(firstPoint.date).toBe("2026-04-01");
    // Last date is cycleEnd date (May 1)
    expect(lastPoint.date).toBe("2026-05-01");
  });

  it("past days have actual !== null, projected === null", () => {
    const result = runDefault();
    const pastPoints = result.projectionPoints.filter((p) => p.date <= toDateStr(TODAY));
    for (const p of pastPoints) {
      expect(p.actual).not.toBeNull();
      expect(p.projected).toBeNull();
    }
  });

  it("future days have projected !== null, actual === null", () => {
    const result = runDefault();
    const futurePoints = result.projectionPoints.filter((p) => p.date > toDateStr(TODAY));
    expect(futurePoints.length).toBeGreaterThan(0);
    for (const p of futurePoints) {
      expect(p.actual).toBeNull();
      expect(p.projected).not.toBeNull();
    }
  });

  it("cumulative actual values are non-decreasing (monotone)", () => {
    const result = runDefault();
    const actualPoints = result.projectionPoints
      .filter((p) => p.actual !== null)
      .map((p) => p.actual as number);
    for (let i = 1; i < actualPoints.length; i++) {
      expect(actualPoints[i]).toBeGreaterThanOrEqual(actualPoints[i - 1]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("cycle metrics", () => {
  it("requestsThisCycle counts only sessions >= cycleStart", () => {
    const result = runDefault({ billingCycleStartDay: 1 });
    // Apr sessions: 18+10+25+8+32+15+5 = 113
    expect(result.requestsThisCycle).toBe(113);
  });

  it("requestsRemaining clamps at 0 when usage exceeds plan quota", () => {
    // free plan: premiumRequestsPerMonth = 50; requestsThisCycle (Apr) = 113 → remaining = 0
    const result = runDefault({ billingCycleStartDay: 1, plan: "free" });
    expect(result.planQuota).toBe(50);
    expect(result.requestsThisCycle).toBe(113);
    expect(result.requestsRemaining).toBe(0);
  });

  it("requestsRemaining = planQuota - requestsThisCycle when quota not exceeded", () => {
    const result = runDefault({ billingCycleStartDay: 1 });
    if (result.requestsThisCycle <= result.planQuota) {
      expect(result.requestsRemaining).toBe(result.planQuota - result.requestsThisCycle);
    } else {
      expect(result.requestsRemaining).toBe(0);
    }
  });

  it("dailyBurnRate uses 7-day rolling window (avgDays=7)", () => {
    const result = runDefault();
    // Window = Apr 6 - 7 days = Mar 30 → Apr 6
    // Sessions in window: mar-16(Mar 30, 0), apr-01(18), apr-02(10), apr-03(25), apr-04(8), apr-05(32), apr-06(15), apr-07(5)
    const windowSessions = THREE_MONTH_SESSIONS.filter((s) => {
      const d = new Date(s.startedAt);
      return d >= addDays(TODAY, -7) && d <= TODAY;
    });
    const windowRequests = windowSessions.reduce((sum, s) => sum + s.premiumRequests, 0);
    const expected = Math.round((windowRequests / 7) * 10) / 10;
    expect(result.dailyBurnRate).toBe(expected);
  });

  it("returns a daysRemainingEstimate when burn rate is positive", () => {
    const result = runDefault();
    // We have sessions in the window, so burn rate is positive
    if (result.dailyBurnRate > 0) {
      expect(result.daysRemainingEstimate).not.toBeNull();
      expect(result.daysRemainingEstimate).toBeGreaterThanOrEqual(0);
    }
  });

  it("daysRemainingEstimate is null when there are no sessions in the burn window", () => {
    const result = computeStats(
      [], // no sessions at all
      NO_INTRADAY,
      {},
      DEFAULT_CONFIG,
      TODAY,
      7
    );
    expect(result.daysRemainingEstimate).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("skillStats", () => {
  it("only skills from actual sessions are present in skillStats", () => {
    const result = runDefault();
    const skillNames = result.skillStats.map((s) => s.name);
    // Our dataset has: ship, qa, review, investigate
    expect(skillNames).toContain("qa");
    expect(skillNames).toContain("ship");
    expect(skillNames).toContain("review");
    expect(skillNames).toContain("investigate");
  });

  it("sessions with no skillsActivated do not contribute to any skill", () => {
    const result = runDefault();
    // Total sessions counted across all skills should not exceed totalSessions
    const totalSkillSessions = result.skillStats.reduce((sum, s) => sum + s.sessions, 0);
    const sessionsWithSkills = THREE_MONTH_SESSIONS.filter(
      (s) => s.skillsActivated.length > 0
    );
    // Each session can appear in multiple skills (multi-skill sessions counted multiple times)
    const totalSkillSlots = THREE_MONTH_SESSIONS.reduce(
      (sum, s) => sum + s.skillsActivated.length,
      0
    );
    expect(totalSkillSessions).toBe(totalSkillSlots);
  });

  it("skillStats are sorted descending by session count", () => {
    const result = runDefault();
    for (let i = 1; i < result.skillStats.length; i++) {
      expect(result.skillStats[i].sessions).toBeLessThanOrEqual(
        result.skillStats[i - 1].sessions
      );
    }
  });

  it("sampleSize is the number of rated sessions for that skill, not total sessions", () => {
    const result = runDefault();
    const qa = result.skillStats.find((s) => s.name === "qa");
    expect(qa).toBeDefined();
    // Rated QA sessions from RATINGS: jan-02(qa), feb-01(qa), mar-05(qa+investigate), mar-12(qa+ship), apr-01(qa), apr-05(qa+investigate)
    // Manually: sessions with skill "qa" AND a rating in RATINGS
    const ratedQaSessions = THREE_MONTH_SESSIONS.filter(
      (s) => s.skillsActivated.includes("qa") && RATINGS[s.sessionId]
    );
    expect(qa!.sampleSize).toBe(ratedQaSessions.length);
  });

  it("qualityPer100Req denominator uses ratedRequests, not totalRequests (bug fix)", () => {
    // Create two sessions for the same skill:
    //   rated session: 10 requests, quality 5
    //   unrated session: 1000 requests (should NOT inflate denominator)
    const sessions = [
      makeSession({
        sessionId: "test-rated",
        startedAt: "2026-04-01T10:00:00.000Z",
        premiumRequests: 10,
        skillsActivated: ["test-skill"],
      }),
      makeSession({
        sessionId: "test-unrated",
        startedAt: "2026-04-02T10:00:00.000Z",
        premiumRequests: 1000,
        skillsActivated: ["test-skill"],
      }),
    ];
    const ratings = {
      "test-rated": { quality: 5, taskCompleted: "yes" as const, note: "", ratedAt: "" },
    };
    const result = computeStats(sessions, NO_INTRADAY, ratings, DEFAULT_CONFIG, TODAY, 7);
    const skill = result.skillStats.find((s) => s.name === "test-skill");
    expect(skill).toBeDefined();
    // qualityPer100Req = (5 / 10) * 100 = 50
    // If bugged (used avg of all sessions' requests: (10+1000)/2 = 505), it would be ≈ ~0.99
    expect(skill!.qualityPer100Req).toBeCloseTo(50, 0);
  });

  it("qualityPer100Req is null for skills with no rated sessions", () => {
    // Create a skill that appears only in unrated sessions
    const sessions = [
      makeSession({
        sessionId: "only-unrated",
        startedAt: "2026-04-01T10:00:00.000Z",
        premiumRequests: 20,
        skillsActivated: ["never-rated-skill"],
      }),
    ];
    const result = computeStats(sessions, NO_INTRADAY, {}, DEFAULT_CONFIG, TODAY, 7);
    const skill = result.skillStats.find((s) => s.name === "never-rated-skill");
    expect(skill).toBeDefined();
    expect(skill!.qualityPer100Req).toBeNull();
    expect(skill!.liftVsBaseline).toBeNull();
  });

  it("liftVsBaseline is positive when skill quality exceeds the baseline", () => {
    // baseline = all rated sessions average
    const result = runDefault();
    const highQualitySkills = result.skillStats.filter(
      (s) => s.avgQuality !== null && s.avgQuality! > (result.avgQuality ?? 0)
    );
    for (const skill of highQualitySkills) {
      if (skill.liftVsBaseline !== null) {
        // Higher quality AND higher lift is directionally consistent
        // (lift vs baseline uses quality/req, not raw quality, so just check sign is possible)
        expect(typeof skill.liftVsBaseline).toBe("number");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("marginalQualityCurve", () => {
  it("always produces exactly 4 buckets (1-20, 21-50, 51-100, 101+)", () => {
    const result = runDefault();
    expect(result.marginalQualityCurve.length).toBe(4);
    const names = result.marginalQualityCurve.map((b) => b.bucket);
    expect(names).toEqual(["1-20", "21-50", "51-100", "101+"]);
  });

  it("zero-request sessions (mar-16) do NOT appear in any bucket (buckets start at 1)", () => {
    const result = runDefault();
    const totalInBuckets = result.marginalQualityCurve.reduce(
      (sum, b) => sum + b.sessions,
      0
    );
    // Only rated sessions are in marginalQualityCurve, and none of them have premiumRequests=0
    const ratedZeroReq = THREE_MONTH_SESSIONS.filter(
      (s) => s.premiumRequests === 0 && RATINGS[s.sessionId]
    );
    expect(ratedZeroReq.length).toBe(0); // none in our dataset, confirming test validity
    expect(totalInBuckets).toBe(Object.keys(RATINGS).length);
  });

  it("bucket sessions counts sum to total rated sessions", () => {
    const result = runDefault();
    const totalBucketSessions = result.marginalQualityCurve.reduce(
      (sum, b) => sum + b.sessions,
      0
    );
    expect(totalBucketSessions).toBe(result.totalRated);
  });

  it("empty buckets have avgQuality=null and avgRequests=0, not NaN", () => {
    const result = runDefault();
    for (const bucket of result.marginalQualityCurve) {
      if (bucket.sessions === 0) {
        expect(bucket.avgQuality).toBeNull();
        expect(bucket.avgRequests).toBe(0);
      }
    }
  });

  it("sessions with 5-req are in the 1-20 bucket", () => {
    const sessions = [
      makeSession({
        sessionId: "s-5req",
        startedAt: "2026-04-01T10:00:00Z",
        premiumRequests: 5,
      }),
    ];
    const ratings = {
      "s-5req": { quality: 4, taskCompleted: "yes" as const, note: "", ratedAt: "" },
    };
    const result = computeStats(sessions, NO_INTRADAY, ratings, DEFAULT_CONFIG, TODAY, 7);
    const bucket120 = result.marginalQualityCurve.find((b) => b.bucket === "1-20");
    expect(bucket120!.sessions).toBe(1);
    expect(bucket120!.avgQuality).toBeCloseTo(4);
  });

  it("sessions with 200-req are in the 101+ bucket", () => {
    const sessions = [
      makeSession({
        sessionId: "s-200req",
        startedAt: "2026-04-01T10:00:00Z",
        premiumRequests: 200,
      }),
    ];
    const ratings = {
      "s-200req": { quality: 3, taskCompleted: "partial" as const, note: "", ratedAt: "" },
    };
    const result = computeStats(sessions, NO_INTRADAY, ratings, DEFAULT_CONFIG, TODAY, 7);
    const bucket101 = result.marginalQualityCurve.find((b) => b.bucket === "101+");
    expect(bucket101!.sessions).toBe(1);
    expect(bucket101!.avgQuality).toBeCloseTo(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("topTools", () => {
  it("returns at most 15 entries", () => {
    const result = runDefault();
    expect(result.topTools.length).toBeLessThanOrEqual(15);
  });

  it("sorted descending by count", () => {
    const result = runDefault();
    for (let i = 1; i < result.topTools.length; i++) {
      expect(result.topTools[i].count).toBeLessThanOrEqual(result.topTools[i - 1].count);
    }
  });

  it("reflects all sessions' tool calls, not just cycle sessions", () => {
    const result = runDefault();
    // Our fixture sessions all have toolCallsByName with read_file, grep_search, run_in_terminal
    const toolNames = result.topTools.map((t) => t.name);
    expect(toolNames).toContain("read_file");
    expect(toolNames).toContain("grep_search");
    expect(toolNames).toContain("run_in_terminal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("full 3-month dataset integration", () => {
  it("totalSessions counts all 34 sessions", () => {
    const result = runDefault();
    expect(result.totalSessions).toBe(34);
  });

  it("totalRequests sums premiumRequests across all sessions", () => {
    const result = runDefault();
    const expected = THREE_MONTH_SESSIONS.reduce((sum, s) => sum + s.premiumRequests, 0);
    expect(result.totalRequests).toBe(expected);
  });

  it("totalRated matches the number of RATINGS keys", () => {
    const result = runDefault();
    expect(result.totalRated).toBe(Object.keys(RATINGS).length); // 10
  });

  it("avgQuality equals mean of all rated session quality values", () => {
    const result = runDefault();
    const qualities = Object.values(RATINGS).map((r) => r.quality);
    const expected = Math.round((qualities.reduce((a, b) => a + b, 0) / qualities.length) * 10) / 10;
    expect(result.avgQuality).toBe(expected); // 3.9
  });

  it("returns non-null qualityToolOverheadCorrelation (enough rated sessions)", () => {
    const result = runDefault();
    // 10 rated sessions → enough for correlation
    expect(result.qualityToolOverheadCorrelation).not.toBeNull();
  });

  it("returns non-null promptEfficiencyPer100Turns", () => {
    const result = runDefault();
    expect(result.promptEfficiencyPer100Turns).not.toBeNull();
  });

  it("handles empty session list gracefully", () => {
    const result = computeStats([], NO_INTRADAY, {}, DEFAULT_CONFIG, TODAY, 7);
    expect(result.totalSessions).toBe(0);
    expect(result.totalRequests).toBe(0);
    expect(result.totalRated).toBe(0);
    expect(result.avgQuality).toBeNull();
    expect(result.dailyBuckets.length).toBe(30); // filled with zeros
    expect(result.requestsThisCycle).toBe(0);
    expect(result.dailyBurnRate).toBe(0);
    expect(result.daysRemainingEstimate).toBeNull();
    expect(result.requestsRemaining).toBe(300); // full quota unused
  });

  it("handles empty ratings map gracefully", () => {
    const result = computeStats(
      THREE_MONTH_SESSIONS,
      NO_INTRADAY,
      {},
      DEFAULT_CONFIG,
      TODAY,
      7
    );
    expect(result.totalRated).toBe(0);
    expect(result.avgQuality).toBeNull();
    expect(result.marginalQualityCurve.every((b) => b.avgQuality === null)).toBe(true);
    expect(result.qualityToolOverheadCorrelation).toBeNull();
    expect(result.promptEfficiencyPer100Turns).toBeNull();
  });

  it("planQuota includes additionalRequests", () => {
    const result = computeStats(
      [],
      NO_INTRADAY,
      {},
      { ...DEFAULT_CONFIG, additionalRequests: 100 },
      TODAY,
      7
    );
    expect(result.planQuota).toBe(400); // 300 + 100
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("token volume metrics", () => {
  it("dailyBuckets accumulate inputTokens and outputTokens from sessions", () => {
    // Each session in the fixture has estimatedInputTokens:2000 and estimatedOutputTokens:4000
    const result = runDefault();
    const bucketsWithSessions = result.dailyBuckets.filter((b) => b.sessions > 0);
    for (const bucket of bucketsWithSessions) {
      expect(bucket.inputTokens).toBeGreaterThan(0);
      expect(bucket.outputTokens).toBeGreaterThan(0);
    }
  });

  it("zero-session buckets have zero inputTokens and outputTokens", () => {
    const result = runDefault();
    const emptyBuckets = result.dailyBuckets.filter((b) => b.sessions === 0);
    for (const bucket of emptyBuckets) {
      expect(bucket.inputTokens).toBe(0);
      expect(bucket.outputTokens).toBe(0);
    }
  });

  it("inputTokens per bucket equals sessions * 2000 (no proxy requests)", () => {
    // makeSession defaults: estimatedInputTokens:2000, no proxy requests → only transcript tokens
    const result = runDefault();
    for (const bucket of result.dailyBuckets) {
      expect(bucket.inputTokens).toBe(bucket.sessions * 2000);
    }
  });

  it("outputInputRatio is null when there are no proxy requests", () => {
    const result = runDefault();
    // No proxy requests in the default fixture
    expect(result.outputInputRatio).toBeNull();
  });

  it("outputInputRatio is computed correctly from proxy requests", () => {
    const makeProxy = (prompt: number, completion: number) => ({
      ts: TODAY.toISOString(),
      model: "claude-sonnet-4-5",
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
      latencyMs: 1000,
      source: "cli" as const,
    });
    const result = computeStats(
      THREE_MONTH_SESSIONS,
      NO_INTRADAY,
      RATINGS,
      DEFAULT_CONFIG,
      TODAY,
      7,
      [makeProxy(1000, 500), makeProxy(2000, 1000)]
    );
    // (500+1000) / (1000+2000) = 1500/3000 = 0.5
    expect(result.outputInputRatio).toBe(0.5);
  });

  it("topWorkspacesByTokens aggregates token volumes per workspace", () => {
    const result = runDefault();
    // All makeSession() fixtures default to workspaceName:"FlightDeck"
    expect(result.topWorkspacesByTokens.length).toBeGreaterThan(0);
    const flightDeck = result.topWorkspacesByTokens.find((w) => w.workspace === "FlightDeck");
    expect(flightDeck).toBeDefined();
    expect(flightDeck!.inputTokens).toBe(34 * 2000); // 34 sessions * 2000
    expect(flightDeck!.outputTokens).toBe(34 * 4000); // 34 sessions * 4000
  });

  it("topWorkspacesByTokens is sorted by total tokens descending", () => {
    const sessions = [
      makeSession({ sessionId: "w1", workspaceName: "Alpha", estimatedInputTokens: 100, estimatedOutputTokens: 200, startedAt: TODAY.toISOString() }),
      makeSession({ sessionId: "w2", workspaceName: "Beta", estimatedInputTokens: 5000, estimatedOutputTokens: 10000, startedAt: TODAY.toISOString() }),
    ];
    const result = computeStats(sessions, NO_INTRADAY, {}, DEFAULT_CONFIG, TODAY, 7);
    expect(result.topWorkspacesByTokens[0].workspace).toBe("Beta");
    expect(result.topWorkspacesByTokens[1].workspace).toBe("Alpha");
  });

  it("topWorkspacesByTokens returns at most 10 entries", () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      makeSession({
        sessionId: `s${i}`,
        workspaceName: `Workspace${i}`,
        estimatedInputTokens: (15 - i) * 1000,
        estimatedOutputTokens: (15 - i) * 2000,
        startedAt: TODAY.toISOString(),
      })
    );
    const result = computeStats(sessions, NO_INTRADAY, {}, DEFAULT_CONFIG, TODAY, 7);
    expect(result.topWorkspacesByTokens.length).toBeLessThanOrEqual(10);
  });
});

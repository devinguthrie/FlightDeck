/**
 * Pure stats computation engine — no I/O, no Next.js, fully testable.
 *
 * The API route at src/app/api/stats/route.ts handles request parsing and
 * dependency injection, then delegates here.
 */

import type { ParsedSession, IntradayActivityBucket } from "./transcriptParser";
import type { QualityRating, Config } from "./storage";
import type { ProxyRequest } from "./proxyRequestParser"
import { PLANS, currentCycleStart, currentCycleEnd, daysRemaining } from "./pricing";

// ─── Response types ───────────────────────────────────────────────────────────

export interface DailyBucket {
  date: string; // YYYY-MM-DD
  requests: number;
  sessions: number;
  toolCalls: number;
  skills: string[]; // deduplicated skills activated across all sessions on this day
  inputTokens: number;  // VS Code estimated + CLI exact prompt tokens
  outputTokens: number; // VS Code estimated + CLI exact completion tokens
}

export interface ToolCount {
  name: string;
  count: number;
}

export interface ToolLatency {
  name: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface SkillStats {
  name: string;
  sessions: number;
  avgRequests: number;
  avgQuality: number | null;
  sampleSize: number;
  qualityPer100Req: number | null;
  liftVsBaseline: number | null;
}

export interface ProxyStats {
  totalRequests: number;
  cliRequests: number;
  vscodeRequests: number;
  /** True if any proxy record was captured in the last 24 hours. */
  proxyActive: boolean;
  /** True if any CLI-sourced record was captured in the last 24 hours. */
  cliActive: boolean;
  lastCapturedAt: string | null;
  modelBreakdown: Array<{ model: string; count: number; avgLatencyMs: number; totalPromptTokens: number; totalCompletionTokens: number }>;
  /**
   * Token accuracy: exact proxy tokens vs transcript-estimated tokens for the
   * current billing cycle. Null until both proxy and transcript data exist.
   */
  tokenAccuracy: {
    exactTotalTokens: number;
    estimatedTotalTokens: number;
    /** exact / estimated — 1.0 = perfect match, <1 = overestimate, >1 = underestimate */
    accuracyRatio: number;
  } | null;
}

export interface MarginalQualityBucket {
  bucket: string;
  minRequests: number;
  maxRequests: number;
  sessions: number;
  avgQuality: number | null;
  avgRequests: number;
}

export interface StatsResponse {
  // Billing cycle summary
  cycleStart: string;
  cycleEnd: string;
  requestsThisCycle: number;
  planQuota: number;
  requestsRemaining: number;
  daysRemainingEstimate: number | null;
  projectedExhaustionDate: string | null;
  dailyBurnRate: number;

  // ROI exploration metrics
  cycleUserTurns: number;
  cycleAssistantTurns: number;
  cycleToolCalls: number;
  cycleDurationMinutes: number;
  premiumBurnPerUserPrompt: number | null;
  requestDensityPerMinute: number;
  toolOverheadRatio: number;
  promptEfficiencyPer100Turns: number | null;
  qualityToolOverheadCorrelation: number | null;

  // Charts data
  dailyBuckets: DailyBucket[];
  intradayBuckets: IntradayActivityBucket[];
  projectionPoints: Array<{ date: string; actual: number | null; projected: number | null }>;
  topTools: ToolCount[];
  toolLatencies: ToolLatency[];
  skillStats: SkillStats[];
  marginalQualityCurve: MarginalQualityBucket[];

  // Overall stats
  totalSessions: number;
  totalRequests: number;
  totalRated: number;
  avgQuality: number | null;

  // Rolling 7-day window (independent of billing cycle)
  sevenDayRequests: number;
  sevenDayBurnRate: number;

  // Context saturation
  avgContextSaturation: number | null;

  // MITM proxy data
  proxyStats: ProxyStats;

  // Token volume metrics (proxy exact CLI tokens + transcript estimated VS Code tokens)
  outputInputRatio: number | null;
  topWorkspacesByTokens: Array<{ workspace: string; inputTokens: number; outputTokens: number }>;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function toDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Returns the p-th percentile (0–100) of a sorted or unsorted number array. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function pearsonCorrelation(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 2) return null;

  const mx = mean(x);
  const my = mean(y);
  if (mx === null || my === null) return null;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;
  return num / den;
}

// ─── Main computation ─────────────────────────────────────────────────────────

export function computeStats(
  sessions: ParsedSession[],
  intradayBuckets: IntradayActivityBucket[],
  ratings: Record<string, QualityRating>,
  config: Config,
  today: Date,
  avgDays: number,
  proxyRequests: ProxyRequest[] = []
): StatsResponse {
  const plan = PLANS[config.plan];
  const cycleStart = currentCycleStart(config.billingCycleStartDay, today);
  const cycleEnd = currentCycleEnd(config.billingCycleStartDay, today);

  // ─── Cycle requests ──────────────────────────────────────────────────────────
  const cycleSessions = sessions.filter((s) => new Date(s.startedAt) >= cycleStart);
  const requestsThisCycle = cycleSessions.reduce((sum, s) => sum + s.premiumRequests, 0);
  const cycleUserTurns = cycleSessions.reduce((sum, s) => sum + s.userTurns, 0);
  const cycleAssistantTurns = cycleSessions.reduce(
    (sum, s) => sum + s.assistantTurns,
    0
  );
  const cycleToolCalls = cycleSessions.reduce((sum, s) => sum + s.toolCallsTotal, 0);
  const cycleDurationMinutes = cycleSessions.reduce(
    (sum, s) => sum + s.durationMinutes,
    0
  );
  const planQuota = plan.premiumRequestsPerMonth + config.additionalRequests;
  const requestsRemaining = Math.max(0, planQuota - requestsThisCycle);
  const premiumBurnPerUserPrompt =
    cycleUserTurns > 0 ? requestsThisCycle / cycleUserTurns : null;
  const requestDensityPerMinute =
    cycleDurationMinutes > 0 ? cycleAssistantTurns / cycleDurationMinutes : 0;
  const toolOverheadRatio =
    cycleAssistantTurns > 0 ? cycleToolCalls / cycleAssistantTurns : 0;

  // ─── Daily burn rate (rolling Nd average) ────────────────────────────────────
  const avgWindowStart = addDays(today, -avgDays);
  const windowSessions = sessions.filter(
    (s) =>
      new Date(s.startedAt) >= avgWindowStart && new Date(s.startedAt) <= today
  );
  const windowRequests = windowSessions.reduce((sum, s) => sum + s.premiumRequests, 0);
  const dailyBurnRate = windowRequests / avgDays;

  const daysLeft = daysRemaining(
    requestsThisCycle,
    config.plan,
    config.additionalRequests,
    dailyBurnRate
  );
  const projectedExhaustionDate =
    daysLeft !== null ? toDateStr(addDays(today, daysLeft)) : null;

  // ─── Daily buckets (last 30 days) ────────────────────────────────────────────
  const bucketsMap: Record<string, DailyBucket> = {};
  const thirtyDaysAgo = addDays(today, -29); // inclusive: covers exactly 30 days (day -29 to day 0)
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (d < thirtyDaysAgo) continue;
    const key = toDateStr(d);
    if (!bucketsMap[key]) {
      bucketsMap[key] = { date: key, requests: 0, sessions: 0, toolCalls: 0, skills: [], inputTokens: 0, outputTokens: 0 };
    }
    bucketsMap[key].requests += s.premiumRequests;
    bucketsMap[key].sessions += 1;
    bucketsMap[key].toolCalls += s.toolCallsTotal;
    for (const skill of s.skillsActivated) {
      if (!bucketsMap[key].skills.includes(skill)) {
        bucketsMap[key].skills.push(skill);
      }
    }
    bucketsMap[key].inputTokens += s.estimatedInputTokens;
    bucketsMap[key].outputTokens += s.estimatedOutputTokens;
  }
  // Fill gaps with zero-value days — guaranteed 30 days
  for (let i = 0; i < 30; i++) {
    const key = toDateStr(addDays(today, -29 + i));
    if (!bucketsMap[key]) {
      bucketsMap[key] = { date: key, requests: 0, sessions: 0, toolCalls: 0, skills: [], inputTokens: 0, outputTokens: 0 };
    }
  }
  // Add CLI proxy token counts to daily buckets (separate population from VS Code transcript estimates)
  for (const r of proxyRequests) {
    const d = new Date(r.ts);
    if (d < thirtyDaysAgo) continue;
    const key = toDateStr(d);
    if (bucketsMap[key]) {
      bucketsMap[key].inputTokens += r.promptTokens ?? 0;
      bucketsMap[key].outputTokens += r.completionTokens ?? 0;
    }
  }
  const dailyBuckets = Object.values(bucketsMap).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // ─── Projection points (current billing cycle) ───────────────────────────────
  //
  // Build a lookup from all cycle sessions (not just the 30-day window) so that
  // early-cycle days beyond the daily-bucket window still contribute to cumulativeActual.
  const cycleBucketsMap: Record<string, number> = {};
  for (const s of cycleSessions) {
    const key = toDateStr(new Date(s.startedAt));
    cycleBucketsMap[key] = (cycleBucketsMap[key] ?? 0) + s.premiumRequests;
  }

  const projectionPoints: StatsResponse["projectionPoints"] = [];
  let cumulativeActual = 0;
  let cumulativeProjected = 0;

  const cycleDays: string[] = [];
  for (let d = new Date(cycleStart); d <= cycleEnd; d = addDays(d, 1)) {
    cycleDays.push(toDateStr(d));
  }

  for (const dayStr of cycleDays) {
    const dayDate = new Date(dayStr + "T00:00:00");
    const isPast = dayDate <= today;

    if (isPast) {
      cumulativeActual += cycleBucketsMap[dayStr] ?? 0;
      projectionPoints.push({
        date: dayStr,
        actual: cumulativeActual,
        projected: null,
      });
    } else {
      cumulativeProjected += dailyBurnRate;
      projectionPoints.push({
        date: dayStr,
        actual: null,
        projected: Math.round(cumulativeActual + cumulativeProjected),
      });
    }
  }

  // ─── Top tools ────────────────────────────────────────────────────────────────
  const toolTotals: Record<string, number> = {};
  for (const s of sessions) {
    for (const [name, count] of Object.entries(s.toolCallsByName)) {
      toolTotals[name] = (toolTotals[name] ?? 0) + count;
    }
  }
  const topTools = Object.entries(toolTotals)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // ─── Tool latency (P50/P95 across all sessions) ───────────────────────────────
  const latencyAccum: Record<string, number[]> = {};
  for (const s of sessions) {
    for (const [name, latencies] of Object.entries(s.toolLatencyMs ?? {})) {
      if (!latencyAccum[name]) latencyAccum[name] = [];
      for (const ms of latencies) latencyAccum[name].push(ms);
    }
  }
  const toolLatencies: ToolLatency[] = Object.entries(latencyAccum)
    .filter(([, vals]) => vals.length > 0)
    .map(([name, vals]) => ({
      name,
      count: vals.length,
      avgMs: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      p50Ms: Math.round(percentile(vals, 50)),
      p95Ms: Math.round(percentile(vals, 95)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // ─── Rolling 7-day window ─────────────────────────────────────────────────────
  const sevenDaysAgo = addDays(today, -7);
  const sevenDaySessions = sessions.filter(
    (s) => new Date(s.startedAt) >= sevenDaysAgo && new Date(s.startedAt) <= today
  );
  const sevenDayRequests = sevenDaySessions.reduce((sum, s) => sum + s.premiumRequests, 0);
  const sevenDayBurnRate = Math.round((sevenDayRequests / 7) * 10) / 10;

  // ─── Average context saturation ──────────────────────────────────────────────
  const saturations = sessions
    .map((s) => s.contextSaturation ?? 0)
    .filter((v) => v > 0);
  const avgContextSaturation =
    saturations.length > 0
      ? Math.round((saturations.reduce((a, b) => a + b, 0) / saturations.length) * 1000) / 1000
      : null;

  // ─── Proxy stats ────────────────────────────────────────────────────────────
  const oneDayAgo = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const proxyActive = proxyRequests.some((r) => new Date(r.ts) >= oneDayAgo);
  const cliActive = proxyRequests.some((r) => r.source === "cli" && new Date(r.ts) >= oneDayAgo);
  const lastCapturedAt =
    proxyRequests.length > 0 ? proxyRequests[proxyRequests.length - 1].ts : null;
  const cliRequests = proxyRequests.filter((r) => r.source === "cli").length;
  const vscodeRequests = proxyRequests.filter((r) => r.source === "vscode").length;

  const modelMap: Record<string, { count: number; totalLatency: number; totalPromptTokens: number; totalCompletionTokens: number }> = {};
  for (const r of proxyRequests) {
    if (!modelMap[r.model]) modelMap[r.model] = { count: 0, totalLatency: 0, totalPromptTokens: 0, totalCompletionTokens: 0 };
    modelMap[r.model].count++;
    modelMap[r.model].totalLatency += r.latencyMs;
    modelMap[r.model].totalPromptTokens += r.promptTokens ?? 0;
    modelMap[r.model].totalCompletionTokens += r.completionTokens ?? 0;
  }
  const modelBreakdown = Object.entries(modelMap)
    .map(([model, data]) => ({
      model,
      count: data.count,
      avgLatencyMs: Math.round(data.totalLatency / data.count),
      totalPromptTokens: data.totalPromptTokens,
      totalCompletionTokens: data.totalCompletionTokens,
    }))
    .sort((a, b) => b.count - a.count);

  // Token accuracy: compare exact proxy tokens vs transcript estimates for cycle sessions
  const proxyCycleRequests = proxyRequests.filter((r) => new Date(r.ts) >= cycleStart);
  const exactTotal = proxyCycleRequests.reduce((sum, r) => sum + (r.totalTokens ?? 0), 0);
  const hasExact = proxyCycleRequests.some((r) => r.totalTokens !== null);
  const estimatedTotal = cycleSessions.reduce((sum, s) => sum + s.estimatedTotalTokens, 0);
  const tokenAccuracy =
    hasExact && estimatedTotal > 0
      ? {
          exactTotalTokens: exactTotal,
          estimatedTotalTokens: estimatedTotal,
          accuracyRatio: Math.round((exactTotal / estimatedTotal) * 1000) / 1000,
        }
      : null;

  const proxyStats: ProxyStats = {
    totalRequests: proxyRequests.length,
    cliRequests,
    vscodeRequests,
    proxyActive,
    cliActive,
    lastCapturedAt,
    modelBreakdown,
    tokenAccuracy,
  };

  // ─── Output/input ratio (CLI exact tokens) ────────────────────────────────────
  const ratioRequests = proxyRequests.filter(
    (r) => r.promptTokens !== null && r.completionTokens !== null
  );
  const totalPromptForRatio = ratioRequests.reduce((sum, r) => sum + (r.promptTokens ?? 0), 0);
  const totalCompletionForRatio = ratioRequests.reduce((sum, r) => sum + (r.completionTokens ?? 0), 0);
  const outputInputRatio =
    totalPromptForRatio > 0
      ? Math.round((totalCompletionForRatio / totalPromptForRatio) * 1000) / 1000
      : null;

  // ─── Top workspaces by estimated token volume ─────────────────────────────────
  const workspaceTokenMap: Record<string, { inputTokens: number; outputTokens: number }> = {};
  for (const s of sessions) {
    const ws = s.workspaceName || "unknown";
    if (!workspaceTokenMap[ws]) workspaceTokenMap[ws] = { inputTokens: 0, outputTokens: 0 };
    workspaceTokenMap[ws].inputTokens += s.estimatedInputTokens;
    workspaceTokenMap[ws].outputTokens += s.estimatedOutputTokens;
  }
  const topWorkspacesByTokens = Object.entries(workspaceTokenMap)
    .map(([workspace, data]) => ({ workspace, ...data }))
    .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
    .slice(0, 10);

  // ─── Skill stats (ROI correlation) ───────────────────────────────────────────
  const skillMap: Record<
    string,
    {
      sessions: number;
      totalRequests: number;
      ratedRequests: number;
      ratings: number[];
    }
  > = {};
  for (const s of sessions) {
    for (const skill of s.skillsActivated) {
      if (!skillMap[skill]) {
        skillMap[skill] = { sessions: 0, totalRequests: 0, ratedRequests: 0, ratings: [] };
      }
      skillMap[skill].sessions++;
      skillMap[skill].totalRequests += s.premiumRequests;
      const r = ratings[s.sessionId];
      if (r) {
        skillMap[skill].ratings.push(r.quality);
        skillMap[skill].ratedRequests += s.premiumRequests;
      }
    }
  }

  const ratedSessionsForBaseline = sessions.filter((s) => ratings[s.sessionId]);
  const baselineQualityPer100Req =
    ratedSessionsForBaseline.length > 0
      ? ratedSessionsForBaseline.reduce((sum, s) => {
          const q = ratings[s.sessionId].quality;
          const req = Math.max(1, s.premiumRequests);
          return sum + (q / req) * 100;
        }, 0) / ratedSessionsForBaseline.length
      : null;

  const skillStats: SkillStats[] = Object.entries(skillMap)
    .map(([name, data]) => {
      const avgQ =
        data.ratings.length > 0
          ? data.ratings.reduce((a, b) => a + b, 0) / data.ratings.length
          : null;
      // Use only rated sessions' requests in the denominator for consistency
      const avgRatedReq =
        data.ratings.length > 0 ? data.ratedRequests / data.ratings.length : 0;
      const qPer100 =
        avgQ !== null && avgRatedReq > 0
          ? Math.round((avgQ / avgRatedReq) * 100 * 100) / 100
          : null;
      const lift =
        qPer100 !== null && baselineQualityPer100Req !== null
          ? Math.round((qPer100 - baselineQualityPer100Req) * 100) / 100
          : null;
      return {
        name,
        sessions: data.sessions,
        avgRequests:
          data.sessions > 0
            ? Math.round((data.totalRequests / data.sessions) * 10) / 10
            : 0,
        avgQuality: avgQ !== null ? Math.round(avgQ * 10) / 10 : null,
        sampleSize: data.ratings.length,
        qualityPer100Req: qPer100,
        liftVsBaseline: lift,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  // ─── Overall ──────────────────────────────────────────────────────────────────
  const ratedSessions = sessions.filter((s) => ratings[s.sessionId]);
  const avgQuality =
    ratedSessions.length > 0
      ? Math.round(
          (ratedSessions.reduce((sum, s) => sum + ratings[s.sessionId].quality, 0) /
            ratedSessions.length) *
            10
        ) / 10
      : null;

  const promptEfficiencyPer100Turns =
    ratedSessions.length > 0
      ? Math.round(
          (ratedSessions.reduce((sum, s) => {
            const turns = Math.max(1, s.userTurns);
            return sum + (ratings[s.sessionId].quality / turns) * 100;
          }, 0) /
            ratedSessions.length) *
            100
        ) / 100
      : null;

  const corrPairs = ratedSessions
    .map((s) => {
      const req = Math.max(1, s.premiumRequests);
      return {
        overhead: s.toolCallsTotal / req,
        quality: ratings[s.sessionId].quality,
      };
    })
    .filter((p) => Number.isFinite(p.overhead) && Number.isFinite(p.quality));
  const qualityToolOverheadCorrelation =
    corrPairs.length >= 2
      ? pearsonCorrelation(
          corrPairs.map((p) => p.overhead),
          corrPairs.map((p) => p.quality)
        )
      : null;

  const bucketDefs = [
    { bucket: "1-20", min: 1, max: 20 },
    { bucket: "21-50", min: 21, max: 50 },
    { bucket: "51-100", min: 51, max: 100 },
    { bucket: "101+", min: 101, max: Number.MAX_SAFE_INTEGER },
  ];

  const marginalQualityCurve: MarginalQualityBucket[] = bucketDefs.map((b) => {
    const inBucket = ratedSessions.filter(
      (s) => s.premiumRequests >= b.min && s.premiumRequests <= b.max
    );
    const avgQ =
      inBucket.length > 0
        ? inBucket.reduce((sum, s) => sum + ratings[s.sessionId].quality, 0) /
          inBucket.length
        : null;
    const avgReq =
      inBucket.length > 0
        ? inBucket.reduce((sum, s) => sum + s.premiumRequests, 0) / inBucket.length
        : 0;

    return {
      bucket: b.bucket,
      minRequests: b.min,
      maxRequests: b.max,
      sessions: inBucket.length,
      avgQuality: avgQ !== null ? Math.round(avgQ * 100) / 100 : null,
      avgRequests: Math.round(avgReq * 10) / 10,
    };
  });

  return {
    cycleStart: cycleStart.toISOString(),
    cycleEnd: cycleEnd.toISOString(),
    requestsThisCycle,
    planQuota,
    requestsRemaining,
    daysRemainingEstimate: daysLeft !== null ? Math.round(daysLeft) : null,
    projectedExhaustionDate,
    dailyBurnRate: Math.round(dailyBurnRate * 10) / 10,
    cycleUserTurns,
    cycleAssistantTurns,
    cycleToolCalls,
    cycleDurationMinutes: Math.round(cycleDurationMinutes * 10) / 10,
    premiumBurnPerUserPrompt:
      premiumBurnPerUserPrompt !== null
        ? Math.round(premiumBurnPerUserPrompt * 1000) / 1000
        : null,
    requestDensityPerMinute: Math.round(requestDensityPerMinute * 1000) / 1000,
    toolOverheadRatio: Math.round(toolOverheadRatio * 1000) / 1000,
    promptEfficiencyPer100Turns,
    qualityToolOverheadCorrelation:
      qualityToolOverheadCorrelation !== null
        ? Math.round(qualityToolOverheadCorrelation * 1000) / 1000
        : null,
    dailyBuckets,
    intradayBuckets,
    projectionPoints,
    topTools,
    toolLatencies,
    skillStats,
    marginalQualityCurve,
    totalSessions: sessions.length,
    totalRequests: sessions.reduce((sum, s) => sum + s.premiumRequests, 0),
    totalRated: ratedSessions.length,
    avgQuality,
    sevenDayRequests,
    sevenDayBurnRate,
    avgContextSaturation,
    proxyStats,
    outputInputRatio,
    topWorkspacesByTokens,
  };
}

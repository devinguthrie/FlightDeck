import { NextRequest, NextResponse } from "next/server";
import { parseIntradayActivity } from "@/lib/transcriptParser";
import { getAllSessionsFromDb, getAllRatingsFromDb, getAllProxyRequestsFromDb } from "@/lib/db";
import { getConfig } from "@/lib/storage";
import { computeStats } from "@/lib/statsEngine";

// Re-export types that the rest of the codebase may rely on from this path
export type {
  DailyBucket,
  ToolCount,
  ToolLatency,
  SkillStats,
  MarginalQualityBucket,
  ProxyStats,
  StatsResponse,
} from "@/lib/statsEngine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const avgDays = Math.max(1, Math.min(30, Number(searchParams.get("avgDays") ?? "7")));
  const workspace = searchParams.get("workspace"); // null = all projects

  try {
    const config = getConfig();
    const allSessions = getAllSessionsFromDb();
    const sessions = workspace
      ? allSessions.filter((s) => s.workspaceName === workspace)
      : allSessions;
    const ratings = getAllRatingsFromDb();
    const intradayBuckets = parseIntradayActivity(24);
    const proxyRequests = getAllProxyRequestsFromDb();

    return NextResponse.json(
      computeStats(sessions, intradayBuckets, ratings, config, new Date(), avgDays, proxyRequests)
    );
  } catch (err) {
    console.error("GET /api/stats error:", err);
    return NextResponse.json({ error: "Failed to compute stats" }, { status: 500 });
  }
}

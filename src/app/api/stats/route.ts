import { NextRequest, NextResponse } from "next/server";
import { parseAllSessions, parseIntradayActivity } from "@/lib/transcriptParser";
import { getConfig, getAllRatings } from "@/lib/storage";
import { computeStats } from "@/lib/statsEngine";

// Re-export types that the rest of the codebase may rely on from this path
export type {
  DailyBucket,
  ToolCount,
  SkillStats,
  MarginalQualityBucket,
  StatsResponse,
} from "@/lib/statsEngine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const avgDays = Math.max(1, Math.min(30, Number(searchParams.get("avgDays") ?? "7")));

  try {
    const config = getConfig();
    const ratings = getAllRatings();
    const sessions = parseAllSessions();
    const intradayBuckets = parseIntradayActivity(24);

    return NextResponse.json(
      computeStats(sessions, intradayBuckets, ratings, config, new Date(), avgDays)
    );
  } catch (err) {
    console.error("GET /api/stats error:", err);
    return NextResponse.json({ error: "Failed to compute stats" }, { status: 500 });
  }
}

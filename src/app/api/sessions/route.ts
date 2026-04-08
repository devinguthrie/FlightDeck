import { NextResponse } from "next/server";
import { getAllSessionsFromDb, getAllRatingsFromDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const sessions = getAllSessionsFromDb();
    const ratings = getAllRatingsFromDb();

    const enriched = sessions.map((s) => ({
      ...s,
      rating: ratings[s.sessionId] ?? null,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("GET /api/sessions error:", err);
    return NextResponse.json({ error: "Failed to parse sessions" }, { status: 500 });
  }
}

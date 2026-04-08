import { NextRequest, NextResponse } from "next/server";
import type { QuotaSnapshotRecord } from "@/lib/snapshotParser";
import { upsertQuotaSnapshot, buildQuotaSummaryFromDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/quota-snapshots — returns parsed quota summary + time series */
export async function GET(_req: NextRequest) {
  try {
    const summary = buildQuotaSummaryFromDb();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[quota-snapshots] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/quota-snapshots — called by the VS Code extension to push a live snapshot.
 * Upserts the snapshot into SQLite (dedup by recorded_at) and returns 204.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QuotaSnapshotRecord;

    // Basic validation
    if (!body.recorded_at || typeof body.premium_entitlement !== "number") {
      return NextResponse.json({ error: "Invalid snapshot payload" }, { status: 400 });
    }

    // recorded_at must be a valid ISO-8601 date string (used as PRIMARY KEY in SQLite)
    if (Number.isNaN(Date.parse(body.recorded_at))) {
      return NextResponse.json({ error: "recorded_at must be a valid ISO-8601 date string" }, { status: 400 });
    }

    upsertQuotaSnapshot(body);

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[quota-snapshots] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

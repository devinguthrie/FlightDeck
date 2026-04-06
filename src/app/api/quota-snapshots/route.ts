import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import path from "path";
import os from "os";
import { parseSnapshots, type QuotaSnapshotRecord } from "@/lib/snapshotParser";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TELEMETRY_DIR = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "copilot-telemetry"
);
const SNAPSHOTS_FILE = path.join(TELEMETRY_DIR, "snapshots.jsonl");

/** GET /api/quota-snapshots — returns parsed quota summary + time series */
export async function GET(_req: NextRequest) {
  try {
    const summary = parseSnapshots();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[quota-snapshots] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/quota-snapshots — called by the VS Code extension to push a live snapshot.
 * Appends the snapshot to the local file and returns 204.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QuotaSnapshotRecord;

    // Basic validation
    if (!body.recorded_at || typeof body.premium_entitlement !== "number") {
      return NextResponse.json({ error: "Invalid snapshot payload" }, { status: 400 });
    }

    if (!existsSync(TELEMETRY_DIR)) {
      mkdirSync(TELEMETRY_DIR, { recursive: true });
    }

    appendFileSync(SNAPSHOTS_FILE, JSON.stringify(body) + "\n", "utf-8");

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[quota-snapshots] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig } from "@/lib/storage";
import { PLANS } from "@/lib/pricing";
import type { PlanKey } from "@/lib/pricing";

export async function GET() {
  const config = getConfig();
  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Parameters<typeof saveConfig>[0] = {};

  if (body.plan !== undefined) {
    if (!Object.keys(PLANS).includes(body.plan as string)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }
    updates.plan = body.plan as PlanKey;
    updates.planQuota = PLANS[body.plan as PlanKey].premiumRequestsPerMonth;
  }

  if (body.billingCycleStartDay !== undefined) {
    const day = Number(body.billingCycleStartDay);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      return NextResponse.json(
        { error: "billingCycleStartDay must be 1–28" },
        { status: 400 }
      );
    }
    updates.billingCycleStartDay = day;
  }

  if (body.additionalRequests !== undefined) {
    const extra = Number(body.additionalRequests);
    if (isNaN(extra) || extra < 0) {
      return NextResponse.json(
        { error: "additionalRequests must be >= 0" },
        { status: 400 }
      );
    }
    updates.additionalRequests = extra;
  }

  const saved = saveConfig(updates);
  return NextResponse.json(saved);
}

import { NextRequest, NextResponse } from "next/server";
import {
  getModelLimitsFromDb,
  upsertModelLimit,
  getRecentRateLimitErrors,
} from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const limits = getModelLimitsFromDb();
    const recentErrors = getRecentRateLimitErrors();

    return NextResponse.json({
      modelLimits: limits,
      recentRateLimitErrors: recentErrors,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch model limits:", error);
    return NextResponse.json(
      { error: "Failed to fetch model limits" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      modelName,
      contextWindowTokens,
      maxOutputTokens,
      requestsPerMinute,
      concurrentRequests,
      source,
    } = body;

    if (!modelName || !contextWindowTokens) {
      return NextResponse.json(
        { error: "modelName and contextWindowTokens are required" },
        { status: 400 }
      );
    }

    upsertModelLimit({
      modelName,
      contextWindowTokens,
      maxOutputTokens: maxOutputTokens || null,
      requestsPerMinute: requestsPerMinute || null,
      concurrentRequests: concurrentRequests || null,
      source: source || "api",
    });

    return NextResponse.json(
      { success: true, modelName },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to record model limit:", error);
    return NextResponse.json(
      { error: "Failed to record model limit" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  recordProxyRequestWithRateLimit,
  getAllProxyRequestsFromDb,
  getRecentRateLimitErrors,
} from "@/lib/db";

/**
 * GET /api/proxy-requests
 * Returns all proxy requests and recent rate limit errors.
 */
export async function GET(req: NextRequest) {
  try {
    const allRequests = getAllProxyRequestsFromDb();
    const recentErrors = getRecentRateLimitErrors();

    return NextResponse.json({
      total: allRequests.length,
      proxyRequests: allRequests,
      rateLimitErrors: recentErrors,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch proxy requests:", error);
    return NextResponse.json(
      { error: "Failed to fetch proxy requests" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/proxy-requests
 * Record a proxy request with rate limit info and error details.
 * Useful for tracking API calls from the proxy, CLI, or other sources.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      ts,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
      source,
      rateLimitLimit,
      rateLimitRemaining,
      rateLimitResetAt,
      errorCode,
      errorMessage,
    } = body;

    if (!ts || !model) {
      return NextResponse.json(
        { error: "ts and model are required" },
        { status: 400 }
      );
    }

    recordProxyRequestWithRateLimit(
      ts,
      model,
      promptTokens || null,
      completionTokens || null,
      totalTokens || null,
      latencyMs || 0,
      source || "unknown",
      rateLimitLimit || null,
      rateLimitRemaining || null,
      rateLimitResetAt || null,
      errorCode || null,
      errorMessage || null
    );

    return NextResponse.json(
      {
        success: true,
        recorded: {
          ts,
          model,
          errorCode: errorCode || null,
          rateLimitRemaining: rateLimitRemaining || null,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to record proxy request:", error);
    return NextResponse.json(
      { error: "Failed to record proxy request" },
      { status: 500 }
    );
  }
}

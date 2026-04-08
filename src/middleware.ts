import { NextRequest, NextResponse } from "next/server";

/**
 * Validates the Origin header on mutating API requests.
 * Prevents DNS rebinding attacks where a malicious page on a rebound domain
 * could POST/PUT to the local dashboard without the user's knowledge.
 */
export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const { method } = req;

  if (
    pathname.startsWith("/api/") &&
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "OPTIONS"
  ) {
    const origin = req.headers.get("origin");
    if (origin && !isLocalOrigin(origin)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export const config = {
  matcher: "/api/:path*",
};

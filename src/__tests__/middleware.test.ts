import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

function makeRequest(
  url: string,
  init?: { method?: string; headers?: Record<string, string> }
): NextRequest {
  return new NextRequest(url, {
    method: init?.method,
    headers: init?.headers,
  });
}

describe("middleware", () => {
  it("allows API reads from localhost", () => {
    const req = makeRequest("http://localhost:3000/api/stats", {
      headers: { host: "localhost:3000" },
    });

    const res = middleware(req);

    expect(res.status).toBe(200);
  });

  it("blocks API reads from non-local hosts", () => {
    const req = makeRequest("http://evil.test/api/sessions", {
      headers: { host: "evil.test" },
    });

    const res = middleware(req);

    expect(res.status).toBe(403);
  });

  it("blocks mutating API requests from non-local origins", () => {
    const req = makeRequest("http://localhost:3000/api/config", {
      method: "PUT",
      headers: {
        host: "localhost:3000",
        origin: "https://evil.test",
      },
    });

    const res = middleware(req);

    expect(res.status).toBe(403);
  });
});
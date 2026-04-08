import { existsSync, readFileSync } from "fs";
import path from "path";
import os from "os";

export interface ProxyRequest {
  ts: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  source: "vscode" | "cli" | "unknown";
}

export const PROXY_JSONL_PATH = path.join(os.homedir(), ".ai-usage", "proxy-requests.jsonl");

/**
 * Read proxy-requests.jsonl from disk and return typed records.
 * Skips malformed lines silently — the capture script may be mid-write.
 */
export function readProxyRequestsFromDisk(): ProxyRequest[] {
  if (!existsSync(PROXY_JSONL_PATH)) return [];

  const lines = readFileSync(PROXY_JSONL_PATH, "utf-8")
    .split("\n")
    .filter((l) => l.trim());

  const records: ProxyRequest[] = [];
  for (const line of lines) {
    try {
      const raw = JSON.parse(line) as {
        ts: string;
        model?: string;
        prompt_tokens?: number | null;
        completion_tokens?: number | null;
        total_tokens?: number | null;
        latency_ms?: number;
        source?: string;
      };
      const src = raw.source;
      records.push({
        ts: raw.ts,
        model: raw.model ?? "unknown",
        promptTokens: raw.prompt_tokens ?? null,
        completionTokens: raw.completion_tokens ?? null,
        totalTokens: raw.total_tokens ?? null,
        latencyMs: raw.latency_ms ?? 0,
        source: src === "vscode" || src === "cli" ? src : "unknown",
      });
    } catch {
      // Skip malformed / partial lines
    }
  }
  return records;
}

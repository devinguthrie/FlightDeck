import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import os from "os";
import type { PlanKey } from "./pricing";

export interface QualityRating {
  quality: number; // 1–5
  taskCompleted: "yes" | "partial" | "no";
  note: string;
  ratedAt: string; // ISO string
}

export interface Config {
  plan: PlanKey;
  billingCycleStartDay: number; // 1–28
  additionalRequests: number;
  planQuota: number; // convenience cache of plan quota
}

interface DataFile {
  config: Config;
  ratings: Record<string, QualityRating>;
}

const DATA_DIR = path.join(os.homedir(), ".ai-usage");
const DATA_FILE = path.join(DATA_DIR, "data.json");

const DEFAULT_CONFIG: Config = {
  plan: "pro",
  billingCycleStartDay: 1,
  additionalRequests: 0,
  planQuota: 300,
};

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadRaw(): DataFile {
  if (!existsSync(DATA_FILE)) {
    return { config: DEFAULT_CONFIG, ratings: {} };
  }
  try {
    const raw = readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DataFile>;
    return {
      config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
      ratings: parsed.ratings ?? {},
    };
  } catch {
    return { config: DEFAULT_CONFIG, ratings: {} };
  }
}

function saveRaw(data: DataFile): void {
  ensureDir();
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// ─── Config ──────────────────────────────────────────────────────────────────

export function getConfig(): Config {
  return loadRaw().config;
}

export function saveConfig(updates: Partial<Config>): Config {
  const data = loadRaw();
  data.config = { ...data.config, ...updates };
  saveRaw(data);
  return data.config;
}

// ─── Ratings ─────────────────────────────────────────────────────────────────

export function getRating(sessionId: string): QualityRating | null {
  return loadRaw().ratings[sessionId] ?? null;
}

export function setRating(
  sessionId: string,
  rating: Omit<QualityRating, "ratedAt">
): QualityRating {
  const data = loadRaw();
  const full: QualityRating = { ...rating, ratedAt: new Date().toISOString() };
  data.ratings[sessionId] = full;
  saveRaw(data);
  return full;
}

export function getAllRatings(): Record<string, QualityRating> {
  return loadRaw().ratings;
}

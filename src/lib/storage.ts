import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import os from "os";
import type { PlanKey } from "./pricing";
import type { QualityRating } from "./db";
import { getRatingFromDb, setRatingInDb, getAllRatingsFromDb } from "./db";

// QualityRating lives in db.ts (primary store); re-exported here for backward compat.
export type { QualityRating } from "./db";

export interface Config {
  plan: PlanKey;
  billingCycleStartDay: number; // 1–28
  additionalRequests: number;
  planQuota: number; // convenience cache of plan quota
}

interface DataFile {
  config: Config;
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
    return { config: DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DataFile>;
    return {
      config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
    };
  } catch {
    return { config: DEFAULT_CONFIG };
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
  return getRatingFromDb(sessionId);
}

export function setRating(
  sessionId: string,
  rating: Omit<QualityRating, "ratedAt">
): QualityRating {
  return setRatingInDb(sessionId, rating);
}

export function getAllRatings(): Record<string, QualityRating> {
  return getAllRatingsFromDb();
}

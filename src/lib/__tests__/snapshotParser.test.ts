import { describe, it, expect } from "vitest";
import { parseSnapshotsFromText } from "@/lib/snapshotParser";
import type { QuotaSnapshotRecord } from "@/lib/snapshotParser";
import { makeSnapshot, makeMonthlySnapshots } from "@/__tests__/fixtures/mockData";

function toJSONL(records: QuotaSnapshotRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

describe("parseSnapshotsFromText", () => {
  describe("empty / missing data", () => {
    it("returns available=false for empty string", () => {
      const result = parseSnapshotsFromText("");
      expect(result.available).toBe(false);
      expect(result.latestSnapshot).toBeNull();
    });

    it("returns available=false for whitespace-only string", () => {
      const result = parseSnapshotsFromText("   \n   \n  ");
      expect(result.available).toBe(false);
    });

    it("returns available=false when all lines are malformed JSON", () => {
      const result = parseSnapshotsFromText("NOT JSON\n{broken");
      expect(result.available).toBe(false);
    });

    it("returns all zero counts when available=false", () => {
      const result = parseSnapshotsFromText("");
      expect(result.premiumEntitlement).toBe(0);
      expect(result.premiumUsed).toBe(0);
      expect(result.premiumRemaining).toBe(0);
      expect(result.timeSeries.length).toBe(0);
    });
  });

  describe("single snapshot", () => {
    it("parses a single record correctly", () => {
      const snap = makeSnapshot({
        recorded_at: "2026-04-06T10:00:00.000Z",
        premium_entitlement: 300,
        premium_remaining: 178,
        chat_entitlement: 500,
        chat_remaining: 350,
        completions_entitlement: 1000,
        completions_remaining: 800,
        copilot_plan: "pro",
        quota_reset_date: "2026-05-01",
      });
      const result = parseSnapshotsFromText(JSON.stringify(snap));

      expect(result.available).toBe(true);
      expect(result.premiumEntitlement).toBe(300);
      expect(result.premiumRemaining).toBe(178);
      expect(result.premiumUsed).toBe(122); // 300 - 178
      expect(result.chatEntitlement).toBe(500);
      expect(result.chatUsed).toBe(150); // 500 - 350
      expect(result.chatRemaining).toBe(350);
      expect(result.completionsEntitlement).toBe(1000);
      expect(result.completionsUsed).toBe(200); // 1000 - 800
      expect(result.completionsRemaining).toBe(800);
      expect(result.copilotPlan).toBe("pro");
      expect(result.quotaResetDate).toBe("2026-05-01");
    });

    it("latestRecordedAt matches the record's recorded_at", () => {
      const snap = makeSnapshot({ recorded_at: "2026-04-06T10:00:00.000Z" });
      const result = parseSnapshotsFromText(JSON.stringify(snap));
      expect(result.latestRecordedAt).toBe("2026-04-06T10:00:00.000Z");
    });

    it("builds timeSeries with one point", () => {
      const snap = makeSnapshot({
        premium_entitlement: 300,
        premium_remaining: 200,
        chat_entitlement: 500,
        chat_remaining: 400,
      });
      const result = parseSnapshotsFromText(JSON.stringify(snap));
      expect(result.timeSeries.length).toBe(1);
      expect(result.timeSeries[0].premiumUsed).toBe(100); // 300 - 200
      expect(result.timeSeries[0].chatUsed).toBe(100); // 500 - 400
    });
  });

  describe("multiple snapshots", () => {
    it("uses the latest snapshot for summary fields", () => {
      const records = [
        makeSnapshot({ recorded_at: "2026-04-04T10:00:00Z", premium_remaining: 250 }),
        makeSnapshot({ recorded_at: "2026-04-06T10:00:00Z", premium_remaining: 178 }), // latest
        makeSnapshot({ recorded_at: "2026-04-05T10:00:00Z", premium_remaining: 220 }),
      ];
      const result = parseSnapshotsFromText(toJSONL(records));
      expect(result.premiumRemaining).toBe(178);
      expect(result.latestRecordedAt).toBe("2026-04-06T10:00:00Z");
    });

    it("sorts timeSeries ascending by timestamp", () => {
      const records = [
        makeSnapshot({ recorded_at: "2026-04-06T10:00:00Z", premium_remaining: 178 }),
        makeSnapshot({ recorded_at: "2026-04-04T10:00:00Z", premium_remaining: 250 }),
        makeSnapshot({ recorded_at: "2026-04-05T10:00:00Z", premium_remaining: 220 }),
      ];
      const result = parseSnapshotsFromText(toJSONL(records));
      expect(result.timeSeries[0].timestamp).toBe("2026-04-04T10:00:00Z");
      expect(result.timeSeries[1].timestamp).toBe("2026-04-05T10:00:00Z");
      expect(result.timeSeries[2].timestamp).toBe("2026-04-06T10:00:00Z");
    });

    it("timeSeries premiumUsed increases monotonically when quota is consumed daily", () => {
      const records = makeMonthlySnapshots();
      const result = parseSnapshotsFromText(toJSONL(records));
      const used = result.timeSeries.map((p) => p.premiumUsed);
      for (let i = 1; i < used.length; i++) {
        expect(used[i]).toBeGreaterThanOrEqual(used[i - 1]);
      }
    });

    it("timeSeries has correct length for 30 snapshots", () => {
      const records = makeMonthlySnapshots();
      const result = parseSnapshotsFromText(toJSONL(records));
      expect(result.timeSeries.length).toBe(30);
    });

    it("ignores malformed lines and still processes valid ones", () => {
      const snap = makeSnapshot({ recorded_at: "2026-04-06T10:00:00Z" });
      const text = ["NOT JSON", JSON.stringify(snap), "{broken}"].join("\n");
      const result = parseSnapshotsFromText(text);
      expect(result.available).toBe(true);
      expect(result.timeSeries.length).toBe(1);
    });
  });

  describe("timeSeries computation correctness", () => {
    it("chatUsed = chat_entitlement - chat_remaining (not stored directly)", () => {
      const snap = makeSnapshot({
        chat_entitlement: 500,
        chat_remaining: 123,
      });
      const result = parseSnapshotsFromText(JSON.stringify(snap));
      // The raw field is 'remaining', not 'used' — verify the subtraction
      expect(result.timeSeries[0].chatUsed).toBe(377); // 500 - 123
    });

    it("completionsUsed = completions_entitlement - completions_remaining", () => {
      const snap = makeSnapshot({
        completions_entitlement: 1000,
        completions_remaining: 600,
      });
      const result = parseSnapshotsFromText(JSON.stringify(snap));
      expect(result.timeSeries[0].completionsUsed).toBe(400); // 1000 - 600
    });

    it("timeSeries timestamp matches recorded_at field", () => {
      const snap = makeSnapshot({ recorded_at: "2026-01-15T08:30:00.000Z" });
      const result = parseSnapshotsFromText(JSON.stringify(snap));
      expect(result.timeSeries[0].timestamp).toBe("2026-01-15T08:30:00.000Z");
    });
  });

  describe("empty quota_reset_date and copilot_plan", () => {
    it("returns null for quotaResetDate when field is empty string", () => {
      const snap = makeSnapshot({ quota_reset_date: "" });
      const result = parseSnapshotsFromText(JSON.stringify(snap));
      expect(result.quotaResetDate).toBeNull();
    });

    it("returns null for copilotPlan when field is empty string", () => {
      const snap = makeSnapshot({ copilot_plan: "" });
      const result = parseSnapshotsFromText(JSON.stringify(snap));
      expect(result.copilotPlan).toBeNull();
    });
  });
});

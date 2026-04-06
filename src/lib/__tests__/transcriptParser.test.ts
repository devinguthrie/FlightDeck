import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import path from "path";
import os from "os";
import { parseTranscriptFile } from "@/lib/transcriptParser";

// ─── Temp directory helpers ───────────────────────────────────────────────────

const TMP_DIR = path.join(os.tmpdir(), "flightdeck-transcript-tests");

function writeTmpTranscript(name: string, lines: object[]): string {
  const filePath = path.join(TMP_DIR, name);
  writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join("\n"), "utf-8");
  return filePath;
}

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
});

// ─── Builder helpers for JSONL events ─────────────────────────────────────────

function sessionStart(sessionId = "test-session", startTime = "2026-04-01T10:00:00.000Z") {
  return {
    type: "session.start",
    id: "evt-001",
    timestamp: startTime,
    parentId: null,
    data: { sessionId, startTime, copilotVersion: "1.237.0", vscodeVersion: "1.88.0" },
  };
}

function userMsg(content: string, ts: string) {
  return { type: "user.message", id: "evt-u", timestamp: ts, parentId: null, data: { content } };
}

function assistantTurnStart(ts: string) {
  return { type: "assistant.turn_start", id: "evt-a", timestamp: ts, parentId: null, data: {} };
}

function assistantMsg(content: string, ts: string, toolRequests: object[] = []) {
  return {
    type: "assistant.message",
    id: "evt-am",
    timestamp: ts,
    parentId: null,
    data: { content, toolRequests },
  };
}

function toolExec(toolName: string, ts: string, args: Record<string, unknown> = {}) {
  return {
    type: "tool.execution_start",
    id: "evt-t",
    timestamp: ts,
    parentId: null,
    data: { toolName, arguments: args },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("parseTranscriptFile", () => {
  describe("basic parsing", () => {
    it("returns null for a missing file", () => {
      expect(parseTranscriptFile("/nonexistent/path/session.jsonl")).toBeNull();
    });

    it("returns null for an empty file", () => {
      const f = writeTmpTranscript("empty.jsonl", []);
      expect(parseTranscriptFile(f)).toBeNull();
    });

    it("returns null when there is no session.start event", () => {
      const f = writeTmpTranscript("no-start.jsonl", [
        userMsg("hello", "2026-04-01T10:01:00Z"),
        assistantTurnStart("2026-04-01T10:01:05Z"),
      ]);
      expect(parseTranscriptFile(f)).toBeNull();
    });

    it("parses a minimal valid session", () => {
      const f = writeTmpTranscript("minimal.jsonl", [
        sessionStart("s-min", "2026-04-01T08:00:00Z"),
      ]);
      const result = parseTranscriptFile(f);
      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("s-min");
      expect(result!.startedAt).toBe("2026-04-01T08:00:00Z");
      expect(result!.copilotVersion).toBe("1.237.0");
      expect(result!.vsCodeVersion).toBe("1.88.0");
    });

    it("skips malformed JSON lines without crashing", () => {
      const filePath = path.join(TMP_DIR, "malformed.jsonl");
      writeFileSync(
        filePath,
        [
          JSON.stringify(sessionStart("s-bad")),
          "THIS IS NOT JSON {{{{",
          JSON.stringify(userMsg("hi", "2026-04-01T10:01:00Z")),
        ].join("\n"),
        "utf-8"
      );
      const result = parseTranscriptFile(filePath);
      expect(result).not.toBeNull();
      expect(result!.userTurns).toBe(1);
    });
  });

  describe("event counting", () => {
    it("counts user.message events as userTurns", () => {
      const f = writeTmpTranscript("user-turns.jsonl", [
        sessionStart("s-ut"),
        userMsg("first", "2026-04-01T10:01:00Z"),
        assistantTurnStart("2026-04-01T10:01:05Z"),
        assistantMsg("reply 1", "2026-04-01T10:01:10Z"),
        userMsg("second", "2026-04-01T10:02:00Z"),
        assistantTurnStart("2026-04-01T10:02:05Z"),
        assistantMsg("reply 2", "2026-04-01T10:02:10Z"),
        userMsg("third", "2026-04-01T10:03:00Z"),
        assistantTurnStart("2026-04-01T10:03:05Z"),
        assistantMsg("reply 3", "2026-04-01T10:03:10Z"),
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.userTurns).toBe(3);
      expect(result.assistantTurns).toBe(3);
      expect(result.premiumRequests).toBe(3); // premiumRequests = assistantTurns
    });

    it("counts tool.execution_start events as toolCalls", () => {
      const f = writeTmpTranscript("tool-calls.jsonl", [
        sessionStart("s-tc"),
        userMsg("do things", "2026-04-01T10:01:00Z"),
        assistantTurnStart("2026-04-01T10:01:01Z"),
        toolExec("read_file", "2026-04-01T10:01:02Z"),
        toolExec("read_file", "2026-04-01T10:01:03Z"),
        toolExec("grep_search", "2026-04-01T10:01:04Z"),
        assistantMsg("done", "2026-04-01T10:01:05Z"),
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.toolCallsTotal).toBe(3);
      expect(result.toolCallsByName["read_file"]).toBe(2);
      expect(result.toolCallsByName["grep_search"]).toBe(1);
    });

    it("each tool is counted separately in toolCallsByName", () => {
      const f = writeTmpTranscript("tool-map.jsonl", [
        sessionStart("s-tm"),
        assistantTurnStart("2026-04-01T10:01:01Z"),
        toolExec("run_in_terminal", "2026-04-01T10:01:02Z"),
        toolExec("run_in_terminal", "2026-04-01T10:01:03Z"),
        toolExec("run_in_terminal", "2026-04-01T10:01:04Z"),
        toolExec("semantic_search", "2026-04-01T10:01:05Z"),
        assistantMsg("done", "2026-04-01T10:01:06Z"),
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.toolCallsByName["run_in_terminal"]).toBe(3);
      expect(result.toolCallsByName["semantic_search"]).toBe(1);
    });
  });

  describe("skill detection", () => {
    it("detects skill activations from SKILL.md tool reads", () => {
      const f = writeTmpTranscript("skills.jsonl", [
        sessionStart("s-sk"),
        assistantTurnStart("2026-04-01T10:01:01Z"),
        toolExec("read_file", "2026-04-01T10:01:02Z", {
          filePath: "/home/user/.claude/skills/qa/SKILL.md",
        }),
        toolExec("read_file", "2026-04-01T10:01:03Z", {
          filePath: "/home/user/.claude/skills/ship/SKILL.md",
        }),
        assistantMsg("done", "2026-04-01T10:01:04Z"),
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.skillsActivated).toContain("qa");
      expect(result.skillsActivated).toContain("ship");
      expect(result.skillsActivated.length).toBe(2);
    });

    it("deduplicates skill activations if the same skill is read multiple times", () => {
      // Regex: skills/([^/\\]+)/SKILL.md — ONE segment between 'skills' and 'SKILL.md'
      const f = writeTmpTranscript("skills-dedup.jsonl", [
        sessionStart("s-sd"),
        assistantTurnStart("2026-04-01T10:01:01Z"),
        toolExec("read_file", "2026-04-01T10:01:02Z", {
          filePath: "~/.claude/skills/qa/SKILL.md",
        }),
        toolExec("read_file", "2026-04-01T10:01:03Z", {
          filePath: "~/.claude/skills/qa/SKILL.md",
        }),
        assistantMsg("done", "2026-04-01T10:01:04Z"),
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.skillsActivated).toContain("qa");
      expect(result.skillsActivated.length).toBe(1);
    });

    it("does not count non-SKILL.md reads as skill activations", () => {
      const f = writeTmpTranscript("no-skills.jsonl", [
        sessionStart("s-ns"),
        assistantTurnStart("2026-04-01T10:01:01Z"),
        toolExec("read_file", "2026-04-01T10:01:02Z", {
          filePath: "/home/user/.claude/skills/qa/README.md",
        }),
        toolExec("read_file", "2026-04-01T10:01:03Z", {
          filePath: "/project/src/components/Button.tsx",
        }),
        assistantMsg("done", "2026-04-01T10:01:04Z"),
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.skillsActivated.length).toBe(0);
    });
  });

  describe("duration and timestamps", () => {
    it("computes durationMinutes from startedAt to the latest event timestamp", () => {
      const f = writeTmpTranscript("duration.jsonl", [
        sessionStart("s-dur", "2026-04-01T10:00:00Z"),
        userMsg("start", "2026-04-01T10:00:30Z"),
        assistantTurnStart("2026-04-01T10:00:31Z"),
        assistantMsg("reply", "2026-04-01T10:30:00Z"), // 30 minutes later
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.durationMinutes).toBeCloseTo(30, 0);
    });

    it("returns 0 duration for a session with only a start event", () => {
      const f = writeTmpTranscript("zero-dur.jsonl", [
        sessionStart("s-zd", "2026-04-01T10:00:00Z"),
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.durationMinutes).toBe(0);
    });

    it("sets endedAt to the latest event timestamp", () => {
      const f = writeTmpTranscript("latest-ts.jsonl", [
        sessionStart("s-lt", "2026-04-01T09:00:00Z"),
        userMsg("a", "2026-04-01T09:05:00Z"),
        assistantTurnStart("2026-04-01T09:05:01Z"),
        assistantMsg("b", "2026-04-01T09:45:00Z"),
        userMsg("c", "2026-04-01T09:50:00Z"),
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.endedAt).toBe("2026-04-01T09:50:00Z");
    });
  });

  describe("token estimation", () => {
    it("estimates tokens from message content (~4 chars per token)", () => {
      const content = "a".repeat(400); // 400 chars → ~100 tokens
      const f = writeTmpTranscript("tokens.jsonl", [
        sessionStart("s-tok"),
        userMsg(content, "2026-04-01T10:01:00Z"),
        assistantTurnStart("2026-04-01T10:01:01Z"),
        assistantMsg("b".repeat(800), "2026-04-01T10:01:02Z"), // ~200 tokens
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.estimatedInputTokens).toBe(100);
      expect(result.estimatedOutputTokens).toBe(200);
      expect(result.estimatedTotalTokens).toBe(300);
    });

    it("handles empty messages without crashing (0 tokens)", () => {
      const f = writeTmpTranscript("empty-msg.jsonl", [
        sessionStart("s-em"),
        userMsg("", "2026-04-01T10:01:00Z"),
        assistantTurnStart("2026-04-01T10:01:01Z"),
        assistantMsg("", "2026-04-01T10:01:02Z"),
      ]);
      const result = parseTranscriptFile(f)!;
      expect(result.estimatedInputTokens).toBe(0);
      expect(result.estimatedOutputTokens).toBe(0);
    });
  });
});

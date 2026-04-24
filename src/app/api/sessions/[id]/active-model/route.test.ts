import { describe, expect, it, vi, beforeEach } from "vitest";

const { prepareMock, findSessionModelInfoMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  findSessionModelInfoMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    prepare: prepareMock,
  }),
}));

vi.mock("@/lib/transcriptParser", () => ({
  findSessionModelInfo: findSessionModelInfoMock,
}));

import { GET } from "./route";

describe("GET /api/sessions/[id]/active-model", () => {
  beforeEach(() => {
    prepareMock.mockReset();
    findSessionModelInfoMock.mockReset();
  });

  it("returns stored model data when the database already has it", async () => {
    prepareMock.mockImplementation((sql: string) => {
      if (sql.startsWith("SELECT active_model")) {
        return {
          get: () => ({
            active_model: "Claude Sonnet 4.6",
            used_models: JSON.stringify(["Claude Sonnet 4.6"]),
          }),
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await GET({} as never, {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: "session-1",
      activeModel: "Claude Sonnet 4.6",
      usedModels: ["Claude Sonnet 4.6"],
    });
    expect(findSessionModelInfoMock).not.toHaveBeenCalled();
  });

  it("backfills model data from chatSessions when the database is empty", async () => {
    const updateRun = vi.fn();

    prepareMock.mockImplementation((sql: string) => {
      if (sql.startsWith("SELECT active_model")) {
        return {
          get: () => ({
            active_model: null,
            used_models: JSON.stringify([]),
          }),
        };
      }

      if (sql.startsWith("UPDATE sessions SET active_model")) {
        return { run: updateRun };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    findSessionModelInfoMock.mockReturnValue({
      activeModel: "Claude Opus 4.6",
      usedModels: ["Auto", "Claude Opus 4.6"],
    });

    const response = await GET({} as never, {
      params: Promise.resolve({ id: "session-2" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: "session-2",
      activeModel: "Claude Opus 4.6",
      usedModels: ["Auto", "Claude Opus 4.6"],
    });
    expect(findSessionModelInfoMock).toHaveBeenCalledWith("session-2");
    expect(updateRun).toHaveBeenCalledWith(
      "Claude Opus 4.6",
      JSON.stringify(["Auto", "Claude Opus 4.6"]),
      "session-2"
    );
  });
});

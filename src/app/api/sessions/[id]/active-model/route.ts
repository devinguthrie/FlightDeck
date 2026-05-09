import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { findSessionModelInfo } from "@/lib/transcriptParser";

/**
 * POST /api/sessions/[id]/active-model
 * Update the active model and list of used models for a session.
 * Called in real-time during an active session when model changes are detected.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const body = await req.json();
    const { activeModel, usedModels } = body;

    if (!sessionId || !activeModel) {
      return NextResponse.json(
        { error: "sessionId and activeModel are required" },
        { status: 400 }
      );
    }

    const db = getDb();

    // Wrap read-modify-write in a transaction to prevent concurrent POSTs
    // from racing and silently dropping model entries.
    const mergedUsedModels = db.transaction(() => {
      const session = db
        .prepare("SELECT used_models FROM sessions WHERE session_id = ?")
        .get(sessionId) as { used_models: string } | undefined;

      if (!session) return null;

      const currentUsedModels = JSON.parse(session.used_models || "[]") as string[];
      const merged = Array.from(
        new Set([...currentUsedModels, activeModel, ...(Array.isArray(usedModels) ? usedModels : [])])
      );

      db.prepare(
        "UPDATE sessions SET active_model = ?, used_models = ? WHERE session_id = ?"
      ).run(activeModel, JSON.stringify(merged), sessionId);

      return merged;
    })();

    if (mergedUsedModels === null) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        sessionId,
        activeModel,
        usedModels: mergedUsedModels,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to update active model:", error);
    return NextResponse.json(
      { error: "Failed to update active model" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sessions/[id]/active-model
 * Get the current active model and list of used models for a session.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const db = getDb();

    const session = db
      .prepare("SELECT active_model, used_models FROM sessions WHERE session_id = ?")
      .get(sessionId) as { active_model: string | null; used_models: string } | undefined;

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const storedUsedModels = JSON.parse(session.used_models || "[]") as string[];
    const needsBackfill = !session.active_model && storedUsedModels.length === 0;

    if (needsBackfill) {
      const fallbackModelInfo = findSessionModelInfo(sessionId);
      if (fallbackModelInfo) {
        // Use WHERE active_model IS NULL so concurrent GETs don't race — only
        // the first writer succeeds; subsequent writes are no-ops.
        db.prepare(
          "UPDATE sessions SET active_model = ?, used_models = ? WHERE session_id = ? AND active_model IS NULL"
        ).run(
          fallbackModelInfo.activeModel,
          JSON.stringify(fallbackModelInfo.usedModels),
          sessionId
        );

        const updated = db
          .prepare("SELECT active_model, used_models FROM sessions WHERE session_id = ?")
          .get(sessionId) as { active_model: string | null; used_models: string } | undefined;

        const rereadUsedModels = JSON.parse(updated?.used_models || "[]") as string[];
        return NextResponse.json({
          sessionId,
          activeModel: updated?.active_model ?? fallbackModelInfo.activeModel,
          usedModels: rereadUsedModels.length > 0 ? rereadUsedModels : fallbackModelInfo.usedModels,
        });
      }
    }

    return NextResponse.json({
      sessionId,
      activeModel: session.active_model,
      usedModels: storedUsedModels,
    });
  } catch (error) {
    console.error("Failed to fetch active model:", error);
    return NextResponse.json(
      { error: "Failed to fetch active model" },
      { status: 500 }
    );
  }
}

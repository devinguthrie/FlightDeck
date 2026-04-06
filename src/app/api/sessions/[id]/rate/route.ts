import { NextRequest, NextResponse } from "next/server";
import { setRating } from "@/lib/storage";

interface RateBody {
  quality: number;
  taskCompleted: "yes" | "partial" | "no";
  note: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  let body: RateBody;
  try {
    body = (await req.json()) as RateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { quality, taskCompleted, note } = body;

  if (typeof quality !== "number" || quality < 1 || quality > 5) {
    return NextResponse.json(
      { error: "quality must be an integer 1–5" },
      { status: 400 }
    );
  }

  const validCompleted = ["yes", "partial", "no"];
  if (!validCompleted.includes(taskCompleted)) {
    return NextResponse.json(
      { error: "taskCompleted must be yes | partial | no" },
      { status: 400 }
    );
  }

  if (typeof note === "string" && note.length > 2048) {
    return NextResponse.json(
      { error: "note exceeds maximum length of 2048 characters" },
      { status: 400 }
    );
  }

  const saved = setRating(sessionId, {
    quality,
    taskCompleted,
    note: note ?? "",
  });

  return NextResponse.json(saved);
}

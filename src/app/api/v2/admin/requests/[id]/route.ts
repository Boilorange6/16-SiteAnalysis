import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { transitionTileRequest } from "@/lib/v2/admin/requests";
import { v2AppDbPath } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!isUser(auth)) return auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "요청 번호가 올바르지 않습니다" }, { status: 400 });
  const body = await req.json().catch(() => null) as { action?: unknown; note?: unknown } | null;
  if (body?.action !== "reopen") return NextResponse.json({ error: "다시 열기만 할 수 있습니다" }, { status: 400 });
  const db = openV2AppDb(v2AppDbPath());
  try {
    const result = transitionTileRequest(db, id, "대기", { note: typeof body.note === "string" ? body.note : undefined });
    return result.ok ? NextResponse.json({ request: result.request }) : NextResponse.json({ error: result.error }, { status: 400 });
  } finally {
    db.close();
  }
}

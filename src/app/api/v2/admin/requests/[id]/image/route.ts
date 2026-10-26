import { existsSync, readFileSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { getTileRequest } from "@/lib/v2/admin/requests";
import { v2AppDbPath } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!isUser(auth)) return auth;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "요청을 찾을 수 없습니다" }, { status: 404 });
  const db = openV2AppDb(v2AppDbPath());
  try {
    const request = getTileRequest(db, id);
    if (!request?.imagePath || !existsSync(request.imagePath)) return NextResponse.json({ error: "요청 그림이 없습니다" }, { status: 404 });
    return new NextResponse(readFileSync(request.imagePath), { headers: { "Content-Type": "image/png" } });
  } finally {
    db.close();
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { allowedDetailControls, getDetailAt } from "@/lib/v2/engine/detail/registry";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; code: string }> }) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id, code } = await params;
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < 124 || lng > 132 || lat < 33 || lat > 39) {
    return NextResponse.json({ error: "좌표가 올바르지 않습니다" }, { status: 400 });
  }
  const appDb = openV2AppDb();
  try {
    const reply = getDetailAt(appDb, v2DataDir(), id, code, lng, lat, auth.id, allowedDetailControls(req.nextUrl.searchParams));
    return NextResponse.json(reply.body, { status: reply.status });
  } finally {
    appDb.close();
  }
}

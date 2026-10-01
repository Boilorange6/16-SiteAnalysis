import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { getTileRaster } from "@/lib/v2/engine/raster-api";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; code: string; name: string }> },
) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id, code, name } = await params;
  const appDb = openV2AppDb();
  try {
    const reply = getTileRaster(appDb, id, code, name, auth.id);
    if (reply.status !== 200) {
      return reply.status === 403
        ? NextResponse.json({ error: "접근할 수 없는 분석입니다" }, { status: 403 })
        : NextResponse.json({ error: "래스터를 찾을 수 없습니다" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(reply.body), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Raster-Name": reply.ref.name,
      },
    });
  } finally {
    appDb.close();
  }
}

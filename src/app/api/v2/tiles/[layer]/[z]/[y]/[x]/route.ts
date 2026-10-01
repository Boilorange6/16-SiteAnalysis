import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { sameOriginRequest, serveTile, TILE_CACHE_CONTROL, type TileParams } from "@/lib/v2/tiles";

export const runtime = "nodejs";

/** 배경지도 타일 프록시. 세션 또는 같은 출처 헤더와 요청 제한을 요구한다. */
export async function GET(req: NextRequest, { params }: { params: Promise<TileParams> }) {
  const auth = await requireAuth(req);
  const requestHost = req.headers.get("host") ?? req.nextUrl.host;
  if (!isUser(auth) && !sameOriginRequest(req.headers.get("origin"), req.headers.get("referer"), requestHost)) {
    return new NextResponse("허용되지 않은 요청", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const r = await serveTile(await params, req.headers.get("sec-fetch-site"));
  const ok = r.status === 200;
  return new NextResponse(r.body as BodyInit, {
    status: r.status,
    headers: { "Content-Type": r.type, "Cache-Control": ok ? TILE_CACHE_CONTROL : "no-store" },
  });
}

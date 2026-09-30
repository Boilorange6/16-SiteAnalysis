import { NextRequest, NextResponse } from "next/server";
import { serveTile, TILE_CACHE_CONTROL, type TileParams } from "@/lib/v2/tiles";

export const runtime = "nodejs";

/** 배경지도 타일 프록시. 예시 보드는 로그인 없이 보이므로 인증 대신 같은 출처 확인 + 요청 제한만 둔다. */
export async function GET(req: NextRequest, { params }: { params: Promise<TileParams> }) {
  const r = await serveTile(await params, req.headers.get("sec-fetch-site"));
  const ok = r.status === 200;
  return new NextResponse(r.body as BodyInit, {
    status: r.status,
    headers: { "Content-Type": r.type, "Cache-Control": ok ? TILE_CACHE_CONTROL : "no-store" },
  });
}

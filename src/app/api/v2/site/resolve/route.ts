import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openDataFile, readManifest } from "@/lib/v2/data/manifest";
import { resolveSite, SITE_FAILURE_MESSAGE } from "@/lib/v2/engine/site";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

/** 대지 지정 화면용 주소 해석 — 분석(POST)과 같은 지번 해석기를 쓴다. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!address) return NextResponse.json({ error: SITE_FAILURE_MESSAGE.parse_failed }, { status: 400 });
  const dataDir = v2DataDir();
  const manifest = readManifest(dataDir);
  if (!manifest?.files.core) return NextResponse.json({ error: "분석 데이터가 아직 게시되지 않았습니다" }, { status: 503 });
  let db: ReturnType<typeof openDataFile> | null = null;
  try {
    db = openDataFile(dataDir, manifest, "core");
    const site = resolveSite(db, { address });
    if (!site.ok) return NextResponse.json({ error: SITE_FAILURE_MESSAGE[site.reason], reason: site.reason }, { status: 404 });
    return NextResponse.json({ lng: site.center[0], lat: site.center[1], pnu: site.pnu, label: site.label });
  } catch {
    return NextResponse.json({ error: "주소를 해석하지 못했습니다" }, { status: 500 });
  } finally {
    db?.close();
  }
}

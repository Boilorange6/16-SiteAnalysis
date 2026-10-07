import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { findParcelAt } from "@/lib/v2/data/parcels";
import { openDataFile, readManifest } from "@/lib/v2/data/manifest";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const lngRaw = req.nextUrl.searchParams.get("lng");
  const latRaw = req.nextUrl.searchParams.get("lat");
  const lng = lngRaw === null ? NaN : Number(lngRaw);
  const lat = latRaw === null ? NaN : Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return NextResponse.json({ error: "lng·lat 좌표가 올바르지 않습니다" }, { status: 400 });
  }
  const dataDir = v2DataDir();
  const manifest = readManifest(dataDir);
  if (!manifest?.files.parcels) return NextResponse.json({ error: "필지 자료가 아직 게시되지 않았습니다" }, { status: 503 });
  let db: ReturnType<typeof openDataFile> | null = null;
  try {
    db = openDataFile(dataDir, manifest, "parcels");
    const parcel = findParcelAt(db, lng, lat);
    return parcel ? NextResponse.json(parcel) : NextResponse.json({ error: "해당 위치의 필지를 찾지 못했습니다" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "필지 자료를 조회하지 못했습니다" }, { status: 500 });
  } finally {
    db?.close();
  }
}

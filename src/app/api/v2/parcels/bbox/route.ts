import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { findParcelsInBbox, validateParcelBbox } from "@/lib/v2/data/parcels";
import { openDataFile, readManifest } from "@/lib/v2/data/manifest";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const values = Object.fromEntries(["w", "s", "e", "n"].map((key) => [key, Number(req.nextUrl.searchParams.get(key) ?? NaN)])) as { w: number; s: number; e: number; n: number };
  const validation = validateParcelBbox(values);
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });
  const dataDir = v2DataDir();
  const manifest = readManifest(dataDir);
  if (!manifest?.files.parcels) return NextResponse.json({ error: "필지 자료가 아직 게시되지 않았습니다" }, { status: 503 });
  let db: ReturnType<typeof openDataFile> | null = null;
  try {
    db = openDataFile(dataDir, manifest, "parcels");
    return NextResponse.json(findParcelsInBbox(db, values));
  } catch (error) {
    if (error instanceof RangeError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "필지 자료를 조회하지 못했습니다" }, { status: 500 });
  } finally {
    db?.close();
  }
}

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { readGuideSourceSnapshot } from "@/lib/v2/ui/guide-sources";
import { parseSourceIds, sourceApiBody } from "@/lib/v2/ui/source-api";

export const runtime = "nodejs";

const CACHE_CONTROL = "private, max-age=300, must-revalidate";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;

  const ids = parseSourceIds(req.nextUrl.searchParams.getAll("ids"));
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids가 필요합니다" }, { status: 400 });
  }

  const body = sourceApiBody(readGuideSourceSnapshot(), ids);
  const etag = `"${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
  const headers = new Headers({ "Cache-Control": CACHE_CONTROL, ETag: etag });
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return NextResponse.json(body, { headers });
}

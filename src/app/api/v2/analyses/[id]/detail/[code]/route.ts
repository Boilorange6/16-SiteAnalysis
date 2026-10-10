import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { allowedDetailControls, getDetailList } from "@/lib/v2/engine/detail/registry";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; code: string }> }) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id, code } = await params;
  const search = req.nextUrl.searchParams;
  const rawOffset = Number(search.get("offset"));
  const rawLimit = Number(search.get("limit"));
  const dir = search.get("dir");
  const within10 = search.get("within10");
  const appDb = openV2AppDb();
  try {
    const reply = getDetailList(appDb, v2DataDir(), id, code, auth.id, {
      controls: allowedDetailControls(search),
      q: search.get("q") ?? undefined,
      sort: search.get("sort") ?? undefined,
      dir: dir === "desc" ? "desc" : "asc",
      within10: within10 === "1" || within10 === "true" ? true : undefined,
      offset: Number.isFinite(rawOffset) ? rawOffset : undefined,
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
    });
    return NextResponse.json(reply.body, { status: reply.status });
  } finally {
    appDb.close();
  }
}

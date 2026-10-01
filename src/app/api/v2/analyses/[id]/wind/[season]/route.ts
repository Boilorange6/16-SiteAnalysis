import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { putWindField } from "@/lib/v2/engine/wind-api";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; season: string }> },
) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id, season } = await params;
  const body = Buffer.from(await req.arrayBuffer());
  const appDb = openV2AppDb();
  try {
    const result = putWindField(appDb, v2DataDir(), id, season, body, auth.id);
    return NextResponse.json(result.body, { status: result.status });
  } finally {
    appDb.close();
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { getScene } from "@/lib/v2/engine/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id } = await params;
  const appDb = openV2AppDb();
  try {
    const reply = getScene(appDb, id);
    return NextResponse.json(reply.body, { status: reply.status });
  } finally {
    appDb.close();
  }
}

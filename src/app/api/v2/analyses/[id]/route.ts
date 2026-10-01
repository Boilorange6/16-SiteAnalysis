import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { getAnalysis } from "@/lib/v2/engine/api";
import { startJobRunner } from "@/lib/v2/engine/jobs";
import { v2AppDbPath, v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id } = await params;
  const appDb = openV2AppDb();
  try {
    startJobRunner({ appDbPath: v2AppDbPath(), dataDir: v2DataDir() });
    const reply = getAnalysis(appDb, id, auth.id);
    return NextResponse.json(reply.body, { status: reply.status });
  } finally {
    appDb.close();
  }
}

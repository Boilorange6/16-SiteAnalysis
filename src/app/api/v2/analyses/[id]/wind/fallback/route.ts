import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { requestWindFallback } from "@/lib/v2/engine/wind-api";
import { v2AppDbPath, v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id } = await params;
  const body = await req.json().catch(() => null) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason : "WebGPU 미지원";
  const appDb = openV2AppDb();
  try {
    const result = requestWindFallback(appDb, id, auth.id, reason, { appDbPath: v2AppDbPath(), dataDir: v2DataDir() });
    return NextResponse.json(result.body, { status: result.status });
  } finally {
    appDb.close();
  }
}

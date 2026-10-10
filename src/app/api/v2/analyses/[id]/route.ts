import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { cancelAnalysis, getAnalysis, getAnalysisStatus } from "@/lib/v2/engine/api";
import { v2AppDbPath, v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

function responseFor(req: NextRequest, reply: { status: number; body: Record<string, unknown> }): NextResponse {
  const revision = typeof reply.body.revision === "string" ? reply.body.revision : null;
  const etag = revision ? `"${revision}"` : null;
  const headers = new Headers();
  if (etag) {
    headers.set("ETag", etag);
    headers.set("Cache-Control", "private, no-cache");
  }
  if (etag && req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return NextResponse.json(reply.body, { status: reply.status, headers });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id } = await params;
  const appDb = openV2AppDb();
  try {
    void import("@/lib/v2/engine/jobs")
      .then(({ startJobRunner }) => startJobRunner({ appDbPath: v2AppDbPath(), dataDir: v2DataDir() }))
      .catch((error) => console.warn(`v2 analysis worker start failed: ${String(error).slice(0, 200)}`));
    if (req.nextUrl.searchParams.get("status") === "1") return responseFor(req, getAnalysisStatus(appDb, id, auth.id));
    const requested = req.nextUrl.searchParams.get("tiles");
    const tileCodes = requested === null ? undefined : requested.split(",").map((code) => code.trim()).filter(Boolean);
    return responseFor(req, getAnalysis(appDb, id, auth.id, { tileCodes }));
  } finally {
    appDb.close();
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(_req);
  if (!isUser(auth)) return auth;
  const { id } = await params;
  const appDb = openV2AppDb();
  try {
    const reply = cancelAnalysis(appDb, id, auth.id);
    return NextResponse.json(reply.body, { status: reply.status });
  } finally {
    appDb.close();
  }
}

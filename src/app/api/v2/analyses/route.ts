import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { postAnalysis } from "@/lib/v2/engine/api";
import { v2AppDbPath, v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const body = await req.json().catch(() => null);
  const appDb = openV2AppDb();
  try {
    const reply = postAnalysis(appDb, v2DataDir(), body, auth.id);
    if (reply.status === 202) {
      // The worker and heavy simulation modules are not part of the first POST bundle.
      void import("@/lib/v2/engine/jobs")
        .then(({ startJobRunner }) => startJobRunner({ appDbPath: v2AppDbPath(), dataDir: v2DataDir() }))
        .catch((error) => console.warn(`v2 analysis worker start failed: ${String(error).slice(0, 200)}`));
    }
    return NextResponse.json(reply.body, { status: reply.status });
  } finally {
    appDb.close();
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { buildAdminOverview } from "@/lib/v2/admin/overview";
import { v2AppDbPath, v2DataDir } from "@/lib/v2/paths";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (!isUser(auth)) return auth;
  const db = openV2AppDb(v2AppDbPath());
  try {
    const overview = buildAdminOverview({
      appDb: db,
      dataDir: v2DataDir(),
      analysisId: req.nextUrl.searchParams.get("analysis"),
      userId: auth.id,
      repoRoot: process.cwd(),
    });
    return NextResponse.json(overview);
  } finally {
    db.close();
  }
}

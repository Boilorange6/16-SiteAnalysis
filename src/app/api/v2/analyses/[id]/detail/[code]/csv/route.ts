import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { openV2AppDb } from "@/lib/v2/app-db";
import { allowedDetailControls, getDetailCsv } from "@/lib/v2/engine/detail/registry";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; code: string }> }) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;
  const { id, code } = await params;
  const appDb = openV2AppDb();
  try {
    const reply = getDetailCsv(appDb, v2DataDir(), id, code, auth.id, allowedDetailControls(req.nextUrl.searchParams));
    if (reply.status !== 200) return NextResponse.json({ error: reply.body }, { status: reply.status });
    const fileName = reply.fileName ?? `${code}.csv`;
    return new NextResponse(reply.body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="detail.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } finally {
    appDb.close();
  }
}

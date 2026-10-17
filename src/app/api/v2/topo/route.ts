import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { openV2AppDb } from "@/lib/v2/app-db";
import { MAX_TOPO_UPLOAD_BYTES, putTopoUpload } from "@/lib/v2/topo/upload";
import { v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;

  const rateLimit = checkRateLimit(`topo:${auth.id}`, 20, 15 * 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  // 본문을 다 읽기 전에 선언 크기로 먼저 거절한다(큰 요청이 메모리에 올라오지 않게).
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_TOPO_UPLOAD_BYTES) {
    return NextResponse.json({ error: "topo_too_large" }, { status: 413 });
  }
  const body = Buffer.from(await req.arrayBuffer());
  const appDb = openV2AppDb();
  try {
    const result = await putTopoUpload(appDb, v2DataDir(), body, auth.id);
    return NextResponse.json(result.body, { status: result.status });
  } finally {
    appDb.close();
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isUser } from "@/lib/server/auth";
import { checkRateLimit } from "@/lib/server/rate-limiter";
import { openV2AppDb } from "@/lib/v2/app-db";
import { refreshAnalysis } from "@/lib/v2/engine/api";
import { v2AppDbPath, v2DataDir } from "@/lib/v2/paths";

export const runtime = "nodejs";

/**
 * 기존 API에는 별도 Origin 검사가 없고 access cookie는 SameSite=Strict다.
 * 이 route도 그 관례를 따르되 owner-only, bearer/cookie 인증, 사용자/IP rate limit으로
 * refresh 재계산의 CSRF·남용 표면을 최소화한다.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (!isUser(auth)) return auth;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rateLimit = checkRateLimit(`v2-analysis-refresh:${auth.id}:${ip}`, 30, 15 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  const { id } = await params;
  const appDb = openV2AppDb();
  try {
    const reply = refreshAnalysis(appDb, v2DataDir(), id, auth.id);
    if (reply.status === 202) {
      void import("@/lib/v2/engine/jobs")
        .then(({ startJobRunner }) => startJobRunner({ appDbPath: v2AppDbPath(), dataDir: v2DataDir() }))
        .catch((error) => console.warn(`v2 analysis refresh worker start failed: ${String(error).slice(0, 200)}`));
    }
    return NextResponse.json(reply.body, { status: reply.status });
  } finally {
    appDb.close();
  }
}

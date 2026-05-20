import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { naverLocalSearch, stripHtml, naverCoordsToWgs84 } from "@/lib/naver-api";
import { resolveNaverKeys } from "@/lib/server/naver-key-resolver";
import { verifyToken } from "@/lib/server/jwt";
import { getUserById } from "@/lib/server/user-store";

const querySchema = z.object({
  query: z.string().min(1, "query 파라미터가 필요합니다."),
});

async function extractUserId(req: NextRequest): Promise<number | undefined> {
  let token: string | undefined;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    token = req.cookies.get("site_access_token")?.value;
  }

  if (!token) return undefined;

  try {
    const payload = await verifyToken(token);
    if (payload.kind !== "access") return undefined;
    const user = getUserById(Number(payload.sub));
    return user?.id;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const parsed = querySchema.safeParse({ query: searchParams.get("query") ?? "" });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const userId = await extractUserId(req);

  try {
    const { clientId, clientSecret } = resolveNaverKeys(userId);
    const response = await naverLocalSearch(parsed.data.query, clientId, clientSecret, 1, 1);

    if (response.items.length === 0) {
      return NextResponse.json(
        { error: "주소를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const item = response.items[0];
    const { lat, lng } = naverCoordsToWgs84(item.mapx, item.mapy);

    return NextResponse.json({
      lat,
      lng,
      address: item.roadAddress || item.address || stripHtml(item.title),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `지오코딩 실패: ${message}` },
      { status: 500 }
    );
  }
}

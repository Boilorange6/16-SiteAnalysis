import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { naverLocalSearch, stripHtml, naverCoordsToWgs84 } from "@/lib/naver-api";
import { resolveNaverKeys } from "@/lib/server/naver-key-resolver";
import { verifyToken } from "@/lib/server/jwt";
import { getUserById } from "@/lib/server/user-store";

const querySchema = z.object({
  query: z.string().min(1, "query 파라미터가 필요합니다."),
  page: z.coerce.number().int().min(1).max(20).default(1),
  size: z.coerce.number().int().min(1).max(5).default(5),
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

  const parsed = querySchema.safeParse({
    query: searchParams.get("query") ?? "",
    page: searchParams.get("page") ?? 1,
    size: searchParams.get("size") ?? 5,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { query, page, size } = parsed.data;
  const userId = await extractUserId(req);

  try {
    const { clientId, clientSecret } = resolveNaverKeys(userId);
    const start = (page - 1) * size + 1;
    const response = await naverLocalSearch(query, clientId, clientSecret, size, start);

    const results = response.items.map((item) => {
      const { lat, lng } = naverCoordsToWgs84(item.mapx, item.mapy);
      return {
        id: `${item.mapx}-${item.mapy}`,
        name: stripHtml(item.title),
        address: item.roadAddress || item.address,
        lat,
        lng,
      };
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `주소 검색 실패: ${message}` },
      { status: 500 }
    );
  }
}

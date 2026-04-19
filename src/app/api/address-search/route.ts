import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchKeyword } from "@/lib/kakao-api";

const querySchema = z.object({
  query: z.string().min(1, "query 파라미터가 필요합니다."),
  page: z.coerce.number().int().min(1).max(45).default(1),
  size: z.coerce.number().int().min(1).max(15).default(5),
});

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

  try {
    const response = await searchKeyword(query, page, size);

    const results = response.documents.map((doc) => ({
      id: doc.id,
      name: doc.place_name,
      address: doc.road_address_name || doc.address_name,
      lat: parseFloat(doc.y),
      lng: parseFloat(doc.x),
    }));

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `주소 검색 실패: ${message}` },
      { status: 500 }
    );
  }
}

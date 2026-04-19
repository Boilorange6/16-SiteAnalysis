import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchAddress } from "@/lib/kakao-api";

const querySchema = z.object({
  query: z.string().min(1, "query 파라미터가 필요합니다."),
});

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const parsed = querySchema.safeParse({ query: searchParams.get("query") ?? "" });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  try {
    const response = await searchAddress(parsed.data.query);

    if (response.documents.length === 0) {
      return NextResponse.json(
        { error: "주소를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const doc = response.documents[0];
    const lat = parseFloat(doc.y);
    const lng = parseFloat(doc.x);

    return NextResponse.json({
      lat,
      lng,
      address: doc.address_name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `지오코딩 실패: ${message}` },
      { status: 500 }
    );
  }
}

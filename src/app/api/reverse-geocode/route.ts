import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

/**
 * 역지오코딩 — 좌표를 법정동 주소명("강남구 개포동")으로 변환.
 * 용도: 사용자가 주소 검색 없이 좌표만 수동 수정했을 때 보고서 제목(centerName)이
 * 이전 주소로 남아 실제 분석 위치와 어긋나는 문제 방지(2026-07-14).
 */

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const NCP_REVERSE_GEO_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const parsed = querySchema.safeParse({
    lat: searchParams.get("lat") ?? "",
    lng: searchParams.get("lng") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "lat/lng 파라미터가 필요합니다." }, { status: 400 });
  }

  const ncpId = process.env.NCP_CLIENT_ID;
  const ncpSecret = process.env.NCP_CLIENT_SECRET;
  if (!ncpId || !ncpSecret) {
    return NextResponse.json({ error: "역지오코딩 키가 설정되지 않았습니다." }, { status: 503 });
  }

  const { lat, lng } = parsed.data;
  const url = `${NCP_REVERSE_GEO_URL}?coords=${lng},${lat}&output=json&orders=legalcode`;
  try {
    const res = await fetch(url, {
      headers: { "X-NCP-APIGW-API-KEY-ID": ncpId, "X-NCP-APIGW-API-KEY": ncpSecret },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      results?: Array<{ region?: Record<string, { name?: string }> }>;
    };
    const region = data.results?.[0]?.region;
    const name = [region?.["area2"]?.name, region?.["area3"]?.name].filter(Boolean).join(" ");
    if (!name) {
      return NextResponse.json({ error: "주소를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ name });
  } catch {
    return NextResponse.json({ error: "역지오코딩에 실패했습니다." }, { status: 502 });
  }
}

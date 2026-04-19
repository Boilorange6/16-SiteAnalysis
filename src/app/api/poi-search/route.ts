import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { searchByCategory, searchKeyword } from "@/lib/kakao-api";
import {
  mapToSubwayStation,
  mapToSchool,
  mapToPark,
  mapToMountain,
  mapToApartment,
} from "@/lib/kakao-poi-mapper";
import type { Poi } from "@/lib/types";

// Kakao 카테고리 코드 매핑
const CATEGORY_CODES: Record<string, string> = {
  subway: "SW8",
  school: "SC4",
};

// 키워드 기반 검색이 필요한 카테고리
const KEYWORD_MAP: Record<string, string> = {
  park: "공원",
  mountain: "산",
  apartment: "아파트 분양",
};

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(100).max(20000).default(3000),
  categories: z
    .string()
    .default("subway,school,park,mountain,apartment")
    .transform((val) => val.split(",").map((s) => s.trim())),
});

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const parsed = querySchema.safeParse({
    lat: searchParams.get("lat") ?? "",
    lng: searchParams.get("lng") ?? "",
    radius: searchParams.get("radius") ?? 3000,
    categories: searchParams.get("categories") ?? "subway,school,park,mountain,apartment",
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { lat, lng, radius, categories } = parsed.data;
  const x = String(lng);
  const y = String(lat);

  try {
    const fetches: Promise<Poi[]>[] = [];

    for (const category of categories) {
      if (CATEGORY_CODES[category]) {
        // 카테고리 코드 기반 검색 (subway, school)
        const code = CATEGORY_CODES[category];
        const fetch = (async (): Promise<Poi[]> => {
          const res = await searchByCategory(code, x, y, radius);
          if (category === "subway") {
            return res.documents.map(mapToSubwayStation);
          }
          return res.documents.map(mapToSchool);
        })();
        fetches.push(fetch);
      } else if (KEYWORD_MAP[category]) {
        // 키워드 기반 검색 (park, mountain, apartment)
        const keyword = KEYWORD_MAP[category];
        const fetch = (async (): Promise<Poi[]> => {
          const res = await searchKeyword(keyword, 1, 15, x, y, radius);
          if (category === "park") {
            return res.documents.map(mapToPark);
          }
          if (category === "mountain") {
            return res.documents.map(mapToMountain);
          }
          return res.documents.map(mapToApartment);
        })();
        fetches.push(fetch);
      }
    }

    const results = await Promise.allSettled(fetches);

    const pois: Poi[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        pois.push(...result.value);
      }
      // 개별 카테고리 실패는 무시하고 나머지 결과 반환
    }

    return NextResponse.json({ pois });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json(
      { error: `POI 검색 실패: ${message}` },
      { status: 500 }
    );
  }
}

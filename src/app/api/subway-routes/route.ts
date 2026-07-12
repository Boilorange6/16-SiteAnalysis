import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { overpassSubwayRoutes } from "@/lib/overpass-subway-routes";
import { requireAuth, isUser } from "@/lib/server/auth";
import { resolveSource } from "@/lib/server/poi-cache";
import type { SubwayRoute, SourceStatus } from "@/lib/types";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(100).max(50000).default(5400),
  // 1단계 데이터 신뢰성: "true"면 모듈 캐시·영구 캐시를 모두 무시하고 강제 재수집
  refresh: z.string().optional().transform((v) => v === "true"),
});

interface CacheEntry {
  routes: SubwayRoute[];
  /** Map 캐시 TTL 판정 전용(저장 시각) — 수집 시각과 구분한다 */
  ts: number;
  /** 실제 수집 시각(epoch ms) — 영구 캐시 저장본이면 원래 수집 시각을 보존 */
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 200;           // M-4: bounded cache

export async function GET(req: NextRequest) {
  // M-3: Require authentication
  const authResult = await requireAuth(req);
  if (!isUser(authResult)) return authResult;

  const { searchParams } = req.nextUrl;

  const parsed = querySchema.safeParse({
    lat: searchParams.get("lat") ?? "",
    lng: searchParams.get("lng") ?? "",
    radius: searchParams.get("radius") ?? 5400,
    refresh: searchParams.get("refresh") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { lat, lng, radius, refresh } = parsed.data;
  const cacheKey = `${lat.toFixed(4)}-${lng.toFixed(4)}-${radius}`;

  // 1차: 모듈 내 인메모리 캐시(TTL 10분) — refresh=true면 건너뛴다
  const cached = cache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    const source: SourceStatus = { source: "subway-routes", status: "cached", fetchedAt: cached.fetchedAt };
    return NextResponse.json({ routes: cached.routes, source });
  }

  // 2차: SQLite 영구 캐시 — 실패해도 저장본으로 폴백, 없으면 200 + failed
  const r = await resolveSource<SubwayRoute[]>({
    source: "subway-routes", lat, lng, radiusM: radius, refresh,
    fetcher: () => overpassSubwayRoutes(lat, lng, radius),
  });
  const source: SourceStatus = { source: "subway-routes", status: r.status, fetchedAt: r.fetchedAt };

  if (r.value === null) {
    return NextResponse.json({ routes: [], source }); // 실패해도 200 — 클라이언트 폴백 로직 유지
  }

  // M-4: Evict oldest entry when cache is full
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  // ts는 TTL 판정용(지금), fetchedAt은 실제 수집 시각 보존 — 영구 캐시 저장본을 방금 수집한 것처럼 표기하지 않는다
  cache.set(cacheKey, { routes: r.value, ts: Date.now(), fetchedAt: r.fetchedAt ?? Date.now() });

  return NextResponse.json({ routes: r.value, source });
}

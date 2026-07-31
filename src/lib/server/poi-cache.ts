// src/lib/server/poi-cache.ts
// 외부 소스 수집 결과의 SQLite 영구 캐시. 정책: cache-first(신선 캐시가 있으면
// 외부를 호출하지 않는다) — "같은 곳은 언제나 같은 결과" 보장이 목적.
import { getDb } from "@/lib/server/database";

export const POI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedSource<T> {
  readonly value: T;
  readonly fetchedAt: number;
  readonly expired: boolean;
}

export interface PoiSourceCacheKey {
  readonly source: string;
  readonly lat: number;
  readonly lng: number;
  readonly radiusM: number;
}

interface PoiSourceCacheRow {
  readonly value_json: string;
  readonly fetched_at: number;
}

/**
 * 캐시 격자 해상도를 반경에 맞춘다.
 * 고정 4자리(약 11m)는 반경 100m 조회에서 11% 오차 — 경계 POI가 다른 위치의
 * 결과로 재사용된다. 격자를 반경의 1% 이하로 두되, 넓은 반경에서는 적중률을
 * 지키기 위해 최대 11m(4자리)까지만 촘촘하게 한다.
 */
function keyDecimals(radiusM: number): number {
  const cellM = Math.max(radiusM * 0.01, 0.5);
  if (cellM >= 11) return 4; // 약 11m
  if (cellM >= 1.1) return 5; // 약 1.1m
  return 6; // 약 0.11m
}

function keyParts(lat: number, lng: number, radiusM: number) {
  const decimals = keyDecimals(radiusM);
  return { lat: lat.toFixed(decimals), lng: lng.toFixed(decimals) };
}

export function getCachedSource<T>(
  key: PoiSourceCacheKey,
  options: { readonly includeExpired?: boolean } = {},
): CachedSource<T> | null {
  const { source, lat, lng, radiusM } = key;
  const { lat: la, lng: ln } = keyParts(lat, lng, radiusM);
  const row = getDb()
    .prepare<[string, string, string, number], PoiSourceCacheRow>(
      `SELECT value_json, fetched_at FROM poi_source_cache
       WHERE source = ? AND lat = ? AND lng = ? AND radius_m = ?`,
    )
    .get(source, la, ln, Math.round(radiusM));
  if (!row) return null;
  const expired = Date.now() - row.fetched_at > POI_CACHE_TTL_MS;
  if (expired && !options.includeExpired) return null;
  try {
    const value: T = JSON.parse(row.value_json);
    return { value, fetchedAt: row.fetched_at, expired };
  } catch {
    return null;
  }
}

export function setCachedSource(options: {
  readonly key: PoiSourceCacheKey;
  readonly value: unknown;
}): number {
  const { source, lat, lng, radiusM } = options.key;
  const { lat: la, lng: ln } = keyParts(lat, lng, radiusM);
  const fetchedAt = Date.now();
  getDb()
    .prepare(`INSERT INTO poi_source_cache (source, lat, lng, radius_m, value_json, fetched_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(source, lat, lng, radius_m) DO UPDATE SET
                value_json = excluded.value_json, fetched_at = excluded.fetched_at`)
    .run(source, la, ln, Math.round(radiusM), JSON.stringify(options.value), fetchedAt);
  return fetchedAt;
}

export interface ResolvedSource<T> {
  readonly value: T | null;
  readonly status: "fresh" | "cached" | "failed";
  /** TTL이 지난 저장본을 원천 장애로 대신 쓰는 중 */
  readonly stale?: boolean;
  readonly fetchedAt: number | null;
}

export async function resolveSource<T>(args: {
  source: string; lat: number; lng: number; radiusM: number;
  refresh: boolean; fetcher: () => Promise<T>;
}): Promise<ResolvedSource<T>> {
  const { source, lat, lng, radiusM, refresh, fetcher } = args;
  const key = { source, lat, lng, radiusM };
  const cached = getCachedSource<T>(key, { includeExpired: true });
  if (cached && !cached.expired && !refresh) {
    return { value: cached.value, status: "cached", fetchedAt: cached.fetchedAt };
  }
  try {
    const live = await fetcher();
    const fetchedAt = setCachedSource({ key, value: live });
    return { value: live, status: "fresh", fetchedAt };
  } catch {
    console.warn(`[poi-cache] ${source} fetch failed`);
    // 만료 저장본으로 대체하는 경우 stale을 세워 화면·보고서가 최신처럼 보이지 않게 한다
    if (cached) {
      return { value: cached.value, status: "cached", fetchedAt: cached.fetchedAt, stale: cached.expired };
    }
    return { value: null, status: "failed", fetchedAt: null };
  }
}

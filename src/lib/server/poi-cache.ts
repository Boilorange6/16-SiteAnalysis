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

function keyParts(lat: number, lng: number) {
  return { lat: lat.toFixed(4), lng: lng.toFixed(4) };
}

export function getCachedSource<T>(
  key: PoiSourceCacheKey,
  options: { readonly includeExpired?: boolean } = {},
): CachedSource<T> | null {
  const { source, lat, lng, radiusM } = key;
  const { lat: la, lng: ln } = keyParts(lat, lng);
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
  const { lat: la, lng: ln } = keyParts(lat, lng);
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
    if (cached) return { value: cached.value, status: "cached", fetchedAt: cached.fetchedAt };
    return { value: null, status: "failed", fetchedAt: null };
  }
}

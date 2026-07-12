// src/lib/server/poi-cache.ts
// 외부 소스 수집 결과의 SQLite 영구 캐시. 정책: cache-first(신선 캐시가 있으면
// 외부를 호출하지 않는다) — "같은 곳은 언제나 같은 결과" 보장이 목적.
import { getDb } from "@/lib/server/database";

export const POI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function keyParts(lat: number, lng: number) {
  return { lat: lat.toFixed(4), lng: lng.toFixed(4) };
}

export function getCachedSource<T>(
  source: string, lat: number, lng: number, radiusM: number
): { value: T; fetchedAt: number } | null {
  const { lat: la, lng: ln } = keyParts(lat, lng);
  const row = getDb()
    .prepare(`SELECT value_json, fetched_at FROM poi_source_cache
              WHERE source = ? AND lat = ? AND lng = ? AND radius_m = ?`)
    .get(source, la, ln, Math.round(radiusM)) as { value_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.fetched_at > POI_CACHE_TTL_MS) return null;
  return { value: JSON.parse(row.value_json) as T, fetchedAt: row.fetched_at };
}

export function setCachedSource(
  source: string, lat: number, lng: number, radiusM: number, value: unknown
): void {
  const { lat: la, lng: ln } = keyParts(lat, lng);
  getDb()
    .prepare(`INSERT INTO poi_source_cache (source, lat, lng, radius_m, value_json, fetched_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(source, lat, lng, radius_m) DO UPDATE SET
                value_json = excluded.value_json, fetched_at = excluded.fetched_at`)
    .run(source, la, ln, Math.round(radiusM), JSON.stringify(value), Date.now());
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
  const cached = getCachedSource<T>(source, lat, lng, radiusM);
  if (cached && !refresh) {
    return { value: cached.value, status: "cached", fetchedAt: cached.fetchedAt };
  }
  try {
    const live = await fetcher();
    setCachedSource(source, lat, lng, radiusM, live);
    return { value: live, status: "fresh", fetchedAt: Date.now() };
  } catch (err) {
    console.warn(`[poi-cache] ${source} fetch failed:`, err);
    if (cached) return { value: cached.value, status: "cached", fetchedAt: cached.fetchedAt };
    return { value: null, status: "failed", fetchedAt: null };
  }
}

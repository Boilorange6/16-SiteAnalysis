// src/lib/server/overpass-fetch.ts
// Overpass API 공유 fetch. 문제: poi/park/subway-routes 세 모듈이 각자 Overpass를
// 연달아 때려 슬롯 고갈(429)로 한 소스가 통째로 죽는다. 해결: 쿼리 단위 TTL 캐시 +
// 지수 백오프 재시도를 한 곳에서 제공한다.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 100;
const DEFAULT_TIMEOUT_MS = 45_000;
const BACKOFF_MS = [1_000, 3_000];

interface CacheEntry {
  readonly value: unknown;
  readonly ts: number;
}

const cache = new Map<string, CacheEntry>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function __clearCacheForTest(): void {
  cache.clear();
}

export interface OverpassFetchOptions {
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly cacheTtlMs?: number;
  readonly maxRetries?: number;
}

export async function overpassFetch(query: string, opts: OverpassFetchOptions = {}): Promise<unknown> {
  const ttl = opts.cacheTtlMs ?? DEFAULT_TTL_MS;
  const maxRetries = opts.maxRetries ?? 2;
  const doFetch = opts.fetchImpl ?? fetch;

  const cached = cache.get(query);
  if (cached && Date.now() - cached.ts < ttl) {
    return cached.value;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
    }
    try {
      const res = await doFetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "*/*",
          "User-Agent": "SiteAnalysisApp/1.0",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (!res.ok) {
        const text = await res.text();
        lastError = new Error(`Overpass API error [${res.status}]: ${text.slice(0, 200)}`);
        continue; // 429/5xx → 재시도
      }
      const value = await res.json();
      if (cache.size >= MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(query, { value, ts: Date.now() });
      return value;
    } catch (err) {
      lastError = err; // 네트워크 오류/타임아웃 → 재시도
    }
  }
  throw lastError;
}

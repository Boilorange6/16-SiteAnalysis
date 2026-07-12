// src/lib/server/overpass-fetch.ts
// Overpass API 공유 fetch. 문제: poi/park/subway-routes 세 모듈이 각자 Overpass를
// 연달아 때려 슬롯 고갈(429)로 한 소스가 통째로 죽는다. 해결: 쿼리 단위 TTL 캐시 +
// 지수 백오프 재시도를 한 곳에서 제공한다.
// 미러 폴백: 시도 n회차마다 OVERPASS_URLS[n % length]로 순환. 1차 미러는 env로 교체 가능.
const OVERPASS_URLS = [
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 100;
const DEFAULT_TIMEOUT_MS = 45_000;
const BACKOFF_MS = [1_000, 3_000];
const DEFAULT_MIN_INTERVAL_MS = 1_000;

// 전역 스로틀 상태 (모듈 스코프) — 여러 모듈이 공유 fetch를 동시에 호출해도
// 최소 간격을 두고 순차 실행되도록 체이닝한다.
let lastRequestAt = 0;
let throttleChain: Promise<void> = Promise.resolve();

function throttle(minIntervalMs: number): Promise<void> {
  const run = throttleChain.then(async () => {
    const wait = lastRequestAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  throttleChain = run.catch(() => {});
  return run;
}

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
  readonly minIntervalMs?: number;
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
      await throttle(opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
      const res = await doFetch(OVERPASS_URLS[attempt % OVERPASS_URLS.length], {
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
      // Overpass는 서버 과부하 시 HTTP 200 + remark(부분/빈 elements)를 반환한다.
      // 부분 응답을 10분 캐시에 고정하면 안 되므로 재시도 대상으로 처리한다.
      const remark = (value as { remark?: unknown } | null)?.remark;
      if (remark) {
        lastError = new Error(`Overpass partial response: ${String(remark).slice(0, 200)}`);
        continue; // 200+remark → 캐시하지 않고 재시도
      }
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

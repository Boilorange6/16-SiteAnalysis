# 1단계: 데이터 신뢰성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 장소를 언제 분석해도 같은 결과가 나오고, 데이터가 빠지면 화면·보고서 양쪽에 정확히 표시된다.

**Architecture:** 외부 수집 결과를 SQLite에 소스 단위로 7일 영구 캐시(cache-first)하고, poi-search/subway-routes 응답에 소스별 상태 메타(`sources`)를 추가한다. 클라이언트는 이 메타를 사이드바 배지·PPT 출처 슬라이드에 표시하고, 실패 소스 단독 재시도와 강제 새로고침을 지원한다. Overpass 호출은 최소 간격 스로틀+미러 폴백으로 보호한다.

**Tech Stack:** Next.js 15 API Routes, better-sqlite3(기존 `.cache/site-analysis.db`), 기존 테스트 관례(`npx tsx src/scripts/*.mjs`, fetchImpl 주입).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-12-improvement-roadmap-design.md` 1단계 섹션
- 캐시 보관 기간 7일(`POI_CACHE_TTL_MS = 7*24*60*60*1000`), 좌표 반올림 소수 4자리, 캐시 정책은 **cache-first**(신선 캐시 있으면 외부 호출 안 함)
- 소스 ID 6종 고정: `"osm" | "park" | "maintenance" | "residential" | "planned-residential" | "subway-routes"`
- 기존 API 응답 필드(`pois`, `warnings`, `routes`)는 제거·개명 금지 (하위호환)
- PPT 파이프라인의 시각 요소(지도·차트)는 이번 단계에서 건드리지 않음 — 출처 슬라이드 텍스트 추가만
- 모든 커밋 메시지 한국어, 말미에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 검증 명령: `npm run lint`(tsc --noEmit) 및 각 태스크의 `npx tsx` 테스트

---

### Task 1: 영구 캐시 모듈 (poi-cache)

**Files:**
- Modify: `src/lib/server/database.ts` (initSchema에 테이블 1개 추가, 28-89행 블록 내)
- Create: `src/lib/server/poi-cache.ts`
- Test: `src/scripts/test-poi-cache.mjs`

**Interfaces:**
- Consumes: `getDb()` from `@/lib/server/database`
- Produces (후속 태스크가 사용):
  - `getCachedSource<T>(source: string, lat: number, lng: number, radiusM: number): { value: T; fetchedAt: number } | null`
  - `setCachedSource(source: string, lat: number, lng: number, radiusM: number, value: unknown): void`
  - `resolveSource<T>(args: { source: string; lat: number; lng: number; radiusM: number; refresh: boolean; fetcher: () => Promise<T> }): Promise<{ value: T; status: "fresh" | "cached" | "failed"; fetchedAt: number | null }>`
  - `POI_CACHE_TTL_MS: number`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/scripts/test-poi-cache.mjs`

```js
// 순수 로직 테스트 — 임시 DB 사용 (DB_PATH 환경변수로 격리)
// 실행: npx tsx src/scripts/test-poi-cache.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "poi-cache-test-"));
process.env.DB_PATH = join(dir, "test.db");

const { getCachedSource, setCachedSource, resolveSource, POI_CACHE_TTL_MS } =
  await import("../lib/server/poi-cache.ts");

// 1) miss → null
assert.equal(getCachedSource("osm", 37.5665, 126.978, 3000), null);

// 2) set 후 hit — 좌표 4자리 반올림 동일 키
setCachedSource("osm", 37.5665, 126.978, 3000, [{ id: "p1" }]);
const hit = getCachedSource("osm", 37.56652, 126.97801, 3000); // 4자리 반올림 시 동일
assert.ok(hit && Array.isArray(hit.value) && hit.value[0].id === "p1");
assert.ok(typeof hit.fetchedAt === "number");

// 3) 다른 반경 → miss
assert.equal(getCachedSource("osm", 37.5665, 126.978, 2000), null);

// 4) resolveSource: 신선 캐시 있으면 fetcher를 부르지 않는다 (cache-first)
let calls = 0;
const r1 = await resolveSource({
  source: "osm", lat: 37.5665, lng: 126.978, radiusM: 3000, refresh: false,
  fetcher: async () => { calls += 1; return [{ id: "live" }]; },
});
assert.equal(r1.status, "cached");
assert.equal(calls, 0);

// 5) refresh=true → fetcher 호출 + 캐시 갱신 + status fresh
const r2 = await resolveSource({
  source: "osm", lat: 37.5665, lng: 126.978, radiusM: 3000, refresh: true,
  fetcher: async () => { calls += 1; return [{ id: "live" }]; },
});
assert.equal(r2.status, "fresh");
assert.equal(calls, 1);
assert.equal(getCachedSource("osm", 37.5665, 126.978, 3000).value[0].id, "live");

// 6) 캐시 없음 + fetcher 실패 → status failed, value는 빈 배열 아님 — null 반환값 규약 확인
const r3 = await resolveSource({
  source: "park", lat: 35.0, lng: 129.0, radiusM: 3000, refresh: false,
  fetcher: async () => { throw new Error("down"); },
});
assert.equal(r3.status, "failed");
assert.equal(r3.value, null);
assert.equal(r3.fetchedAt, null);

// 7) 캐시 있음 + fetcher 실패(refresh=true) → 캐시로 폴백, status cached
const r4 = await resolveSource({
  source: "osm", lat: 37.5665, lng: 126.978, radiusM: 3000, refresh: true,
  fetcher: async () => { throw new Error("down"); },
});
assert.equal(r4.status, "cached");
assert.equal(r4.value[0].id, "live");

assert.ok(POI_CACHE_TTL_MS === 7 * 24 * 60 * 60 * 1000);
console.log("poi-cache: all tests passed");
rmSync(dir, { recursive: true, force: true });
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx src/scripts/test-poi-cache.mjs`
Expected: FAIL — `Cannot find module '../lib/server/poi-cache.ts'`

- [ ] **Step 3: 스키마 추가** — `src/lib/server/database.ts`의 `initSchema` 내 `db.exec()` 블록(기존 CREATE TABLE들 뒤)에 추가:

```sql
CREATE TABLE IF NOT EXISTS poi_source_cache (
  source TEXT NOT NULL,
  lat TEXT NOT NULL,
  lng TEXT NOT NULL,
  radius_m INTEGER NOT NULL,
  value_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (source, lat, lng, radius_m)
);
```

- [ ] **Step 4: 모듈 구현** — `src/lib/server/poi-cache.ts`

```ts
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
  } catch {
    if (cached) return { value: cached.value, status: "cached", fetchedAt: cached.fetchedAt };
    return { value: null, status: "failed", fetchedAt: null };
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx tsx src/scripts/test-poi-cache.mjs`
Expected: `poi-cache: all tests passed`

- [ ] **Step 6: 타입 체크 후 커밋**

Run: `npm run lint` → 오류 0
```bash
git add src/lib/server/database.ts src/lib/server/poi-cache.ts src/scripts/test-poi-cache.mjs
git commit -m "feat: POI 소스 영구 캐시 모듈 — SQLite cache-first, 7일 TTL"
```

---

### Task 2: Overpass 스로틀 + 미러 폴백 + URL 환경변수화

**Files:**
- Modify: `src/lib/server/overpass-fetch.ts`
- Test: `src/scripts/test-overpass-fetch.mjs` (기존 파일에 케이스 추가)

**Interfaces:**
- Produces: `overpassFetch(query, opts)` 동작 변경 — 시도 n회차마다 URL이 `OVERPASS_URLS[n % length]`로 순환. `OverpassFetchOptions`에 `minIntervalMs?: number` 추가. 시그니처 자체는 불변.

- [ ] **Step 1: 실패하는 테스트 추가** — `src/scripts/test-overpass-fetch.mjs` 말미에 추가 (기존 makeFetch는 URL을 무시하므로, URL 기록형 fetch를 새로 만든다):

```js
// --- 미러 폴백: 1차 실패 시 2번째 시도는 lz4 미러로 ---
{
  __clearCacheForTest();
  const urls = [];
  const impl = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) return { ok: false, status: 429, json: async () => ({}), text: async () => "busy" };
    return { ok: true, status: 200, json: async () => ({ elements: [1] }), text: async () => "" };
  };
  const out = await overpassFetch("q-mirror", { fetchImpl: impl, minIntervalMs: 0 });
  assert.deepEqual(out, { elements: [1] });
  assert.ok(urls[0].includes("overpass-api.de") && !urls[0].includes("lz4"));
  assert.ok(urls[1].includes("lz4.overpass-api.de"));
}
// --- 최소 간격: 연속 2회 호출 사이에 minIntervalMs 이상 경과 ---
{
  __clearCacheForTest();
  const stamps = [];
  const impl = async () => {
    stamps.push(Date.now());
    return { ok: true, status: 200, json: async () => ({ elements: [] }), text: async () => "" };
  };
  await overpassFetch("q-throttle-1", { fetchImpl: impl, minIntervalMs: 120 });
  await overpassFetch("q-throttle-2", { fetchImpl: impl, minIntervalMs: 120 });
  assert.ok(stamps[1] - stamps[0] >= 100, `interval was ${stamps[1] - stamps[0]}ms`);
}
console.log("overpass-fetch: mirror/throttle tests passed");
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx src/scripts/test-overpass-fetch.mjs`
Expected: FAIL — 두 번째 시도 URL이 lz4가 아님 (기존 코드는 단일 URL)

- [ ] **Step 3: 구현** — `overpass-fetch.ts` 수정:

```ts
// 상수 교체 (기존 5행 OVERPASS_URL 삭제)
const OVERPASS_URLS = [
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];
const DEFAULT_MIN_INTERVAL_MS = 1_000;

// 전역 스로틀 상태 (모듈 스코프)
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
```

`OverpassFetchOptions`에 `readonly minIntervalMs?: number;` 추가. `overpassFetch` 루프 내에서:
- `doFetch(OVERPASS_URL, ...)` → `doFetch(OVERPASS_URLS[attempt % OVERPASS_URLS.length], ...)`
- fetch 직전에 `await throttle(opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);` 추가 (backoff sleep과 별개)

- [ ] **Step 4: 전체 테스트 통과 확인**

Run: `npx tsx src/scripts/test-overpass-fetch.mjs`
Expected: 기존 케이스 + `overpass-fetch: mirror/throttle tests passed`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/server/overpass-fetch.ts src/scripts/test-overpass-fetch.mjs
git commit -m "feat: Overpass 최소간격 스로틀 + lz4 미러 폴백 + OVERPASS_URL env 지원"
```

---

### Task 3: 소스 상태 타입 + poi-search 라우트 캐시 통합

**Files:**
- Modify: `src/lib/types.ts` (말미에 타입 추가)
- Modify: `src/app/api/poi-search/route.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `PoiSourceId`, `SourceStatus`, `POI_SOURCE_CATEGORIES: Record<PoiSourceId, readonly PoiCategory[]>`, `POI_SOURCE_LABELS: Record<PoiSourceId, string>`
  - poi-search 응답: `{ pois: Poi[]; warnings: string[]; sources: SourceStatus[] }` (기존 필드 유지)
  - 쿼리 파라미터 `refresh`("true"면 캐시 무시) 추가

- [ ] **Step 1: 타입 추가** — `src/lib/types.ts` 말미:

```ts
/** 외부 데이터 소스 식별자 (1단계 데이터 신뢰성) */
export type PoiSourceId =
  | "osm" | "park" | "maintenance" | "residential" | "planned-residential" | "subway-routes";

export interface SourceStatus {
  readonly source: PoiSourceId;
  /** "fresh"=방금 수집, "cached"=저장본 사용, "failed"=수집 실패·저장본도 없음 */
  readonly status: "fresh" | "cached" | "failed";
  /** 수집 시각(epoch ms). failed면 null */
  readonly fetchedAt: number | null;
}

export const POI_SOURCE_CATEGORIES: Record<PoiSourceId, readonly PoiCategory[]> = {
  osm: ["subway", "school", "mountain"],
  park: ["park"],
  maintenance: ["maintenance"],
  residential: ["apartment", "officetel", "residential"],
  "planned-residential": ["apartment", "officetel", "residential"],
  "subway-routes": ["subway"],
};

export const POI_SOURCE_LABELS: Record<PoiSourceId, string> = {
  osm: "지하철역·학교·산",
  park: "공원",
  maintenance: "정비사업",
  residential: "주거 단지",
  "planned-residential": "분양 예정",
  "subway-routes": "지하철 노선",
};
```

- [ ] **Step 2: 라우트 수정** — `src/app/api/poi-search/route.ts`

1. `querySchema`에 `refresh: z.string().optional().transform(v => v === "true")` 추가.
2. 소스 4곳(park/maintenance/osm/residential+planned)의 기존 `try/catch+warnings` 패턴을 `resolveSource` 래핑으로 교체. 형태 (park 예 — 나머지 3곳 동일 패턴):

```ts
import { resolveSource } from "@/lib/server/poi-cache";
import type { SourceStatus } from "@/lib/types";

const sources: SourceStatus[] = [];

// park (기존 route.ts:184-189 대체)
if (wantsPark) {
  const r = await resolveSource<Park[]>({
    source: "park", lat, lng, radiusM: radius, refresh,
    fetcher: () => searchParks(lat, lng, radius),
  });
  sources.push({ source: "park", status: r.status, fetchedAt: r.fetchedAt });
  if (r.value) pois.push(...r.value);
  else warnings.push("park"); // 기존 하위호환 유지
}
```

  - `osm` 소스: fetcher는 기존 `overpassPoiSearch(lat,lng,radius)` 호출부를 감싼다. **주의: 캐시에는 분류·중복제거 완료된 Poi[]를 저장**한다 (원시 elements가 아니라 `elementToPoi` 변환 후 결과). 기존 `seenIds/seenNames` 로직은 fetcher 내부로 이동.
  - `residential`과 `planned-residential`은 **각각 별도 소스로** resolveSource 호출 후 기존 `mergeResidentialPois`로 병합. planned는 `planned=true`일 때만 sources에 포함.
3. 응답: `return NextResponse.json({ pois, warnings, sources });`

- [ ] **Step 3: 타입 체크**

Run: `npm run lint`
Expected: 오류 0

- [ ] **Step 4: 수동 스모크 (dev 서버)**

```bash
# dev 서버 실행 중 상태에서 (로그인 세션 쿠키 필요 — 브라우저에서 확인해도 됨)
# 같은 좌표 2회 호출: 1회차 sources[].status="fresh", 2회차 "cached"이고 pois 개수 동일해야 함
```
브라우저 Network 탭에서 `/site/api/poi-search?...` 응답의 `sources` 필드 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/types.ts src/app/api/poi-search/route.ts
git commit -m "feat: poi-search 소스별 영구 캐시 통합 + sources 상태 메타 응답"
```

---

### Task 4: subway-routes 라우트 캐시 통합

**Files:**
- Modify: `src/app/api/subway-routes/route.ts`

**Interfaces:**
- Produces: 응답 `{ routes: SubwayRoute[]; source: SourceStatus }` (routes 필드 유지). 쿼리 `refresh` 지원.

- [ ] **Step 1: 라우트 수정**

Zod 스키마(7-11행)에 `refresh: z.string().optional().transform(v => v === "true")` 추가. 기존 모듈 내 Map 캐시(18-20행, TTL 10분)는 1차 캐시로 유지하되 `refresh=true`면 건너뛴다. 그 아래에 `resolveSource` 적용:

```ts
const r = await resolveSource<SubwayRoute[]>({
  source: "subway-routes", lat, lng, radiusM: radius, refresh,
  fetcher: () => overpassSubwayRoutes(lat, lng, radius),
});
const source: SourceStatus = { source: "subway-routes", status: r.status, fetchedAt: r.fetchedAt };
if (r.value === null) {
  return NextResponse.json({ routes: [], source }); // 실패해도 200 — 클라이언트 폴백 로직 유지
}
return NextResponse.json({ routes: r.value, source });
```

주의: 기존 "실패 시 500" 동작을 "200 + status failed"로 바꾼다. 클라이언트(data-provider:99-104)의 `.catch(()=>({routes:[]}))`는 Task 5에서 source를 읽도록 수정되므로 하위호환 문제 없음.

- [ ] **Step 2: 타입 체크 후 커밋**

Run: `npm run lint` → 오류 0
```bash
git add src/app/api/subway-routes/route.ts
git commit -m "feat: subway-routes 영구 캐시 통합 + source 상태 응답 (실패 시 200+failed)"
```

---

### Task 5: 클라이언트 데이터 흐름 — sourceStatuses 전파 + 재시도/새로 수집

**Files:**
- Modify: `src/lib/data-provider.ts`
- Modify: `src/components/site-analysis-app.tsx`

**Interfaces:**
- Consumes: Task 3·4의 응답 형태
- Produces:
  - `RegionData`에 `readonly sourceStatuses: readonly SourceStatus[]` 추가
  - `loadDynamicRegion(lat, lng, radiusKm, opts?: { forceRefresh?: boolean }): Promise<RegionData>` — forceRefresh 시 클라이언트 메모리 캐시 무시 + API에 `refresh=true`
  - `reloadSource(lat, lng, radiusKm, source: PoiSourceId): Promise<{ pois: Poi[]; status: SourceStatus }>` — 해당 소스 카테고리만 `refresh=true`로 재수집
  - site-analysis-app: state `sourceStatuses`, 콜백 `handleRetrySource(source)`, `handleForceRefresh()` (Task 6의 사이드바가 props로 받음)

- [ ] **Step 1: data-provider 수정**

```ts
// RegionData 인터페이스에 추가
readonly sourceStatuses: readonly SourceStatus[];

// loadDynamicRegion 시그니처 확장 (기존 78행)
export async function loadDynamicRegion(
  lat: number, lng: number, radiusKm: number,
  opts: { forceRefresh?: boolean } = {}
): Promise<RegionData> {
  const cacheKey = `${lat},${lng},${radiusKm}`;
  if (!opts.forceRefresh && regionCache.has(cacheKey)) return regionCache.get(cacheKey)!;
  const refreshQs = opts.forceRefresh ? "&refresh=true" : "";
  // poi-search 호출 URL에 refreshQs 추가, subway-routes도 동일
  // poi 응답: { pois, warnings, sources } / routes 응답: { routes, source }
  // sourceStatuses = [...poiRes.sources, routesRes.source]
  // routes fetch가 통째로 실패(.catch)하면 수동으로
  //   { source: "subway-routes", status: "failed", fetchedAt: null } 을 push
}

// 신규 함수
export async function reloadSource(
  lat: number, lng: number, radiusKm: number, source: PoiSourceId
): Promise<{ pois: Poi[]; status: SourceStatus }> {
  const radiusM = Math.round(radiusKm * 1000);
  if (source === "subway-routes") {
    const res = await fetchJson<{ routes: SubwayRoute[]; source: SourceStatus }>(
      resolvePath(`/api/subway-routes?lat=${lat}&lng=${lng}&radius=${Math.round(radiusM * 1.8)}&refresh=true`));
    return { pois: [], status: res.source }; // routes는 호출측에서 RegionData.subwayRoutes 교체
  }
  const cats = POI_SOURCE_CATEGORIES[source].join(",");
  const res = await fetchJson<{ pois: Poi[]; sources: SourceStatus[] }>(
    resolvePath(`/api/poi-search?lat=${lat}&lng=${lng}&radius=${radiusM}&categories=${cats}&refresh=true`));
  const status = res.sources.find(s => s.source === source)
    ?? { source, status: "failed" as const, fetchedAt: null };
  return { pois: res.pois, status };
}
```
주의: `reloadSource("subway-routes")`의 routes는 위 코드에서 버려지므로, 반환 타입에 `routes?: SubwayRoute[]`를 추가해 함께 반환한다 (site-analysis-app에서 교체용).

- [ ] **Step 2: site-analysis-app 수정**

1. 기존 분석 useEffect(75-94행)는 그대로 — `regionData.sourceStatuses`가 자동 포함됨.
2. 콜백 추가:

```tsx
const handleForceRefresh = useCallback(() => {
  // reloadNonce 증가로 useEffect 재실행하되 forceRefresh 플래그를 ref로 전달
  forceRefreshRef.current = true;
  setReloadNonce(n => n + 1);
}, []);

const handleRetrySource = useCallback(async (source: PoiSourceId) => {
  if (!regionData) return;
  setRetryingSource(source);
  try {
    const r = await reloadSource(config.centerLat, config.centerLng, config.radiusKm, source);
    setRegionData(prev => {
      if (!prev) return prev;
      const cats = new Set(POI_SOURCE_CATEGORIES[source]);
      const keep = source === "subway-routes" ? prev.pois : prev.pois.filter(p => !cats.has(p.category));
      return {
        ...prev,
        pois: source === "subway-routes" ? prev.pois : [...keep, ...r.pois],
        subwayRoutes: source === "subway-routes" && r.routes ? r.routes : prev.subwayRoutes,
        sourceStatuses: prev.sourceStatuses.map(s => s.source === source ? r.status : s),
      };
    });
  } finally {
    setRetryingSource(null);
  }
}, [regionData, config]);
```
state 추가: `const [retryingSource, setRetryingSource] = useState<PoiSourceId | null>(null);`, `const forceRefreshRef = useRef(false);` (useEffect에서 읽고 리셋).
3. 주의: `handleRetrySource`에서 residential 계열은 `residential`과 `planned-residential`이 같은 카테고리를 공유하므로, **두 소스 중 하나만 재시도해도 poi-search가 두 소스를 모두 다시 수집**한다(카테고리 파라미터가 같기 때문). 이는 허용 — sources 배열에서 두 소스 상태를 모두 갱신한다 (`res.sources` 전체로 갱신하는 코드로 처리).
4. Sidebar에 props 전달: `sourceStatuses={regionData?.sourceStatuses ?? []}`, `onRetrySource={handleRetrySource}`, `onForceRefresh={handleForceRefresh}`, `retryingSource={retryingSource}`.

- [ ] **Step 3: 타입 체크**

Run: `npm run lint` → 오류 0

- [ ] **Step 4: 커밋**

```bash
git add src/lib/data-provider.ts src/components/site-analysis-app.tsx
git commit -m "feat: 소스 상태 클라이언트 전파 + 소스 단독 재시도/전체 새로 수집"
```

---

### Task 6: 사이드바 "데이터 수집 상태" 카드

**Files:**
- Modify: `src/components/sidebar.tsx` (425행 "작업 상태" 패널 위에 신규 카드), props 인터페이스 확장

**Interfaces:**
- Consumes: Task 5의 props (`sourceStatuses`, `onRetrySource`, `onForceRefresh`, `retryingSource`)

- [ ] **Step 1: props 추가** — sidebar props 인터페이스(28행 부근):

```ts
readonly sourceStatuses: readonly SourceStatus[];
readonly retryingSource: PoiSourceId | null;
readonly onRetrySource: (source: PoiSourceId) => void;
readonly onForceRefresh: () => void;
```

- [ ] **Step 2: 카드 UI** — "작업 상태" SectionHeader(425행) 바로 아래, 분석 결과가 있을 때만 렌더:

```tsx
{sourceStatuses.length > 0 && (
  <div className="rounded-xl border border-white/12 bg-white/5 p-3 text-xs">
    <div className="mb-2 flex items-center justify-between">
      <span className="font-semibold text-white/80">데이터 수집 상태</span>
      <button type="button" onClick={onForceRefresh}
        className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10">
        전체 새로 수집
      </button>
    </div>
    <ul className="space-y-1.5">
      {sourceStatuses.map((s) => (
        <li key={s.source} className="flex items-center justify-between gap-2">
          <span className="text-white/70">{POI_SOURCE_LABELS[s.source]}</span>
          {s.status === "failed" ? (
            <span className="flex items-center gap-1.5">
              <span className="text-amber-300">⚠️ 수집 실패</span>
              <button type="button" disabled={retryingSource === s.source}
                onClick={() => onRetrySource(s.source)}
                className="rounded border border-amber-300/40 px-1.5 py-0.5 text-[11px] text-amber-200 hover:bg-amber-300/10 disabled:opacity-50">
                {retryingSource === s.source ? "재시도 중…" : "재시도"}
              </button>
            </span>
          ) : (
            <span className="text-emerald-300/90">
              {s.status === "fresh" ? "방금 수집" : `${formatFetchedDate(s.fetchedAt)} 수집본`}
            </span>
          )}
        </li>
      ))}
    </ul>
  </div>
)}
```

헬퍼 (sidebar.tsx 내 함수):

```ts
function formatFetchedDate(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
```

- [ ] **Step 3: 타입 체크 + 수동 확인**

Run: `npm run lint` → 오류 0
dev 서버에서 분석 실행 → 카드에 소스 6종 상태 표시, 2회차 분석에서 "M/D 수집본" 표기 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/sidebar.tsx
git commit -m "feat: 사이드바 데이터 수집 상태 카드 — 소스별 배지·재시도·전체 새로 수집"
```

---

### Task 7: PPT 출처 슬라이드에 수집일·누락 표기

**Files:**
- Modify: `src/lib/ppt-canvas-renderer.ts` (`SlideRenderInput`:46 확장, `renderDataSourceSlide`:1541)
- Modify: `src/lib/ppt-generator.ts` (`addDataSourceSlide`:1437, PptInput 동등 확장)
- Modify: `src/components/site-analysis-app.tsx` (PPT input 조립부에 `sourceStatuses` 전달)

**Interfaces:**
- Consumes: `SourceStatus`, `POI_SOURCE_LABELS`
- Produces: `SlideRenderInput`·PptInput에 `readonly sourceStatuses?: readonly SourceStatus[]` (옵셔널 — 기존 호출부 무수정 동작)

- [ ] **Step 1: 입력 타입 확장 + 표기 로직**

두 렌더러의 출처 슬라이드에 동일 문구 로직 적용 (공통 헬퍼를 `src/lib/source-status-text.ts`로 신규 생성):

```ts
// src/lib/source-status-text.ts
import { POI_SOURCE_LABELS, type SourceStatus } from "@/lib/types";

/** "지하철역·학교·산: 2026-07-12 수집" | "공원: 수집 실패 — 본 보고서에 누락" */
export function sourceStatusLines(statuses: readonly SourceStatus[]): string[] {
  return statuses.map((s) => {
    const label = POI_SOURCE_LABELS[s.source];
    if (s.status === "failed") return `${label}: 수집 실패 — 본 보고서에 누락`;
    const d = new Date(s.fetchedAt ?? Date.now());
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `${label}: ${ymd} 수집`;
  });
}

export function hasFailedSource(statuses: readonly SourceStatus[]): boolean {
  return statuses.some((s) => s.status === "failed");
}
```

- `renderDataSourceSlide`: 기존 본문 아래에 `sourceStatusLines(input.sourceStatuses ?? [])`를 줄 단위로 drawTextBox (기존 본문 텍스트 스타일 재사용, fontSize 9).
- `addDataSourceSlide`: 동일 줄들을 slide.addText (기존 출처 텍스트 옵션 복사).
- 누락 소스가 있으면(`hasFailedSource`) 두 렌더러의 표지 슬라이드 하단에 경고 1줄: `"⚠ 일부 데이터 누락 — 출처 슬라이드 참조"` (기존 muted 텍스트 스타일).

- [ ] **Step 2: 검증**

Run: `npm run lint` → 오류 0
Run: `npx tsx src/scripts/test-poi-cache.mjs && npx tsx src/scripts/test-overpass-fetch.mjs` → 통과
dev 서버 → 분석 → PPT 미리보기 → "데이터 출처 및 신뢰도" 슬라이드에 소스별 수집일 줄 확인. 미리보기·다운로드 PPT 양쪽 동일 확인(`node qa/validate-preview-parity.mjs`가 있으면 실행).

- [ ] **Step 3: 커밋**

```bash
git add src/lib/source-status-text.ts src/lib/ppt-canvas-renderer.ts src/lib/ppt-generator.ts src/components/site-analysis-app.tsx
git commit -m "feat: PPT 출처 슬라이드 소스별 수집일·누락 표기 + 표지 누락 경고"
```

---

### Task 8: 수용 테스트 (Fable 런타임 검증 — 에이전트 아닌 리뷰어 수행)

**Files:** 없음 (검증 전용)

- [ ] **A. 결정성**: dev 서버에서 동일 좌표(서울시청 37.5665, 126.9780, 3km) 연속 5회 분석 → POI 개수 5회 모두 동일 (2회차부터 sources 전부 "cached")
- [ ] **B. 캐시 속도**: 2회차 분석 소요 ≤ 5초
- [ ] **C. 차단 투명성**: `OVERPASS_URL=http://127.0.0.1:9` 환경변수로 dev 서버 재기동(미러도 차단하려면 hosts 불필요 — lz4는 실서버이므로 이 테스트는 **새 좌표**로 실행해 캐시 미스 유도, 스로틀·재시도 후 osm/park "failed" 확인) → 사이드바 ⚠️ 배지 + [재시도] 노출, PPT 출처 슬라이드에 "수집 실패 — 본 보고서에 누락" 표기
- [ ] **D. 재시도**: 차단 해제 후 [재시도] 클릭 → 해당 소스만 "방금 수집"으로 전환, 지도에 해당 카테고리 마커 등장
- [ ] **E. 회귀**: `npm run test` 기존 체인 통과 + PPT 미리보기 정상

전부 통과 시 main 머지 → 사용자 승인 후 배포 → 서버 BUILD_ID 확인 → 완료 기록.

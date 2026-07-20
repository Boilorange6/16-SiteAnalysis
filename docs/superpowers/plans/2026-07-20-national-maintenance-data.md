# National Maintenance Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국토교통부 전국 정비사업 속성 데이터와 허가받은 공식 SHP 경계를 결합해, 전국 어느 지역에서나 신뢰도 상태가 명확한 정비사업 목록·폴리곤·분석·PPT를 제공한다.

**Architecture:** 전국 속성과 공간 경계를 독립적으로 수집·캐시하고, 서버 내부의 보수적인 exact join 단계에서만 합친다. SHP는 별도 배치에서 EPSG:4326 GeoJSON 서버 artifact로 변환하며, 런타임은 bbox 후보 축소 후 원-폴리곤 교차를 계산한다. 좌표가 없는 미결합 속성 레코드는 지도 POI로 가장하지 않고 별도 행정구역 카탈로그로 전달한다.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.8, SQLite (`better-sqlite3`), Leaflet, `ky@2.0.2`, `shapefile@0.6.6`, `proj4@2.20.9`, `@turf/turf@7.3.5`, Node/tsx assertion scripts, Playwright.

## Global Constraints

- 승인된 설계 `docs/superpowers/specs/2026-07-20-national-maintenance-data-design.md`를 기능 계약으로 삼는다.
- 현재 작업 트리에 사용자 변경이 많다. 각 작업 전에 `git diff -- <대상 파일>`을 확인하고 아래의 정확한 파일만 스테이징한다. `git add .`, reset, checkout은 사용하지 않는다.
- `DATA_GO_KR_API_KEY`, `SEOUL_OPEN_API_KEY`, 이용허락 회신, 원본 ZIP, 변환 artifact를 Git·브라우저 응답·클라이언트 번들에 넣지 않는다.
- 원본 및 변환 좌표는 GeoJSON 표준 `[lng, lat]`로 유지한다. Leaflet 경계에서만 `[lat, lng]`로 바꾼다.
- fuzzy name 결과로 `boundary_status=\"confirmed\"`를 만들지 않는다.
- 좌표가 없는 전국 속성 레코드는 분석 중심점이나 행정구역 중심점에 임의 배치하지 않는다.
- 기존 단계 점수 가중치는 수정하지 않는다.
- 외부 원천 실패는 빈 성공이 아니라 source status와 경고로 표면화한다. 만료 캐시가 있으면 기준시각을 포함한 `cached`로 제공한다.
- 신규 운영 HTTP 코드는 bare `fetch` 대신 timeout·재시도 정책을 명시한 `ky@2.0.2` 인스턴스를 주입한다. 기존 프로젝트의 npm/tsx 실행 체계는 유지한다.
- 신규 함수는 독립 인자를 4개 이상 나열하지 않고 `MaintenanceSearchQuery`, `PoiSourceCacheKey` 같은 도메인 요청 객체를 사용한다.
- 구현 중 확인한 추가 DBF 필드명은 alias 테이블에만 추가하며 결합 안전 규칙은 완화하지 않는다.

## Data Contract and File Map

| 책임 | 파일 |
| --- | --- |
| 공개 정비사업·경계·카탈로그·source status 타입 | `src/lib/types.ts` |
| 전국 API 정규화·페이지네이션 | `src/lib/server/maintenance/national-provider.ts` |
| 지역 API(서울·부산) 정규화 | `src/lib/server/maintenance/regional-provider.ts` |
| SHP/CRS 변환 순수 로직 | `src/lib/server/maintenance/boundary-build.ts` |
| 배치 CLI | `src/scripts/build-maintenance-boundaries.mjs` |
| 런타임 artifact 로더·공간 검색 | `src/lib/server/maintenance/boundary-store.ts` |
| exact join·필드 우선순위·카탈로그 분리 | `src/lib/server/maintenance/merge.ts` |
| 검색 오케스트레이션 | `src/lib/server/maintenance-project-search.ts` |
| 독립 캐시/status API | `src/lib/server/poi-cache.ts`, `src/app/api/poi-search/route.ts` |
| 클라이언트 데이터 계약 | `src/lib/data-provider.ts`, `src/components/site-analysis-app.tsx` |
| 지도 변환·popup·경계 | `src/lib/maintenance-map-utils.ts`, `src/components/map-view.tsx` |
| 집계·사이드바 | `src/lib/maintenance-analysis.ts`, `src/components/sidebar.tsx` |
| PPT/미리보기 공통 행 | `src/lib/maintenance-presentation.ts`, `src/lib/ppt-generator.ts`, `src/lib/ppt-canvas-renderer.ts` |
| 운영 문서 | `.env.example`, `docs/maintenance-data-operations.md` |

---

## Task 0: Operator Preflight — Secrets and Licensed Inputs

**Files:**
- Create: `.env.example`
- Create: `docs/maintenance-data-operations.md`

- [ ] **Step 1: Verify prerequisites without printing secrets**

Run:

```powershell
$envFile = Join-Path (Get-Location) '.env.local'
$lines = if (Test-Path -LiteralPath $envFile) { Get-Content -LiteralPath $envFile } else { @() }
$hasDataKey = [bool]($lines | Where-Object { $_ -match '^DATA_GO_KR_API_KEY=.+$' })
$hasSeoulKey = [bool]($lines | Where-Object { $_ -match '^SEOUL_OPEN_API_KEY=.+$' })
$zipNames = if (Test-Path -LiteralPath 'data/maintenance/raw') {
  @(Get-ChildItem -LiteralPath 'data/maintenance/raw' -Filter '*.zip' -File | Select-Object -ExpandProperty Name)
} else { @() }
[pscustomobject]@{ DataGoKrKey = $hasDataKey; SeoulKey = $hasSeoulKey; RawZipCount = $zipNames.Count; RawZipNames = $zipNames }
```

Expected before real-source QA: `DataGoKrKey=True` and at least one authorized UD602/UD501 ZIP. `SeoulKey=False` is allowed, but `maintenance_seoul` must report `failed` and never emit samples.

- [ ] **Step 2: Add the secret-name template and operations guide**

`.env.example`:

```dotenv
DATA_GO_KR_API_KEY=
SEOUL_OPEN_API_KEY=
NCP_MAP_CLIENT_ID=
NCP_MAP_CLIENT_SECRET=
```

`docs/maintenance-data-operations.md` must state:

1. authorized ZIP placement under `data/maintenance/raw/`;
2. `npm run build:maintenance-boundaries` command;
3. generated GeoJSON, metadata, and quarantine paths;
4. artifact-only server deployment and prohibition on `public/` placement;
5. 20% count-change review and `--accept-large-change` rerun;
6. key rotation and missing-key behavior;
7. attribution and “법적 효력 없는 참고자료” requirement.

- [ ] **Step 3: Commit operator scaffolding**

```powershell
git add -- .env.example docs/maintenance-data-operations.md
git commit -m \"docs: 정비사업 데이터 운영 절차 추가\"
```

---

## Task 1: Domain Contracts and Source Status Split

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/data-provider.ts`
- Create: `src/lib/maintenance-map-utils.ts`
- Modify: `src/components/map-view.tsx`
- Test: `src/scripts/test-maintenance-contracts.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing contract test**

```js
import assert from \"node:assert/strict\";
import { POI_SOURCE_CATEGORIES, POI_SOURCE_LABELS } from \"../lib/types.ts\";

const sources = [
  \"maintenance_attributes\",
  \"maintenance_boundaries\",
  \"maintenance_seoul\",
  \"maintenance_busan\",
];

for (const source of sources) {
  assert.deepEqual(POI_SOURCE_CATEGORIES[source], [\"maintenance\"]);
  assert.equal(typeof POI_SOURCE_LABELS[source], \"string\");
  assert.ok(POI_SOURCE_LABELS[source].length > 0);
}

console.log(\"maintenance contracts: ok\");
```

In the same RED phase, add Polygon and MultiPolygon fixtures that assert `boundaryToLeafletLatLngs` swaps every coordinate while preserving ring, hole, and part nesting.

Add:

```json
\"test:maintenance\": \"tsx src/scripts/test-maintenance-contracts.mjs\"
```

Run `npm run test:maintenance`. Expected: FAIL because the four source IDs do not exist.

- [ ] **Step 2: Add exact public contracts**

Retain legacy `\"maintenance\"` for saved-project compatibility and add:

```ts
export type PoiSourceId =
  | \"osm\"
  | \"park\"
  | \"maintenance\"
  | \"maintenance_attributes\"
  | \"maintenance_boundaries\"
  | \"maintenance_seoul\"
  | \"maintenance_busan\"
  | \"residential\"
  | \"planned-residential\"
  | \"subway-routes\"
  | \"rail-network\";

export type MaintenanceBoundary =
  | {
      readonly type: \"Polygon\";
      readonly coordinates: readonly (readonly (readonly [number, number])[])[];
    }
  | {
      readonly type: \"MultiPolygon\";
      readonly coordinates: readonly (readonly (readonly (readonly [number, number])[])[])[];
    };

export type MaintenanceBoundaryStatus = \"confirmed\" | \"unmatched\" | \"unavailable\";
export type MaintenanceSource =
  | \"molit_integrated\"
  | \"public_standard\"
  | \"molit_spatial\"
  | \"seoul_open_data\"
  | \"busan_data_go_kr\";

export interface MaintenanceCatalogProject {
  readonly id: string;
  readonly name: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly type: string;
  readonly stage: MaintenanceStage;
  readonly source: MaintenanceSource;
  readonly source_updated_at?: string;
  readonly implementer?: string;
  readonly planned_households?: number;
  readonly area_sqm?: number;
  readonly designation_date?: string;
  readonly management_agency?: string;
  readonly spatial_status: \"not_located\";
}
```

Change `MaintenanceProject.boundary` to `MaintenanceBoundary` and add:

```ts
readonly source_updated_at?: string;
readonly boundary_source_url?: string;
readonly boundary_source_id?: string;
readonly boundary_retrieved_at?: string;
readonly boundary_original_crs?: string;
readonly implementer?: string;
readonly designation_date?: string;
readonly land_use_zone?: string;
readonly management_agency?: string;
```

Add `maintenanceCatalog: readonly MaintenanceCatalogProject[]` to `RegionData`.

Use labels:

```ts
maintenance_attributes: \"국토부 전국 정비사업\",
maintenance_boundaries: \"국토부 정비구역 경계\",
maintenance_seoul: \"서울 정비사업 상세\",
maintenance_busan: \"부산 정비사업 상세\",
```

All four category mappings are `[\"maintenance\"]`.

- [ ] **Step 3: Update client fallbacks without fabricating results**

In `src/lib/data-provider.ts`:

- expect `maintenanceCatalog` in `/api/poi-search` responses;
- on API failure return `maintenanceCatalog: []`;
- replace the single maintenance fallback source with the four source IDs;
- populate `RegionData.maintenanceCatalog`;
- default old saved payloads at load boundaries with `maintenanceCatalog ?? []`;
- when any maintenance source is retried, replace the complete merged maintenance category rather than append duplicates.

Create `src/lib/maintenance-map-utils.ts` as the small pure conversion boundary and update `src/components/map-view.tsx` in the same task that changes the public boundary type. `boundaryToLeafletLatLngs` converts Polygon and MultiPolygon nested rings from `[lng, lat]` to Leaflet `[lat, lng]` with an exhaustive discriminant branch, preserving holes and parts. The oversized map component only imports and calls this helper; do not add conversion branches there. Task 1 must keep `npm run lint` green without a legacy single-ring union or temporary type escape hatch.

- [ ] **Step 4: Verify and commit**

```powershell
npm run test:maintenance
npm run lint
git add -- src/lib/types.ts src/lib/data-provider.ts src/scripts/test-maintenance-contracts.mjs package.json
git commit -m \"feat: 전국 정비사업 데이터 계약 추가\"
```

Expected: both tests PASS.

---

## Task 2: Stale Cache Semantics and National Attribute Provider

**Files:**
- Modify: `src/lib/server/poi-cache.ts`
- Create: `src/lib/server/maintenance/national-provider.ts`
- Test: `src/scripts/test-maintenance-national-provider.mjs`
- Test: `src/scripts/test-poi-cache.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing cache and provider tests**

```js
import assert from \"node:assert/strict\";
import ky from \"ky\";
import {
  fetchNationalMaintenanceAttributes,
  normalizeIntegratedRow,
  normalizeStandardRow,
} from \"../lib/server/maintenance/national-provider.ts\";

assert.deepEqual(
  normalizeIntegratedRow({
    시도: \"대전광역시\", 시군구: \"동구\", 구역명: \"성남1구역\",
    추진단계: \"조합설립인가\", 정비사업유형: \"재개발\",
    시행자: \"성남1구역 조합\", 예정세대수: \"1,234\", 데이터기준일자: \"2026-01-01\",
  }),
  {
    source_record_id: \"대전광역시|동구|성남1구역\",
    source: \"molit_integrated\", sido: \"대전광역시\", sigungu: \"동구\",
    name: \"성남1구역\", type: \"재개발\", stage: \"조합설립\",
    implementer: \"성남1구역 조합\", planned_households: 1234,
    source_updated_at: \"2026-01-01\",
  },
);

assert.equal(
  normalizeStandardRow({ 정비구역명: \"테스트\", 정비구역면적: \"10000\", 건폐율: \"60\", 데이터기준일자: \"2026-02-03\" }).area_sqm,
  10000,
);

const requestedPages = [];
const httpClient = ky.create({
  retry: 0,
  timeout: 1_000,
  fetch: async (request) => {
  const parsed = new URL(request.url);
  requestedPages.push(Number(parsed.searchParams.get(\"page\")));
  return new Response(JSON.stringify({
    currentCount: 2, totalCount: 2,
    data: [
      { 시도: \"서울특별시\", 시군구: \"강남구\", 구역명: \"A\" },
      { 시도: \"부산광역시\", 시군구: \"동구\", 구역명: \"B\" },
    ],
  }), { status: 200, headers: { \"Content-Type\": \"application/json\" } });
  },
});

const result = await fetchNationalMaintenanceAttributes({ serviceKey: \"test\", httpClient, pageSize: 2 });
assert.equal(result.integrated.length, 2);
assert.deepEqual(requestedPages, [1]);

await assert.rejects(
  () => fetchNationalMaintenanceAttributes({
    serviceKey: \"expired\",
    httpClient: ky.create({
      retry: 0,
      timeout: 1_000,
      fetch: async () => new Response(
        JSON.stringify({ code: \"30\", msg: \"SERVICE KEY IS NOT REGISTERED ERROR\" }),
        { status: 403 },
      ),
    }),
  }),
  /SERVICE KEY|403/,
);
```

Extend `test-poi-cache.mjs` so an expired row is returned only after a forced live failure, with its original `fetchedAt` and status `cached`.

Run both tests. Expected: FAIL because provider and expired-cache access do not exist.

- [ ] **Step 2: Implement exact stale-cache semantics**

```ts
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

export function getCachedSource<T>(
  key: PoiSourceCacheKey,
  options: { readonly includeExpired?: boolean } = {},
): CachedSource<T> | null;
```

`resolveSource` must:

1. return non-expired cache immediately when `refresh=false`;
2. attempt live fetch for expired cache or explicit refresh;
3. fall back to either fresh or expired parseable cache as `cached` if live fetch throws;
4. return `failed` only when no parseable cache exists.

- [ ] **Step 3: Implement the national provider**

Fixed endpoints (`15160169` 전국 통합, `15155703` 전국 표준):

```ts
const INTEGRATED_ENDPOINT =
  \"https://api.odcloud.kr/api/15160169/v1/uddi:4d7f16a9-b0fd-4d07-b266-d0ad82aeaf34\";
const STANDARD_ENDPOINT =
  \"https://api.data.go.kr/openapi/tn_pubr_public_redevelopment_reconstruction_project_api\";
```

Public server interface:

```ts
export interface MaintenanceAttributeRecord {
  readonly source_record_id: string;
  readonly source: \"molit_integrated\" | \"public_standard\";
  readonly sido: string;
  readonly sigungu: string;
  readonly name: string;
  readonly type: string;
  readonly stage: MaintenanceStage;
  readonly implementer?: string;
  readonly planned_households?: number;
  readonly area_sqm?: number;
  readonly land_use_zone?: string;
  readonly building_coverage_ratio?: number;
  readonly floor_area_ratio?: number;
  readonly designation_date?: string;
  readonly management_agency?: string;
  readonly source_updated_at?: string;
  readonly lat?: number;
  readonly lng?: number;
}

export async function fetchNationalMaintenanceAttributes(options: {
  readonly serviceKey?: string;
  readonly httpClient?: KyInstance;
  readonly pageSize?: number;
} = {}): Promise<{
  readonly integrated: readonly MaintenanceAttributeRecord[];
  readonly standard: readonly MaintenanceAttributeRecord[];
}>;
```

Rules:

- read `options.serviceKey ?? process.env.DATA_GO_KR_API_KEY` and throw `DATA_GO_KR_API_KEY is not configured` when empty;
- use a `ky` instance with a 10-second timeout and retry limit 2 for 429/5xx only; authentication errors are not retried;
- pass the key via `URLSearchParams` and never log a keyed URL;
- paginate integrated data until `page * perPage >= totalCount`;
- paginate standard data until `pageNo * numOfRows >= totalCount`;
- detect HTTP, XML-text, and JSON error bodies; accept JSON success only;
- use explicit Korean-field alias arrays and reject rows without `(sido, sigungu, name)`;
- normalize comma numbers, ISO-like dates, type, and current `MaintenanceStage` values;
- keep standard and integrated arrays separate so field priority stays observable.

- [ ] **Step 4: Verify and commit**

Install the pinned HTTP client:

```powershell
npm install ky@2.0.2
```

Set:

```json
\"test:maintenance\": \"tsx src/scripts/test-maintenance-contracts.mjs && tsx src/scripts/test-maintenance-national-provider.mjs && tsx src/scripts/test-poi-cache.mjs\"
```

Run:

```powershell
npm run test:maintenance
npm run lint
git add -- src/lib/server/poi-cache.ts src/lib/server/maintenance/national-provider.ts src/scripts/test-maintenance-national-provider.mjs src/scripts/test-poi-cache.mjs package.json
git commit -m \"feat: 전국 정비사업 속성 공급자 추가\"
```

Expected: PASS without live network calls.

---

## Task 3: Licensed SHP-to-GeoJSON Build Pipeline

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/server/maintenance/boundary-build.ts`
- Create: `src/scripts/build-maintenance-boundaries.mjs`
- Test: `src/scripts/test-maintenance-boundary-build.mjs`

- [ ] **Step 1: Install pinned spatial dependencies and ignore licensed data**

```powershell
npm install shapefile@0.6.6 proj4@2.20.9 @turf/turf@7.3.5
```

Append:

```gitignore
data/maintenance/raw/
data/maintenance/processed/
```

Verify:

```powershell
git check-ignore data/maintenance/raw/example.zip data/maintenance/processed/boundaries.geojson
```

Expected: both paths printed.

- [ ] **Step 2: Write failing pure transformation tests**

The test covers Polygon holes, MultiPolygon members, EPSG:5186 conversion, missing PRJ, non-finite coordinates, ring closure, and self-intersection quarantine.

```js
import assert from \"node:assert/strict\";
import {
  identifySupportedCrs,
  transformBoundaryFeature,
  validateArchiveMembers,
} from \"../lib/server/maintenance/boundary-build.ts\";

assert.equal(
  identifySupportedCrs('PROJCS[\"Korea 2000 / Central Belt 2010\",GEOGCS[\"GRS 1980\"]]'),
  \"EPSG:5186\",
);
assert.throws(
  () => validateArchiveMembers([\"sample.shp\", \"sample.shx\", \"sample.dbf\"]),
  /PRJ/,
);

const result = transformBoundaryFeature({
  geometry: {
    type: \"Polygon\",
    coordinates: [
      [[200000, 500000], [201000, 500000], [201000, 501000], [200000, 501000], [200000, 500000]],
      [[200200, 500200], [200800, 500200], [200800, 500800], [200200, 500800], [200200, 500200]],
    ],
  },
  properties: { ID: \"p-1\", NAME: \"테스트구역\" },
}, \"EPSG:5186\", {
  sourceUrl: \"https://www.data.go.kr/data/15146864/fileData.do\",
  retrievedAt: \"2026-07-20\",
  sourceDatasetId: \"30335\",
  sourceLayer: \"UD602\",
});

assert.equal(result.feature.geometry.type, \"Polygon\");
assert.equal(result.feature.geometry.coordinates.length, 2);
assert.equal(result.quarantine, null);
for (const ring of result.feature.geometry.coordinates) {
  assert.deepEqual(ring[0], ring.at(-1));
}
```

Run `npx tsx src/scripts/test-maintenance-boundary-build.mjs`. Expected: module-not-found FAIL.

- [ ] **Step 3: Implement strict conversion and reporting**

`boundary-build.ts` exports:

```ts
export interface MaintenanceBoundaryProperties {
  readonly source_feature_id: string;
  readonly source_dataset_id: \"30335\" | \"30336\";
  readonly source_layer: \"UD602\" | \"UD501\";
  readonly name?: string;
  readonly sido?: string;
  readonly sigungu?: string;
  readonly area_sqm?: number;
  readonly designation_date?: string;
  readonly notice_ids: readonly string[];
  readonly original_crs: \"EPSG:5186\" | \"EPSG:2097\";
  readonly source_url: string;
  readonly source_updated_at?: string;
  readonly retrieved_at: string;
  readonly bbox: readonly [number, number, number, number];
}

export interface BoundaryBuildReport {
  readonly schema_version: 1;
  readonly input_sha256: readonly { readonly file: string; readonly sha256: string }[];
  readonly input_feature_count: number;
  readonly output_feature_count: number;
  readonly quarantined_feature_count: number;
  readonly crs_counts: Readonly<Record<string, number>>;
  readonly bbox: readonly [number, number, number, number];
  readonly source_updated_at: string | null;
  readonly transformed_at: string;
  readonly large_change_accepted: boolean;
}
```

Conversion rules:

- group `.shp/.shx/.dbf/.prj` members by basename case-insensitively; fail the archive before output when incomplete;
- recognize only explicit 5186/2097 EPSG text or checked official WKT signatures; unknown WKT fails the entire archive;
- register official proj4 definitions and transform every coordinate;
- preserve all Polygon rings and MultiPolygon members;
- close rings when needed, then require at least four positions;
- require finite longitude `124..132` and latitude `33..39.5`;
- use Turf boolean-valid; invalid geometry enters quarantine and is not repaired silently;
- retain recognized ID/name/admin/date/area aliases; raw field names may appear only in the server-side quarantine report;
- compute SHA-256, counts, CRS counts, bbox, source date, and transform time;
- write three temporary sibling files and atomically rename them only after all gates pass;
- reject an absolute output-count change over 20% against prior metadata unless `--accept-large-change` is passed, then record the acceptance.

- [ ] **Step 4: Add and exercise the batch CLI**

Add:

```json
\"build:maintenance-boundaries\": \"tsx src/scripts/build-maintenance-boundaries.mjs\"
```

CLI:

```powershell
npm run build:maintenance-boundaries -- --input data/maintenance/raw --output data/maintenance/processed
```

With no ZIP: nonzero and `No authorized maintenance SHP archives found`.

With authorized ZIPs:

```text
data/maintenance/processed/boundaries.geojson
data/maintenance/processed/boundaries.meta.json
data/maintenance/processed/boundaries.quarantine.json
```

Review counts and bbox before using a 20% override.

- [ ] **Step 5: Verify and commit code only**

```powershell
npx tsx src/scripts/test-maintenance-boundary-build.mjs
npm run lint
git add -- .gitignore package.json package-lock.json src/lib/server/maintenance/boundary-build.ts src/scripts/build-maintenance-boundaries.mjs src/scripts/test-maintenance-boundary-build.mjs
git diff --cached --name-only
git commit -m \"feat: 정비구역 공간파일 변환 파이프라인 추가\"
```

Expected: no `data/maintenance` artifact in staged names.

---

## Task 4: Boundary Artifact Loader and Radius Geometry Search

**Files:**
- Create: `src/lib/server/maintenance/boundary-store.ts`
- Test: `src/scripts/test-maintenance-boundary-store.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing spatial behavior tests**

Build a temporary FeatureCollection containing a polygon with the center, an edge intersecting the circle, a fully outside polygon, a MultiPolygon with one near part, and a polygon whose hole contains the center.

```js
const inside = searchMaintenanceBoundaries(collection, {
  lat: 37.5, lng: 127.0, radiusM: 100,
});
assert.equal(
  inside.find((row) => row.properties.source_feature_id === \"inside\").distance_m,
  0,
);
const hole = inside.find((row) => row.properties.source_feature_id === \"hole\");
assert.ok(hole.distance_m > 0, \"a center inside a hole is outside the polygon surface\");
assert.ok(inside.some((row) => row.properties.source_feature_id === \"multipolygon-near\"));
assert.ok(!inside.some((row) => row.properties.source_feature_id === \"outside\"));
```

Run `npx tsx src/scripts/test-maintenance-boundary-store.mjs`. Expected: module-not-found FAIL.

- [ ] **Step 2: Implement mtime-aware loading and exact geometry search**

```ts
export interface MaintenanceBoundaryFeature {
  readonly type: \"Feature\";
  readonly geometry: MaintenanceBoundary;
  readonly properties: MaintenanceBoundaryProperties;
}

export interface LocatedMaintenanceBoundary extends MaintenanceBoundaryFeature {
  readonly distance_m: number;
  readonly representative_lat: number;
  readonly representative_lng: number;
}

export function loadMaintenanceBoundaryArtifact(
  artifactPath?: string,
): readonly MaintenanceBoundaryFeature[];

export function searchMaintenanceBoundaries(
  features: readonly MaintenanceBoundaryFeature[],
  query: { readonly lat: number; readonly lng: number; readonly radiusM: number },
): readonly LocatedMaintenanceBoundary[];
```

Loader:

- default path is `path.join(process.cwd(), \"data/maintenance/processed/boundaries.geojson\")`;
- cache parsed features by absolute path and mtime;
- missing file, malformed JSON, wrong schema, or empty collection throws;
- never import artifact code into the client and never expose a download route.

Search:

1. compare stored bbox with a WGS84 search bbox;
2. use Turf `booleanIntersects(feature, circle(center, radiusM, { units: \"meters\" }))`;
3. use `booleanPointInPolygon` for surface membership, respecting holes;
4. return distance zero inside the actual polygon surface;
5. otherwise flatten boundary lines and use minimum `pointToLineDistance`;
6. use `pointOnFeature` for the representative marker;
7. sort by distance, normalized name, then source feature ID.

- [ ] **Step 3: Verify and commit**

Append the build/store tests to `test:maintenance`, then:

```powershell
npx tsx src/scripts/test-maintenance-boundary-store.mjs
npm run test:maintenance
npm run lint
git add -- src/lib/server/maintenance/boundary-store.ts src/scripts/test-maintenance-boundary-store.mjs package.json
git commit -m \"feat: 정비구역 반경 공간 검색 추가\"
```

Expected: PASS.

---

## Task 5: Conservative Join, Provenance, and Admin-Level Catalog

**Files:**
- Create: `src/lib/server/maintenance/merge.ts`
- Test: `src/scripts/test-maintenance-merge.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing join matrix**

Test independently:

1. common official ID exact match confirms;
2. Seoul `NTFC_SN`/`WTNNC_SN` exact match confirms;
3. unique normalized `(sido,sigungu,name)` plus area difference exactly 5% confirms;
4. area difference above 5% rejects;
5. duplicate name on either side rejects;
6. different sigungu rejects;
7. conflicting designation dates reject;
8. regional → standard → integrated field priority retains provenance;
9. named unmatched polygon becomes `molit_spatial`/`미확인`/`unmatched`;
10. unnamed unmatched polygon is excluded;
11. unmatched attribute becomes `MaintenanceCatalogProject` with no coordinates;
12. same address/name alone does not merge distinct projects.

```js
const merged = mergeMaintenanceData({ attributes, boundaries, regional: [], selectedRegions });
assert.equal(merged.projects[0].boundary_status, \"confirmed\");
assert.deepEqual(merged.projects[0].boundary, boundaries[0].geometry);
assert.equal(
  merged.internalProjects[0].field_provenance.planned_households.source,
  \"public_standard\",
);
assert.equal(merged.catalog[0].spatial_status, \"not_located\");
assert.ok(!(\"lat\" in merged.catalog[0]));
```

Run `npx tsx src/scripts/test-maintenance-merge.mjs`. Expected: module-not-found FAIL.

- [ ] **Step 2: Implement normalized exact keys and compatibility gates**

```ts
export interface MaintenanceFieldProvenance {
  readonly source: MaintenanceSource;
  readonly source_record_id: string;
  readonly source_updated_at?: string;
}

export interface MergedMaintenanceResult {
  readonly projects: readonly MaintenanceProject[];
  readonly catalog: readonly MaintenanceCatalogProject[];
  readonly internalProjects: readonly {
    readonly project: MaintenanceProject;
    readonly field_provenance: Readonly<Record<string, MaintenanceFieldProvenance>>;
  }[];
  readonly diagnostics: readonly {
    readonly attribute_id?: string;
    readonly boundary_id?: string;
    readonly reason:
      | \"ambiguous\"
      | \"admin_mismatch\"
      | \"area_mismatch\"
      | \"date_mismatch\"
      | \"unnamed_boundary\";
  }[];
}
```

Rules:

- comparison normalization is Unicode NFKC, trim, whitespace collapse, punctuation removal, and comparison-only removal of `정비구역`/`재개발구역`/`재건축구역` suffixes;
- official IDs use trimmed uppercase exact equality, never substring matching;
- region+name is usable only when it appears exactly once in both candidate sets;
- if both areas exist, require `abs(a-b)/max(a,b) <= 0.05`;
- if both designation dates exist, require the same calendar date;
- any record whose own `source_updated_at` predates its designation date is incompatible;
- field priority is regional detail, public standard, integrated base;
- geometry and boundary provenance always come from the spatial artifact;
- internal provenance is stripped from the public response unless explicitly whitelisted.

- [ ] **Step 3: Project unmatched records safely**

- named boundary: representative coordinate from `pointOnFeature`, original geometry, layer-derived type or `기타 정비구역`, `stage=\"미확인\"`, `source=\"molit_spatial\"`, `boundary_status=\"unmatched\"`;
- unnamed boundary: diagnostic only;
- unmatched attribute in selected admin region: catalog entry with `spatial_status=\"not_located\"`;
- attribute outside selected region: omit from this response but retain in the global cached dataset.

- [ ] **Step 4: Verify and commit**

```powershell
npx tsx src/scripts/test-maintenance-merge.mjs
npm run lint
git add -- src/lib/server/maintenance/merge.ts src/scripts/test-maintenance-merge.mjs package.json
git commit -m \"feat: 정비사업 속성 경계 안전 결합 추가\"
```

Expected: PASS.

---

## Task 6: Four Independent Sources and Search Orchestration

**Files:**
- Create: `src/lib/server/maintenance/regional-provider.ts`
- Modify: `src/lib/server/maintenance-project-search.ts`
- Modify: `src/app/api/poi-search/route.ts`
- Modify: `src/lib/data-provider.ts`
- Modify: `src/components/site-analysis-app.tsx`
- Test: `src/scripts/test-maintenance-orchestration.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing dependency-injected orchestration tests**

Cover:

- boundary success + national API failure still returns unmatched polygons;
- attributes success + artifact failure returns admin catalog;
- boundary + attributes success returns one safely joined project;
- Seoul failure does not change the other three statuses;
- missing Seoul key yields no hard-coded sample;
- same-name Seoul/Busan projects do not cross-merge;
- retry response replaces the complete maintenance category.

```js
assert.deepEqual(
  result.sources.map(({ source, status }) => ({ source, status })),
  [
    { source: \"maintenance_boundaries\", status: \"fresh\" },
    { source: \"maintenance_attributes\", status: \"failed\" },
    { source: \"maintenance_seoul\", status: \"failed\" },
    { source: \"maintenance_busan\", status: \"fresh\" },
  ],
);
assert.equal(result.projects[0].source, \"molit_spatial\");
assert.equal(result.projects[0].boundary_status, \"unmatched\");
```

Run `npx tsx src/scripts/test-maintenance-orchestration.mjs`. Expected: FAIL.

- [ ] **Step 2: Extract regional providers without behavioral loss**

Move 서울 and 부산 fetch/normalization from `maintenance-project-search.ts` into `regional-provider.ts` with an injected `KyInstance` and geocoder.

Required behavior:

- delete the Seoul sample fallback; missing key throws a provider error;
- retain official endpoints, stage mapping, notice URL, and address geocoding;
- retain 부산 area, households, FAR, coverage, contractor, architect, and union fields;
- add sido, sigungu, official ID arrays, and internal field provenance;
- remove current name/address-within-120m `mergeProjects` heuristic.

- [ ] **Step 3: Implement the orchestrator**

```ts
export interface MaintenanceSearchResult {
  readonly projects: readonly MaintenanceProject[];
  readonly catalog: readonly MaintenanceCatalogProject[];
  readonly sources: readonly SourceStatus[];
  readonly warnings: readonly string[];
}

export interface MaintenanceSearchQuery {
  readonly center: { readonly lat: number; readonly lng: number };
  readonly radiusM: number;
  readonly refresh: boolean;
}

export async function searchMaintenanceProjects(
  query: MaintenanceSearchQuery,
  dependencies?: MaintenanceSearchDependencies,
): Promise<MaintenanceSearchResult>;
```

Execution:

1. resolve `maintenance_boundaries` for requested center/radius;
2. resolve global `maintenance_attributes` with cache coordinates `0,0,0` so the 1,566-row data is not refetched per point;
3. derive selected admin regions from boundary candidates; if none exist, attempt existing NCP reverse geocode solely for catalog filtering;
4. resolve `maintenance_seoul` and `maintenance_busan` independently and in parallel;
5. merge all successful values once;
6. emit all four statuses in boundary/attributes/Seoul/Busan order;
7. emit a warning per failed source and a distinct warning when the admin region cannot be determined;
8. let local artifact failures use SQLite stale fallback when available.

The attributes provider status represents API collection, not whether every row could be placed on the map. Admin-region resolution failure leaves a successful attributes status but an empty catalog plus warning.

- [ ] **Step 4: Replace the route’s single maintenance source**

In `src/app/api/poi-search/route.ts`, remove the existing outer `resolveSource(source: \"maintenance\")` block. The orchestrator already resolves its sources.

```ts
const maintenanceCatalog: MaintenanceCatalogProject[] = [];

if (categories.includes(\"maintenance\")) {
  const maintenance = await searchMaintenanceProjects({
    center: { lat, lng },
    radiusM: radius,
    refresh,
  });
  pois.push(...maintenance.projects);
  sources.push(...maintenance.sources);
  warnings.push(...maintenance.warnings);
  maintenanceCatalog.push(...maintenance.catalog);
}

return NextResponse.json({ pois, warnings, sources, maintenanceCatalog });
```

Logs and response errors must never contain service keys or keyed URLs.

- [ ] **Step 5: Wire complete category replacement**

In `data-provider.ts` and `site-analysis-app.tsx`:

- store catalog alongside spatial projects;
- retrying any maintenance source replaces projects and catalog from the complete merged response;
- update all four maintenance statuses from `allSources`;
- do not append and create duplicate polygons;
- default old project payloads to empty catalog.

- [ ] **Step 6: Verify and commit**

```powershell
npx tsx src/scripts/test-maintenance-orchestration.mjs
npm run test:maintenance
npm run lint
git add -- src/lib/server/maintenance/regional-provider.ts src/lib/server/maintenance-project-search.ts src/app/api/poi-search/route.ts src/lib/data-provider.ts src/components/site-analysis-app.tsx src/scripts/test-maintenance-orchestration.mjs package.json
git commit -m \"feat: 정비사업 네 원천 독립 수집 연동\"
```

Expected: PASS.

---

## Task 7: GeoJSON Map Rendering, Popup, and Sidebar Detail

**Files:**
- Create: `src/lib/maintenance-map-utils.ts`
- Modify: `src/components/map-view.tsx`
- Modify: `src/lib/maintenance-analysis.ts`
- Modify: `src/components/sidebar.tsx`
- Modify: `src/lib/map-marker-utils.ts`
- Test: `src/scripts/test-maintenance-ui-model.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing UI-model tests**

```js
import assert from \"node:assert/strict\";
import {
  boundaryToLeafletLatLngs,
  maintenanceBoundaryLabel,
} from \"../lib/maintenance-map-utils.ts\";
import { summarizeMaintenanceProjects } from \"../lib/maintenance-analysis.ts\";

const polygon = {
  type: \"Polygon\",
  coordinates: [[
    [127.0, 37.5], [127.01, 37.5], [127.01, 37.51], [127.0, 37.5],
  ]],
};
assert.deepEqual(boundaryToLeafletLatLngs(polygon)[0][0], [37.5, 127.0]);
assert.equal(maintenanceBoundaryLabel(\"confirmed\"), \"공식 경계 확인\");
assert.equal(maintenanceBoundaryLabel(\"unmatched\"), \"공식 경계 · 사업정보 미결합\");
assert.equal(maintenanceBoundaryLabel(\"unavailable\"), \"경계 미확인\");

const summary = summarizeMaintenanceProjects([
  {
    id: \"a\", name: \"A\", lat: 37.5, lng: 127, category: \"maintenance\",
    type: \"재개발\", stage: \"조합설립\", address: \"\", area_sqm: 1000,
    planned_households: 200, source: \"molit_integrated\",
    boundary_status: \"confirmed\",
  },
  {
    id: \"b\", name: \"B\", lat: 37.51, lng: 127, category: \"maintenance\",
    type: \"재건축\", stage: \"미확인\", address: \"\", area_sqm: 0,
    planned_households: 300, source: \"molit_spatial\",
    boundary_status: \"unmatched\",
  },
]);
assert.equal(summary.totalPlannedHouseholds, 500);
assert.equal(summary.boundaryConfirmedCount, 1);
assert.equal(summary.boundaryUnmatchedCount, 1);
assert.deepEqual(summary.typeCounts, { 재개발: 1, 재건축: 1 });
```

Run `npx tsx src/scripts/test-maintenance-ui-model.mjs`. Expected: FAIL.

- [ ] **Step 2: Render Polygon/MultiPolygon with holes**

`maintenance-map-utils.ts`:

```ts
export function boundaryToLeafletLatLngs(
  boundary: MaintenanceBoundary,
):
  | readonly (readonly [number, number])[][]
  | readonly (readonly (readonly [number, number])[])[][] {
  const swapRing = (ring: readonly (readonly [number, number])[]) =>
    ring.map(([lng, lat]) => [lat, lng] as const);
  return boundary.type === \"Polygon\"
    ? boundary.coordinates.map(swapRing)
    : boundary.coordinates.map((polygon) => polygon.map(swapRing));
}
```

In `map-view.tsx`:

- remove the single-ring `project.boundary.map` assumption;
- call `L.polygon(boundaryToLeafletLatLngs(project.boundary), style)`;
- use solid stroke for confirmed and dashed stroke for unmatched;
- preserve nested holes and MultiPolygon parts;
- bind one popup to the complete layer;
- leave unavailable projects as point markers only and never draw replacement circles.

- [ ] **Step 3: Expand popup safely**

Rows: name, type, stage, implementer, planned households, area, designation date, address/location, boundary status, source, source updated date, and `법적 효력 없는 참고자료`.

Use a total label map for all five `MaintenanceSource` values. Escape external strings and retain `rel=\"noopener noreferrer\"`.

- [ ] **Step 4: Expand summary and catalog fallback**

```ts
export interface MaintenanceSummary {
  readonly count: number;
  readonly totalAreaSqm: number;
  readonly totalPlannedHouseholds: number;
  readonly boundaryConfirmedCount: number;
  readonly boundaryUnmatchedCount: number;
  readonly boundaryUnavailableCount: number;
  readonly typeCounts: Readonly<Record<string, number>>;
  readonly stageCounts: Readonly<Record<MaintenanceStage, number>>;
  readonly topProjects: readonly MaintenanceProject[];
}
```

Sidebar:

- tiles: 사업 수, 예정세대수, 총 면적, 공식 경계 수;
- compact type/stage counts;
- each project shows name/type/stage/implementer/households/area/distance/boundary;
- separate `행정구역 수준 목록` renders catalog, says it is excluded from radius metrics, and has no map-focus action;
- show source, 기준일, and `법적 효력 없는 참고자료` once per panel.

- [ ] **Step 5: Verify automated UI models**

```powershell
npx tsx src/scripts/test-maintenance-ui-model.mjs
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Browser-check desktop and mobile**

Run `npm run dev` and use Playwright for one 서울, one 부산, and one non-capital location:

- desktop 1440×1000 and mobile 390×844;
- Polygon, hole, and MultiPolygon;
- one popup for all MultiPolygon parts;
- unmatched/unavailable labels;
- independent statuses and retry;
- catalog rows have no fake marker;
- Network responses and loaded JS contain no service key.

Save screenshots under `qa/artifacts/maintenance/` with location and viewport in filenames.

- [ ] **Step 7: Commit**

```powershell
git add -- src/lib/maintenance-map-utils.ts src/components/map-view.tsx src/lib/maintenance-analysis.ts src/components/sidebar.tsx src/lib/map-marker-utils.ts src/scripts/test-maintenance-ui-model.mjs package.json qa/artifacts/maintenance
git commit -m \"feat: 정비사업 공식 경계와 상세 화면 표시\"
```

---

## Task 8: Analysis, Facts, PPT, and Canvas Parity

**Files:**
- Modify: `src/lib/analysis-engine.ts`
- Modify: `src/lib/fact-summary.ts`
- Create: `src/lib/maintenance-presentation.ts`
- Modify: `src/lib/ppt-generator.ts`
- Modify: `src/lib/ppt-canvas-renderer.ts`
- Modify: `src/lib/source-status-text.ts`
- Test: `src/scripts/test-fact-summary.mjs`
- Test: `src/scripts/test-maintenance-presentation.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing aggregation and presentation tests**

Extend fact tests for all boundary states and total households.

```js
import assert from \"node:assert/strict\";
import { buildMaintenancePresentationRows } from \"../lib/maintenance-presentation.ts\";

const [row] = buildMaintenancePresentationRows([project], 6);
assert.deepEqual(Object.keys(row), [
  \"name\", \"typeStage\", \"implementer\", \"households\",
  \"areaDistance\", \"boundary\", \"sourceDate\",
]);
assert.match(row.typeStage, /재개발/);
assert.match(row.implementer, /조합/);
assert.match(row.households, /1,234/);
assert.match(row.boundary, /공식 경계 확인/);
assert.match(row.sourceDate, /국토부/);
```

Also assert all four source-status labels render independently.

- [ ] **Step 2: Preserve scoring while improving explanations**

In `analysis-engine.ts`:

- do not change the numeric maintenance score formula or stage weights;
- replace binary “미확인” prose with confirmed/unmatched/unavailable counts;
- mention total planned households when present;
- state that admin catalog is excluded from radius scoring.

Use the same expanded summary in `fact-summary.ts`.

- [ ] **Step 3: Create one shared presentation row**

```ts
export interface MaintenancePresentationRow {
  readonly name: string;
  readonly typeStage: string;
  readonly implementer: string;
  readonly households: string;
  readonly areaDistance: string;
  readonly boundary: string;
  readonly sourceDate: string;
}
```

Sort by distance, then confirmed first at equal distance, then name. Limit to six rows.

- [ ] **Step 4: Update both renderers from shared rows**

Both renderers use:

```text
구역명 | 유형·단계 | 시행자 | 예정세대수 | 면적·거리 | 경계 | 출처·기준일
```

Also:

- cards: count, households, total area, confirmed boundaries;
- legend: `정비사업 공식 경계(참고용)`;
- source slide: integrated, standard, SHP, 서울, 부산 separately;
- footer: `법적 효력 없는 참고자료`;
- no synthetic boundary geometry.

- [ ] **Step 5: Verify and commit**

```powershell
npx tsx src/scripts/test-fact-summary.mjs
npx tsx src/scripts/test-maintenance-presentation.mjs
npm run lint
npm run build
git add -- src/lib/analysis-engine.ts src/lib/fact-summary.ts src/lib/maintenance-presentation.ts src/lib/ppt-generator.ts src/lib/ppt-canvas-renderer.ts src/lib/source-status-text.ts src/scripts/test-fact-summary.mjs src/scripts/test-maintenance-presentation.mjs package.json qa/artifacts/maintenance
git commit -m \"feat: 정비사업 분석과 PPT 출처 정보 확장\"
```

Expected: PASS. Inspect both canvas preview and exported PPT maintenance/source slides and save evidence under `qa/artifacts/maintenance/`.

---

## Task 9: Full Regression, Real-Source QA, and Release Gate

**Files:**
- Modify: `package.json`
- Modify: `docs/maintenance-data-operations.md`
- Create: `qa/validate-maintenance-data.mjs`
- Create: `qa/artifacts/maintenance/qa-summary.md`

- [ ] **Step 1: Add a deterministic release validator**

The validator fails unless:

- metadata schema version is 1 and output count is positive;
- input/output/quarantine counts reconcile;
- bbox and every coordinate are finite and inside Korea WGS84 bounds;
- every feature has ID, layer, URL, CRS, retrieval date, and bbox;
- no artifact exists under `public/`;
- raw and processed paths are ignored;
- `git ls-files data/maintenance` is empty;
- client files contain no key value or direct keyed data.go.kr call.

Append `tsx qa/validate-maintenance-data.mjs` to `test:maintenance`.

- [ ] **Step 2: Run all automatic gates**

```powershell
npm run test:maintenance
npm test
npm run lint
npm run build
```

Expected: all PASS. If an unrelated pre-existing dirty test fails, record its exact command/output while still requiring all maintenance tests to pass.

- [ ] **Step 3: Compare three real locations**

Use authorized inputs:

1. 서울: integrated + boundary + 서울 detail priority;
2. 부산: integrated + boundary + 부산 detail priority;
3. non-capital location: NCP-independent polygon search.

For each record in `qa-summary.md`:

- center coordinates and radius;
- four statuses and fetched dates;
- project count and confirmed/unmatched/unavailable counts;
- one official record comparison by name, type, stage, households, area, and boundary shape;
- desktop/mobile/popup/sidebar screenshot filenames;
- PPT preview/export filenames;
- remaining mismatch, or explicit `없음`.

Do not store keys or full licensed geometry.

- [ ] **Step 4: Exercise failure modes and restore local state**

- missing data.go.kr key → attributes failed, boundaries render;
- missing artifact → boundaries failed, admin catalog remains when region resolution succeeds;
- invalid artifact JSON → boundary failure without server crash;
- expired attribute cache + simulated 403 → cached with old `fetchedAt`;
- missing Seoul key → failed with no sample;
- >20% count delta → build blocks replacement until reviewed override.

Record only statuses and timestamps.

- [ ] **Step 5: Verify attribution and secret containment**

```powershell
git ls-files data/maintenance
rg -n \"DATA_GO_KR_API_KEY|serviceKey\" src/components src/app src/lib
git status --short
```

Expected: no tracked artifact, no client-side key access, and no raw/processed data staged.

- [ ] **Step 6: Update verified operating values**

Add only artifact generation date, feature count, bbox, input dataset IDs, and QA date to the operations guide. Authorization correspondence remains outside Git.

- [ ] **Step 7: Commit the release gate**

```powershell
git add -- package.json docs/maintenance-data-operations.md qa/validate-maintenance-data.mjs qa/artifacts/maintenance/qa-summary.md
git commit -m \"test: 전국 정비사업 데이터 릴리스 검증 추가\"
```

---

## Final Verification Checklist

- [ ] `npm run test:maintenance` passes without live network dependence except documented real-source QA.
- [ ] `npm test`, `npm run lint`, and `npm run build` pass.
- [ ] attributes, boundaries, 서울, 부산 statuses are independent.
- [ ] Polygon/MultiPolygon/holes render from GeoJSON `[lng,lat]` without flattening.
- [ ] inside/intersecting/outside distance tests pass.
- [ ] exact-ID and unique exact-name joins pass; ambiguous/fuzzy candidates remain unconfirmed.
- [ ] coordinate-free attributes stay catalog-only and are excluded from radius counts, markers, scoring, and PPT radius tables.
- [ ] map, sidebar, analysis, canvas, and PPT use the same spatial project collection and boundary labels.
- [ ] existing 서울·부산 fields remain visible and no sample fallback exists.
- [ ] no raw ZIP, processed artifact, permission email, or API key is tracked or exposed.
- [ ] three-location desktop/mobile/PPT evidence is present.

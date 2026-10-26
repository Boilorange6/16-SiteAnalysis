# v2 관리 페이지(/v2/admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 원천→타일→실제 다이어그램을 양방향으로 확인하고, 그림 위 핀과 메모로 AI 수정 요청을 쌓아 두었다가 처리 결과를 전·후로 비교하는 `/v2/admin` 페이지를 만든다.

**Architecture:** 서버는 기존 등록부(manifest·`source_release`·`ingest_run`·`TILE_CATALOG`·타일 레지스트리)와 기준 분석의 `tile_result`를 읽어 하나의 overview JSON으로 조립하고, 수정 요청만 app.sqlite 새 표 + SSD PNG로 쓴다. 화면은 클라이언트 페이지가 `authFetch`로 관리자 전용 API를 부르고, 썸네일·큰 그림은 기존 `tileSvgForView`/`tilePng`로 그린다. AI는 `npm run tile-requests`로 대기 요청을 읽고 상태를 바꾼다.

**Tech Stack:** Next.js App Router(basePath `/site`), TypeScript, better-sqlite3, zod, 기존 `src/scripts/v2/test-v2-*.mjs` + tsx 테스트 러너. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-26-v2-admin-design.md` (시안: https://claude.ai/artifact/5Zmxd62EBaNwcjrZKVEUDa 의 C2 판)

## Global Constraints

- 화면 문구는 한국어. 내부 id(source_id, 타일 코드 외 영문 키)는 보조 표기로만. 날짜는 `YYYY-MM-DD HH:mm`(날짜만이면 `YYYY-MM-DD`).
- 지원 폭은 PC·태블릿 가로 최소 1024 px. 모바일·세로 설계·QA 안 함.
- 토큰은 `src/app/v2/guide/guide.module.css`와 같은 값: 배경 `#eef0f3`, 카드 `#fff`, 글자 `#15171c`, 보조 `#676c76`, 선 `#d9dce2`, 강조 `#2f6fdb`, 경고 글자 `#8a4300`/바탕 `#fff1e0`. 글꼴 Noto Sans KR, 제목 Do Hyeon.
- 누름 영역 ≥ 44 px, 색만으로 의미 전달 금지(문구·테두리 모양 병행), 떠 있는 창에만 타이트한 그림자.
- 모든 `/api/v2/admin/*`는 비로그인 401, `users.role !== "admin"` 403. 관리 데이터는 서버 컴포넌트 payload에 싣지 않는다.
- 요청 상태는 정확히 `대기 | 진행 | 완료 | 보류` 네 값. 핀은 최대 9개, 좌표 0~1. 메모 ≤ 2,000자. PNG ≤ 5 MB.
- 원천·타일 목록을 손으로 복제하지 않는다(테스트 픽스처 제외). 새 의존성 추가 금지.
- 새 테스트는 `src/scripts/v2/test-v2-admin-*.mjs`(`node:assert/strict`, 임시 `DB_PATH`·`V2_APP_DB_PATH`·`JWT_SECRET` — `test-v2-analysis-ownership.mjs` 패턴). 매 Task 끝에 `npx tsc --noEmit`과 해당 테스트 PASS.

## Review Focus

1. **기준 분석이 없거나 지워진 경우**(localStorage의 옛 id, 분석 0건): overview는 200으로 `analysis: null`을 돌려주고 타일은 '확인 불가'·썸네일 자리표시로 보인다 — Task 4·7에 테스트.
2. **타일 결과가 pending/no_data/failed**: 썸네일이 빈칸이 아니라 상태 문구(계산 대기·빈 결과·실패)로 보이고, 그림 저장에 실패해도 요청은 그림 없이 저장된다(`image_path NULL`, 화면 '그림 없음') — Task 5·7에 테스트.
3. **잘못된 상태 전이**: 이미 완료된 요청에 `done`, 대기 요청에 '다시 열기' 같은 전이는 거부되고 이유를 알린다 — Task 5·6에 테스트.
4. **잘못된 업로드**: PNG가 아닌 파일, 5 MB 초과, 핀 10개, 좌표 범위 밖, 없는 타일 코드는 400과 한국어 이유 — Task 5에 테스트.
5. **배포본에 `src/`가 없을 때**: 관련 파일 목록은 빈 배열이고 페이지는 정상 — Task 4에 테스트.

---

### Task 1: 카탈로그 `forms`와 원천 선언 바로잡기

**Files:**
- Modify: `src/lib/v2/ui/tile-catalog.ts` (`TileCatalogEntry`, `TILE_CATALOG` 33줄)
- Test: `src/scripts/v2/test-v2-admin-catalog.mjs`

**Interfaces:**
- Produces: `export type TileForm = "vector" | "raster" | "chart" | "3d" | "section" | "aerial"`; `TileCatalogEntry.forms: readonly TileForm[]` (필수, 비어 있지 않음); `export const TILE_FORM_LABELS: Record<TileForm, string>` = `{ vector: "벡터 지도", raster: "래스터", chart: "차트", "3d": "3D", section: "단면", aerial: "항공영상" }`.

- [ ] **Step 1: Write the failing test** — `test-v2-admin-catalog.mjs`:
  - 모든 `TILE_CODES`에 `forms.length >= 1`이고 모든 값이 `TILE_FORM_LABELS` 키.
  - `TILE_CATALOG.D01.forms` deepEqual `["aerial"]`, `D10` deepEqual `["aerial","raster","vector"]`, `D17` deepEqual `["vector","section"]`, `D22` deepEqual `["chart"]`, `S01` deepEqual `["3d"]`; `S02`·`S03`·`S04`·`D29`는 `"raster"` 포함; 나머지 A·D 타일은 `["vector"]`.
  - 원천 선언: `S03.sources`에 `"building"`·`"terrain_tiles"` 포함, `S02.sources`에 `"terrain_tiles"` 포함, `D10.sources`에 `"parcel_polygon"` 없음, `S04.sources`에 `"terrain_tiles"`·`"vworld_wmts"` 포함, `A12.sources`에 `"parcel_polygon"` 포함, `A09.sources`가 `["mzone_zone","mzone_redevelopment","mzone_promotion","mzone_planned","mzone_improvement","maintenance_integrated","maintenance_std"]`(게시 원천 id와 일치; 옛 `"maintenance_zone"` 없음).
- [ ] **Step 2: Run** `npx tsx src/scripts/v2/test-v2-admin-catalog.mjs` — Expected: FAIL (`forms` 없음).
- [ ] **Step 3: Implement** — 위 타입·라벨 추가, 33줄에 `forms` 채우기, 원천 배열 수정. `SOURCE_NAMES`에 `mzone_*` 표시 이름이 없으면 `"정비구역(…)"` 형식으로 추가.
- [ ] **Step 4: Run** 새 테스트 + `npx tsx src/scripts/v2/test-v2-guide.mjs` + `node src/scripts/v2/harness/tile-literals.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(v2): 타일 카탈로그에 형태(forms)를 넣고 원천 선언을 실제 사용과 맞춤`

### Task 2: 원천 운영 정의(수집 방식·갱신 주기·묶음)

**Files:**
- Modify: `src/lib/v2/ui/source-details.ts:46-89` (`SourceDefinition`, `SOURCE_DETAIL_DEFINITIONS`)
- Modify: `src/app/v2/guide/page.tsx:34-40` (갱신 주기를 정의에서도 읽기)
- Test: `src/scripts/v2/test-v2-admin-source-ops.mjs`

**Interfaces:**
- Produces: `export type SourceCollect = "수동 파일" | "수동 API 배치" | "기존 앱 적재본" | "수동 정리" | "실시간" | "사용자 업로드" | "앱 계산"`; `SourceDefinition`에 `collect: SourceCollect`, `cycle: string`, `group?: string` 추가; `export function sourceOps(sourceId: string): { collect: SourceCollect | null; cycle: string | null; group: string | null }`.

정의할 값(스펙의 수집 조사 결과, 게시본 57 + 실행 시 4):

| source_id | collect | cycle | group |
|---|---|---|---|
| legal_areas | 수동 파일 | 수시 | — |
| parcel, parcel_polygon | 수동 파일 | 월간 | 연속지적도형정보 |
| ledger_recap, ledger_title, ledger_exclusive_area | 수동 파일 | 월간 | 건축물대장 3종 |
| kapt | 수동 파일 | 수시 | — |
| school, school_zone_link, school_zone_elem | 수동 파일 | 반기 | 학교·학구도 4종 |
| school_zone | 수동 API 배치 | 반기 | 학교·학구도 4종 |
| osm_subway | 수동 API 배치 | 수시 | — |
| planned_rail | 수동 정리 | 수시 | — |
| store | 수동 파일 | 분기 | — |
| bus_stop, park, sgis_grid | 수동 파일 | 연간 | — |
| osm_roads, osm_landuse, osm_water | 수동 파일 | 일별 | OSM(Geofabrik) |
| zoning_urban, zoning_management, zoning_agri_forest, zoning_nature, zoning_other | 수동 파일 | 일별 | 용도지역 5종 |
| land_price | 수동 파일 | 연 1회 | — |
| mzone_zone, mzone_redevelopment, mzone_promotion, mzone_planned, mzone_improvement | 수동 파일 | 일별 | 정비구역 5종 |
| district_area, district_greenbelt, district_land_development, district_urban_development, district_industrial | 수동 파일 | 일별 | 구역·지구 5종 |
| facility_transport, facility_space, facility_distribution_supply, facility_public_culture_sports, facility_disaster_prevention, facility_health_hygiene, facility_environmental_basic, facility_other_infrastructure | 수동 파일 | 일별 | 도시계획시설 8종 |
| applyhome | 기존 앱 적재본 | 일 | 청약·입주예정 |
| applyhome_types | 수동 파일 | 수시 | 청약·입주예정 |
| move_in | 수동 파일 | 반기 | 청약·입주예정 |
| maintenance_integrated | 수동 파일 | 연 1회 | 정비사업 명부 |
| maintenance_std | 수동 파일 | 수시 | 정비사업 명부 |
| rtms_apt_trade, rtms_apt_rent | 수동 API 배치 | 수시 신고 | RTMS 아파트 |
| rtms_offi_trade, rtms_offi_rent | 수동 API 배치 | 수시 신고 | RTMS 오피스텔 |
| building, gis_bldg | 수동 파일 | 수시 | — |
| building_juso | 수동 파일 | 월간 | — |
| terrain_tiles | 수동 파일 | 갱신 없음 | — |
| asos | 수동 API 배치 | 시간(10년 집계) | — |
| vworld_wmts | 실시간 | — | — |
| ngii_topo | 사용자 업로드 | 분석별 | — |
| browser_lbm, fallback_d2q9 | 앱 계산 | — | — |

- [ ] **Step 1: Write the failing test** — 위 표의 모든 source_id에 대해 `sourceOps(id).collect`·`cycle`이 표 값과 같음(루프 단언); `sourceOps("zoning_urban").group === "용도지역 5종"`; `sourceOps("없는id")`는 세 값 모두 `null`; 기존 `role`·`usedFor` 값이 바뀌지 않음(`SOURCE_DETAIL_DEFINITIONS.building_juso.role === "보강"`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** 정의 추가와 `sourceOps`. 가이드 페이지의 갱신 주기는 rights 키가 없으면 `sourceOps(id).cycle`을 쓴다.
- [ ] **Step 4: Run** 새 테스트 + `test-v2-guide.mjs` + `test-v2-source-details.mjs` + `test-v2-sources-api.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(v2): 원천별 수집 방식·갱신 주기·묶음 정의`

### Task 3: 관리자 권한과 역할 지정 스크립트

**Files:**
- Modify: `src/lib/server/auth.ts` (`requireAdmin` 추가)
- Create: `src/scripts/v2/set-user-role.mjs`
- Modify: `package.json` (`"set-user-role": "tsx src/scripts/v2/set-user-role.mjs"`)
- Test: `src/scripts/v2/test-v2-admin-auth.mjs`

**Interfaces:**
- Produces: `export async function requireAdmin(req: NextRequest): Promise<User | NextResponse>` — `requireAuth` 결과가 응답이면 그대로, `user.role !== "admin"`이면 `NextResponse.json({ error: "관리자 권한이 필요합니다" }, { status: 403 })`. `export function setUserRole(username: string, role: "user" | "admin"): boolean` (legacy DB, 없는 사용자면 false) — `src/lib/server/user-store.ts`에 추가하고 스크립트는 이를 호출해 결과를 한국어로 출력, 잘못된 인자는 종료 코드 1.

- [ ] **Step 1: Write the failing test** — `createUser("admin1","password","admin")`, `createUser("user1","password")`. 토큰 없는 요청 → `requireAdmin` 결과 status 401, user1 → 403·본문 error `"관리자 권한이 필요합니다"`, admin1 → `isUser` true. `setUserRole("user1","admin") === true` 뒤 user1 → 통과. `setUserRole("없음","admin") === false`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(v2): 관리자 권한 검사와 역할 지정 스크립트`

### Task 4: overview 조립과 `GET /api/v2/admin/overview`

**Files:**
- Create: `src/lib/v2/admin/provenance-check.ts` (순수)
- Create: `src/lib/v2/admin/overview.ts` (서버 전용)
- Create: `src/app/api/v2/admin/overview/route.ts`
- Test: `src/scripts/v2/test-v2-admin-overview.mjs` (원천 픽스처는 `test-v2-sources-api.mjs`와 같은 방식으로 임시 data dir에 manifest + `source_release`·`ingest_run` 표를 만든다)

**Interfaces:**
- Consumes: Task 1 `forms`, Task 2 `sourceOps`, Task 3 `requireAdmin`; 기존 `readGuideSourceSnapshot` (`ui/guide-sources.ts`), `readManifest`·`openDataFile` (`data/manifest.ts`), `HEAVY_TILES`·`DATE_INDEPENDENT`·`SITE_DEPENDENT_TILE_CODES` (`tile/server.ts:79-83`), `CUT_CODES` (`tile/client.ts:36`), `DETAIL_CODES` (`ui/detail-state.ts`), `TILE_CODE_RENAMES` (`ui/board-state.ts:121`), `cacheEngineVersion` (`engine/tiles/common.ts`), 보고서 훅 코드 목록(`tile/report.ts`).
- Produces:
  - `export type SourceCheck = { status: "ok" | "mismatch" | "unknown"; missingFromCatalog: string[]; unusedInCatalog: string[] }`
  - `export const CONDITIONAL_SOURCE_IDS: ReadonlySet<string>` = `ngii_topo, gis_bldg, building_juso, browser_lbm, fallback_d2q9` (조건부라 '쓰지 않는데 선언'으로 세지 않음)
  - `export function compareTileSources(declared: readonly string[], actual: readonly string[] | null): SourceCheck` (`actual === null` → `unknown`)
  - `export function ageDays(asOf: string | null, today: string): number | null` — `YYYY`는 그해 12-31, `YYYY-MM`은 그달 말일, `YYYY-MM-DD`는 그날 기준; 해석 불가·null은 null.
  - `export type AdminSource = { sourceId; name; provider; url; asOf: string | null; fetchedAt: string | null; ageDays: number | null; license: string; group: string | null; collect: SourceCollect | null; cycle: string | null; expected: number | null; accepted: number | null; rejected: number | null; fileKey: string | null; runtime: boolean; usedBy: string[] }`
  - `export type AdminTile = { code; title; kind: TileKind; forms: TileForm[]; declaredSources: string[]; actualSources: string[] | null; check: SourceCheck; resultStatus: (typeof TILE_STATUSES)[number] | null; heavy: boolean; dateIndependent: boolean; siteDependent: boolean; cut: boolean; detail: boolean; reportHook: boolean; absorbs: string[]; cacheVersion: string; files: string[]; orphan: boolean }`
  - `export type AdminOverview = { generatedAt: string; manifest: { version: string | null; createdAt: string | null; files: Array<{ key: string; path: string }> }; analysis: { id: string; address: string; radiusM: number; analysisDate: string } | null; sources: AdminSource[]; tiles: AdminTile[] }`
  - `export function buildAdminOverview(input: { appDb: Db; dataDir: string; analysisId: string | null; userId: string | number; today?: string; repoRoot?: string }): AdminOverview` — `analysisId`가 없거나 못 찾으면 해당 사용자의 가장 최근 `status='complete'` 분석, 그것도 없으면 `analysis: null`·모든 `actualSources: null`. 실행 시 원천 4개는 `runtime: true` 행으로 붙인다. `files`는 `repoRoot/src/lib/v2/tile/<code 소문자>/`의 파일명 목록(없으면 `[]`). `orphan`은 선언·실제 원천이 모두 비었을 때 true.
  - 라우트: `GET /api/v2/admin/overview?analysis=<id>` → `requireAdmin` → `buildAdminOverview` → 200 JSON.

- [ ] **Step 1: Write the failing tests**
  - `compareTileSources(["building","terrain_tiles"], ["building"])` → `{status:"mismatch", missingFromCatalog:[], unusedInCatalog:["terrain_tiles"]}`; `(["asos"], ["asos","building"])` → missing `["building"]`; `(["building","ngii_topo"], ["building"])` → `ok`; `(["x"], null)` → `unknown`.
  - `ageDays("2026-09-08","2026-10-26") === 48`, `ageDays("2024","2026-10-26") === 664`, `ageDays("2026-06","2026-10-26") === 118`, `ageDays(null, …) === null`, `ageDays("기준일 없음", …) === null`.
  - overview(픽스처 + 임시 app DB): `tiles.length === TILE_CODES.length`, 모든 코드 포함, `tiles.every(t => !t.orphan)`, 픽스처 원천의 `ageDays`·`accepted`·`collect` 값, `sources`에 `vworld_wmts`·`ngii_topo`·`browser_lbm`·`fallback_d2q9`가 `runtime:true`, 분석 0건이면 `analysis === null`이고 모든 `check.status === "unknown"`, `repoRoot`를 빈 임시 폴더로 주면 모든 `files` 빈 배열.
  - 라우트: 비로그인 401, 일반 403, 관리자 200이고 본문에 `tiles`가 있음; 없는 `analysis` id → 200·`analysis:null`이 아니라 최근 분석으로 대체(테스트에 완료 분석 1건 생성 후 확인).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** 두 모듈과 라우트. `ingest_run`은 파일마다 `release_id`별 최신 행(`ORDER BY rowid DESC`)을 읽기 전용으로.
- [ ] **Step 4: 실데이터 확인** — `V2_DATA_DIR`·`V2_APP_DB_PATH` 기본값(실제 SSD)으로 `buildAdminOverview`를 한 번 실행하는 일회성 tsx 호출로 `check.status==="mismatch"` 타일 목록을 출력. Task 1에서 고친 5건 외 불일치가 나오면 카탈로그를 고치고 Task 1 테스트에 단언을 추가한다. 결과 목록을 커밋 메시지 본문에 적는다.
- [ ] **Step 5: Run** 새 테스트 전부 — Expected: PASS.
- [ ] **Step 6: Commit** `feat(v2): 관리 overview 조립과 관리자 전용 API`

### Task 5: 수정 요청 저장소와 API

**Files:**
- Modify: `src/lib/v2/app-db.ts` (`initV2AppSchema`에 `tile_request` 표 — 스펙 §5-1 그대로, `CREATE TABLE IF NOT EXISTS`, schema_version은 올리지 않음)
- Modify: `src/lib/v2/paths.ts` (`export function v2RequestsDir(): string` = `process.env.V2_REQUESTS_DIR || resolve(dirname(v2DataDir()), "requests")`)
- Create: `src/lib/v2/admin/requests.ts`
- Create: `src/app/api/v2/admin/requests/route.ts` (GET 목록, POST 생성)
- Create: `src/app/api/v2/admin/requests/[id]/route.ts` (PATCH 다시 열기)
- Create: `src/app/api/v2/admin/requests/[id]/image/route.ts` (GET PNG)
- Test: `src/scripts/v2/test-v2-admin-requests.mjs`

**Interfaces:**
- Produces:
  - `export const REQUEST_STATUSES = ["대기","진행","완료","보류"] as const; export type RequestStatus = typeof REQUEST_STATUSES[number]`
  - `export type TileRequestPin = { x: number; y: number }`
  - `export type TileRequest = { id: number; tileCode: string; analysisId: string | null; memo: string; pins: TileRequestPin[]; context: Record<string, unknown>; imagePath: string | null; status: RequestStatus; createdAt: string; updatedAt: string; resolvedCommit: string | null; resolvedNote: string | null; resolvedAt: string | null; reopenNote: string | null; userId: string | null }`
  - `export function validateRequestInput(input: { tileCode: string; memo: string; pins: unknown }): { ok: true; pins: TileRequestPin[] } | { ok: false; error: string }` — 오류 문구: 없는 코드 `"없는 타일 코드입니다"`, 메모 2,000자 초과 `"메모는 2,000자까지 쓸 수 있습니다"`, 메모·핀 둘 다 비면 `"메모나 핀 중 하나는 있어야 합니다"`, 핀 10개 이상 `"핀은 9개까지 찍을 수 있습니다"`, 좌표 범위 밖 `"핀 위치가 그림 밖입니다"`.
  - `export function createTileRequest(db, input: { tileCode; analysisId: string | null; memo; pins: TileRequestPin[]; context: Record<string, unknown>; png: Uint8Array | null; userId: string | number }): TileRequest` — PNG는 `v2RequestsDir()/<id>.png`로 저장 후 `image_path` 갱신.
  - `export function listTileRequests(db, filter?: { status?: RequestStatus; tileCode?: string }): TileRequest[]` (최신순)
  - `export function getTileRequest(db, id: number): TileRequest | null`
  - `export function transitionTileRequest(db, id: number, to: RequestStatus, patch?: { commit?: string; note?: string }): { ok: true; request: TileRequest } | { ok: false; error: string }` — 허용 전이: `대기→진행|완료|보류`, `진행→완료|보류|대기`, `완료→대기`, `보류→대기`. `→완료`는 `commit` 필수. `→대기`(다시 열기)는 `note`를 `reopen_note`에 줄바꿈으로 누적하고 `resolved_*`를 비운다. 거부 문구: `"<현재>에서 <목표>(으)로 바꿀 수 없습니다"`, 커밋 없음 `"완료로 바꾸려면 커밋 번호가 필요합니다"`.
  - `export function isPng(bytes: Uint8Array): boolean` (시그니처 `89 50 4E 47 0D 0A 1A 0A`)
  - POST(multipart: `tileCode`, `analysisId`, `memo`, `pins`(JSON), `context`(JSON), `image`(선택 PNG)) → 201 `{ request }`; 400 `{ error }`. PATCH body `{ action: "reopen", note?: string }` → 200/400. 이미지 GET은 `image/png`, 없으면 404.

- [ ] **Step 1: Write the failing tests** — 검증 문구 5종(위 값 그대로); PNG 아닌 바이트·5 MB+1 바이트 업로드 → 400 `"PNG 그림만 올릴 수 있습니다"`/`"그림은 5 MB까지입니다"`; 정상 생성 → 201, 파일이 `V2_REQUESTS_DIR`(임시)에 생김, `status === "대기"`; 그림 없이 생성 → `imagePath === null`; 전이: `대기→완료`(commit 없음) 거부, `대기→완료`(commit "ac61390") 성공, `완료→완료` 거부, `완료→대기`(note "1번이 아직 겹침") 성공·`reopenNote` 포함·`resolvedCommit === null`, `대기→대기` 거부; 라우트 401/403/201/200; 이미지 GET 200 `content-type: image/png`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** 새 테스트 + `test-v2-analysis-ownership.mjs`(schema_version "3" 유지 확인) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(v2): 타일 수정 요청 저장소와 관리자 API`

### Task 6: AI용 `tile-requests` 명령

**Files:**
- Create: `src/lib/v2/admin/requests-cli.ts`
- Create: `src/scripts/v2/tile-requests.mjs` (얇은 진입점: app DB 열기 → `runTileRequestsCli(process.argv.slice(2), db)` 출력·종료 코드)
- Modify: `package.json` (`"tile-requests": "tsx src/scripts/v2/tile-requests.mjs"`)
- Test: `src/scripts/v2/test-v2-admin-requests-cli.mjs`

**Interfaces:**
- Consumes: Task 5 store 함수.
- Produces: `export function runTileRequestsCli(argv: string[], db: Db): { code: 0 | 1; out: string }` — 명령: `list [--status 대기|진행|완료|보류]`(기본 대기), `show <id>`, `start <id>`, `done <id> --commit <sha> --note "<문구>"`, `hold <id> --note "<문구>"`. `list` 한 건 출력 형식(고정):

```
#12 [대기] D17 지형·등고선 · 2026-10-26 15:10
  메모: 단면 그래프 아래 단차표 글자가 작다
  핀: 1(0.58, 0.42)
  그림: C:\SiteAnalysisData\v2\requests\12.png
  파일: src/lib/v2/tile/d17/engine.ts, view.ts, Panel.tsx
  다시 열기: (있을 때만)
```

  잘못된 명령·없는 id·거부된 전이는 `code: 1`과 한국어 이유.

- [ ] **Step 1: Write the failing test** — 요청 2건 생성 후 `list` 출력에 `#1 [대기]`·`메모:`·`그림:` 포함; `done 1`(commit 없음) → code 1·`"커밋 번호가 필요합니다"` 포함; `done 1 --commit abc1234 --note "글자 키움"` → code 0, 이후 `list --status 완료`에 `#1 [완료]`; `hold 2 --note "서버 계산 경로 필요"` → `보류`; `show 99` → code 1·`"없는 요청"` 포함; 알 수 없는 명령 → code 1·사용법 출력.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS. 추가로 `npm run tile-requests -- list`를 실제 app DB에 실행해 `대기 요청이 없습니다`가 나오는지 확인.
- [ ] **Step 5: Commit** `feat(v2): AI가 대기 수정 요청을 읽고 처리하는 tile-requests 명령`

### Task 7: 관리 화면 — 원천 목록·썸네일 격자·양방향 강조

**Files:**
- Create: `src/lib/v2/admin/admin-view.ts` (순수 화면 로직)
- Create: `src/app/v2/admin/page.tsx` (`"use client"`), `src/app/v2/admin/admin.module.css`
- Create: `src/components/v2/admin/source-list.tsx`, `src/components/v2/admin/tile-grid.tsx`
- Test: `src/scripts/v2/test-v2-admin-view.mjs`

**Interfaces:**
- Consumes: Task 4 `AdminOverview` 타입·overview API; 기존 `GET /api/v2/analyses/<id>`(결과 목록), `toTileView` (`ui/tile-view.ts:357`), `tileSvgForView` (`export/tile-image.ts:251`), `authFetch` (`src/lib/auth-fetch.ts`), `useAuth` (`src/providers/auth-provider.tsx`).
- Produces (admin-view.ts):
  - `export type SourceRow = { key: string; label: string; sourceIds: string[]; asOf: string | null; ageDays: number | null; license: string; warn: "stale" | "missing" | null; tileCodes: string[] }` — 같은 `group`은 한 줄로 묶음(대표 기준일은 가장 오래된 값).
  - `export function groupSources(sources: AdminSource[]): SourceRow[]`
  - `export const STALE_DAYS = 180`
  - `export type TileFilter = "all" | "analysis" | "diagram" | "simulation" | "mismatch" | "pending" | "requests"`
  - `export function filterTiles(tiles: AdminTile[], filter: TileFilter, pendingByTile: Record<string, number>): AdminTile[]` — `pending`은 `resultStatus`가 `pending|running|no_data|failed|null`.
  - `export function sourceLinkForTile(row: SourceRow, tile: AdminTile): "used" | "missingFromCatalog" | "unusedInCatalog" | "none"`
  - `export function tilesForSource(row: SourceRow, tiles: AdminTile[]): Set<string>`

화면 동작(스펙 §7, 시안 C2): 상단 요약·기준 분석 줄(`[기준 분석 바꾸기]` = 관리자 저장 프로젝트 목록에서 고르기, 고른 id는 localStorage `v2-admin-analysis`)·거르기 칩; 왼쪽 원천 줄(누르면 그 원천을 쓰는 타일만 선명·파란 테두리, 나머지 `opacity 0.32`); 오른쪽 5열 썸네일(4:3, `tileSvgForView(view, { width: 800, height: 600, withFrame: false, layer: "white" })`를 `<img>`로, 화면에 들어온 칸부터 그림; 결과가 pending/no_data/failed면 상태 문구 판; S01은 "3D는 보드에서 확인" 자리표시). 타일을 고르면 왼쪽 원천에 '사용'(파랑)·'선언 누락'·'쓰지 않는데 선언'(주황 점선) 표시, 나머지 흐림.

- [ ] **Step 1: Write the failing test** — `groupSources`: zoning 5개 → 한 줄 `"용도지역 5종"`, `sourceIds.length === 5`; `ageDays 321` → `warn:"stale"`, `asOf null` → `"missing"`; `filterTiles(...,"mismatch")`는 `check.status==="mismatch"`만; `"requests"`는 `pendingByTile[code] > 0`만; `sourceLinkForTile`: 실제·선언 모두 → `used`, 실제에만 → `missingFromCatalog`, 선언에만 → `unusedInCatalog`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** 로직과 화면. 403이면 "관리자 권한이 필요합니다" 카드, overview 실패면 재시도 버튼이 있는 카드.
- [ ] **Step 4: Run** 테스트 + `npx tsc --noEmit` + `test-v2-client-imports.mjs` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(v2): 관리 화면 원천 목록·다이어그램 격자·양방향 강조`

### Task 8: 상세 서랍·핀·요청·전후 비교·다시 열기·진입 링크

**Files:**
- Create: `src/components/v2/admin/tile-drawer.tsx`, `src/components/v2/admin/compare-dialog.tsx`
- Modify: `src/lib/v2/admin/admin-view.ts` (핀 계산)
- Modify: `src/app/v2/admin/page.tsx`
- Modify: `src/app/v2/page.tsx` (관리자에게만 머리 줄에 '관리' 링크 `/site/v2/admin`)
- Test: `src/scripts/v2/test-v2-admin-view.mjs`에 추가

**Interfaces:**
- Consumes: Task 5 API·`TileRequest`, Task 7 화면.
- Produces: `export function pinFromClick(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): TileRequestPin | null` (그림 밖이면 null, 소수 3자리 반올림); `export function requestContext(tile: AdminTile, overview: AdminOverview): Record<string, unknown>` (형태·선언/실제 원천·불일치·관련 파일·캐시 버전·기준 분석).

화면 동작(스펙 §5-4): 서랍은 오른쪽 위에 떠서 덮음(그리드를 밀지 않음), 큰 그림 = `tileSvgForView(view, { width: 1600, height: 1200, withFrame: true, layer: "white" })`; 그림 클릭 → 번호 핀(최대 9, `[핀 지우기]`); `[요청 추가]` → `tilePng(view, { width: 1600, height: 1200, withFrame: true, scale: 1, layer: "white" })`로 그림 생성 후 POST(그림 생성 실패 시 그림 없이 POST하고 '그림 없음' 안내); '이 타일의 요청' 목록(대기 파랑 / 완료 초록 처리 메모·커밋·처리일 + `[전·후 비교]` `[다시 열기]` / 보류 회색 보류 이유 + `[다시 열기]`); 전·후 비교 창(왼쪽 요청 당시 PNG + 핀, 오른쪽 지금 그림, 처리 메모·커밋, `[다시 열기]` `[확인했어요]`, 당시 그림 없으면 "요청 당시 그림이 없습니다"); 다시 열기 = '아직 아쉬운 점(선택)' → PATCH reopen. Esc는 가장 위 창부터 닫고 포커스를 연 버튼으로 돌린다.

- [ ] **Step 1: Write the failing test** — `pinFromClick({left:100,top:50,width:400,height:300}, 300, 200)` → `{x:0.5, y:0.5}`; 그림 밖(`90, 40`) → null; `requestContext`에 `declaredSources`·`actualSources`·`check`·`files`·`cacheVersion`·`analysisId` 키.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** 테스트 + `npx tsc --noEmit` + `npm run test:v2` 전체 — Expected: PASS(기존 206 + 새 테스트).
- [ ] **Step 5: Commit** `feat(v2): 관리 화면 상세 서랍·수정 요청·전후 비교·다시 열기`

### Task 9: 실렌더 QA·한 바퀴 검증·문서

**Files:**
- Modify: `docs/design/v2-design-language.md` (결정 이력에 관리 페이지 행: 레이아웃·색·요청 흐름)
- Modify: `docs/superpowers/specs/2026-10-26-v2-admin-design.md` (구현과 달라진 점이 있으면 반영)

- [ ] **Step 1:** dev 서버에서 `npm run set-user-role -- <사용자> admin` 후 관리자 계정으로 `/site/v2/admin`을 1440·1280·1024에서 캡처하고 `node C:\Users\da\.claude\skills\my-design-taste\measure\measure.mjs <url> --widths 1280,1440 --content "[data-admin-grid]"` 실행 — Expected: `RESULT: PASS`(가로 스크롤 0, 누름 영역, 글자 잘림 없음). 1024는 캡처를 눈으로 확인.
- [ ] **Step 2:** 한 바퀴: 타일 하나에 핀 2개+메모로 요청 추가 → `npm run tile-requests -- list`에 그림 경로가 나오고 PNG를 열어 핀 위치가 화면과 같은지 확인 → `done <id> --commit <sha> --note "..."` → 화면에서 완료·전·후 비교 확인 → 다시 열기 → `list`에 `다시 열기:` 줄.
- [ ] **Step 3:** 일반 사용자로 접속해 403 카드, 메인 화면에 '관리' 링크 없음 확인.
- [ ] **Step 4:** 문서 갱신 후 커밋 `docs(v2): 관리 페이지 디자인 결정과 구현 차이 기록`.

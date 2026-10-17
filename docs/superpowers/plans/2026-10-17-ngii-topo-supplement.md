# 연속수치지형도 추가 자료 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 분석마다 선택적으로 올린 국토지리정보원 연속수치지형도 zip을 영역별 주 원천·보강 자료로 써서 지형·단차·도로 폭원을 정밀화하고 건물·수계를 보강한다. 올리지 않으면 지금과 같다.

**Architecture:**
- **업로드:** 브라우저가 zip에서 필요한 레이어만 골라 다시 묶어 `POST /api/v2/topo`로 보낸다. 서버는 이를 분석 전용 SQLite(`feature` 표 + R*Tree, 5 m DEM 격자)로 만들어 `topoId`를 돌려준다.
- **분석:** 분석 요청은 `topoId`를 함께 보낸다. `parameters_json`에 저장해 job worker와 refresh에서도 같은 자료를 연다. `EngineContext.topo`가 영역별 공급점(`demReader`, 도로, 건물, 수계)에 끼어든다.
- **캐시:** 캐시 키는 `cacheKeyForConditions`에서 영향 타일에만 topo 해시를 섞는다.

**Tech Stack:**
- Next.js 15 route handlers (nodejs runtime), better-sqlite3, `shapefile@0.6.6`, `jszip@3.10.1`, `proj4`, `@turf/turf@7.3.5`, zod v4
- 테스트: `node:assert/strict` + `npx tsx` (`src/scripts/v2/test-v2-*.mjs`)

**Spec:** `docs/design/v2-design-language.md` §9-4 (2026-10-17 승인), 시안 https://claude.ai/artifact/XexTFpeu8vkHGg74rE7MNN

## Global Constraints

- **새 npm 의존성 금지.** 설치 명령(`npm install`/`npm ci`) 금지. 의존성이 없어 보이면 BLOCKED로 보고한다.
- **zip이 없으면 결과가 그대로여야 한다.** topo 없는 분석의 33타일 결과, 캐시 키, 장면은 바이트 단위로 변하지 않아야 한다. 기존 golden/equivalence harness(`docs/v2/tile-agent-brief.md`)가 그대로 통과해야 한다.
- **분석 전용 자료다.** zip은 그 분석(과 같은 사용자)에만 쓴다. 공용 manifest·data version에 넣지 않는다.
- **영역별 배분(§9-4 표 그대로):**

  | 영역 | 주 원천 | 보강 |
  |---|---|---|
  | 지형 D17·D18 → D29·S01–S04 | 수치지형도 등고선·표고점 | GLO-30 (범위 밖) |
  | 단차 | 수치지형도 | — |
  | 도로 D13·D15 | 수치지형도 중심선 | OSM (범위 밖) |
  | 보행망 A01·A04·D28 | OSM (변경 없음) | — |
  | 건물 D02–D05·D16 | GIS건물통합 | 수치지형도 (빠진 도형·층수만) |
  | 녹지·수계 D10 | 기존 OSM | 수치지형도 하천·호소 |
  | 항공·수관·배경 | VWorld (변경 없음) | — |

- **범위 밖 처리:** 반경이 zip 범위를 넘어도 막지 않는다. 범위 밖은 기존 자료로 채운다. 범위 표시는 파란 점선 `#2350b8`, dash `10 6`, 범례 `수치지형도 범위 · 밖은 기존 자료`다.
- **출처 역할 칩:** 코드 용어 `주 원천` / `보강`을 쓴다(`src/lib/v2/ui/source-details.ts:5`). 업로드 패널만 `새로 추가` 칩을 추가로 쓴다.
- **문구:**
  - 도로 폭원은 "참고"이고 접도 판정이 아니다.
  - 등고선 보간 지형은 "추정"이다.
  - 기준일은 `기준일 미확인`이다(파일 이름 날짜 사용 금지).
  - 사용자 화면에 원천 파일명(`N3L_F0010000` 등)을 노출하지 않는다(§1).
- **UI 공통:** 44 px 히트영역, 보이는 포커스 링, 호버 전용 금지. 등고선 색은 `#8a5a2e`다. UI 작업 전에 `ui-ux-pro-max` 스킬을 읽는다.
- **편집 방식:** 기존 파일은 Edit로 수정한다. 셸 read→replace→write 치환은 금지한다.
- **검증:** 매 Task 끝에 `npm run lint`(tsc)와 새/관련 테스트를 통과시킨다. 마지막에 `npm run test:v2` 전체를 통과시킨다.

## Review Focus

1. **엉뚱한 지역 zip:** 대지·반경과 전혀 겹치지 않는 zip으로 분석하면 422 `topo_outside`와 "이 대지 둘레의 자료가 아닙니다…" 문구가 나와야 한다. 조용히 무시하면 안 된다. → Task 3 테스트.
2. **다른 좌표계 zip:** 중부원점(5186)은 정상 처리한다. 서부·동부·동해(5185/5187/5188)나 `.prj` 누락은 400 `topo_crs`로 끝나야 한다. 서버 예외가 나면 안 된다. → Task 1 테스트.
3. **같은 파일 재업로드:** 같은 사용자가 같은 zip을 다시 올리면 같은 `topoId`를 돌려준다. 디스크에 중복으로 만들지 않는다. → Task 2 테스트.
4. **job worker·refresh 재계산:** 무거운 타일(S02·D29·S03·S04)과 "최신 엔진으로 갱신"도 같은 topo로 계산해야 한다. → Task 3 테스트.
5. **악성·과대 zip과 남의 zip:**
   - 64 MB 초과, 전개 256 MB 초과, 항목 400개 초과, 경로가 든 항목 이름은 413/400으로 거절한다.
   - 남의 `topoId`로 분석하면 404를 돌려준다. → Task 2·3 테스트.

---

### Task 1: topo 자료 빌더 (zip → 분석 전용 SQLite + 5 m DEM)

**Files:**
- Create: `src/lib/v2/topo/layers.ts`, `src/lib/v2/topo/dem.ts`, `src/lib/v2/topo/build.ts`
- Modify: `src/lib/v2/a0/shapefile.d.ts` (필요 시 buffer 시그니처만 확장)
- Modify: `src/lib/v2/ingest/shp.ts` (5185/5187/5188 거부 메시지만, 기존 동작은 유지)
- Test: `src/scripts/v2/test-v2-topo-dem.mjs`, `src/scripts/v2/test-v2-topo-build.mjs`

**Interfaces:**
- Produces:
  - `TOPO_LAYERS: Record<string, { kind: TopoKind; geometry: "line"|"point"|"polygon" }>`
    - 키는 레이어 기본 이름이다: `N3L_F0010000` contour, `N3P_F0020000` spot_height, `N3L_A0020000` road_centerline, `N3A_A0010000` road_surface, `N3A_B0010000` building, `N3L_F0030000` retaining_wall, `N3L_F0040000` cut_fill, `N3L_B0020000` fence, `N3A_E0010001` water, `N3A_E0032111` water.
    - `TopoKind = "topo_contour"|"topo_spot"|"topo_road"|"topo_road_surface"|"topo_building"|"topo_retaining"|"topo_cut_fill"|"topo_fence"|"topo_water"`
  - `TOPO_UPLOAD_KEEP(entryName: string): boolean`: 기본 이름이 `TOPO_LAYERS`에 있고 확장자가 `.shp .shx .dbf .prj .cpg` 중 하나면 true.
  - `interpolateTopoDem(points: Float64Array /* x,y,z 반복, EPSG:5179 */, bounds: [minX,minY,maxX,maxY], cellM = 5): TopoDemGrid`
    - `TopoDemGrid = { x0: number; y0: number; cellM: number; cols: number; rows: number; values: Float32Array /* row 0 = south, NaN = 없음 */ }`
  - `class TopoDemReader { constructor(grid: TopoDemGrid); elevationUtmk(x, y): number|null; elevation(lng, lat): number|null }` (bilinear, 범위 밖·NaN이면 null)
  - `buildTopoDb(srcDir: string, outPath: string, opts: { releaseId: string }): Promise<TopoSummary>`
    - `TopoSummary = { crs: string; bboxUtmk: [number,number,number,number]; coverageWgs84: [number,number][] /* 닫힌 사각형 5점 */; counts: Partial<Record<TopoKind, number>>; demCells: number; buildingFloorsOnePct: number|null }`
  - `TopoError extends Error { code: "topo_not_topo"|"topo_crs"|"topo_empty" }`

- [ ] **Step 1: DEM 실패 테스트 작성** (`test-v2-topo-dem.mjs`)
  - 원뿔 `z = 100 − dist/10`을 만든다. 중심 (1000,1000), 반지름 500 m 안에서 2 m 간격 등고선의 정점과 중심 표고점을 둔다.
  - `interpolateTopoDem(..., [500,500,1500,1500], 5)` 결과를 확인한다:
    - (1000,1000) 근처 셀 오차는 1.0 m 이하
    - (1250,1000) 셀 오차는 1.0 m 이하
    - 점이 하나도 없는 바깥 셀은 `NaN`
  - `new TopoDemReader(grid).elevationUtmk(2000, 2000) === null`
- [ ] **Step 2: 실행해 실패 확인** — `npx tsx src/scripts/v2/test-v2-topo-dem.mjs`, 모듈이 없어 FAIL해야 한다.
- [ ] **Step 3: `interpolateTopoDem` 구현**
  - 알고리즘은 사분면 제한 IDW다. 셀 중심마다 네 사분면(NE/NW/SW/SE)에서 반경 60 m 안의 최근접 점 하나씩을 고른다. 2점 이상이면 거리² 역가중 평균을 쓰고, 미만이면 NaN이다.
  - 점 색인은 `cellM*4` 크기 버킷 격자로 만든다.
  - `// ponytail: 사분면 IDW는 등고선 사이 계단이 남는다 — TIN(제약 Delaunay)으로 바꿀 때까지 '추정'으로 표기` 주석을 남긴다.
- [ ] **Step 4: 실행해 통과 확인.**
- [ ] **Step 5: 빌더 실패 테스트 작성** (`test-v2-topo-build.mjs`)
  - 픽스처 SHP는 테스트 안의 최소 writer 함수로 만든다:
    - PolyLine·Point·Polygon 각 1~3개
    - `.dbf`는 `cont`/`nume`/`rvwd`/`rdln`/`nmly`/`heig` 필드
    - `.prj`는 `test-v2-shp.mjs`의 5179 WKT, `.cpg`는 `UTF-8`
  - `buildTopoDb` 결과를 확인한다:
    - `counts.topo_contour === 2`, `counts.topo_road === 1`, `counts.topo_building === 1`
    - `queryFeaturesInRadius(db, center, 500, ["topo_road"])[0].properties.widthM === 6`
    - `topo_dem` 표에 행 1개
  - 오류 경우:
    - 레이어가 하나도 없으면 `TopoError("topo_not_topo")`
    - 5187 `.prj`(lon0 129, FE 200000, FN 600000)면 `TopoError("topo_crs")`
  - 실제 샘플 검사: `process.env.TOPO_SAMPLE_ZIP`이 있을 때만 압축을 풀어 실행한다. `counts.topo_building === 15145`, `counts.topo_contour === 1386`이어야 한다. 없으면 `skip` 로그만 남긴다.
- [ ] **Step 6: 실행해 실패 확인.**
- [ ] **Step 7: `buildTopoDb` 구현**
  - `initDataFileSchema(db, "reference")`로 표를 만든다.
  - 레이어마다 `readShp(path, { native: true })`로 읽는다. crs는 `crsFromPrj`로 확인한다.
  - 좌표 변환:
    - 5179가 아니면 `reprojectToWgs84`로 바꾸고 `insertFeature(..., geometryIsUtmk: false)`로 넣는다.
    - 5179면 `geometryIsUtmk: true`로 넣는다.
  - properties 정규화:
    - 도로: `{ widthM: rvwd, lanes: rdln }`
    - 건물: `{ floorsAbove: nmly, name, kind }`
    - 단차: `{ heightM: heig>0 ? heig : null, kind }`
    - 등고선: `{ elevationM: cont }`, 표고점: `{ elevationM: nume }`
  - 등고선 정점(5 m 간격 densify)과 표고점으로 `interpolateTopoDem`을 돌린다. 결과는 `topo_dem(x0,y0,cell_m,cols,rows,data BLOB)` 한 행으로 저장한다.
  - `source_release`에 `ngii_topo` 행 하나를 쓴다: provider "국토지리정보원", sourceAsOf null.
  - `buildingFloorsOnePct`는 `nmly===1` 비율이다.
- [ ] **Step 8: 통과 확인 + `npm run lint`.**
- [ ] **Step 9: Commit** — `feat(v2): 연속수치지형도 zip을 분석 전용 자료(SQLite·5 m DEM)로 만드는 빌더`

### Task 2: 업로드 API와 저장

**Files:**
- Create: `src/lib/v2/topo/upload.ts`, `src/app/api/v2/topo/route.ts`
- Modify: `src/lib/v2/app-db.ts` (`topo_upload` 표를 `wind_result_cache`처럼 지연 생성)
- Test: `src/scripts/v2/test-v2-topo-api.mjs`

**Interfaces:**
- Consumes: Task 1의 `buildTopoDb`, `TopoSummary`, `TopoError`, `TOPO_UPLOAD_KEEP`
- Produces:
  - 표 `topo_upload(topo_id TEXT PK, user_id TEXT NOT NULL, sha256 TEXT NOT NULL, db_path TEXT NOT NULL, summary_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id, sha256))`
  - `putTopoUpload(appDb, dataDir, body: Buffer, userId: string): Promise<ApiReply>`
    - 201 `{ topoId, summary: TopoSummary }`, 같은 sha면 200과 기존 행
    - 오류: 413 `topo_too_large`, 400 `topo_bad_zip` / `topo_not_topo` / `topo_crs`
  - `openTopoForUser(appDb, topoId, userId): { db: Db; sha256: string; summary: TopoSummary; uploadedAt: string } | null`
  - 상수 `MAX_TOPO_UPLOAD_BYTES = 64 * 1024 ** 2`, `MAX_TOPO_INFLATED_BYTES = 256 * 1024 ** 2`, `MAX_TOPO_ENTRIES = 400`
  - 저장 위치: `.cache/v2/topo/<topoId>.sqlite`. app.sqlite와 같은 `.cache/v2` 폴더이며 경로는 `app-db.ts`가 app DB 경로를 정하는 방식을 따른다.

- [ ] **Step 1: 실패 테스트 작성**
  - `test-v2-wind-api.mjs`처럼 임시 `app.sqlite`와 함수를 직접 호출한다.
  - 정상: Task 1 픽스처를 JSZip으로 묶어 올리면 201이고 `summary.counts.topo_road === 1`이다.
  - 중복: 같은 바이트를 다시 올리면 200이고 `topoId`가 같다. `.cache/v2/topo`의 파일은 1개다.
  - 거절:
    - 65 MB 버퍼 → 413
    - 항목 이름이 `../x.shp` 또는 `a/b.shp`인 zip → 400 `topo_bad_zip`
    - 레이어 없는 zip → 400 `topo_not_topo`
  - 소유권: `openTopoForUser(appDb, id, "other-user") === null`
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: `putTopoUpload` 구현**
  - 크기를 확인한다.
  - JSZip `loadAsync`로 연 뒤 항목 수와 이름을 검사한다. 이름에 `/` `\` `..`가 있으면 거절한다.
  - `TOPO_UPLOAD_KEEP` 항목만 꺼낸다. 압축 해제 누적 크기가 `MAX_TOPO_INFLATED_BYTES`를 넘으면 중단한다.
  - `mkdtemp`에 기본 이름으로 쓴다.
  - 그 뒤 처리:
    - `topoId`는 `randomUUID()`로 만든다. 같은 user+sha 행이 있으면 그 행을 돌려준다.
    - `buildTopoDb`를 호출하고 temp 폴더는 `finally`에서 지운다.
    - `TopoError`는 그 code로 400을 돌려준다.
- [ ] **Step 4: route 작성**
  - `export const runtime = "nodejs"`
  - `POST`는 `requireAuth`/`isUser` → `Buffer.from(await req.arrayBuffer())` → `putTopoUpload` 순서다.
  - `checkRateLimit(\`topo:${auth.id}\`, 20, 15 * 60_000)`을 건다.
- [ ] **Step 5: 통과 확인 + lint.**
- [ ] **Step 6: Commit** — `feat(v2): 수치지형도 업로드 API(분석 전용·중복 제거·크기/경로 검사)`

### Task 3: 분석에 topo 연결 (요청·저장·context·캐시 키·worker)

**Files:**
- Modify: `src/lib/v2/engine/api.ts:34-43` (`bodySchema.topoId?: z.string().uuid()`)
- Modify: `src/lib/v2/engine/run.ts:30-38,54-83,139-177`
- Modify: `src/lib/v2/engine/context.ts:56-86` (생성자 options `topo`)
- Modify: `src/lib/v2/engine/jobs.ts:266`, `src/lib/v2/engine/detail/registry.ts:291`, `src/lib/v2/engine/wind-api.ts:540`
- Create: `src/lib/v2/topo/context.ts`
- Test: `src/scripts/v2/test-v2-topo-run.mjs`

**Interfaces:**
- Consumes: Task 2의 `openTopoForUser`
- Produces:
  - `RunInput.topoId?: string`
  - `parameters_json.topo = { id: string; sha256: string } | undefined`
  - `EngineContext.topo: TopoHandle | null`
    - `TopoHandle = { sha256: string; summary: TopoSummary; source: SourceRef; hits(kinds: readonly TopoKind[], radiusM?: number): FeatureHit[]; covers(x: number, y: number): boolean; dem: TopoDemReader | null }`
    - `source = { sourceId: "ngii_topo", releaseId: \`ngii_topo@${sha256.slice(0,12)}\`, sourceAsOf: null, fetchedAt: uploadedAt }`
  - `topoHandleFor(appDb, parameters, userId): TopoHandle | null`: 네 곳의 context 생성 지점이 공유한다.
  - `TOPO_AFFECTED_TILES = ["D02","D03","D04","D05","D10","D13","D15","D16","D17","D18","D29","S01","S02","S03","S04"] as const`
  - `conditions.filters.topo = sha256`: topo가 있을 때만 넣는다. 없으면 키를 만들지 않아 기존 키가 그대로 남는다.
  - `cacheKeyForConditions`는 `TOPO_AFFECTED_TILES`에 없는 code면 `filters.topo`를 지운 뒤 해시한다. 날짜·parcelSnapshotHash 처리 옆에 둔다.

- [ ] **Step 1: 실패 테스트 작성** (`engine-fixture.mjs`의 `buildEngineFixture` 사용)
  - topo 없는 `runAnalysis`:
    - 33타일 `cache_key`가 이 Task 전 커밋에서 기록한 기대값과 같다. 변경 전에 한 번 뽑아 테스트 상수로 둔다.
    - `parameters.topo === undefined`
  - topo 있는 분석:
    - D17 키는 다르다. A03 키는 topo 없는 분석과 같다.
    - `getAnalysisRun(...).parameters.topo.sha256`이 저장된다.
  - worker: `runHeavyTiles`로 만든 context의 `ctx.topo?.sha256`이 같다.
  - 범위: 대지 반경과 겹치지 않는 topo로 `postAnalysis`를 부르면 422 `{ error: "topo_outside" }`
  - 소유권: 다른 사용자의 topoId로 부르면 404 `topo_not_found`
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현**
  - `runAnalysis`는 `topoHandleFor`로 연다.
  - 반경 원 bbox와 `summary.bboxUtmk`가 겹치지 않으면 422를 돌려준다.
  - `createAnalysisRun` 전에 `parameters.topo`를 넣는다.
  - `conditionsForRun`(run.ts:54)과 `EngineContext` 생성자의 conditions(context.ts:77)가 같은 규칙으로 `filters.topo`를 넣는다. 둘이 어긋나면 `cache_key_mismatch`가 난다.
  - context 생성 지점 네 곳은 모두 `topoHandleFor(appDb, run.parameters, run.userId)`를 options로 넘긴다.
  - `ctx.close()`에서 topo db도 닫는다.
- [ ] **Step 4: 통과 확인 + lint + 기존 `test-v2-tile-registry`·`test-v2-wind-api` 통과 확인.**
- [ ] **Step 5: Commit** — `feat(v2): 분석 요청·worker·refresh에 분석 전용 수치지형도 연결, 영향 타일만 캐시 키 분리`

### Task 4: 지형 (D17·D18·장면·하류 시뮬레이션) + 단차 레이어

**Files:**
- Modify: `src/lib/v2/engine/tiles/terrain-shared.ts:6-40`
- Modify: `src/lib/v2/tile/d17/engine.ts`, `src/lib/v2/tile/d18/engine.ts`
- Modify: `src/lib/v2/engine/scene.ts:72,97,277-298`, `src/lib/v2/engine/detail/raster.ts:197`
- Modify: `src/lib/v2/ui/map-layers.ts` (레이어 `topo_coverage`, `retaining_wall`, `cut_fill`), `src/lib/v2/engine/tiles/common.ts` (`TILE_CACHE_REVISION`은 topo 없는 출력이 바뀔 때만)
- Test: `src/scripts/v2/test-v2-topo-terrain.mjs`

**Interfaces:**
- Consumes: Task 3의 `ctx.topo`
- Produces:
  - `demReader(ctx)`: topo가 있으면 합성 reader를 돌려준다. `elevation(lng,lat) = topo.dem.elevation(lng,lat) ?? glo30.elevation(lng,lat)`이고, `resolution()`은 5다.
  - `terrainCellM(ctx): 5 | 30`: topo가 대지 중심을 덮으면 5, 아니면 30.
  - `demSources(ctx)`: topo가 있으면 `[ctx.topo.source, ...glo30]`. 순서가 곧 `주 원천`·`보강`이다.
  - `topoTerrainLimitation`: `{ kind: "estimated", note: "지형은 수치지형도 등고선·표고점 보간(추정)이고, 자료 범위 밖은 30m DEM으로 채웠습니다." }`
  - D17 lines에 추가: layer `retaining_wall`·`cut_fill`. name은 `옹벽 4.2m`, 높이가 없으면 `옹벽 · 높이 미확인`이다. layer `topo_coverage`는 폴리곤 1개다.
  - D17 metric 추가 `retaining_count`: 반경 안 단차 시설 수, topo 있을 때만.
  - 장면 `ground.resolutionM`: `z.literal(30)`을 `z.union([z.literal(5), z.literal(30)])`으로 넓힌다. `sourceId`는 topo가 있으면 `"ngii_topo"`.

- [ ] **Step 1: 실패 테스트 작성**
  - 원뿔 topo 픽스처로 D17을 돌린다:
    - `provenance.sources[0].sourceId === "ngii_topo"`
    - limitations에 topoTerrainLimitation 문구가 있고, "30m 격자 보간선" 문구는 없다.
    - `lines.some(l => l.layer === "retaining_wall")`
    - `metrics.find(m => m.id === "retaining_count").value === 1`
  - D18 경사 격자의 `cellM === 5`
  - topo 없는 D17/D18/S01 결과 JSON은 Task 3 전 기준 결과와 `deepEqual`이다.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현**
  - D17/D18은 `terrainGridFor(ctx, terrainCellM(ctx))`를 쓴다.
  - 등고선 간격 `CONTOUR_INTERVAL_M`은 그대로 둔다.
  - 장면은 `sceneCellM` 최소값 30을 유지하고, 표고 공급만 합성 reader가 맡는다.
  - D29·S02·S03는 코드를 바꾸지 않는다. `demReader`를 통해 자동으로 반영된다.
- [ ] **Step 4: 통과 확인 + lint + `test-v2-tile-d17-terrain`·`test-v2-tile-d18-slope`·`test-v2-d1718perf` 통과 확인.**
  - perf 기준: 반경 1 km, 5 m 격자에서 D17+D18 합계 ≤ 1.5초.
- [ ] **Step 5: Commit** — `feat(v2): 지형을 수치지형도 5 m 보간으로(범위 밖 GLO-30), D17 단차 레이어`

### Task 5: 도로 (D13 폭원 위계·접도 폭, D15 가구, 장면 도로 폭)

**Files:**
- Create: `src/lib/v2/engine/tiles/topo-roads.ts`
- Modify: `src/lib/v2/tile/d13/engine.ts`, `src/lib/v2/tile/d15/engine.ts:103,724-768`, `src/lib/v2/engine/scene.ts:151-166`
- Modify: `src/lib/v2/ui/map-layers.ts` (`road:width:12+`, `road:width:8-12`, `road:width:4-8`, `road:width:<4`)
- Test: `src/scripts/v2/test-v2-topo-roads.mjs`

**Interfaces:**
- Consumes: `ctx.topo.hits(["topo_road"])`, `ctx.topo.covers`
- Produces:
  - `mergedRoadLines(ctx, radiusM): Array<{ geometry: LineString|MultiLineString; widthM: number|null; lanes: number|null; source: "ngii_topo"|"osm_roads"; hierarchy: string|null }>`
    - 범위 안은 topo 중심선을 쓴다.
    - OSM 선은 topo 범위 사각형 밖으로 잘린 부분만 쓴다(`turf.lineSplit`/bbox clip).
  - `widthBand(widthM): "12+"|"8-12"|"4-8"|"<4"`: 경계는 12와 8과 4다. 12 이상이면 "12+".
  - D13 metric `frontage_width_m`, 이름 "접한 도로 폭원(참고)":
    - 대지 폴리곤에서 `widthM/2 + 3` m 안에 있는 topo 중심선의 최대 widthM이다.
    - topo가 없으면 metric을 넣지 않는다.
  - D15: 범위 안에서는 `mergedRoadLines`를 `roadLines` 입력으로 쓴다. 보행·자전거 제외 규칙은 OSM 선에만 적용한다.
  - `roadWidthM()`: topo widthM이 있으면 그 값, 없으면 기존 `ROAD_WIDTH_M`.

- [ ] **Step 1: 실패 테스트 작성**
  - topo 범위 안에 폭 6 m 도로 하나, 범위 밖에 OSM 간선 하나가 있는 픽스처로 D13을 돌린다:
    - `lines`에 `road:width:4-8` 1개와 `road:간선` 1개(범위 밖 부분)
    - `frontage_width_m.value === 6`
    - `provenance.sources.map(s=>s.sourceId)`가 `["ngii_topo","osm_roads"]`
  - `widthBand(12) === "12+"`, `widthBand(7.9) === "4-8"`
  - topo 없는 D13/D15 결과는 기준과 같다.
- [ ] **Step 2: 실패 확인.** → **Step 3: 구현.** → **Step 4: 통과 확인 + lint + `test-v2-tile-d13*`·`d15*` 통과.**
- [ ] **Step 5: Commit** — `feat(v2): 도로 폭원 위계·접도 폭(참고)과 가구를 수치지형도 중심선으로(범위 밖 OSM)`

### Task 6: 건물·수계 보강

**Files:**
- Modify: `src/lib/v2/engine/tiles/buildings-shared.ts:474-535`, `src/lib/v2/tile/d10/engine.ts:43`
- Test: `src/scripts/v2/test-v2-topo-supplement.mjs`

**Interfaces:**
- Consumes: `ctx.topo.hits(["topo_building"])`, `ctx.topo.hits(["topo_water"])`
- Produces: `buildingRows(ctx, r)` 결과에 보강을 반영한다.
  - **빠진 도형:** 기존 행의 footprint와 겹치지 않는(교차면적/topo면적 < 0.2) topo 건물을 새 행으로 넣는다. `heightMethod`는 `nmly ≥ 2`면 `"floors_estimate"`(heightM = nmly×3), 아니면 `"assumed_one_floor"`이고, `hit.releaseId`는 topo releaseId다.
  - **층수 결측:** 기존 행이 `floorsAbove === null`이고 겹침(교차/기존면적 ≥ 0.5)인 topo 건물의 `nmly ≥ 2`면, `floorsAbove = nmly`, `heightMethod = "floors_estimate"`로 채운다. 기존 값이 있으면 절대 덮어쓰지 않는다.
  - **수계:** D10의 `water` 폴리곤에 topo water를 layer `water`로 덧붙인다. 중복 판정은 하지 않는다(면적 지표는 union 후 계산). 수관(`canopyFor`)은 변경하지 않는다.
  - 출처: 보강이 하나라도 들어간 타일만 `sources`에 `ctx.topo.source`를 **맨 뒤**에 붙인다. 그래서 칩이 `보강`으로 나온다.

- [ ] **Step 1: 실패 테스트 작성**
  - 기존 건물 2동(하나는 floors null)과 topo 건물 3동(겹침 1·층수 5, 신규 1·층수 1, 신규 1·층수 4)으로 확인한다:
    - 행 수는 4
    - 겹친 건물 `floorsAbove === 5`
    - 신규 1층은 `"assumed_one_floor"`
    - 기존 floors 값은 그대로
  - D02 sources 마지막 항목의 sourceId가 `"ngii_topo"`
  - topo 없는 D02~D05/D10 결과는 기준과 같다.
- [ ] **Step 2–4: 실패 확인 → 구현 → 통과 + lint + `test-v2-buildings`·`test-v2-tile-d10-canopy` 통과.**
- [ ] **Step 5: Commit** — `feat(v2): 수치지형도로 빠진 건물·층수 결측과 수계만 보강`

### Task 7: 출처 이름·역할·메타데이터

**Files:**
- Modify: `src/lib/v2/ui/tile-catalog.ts:107` (`SOURCE_NAMES.ngii_topo = "국토지리정보원 연속수치지형도"`, 영향 타일 catalog `sources`에 `"ngii_topo"` 추가)
- Modify: `src/lib/v2/ui/source-details.ts:58-105`, `src/lib/v2/ui/guide-sources.ts:49`
- Test: `src/scripts/v2/test-v2-source-details.mjs` (기존 파일에 assert 추가)

**Interfaces:**
- `SOURCE_DETAIL_DEFINITIONS.ngii_topo`:
  - provider "국토지리정보원", 자료 "연속수치지형도", URL `https://map.ngii.go.kr`
  - 이용조건 "이용조건 확인 필요", 기준일은 항상 `기준일 미확인`
- 역할: `sourceDetailsFor`의 기존 "순서 규칙"을 그대로 쓴다. Task 4–6이 순서를 보장한다. 계산 도판(S01–S04·D29)은 기존대로 전부 `입력`이다.
- `readGuideSourceSnapshot`: manifest에 없는 `ngii_topo`이면 위 정의로 채운다("제공처 미기록" 금지).

- [ ] **Step 1: 실패 테스트** — D17 sources `[ngii_topo, terrain_tiles]` → 역할 `["주 원천","보강"]`; D02 `[building, ngii_topo]` → `["주 원천","보강"]`; ngii_topo 기준일 `"기준일 미확인"`.
- [ ] **Step 2–4: 실패 → 구현 → 통과 + lint.**
- [ ] **Step 5: Commit** — `feat(v2): 수치지형도 출처 이름·역할·제공처 표시`

### Task 8: 브라우저 쪽 zip 준비·업로드

**Files:**
- Create: `src/lib/v2/ui/topo-upload.ts`
- Test: `src/scripts/v2/test-v2-topo-client.mjs`

**Interfaces:**
- Consumes: Task 1의 `TOPO_UPLOAD_KEEP`. 클라이언트에서 import 가능해야 하므로 `layers.ts`는 node 모듈을 import하지 않는다.
- Produces:
  - `prepareTopoZip(file: Blob): Promise<{ blob: Blob; keptLayers: string[]; droppedBytes: number }>`
    - JSZip은 동적 import한다(`ppt-generator` 방식).
    - 남길 레이어가 하나도 없으면 `TopoClientError("topo_not_topo")`를 던진다.
  - `uploadTopo(blob, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<{ topoId: string; summary: TopoSummary }>`
    - `XMLHttpRequest`로 `POST /site/api/v2/topo`에 보낸다. `upload.onprogress`가 실제 바이트를 알려 주므로 가짜 퍼센트를 쓰지 않는다.
    - `withCredentials`를 켠다. 401이면 `/site/api/auth/refresh` 후 한 번 다시 보낸다(`apiFetch` 규칙과 같음).
  - `TOPO_ERROR_COPY: Record<"topo_not_topo"|"topo_crs"|"topo_outside"|"topo_too_large"|"topo_bad_zip", { title: string; body: string }>`. §9-4 시안 문구를 그대로 쓰고, 끝에 "추가 자료 없이도 분석할 수 있습니다."를 붙인다.
    - topo_not_topo: "수치지형도 레이어를 찾지 못했습니다" / "zip 안에 등고선·도로·건물 SHP가 없습니다. 국토정보플랫폼에서 연속수치지도를 SHP 형식으로 받아 압축을 풀지 않은 채 넣어 주세요."
    - topo_crs: "지도 위치를 읽을 수 없습니다" / "좌표 정보(.prj)가 없거나 지원하지 않는 좌표계입니다. 받은 zip을 고치지 않고 그대로 넣어 주세요."
    - topo_outside: "이 대지 둘레의 자료가 아닙니다" / "파일 범위가 대지와 분석 반경에 전혀 겹치지 않습니다. 대지를 가운데 두고 다시 받아 주세요."
    - topo_too_large: "파일이 너무 큽니다" / "필요한 레이어만 남겨도 64 MB를 넘습니다. 범위를 줄여 다시 받아 주세요."
    - topo_bad_zip: "zip 파일을 열 수 없습니다" / "파일이 손상됐거나 zip이 아닙니다. 다시 받아 넣어 주세요."

- [ ] **Step 1: 실패 테스트** — 행정경계 3종 + 등고선 세트 + `readme.txt`가 든 zip → `keptLayers` `["N3L_F0010000"]`, 행정경계 바이트는 `droppedBytes`에 포함; 레이어 없는 zip은 `topo_not_topo` 오류.
- [ ] **Step 2–4: 실패 → 구현 → 통과 + lint.**
- [ ] **Step 5: Commit** — `feat(v2): 브라우저에서 필요한 수치지형도 레이어만 골라 실제 진행률로 업로드`

### Task 9: 화면 (입력 3곳·추가 자료 칸·보드 칩·지형 안내·범위 표시)

먼저 `ui-ux-pro-max` 스킬을 읽는다. 시안 ①②④ 그대로다.

**Files:**
- Create: `src/components/v2/topo-panel.tsx`, `src/components/v2/topo-panel.module.css`
- Modify: `src/components/v2/site-picker.tsx:31-40` (prop `extra?: ReactNode`를 대지 패널 아래에 렌더, `topoCoverage?: [number,number][]`를 지도 위 점선으로)
- Modify: `src/app/v2/page.tsx` (상태·`analyze()` 본문에 `topoId`·주소 줄 버튼·보드 머리 줄 칩/대화상자·D17 카드 안내)
- Test: `src/scripts/v2/test-v2-topo-ui-state.mjs` (상태 reducer), 브라우저 QA는 `/browse`

**Interfaces:**
- Consumes: Task 8의 `prepareTopoZip`, `uploadTopo`, `TOPO_ERROR_COPY`
- Produces:
  - `TopoState`
    - `{ s: "idle" }`
    - `| { s: "preparing" }`
    - `| { s: "uploading"; loaded: number; total: number }`
    - `| { s: "ready"; topoId: string; fileName: string; summary: TopoSummary; coveragePct: number }`
    - `| { s: "error"; code: keyof typeof TOPO_ERROR_COPY }`
  - `topoReducer(state, action)`: action은 `pick`, `progress`, `done`, `fail`, `remove`, `recheck(center, radiusM)`이다.
  - `coveragePct = 반경 원 ∩ bboxUtmk 면적 ÷ 원 면적`(정수 %).
- **화면 규칙(시안 문구 고정):**
  - 주소 줄(`controls` form)의 `수치지형도 추가` 버튼
    - 상태가 ready면 `수치지형도 1개`로 바꾼다.
    - 390 px에서는 `aria-label="수치지형도 추가"` 44 px 아이콘 버튼이다.
    - 숨은 `<input type="file" accept=".zip">` 하나를 세 입력 지점이 같이 쓴다.
  - 대지 패널 아래 **추가 자료 (선택)** 칸, 상태별 내용:
    - idle: 안내 한 줄, 드롭존 `수치지형도 zip 추가`(끌어 놓기 + 클릭·Enter), `국토정보플랫폼에서 받는 방법` 링크(44 px)
    - uploading: 단계 목록 `목록 읽기` / `필요한 레이어만 고르기` / `올리기 n%` / `위치와 들어 있는 자료 확인`, 그리고 `취소`
    - ready: 파일명, "분석 반경의 n%를 덮습니다. 나머지는 기존 자료로 채웁니다.", 칩 줄, `빼기` / `다른 파일`
    - error: `role="alert"`와 해당 문구
  - 칩 줄은 다섯 개다:
    - `주 원천` 지형 · 원본 등고선·표고점
    - `주 원천` 도로 폭원·차로수
    - `새로 추가` 옹벽·절성토·담장
    - `보강` 건물 · 빠진 도형·층수만
    - `보강` 하천·호소
  - 올리는 동안에도 대지를 고를 수 있다. `analyze()`는 ready일 때만 `topoId`를 보낸다. 업로드 중에 분석을 누르면 topo 없이 진행할지 묻지 않고 그대로 보낸다.
  - 주소가 바뀌면 `recheck`를 실행한다. 겹침이 0이면 error `topo_outside`로 바꾼다.
  - 보드 머리 줄:
    - topo 분석이면 `추가 자료 · 수치지형도` 칩을 둔다. 누르면 `role="dialog"`가 열린다. 내용은 쓰임 요약 3줄과 `빼고 다시 분석`(topoId 없이 `analyze()`), `다른 파일로`(파일 고르기 후 `analyze()`)다. Esc로 닫고 opener로 포커스를 돌려준다.
    - topo가 없으면 `수치지형도 추가` 버튼을 둔다. 업로드가 끝나면 `analyze()`로 새 분석을 만든다.
  - D17 카드 안내: topo가 없고 `relief_max_m − relief_min_m ≥ TOPO_NUDGE_RELIEF_M (= 10)`일 때만 보인다. 문구는 "대지 고저차가 커서 30 m 자료로는 부정확할 수 있습니다. 수치지형도를 넣으면 원본 등고선으로 다시 계산합니다."이고, 버튼은 `수치지형도 넣고 다시 분석`이다.
  - 범위 표시: 대지 지정 지도와 D17·D13 지도에 `topo_coverage` 점선과 범례 `수치지형도 범위 · 밖은 기존 자료`를 둔다.

- [ ] **Step 1: 실패 테스트(reducer)**
  - `pick → progress(5,10) → done`이면 ready이고 `coveragePct`가 계산된다.
  - `recheck`로 겹침 0이면 `topo_outside` error다.
  - `remove`면 idle이다.
- [ ] **Step 2–4: 실패 → 구현 → 통과 + lint.**
- [ ] **Step 5: 브라우저 QA(`/browse`, 1280·390 px)**
  - 샘플 zip으로 확인할 것:
    - 업로드 진행률
    - ready 칩
    - 분석 후 D17 출처 칩 `주 원천 국토지리정보원 연속수치지형도`
    - 범위 점선
    - 키보드만으로 업로드·대화상자 열고 닫기
    - zip 없는 분석이 이전과 같은 화면인지
  - 스크린샷을 보고서에 남긴다.
- [ ] **Step 6: Commit** — `feat(v2): 수치지형도 추가 자료 화면(입력 3곳·추가 자료 칸·보드 칩·지형 안내·범위 표시)`

### Task 10: D17 현장 확인 도판 (펼침 창 + PPT)

**Files:**
- Modify: D17 펼침/상세 경로(`src/lib/v2/engine/detail/registry.ts` D17 항목, 해당 뷰 컴포넌트), `src/lib/v2/report/*` (D17 상세 페이지에 지도 + 고른 단면)
- Create: `src/lib/v2/engine/tiles/terrain-section.ts`
- Test: `src/scripts/v2/test-v2-topo-section.mjs`

**Interfaces:**
- Consumes: `demReader(ctx)`, `ctx.topo.hits(["topo_retaining","topo_cut_fill","topo_fence"])`
- Produces:
  - `terrainSections(ctx, site: Polygon): { A: Section; B: Section }`
    - `Section = { axis: "EW"|"NS"; from: [x,y]; to: [x,y]; samples: { d: number; z: number|null }[]; siteSpan: [number, number]; crossings: { d: number; kind: "retaining"|"cut_fill"|"fence"; heightM: number|null }[] }`
    - 단면선은 대지 중심을 지나는 동서·남북 직선이다. 길이는 반경의 1.2배이고 5 m마다 표본을 뜬다.
  - 펼침 창(topo 있을 때만):
    - 단면 `단면 A–A′ (동서)` / `단면 B–B′ (남북)` 라디오
    - 단면 그래프: 대지 구간 음영, 단차 표시
    - 단차 표: 종류·위치·높이, 높이가 없으면 `높이 미확인`
    - 요약: 대지 고저차·대지 평균 경사·반경 내 단차 시설 수
    - 문구 "등고선·표고점 보간값(추정)입니다. 현장 실측을 대신하지 않습니다."
  - 고른 단면은 보드 저장 상태에 저장하고, PPT D17 상세에 지도와 함께 싣는다.

- [ ] **Step 1: 실패 테스트**
  - 원뿔 픽스처로 `A.samples.length === Math.floor(2.4*r/5)+1`
  - 옹벽 선이 A와 교차하면 `crossings[0].kind === "retaining"`이고 heightM은 픽스처 값
- [ ] **Step 2–4: 실패 → 구현 → 통과 + lint.**
- [ ] **Step 5: 브라우저 QA** — 단면 전환, PPT 내보내기에 단면이 실렸는지(미리보기 창).
- [ ] **Step 6: Commit** — `feat(v2): D17 현장 확인 도판(종·횡단면·단차 표)과 PPT 반영`

### Task 11: 마무리 검증과 배포 확인 (Judge)

- [ ] `npm run lint`, `npm run test:v2` 전체 PASS를 확인한다(기존 172 + 신규).
- [ ] `TOPO_SAMPLE_ZIP="C:\Users\da\Desktop\(B020)연속수치지도_202610156533.zip"`로 Task 1 실제 샘플 검사를 실행한다.
- [ ] 배포 경로 업로드 한도를 확인한다. 기본 1 MB 같은 제한에 걸리면 운영에서 업로드가 막힌다. 수정은 사용자 승인 후에 한다.
  - Lightsail Apache `LimitRequestBody`
  - 역터널 뒤 PC 서버의 프록시 설정
- [ ] 영향 타일의 `TILE_CACHE_REVISION`을 확인한다. topo 없는 출력이 바뀐 타일만 올리고, 바뀐 것이 없으면 그대로 둔다.
- [ ] Obsidian 세션 노트와 Onboarding에 결과를 기록한다.

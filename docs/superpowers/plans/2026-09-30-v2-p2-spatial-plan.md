# v2 P2 — 전국 공간(= v1) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전국 건물 도형·연속지적 도형을 분석 엔진에 연결해 정적 도판 18종 중 원천이 있는 16종(D02·D03·D05~D09·D13·D14·D19·D20·D23~D25·D27 + 기존 D04; D11·D12는 코드 준비)과 구성비 뒷면, 레이어 스택·조판, S01 3D 매스, DXF·GLB 내보내기를 만들어 spec §6 "v1" 완료 기준에 닿는다. D13 도로는 Judge 결정에 따라 Geofabrik OSM free SHP를 사용한다.

**Architecture:** 모든 도판은 기존 분석 타일과 같은 `TileResult` 계약(`src/lib/v2/tile-result.ts`)으로 엔진(`src/lib/v2/engine/tiles/dXX.ts`)이 만든다. 앞면은 `presentation.features/polygons`(지도), 뒷면은 `share_*`/`back_*` 지표(구성비)다. 화면·PPT는 결과만 읽는다. 건물 도형은 별도 `buildings` 데이터 파일(이미 있음), 필지 도형은 새 `parcels` 데이터 파일(이 계획)에 두고 R*Tree로 반경 조회한다. DXF·GLB·S01은 분석 때 저장하는 **장면(Scene)** 한 벌에서 만든다(내보내기 중 데이터 조회 없음, spec §5.2). 스택·조판은 보드 상태(순수 reducer)와 슬라이드 계획의 확장이다.

**Tech Stack:** TypeScript, better-sqlite3 12(R*Tree), @turf/turf 7.3(교차·절단), proj4, zod 4, pptxgenjs 3.12, React 19 SVG(지도·매스 그림), earcut 2.2.4(`@turf/tesselate`의 전이 의존성, 이미 `node_modules/earcut`에 있음 — 새 설치 없음), 테스트 `node:assert/strict` + `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-09-29-site-analysis-v2-design.md` §3.1·§3.3·§4.3·§4.4·§4.5·§5·§6(P2 행)·§6.2. 도판 범례·구성비 근거: `docs/research/2026-09-29-tile-catalog-astra.md` §4. 이 문서와 조사 문서가 충돌하면 spec을 따른다.

## Global Constraints

- 기존 앱 파일(`src/lib/server/**`, `src/app/site/**`, `deploy/**`)은 수정하지 않는다. v2는 `src/lib/v2/**`, `src/components/v2/**`, `src/app/v2/**`, `src/app/api/v2/**`, `src/scripts/v2/**`만 만진다(spec §4.6).
- 새 npm 의존성을 추가하지 않는다. `npm install`을 실행하지 않는다. `earcut`은 이미 설치된 전이 의존성이라 `import earcut from "earcut"`만 허용한다(없으면 BLOCKED 보고).
- **데이터 빌드를 실행하지 않는다.** `.cache/v2/data/.lock`을 다른 빌드(pid 1472, 버전 `2026-09-30g`)가 쥐고 있다. 데이터 관련 작업은 §"데이터 운영" 절의 명령을 **사용자/운영자**가 실행한다. 테스트는 모두 임시 디렉터리 픽스처(`engine-fixture.mjs`, `test-v2-d04-s02.mjs` 방식)로 한다.
- PNU·법정동 코드는 문자열. 모르는 값은 `NULL`(`missing`), 0으로 채우지 않는다. `value_status`는 `observed / estimated / suppressed / missing / not_applicable`(spec §3.3).
- 거리·면적은 EPSG:5179 미터(`toUtmk`). Web Mercator로 면적을 내지 않는다. 구간은 하한 포함·상한 제외, 마지막 구간 상한 개방(spec §4.3).
- 층수와 미터 높이를 서로 환산해 대체하지 않는다. `height_method = floors_estimate`인 높이는 반드시 `[추정]` 레이어·표시로 분리한다(spec §4.3). 미상·해당 없음·자료 미확보는 다른 범주다.
- 중첩 가능한 구역(D08·D11·D23)은 합계 100% 원형 차트를 쓰지 않는다 — 구성비 차트는 항상 가로 막대(`FaceChart`)다.
- 도판 모양: 둥근 사각 + 한글 캡션(기존 `FaceChart`·카드 문법 유지).
- 모든 판단 문장은 `사실 → 의미 → 확인할 것`. 좋음·보통·주의 등급은 D 타일에 없다(`level: null`).
- 결과는 반드시 `parseTileResult`를 통과하고 `ENGINE_VERSION`을 `"v2-p2-spatial-1"`로 올린다(캐시 무효화).
- 테스트 파일은 `src/scripts/v2/test-v2-*.mjs`(`run-tests.mjs`가 이름순 자동 실행). 인수 명령: `npm run test:v2`, `npm run lint`(tsc --noEmit).
- 커밋: `git -c user.name=boilorange -c user.email=impgy613@gmail.com commit -F <메시지파일>`, 한국어 `feat(v2-…):` 접두사, 마지막 두 줄:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AusXwp6sJGXBRZEjcohHWc
  ```
  push·배포 금지.
- 실행자: `routing-work-by-model-tier` 기본대로 GPT-5.6 Luna(effort max, `codex exec`). P0·P1에서 이 PC의 codex 샌드박스가 tsx·git 커밋을 막았던 기록이 있으므로, 첫 작업(T1)에서 실제 모델·샌드박스를 확인하고 막히면 Executor B(Sonnet)로 바꾸고 이유를 보고서에 남긴다. 병렬 작업자는 각자 `git worktree add .worktrees/v2-p2-<task> -b v2-p2-<task> v2-p2`에서 일하고, Judge가 `v2-p2`로 병합한다.

## Review Focus

1. **높이 미상 건물이 0m로 스며드는 경로** — D05~D07·S01·GLB·S02는 `height_m IS NULL`을 "미상" 범주로 세고 지도·매스에는 바닥 모양만 그린다. 층수만 있는 건물(`floors_estimate`)은 `[추정]` 레이어로만 그린다(T7·T18·T20 테스트).
2. **반경 경계에 걸친 필지·건물의 면적** — 뒷면 구성비는 원과 교차한 면적(`areaInCircle`)이고, 앞면 개수는 교차 개수다. 원 밖 면적을 세거나 대표점이 밖이라고 빠뜨리면 안 된다(T1·T9 테스트).
3. **필지 도형 없는 버전에서의 안전한 미제공** — `parcels` 파일이 manifest에 없으면 D19·D20·D09(지목)·A12(주변 지가)는 예외 없이 `not_provided`/`missing`이고 나머지 타일은 그대로 계산된다(T3·T8·T9 테스트).
4. **내보내기의 좌표계·원점·단위** — DXF `$INSUNITS=6`(m), 원점은 대지 중심(0,0)이고 UTM-K 원점 좌표가 파일 안 텍스트와 GLB `asset.extras`에 기록된다. GLB는 Y-up이며 북쪽이 −Z다(T19·T20 테스트). 실제 프로그램 확인은 사용자가 한다(§6.2).
5. **스택·조판이 원본 타일의 출처·한계를 잃는 경로** — 스택 슬라이드 출처 띠는 층 타일 출처의 합집합, 조판 셀마다 타일 코드·출력 면·출처가 남는다(T22·T23 테스트).

---

## 0. 현재 상태 (v2-int 실측, 2026-09-30)

| 항목 | 상태 |
|---|---|
| 게시 manifest | `2026-09-30d`: core(법정구역·필지 대표점 3,987만·대장), reference(상가·버스·공원), market(청약·입주예정). **철도·학교·용도지역·정비구역·SGIS·공시지가·실거래·정비사업 명부는 코드는 있으나 아직 게시본에 없음** — 빌드 `2026-09-30g`(core+reference)·`f`(market+reference)가 진행/대기 중 |
| `buildings` 파일 | 적재기 있음(`src/lib/v2/ingest/sources/buildings.ts`, `data:build --only buildings`), **아직 한 번도 빌드되지 않음** → D04·S02는 실데이터에서 `not_provided` |
| 필지 도형 | 없음. core의 `parcel_point`(bbox 중심)만. 원본 SHP 17개 시도 전체가 `.cache/v2/raw/cadastral/2026-09-08`에 있음(AL_D002: A1 PNU, A5 지번+지목, A7 시군구; **공부면적 열 없음**) |
| 지도 면 지물 | `presentation.polygons` 계약·엔진(A09·A12)은 있으나 **`MapFigure`가 그리지 않음**(점만 그림) |
| 타일 카탈로그 | A01~A12(A08 제외)·D04·S02·S03. `tile-view.ts`의 `MAP_TILES`가 A01·A03·A04·A05·A06·D04만 지도로 표시 |
| 뒷면(구성비) | D04 전용 하드코딩(`hasFace`, `chart`, `isShare`) |
| 내보내기 | PPT만. DXF·GLB·3D 없음. `earcut`은 전이 의존성으로 설치돼 있음 |
| OSM | PBF 미수집·파서 없음(`ogr2ogr`/`osmium` 미설치) |

## 1. 남은 P2 산출물 → 원천 → 기존 코드

| 산출물 | 원천(테이블/파일) | 확장하는 코드 | 상태 |
|---|---|---|---|
| A02 학교·통학구역 | reference `school`(점), `school_zone_link`(연결만) | `tiles/a02.ts` 완료 | 배정 학교는 학구 폴리곤 미확보로 P4(spec §6.2 허용). **이번 작업 없음** |
| A11 인구·가구 | reference `pop_grid` | `tiles/a11.ts` 완료 | 완료 |
| A12 토지 — 공시지가·주변 지가 | reference `land_price`(적재기 있음), **parcels**(신규) | `tiles/a12.ts`(지표 `land_price`가 `missing@0`) | **T8** |
| D02 건물 | buildings `feature(building)`+`building_fact` | `d04.ts` 패턴 | **T5** |
| D03 건축물 용도 | `building_fact.use_code`(대장 주용도 5자리) | 〃 | **T6** |
| D04 준공 연대 | 〃 | 완료 | 완료(뒷면 일반화만 T1) |
| D05 높이 / D06 고층 / D07 저층 | `building_fact.height_m/height_method/floors_above` | 〃 | **T7** |
| D08 용도지역 | reference `zoning_area` | `a12.ts` 내부 재사용 | **T8** |
| D09 공원·녹지·하천 | reference `park`(점, `areaM2`), `zoning_area(녹지)`, **parcels 지목**(천·구·유·공·임) | `a04.ts`, `a12.ts` | **T10** (하천·수면은 지목 대체, OSM 수계는 없음) |
| D11 구역·지구 | VWorld dsId 24의 지구·구역 레이어 — **미다운로드** | `zoning.ts` 패턴 | **T16** 코드 준비, 데이터 차단(open Q1) |
| D12 도시계획시설 | VWorld dsId 24 "도시계획시설/…" 레이어 — **미다운로드** | 〃 | **T16** 코드 준비, 데이터 차단(open Q1) |
| D13 도로 | Geofabrik OSM free SHP `gis_osm_roads_free_1`(WGS84 선) | `osm-roads.ts`, `d13.ts` | **부분 제공**(OSM 위계·중심선 길이, 공식 도로대장 아님) |
| D14 지하철·버스 | reference `rail_station/rail_entrance/rail_line`, `bus_stop` | `a01.ts` | **T11** |
| D19 지적 / D20 필지 규모 | **parcels**(신규 파일, `feature(parcel)`) | `parcels.ts`(점) → 새 적재기 | **T3 + T9** |
| D23 정비사업 | reference `maintenance_zone`, market `development_event` | `a09.ts` 내부 재사용 | **T12** |
| D24 계획 철도 | reference `planned_rail_line/station` | `a10.ts` | **T13** |
| D25 실거래 | market `property_transaction` + core `parcel_point` | `a07.ts` 내부 재사용 | **T14** |
| D27 인구 | reference `pop_grid` | `a11.ts`의 `circleRectOverlap` | **T15** |
| 구성비(뒷면) 일반화 | 모든 D 타일 | `tile-view.ts`, `tile-card.tsx`, `render-pptx.ts` | **T1** |
| 면 지물 지도 렌더 | `presentation.polygons` | `map-figure.tsx`, `map-layers.ts` | **T2** |
| 장면(Scene) 저장·API | buildings + parcels + 대지 | `app-db.ts`, `run.ts`, `api.ts` | **T4a·T4b** |
| S01 3D 매스 | 장면 | `s02.ts` 패턴, 새 `MassFigure` | **T17(엔진)·T18(그림·슬라이드)** |
| DXF | 장면 | 새 `export/dxf.ts` | **T19** |
| GLB | 장면 | 새 `export/glb.ts` | **T20** |
| 내보내기 화면 | — | `page.tsx` | **T21** |
| 레이어 스택 | 도판 결과 합성 | `board-state.ts`, `report-plan.ts`, `render-pptx.ts` | **T22** |
| 조판(2×2·3×2) | 〃 | 〃 + `map-image.ts` | **T23** |
| 데이터 운영 | buildings·parcels 빌드, 검수 8곳 | `data-build.mjs`, `p1b-review.mjs` | **§데이터 운영** |

## 2. 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/lib/v2/ui/tile-catalog.ts` | 새 코드 18종 등록·순서, 원천 이름 | T1 |
| `src/lib/v2/engine/tiles/{d02,d03,d05,d06,d07,d08,d09,d11,d12,d13,d14,d19,d20,d23,d24,d25,d27,s01}.ts` | 타일 계산(처음엔 `notProvided` 스텁) | T1 스텁 → 각 타일 작업이 자기 파일만 교체 |
| `src/lib/v2/engine/tiles/buildings-shared.ts` | buildings 파일 열·행 조회 공통(`buildingRows`) | T1 |
| `src/lib/v2/engine/tiles/geo.ts` | `areaInCircle` 추가(완전 포함이면 절단 생략) | T1 |
| `src/lib/v2/engine/run.ts` | TILES 순서, `pnu` 전달, 장면 저장 호출 | T1, T4b |
| `src/lib/v2/engine/context.ts` | `EngineInput.pnu`, `FileKey`에 `parcels` | T1, T3 |
| `src/lib/v2/ui/map-layers.ts` | 새 레이어 스타일 전부, `legendItems`가 면 지물 포함 | T1, T2 |
| `src/lib/v2/ui/tile-view.ts` | 지도 표시 일반화, `hasFace = diagram`, `chart`(단위 포함) | T1, T2 |
| `src/components/v2/map-figure.tsx` | 면 지물 그리기 | T2 |
| `src/lib/v2/tile-result.ts` | `MAX_MAP_POLYGONS` 3000 | T2 |
| `src/lib/v2/data/schema.ts` | `DataFileKind`에 `parcels`, `parcel_fact` 없음(속성은 `properties_json`) | T3 |
| `src/lib/v2/ingest/sources/parcel-polygons.ts` | 연속지적 SHP → `feature(parcel)` | T3 |
| `src/scripts/v2/data-build.mjs` | `--with parcels` 빌더, D11/D12 레이어 빌더 | T3, T16 |
| `src/scripts/v2/engine-fixture.mjs` | `options.buildings`·`options.parcels` 픽스처 | T3 |
| `src/lib/v2/scene.ts` | 장면 계약(zod)·좌표 규약 | T4a |
| `src/lib/v2/engine/scene.ts` | 장면 생성(`buildScene`) | T4b |
| `src/lib/v2/app-db.ts`, `src/app/api/v2/analyses/[id]/scene/route.ts`, `src/lib/v2/engine/api.ts` | 장면 저장·조회 | T4b |
| `src/lib/v2/export/dxf.ts`, `src/lib/v2/export/glb.ts` | 순수 변환기(브라우저·Node 공용) | T19, T20 |
| `src/lib/v2/ui/mass-projection.ts`, `src/components/v2/mass-figure.tsx` | S01 축측 투영·SVG | T18 |
| `src/lib/v2/ui/stack.ts`, `src/lib/v2/ui/sheet.ts` | 스택 모델·조판 격자(순수) | T22, T23 |
| `src/lib/v2/ui/board-state.ts`, `src/lib/v2/report/report-plan.ts`, `src/lib/v2/report/render-pptx.ts`, `src/lib/v2/report/map-image.ts`, `src/app/v2/page.tsx` | 스택·조판·S01·내보내기 UI | T18, T21, T22, T23 (순차) |
| `src/lib/v2/ingest/sources/districts.ts` + `tiles/d11.ts`, `tiles/d12.ts` | 지구·구역·계획시설 적재·도판 | T16 |

## 3. 작업 순서와 병렬 그룹

가치 순서: **(1) 지도에 면이 보이고 도판 코드가 보드에 자리 잡는 기반(G0)** → **(2) 건물·토지 도판(가장 많이 쓰는 그림)과 장면·내보내기 변환기(G1, 최대 병렬)** → **(3) 화면·보고서 통합(G3, 순차)** → **(4) 데이터 차단 항목(G2)과 운영·검수(G4)**.

| 그룹 | 작업 | 병렬 | 선행 |
|---|---|---|---|
| **G0 기반** | T1 등록·일반화 → T2 면 지물 렌더 (같은 파일이라 **순차**, 한 실행자) ∥ T3 parcels 파일·픽스처 ∥ T4a 장면 계약 | T1→T2 / T3 / T4a 세 줄기 병렬 | 없음 |
| **G1 타일·변환기** | T5 D02, T6 D03, T7 D05·06·07, T8 D08+A12 지가, T9 D19·D20, T10 D09, T11 D14, T12 D23, T13 D24, T14 D25, T15 D27, T17 S01 엔진, T4b 장면 저장·API, T19 DXF, T20 GLB | **15개 전부 병렬**(서로 다른 파일만 소유) | G0 전부 병합 |
| **G2 데이터 차단** | T16 D11·D12 적재기·타일(코드만) | G1과 병렬 가능(자기 파일 + `data-build.mjs` 끝에 추가만) | T3 병합(같은 `data-build.mjs`) |
| **G3 통합(순차)** | T18 S01 그림·슬라이드 → T21 내보내기 UI → T22 스택 → T23 조판 | 순차(모두 `page.tsx`·`report-plan.ts`·`render-pptx.ts`) | G1 병합 |
| **G4 운영·검수** | 데이터 빌드(사용자), 검수 8곳, DXF·GLB 실제 프로그램 확인 | — | G3 |

각 작업의 **소유 파일** 밖은 건드리지 않는다. 공유 파일에 손댈 일이 생기면 작업을 멈추고 Judge에게 보고한다.

---

## G0 — 기반

### Task 1: 카탈로그 등록·스텁·뒷면 일반화

**Files:**
- Modify: `src/lib/v2/ui/tile-catalog.ts`, `src/lib/v2/engine/run.ts`, `src/lib/v2/engine/context.ts`(`EngineInput.pnu`), `src/lib/v2/engine/tiles/common.ts`(`ENGINE_VERSION`), `src/lib/v2/engine/tiles/not-provided.ts`, `src/lib/v2/engine/tiles/geo.ts`, `src/lib/v2/ui/map-layers.ts`, `src/lib/v2/ui/tile-view.ts`, `src/components/v2/tile-card.tsx`(`FaceChart` 단위), `src/lib/v2/report/render-pptx.ts`(차트 단위), `src/scripts/v2/test-v2-ui-view.mjs`(제외 목록)
- Create: `src/lib/v2/engine/tiles/buildings-shared.ts`, 스텁 `src/lib/v2/engine/tiles/{d02,d03,d05,d06,d07,d08,d09,d11,d12,d13,d14,d19,d20,d23,d24,d25,d27,s01}.ts`
- Test: `src/scripts/v2/test-v2-p2-registry.mjs`

**Interfaces:**
- Produces (모든 G1 작업이 의존):
  - `TILE_CATALOG` 새 항목(순서 = 보드·슬라이드 순서): `D02 건물`, `D03 건축물 용도`, `D04`(기존), `D05 건축물 높이`, `D06 고층 건물`, `D07 저층 건물`, `D08 용도지역`, `D09 공원·녹지·하천`, `D11 구역·지구`, `D12 도시계획시설`, `D13 도로`, `D14 지하철·버스`, `D19 지적`, `D20 필지 규모`, `D23 정비사업`, `D24 계획 철도`, `D25 실거래`, `D27 인구`, `S01 3D 매스`, 그 뒤 `S02`, `S03`. kind는 D=`diagram`, S=`simulation`.
  - 스텁: `export function dXX(ctx: EngineContext): TileResult { return notProvided(ctx, "DXX"); }` — 각 타일 작업은 **자기 스텁 파일만** 교체한다.
  - `buildings-shared.ts`:
    ```ts
    export const BUILDING_SOURCES = ["building", "gis_bldg"] as const;
    export interface BuildingRow { hit: FeatureHit; heightM: number | null; heightMethod: "source" | "floors_estimate" | "user" | "unknown"; floorsAbove: number | null; useCode: string | null; approvalDate: string | null; footprintM2: number | null }
    /** buildings 파일·필수 열이 없으면 null(호출자가 notProvided). 반경 안 building 히트 + building_fact 조인. */
    export function buildingRows(ctx: EngineContext, radiusM = ctx.input.radiusM): BuildingRow[] | null;
    ```
  - `geo.ts`: `export function areaInCircle(center: LngLat, radiusM: number, g: Geometry): { areaM2: number; parts: number[][][][]; clipped: boolean } | null` — 모든 꼭짓점이 중심에서 `radiusM` 안이면 절단 없이 `polygonArea` 합(`clipped:false`), 아니면 `clipToCircle`. 도형 오류면 null.
  - `EngineInput.pnu: string | null`(run.ts가 `site.pnu` 전달). `conditions`에는 넣지 않는다(주소에서 파생).
  - `tile-view.ts`: `MAP_TILES` 삭제 → `presentation.features`나 `polygons`가 있으면 지도. `hasFace = r.tileType === "diagram"`. `chart: { label; value; unit }[] | null` = `id`가 `share_`(단위 %) 또는 `back_`(개수 단위)로 시작하고 값이 있는 지표. `MAP_NOTES`에 D02·D05·D06·D07·D14·D19·D20·D27 문구 추가(아래 표).
  - `map-layers.ts` 레이어 id·라벨·색(모든 타일 작업이 이 id를 그대로 쓴다):

    | 타일 | 레이어 id → 라벨 |
    |---|---|
    | D02 | `bldg_footprint` 건물 발자국 · `bldg_point` 건물(대표점) |
    | D03 | `use:주거` `use:근린생활` `use:업무` `use:판매` `use:숙박` `use:문화집회` `use:교육복지` `use:공업` `use:기타` `use:미상` |
    | D05 | `floors_1_4` 1~4층 · `floors_5_8` · `floors_9_14` · `floors_15_25` · `floors_26p` 26층 이상 · `floors_unknown` 층수 미상 |
    | D06 | `tall_ge35` 35m 이상 · `tall_ge35_est` [추정] 35m 이상 · `tall_lt35` 35m 미만 · `tall_unknown` 높이 미상 |
    | D07 | `low_le12` 12m 이하 · `low_le12_est` [추정] 12m 이하 · `low_gt12` 12m 초과 · `low_unknown` 높이 미상 |
    | D09 | `green_zone` 녹지지역 · `green_parcel` 임야·공원 지목 · `water_parcel` 하천·구거·유지 지목 (+기존 `park`) |
    | D11 | `district:지구단위계획` `district:개발제한` `district:택지·도시개발` `district:산업단지` `district:기타` |
    | D12 | `facility:교통` `facility:공간` `facility:유통공급` `facility:공공문화체육` `facility:보건위생` `facility:환경기초` `facility:기타` |
    | D19 | `parcel` 필지 · `parcel_site` 대상 필지 |
    | D20 | `lot_lt100` 100㎡ 미만 · `lot_100_300` · `lot_300_1000` · `lot_1000_3000` · `lot_ge3000` 3,000㎡ 이상 · `lot_road_water` 도로·하천 지목 |
    | D23 | `maint_stage:구역지정` … `maint_stage:준공` `maint_stage:미확인`(a09 `STAGES` 8종) |
    | D27 | `pop_dens_0` 0명/㎢ · `pop_dens_1` 0 초과~1,000 · `pop_dens_2` 1,000~5,000 · `pop_dens_3` 5,000~10,000 · `pop_dens_4` 10,000~20,000 · `pop_dens_5` 20,000 이상 (+기존 `pop_grid_na`) |
    | D08·D14·D24·D25 | 기존 `zone:*`, `rail_*`/`bus_stop`, `planned_rail_*`, `trade_q*` 재사용 |

    `MAP_NOTES`: D02 "발자국 · 높이 미상은 테두리만", D05 "지상층수 기준", D06 "높이 35m 기준 · [추정]은 층수×3m", D07 "높이 12m 기준 · [추정]은 층수×3m", D14 "운영 시설만 · 계획 철도 제외", D19 "연속지적 · 참조용", D20 "도형 면적 기준(공부면적 아님)", D27 "1km 격자 · 비밀보호 노이즈".

- [ ] **Step 1: 실패하는 테스트 작성** — `src/scripts/v2/test-v2-p2-registry.mjs`

```js
/** P2 등록: 카탈로그 순서·스텁·뒷면 일반화·레이어 스타일·areaInCircle. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { TILE_CATALOG, TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { LAYER_STYLES, layerStyle } = await import("../../lib/v2/ui/map-layers.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { areaInCircle } = await import("../../lib/v2/engine/tiles/geo.ts");
const { ENGINE_VERSION } = await import("../../lib/v2/engine/tiles/common.ts");
const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");

// 1) 카탈로그: P2 코드가 모두 있고 순서가 A → D(코드순) → S 이다
const P2 = ["D02","D03","D04","D05","D06","D07","D08","D09","D11","D12","D13","D14","D19","D20","D23","D24","D25","D27","S01","S02","S03"];
for (const c of P2) assert.ok(TILE_CATALOG[c], `catalog ${c}`);
assert.deepEqual(TILE_CODES.filter((c) => c.startsWith("D") || c.startsWith("S")), P2);
for (const c of P2) assert.equal(TILE_CATALOG[c].kind, c.startsWith("D") ? "diagram" : "simulation");
assert.equal(ENGINE_VERSION, "v2-p2-spatial-1");

// 2) 엔진: 모든 카탈로그 코드가 결과에 있고, 아직 미제공인 스텁은 not_provided
const dataDir = mkdtempSync(join(tmpdir(), "v2-p2-reg-"));
await buildEngineFixture(dataDir, "v1");
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-p2-reg-app-")), "app.sqlite"));
const run = runAnalysis(appDb, dataDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
assert.equal(run.ok, true);
assert.deepEqual(run.results.map((r) => r.tileCode), TILE_CODES, "결과 순서 = 카탈로그 순서");
for (const c of ["D02", "D19", "D27", "S01"]) {
  const t = run.results.find((r) => r.tileCode === c);
  assert.equal(t.status, "not_provided");
  assert.equal(t.tileType, c.startsWith("S") ? "simulation" : "diagram");
}
appDb.close();

// 3) 레이어 스타일: 계획의 id가 모두 정의돼 있다(타일 작업이 그대로 쓴다)
const ids = ["bldg_footprint","bldg_point","use:주거","use:미상","floors_1_4","floors_26p","floors_unknown","tall_ge35","tall_ge35_est","tall_unknown","low_le12","low_le12_est","green_zone","green_parcel","water_parcel","district:기타","facility:교통","parcel","parcel_site","lot_lt100","lot_ge3000","lot_road_water","maint_stage:구역지정","maint_stage:미확인","pop_dens_0","pop_dens_5"];
for (const id of ids) assert.ok(LAYER_STYLES[id], `layer ${id}`);
assert.ok(layerStyle("tall_ge35_est").label.startsWith("[추정]"));

// 4) 뒷면 일반화: diagram 타일은 hasFace, share_/back_ 지표가 차트(단위 포함), 지물이 있으면 지도
const base = { analysisId: "x", status: "complete", engineVersion: "t", conditions: { address: "a", center: [127.15, 37.62], radiusM: 800, analysisDate: "2026-09-30", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null }, judgment: null, provenance: { manifestHash: "a".repeat(64), sources: [{ sourceId: "building", releaseId: "building@2026-09-09", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z" }] }, limitations: [] };
const m = (id, label, value, unit) => ({ id, label, value, unit, formulaVersion: "t@1", numerator: null, denominator: null, status: "observed" });
const d = { ...base, tileId: "x-D19", tileType: "diagram", tileCode: "D19", metrics: [m("parcels", "교차 필지", 12, "필지"), m("share_lot_1", "100㎡ 미만", 25, "%"), m("back_count_1", "필지 수", 3, "필지")], presentation: { legend: [], camera: null, layers: ["parcel"], outputFace: "front", polygons: [{ layer: "parcel", rings: [[[127.15, 37.62], [127.151, 37.62], [127.151, 37.621], [127.15, 37.62]]] }], polygonsTotal: 1 } };
const v = toTileView(d);
assert.equal(v.hasFace, true);
assert.deepEqual(v.chart, [{ label: "100㎡ 미만", value: 25, unit: "%" }, { label: "필지 수", value: 3, unit: "필지" }]);
assert.ok(v.map, "면 지물만 있어도 지도(polygons 전달은 Task 2가 검증)");
const a = { ...base, tileId: "x-A12", tileType: "analysis", tileCode: "A12", metrics: [m("share_class_1", "구성비: 주거", 40, "%")], presentation: { legend: [], camera: null, layers: [], outputFace: "front" } };
assert.equal(toTileView(a).hasFace, false, "분석 타일은 뒷면 없음");

// 5) areaInCircle: 완전 포함은 절단 없이 전체 면적, 걸침은 교차 면적, 밖은 0
const [cx, cy] = toUtmk(CENTER);
const at = (x, y) => toLngLat([cx + x, cy + y]);
const rect = (x0, x1, y0, y1) => ({ type: "Polygon", coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]] });
const inside = areaInCircle(CENTER, 800, rect(0, 100, 0, 100));
assert.equal(inside.clipped, false);
assert.ok(Math.abs(inside.areaM2 - 10000) < 1);
const edge = areaInCircle(CENTER, 800, rect(700, 900, -50, 50));
assert.equal(edge.clipped, true);
assert.ok(edge.areaM2 > 9000 && edge.areaM2 < 10100, `edge ${edge.areaM2}`); // 700~800 구간 ≈ 100×100
assert.equal(areaInCircle(CENTER, 800, rect(2000, 2100, 0, 100)).areaM2, 0);
console.log("✓ v2 P2 registry");
```

- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-p2-registry.mjs` → `catalog D02` assert 실패.

- [ ] **Step 3: 구현**

`tile-catalog.ts` — `TILE_CATALOG`에 위 순서로 추가(색은 D 계열 `#A0522D`~`#5B7B9A` 사이 임의, S01 `#3E6FB0`). `SOURCE_NAMES`에 `building: "GIS건물통합정보"`, `parcel_polygon: "연속지적도(도형)"`, `land_price: "개별공시지가"`, `school_zone_link: "학구 연계표"`, `rail_station: "OSM 철도"` 등 누락 id 보강.

`not-provided.ts` — note를 `"P2 적재·구현 후 제공됩니다."`로, `NOT_PROVIDED_CODES`에 새 코드 추가.

스텁 파일(예 `d02.ts`):
```ts
/** D02 건물 — 스텁. Task 5가 구현으로 교체한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";
export function d02(ctx: EngineContext): TileResult { return notProvided(ctx, "D02"); }
```
D13은 Geofabrik OSM free SHP의 `road` feature를 적재하고, 반경 내 중심선 길이·위계별 구성비·최근접 간선 이상 도로와 선 지도 레이어를 제공한다. ODbL 1.0 및 `© OpenStreetMap contributors`를 source release와 타일 출처/한계에 남긴다.

`run.ts` — `TILES`를 카탈로그 순서로 교체(`A01…A12, D02, D03, D04(d04), D05…D27, S01(s01), S02(s02), S03(notProvided)`), `EngineContext` 생성 시 `pnu: site.pnu` 전달.

`context.ts` — `EngineInput`에 `pnu: string | null`(기본 null로 다루도록 `input.pnu ?? null`).

`common.ts` — `ENGINE_VERSION = "v2-p2-spatial-1"`.

`buildings-shared.ts`:
```ts
import type BetterSqlite3 from "better-sqlite3";
import type { FeatureHit } from "../../data/features";
import type { EngineContext } from "../context";
export const BUILDING_SOURCES = ["building", "gis_bldg"] as const;
const FEATURE_COLUMNS = ["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"] as const;
const FACT_COLUMNS = ["feature_id", "height_m", "height_method", "floors_above", "use_code", "approval_date", "footprint_area_m2"] as const;
export interface BuildingRow { hit: FeatureHit; heightM: number | null; heightMethod: "source" | "floors_estimate" | "user" | "unknown"; floorsAbove: number | null; useCode: string | null; approvalDate: string | null; footprintM2: number | null }
function columns(db: BetterSqlite3.Database, table: string): Set<string> {
  try { return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)); } catch { return new Set(); }
}
export function buildingsReady(ctx: EngineContext): boolean {
  const db = ctx.db("buildings");
  if (!db || ctx.sources("buildings", BUILDING_SOURCES).length === 0) return false;
  const f = columns(db, "feature"); const b = columns(db, "building_fact");
  return FEATURE_COLUMNS.every((c) => f.has(c)) && FACT_COLUMNS.every((c) => b.has(c));
}
export function buildingRows(ctx: EngineContext, radiusM = ctx.input.radiusM): BuildingRow[] | null {
  if (!buildingsReady(ctx)) return null;
  const db = ctx.db("buildings")!;
  const hits = ctx.hits("buildings", ["building"], radiusM);
  const out: BuildingRow[] = [];
  for (let i = 0; i < hits.length; i += 500) {
    const chunk = hits.slice(i, i + 500);
    const rows = db.prepare(`SELECT feature_id, height_m, height_method, floors_above, use_code, approval_date, footprint_area_m2 FROM building_fact WHERE feature_id IN (${chunk.map(() => "?").join(",")})`).all(...chunk.map((h) => h.featureId)) as Array<Record<string, unknown>>;
    const by = new Map(rows.map((r) => [r.feature_id as number, r]));
    for (const hit of chunk) {
      const r = by.get(hit.featureId);
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
      out.push({ hit, heightM: num(r?.height_m), heightMethod: (r?.height_method as BuildingRow["heightMethod"]) ?? "unknown", floorsAbove: num(r?.floors_above), useCode: typeof r?.use_code === "string" ? r.use_code : null, approvalDate: typeof r?.approval_date === "string" ? r.approval_date : null, footprintM2: num(r?.footprint_area_m2) });
    }
  }
  return out;
}
```

`geo.ts` — `areaInCircle`:
```ts
export function areaInCircle(center: LngLat, radiusM: number, g: Geometry): { areaM2: number; parts: number[][][][]; clipped: boolean } | null {
  const [cx, cy] = toUtmk(center);
  const parts = polygonParts(g);
  if (parts.length === 0) return { areaM2: 0, parts: [], clipped: false };
  const r2 = radiusM * radiusM;
  const allInside = parts.every((p) => p.every((ring) => ring.every(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= r2)));
  if (allInside) return { areaM2: parts.reduce((s, p) => s + polygonArea(p), 0), parts, clipped: false };
  const clipped = clipToCircle(center, radiusM, g);
  if (clipped === null) return null;
  return { areaM2: clipped.reduce((s, p) => s + polygonArea(p), 0), parts: clipped, clipped: true };
}
```

`tile-view.ts` — `mapOf`: `MAP_TILES` 조건을 `(features.length || polygons.length)`로, `MapModel`에 `polygons`를 넘긴다(T2가 타입을 더한다; T1에서는 `features`만 넘기고 `hasFeatures || hasPolygons` 조건으로 지도 켬). `hasFace: r.tileType === "diagram"`, `chart`: `r.metrics.filter((m) => /^(share_|back_)/.test(m.id) && m.value !== null).map((m) => ({ label: m.label, value: m.value, unit: m.unit }))`. `isShare` 삭제. PPT 쪽 `render-pptx.ts` 차트 값 표기 `${c.value}${c.unit === "%" ? "%" : ` ${c.unit}`}`; `tile-card.tsx FaceChart`도 같은 표기.

`test-v2-ui-view.mjs` — 예시 데이터 제외 목록을 `TILE_CODES.filter((c) => !["A10", "A11", ...P2 새 코드].includes(c))`로 바꾼다(고덕 예시에 새 타일을 넣지 않는다).

- [ ] **Step 4: 통과 확인** — `npx tsx src/scripts/v2/test-v2-p2-registry.mjs` PASS, `npm run test:v2` 전체 PASS(특히 `test-v2-engine-run.mjs`·`test-v2-ui-view.mjs`·`test-v2-report.mjs`), `npm run lint`.

- [ ] **Step 5: 커밋** — `feat(v2-engine): P2 도판·S01 카탈로그 등록, 스텁, 뒷면 구성비 일반화, buildings 공통 조회`

---

### Task 2: 면 지물 지도 렌더 (MapFigure polygons)

**Files:**
- Modify: `src/lib/v2/ui/map-layers.ts`(`MapModel.polygons?`, `legendItems`), `src/components/v2/map-figure.tsx`, `src/lib/v2/ui/tile-view.ts`(`mapOf`가 `polygons` 전달), `src/lib/v2/tile-result.ts`(`MAX_MAP_POLYGONS = 3000`), `src/lib/v2/ui/overlay-layout.ts`(`slideLegend` — `legendItems` 변경으로 자동)
- Test: `src/scripts/v2/test-v2-map-polygons.mjs`

**Interfaces:**
- `MapModel.polygons?: MapPolygon[]`(없으면 `[]`), `MapModel.polygonsTotal?: number`.
- `legendItems(model)`는 `features`·`polygons` 두 곳의 레이어를 정의 순서로 합친다.
- SVG: 면은 점보다 **먼저** 그린다. 채움 `layerStyle(layer).color` 불투명 0.35(항공 배경은 0.45), 테두리 같은 색 1px; `label`이 있고 면적이 큰 5개까지 라벨(기존 라벨 충돌 회피 로직 재사용). `_est` 레이어(라벨 `[추정]`)는 `fill="url(#hatch)"` 해칭 패턴(대각선) + 색 테두리.
- 화면 성능 상한: 한 그림에 면 3,000개·꼭짓점 200개/면(스키마). 카드가 `map` 면으로 뒤집힐 때만 마운트(기존).

- [ ] **Step 1: 실패하는 테스트**

```js
/** 면 지물: MapModel.polygons → SVG path, 범례 포함, 추정 레이어 해칭, 3000 상한. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";
globalThis.React = React;
const { legendItems, LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
const { MAX_MAP_POLYGONS } = await import("../../lib/v2/tile-result.ts");
const { capPolygons, polygonCandidate } = await import("../../lib/v2/engine/tiles/common.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");

const ring = (dx) => [[127.15 + dx, 37.62], [127.151 + dx, 37.62], [127.151 + dx, 37.621], [127.15 + dx, 37.621], [127.15 + dx, 37.62]];
const model = { center: [127.1505, 37.6205], radiusM: 500, features: [{ layer: "bldg_point", lng: 127.1505, lat: 37.6205 }], total: 1, notes: [], polygons: [{ layer: "bldg_footprint", rings: [ring(0)], label: "A동" }, { layer: "tall_ge35_est", rings: [ring(0.002)], label: null }], polygonsTotal: 2 };
const svg = renderToStaticMarkup(createElement(MapFigure, { model, width: 800, height: 500, basemap: "none", fixed: true }));
assert.ok((svg.match(/<path[^>]*data-poly/g) ?? []).length === 2, "면 2개");
assert.ok(/url\(#hatch/.test(svg), "추정 레이어는 해칭");
assert.ok(svg.indexOf("data-poly") < svg.indexOf("<circle"), "면이 점보다 먼저");
const order = Object.keys(LAYER_STYLES);
assert.deepEqual(legendItems(model).map((i) => i.layer), ["bldg_footprint", "tall_ge35_est", "bldg_point"].sort((a, b) => order.indexOf(a) - order.indexOf(b)), "범례에 면 레이어 포함, 정의 순서");
assert.equal(MAX_MAP_POLYGONS, 3000);
const many = Array.from({ length: 3200 }, (_, i) => polygonCandidate(i, "parcel", [[[0, 0], [10, 0], [10, 10 + i], [0, 0]]], 50 + i)).filter(Boolean);
assert.equal(capPolygons(many).polygons.length, 3000);
// tile-view가 polygons를 MapModel로 넘긴다
const base = { tileId: "x-D19", analysisId: "x", tileType: "diagram", tileCode: "D19", status: "complete", engineVersion: "t", conditions: { address: "a", center: [127.1505, 37.6205], radiusM: 500, analysisDate: "2026-09-30", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null }, metrics: [], judgment: null, presentation: { legend: [], camera: null, layers: ["parcel"], outputFace: "front", polygons: [{ layer: "parcel", rings: [ring(0)] }], polygonsTotal: 1 }, provenance: { manifestHash: "a".repeat(64), sources: [{ sourceId: "parcel_polygon", releaseId: "parcel_polygon@2026-09-08", sourceAsOf: "2026-09-08", fetchedAt: "2026-09-30T00:00:00Z" }] }, limitations: [] };
assert.equal(toTileView(base).map.polygons.length, 1);
console.log("✓ v2 map polygons");
```

- [ ] **Step 2: 실패 확인** — `data-poly` 0개.
- [ ] **Step 3: 구현** — `map-figure.tsx`에 `<defs><pattern id={`hatch${uid}`} …/>`와 `model.polygons?.map(p => <path data-poly d={rings→"M…Z"} fillRule="evenodd" …/>)`를 `dim` 경로 뒤·`drawn` 점 앞에 추가. 라벨 후보에 면 라벨(면 bbox 중심) 포함. `legendItems`는 `[...features, ...polygons]` 레이어 집합. `tile-view.mapOf`: `polygons: r.presentation.polygons ?? [], polygonsTotal`.
- [ ] **Step 4: 통과 확인** — 위 테스트 + `test-v2-map.mjs`·`test-v2-report.mjs` PASS, `npm run lint`.
- [ ] **Step 5: 커밋** — `feat(v2-ui): 지도 그림에 면 지물(polygons) 렌더·범례·해칭, 면 상한 3000`

---

### Task 3: `parcels` 데이터 파일 종류 + 연속지적 도형 적재기 + 픽스처

**Files:**
- Modify: `src/lib/v2/data/schema.ts`(`DataFileKind`에 `"parcels"`), `src/lib/v2/engine/context.ts`(`FileKey`에 `"parcels"`), `src/lib/v2/ingest/build.ts`(`BUILD_ORDER`에 `"parcels"` — core 다음), `src/scripts/v2/data-build.mjs`(`--with parcels` / `--only parcels`), `src/scripts/v2/engine-fixture.mjs`(`options.buildings`, `options.parcels`)
- Create: `src/lib/v2/ingest/sources/parcel-polygons.ts`, `src/scripts/v2/parcels-dryrun.mjs`(임시 sqlite로 시도 1개 드라이런, `buildings-dryrun.mjs` 복제)
- Test: `src/scripts/v2/test-v2-parcel-polygons.mjs`

**Interfaces:**
- `feature.kind = "parcel"`, `stable_id = "parcel:<PNU>"`, `pnu`, `legal_code = A2`, `name = A5`(지번+지목), `properties_json = { jimok: string|null, jibun: string|null, sigungu: A7, areaM2: number(EPSG:5179 평면 면적, 소수 1자리), mountain: boolean }`, `roundM: 0.01`. `source_id = "parcel_polygon"`, 릴리스 provider·URL은 `parcel`과 같다(dsId 23).
- `buildParcelPolygons(db, records: AsyncIterable<ShpRecord>, releaseId): Promise<SourceStats>` — PNU 형식 오류·비폴리곤은 `reject`, 중복 PNU는 첫 행 유지·reject. `stats.accept(props, pnu.slice(0,2), jimok ?? "(미상)")`.
- 픽스처(`engine-fixture.mjs`): `options.buildings === true`면 `buildings.sqlite`(아래 7동), `options.parcels === true`면 `parcels.sqlite`(아래 8필지). 중심 `CENTER`, `at(dx,dy)` 미터 오프셋. 모든 G1 타일 테스트가 이 값을 기대치로 쓴다.

| 건물 id | 위치·크기(m) | height_m / method | floors | use_code | approval |
|---|---|---|---|---|---|
| b_apt | (0,0) 10×10 | 12 / source | 4 | 02000 | 1979-05-01 |
| b_office | (70,0) 20×20 | 40 / source | 12 | 14000 | 1985-01-01 |
| b_tower | (−70,0) 15×15 | 90 / floors_estimate | 30 | 02000 | 1995-01-01 |
| b_unknown | (0,70) 10×10 | null / unknown | null | null | 2005-01-01 |
| b_shop | (0,−70) 12×12 | 8 / source | 2 | 03000 | 2015-01-01 |
| b_noledger | (120,0) 10×10 | null / unknown | null | null | null |
| b_far | (3000,0) 10×10 | 20 / source | 6 | 02000 | 2000-01-01 (반경 밖) |

| 필지 PNU | 위치·크기 | 지목 | areaM2 |
|---|---|---|---|
| `PNU_DASAN_100`(대상) | (−20..20, −20..20) | 대 | 1600 |
| `…0002` | (30..40, 30..40) | 대 | 100 (100㎡ 미만 아님 → `lot_100_300`) |
| `…0003` | (50..70, 50..70) | 대 | 400 |
| `…0004` | (100..160, 100..160) | 대 | 3600 |
| `…0005` | (−200..200, 100..110) | 도 | 4000 |
| `…0006` | (−300..−100, −300..−200) | 천 | 20000 |
| `…0007` | (200..400, −400..−200) | 임 | 40000 |
| `…0008` | (700..900, −50..50) | 대 | 20000 (경계 걸침) |
| `…0009` | (2000..2100, 0..100) | 대 | 10000 (반경 밖) |

- [ ] **Step 1: 실패하는 테스트** — `test-v2-parcel-polygons.mjs`

```js
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
const { initDataFileSchema, DATA_FILE_KINDS } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildParcelPolygons } = await import("../../lib/v2/ingest/sources/parcel-polygons.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");

assert.ok(DATA_FILE_KINDS.includes("parcels"));
const db = new Database(":memory:");
initDataFileSchema(db, "parcels");
const rel = insertRelease(db, { sourceId: "parcel_polygon", provider: "t", sourceUrl: "u", sourceAsOf: "2026-09-08", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
const sq = (lng, lat, d) => ({ type: "Polygon", coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] });
async function* recs() {
  yield { properties: { A1: "1111010100100800001", A2: "1111010100", A5: "80-1대", A7: "11110" }, geometry: sq(126.97, 37.58, 0.0005) };
  yield { properties: { A1: "1111010100100800001", A2: "1111010100", A5: "80-1대", A7: "11110" }, geometry: sq(126.97, 37.58, 0.0005) }; // 중복
  yield { properties: { A1: "1111010100200010000", A2: "1111010100", A5: "산1임", A7: "11110" }, geometry: sq(126.98, 37.58, 0.001) };
  yield { properties: { A1: "bad", A2: "1111010100", A5: "1대", A7: "11110" }, geometry: sq(126.99, 37.58, 0.001) };
  yield { properties: { A1: "1111010100100800002", A2: "1111010100", A5: "80-2대", A7: "11110" }, geometry: { type: "Point", coordinates: [126.97, 37.58] } };
}
const st = await buildParcelPolygons(db, recs(), rel);
assert.deepEqual([st.received, st.accepted, st.rejected], [5, 2, 3]);
const rows = db.prepare("SELECT stable_id, pnu, name, properties_json FROM feature ORDER BY feature_id").all();
assert.equal(rows[0].stable_id, "parcel:1111010100100800001");
const p0 = JSON.parse(rows[0].properties_json);
assert.equal(p0.jimok, "대"); assert.equal(p0.mountain, false); assert.ok(p0.areaM2 > 1900 && p0.areaM2 < 2600, `area ${p0.areaM2}`); // 0.0005° ≈ 44×55 m
assert.equal(JSON.parse(rows[1].properties_json).mountain, true);
assert.equal(queryFeaturesInRadius(db, [126.9702, 37.5802], 100, ["parcel"]).length, 1);
db.close();

// 픽스처: parcels·buildings 파일이 manifest에 실린다
const dataDir = mkdtempSync(join(tmpdir(), "v2-parcels-fx-"));
await buildEngineFixture(dataDir, "v1", { parcels: true, buildings: true });
const m = M.readManifest(dataDir);
assert.ok(m.files.parcels && m.files.buildings);
const pdb = M.openDataFile(dataDir, m, "parcels");
const hits = queryFeaturesInRadius(pdb, CENTER, 800, ["parcel"]);
assert.equal(hits.length, 8, "반경 800 안 필지 8(경계 걸침 포함, 반경 밖 1 제외)");
assert.ok(hits.some((h) => h.pnu === PNU_DASAN_100));
pdb.close();
console.log("✓ v2 parcel polygons");
```

- [ ] **Step 2: 실패 확인** — `DATA_FILE_KINDS.includes("parcels")` 실패.
- [ ] **Step 3: 구현** — `schema.ts`: `DATA_FILE_KINDS = ["core","buildings","parcels","reference","market","osm"]`(테이블 추가 없음 — `properties_json` 사용, 스키마 버전 유지). `parcel-polygons.ts`는 `buildings.ts`를 본떠 `insertFeature(... kind:"parcel", roundM: 0.01)`; 면적은 `projectGeometry`로 투영한 뒤 `polygonArea`(geo.ts는 엔진 모듈이므로 `data/` 쪽에 같은 4줄 shoelace를 두거나 `geo.ts`에서 import — import를 택한다). `jimokOf`는 `parcels.ts`의 것을 재사용, `mountain = /^산/.test(A5)`. `data-build.mjs`: `--with parcels`/`--only parcels` 빌더(`latestShpPerSido(allIn("cadastral"), "AL_D002")` 전 시도, `readShp`, 릴리스 `parcel_polygon`), `expectedRegions = 시도 목록`. `build.ts BUILD_ORDER = ["core","buildings","parcels","reference","market","osm"]`. `context.ts FileKey`에 `"parcels"`. 픽스처는 위 표대로.
- [ ] **Step 4: 통과 확인** — 테스트 + `npm run test:v2` + `npm run lint`. 드라이런은 **실행하지 않는다**(잠금).
- [ ] **Step 5: 커밋** — `feat(v2-ingest): parcels 데이터 파일 종류와 연속지적 도형 적재기, 엔진 픽스처에 건물·필지`

---

### Task 4a: 장면(Scene) 계약

**Files:**
- Create: `src/lib/v2/scene.ts`
- Test: `src/scripts/v2/test-v2-scene-contract.mjs`

**Interfaces (T4b·T17·T19·T20이 그대로 쓴다):**
```ts
export const SCENE_VERSION = "v2-scene@1";
/** 좌표는 대지 중심 원점의 로컬 미터: x=동(+), y=북(+), z=위(+). 지반은 평탄(z=0). */
export type Ring = [number, number][];
export interface SceneBuilding { id: string; rings: Ring[]; heightM: number | null; heightMethod: "source" | "floors_estimate" | "user" | "unknown"; floorsAbove: number | null; useCode: string | null; approvalDate: string | null }
export interface SceneParcel { pnu: string; rings: Ring[]; jimok: string | null; areaM2: number | null; isSite: boolean }
export interface Scene {
  version: typeof SCENE_VERSION; analysisId: string; manifestHash: string;
  origin: { epsg: "EPSG:5179"; x: number; y: number; lng: number; lat: number };
  radiusM: number; groundZ: 0;
  site: Ring[] | null;               // 대상 필지 도형(parcels 파일 + pnu 있을 때), 없으면 null
  buildings: SceneBuilding[]; parcels: SceneParcel[];
  counts: { buildingsTotal: number; buildingsIncluded: number; parcelsTotal: number; parcelsIncluded: number };
  sources: Array<{ sourceId: string; releaseId: string; sourceAsOf: string | null; fetchedAt: string }>;
  limitations: Array<{ kind: "unknown" | "estimated" | "partial" | "incomplete" | "not_provided"; note: string }>;
}
export const SCENE_MAX_BUILDINGS = 5000;   // 가까운 순
export const SCENE_MAX_PARCELS = 5000;     // 면적 큰 순
export const SceneSchema: z.ZodType<Scene>; export function parseScene(v: unknown): Scene;
/** EPSG:5179 좌표 고리 → 로컬 미터(cm 반올림) */
export function toLocalRing(ring: number[][], origin: { x: number; y: number }): Ring;
```

- [ ] **Step 1: 테스트** — `parseScene`가 유효 장면을 통과시키고, `heightM: 0`·`version` 불일치·좌표 NaN을 거부하며, `toLocalRing([[1000010.123, 2000020.456]], {x:1000000, y:2000000})`이 `[[10.12, 20.46]]`인지.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현**(zod, `heightM: z.number().positive().nullable()`) → **Step 4: 통과·lint** → **Step 5: 커밋** `feat(v2): 장면(Scene) 계약`

---

## G1 — 타일·변환기 (15개 병렬)

공통 규칙(모든 D 타일):
- 파일 하나(`tiles/dXX.ts`)와 테스트 하나(`test-v2-dXX.mjs`)만 소유. 픽스처는 `buildEngineFixture(dir, "v1", { buildings: true, parcels: true, zoning: "overlap", rail: true, school: true, maint: "zones", trades: true, planned: true })` 중 필요한 옵션.
- 필요한 파일·원천이 없으면 `notProvided(ctx, "DXX")`(원천 자체 없음) 또는 지표 `missing`(부분).
- `status`: 원천 커버리지 `partial/incomplete`가 있으면 `partial`, 아니면 `complete`.
- 지표 id 규약: 앞면 요약은 자유, **뒷면은 `share_*`(%, 분자=면적 또는 동수, 분모 함께) 또는 `back_*`(개수)**. `formulaVersion`에 분모 정의를 적는다(예 `"d02-share@1:교차 발자국 면적÷π·r²"`).
- 채움률 지표는 `fill_*`(%, 분자·분모)로 앞면 rows에 둔다(spec §4.3 "분자·분모·기준일 함께").
- 판단: `{ ruleId: "DXX-…@1", basisMetricIds: [...], sentence, level: null, criteria: null }`.
- `layers`: 사용하는 레이어 id 전부. `map`/`polygons`: `candidate`/`polygonCandidate`(면 도형은 `areaInCircle(...).parts`로 반경 절단본을 넣는다).
- 테스트 끝에 `assert.ok(!/도보|\d\s*분|종합/.test(JSON.stringify(view)))`.

### Task 5: D02 건물

**Files:** Modify `src/lib/v2/engine/tiles/d02.ts`; Test `src/scripts/v2/test-v2-tile-d02-buildings.mjs`
**Interfaces:** 지표 `buildings`(교차 동수, 동), `fill_geometry_pct`(유효 도형 동수÷히트 동수 — 항상 100이지만 spec대로 표기), `share_footprint_pct`(Σ교차 발자국 면적÷π·r², 분자 ㎡·분모 ㎡), `share_non_building_pct`(100−위), `back_buildings`(동수). 면 `bldg_footprint`(높이 미상은 `label` 없음, `properties`로 구분 불가하므로 레이어 하나), 점 `bldg_point`(면을 못 그리는 화면용 대표점). 한계: `estimated` "발자국 겹침을 제거하지 않은 합계(겹침은 드묾)", coverage.

- [ ] **Step 1 테스트**(핵심 assert): 픽스처(buildings)에서 `buildings.value === 6`(반경 밖 1 제외), `share_footprint_pct`의 numerator ≈ 100+400+225+100+144+100 = 1069 ±2, denominator = round(π·800²), `presentation.polygons.length === 6`, `featuresTotal === 6`, 파일 없으면 `not_provided`.
- [ ] Step 2 실패 확인 → **Step 3 구현**(`buildingRows(ctx)`; 각 hit에 `areaInCircle`; `polygonCandidate(hit.featureId, "bldg_footprint", rings, area, hit.name)`) → Step 4 통과·lint → Step 5 커밋 `feat(v2-engine): D02 건물 도판`

### Task 6: D03 건축물 용도

**Files:** Modify `tiles/d03.ts`; Test `test-v2-tile-d03-buildings.mjs`
**Interfaces:** 주용도코드 앞 2자리 → 10분류(코드에 표로 두고 export `USE_CLASSES`, `useClassOf(code)`):
`01·02→주거`, `03·04→근린생활`, `05·06·13·27→문화집회`, `07→판매`, `08·20·21·23·26·28·29→기타`, `09·10·11·12→교육복지`, `14·24→업무`, `15·16→숙박`, `17·18·19·22·25→공업`, 없음/미등록→`미상`(open Q5). 지표 `fill_use_pct`(주용도 확인 동수÷동수), `share_use_<i>`(동수 비율, 분자 동수·분모 동수, 10개 순서 고정 — 0도 `observed 0`), `share_area_<i>`(보조: 발자국 면적 비율, `footprintM2` 있는 동만) — 뒷면에는 동수 기준만 보이도록 면적 지표 id는 `area_share_<i>`(share_ 접두 아님). 면 레이어 `use:<분류>`.
- [ ] 테스트: 픽스처 6동 → 주거 2(b_apt·b_tower), 업무 1, 근린생활 1, 미상 2; `fill_use_pct.value === 66.7`; `useClassOf("02000")==="주거"`, `useClassOf(null)==="미상"`, `useClassOf("99000")==="미상"`.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): D03 건축물 용도 도판`

### Task 7: D05 높이 · D06 고층 · D07 저층

**Files:** Modify `tiles/d05.ts`, `tiles/d06.ts`, `tiles/d07.ts`; Test `test-v2-tile-d05-height.mjs`
**Interfaces:**
- D05: 층수 구간 `[1,5) [5,9) [9,15) [15,26) [26,∞)` + 미상. 지표 `fill_floors_pct`, `fill_height_m_pct`(미터 높이 `source`만), `share_floors_<i>`(동수), 제목 보조 지표 `title_note`는 만들지 않고 `MAP_NOTES`가 "지상층수 기준"을 표시. 면 `floors_*`. 미터 모드(0~12/12~24/24~45/45~75/75+)는 `back_`이 아닌 `alt_height_<i>`(뒷면 미표시, 펼침 rows에는 보임).
- D06: 기준 35m. `source` 높이 ≥35 → `tall_ge35`, `floors_estimate` 높이 ≥35 → `tall_ge35_est`, <35(source 또는 estimate) → `tall_lt35`, 미상 → `tall_unknown`. 지표 `tall_buildings`(source만), `tall_buildings_est`(추정, status `estimated`), `fill_height_m_pct`, `share_tall_pct/share_not_tall_pct/share_unknown_pct`(동수), `back_tall_area_m2`(발자국 ㎡). 한계: `estimated` "[추정] 높이는 층수×3m(적재기 상수), 공식 고층건축물 정의가 아님".
- D07: 기준 12m 이하, 같은 구조(`low_le12`, `low_le12_est`, `low_gt12`, `low_unknown`).
- [ ] 테스트(픽스처): D05 `share_floors_1`(1~4층)=2/6(b_apt 4층, b_shop 2층), 26+ =1(b_tower 30), 미상 2; D06 `tall_buildings`=1(b_office 40m), `tall_buildings_est`=1(b_tower 90m 추정), unknown 2, `tall_lt35` 2; D07 `low_le12` = 2(b_apt 12, b_shop 8), `low_le12_est`=0, `low_gt12`=2, unknown 2. 문자열에 "고층건축물" 판정 단정 없음.
- [ ] 구현(세 파일이 같은 `bucket` 도우미를 각자 10줄로 갖는다 — 공유 파일을 새로 만들지 않는다) → 통과 → 커밋 `feat(v2-engine): D05 높이·D06 고층·D07 저층 도판`

### Task 8: D08 용도지역 + A12 공시지가·주변 지가

**Files:** Modify `tiles/d08.ts`, `tiles/a12.ts`; Create `tiles/zoning-shared.ts`; Test `test-v2-tile-a12-price.mjs`
**Interfaces:**
- `zoning-shared.ts`: `collectZoning(ctx): { sources, hits, byClass: Map<string, number>, byRaw, polys: PolygonCandidate[], points, total, circleArea, umbrellas, clipFailed, siteLabel, siteNames, fine } | null` — 현재 `a12.ts` 본문을 옮긴 것(동작 동일). `a12`는 이를 호출한다.
- D08: `collectZoning` 결과로 면 `zone:<cls>` + 지표 `fill_zoning_pct`(유효 지정 면적÷π·r², 중복 제거 없이 min(100)), `share_class_<i>`(8분류 고정 순서, 0도 observed), `back_overlap_pct`(합−100, 0 이상), 세분 상위 6은 `raw_<i>`(뒷면 미표시). 한계 문구는 A12와 같다.
- A12 지가: reference `land_price` 테이블이 있고 `ctx.input.pnu`가 있으면 `land_price`(원/㎡, observed, formula에 `기준연도 YYYY`), 없으면 `missing`(사유: 테이블 없음 / pnu 없음 / 행 없음 구분). `nearby_price_median`(주변 지가 중앙값, 원/㎡): parcels 파일이 있으면 `ctx.hits("parcels", ["parcel"])`의 pnu들로 `land_price` 조회(500개씩 IN), `numerator=조회 성공 필지 수, denominator=반경 필지 수`; parcels 없으면 `missing`. `parcel_area_m2`(대상 필지 도형 면적, parcels 있을 때). limitation `not_provided` 문구 갱신.
- [ ] 테스트: 픽스처 `zoning:"overlap", parcels:true` + 테스트가 reference에 `land_price` 행 3개 삽입(대상 PNU 5,000,000; 0002 4,000,000; 0003 6,000,000) → A12 `land_price.value===5000000`, `nearby_price_median.value===5000000`(3개 중앙값), `numerator 3`; parcels 없는 픽스처에서는 `nearby_price_median.status==="missing"`; D08 `share_class_*` 합 > 100(중첩) 이고 `back_overlap_pct > 0`, `polygons.length ≥ 3`. A12 기존 테스트(`test-v2-engine-market-zoning.mjs`) 그대로 통과.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): D08 용도지역 도판, A12 개별공시지가·주변 지가 연결`

### Task 9: D19 지적 · D20 필지 규모

**Files:** Modify `tiles/d19.ts`, `tiles/d20.ts`; Test `test-v2-tile-d19-parcels.mjs`
**Interfaces:**
- D19: parcels 파일 없으면 `notProvided`. 지표 `parcels`(교차 필지 수), `site_parcel_found`(0/1, `ctx.input.pnu`가 히트에 있으면 1; pnu 없으면 `not_applicable`), `fill_geometry_pct`(유효 도형 면적÷π·r² — 원천 지적 대상 면적을 모르므로 label "확보 도형 면적률(대상 분모 미확보)"), `share_jimok_<i>`(지목별 **필지 수** 비율 상위 8 + 기타), `back_area_jimok_<i>`… → 뒷면은 필지 수·면적 둘 다 spec이 요구하므로 `share_count_<i>`와 `share_area_<i>`(교차 면적 비율) 둘 다 `share_` 접두 사용, label에 "(필지 수)"/"(면적)". 면 `parcel`(3000 상한, 큰 면적 우선), 대상 필지 `parcel_site`(highlight, label 지번).
- D20: 필지 **전체** 면적(`properties.areaM2`, 절단 전)으로 `[0,100) [100,300) [300,1000) [1000,3000) [3000,∞)` 분류, 지목 도·천·구·유·철·제·구거 등 도로·하천계열(`도`,`천`,`구`,`유`,`제`,`철`)은 `lot_road_water` 별도. 지표 `fill_area_pct`(areaM2 있는 필지÷필지 수, 도형 면적이라 100), `share_count_<i>`(필지 수 비율), `share_area_<i>`(반경 교차면적 비율), `median_parcel_m2`. 한계 `unknown` "공부면적이 아닌 도형 계산 면적"(open Q6).
- [ ] 테스트(픽스처 parcels): D19 `parcels.value===8`, `site_parcel_found.value===1`, `polygons.some(p=>p.layer==="parcel_site")`, 지목 필지 수 비율 대 5/8(62.5%); D20 구간(필지 전체 면적 기준): `lot_lt100` 0, `lot_100_300` 1(…0002 100㎡), `lot_300_1000` 1(…0003 400㎡), `lot_1000_3000` 1(대상 1,600㎡), `lot_ge3000` 3(…0004 3,600 · …0007 임야 40,000 · …0008 20,000), `lot_road_water` 2(…0005 도 · …0006 천) — 합 8; `share_area_*` 분모 = round(π·800²)이고 …0008은 교차 면적(≈10,000㎡)만 분자에 든다; `median_parcel_m2` = 8개 면적의 중앙값 (3,600+4,000)/2 = 3,800; pnu 없는 실행(`center` 입력)에서는 `site_parcel_found.status==="not_applicable"`.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): D19 지적·D20 필지 규모 도판`

### Task 10: D09 공원·녹지·하천

**Files:** Modify `tiles/d09.ts`; Test `test-v2-tile-a04-green-space.mjs`
**Interfaces:** 원천 셋을 각각 다룬다 — (a) `park` 점(운영 공원 수, `areaM2` 합 = 원천 면적, 반경 교차 아님을 label에 명시), (b) reference `zoning_area` 중 `zoningClass==="녹지"` 면 → `green_zone`, (c) parcels 지목 `천·구·유` → `water_parcel`, `임·공` → `green_parcel`. 지표: `parks`, `park_area_source_m2`, `share_water_pct`(지목 교차면적÷π·r²), `share_green_parcel_pct`, `share_green_zone_pct`, `back_other_pct`(100 − 수면 − 지목 녹지, 녹지지역은 겹치므로 빼지 않음). 어느 원천이 없으면 해당 지표 `missing`, 셋 다 없으면 `notProvided`. 한계: "하천·수면은 지적 지목 기준(OSM 수계 미적재)", "계획 공원(도시계획시설)은 D12", "녹지지역은 지목과 겹칠 수 있어 합계 100% 아님".
- [ ] 테스트: 픽스처 `parcels:true, zoning:"overlap"` → `share_water_pct` numerator ≈ 20000(…0006 하천, 완전 포함), `share_green_parcel_pct` numerator ≈ 40000(임야), `parks.value===3`(기존 park 점 p1~p3), zoning 없는 픽스처에선 `share_green_zone_pct.status==="missing"`.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): D09 공원·녹지·하천 도판(지목·녹지지역·공원 점)`

### Task 11: D14 지하철·버스

**Files:** Modify `tiles/d14.ts`; Test `test-v2-tile-a01-transit.mjs`
**Interfaces:** reference `rail_station`, `rail_entrance`, `rail_line`(선은 `sampleLine`으로 점열, A10 방식 — ponytail: 선 지물 계약이 없음, `MapLine`이 생기면 교체), `bus_stop`. 지표 `back_stations`, `back_entrances`, `back_bus_stops`(각자 개수 — 한 차트에 섞지 말라는 spec은 "원형 합계 금지"이므로 가로 막대 개수 표시는 허용, 단위 `역/곳/곳`), `fill_entrance_pct`(출입구가 있는 역÷역, F연결), `rail_lines`(반경과 교차 노선 수). 철도 미적재면 버스만(A01과 같은 `missing` 처리). 한계 "운영 시설만, 계획 철도는 D24".
- [ ] 테스트: 픽스처 `rail:true` → 역 3(가온역은 1200m라 제외 → 나래·다온 = 2), 출입구 1(다온1 650m), 정류장 2, `fill_entrance_pct` = 1/2 = 50; `rail_line` 표본점이 `features`에 있음(layer `rail_line`).
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): D14 지하철·버스 도판`

### Task 12: D23 정비사업

**Files:** Modify `tiles/d23.ts`, `tiles/a09.ts`(내부를 `collectMaintenance(ctx)`로 export — 동작 동일); Test `test-v2-tile-a09-maintenance.mjs`
**Interfaces:** `a09.ts`에 `export function collectMaintenance(ctx): { zones, projects: Map<string, Project>, zoneProject: Map<number,string>, sources, linked, key } | null`(경계 없으면 null). D23: 면 `maint_stage:<stage>`(구역마다 사업 단계 색), 지표 `back_stage_<i>`(8단계 고유 사업 수, 0 포함 observed), `fill_boundary_pct`(경계가 있는 사업÷명부 사업 — 명부는 시군구 단위이므로 label에 "반경 걸친 시군구 명부 대비"), `fill_stage_pct`(단계 확인 사업÷사업), `zone_area_in_radius_m2`(교차 면적 합, 겹침 미제거 note), `planned_households`는 A09와 같은 값. 경계 없고 명부만 있으면 `notProvided`가 아니라 지표만 있고 지도 없음(`partial`, note "경계 미확보").
- [ ] 테스트: 픽스처 `maint:"zones"` → 구역 2(za·zb, zfar 제외), `back_stage_2`(조합: za→maint:a 조합) = 1, `back_stage_0`(구역지정: zb) = 1, polygons 레이어가 `maint_stage:조합`·`maint_stage:구역지정`; A09 기존 테스트 통과.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): D23 정비사업 도판(단계별 면), A09 수집 로직 공유`

### Task 13: D24 계획 철도

**Files:** Modify `tiles/d24.ts`; Test `test-v2-tile-a10-planned-rail.mjs`
**Interfaces:** A10과 같은 히트(`planned_rail_line`, `planned_rail_station`)에서 단계별(`lifecycleStatus` 원천값 → 구상·공식 계획·승인·공사·중단/변경·미확인 매핑표 export `PLANNED_STAGES`) 고유 사업 수 `back_stage_<i>`, `back_stations`, `line_length_in_radius_m`(반경 안 선형 길이 합, `sampleLine` 대신 선분을 원에서 잘라 길이 계산 — 간단히 표본점 간격×개수는 금지, 선분–원 교차 길이 직접 계산), `fill_geometry_pct`(도형 있는 사업÷사업), `fill_schedule_pct`(항상 0, 원천에 일정 없음 → `observed 0` + note). 지도는 A10과 같은 레이어. 선종(정확도)은 `approximation`이면 label `[개략]`.
- [ ] 테스트: 픽스처 `planned:true` → 사업 1, `under_construction`→공사 1, `line_length_in_radius_m` ≈ 2·√(800²−300²) = 1483 ±5, `fill_schedule_pct.value === 0`.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): D24 계획 철도 도판`

### Task 14: D25 실거래

**Files:** Modify `tiles/d25.ts`, `tiles/a07.ts`(내부를 `collectTrades(ctx)`로 export — 동작 동일); Test `test-v2-tile-a07-trades.mjs`
**Interfaces:** `collectTrades(ctx): { sources, valid, priced, points(단지별 중앙 단가·건수·위치), unlocated, absent, cancelled, from, mid } | null`. D25: 앞면 = A07과 같은 5분위 점(`trade_q*`, weight=건수), 뒷면 `back_q<i>`(5분위별 **거래 건수** — 원거래 집합 기준, 단지 중앙값의 중앙값 금지), `fill_location_pct`(위치 확인 거래÷(확인+미확인), F연결), `unlocated_trades`. 필터 문구 "아파트 매매 · 최근 12개월"을 판단 문장에.
- [ ] 테스트: 픽스처 `trades:true`(A07 테스트와 같은 기대치: 유효 29건, 위치 미확인 2건, 단가 있는 거래 28건) → `fill_location_pct.value === 93.5`(29÷31, numerator 29·denominator 31), `back_q1..q5` 값의 합 === 28, `features`의 레이어가 모두 `trade_q1~5`, A07 기존 테스트(`test-v2-engine-market-zoning.mjs`) 통과.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): D25 실거래 도판, A07 수집 로직 공유`

### Task 15: D27 인구

**Files:** Modify `tiles/d27.ts`; Test `test-v2-tile-a11-density.mjs`
**Interfaces:** `pop_grid` 점 + `cellSizeM`로 격자 사각형(EPSG:5179 축 정렬)을 만들어 `areaInCircle`로 절단 → 면 `pop_dens_<0..5>`(밀도 = 총인구÷격자 면적 ㎢, 구간 0 / (0,1000) / [1000,5000) / [5000,10000) / [10000,20000) / ≥20000), 비공개는 `pop_grid_na`. 지표 `fill_public_pct`(공개 격자 교차면적÷원 면적), `share_dens_<i>`(구간별 교차면적 비율, 분모 π·r²), `back_na_pct`. 한계는 A11과 같은 문구(비밀보호·면적비). `circleRectOverlap`은 `a11.ts`에서 import.
- [ ] 테스트: 테스트가 reference에 `pop_grid` 3셀(중심 (0,0) 1,000명, (1000,0) 30,000명, (0,1000) N/A) 삽입 → 구간 `pop_dens_2`(1,000/㎢)·`pop_dens_5`(30,000)·`na` 각 1면, `share_dens_*` 분자 = `circleRectOverlap` 값과 일치.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): D27 인구 밀도 도판`

### Task 17: S01 3D 매스 — 엔진 타일

**Files:** Modify `tiles/s01.ts`; Test `test-v2-tile-s01-engine.mjs`
**Interfaces:** `buildingRows(ctx)`로 반경 안 건물. `tileType: "simulation"`, 지표 `buildings`, `height_known_pct`(source+estimate ÷ 전체, 분자·분모), `height_source_pct`, `height_estimated_count`, `height_unknown_count`, `height_median_m`(알려진 높이만, estimated 포함 시 status `estimated`), `height_max_m`. `presentation.camera = { kind: "axonometric", azimuthDeg: 225, elevationDeg: 35, radiusM }`, `layers: ["mass_source","mass_estimated","mass_unknown"]`, `conditions.simulation = { scene: SCENE_VERSION, buildingsIncluded, buildingsTotal, cap: SCENE_MAX_BUILDINGS, ground: "flat" }`. 한계: "공개 도형과 확보 높이로 만든 매스. 높이 미상 건물은 바닥 모양만", "지반 평탄(DEM은 P3)". 3D 파일은 부록 링크(PPT에 넣지 않음 — spec §5.1).
- [ ] 테스트: 픽스처 buildings → `buildings 6`, `height_known_pct` = 4/6 = 66.7, `height_estimated_count 1`, `height_unknown_count 2`, `height_median_m` = median(12,40,90,8)=26 (status estimated), `height_max_m 90`(estimated), 문장에 "법적" 없음; buildings 없으면 `not_provided`.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): S01 3D 매스 타일(지표·카메라·장면 조건)`

### Task 4b: 장면 생성·저장·API

**Files:** Create `src/lib/v2/engine/scene.ts`, `src/app/api/v2/analyses/[id]/scene/route.ts`; Modify `src/lib/v2/app-db.ts`(`analysis_scene` 테이블, `saveScene`, `loadScene`), `src/lib/v2/engine/run.ts`(타일 계산 뒤 `buildScene(ctx)` → `saveScene`), `src/lib/v2/engine/api.ts`(`getScene(appDb, id)`); Test `src/scripts/v2/test-v2-scene-build.mjs`
**Interfaces:**
- `buildScene(ctx: EngineContext): Scene | null` — buildings 파일 없으면 null(장면 없음). `buildingRows(ctx)` 가까운 순 5,000동(`hitPoint` 거리), `polygonParts(hit.geometry)`를 `toLocalRing`. parcels 파일 있으면 `ctx.hits("parcels",["parcel"])` 면적 큰 순 5,000, `isSite = pnu === ctx.input.pnu`, `site` = 대상 필지 고리. `origin = toUtmk(center)`. `limitations`: 상한 초과 시 `partial`, 높이 미상 동수 `incomplete`, parcels 없으면 `not_provided` "필지 도형 미적재".
- `app-db.ts`: `CREATE TABLE IF NOT EXISTS analysis_scene (analysis_id TEXT PRIMARY KEY REFERENCES analysis_run(analysis_id), version TEXT NOT NULL, scene_gz BLOB NOT NULL, created_at TEXT NOT NULL)`; `saveScene(db, scene)`는 `zlib.gzipSync(JSON.stringify(scene))`, `loadScene(db, analysisId): Scene | null`은 `gunzipSync` → `parseScene`. `V2_APP_SCHEMA_VERSION`은 유지(테이블 추가만, IF NOT EXISTS).
- API `GET /api/v2/analyses/[id]/scene` → 200 `Scene` JSON / 404. 라우트는 `requireAuth`.
- [ ] 테스트: 픽스처 `buildings:true, parcels:true`로 `runAnalysis` → `loadScene(appDb, id)`가 `buildings.length 6`(반경 밖 제외), `parcels.length 8`, `site` 고리 4점(±20m), `origin.x/y` = `toUtmk(CENTER)`, 모든 좌표 |x|,|y| ≤ 800+여유, `heightM null`인 건물 2; buildings 없는 픽스처 → `loadScene === null`; `getScene`이 404/200.
- [ ] 구현 → 통과 → 커밋 `feat(v2-engine): 분석 장면(Scene) 생성·gzip 저장·조회 API`

### Task 19: DXF 변환기

**Files:** Create `src/lib/v2/export/dxf.ts`; Test `src/scripts/v2/test-v2-export-dxf.mjs`
**Interfaces:**
```ts
export const DXF_LAYERS = { BLDG: "BLDG", BLDG_EST: "BLDG_EST", BLDG_NOHEIGHT: "BLDG_NOHEIGHT", PARCEL: "PARCEL", SITE: "SITE", RADIUS: "RADIUS", META: "META" } as const;
export interface DxfOptions { origin?: "site" | "utmk" }   // 기본 "site"(0,0 = 대지 중심). "utmk"면 EPSG:5179 절대좌표
export function sceneToDxf(scene: Scene, opts?: DxfOptions): string;
export function dxfFileName(address: string, analysisDate: string): string; // 사이트분석_<주소>_<YYYYMMDD>.dxf
```
DXF R2000(`$ACADVER AC1015`), `$INSUNITS 6`(m), `TABLES/LAYER`에 위 7개 레이어(색 1~7), `ENTITIES`: 건물 고리마다 `LWPOLYLINE`(닫힘 플래그 70=1, **39 thickness = heightM** → CAD에서 압출 표시; 미상은 두께 없음·레이어 `BLDG_NOHEIGHT`, 추정은 `BLDG_EST`), 필지 `LWPOLYLINE`(`PARCEL`, 대상은 `SITE`), 반경 `CIRCLE`(`RADIUS`), 원점 `POINT`(`SITE`), `TEXT`(`META`, 0.5m 높이) 한 줄: `origin EPSG:5179 E=<x> N=<y>; unit m; north=+Y; manifest <hash 12자리>; scene <version>`. 줄 끝 `\r\n`. 숫자는 소수 2자리.
- [ ] 테스트: 픽스처 장면(테스트가 손으로 만든 2동·1필지) → 문자열에 `AC1015`, `$INSUNITS\r\n 70\r\n     6`, `LWPOLYLINE` 3개, 두께 `39\r\n40.00`가 높이 40 건물에만, 레이어 이름 7개 모두 존재, `origin EPSG:5179` 텍스트, `origin:"utmk"`면 첫 좌표가 `origin.x + 로컬 x`; `EOF`로 끝.
- [ ] 구현 → 통과 → 커밋 `feat(v2-export): 장면 → DXF(R2000, LWPOLYLINE 압출, 레이어·원점·단위 기록)`

### Task 20: GLB 변환기

**Files:** Create `src/lib/v2/export/glb.ts`; Test `src/scripts/v2/test-v2-export-glb.mjs`
**Interfaces:**
```ts
export function sceneToGlb(scene: Scene): Uint8Array;   // glTF 2.0 binary
export function glbFileName(address: string, analysisDate: string): string;
```
- 좌표: glTF Y-up. `[x, z, -y]`(동=+X, 위=+Y, 북=−Z). 실척 m.
- 메시: 건물마다 지붕(earcut로 삼각분할, 구멍 포함: `earcut(flat, holeIndices, 2)`)을 z=heightM에, 벽은 고리 변마다 사각 2삼각형. 높이 미상: 바닥 다각형만 z=0(벽 없음). 지반: 반경 원 판(64각 팬) z=0.
- 프리미티브 4개(재질 4개: `mass_source` 회색, `mass_estimated` 주황 반투명 없이 색만, `mass_unknown` 밝은 회색, `ground` 흰색) — 한 노드·한 메시. 접근자: POSITION(float32, min/max 기록), indices(uint32). 단일 BIN 청크, 4바이트 정렬.
- `asset.generator = "site-analysis v2"`, `asset.extras = { origin: {epsg:"EPSG:5179", x, y, lng, lat}, units:"m", up:"+Y", north:"-Z", manifestHash, analysisId, sceneVersion }`.
- [ ] 테스트: 손 픽스처(높이 10 정사각 1동, 미상 1동, 구멍 있는 1동) → magic `glTF`, version 2, JSON 청크 파싱 → `meshes[0].primitives.length===4`, 높이 10 건물 정점의 max y = 10, 미상 건물 정점은 y=0만, 구멍 건물 지붕 삼각형 수 = earcut 결과와 동일(간접: indices 길이가 3의 배수), BIN 길이 4의 배수, extras.origin 기록.
- [ ] 구현 → 통과 → 커밋 `feat(v2-export): 장면 → GLB(실척, Y-up, 원점·축 기록, earcut 지붕)`

---

## G2 — 데이터 차단 항목(코드 준비)

### Task 16: D11 구역·지구 · D12 도시계획시설 — 적재기·타일

**Files:** Create `src/lib/v2/ingest/sources/districts.ts`; Modify `tiles/d11.ts`, `tiles/d12.ts`, `src/scripts/v2/data-build.mjs`(끝에 `raw/districts` 폴더가 있을 때만 reference에 이어 붙임 — T3 병합 후), `src/scripts/v2/vworld-fetch.mjs`(`--folder districts` 기존 옵션 사용, 변경 없음), `src/lib/v2/ui/tile-catalog.ts`의 `SOURCE_NAMES`는 **건드리지 않고** `districts.ts`가 `sourceId`를 `district_<key>`/`facility_<key>`로 두고 이름은 `SOURCE_NAMES` 없이 id가 그대로 보이게 둔다(T1 이후 Judge가 한 줄 추가).
**Interfaces:** `DISTRICT_LAYERS`(레이어 표: `{ key, sourceId, title(VWorld 제목), kind: "district_area" | "plan_facility", cls }`) — 제목은 **open Q1 확정 후 채움**(그전에는 표를 비워 두고 `zoningLayerFiles` 방식 `latestShpPerSido(paths, fileTag)`로 파일 태그 기반 매칭). 타일: D11 면 `district:<cls>`, 지표 `back_area_<cls>`(교차면적 ㎡, 중첩 가능 → `share_` 대신 면적 막대), `fill_code_pct`; D12 면·선·점을 구분해 `back_area_<분류>`(면 ㎡)·`back_length_<분류>`(선 m)·`back_count_<분류>`(점 개)를 분류별로 따로. 지정/운영 구분은 원천 속성이 없으면 `unknown` 한계. 원천이 없으면 `notProvided(ctx, "D11", "구역·지구 레이어 미적재(dsId 24 다운로드 필요)")`.
- [ ] 테스트: `test-v2-districts.mjs` — 메모리 sqlite에 2레이어 픽스처 적재 → kind·props, D11/D12 타일이 픽스처에서 면·지표를 내고, 원천 없으면 `not_provided`에 사유 note.
- [ ] 구현 → 통과 → 커밋 `feat(v2-ingest): 구역·지구·도시계획시설 레이어 적재기와 D11·D12 도판(레이어 목록 확정 대기)`

---

## G3 — 화면·보고서 통합(순차)

### Task 18: S01 매스 그림·슬라이드

**Files:** Create `src/lib/v2/ui/mass-projection.ts`, `src/components/v2/mass-figure.tsx`; Modify `src/lib/v2/ui/tile-view.ts`(`TileView.mass: MassModel | null` — S01이면 장면 없이도 `presentation.camera`와 `conditions`로 모델 틀만; 실제 도형은 `Scene`에서 온다), `src/app/v2/page.tsx`(분석 결과 로드 시 `/scene`도 받아 `Board`에 전달, S01 카드가 `MassFigure` 표시), `src/components/v2/tile-card.tsx`(`Stage`: `view.code==="S01"`이면 `MassFigure`), `src/lib/v2/report/map-image.ts`(`rasterizeMass`), `src/lib/v2/report/report-plan.ts`(S01 장의 `mapKey = "<tileId>:mass"`), `src/lib/v2/report/render-pptx.ts`(부록 문구 "DXF·GLB는 내보내기에서" — 3D 파일을 PPT에 넣지 않음)
**Interfaces:**
- `mass-projection.ts`: `projectMass(scene: Scene, camera: {azimuthDeg, elevationDeg}, W, H): { faces: Array<{ path: string; shade: number; layer: "mass_source"|"mass_estimated"|"mass_unknown"|"ground"; depth: number }>; scale: number }` — 축측 투영: `x' = x·cosA − y·sinA`, `y' = x·sinA + y·cosA`, `sx = x'`, `sy = −(y'·sinE + z·cosE)`, depth = `y'·cosE − z·sinE`(작을수록 멀다 → 먼 것부터 그림, 건물 단위로 정렬 뒤 면은 지붕 마지막). 반경 원이 그림 높이 80%에 맞게 `scale`. 벽 음영은 법선과 광원(북서 상단) 내적.
- `MassFigure({ scene, camera, width, height, fixed })` SVG. 범례: 확보 높이/추정 높이/높이 미상. 북쪽 화살표는 투영된 +y 방향.
- [ ] 테스트 `test-v2-tile-s01-mass.mjs`: 정육면체 1동 → `faces` 중 지붕 1 + 보이는 벽 2(뒷면 컬링: 법선·시선 내적 ≤ 0 제외), 미상 건물은 `mass_unknown` 바닥면 1개, `renderToStaticMarkup(MassFigure)`에 `<path` 3개 이상, 먼 건물 path가 가까운 건물보다 먼저.
- [ ] 구현 → 통과 → `npm run lint` → 커밋 `feat(v2-ui): S01 축측 매스 그림과 슬라이드 1컷`

### Task 21: 내보내기 화면(DXF·GLB)

**Files:** Modify `src/app/v2/page.tsx`(헤더 "내보내기 ▾": PPT / DXF / GLB — 실제 분석일 때만, 장면 없으면 비활성 + 이유 "건물 도형 미적재"), Create `src/lib/v2/export/download.ts`(`downloadBytes(name, bytes|string, mime)` 순수 도우미, 기존 PPT 다운로드 코드도 이를 쓰게 정리)
- 내보내기 화면에 형식별 지원 대상을 적는다(spec §5.3): "DXF·GLB: 건물·필지·대지·반경. 래스터(항공사진·인구 격자·시뮬레이션 결과)는 대상 아님".
- [ ] 테스트 `test-v2-export-ui.mjs`: `download.ts`의 파일명·MIME 매핑(`application/dxf`, `model/gltf-binary`)만 단위 테스트(브라우저 DOM은 테스트하지 않음). Playwright 확인은 G4.
- [ ] 구현 → `npm run lint` → 커밋 `feat(v2-ui): DXF·GLB 내보내기 메뉴`

### Task 22: 레이어 스택 타일

**Files:** Create `src/lib/v2/ui/stack.ts`; Modify `src/lib/v2/ui/board-state.ts`, `src/lib/v2/ui/tile-view.ts`, `src/lib/v2/report/report-plan.ts`, `src/lib/v2/report/render-pptx.ts`, `src/app/v2/page.tsx`, `src/components/v2/tile-card.tsx`(스택 카드 제목 칩에 층 이름); Test `src/scripts/v2/test-v2-stack.mjs`
**Interfaces:**
- `board-state.ts`: `stacks: Record<string, string[]>`(스택 id → 층 타일 id, 위→아래 순), 액션 `{ type: "stack"; layers: string[] }`(id `stack:<n>`, `order` 끝에 추가, `included=true`, `faces="front"`, undo `{kind:"add"}` 재사용) / `{ type: "unstack"; id }`. `initBoard`는 `stacks: {}`. 저장 `board_json`에 그대로 들어간다.
- `stack.ts`: `stackView(id: string, layers: TileView[]): TileView` — `code:"STACK"`, `title: "레이어 스택"`, `kindLabel: "스택"`, `map`: features·polygons를 층 순서대로 이어 붙임(`total` 합), `notes: 층 이름 목록`, `sourceLine`: 층 `sourceLine`의 ` · ` 합집합(중복 제거), `badges`: 층 배지 합집합, `caveats`: 층 caveats 합집합, `hasFace:false`, `chart:null`, `headline: { value: `${layers.length}층`, label: layers.map(l=>l.title).join(" + ") }`. 도판·분석 타일만 층이 될 수 있다(시뮬레이션·다른 스택 제외 — reducer가 거른다).
- `report-plan.ts`: 스택은 일반 `tile` 장으로 계획(view가 이미 합성됨), `faceLabel: "스택"`, footer에 `출처 <합집합>`.
- `page.tsx`: 편집 모드에서 카드 체크(“스택에 넣기”) 2개 이상 → "스택 만들기" 버튼 → dispatch. 스택 카드는 편집 모드에서 "풀기".
- [ ] 테스트: `stackView`가 D02+D08 픽스처 뷰로 features·polygons 합·출처 합집합·notes 층 이름을 내고 금지어 없음; reducer: `stack` 뒤 `order` 끝에 id, `unstack`·`undo` 복원; `buildReportPlan`에 스택 장 1장, `reportPages`와 장수 일치; 스택 슬라이드 pptx XML(`test-v2-report.mjs` 방식 JSZip)에 층 이름과 두 출처가 모두 있음.
- [ ] 구현 → 통과 → 커밋 `feat(v2-ui): 레이어 스택 타일(보드·보고서)`

### Task 23: 조판(16:9에 2×2·3×2)

**Files:** Create `src/lib/v2/ui/sheet.ts`; Modify `board-state.ts`, `report-plan.ts`, `render-pptx.ts`, `map-image.ts`, `page.tsx`; Test `test-v2-sheet.mjs`
**Interfaces:**
- `board-state.ts`: `sheets: Record<string, { tiles: string[]; grid: "2x2" | "3x2" }>`, 액션 `{ type:"sheet"; tiles; grid }`(id `sheet:<n>`, order 끝, included) / `{ type:"unsheet"; id }`. `reportPages`: 조판은 1장(하위 타일이 따로 포함돼 있어도 그대로).
- `sheet.ts`: `sheetCells(grid): Rect[]`(슬라이드 inch, 제목 띠 0.66 아래·출처 띠 위, 셀 간격 0.15, 2×2는 각 16:9, 3×2는 4.2×3.0 — 지도는 `contain`), `sheetView(id, tiles: TileView[], grid): TileView`(`code:"STACK"`은 스택용이므로 조판은 `code:"SUMMARY"`를 쓰지 않고 `TileResultSchema`의 코드 정규식에 `^SHEET$`를 추가 — `tile-result.ts` 한 줄).
- `report-plan.ts`: `kind:"sheet"` 장: `{ cells: Array<{ view: TileView; face: "front"|"back"; mapKey: string }> }`, `mapKeyOf`가 조판 셀 키 `${tileId}:cell`을 모두 돌려주도록 `mapKeysOf(p): string[]`로 확장(기존 호출은 첫 키).
- `map-image.ts`: `buildMapImages`가 `mapKeysOf`를 돌며 셀 이미지는 `siteX 0.5`, `avoid []`, 범례는 셀 안에 그림(`legend:true`, `bare:false`).
- `render-pptx.ts`: `sheet(pptx, p, images)` — 셀마다 이미지(`sizing: { type:"contain" }`), 셀 왼쪽 위 작은 제목 칩(코드·제목·출력 면), 셀 아래 8pt 출처. 뒷면 셀은 `FaceChart`와 같은 막대를 셀 안에 그림.
- `page.tsx`: 편집 모드 "조판 만들기(2×2/3×2)" — 체크한 타일 순서대로.
- [ ] 테스트: `sheetCells("2x2")` 4칸이 슬라이드 안·겹침 없음·16:9 비율, `"3x2"` 6칸; reducer·`reportPages` 장수; `buildReportPlan` 조판 장 `cells.length===4`, `mapKeysOf` 4개 키; pptx XML에 4개 `<p:pic>`과 4개 제목 텍스트·출처.
- [ ] 구현 → 통과 → 커밋 `feat(v2-ui): 조판(2×2·3×2) 슬라이드`

---

## 데이터 운영 (사용자/운영자 실행 — 실행자는 명령만 준비)

잠금(`.cache/v2/data/.lock`, pid 1472, 버전 `2026-09-30g`)이 풀린 뒤, 순서대로:

1. `npm run data:build -- --version 2026-10-01a --only buildings --wait-lock` — GIS건물 17개 시도(약 2.2GB zip) → `buildings.sqlite`. 시간 미측정(P1a 필지 대표점 3,987만 건이 수 시간이었으므로 비슷하게 예상). 게시되면 D02~D07·S01·S02·장면이 켜진다.
2. T3 병합 뒤: `npm run data:build -- --version 2026-10-01b --only parcels --wait-lock` — 연속지적 3,987만 폴리곤(6.4GB zip). **크기 위험:** GeoJSON 텍스트 저장이라 20~40GB 예상. 빌드 전 `npm run tsx src/scripts/v2/parcels-dryrun.mjs -- --sido 36`(세종)으로 행당 바이트를 재고 전국 추정치를 `docs/superpowers/a0/`에 기록한다. 예산(D: 여유 326GB)을 넘으면 open Q3.
3. 게시 후 `npm run v2:review`(T1 이후 실행자가 `p1b-review.mjs`에 D·S01 타일 요약 열을 추가) — 8곳 상태·소요 시간·면 지물 수 표를 `docs/superpowers/a0/2026-10-xx-p2-review.md`에.
4. DXF·GLB 실제 확인(spec §6.2): 구룡역 분석 → DXF를 AutoCAD 호환(예: DWG TrueView/LibreCAD), GLB를 Blender/three.js viewer에서 열어 단위·원점·북쪽 방향을 확인하고 결과를 같은 문서에 적는다. **사용자 작업.**
5. Playwright(로그인 필요)로 `/site/v2` 캡처: 보드에 D 타일 면 지물, 뒷면 구성비, 스택·조판, 내보내기 메뉴 → `docs/design/p2/`.

## 열린 결정 (사용자)

| # | 결정 | 권고 기본값 | 영향 |
|---|---|---|---|
| Q1 | D11·D12에 쓸 VWorld dsId 24 레이어 제목 목록(수십 개 중). 권고: D11 = 지구단위계획구역·개발제한구역·택지개발예정지구·도시개발구역·산업단지(국가·일반·도시첨단·농공) / D12 = 도시계획시설 전 분류(교통·공간·유통공급·공공문화체육·보건위생·환경기초) | 사용자가 VWorld 로그인 후 `npm run vworld:fetch -- --ds 24 --layers "<제목,…>" --folder districts`. 제목은 페이지 목록에서 확인(`vworld-fetch`가 못 찾는 제목은 실패 목록으로 알려 준다) | T16 데이터, D11·D12 제공 시점 |
| Q2 | D13 도로 원천. Judge 결정: Geofabrik OSM free SHP `gis_osm_roads_free_1`를 사용하고 기존 SHP reader를 재사용한다(PBF·새 의존성 없음). | **해결** — P2에서 D13 부분 제공. OSM 커버리지·갱신 시점과 공식 도로대장 아님을 표시 | D13, D15 가구(P3) |
| Q3 | parcels 파일 저장 형식 — GeoJSON 텍스트(현행) vs 좌표 정밀도 낮춤(10cm) vs WKB 전환. 드라이런 실측 후 결정 | 세종 드라이런 실측 → 전국 40GB 이하면 현행 유지, 넘으면 `roundM: 0.1` | 디스크·빌드 시간 |
| Q4 | DXF 좌표 원점 | 기본 대지 중심(0,0), 옵션 `utmk`(절대좌표) 둘 다 제공, 화면 기본은 대지 중심 | CAD 배치 편의 |
| Q5 | D03 주용도코드 → 10분류 매핑표(위 T6 표) | 표 그대로. 다르게 묶을 코드가 있으면 `USE_CLASSES` 한 곳만 바꾼다 | D03 구성비 |
| Q6 | D20 필지 규모의 면적 기준 — 공부면적(연속지적 SHP에 없음) 대신 도형 계산 면적 | 도형 면적 사용 + 한계 표시. 공부면적은 토지대장/토지특성 API(별도 원천)라 P4 | D20 라벨 |
| Q7 | GLB 세부 수준 — 건물 상한 5,000동(가까운 순), 재질 3종(확보/추정/미상), 지반 원판. 층별 분할·창·지붕 형태 없음 | 그대로(질감·LOD는 3DM과 함께 P3) | 파일 크기(≈5,000동 × 20정점 ≈ 3MB) |
| Q8 | 도판 뒷면 표현 — 가로 막대(현 D04 스타일) 통일, 중첩 구역은 막대에 "합계 100% 아님" 주석 | 통일 | 화면·PPT |
| Q9 | S01 카메라 — 남서 상공 축측(방위 225°, 앙각 35°) 고정 1컷 | 고정(카메라 UI는 P3) | 슬라이드 |
| Q10 | D09의 "운영 공원 면적"을 지목 '공' 면적으로 대신 표기 | 대신 표기(라벨 "공원 지목")하고 원천 `areaM2`는 별도 지표 | D09 |
| Q11 | 실행자: Luna(codex) 샌드박스가 이 PC에서 tsx·git을 막으면 Sonnet으로 자동 전환 허용 | 허용, 보고서에 기록 | 전체 |

## 차단 항목 요약

- **D13 도로**: Q2 해결. Geofabrik OSM free SHP를 `osm_roads` reference source로 적재하고 카탈로그·범례·타일을 부분 제공한다. OSM은 공식 도로대장이 아니며 coverage/currency 한계를 표시한다.
- **D11·D12**: 코드는 T16으로 준비, 데이터는 Q1 뒤 다운로드.
- **D01 항공사진·D10 수목·D26 통학구역·A02 배정 학교**: 계획 범위 밖(P4, spec §6.2 허용).
- **데이터 빌드**(buildings·parcels): 잠금 해제 후 운영자 실행. 코드 작업은 픽스처로 진행되므로 차단되지 않는다.

## 자체 검토 결과

- spec §6 P2 행 대조: A02(학구 제외) ✔ 현행, A11 ✔, A12 T8, 도판 18종 중 16종 작업·D13 부분 제공·2종(D11·D12) 코드 준비, 구성비 T1, 단순 스택 T22, 조판 T23, DXF T19+T21, S01 T17+T18, GLB T20+T21, 장면(평탄 지반) T4a/T4b.
- 이름 일관성: `buildingRows`/`buildingsReady`(T1) ← T5·T6·T7·T17·T4b, `areaInCircle`(T1) ← T5·T9·T10·T15, `collectZoning`(T8)·`collectMaintenance`(T12)·`collectTrades`(T14)는 각 작업 안에서만 쓰임, `Scene`·`toLocalRing`(T4a) ← T4b·T18·T19·T20, `mapKeysOf`(T23)가 `mapKeyOf`를 대체할 때 T18의 `":mass"` 키 유지.
- Review Focus 5개는 각각 T7·T18·T20 / T1·T9 / T3·T8·T9 / T19·T20 / T22·T23 테스트에 들어 있다.

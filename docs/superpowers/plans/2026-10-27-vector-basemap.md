# 벡터 바탕지도 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 타일 지도 밑에 깔리는 바탕을 VWorld 래스터에서 우리 벡터 바탕(건물·필지·도로·철도·녹지·물·이름 라벨)으로 바꾸고, 화면(SVG)과 PPT(편집 가능한 묶음 도형)에 같은 모양으로 그린다.

**Architecture:** 분석 때 만드는 `Scene`(로컬 미터, EPSG:5179 원점)에 이름·철도·녹지 분류·지명을 보강한다(Task 1). 바탕 테마 토큰(Task 2)과 `Scene → MapBase(WGS84)` 변환을 두고, `buildMapScene`이 이를 화면 픽셀의 **묶음(bucket)** 경로와 라벨로 만든다(Task 3). `MapFigure`(SVG)와 `map-pptx`(PPT)가 같은 묶음을 그린다(Task 3·4). 묶음 하나 = SVG path 하나 = PPT custGeom 하나.

**Tech Stack:** Next.js/React SVG, TypeScript, zod, proj4(`src/lib/v2/crs.ts`의 `toLngLat`), pptxgenjs, 테스트는 `src/scripts/v2/test-v2-*.mjs`(tsx).

**Spec:** `C:\Users\da\.claude\plans\declarative-painting-sunrise.md`(1단계 T2·T3, 바탕 레이어 목록), 결정 페이지 https://claude.ai/artifact/SqspZu2gaoWHwuGjzagVJH (시안 A/B/C 색값), 근거 캡처 `docs/research/archimap-2026-10-27-site-report/`, 스파이크 결과(아래 Global Constraints).

## Global Constraints

- 상위 목표: 주소 하나로 대지분석 PPT 자동 생성(v2) > 아키맵 Site report 수준의 도판 품질, 화면 상호작용·PPT 편집성 유지 > 1단계 벡터 바탕.
- 바탕은 **중성**이다. 건물은 한 색. 용도·높이 같은 주제 색은 타일 레이어(D03·D05 등)만 쓴다(사용자 지적 2026-10-27).
- 기본 바탕 테마는 `warm`(시안 A, 임시 기본값 — 실제 슬라이드 비교 후 사용자가 확정). 테마 값은 Task 2 표 그대로.
- 묶음 도형: PPT에서 바탕 레이어 하나(예: 건물)는 custGeom **하나**(다중 경로). 바탕 묶음은 `MAX_LAYER_ELEMENTS`(1500) 상한 대상이 아니다. 스파이크(대치동 503, 건물 1,789·필지 1,297·도로 540): 도형 20개, PowerPoint 열기 1.9 s, 1.85 MB.
- 화면 문구는 한국어, 내부 코드·영문 식별자를 사용자에게 보이지 않는다. PPT 도형 이름(`GRP|…`)의 표시명도 한국어.
- 범례는 지도 아래 띠(기존 규칙). 바탕 레이어는 범례에 넣지 않는다.
- 지원 폭 1024 px 이상(PC·태블릿 가로). 모바일 QA 안 함.
- 작업 중에는 관련 테스트만(`npx tsx src/scripts/v2/<file>.mjs`), 커밋 직전 `npm run test:v2` 전체와 `npm run lint`(tsc) 1회.
- 커밋은 로컬 브랜치 `v2-cartography`에만. push·배포 금지.
- 다른 실행자의 변경을 되돌리지 않는다. 자기 Task의 파일만 고친다.

## Review Focus

1. **장면이 없거나 옛 장면(새 필드 없음)인 분석** — 지도가 깨지지 않고 예전처럼(VWorld `white`) 그려져야 한다. → Task 3 `base-fallback` 테스트.
2. **값 래스터 타일(S02 일조, D29 하늘열림, D18 경사) PPT** — 래스터가 바탕 도형에 가려지지 않아야 한다(바탕 도형 → 투명 PNG 래스터 → 주제 도형 순서). → Task 4 `z-order` 테스트.
3. **철도·도로·필지를 직접 그리는 타일(A01·A10 철도, D13 도로, D19 필지)** — 바탕 같은 레이어와 이중으로 그리지 않는다. → Task 3 `suppress` 테스트.
4. **라벨이 방위표·축척 막대·대지 표식·주제 라벨과 겹치거나 지도 밖으로 잘림** — 겹침 0, 잘림 0. → Task 3 `label-boxes` 테스트.
5. **보고서 장의 확대·이동(zoomDelta·offsetM)과 조판 칸(sheet cell)** — 바탕이 주제 레이어와 같이 움직여야 한다(같은 projector 사용). → Task 4 `cell-mode` 테스트, Judge 실렌더.

---

### Task 1: Scene 보강 — 도로 이름·녹지 분류·철도·역·지명

**Files:**
- Modify: `src/lib/v2/scene.ts` (타입·zod 스키마, 모두 optional 추가 — `SCENE_VERSION` 유지)
- Modify: `src/lib/v2/engine/scene.ts` (`buildSceneContext`, `buildTopoSceneContext`)
- Create: `src/scripts/v2/test-v2-scene-basemap-context.mjs`
- 필요하면 Modify: `src/scripts/v2/engine-fixture.mjs` (참조 자료 지물 추가)

**Interfaces:**
- Produces (모두 optional, 옛 장면은 없음):
  - `SceneRoad.name?: string | null`
  - `export type GreenKind` (scene.ts에서 export — Task 3이 import)
  - `SceneContext.greenKinds?: GreenKind[]` — `green`과 **같은 길이·순서**. `type GreenKind = "forest" | "park" | "grass" | "orchard"` (`ingest/sources/osm-landuse.ts`의 `GREEN_CLASSES`와 같은 값, 지물 `properties.cls`에서 읽음, 없으면 `"park"`)
  - `SceneContext.rail?: SceneRail[]` — `{ points: [number, number][]; color: string; lineRef: string; name: string }` (reference `rail_line`, 원 안으로 자름, `properties.color`·`properties.lineRef`·`name`)
  - `SceneContext.stations?: SceneStation[]` — `{ name: string; x: number; y: number; color: string }` (reference `rail_station`, `properties.lineColors[0]` 없으면 `"#555555"`)
  - `SceneContext.places?: ScenePlace[]` — `{ name: string; kind: "dong" | "park"; x: number; y: number }` (core `legal_emd`는 원 안으로 자른 면의 무게중심, reference `park`는 점 좌표)
- 좌표는 기존과 같이 로컬 미터(`localContextPath`·`toLocalRing`과 같은 방식).
- 새 원천은 `scene.sources`에 들어가야 한다(`ctx.sources(...)`로 찾은 것). 원천이 없으면 해당 필드를 넣지 않는다(빈 배열 아님).

- [ ] **Step 1: 실패하는 테스트** `test-v2-scene-basemap-context.mjs` — 픽스처에 이름 있는 도로 1개, 이름 없는 도로 1개, 숲·공원 면 각 1개, `rail_line`(color `#ED6C00`, lineRef `3`) 1개, `rail_station` 1개, `park` 점 1개, `legal_emd` 면 1개를 넣고 `buildScene`:
  - `scene.context.roads.find(r => r.name === "<이름>")` 존재, 이름 없는 도로는 `name === null`
  - `scene.context.greenKinds.length === scene.context.green.length`, 값에 `"forest"`와 `"park"` 포함
  - `scene.context.rail[0].color === "#ED6C00"`, `lineRef === "3"`, 모든 점이 반경+1 m 안
  - `scene.context.stations[0].name`이 픽스처 역 이름
  - `scene.context.places`에 `kind: "dong"` 1개, `kind: "park"` 1개
  - `parseScene(JSON.parse(JSON.stringify(scene)))`가 통과
  - 새 필드를 지운 옛 장면 객체도 `parseScene` 통과(하위 호환)
- [ ] **Step 2:** `npx tsx src/scripts/v2/test-v2-scene-basemap-context.mjs` → FAIL 확인
- [ ] **Step 3:** 스키마·타입 추가, `buildSceneContext`에서 각 hit을 읽어 채움. 토포 장면(`buildTopoSceneContext`)도 같은 보강을 공유 함수로.
- [ ] **Step 4:** 위 테스트 PASS, `test-v2-scene-build.mjs`·`test-v2-scene-contract.mjs` PASS
- [ ] **Step 5:** 보고서에 적기: 기존 분석의 장면을 다시 만드는 경로(새로고침이 장면을 다시 만드는지)와 `SCENE_MAX_*` 상한이 새 필드에 필요한지 판단 근거.
- [ ] **Step 6:** 커밋 `feat(v2): 장면에 도로 이름·녹지 분류·철도·역·지명 보강`

### Task 2: 바탕 테마 토큰

**Files:**
- Create: `src/lib/v2/ui/map-theme.ts`
- Modify: `src/lib/v2/ui/board-state.ts` (보드에 바탕 테마 선택 저장)
- Create: `src/scripts/v2/test-v2-map-theme.mjs`

**Interfaces:**
- Produces:
  ```ts
  export type BaseThemeId = "warm" | "cool" | "paper";
  export type BaseTheme = {
    id: BaseThemeId; name: string; // 사용자 표시명
    bg: string;
    building: { fill: string; line: string; lineWidthPx: number };
    parcel: { line: string; lineWidthPx: number; opacity: number; maxMPerPx: number };
    road: { fill: string; casing: string; casingM: number; widthScale: number; minWidthPx: number };
    green: { forest: string; park: string; grass: string };
    water: string;
    rail: { widthPx: number; dash: string; opacity: number };
    station: { fill: string; line: string; radiusPx: number };
    label: { road: string; place: string; park: string; station: string; halo: string; fontPx: number };
    site: { fill: string; fillOpacity: number; line: string; lineWidthPx: number; haloPx: number };
  };
  export const BASE_THEMES: Readonly<Record<BaseThemeId, BaseTheme>>;
  export const DEFAULT_BASE_THEME: BaseThemeId; // "warm"
  export function baseTheme(id?: string | null): BaseTheme; // 모르는 id → 기본
  ```
- BoardState에 `baseTheme?: BaseThemeId`, 액션 `{ type: "baseTheme"; id: BaseThemeId }`, 직렬화·역직렬화 포함(없으면 기본).

**값 (결정 페이지 그대로):**

| | warm (따뜻한 베이지) | cool (차가운 회색) | paper (흰 종이) |
|---|---|---|---|
| bg | #f6f4ef | #f2f3f5 | #ffffff |
| building fill / line | #e4ddd0 / #c2b9a8 | #dcdfe4 / #b4b9c1 | #e9e7e2 / #bdb8ae |
| parcel line | #d6cebf | #d8dce1 | #ebe8e2 |
| road fill / casing | #ffffff / #e4ded3 | #ffffff / #dde1e6 | #f0eee9 / #f0eee9 |
| green forest / park / grass | #cddcbd / #dfe8d2 / #e8eedd | #cad9c4 / #dce6d8 / #e5ece2 | #d6e2c8 / #e6eddc / #eef3e7 |
| water | #cfe1ea | #d2e0ea | #dde8ee |
| site fill / opacity / line / halo | #f2b6b8 / 0.35 / #c9404a / 0 | #ffffff / 0 / #111111 / 5 | #ffd76a / 0.45 / #111111 / 4 |

공통: building.lineWidthPx 0.4, parcel.lineWidthPx 0.6·opacity 0.7·maxMPerPx 2.5(이보다 축소하면 필지선 생략), road.casingM 0.8·widthScale 1·minWidthPx 0.6, rail 1.5 px·dash "6 5"·opacity 0.6, station fill #ffffff·line #333333·radius 3.5 px, label road #6b655b·place #736c60·park #557447·station #2b2b2b·halo = 테마 bg·fontPx 11, site.lineWidthPx 2.

- [ ] **Step 1: 실패하는 테스트** `test-v2-map-theme.mjs`: 세 테마 모든 색이 `/^#[0-9a-f]{6}$/i`; `baseTheme("x").id === "warm"`; 각 테마에서 `label.road`·`label.place`·`label.park`·`label.station`이 모두 `bg` 대비 4.5:1 이상(상대 휘도 계산 함수는 테스트 안에 둠); 건물 fill이 bg와 다름; 보드 상태 `baseTheme` 액션 후 직렬화→역직렬화 왕복이 같은 값.
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS + `test-v2-ui-board-state.mjs` PASS
- [ ] **Step 5:** 커밋 `feat(v2): 바탕 테마 토큰(warm·cool·paper)과 보드 선택`

### Task 3: MapBase 변환 + 화면 SVG 바탕

**Files:**
- Create: `src/lib/v2/ui/basemap.ts`
- Modify: `src/lib/v2/ui/map-layers.ts` (`MapModel.base?`)
- Modify: `src/lib/v2/ui/map-projection.ts` (`BasemapChoice`에 `"vector"`, `BASEMAP_STACK.vector = []`)
- Modify: `src/lib/v2/ui/tile-view.ts` (`toTileView`에서 `map.base` 채움)
- Modify: `src/lib/v2/ui/map-scene.ts` (`MapSceneOptions.baseTheme?`, `MapScene.base`)
- Modify: `src/components/v2/map-figure.tsx` (그리기, 기본 바탕 결정)
- Modify: MapFigure를 쓰는 곳 중 보드 카드·펼침·보고서 표면(`map-box.tsx`, `detail-window.tsx`, `report/slide-surface.tsx`)에 `baseTheme` 전달
- Create: `src/scripts/v2/test-v2-basemap-scene.mjs`

**Interfaces:**
- Consumes: Task 1 `Scene` 필드, Task 2 `BaseTheme`·`baseTheme()`.
- Produces:
  ```ts
  // basemap.ts
  export type BaseLayerKind = "water" | "green" | "parcel" | "road" | "rail" | "building" | "station";
  export type MapBase = {
    buildings: LngLat[][][]; parcels: LngLat[][][]; water: LngLat[][][];
    green: { kind: GreenKind; rings: LngLat[][] }[];
    roads: { hierarchy: string; widthM: number; name: string | null; points: LngLat[] }[];
    rail: { color: string; points: LngLat[] }[];
    stations: { name: string; p: LngLat; color: string }[];
    places: { name: string; kind: "dong" | "park"; p: LngLat }[];
  };
  export function mapBaseFromScene(scene: Scene): MapBase; // WeakMap 메모: 같은 scene 객체 → 같은 결과 객체
  export const BASE_SUPPRESS: Readonly<Record<string, readonly BaseLayerKind[]>>; // A01·A10: ["rail","station"], D13: ["road"], D19: ["parcel"]
  // map-scene.ts
  export type MapSceneBaseBucket = { key: string; layer: BaseLayerKind; display: string; closed: boolean; paths: Array<Array<[number, number]>>; fill: string | null; stroke: string | null; strokeWidth: number; dash?: string; opacity?: number };
  export type MapSceneBaseLabel = { key: string; kind: "road" | "place" | "park" | "station"; text: string; x: number; y: number; angle: number; fontSize: number; color: string; halo: string; box: MapSceneBox };
  // MapScene에 추가
  base: { bg: string; buckets: MapSceneBaseBucket[]; labels: MapSceneBaseLabel[] } | null;
  ```
- 변환: 로컬 미터 + `scene.origin.x/y` → `toLngLat`(crs.ts). 옛 장면(새 필드 없음)은 해당 배열 빈 값.
- 묶음 순서(아래→위): water → green(forest, park, grass 각 1묶음) → parcel → road casing(위계별, 폭 오름차순) → road fill(같은 순서) → rail(노선색별) → building → station. `display`는 한국어("건물", "필지선", "도로", "도로 테두리", "철도", "역", "숲", "공원", "잔디", "물").
- 도로 폭(px) = `max(minWidthPx, widthM × widthScale / mPerPx)`, 테두리는 `+ casingM / mPerPx`.
- 필지선은 `mPerPx > parcel.maxMPerPx`면 묶음 생략.
- 라벨: `compact`이거나 지도 폭 < 600 px면 없음. 우선순위 역 > 동 > 공원 > 도로(위계 간선→보행, 같은 위계는 긴 것 먼저). 도로 라벨은 이름별 가장 긴 선의 가운데 구간, 글자가 뒤집히지 않게 각도를 −90~90°로, 선 길이 ≥ 글자 폭 × 1.2일 때만. 기존 점유 상자(방위표·축척·대지 표식·철도 라벨·주제 라벨)와 서로 겹치면 버린다. 상자가 지도 밖으로 나가면 버린다.
- 기본 바탕 결정(MapFigure): 결과가 지정한 `model.basemap`(D01·D10 위성) > 사용자가 고른 layer > `model.base`가 있으면 `"vector"` > `"white"`.
- SVG: `"vector"`면 WMTS 타일 대신 `bg` 사각형 + 묶음별 `<path>` 하나(`fill-rule="evenodd"`, `pointer-events:none`), 라벨은 바탕 묶음 바로 위·주제 레이어 아래, `paint-order: stroke` halo.
- 대지 필지: `"vector"`일 때만 `theme.site`(채움·불투명도·선·halo)로 그린다. 중심 마름모 등 나머지 대지 표식은 그대로. VWorld 바탕일 때는 지금과 같다.
- 영역 밖: 장면 자료가 반경 원 안으로 잘려 있으므로 원 밖은 `bg`만 남는다(별도 마스크 없음).
- 이 계획 밖: 등고선·행정경계 바탕 레이어, 레이어별 켜고 끄기·색 바꾸기 UI, 다이어그램 팔레트(T6 — 시안 뒤 별도 계획), 방위표·축척·치수선(T5).

- [ ] **Step 1: 실패하는 테스트** `test-v2-basemap-scene.mjs` (작은 손 장면 객체로):
  - `base-convert`: 원점 (0,0) → `[scene.origin.lng, scene.origin.lat]` 오차 1e-7 이내; 같은 scene으로 두 번 부르면 같은 객체(`===`)
  - `base-buckets`: 묶음 `layer` 순서가 위 순서와 같다; 건물이 여러 동이어도 building 묶음은 1개
  - `suppress`: `tileCode: "A01"` 모델은 rail·station 묶음 없음, `"D19"`는 parcel 없음, `"D13"`은 road 없음
  - `parcel-scale`: mPerPx 3이면 parcel 묶음 없음
  - `label-boxes`: 라벨 상자 서로 겹침 0, 모든 상자가 `[0,W]×[0,H]` 안, 방위표·축척 상자와 겹침 0; `compact: true`면 라벨 0개
  - `base-fallback`: `model.base` 없음 → `scene.base === null`이고 기존 결과와 같은 tiles
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현 (basemap.ts → map-layers/projection → tile-view → map-scene → map-figure → 호출부 테마 전달)
- [ ] **Step 4:** 새 테스트 PASS, 관련 기존 테스트 PASS(`test-v2-map-*`, `test-v2-report-preview.mjs` 등 바꾼 파일을 import하는 것)
- [ ] **Step 5:** 커밋 `feat(v2): 벡터 바탕 묶음·라벨과 화면 렌더`

### Task 4: PPT 바탕 도형 + 래스터 순서

**Files:**
- Modify: `src/lib/v2/report/map-pptx.ts` (바탕 묶음·라벨 그리기 함수)
- Modify: `src/lib/v2/report/render-pptx.ts` (tile·sheet cell·cover 장의 그리기 순서)
- Modify: `src/lib/v2/report/map-image.ts` (vector일 때 배경 이미지 = 바탕 제외, 투명 PNG, 그릴 것이 없으면 이미지 생략)
- Create: `src/scripts/v2/test-v2-ppt-vector-basemap.mjs`

**Interfaces:**
- Consumes: Task 3 `MapScene.base`(`buckets`, `labels`, `bg`).
- Produces: `addBaseMap(slide, scene, frame): void` (map-pptx.ts) — 지도 프레임 안에 bg 사각형 1개 + 묶음당 custGeom 1개(`addCustom` 재사용, 바탕 묶음은 `capNativePath` 꼭짓점 상한을 적용하지 않고 0.25 px 허용오차로 단순화) + 라벨 텍스트 상자(회전 포함). 이름 `GRP|map-base-<layer>|<display>|<part>`.
- 장 그리기 순서: `addBaseMap` → 배경 이미지(값 래스터·밀집 층만, PNG 알파) → `addEditableMap`(주제). vector가 아니면 지금과 같다.

- [ ] **Step 1: 실패하는 테스트** `test-v2-ppt-vector-basemap.mjs` (`renderReportPptx`를 손 장면으로 호출하고 JSZip으로 slide XML 검사):
  - `bucket-shapes`: 바탕 건물이 N동이어도 `GRP|map-base-building` 도형은 1개
  - `z-order`: 값 래스터가 있는 장에서 XML 순서가 `map-base-*` 도형 < `<p:pic>` < 주제 도형; 래스터 그림은 PNG
  - `no-picture`: 래스터·밀집 층이 없는 vector 장에는 `<p:pic>`(지도 배경) 없음
  - `cell-mode`: sheet 칸에서도 바탕 묶음이 칸 프레임 안(도형 x·y·w·h가 칸 상자 안)
  - `fallback`: 장면 없는 분석은 지금과 같은 배경 이미지(JPEG) 1장
- [ ] **Step 2:** FAIL 확인
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 새 테스트 PASS + `test-v2-ppt-editable-maps.mjs`·`test-v2-report.mjs`·`test-v2-report-doc-pptx.mjs` PASS
- [ ] **Step 5:** 전체 `npm run test:v2`, `npm run lint` PASS
- [ ] **Step 6:** 커밋 `feat(v2): PPT 벡터 바탕 묶음 도형과 래스터 투명 PNG`

### Task 5: Judge 실렌더 QA (실행자 아님)

- [ ] dev 서버(한 번 띄워 재사용)에서 대치동 503(새 분석 1회 — 새 장면 필드) 33타일 카드·펼침·보고서 미리보기를 1440·1280·1024 캡처, `my-design-taste` measure(`--widths 1440,1280,1024`)
- [ ] PPT 내보내기 → PowerPoint SaveAs PNG(Start-Job 타임아웃)로 실렌더, 픽셀 확인, 미리보기와 나란히 비교, 파일 크기·열기 시간 기록
- [ ] 실제 장(11 대지 개요 또는 14 높이·층수에 해당하는 D05 장)에 warm·cool·paper 세 테마를 나란히 놓은 비교를 아키맵 같은 쪽과 함께 사용자에게 제시 → 기본 테마 확정 → `docs/design/v2-design-language.md`에 기록

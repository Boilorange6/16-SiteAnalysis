# 분석 장(지도 + 그래프) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보고서 타일 장에 B안 레이아웃 「지도 + 그래프」를 더한다. 오른쪽 열은 위에서부터 큰 숫자 · 한 줄 통계 · 구성비 막대 · 거리 그래프 · 해석 문장이다. 같은 그래프가 화면 미리보기에는 SVG로, PPT에는 편집 가능한 도형으로 그려진다.

**Architecture:** 세 층으로 나눈다.
1. **그래프 자료**(순수 함수): `MapModel`에서 구성비·거리 자료를 계산한다.
2. **그래프 기하**(순수 함수): 자료와 상자(인치)를 받아 도형 목록 `ChartShape[]`를 만든다.
3. **두 렌더러:** `slide-surface.tsx`(SVG)와 `render-pptx.ts`(pptxgenjs)가 같은 `ChartShape[]`를 그대로 그린다. 그래서 미리보기와 PPT가 구조상 같다.

산점도 값은 엔진이 지물마다 `value`로 실어 보낸다. 1차 대상은 D05·D04·A07이다.

**Tech Stack:** Next.js(React) · TypeScript · pptxgenjs · zod(tile-result) · node:assert 테스트(`npx tsx src/scripts/v2/<file>.mjs`, 전체 `npm run test:v2`)

**Spec:** `docs/superpowers/specs/2026-10-27-analysis-page-design.md`(사용자 승인 2026-10-27). 시안: https://claude.ai/artifact/P1GbFUq7P6CrkztAkYC38k (B안). 시안 소스(그래프 모양의 출처): `C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/b55c10bb-d12c-4db2-9c95-25579c8ef4f7/scratchpad/datapage/page.src.html`(`compBars`, `scatter`, `bandBars`).

**순서 조건:** T6 지도 색 계획(`docs/superpowers/plans/2026-10-27-map-colors.md`)이 끝난 뒤 시작한다. 두 계획이 `slide-surface.tsx`·`render-pptx.ts`·`map-layers.ts`·`tile-view.ts`를 함께 고친다.

## Global Constraints

- **기존 레이아웃 출력은 그대로다.** `map-full`·`map-summary`·`numbers-first` 장의 화면·PPT 출력이 바뀌지 않는다. 기존 테스트 기대값을 바꾸지 않는다.
- **이미 저장된 보고서의 쪽 레이아웃은 바꾸지 않는다.** 새로 만드는 추천 구성(`recommendedPages`·새 타일 쪽)에서만 그래프 자료가 있으면 `map-charts`가 기본이다.
- **그래프는 지도를 가리지 않는다.** 오른쪽 요약 칸(`summary` 사각형) 안에만 그린다.
- **PPT 그래프는 도형이다.** `<p:pic>`이 아니며, 도형 이름은 `GRP|chart-<종류>-…`다.
- 사용자 문구는 한국어로 쓴다. 축·라벨에 내부 id·레이어 키·영문이 나오지 않는다.
- 라벨(바탕 이름 라벨·주제 말풍선·지시선)과 범례 표현은 바꾸지 않는다. 범례 기본 위치는 지금 기본값(`placement: "below"`)을 그대로 쓴다.
- 자료 한계 문구(`view.caveats`·`view.notes`)는 `map-charts` 장에 그리지 않는다. 대신 PPT 발표자 노트에 모두 싣고, 화면은 `주석 N` 칩으로 보인다. 배지(`view.badges`)는 그대로 장에 둔다.
- 엔진 출력이 바뀌는 타일(D05·D04·A07)은 `src/lib/v2/engine/tiles/common.ts` `TILE_CACHE_REVISION`에 `+chart-value-r1`을 붙인다.
- 지원 폭은 1024 px 이상이다. 화면 QA는 띄워 둔 dev 서버를 쓴다.
- 브리프 공통: 상위 목표 줄을 넣는다. 작업 중에는 관련 테스트만 돌리고, 마지막에 전체를 1회 돌린다. UI 작업은 `ui-ux-pro-max`·`my-design-taste`를 적용한다. 보고서 끝에 `skill 후보:`·`taste 후보:` 줄을 둔다.

## Review Focus

1. **값이 없는 옛 분석(캐시된 결과):** `value`가 하나도 없으면 산점도 대신 거리대 막대로 그리고 오류가 나지 않는다 → Task 2 테스트.
2. **지물이 0개거나 범례가 1개뿐인 타일:** 그래프 자료가 `null`이면 `map-charts`를 고를 수 없다(레이아웃 창에 안 보임). 저장된 `map-charts` 쪽이 자료를 잃으면 「지도 + 요약」 내용으로 그린다 → Task 4 테스트.
3. **점 2,000개 초과(D05 1 km 대도시):** 거리순 균등 표본으로 2,000개만 그리고, PPT 도형 수는 색마다 1개다 → Task 2·5 테스트.
4. **글자 크기 설정을 키운 쪽(`fontSizes.summary` 24 pt):** 오른쪽 열 항목이 칸 밖으로 넘치지 않는다. 그래프가 줄어들고, 해석 문장은 줄 수 상한 안에서 줄인다 → Task 4·5 테스트.
5. **미리보기와 PPT의 그래프가 같다:** 같은 `ChartShape[]`이므로 텍스트·색·좌표가 일치한다 → Task 5 테스트(화면 SVG 글자 집합 = PPT 글자 집합).

---

### Task 1: 엔진이 지물 값을 실어 보낸다

**Files:**
- Modify: `src/lib/v2/tile-result.ts` — `MapFeatureSchema`(50행)와 `MapPolygonSchema`(116행)에 `value: z.number().finite().nullable().optional()`. `presentation`에 `valueAxis: z.object({ label: z.string().min(1), unit: z.string(), countUnit: z.string().min(1) }).optional()`.
- Modify: `src/lib/v2/tile/d05/engine.ts`
  - `polygonsFor`(46행)가 만드는 면에 `value`를 넣는다: 확인된 지상 층수는 그 값, 층수 미상·1층 가정은 `null`.
  - presentation에 `valueAxis: { label: "지상 층수", unit: "층", countUnit: "동" }`.
- Modify: `src/lib/v2/tile/d04/engine.ts` — 면 `value` = 사용승인 연도(미상 null), `valueAxis: { label: "사용승인 연도", unit: "년", countUnit: "동" }`.
- Modify: `src/lib/v2/tile/a07/engine.ts` — 점(243행 부근) `value` = ㎡당 중앙값(만원, `weight`와 같은 수), `valueAxis: { label: "㎡당 가격", unit: "만원", countUnit: "단지" }`.
- Modify: `src/lib/v2/engine/tiles/common.ts` — D05·D04·A07의 `TILE_CACHE_REVISION` 값 끝에 `+chart-value-r1`.
- Modify: `src/lib/v2/ui/map-layers.ts` — `MapModel`에 `valueAxis?: { label: string; unit: string; countUnit: string }`.
- Modify: `src/lib/v2/ui/tile-view.ts` — 결과 → 모델 변환(155행 부근)에서 `presentation.valueAxis`를 모델로 옮긴다.
- Test: `src/scripts/v2/test-v2-tile-d05-height.mjs`, `test-v2-tile-d04-years.mjs`, `test-v2-tile-a07-trades.mjs`(각각 확장), `src/scripts/v2/test-v2-chart-value-contract.mjs`(신규: 스키마)

**Interfaces:**
- Produces: `MapPolygon.value?`, `MapFeature.value?`, `TileResult.presentation.valueAxis?`, `MapModel.valueAxis?` — Task 2가 읽는다.

- [ ] **Step 1: 실패 테스트.**
  - 스키마: `value: 12`·`null`·없음은 통과하고, `"12"`·`NaN`은 실패한다. `valueAxis`에 `countUnit`이 빠지면 실패한다.
  - D05 픽스처: 층수 확인 건물의 면 `value`가 그 층수와 같다. `floors_assumed_1f_est`·`floors_unknown` 면은 `value === null`이다. `presentation.valueAxis.unit === "층"`이다.
  - D04: `bldg_unknown` 면만 `null`이고, 나머지 `value`는 1900–2100 사이 정수다.
  - A07: 모든 `trade_q*` 점에서 `value === weight`이다.
  - `toTileView`를 거친 `view.map.valueAxis`가 결과와 같다.
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-chart-value-contract.mjs` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위 4개 파일 + `test-v2-d04-s02.mjs` PASS
- [ ] **Step 5: 커밋** `feat(v2): 그래프용 지물 값(D05 층수·D04 연도·A07 ㎡당 가격)`

### Task 2: 그래프 자료

**Files:**
- Create: `src/lib/v2/report/analysis-charts.ts`
- Test: `src/scripts/v2/test-v2-analysis-charts.mjs`

**Interfaces:**
- Consumes: Task 1 `MapModel.valueAxis`, 지물 `value`, 기존 `legendItemsForModel(model)`(색·이름·레이어). T6 이후라면 `modelLayerStyle`도 쓴다. 범례 색은 `legendItemsForModel`이 이미 팔레트를 반영한다.
- Produces:
  ```ts
  export type CompositionItem = { label: string; color: string; count: number; share: number }; // share 0..1
  export type DistanceData =
    | { kind: "scatter"; axis: { label: string; unit: string }; points: { d: number; v: number; color: string }[]; median: number; mean: number; max: number; site: number | null; sampled: boolean }
    | { kind: "bands"; bands: { from: number; to: number; count: number }[] };
  export type AnalysisCharts = { radiusM: number; total: number; countUnit: string; subject: string; missing: number; composition: CompositionItem[]; distance: DistanceData };
  export function analysisCharts(model: MapModel): AnalysisCharts | null;
  export function analysisStatLine(c: AnalysisCharts): string;
  ```

규칙:
- **세는 대상:** 반경 안(`model.center`에서 지물 대표점까지 거리 ≤ `model.radiusM`)의 점·면 지물 가운데 범례 항목에 속한 것. 대지 레이어와 래스터 층은 뺀다. 면의 대표점은 첫 고리의 면적 중심이고, 거리는 미터(기존 `metersPerPixel`·투영 함수를 쓴다)다.
- **null을 돌려주는 경우:** 범례 항목이 2개 미만이거나 센 지물이 0개.
- **구성비:** 범례 순서를 따른다. 항목이 6개를 넘으면 수가 많은 상위 5개 + `그 밖`(색 `#B9BDC6`)으로 묶는다. share 합은 1이다.
- **거리 그래프:**
  - `value`가 숫자인 지물이 1개 이상이면 `scatter`다. 점 색은 그 지물의 범례 색이다.
  - 중앙값·평균·최대는 값이 있는 지물로 계산한다. `site`는 대지(`model.siteParcel`) 안 지물 값의 평균(정수 반올림)이고, 없으면 null이다.
  - 점이 2,000개를 넘으면 거리순으로 정렬해 균등 간격으로 2,000개를 고르고 `sampled: true`로 둔다(무작위 금지 — 미리보기·PPT·테스트가 같아야 한다).
  - 값이 하나도 없으면 `bands`다. 100 m 간격(0–100, 100–200 … 반경까지) 개수.
- `missing` = 값이 null인 지물 수(scatter일 때만, 아니면 0). `subject` = 가장 많은 범례 항목 레이어 스타일의 `subject`(없으면 "지물"). `countUnit` = `valueAxis.countUnit ?? "개"`.
- `analysisStatLine` 형식(시안 그대로):
  - scatter: `반경 1 km 안 건물 1,735동 · 중앙값 4층 · 최고 69층 · 값 없음 548동`(missing 0이면 마지막 칸 생략)
  - bands: `반경 1 km 안 버스정류장 42개 · 가장 많은 거리 200–300 m`
  - 반경 표기: 1,000 m 이상은 `1 km`, 그 밖은 `500 m`.
  - D05에서는 「값 없음」 대신 `1층 가정`을 쓴다: `valueAxis.unit === "층"`이면 그렇게 한다.

- [ ] **Step 1: 실패 테스트** — 손으로 만든 모델 픽스처(면 5개·점 3개·대지)로 아래를 검사한다.
  - 반경 밖 지물 제외
  - 구성비 순서·share 합 = 1
  - 상위 5 + `그 밖` 묶음
  - scatter 중앙값·평균·최대·site
  - 값 없는 모델 → bands
  - 2,500점 → 2,000점·`sampled`·결정적(두 번 호출 결과 deepEqual)
  - 범례 1개 → null
  - statLine 세 형식(층·일반·bands)
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** `feat(v2): 분석 장 그래프 자료(구성비·거리)`

### Task 3: 그래프 기하(화면·PPT 공용)

**Files:**
- Create: `src/lib/v2/report/chart-geometry.ts`
- Test: `src/scripts/v2/test-v2-chart-geometry.mjs`

**Interfaces:**
- Consumes: Task 2 `AnalysisCharts`, `CompositionItem`, `DistanceData`
- Produces:
  ```ts
  export type ChartShape =
    | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string; stroke?: string; name: string }
    | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number; dash?: boolean; name: string }
    | { kind: "dots"; color: string; r: number; opacity: number; points: [number, number][]; name: string }   // 한 색 = 한 묶음(PPT custGeom 1개)
    | { kind: "text"; x: number; y: number; w: number; h: number; text: string; pt: number; bold?: boolean; color: string; align: "left" | "right" | "center"; name: string };
  export type ChartBox = { x: number; y: number; w: number; h: number }; // 인치
  export function compositionShapes(items: CompositionItem[], box: ChartBox, scale: number): ChartShape[];
  export function distanceShapes(d: DistanceData, radiusM: number, box: ChartBox, scale: number): ChartShape[];
  ```
- 모든 좌표는 슬라이드 인치다. 글자 크기 `pt`는 `scale`(요약 글자 배율)에 비례한다. 이름은 `chart-composition-…`·`chart-distance-…`이고 영문 키지만 화면에는 보이지 않는다(도형 이름 전용).
- 모양은 시안 `compBars`·`scatter`·`bandBars`를 인치로 옮긴 것이다.
  - **구성비:** 행마다 이름(왼쪽 고정 폭 = 상자 폭 × 0.3)·회색 트랙·색 막대(최대 항목 = 트랙 전체)·오른쪽 % 굵게.
  - **산점도:**
    - 축: y 눈금은 0부터 `ceil((max+1)/10)*10`까지 10 단위 + 격자선이다. 단, 연도처럼 값이 크면 최솟값~최댓값을 10의 배수로 내림·올림한다. x 눈금은 0·¼·½·¾·반경이다.
    - 선: 중앙값은 실선, 평균은 점선이다. 두 선의 글자가 12 px(= 0.125 in × scale) 안으로 가까우면 나란히 놓는다.
    - 대지 점: 분홍 `#f2b6b8`, 테두리 `#c9404a`, 글자 `대지 평균 N<unit>`.
    - 점: 반지름 0.018 in × scale, 불투명도 0.45.
  - **bands:** 세로 막대와 위에 개수, 아래에 `0–100 m`.
- 모든 도형은 `box` 안에 있다(글자 포함).

- [ ] **Step 1: 실패 테스트**
  - 두 함수 결과의 모든 도형 경계가 box 안에 있다.
  - 구성비 막대 폭 비가 count 비와 같다(최대 = 트랙 폭).
  - 산점도: 중앙값 선의 y가 값→좌표 변환과 같다. 점 묶음 수 = 서로 다른 색 수.
  - 중앙값·평균이 가까울 때 두 글자 상자가 겹치지 않는다.
  - bands 막대 수 = bands 수.
  - scale 2에서도 box 안이다.
  - 화면용 문구에 영문이 없다(`/[A-Za-z]/`가 `text`에 없음, 단위 `m` 제외).
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** `feat(v2): 분석 장 그래프 기하(화면·PPT 공용)`

### Task 4: 레이아웃 「지도 + 그래프」와 화면 미리보기

**Files:**
- Modify: 레이아웃 이름 `"map-charts"` 추가 — `src/lib/v2/report/report-doc.ts:7`(`ReportLayout`), `src/lib/v2/ui/overlay-layout.ts:82`(`ReportLayoutName`), `src/lib/v2/ui/board-state.ts:917`(`isReportLayout`), `src/lib/v2/ui/overlay-layout.ts:515` `layoutRects`(`map-charts`는 `map-summary`와 같은 사각형)
- Modify: `src/lib/v2/report/report-layout.ts`
  - `ReportLayoutInput`에 `hasCharts?: boolean`을 더한다.
  - `hasCharts`일 때만 후보 `{ value: "map-charts", label: "지도 + 그래프" }`를 `map-summary` 다음에 둔다. 시그니처는 `지도:charts`다.
- Modify: `src/lib/v2/report/report-doc-plan.ts`
  - 기본 레이아웃 함수(135행)·새 타일 쪽(225·332행)에서 `analysisCharts(view.map)`이 null이 아니면 `"map-charts"`로 둔다.
  - 이미 있는 쪽(`restore`)은 건드리지 않는다.
- Modify: `src/components/v2/report/slide-surface.tsx`
  - `SummaryPanel`(1225행)은 `layout === "map-charts"`이고 그래프 자료가 있으면 B 순서로 그린다: 배지 → 큰 숫자 → 한 줄 통계 → 구성비 → 거리 → 해석 문장 → `주석 N` 칩. 표 줄(rows)·각주는 그리지 않는다.
  - 그래프는 `ChartShape[]`를 SVG로 그리는 작은 함수(`ChartSvg`)로 그린다. 좌표는 `unit`(px/in)을 곱한다.
  - `주석 N` 칩: 마우스를 올리거나 포커스하면 각주 목록 팝오버를 띄운다(흰 카드, 288 px). 자료가 없으면 칩을 두지 않는다.
- Modify: `src/components/v2/report/layout-switcher.tsx` — `map-charts` 도식(지도 왼쪽 + 오른쪽 작은 막대 두 개) 아이콘
- Modify: `docs/design/v2-design-language.md` — §9-8 레이아웃 목록에 「지도 + 그래프」와 오른쪽 열 배분(20·6·26·32·16 %)을 적는다.
- Test: `src/scripts/v2/test-v2-report-layout.mjs`(확장), `src/scripts/v2/test-v2-analysis-page-surface.mjs`(신규, SSR)

**Interfaces:**
- Consumes: Task 2 `analysisCharts`, `analysisStatLine`. Task 3 `compositionShapes`, `distanceShapes`.
- Produces: `chartsColumnLayout(summaryRect: Rect, scale: number): { headline: Rect; stat: Rect; composition: ChartBox; distance: ChartBox; sentence: Rect; notesChip: Rect }`. `src/lib/v2/ui/overlay-layout.ts`에 둔다. 배분은 20·6·26·32·16 %이고, 남는 높이는 거리 그래프에 준다. Task 5 PPT가 같은 함수를 쓴다.

- [ ] **Step 1: 실패 테스트**
  - `reportLayoutDecision({ hasCharts: true })`에 `map-charts` 「지도 + 그래프」가 있다. false면 없다.
  - `restore`가 `map-charts`를 받아들이고, 모르는 값은 버린다.
  - `planReportDoc`: 새 추천 구성의 D05 쪽은 `layout === "map-charts"`이다. 저장된 `map-summary` 쪽은 그대로다.
  - SSR(`SlideSurface` D05 픽스처, `map-charts`):
    - `data-chart="composition"`·`data-chart="distance"` SVG가 있다.
    - 각주 문구가 장 본문에 없고 `주석 N` 칩이 있다.
    - 배지 문구는 있다.
  - 그래프 자료가 null인 모델에 `map-charts`가 저장돼 있으면 기존 `map-summary` 내용(표 줄·각주)으로 그린다.
  - `chartsColumnLayout`의 6칸이 summaryRect 안에서 서로 겹치지 않는다. scale 1.85(24 pt)에서도 마찬가지다.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 새 파일, `test-v2-report-layout.mjs`, `test-v2-report-doc-plan.mjs`, `test-v2-report-doc.mjs`, `test-v2-report-page-style.mjs` PASS
- [ ] **Step 5: 커밋** `feat(v2): 보고서 레이아웃 「지도 + 그래프」 화면`

### Task 5: PPT 「지도 + 그래프」

**Files:**
- Modify: `src/lib/v2/report/render-pptx.ts`
  - `tile()`(466행~)에서 `pageLayout === "map-charts"`이고 그래프 자료가 있으면 요약 칸 항목(`items`, 553–562행)을 B 순서로 만든다: 배지 → `headlineItems` → 통계 줄 → 구성비 항목 → 거리 항목 → 해석 문장.
  - 표 줄·각주 텍스트 항목은 넣지 않는다. 각주(`notes`)는 `pageNotes(s, p, [...fallbackNotes, ...notes])`로 발표자 노트에 붙인다.
  - 그래프 항목은 `ReportItem`(`{ h, draw(y) }`)이고, `draw`는 `chartsColumnLayout`의 상자에 `ChartShape[]`를 그린다.
  - 사각형·선·글자는 pptxgenjs 도형/글상자로 그린다. `dots`는 색마다 custGeom 1개(점마다 작은 원 하위 경로)로 그린다. `src/lib/v2/report/map-pptx.ts`의 `addCustom` 경로 생성을 재사용할 수 있게 `addDots(slide, points, r, color, opacity, objectName)`를 내보낸다.
  - 도형 이름은 `GRP|chart-<…>|그래프 · <구성비|거리>|<…>`이다.
- Test: `src/scripts/v2/test-v2-analysis-page-pptx.mjs`(신규)

- [ ] **Step 1: 실패 테스트** — D05 픽스처 tile 쪽 `map-charts`.
  - PPT XML에 `GRP|chart-composition-`·`GRP|chart-distance-` 도형이 있다.
  - 그래프용 `<p:pic>`이 없다(지도 배경 그림 수만 남는다).
  - `chart-distance-dots` 도형 수 = 색 수(점 2,000개여도).
  - 각주 문구가 슬라이드 본문에 없고 `notesSlide`에 있다.
  - 화면 SSR(Task 4 픽스처)의 그래프 글자 집합 = PPT 그래프 글자 집합(`<a:t>`).
  - `map-summary` 쪽 XML이 이 작업 전후로 같다(기존 테스트 통과로 확인).
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 새 파일, `test-v2-report-doc-pptx.mjs`, `test-v2-ppt-editable-maps.mjs`, `test-v2-ppt-vector-basemap.mjs` PASS. 마지막에 `npm run lint`·`npm run test:v2` 전체 1회.
- [ ] **Step 5: 커밋** `feat(v2): PPT 「지도 + 그래프」 도형 그래프`

### Task 6: Judge 실렌더 QA (실행자 아님)

- [ ] dev 서버(3200)에서 대치동 503을 새로 분석한다. 엔진 값이 바뀌었으므로 TILE_CACHE_REVISION이 반영돼야 한다. 그다음 「추천 구성으로 시작」을 누른다.
- [ ] 10(A07)·19(D04)·20(D05)쪽과 값 없는 타일 한 장(bands)의 미리보기를 1440·1280·1024에서 캡처한다. `.spike/qa-vector-labels.mjs`로 라벨 충돌·오류 0을 확인하고, 그래프가 지도와 겹치는 면적 0을 확인한다.
- [ ] PPT를 내보내 `.spike/render-pptx.ps1`로 실렌더한다. 미리보기와 나란히 비교하고, 그래프 도형의 색·글자를 편집할 수 있는지 확인하고, 파일 크기·열기 시간을 기록한다.
- [ ] 아키맵 14쪽과 새 20쪽을 나란히 놓은 비교를 사용자에게 보인다.

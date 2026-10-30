# 보고서 타일 장 배치 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보고서 타일 장을 ① `지도 + 숫자`, ② `지도 + 그래프` 두 배치(시안 A 카드형)로 통합한다. 화면·PDF·PNG·PPT가 하나의 기하·맞춤 함수로 같은 장을 그리게 한다.

**Architecture:** 다음 세 가지 순수 함수를 새로 만들고, 화면(`slide-surface.tsx`)·PPT(`render-pptx.ts`·`map-pptx.ts`)·그림 내보내기(`map-image.ts`)·축척(`report-scale.ts`)이 모두 이 함수만 읽게 바꾼다. 지금은 배치 계산이 네 곳에 흩어져 있다.
- 장 기하: `reportPageGeometry`
- 카드 맞춤: `keyFigureFit`
- 레이아웃 판정: `resolveReportLayout`

핵심 숫자는 타일 모듈의 `keyFigureFor` 선언으로 만들고, `toTileView`가 `TileView.keyFigure`에 싣는다.

**Tech Stack:** Next.js 15 · TypeScript · React SVG · pptxgenjs · 테스트 `src/scripts/v2/test-v2-*.mjs`(`npx tsx`)

**Spec:** `docs/superpowers/specs/2026-10-30-report-page-layout-design.md` (2026-10-30 사용자 승인). 실행자는 spec과 이 계획을 함께 읽는다.

## Global Constraints

- UI·PPT 작업 전에 `docs/design/v2-design-language.md`를 읽는다(§1·§9-7·§9-8·§9-12·§11). 없는 패턴은 만들지 말고 보고한다. UI 작업은 `ui-ux-pro-max`·`my-design-taste`를 쓰고, 보고서 끝에 `taste 후보: <한 줄|없음>`을 적는다.
- 파일 편집은 Edit/Write 도구로만 한다. `sed -i`·python·셸 heredoc으로 파일을 고치지 않는다.
- 사용자에게 보이는 말은 한국어다.
- 기하 단위는 inch(장 좌표)이고, 화면은 `in × unit` px로 그린다. 컴포넌트나 PPT 함수에 배치 숫자를 따로 두지 않는다. 모두 `reportPageGeometry`·`keyFigureFit`에서 가져온다.
- 16:9 시안 값(96 px/in, spec §3·§4)
  - 가장자리 0.25 in, 각주 띠 0.29 in(바탕 `#f2f2ef`), 제목 칩 높이 0.5 in
  - ① 카드: x 0.25 · y 0.875 · 폭 3.125 in
  - ② 지도 틀 폭 = 장 폭 × (1 − `SLIDE.infoRatio` 0.32). 열은 지도 틀 + 0.21 in에서 시작해 오른쪽 0.25 in까지, 카드 간격 0.125 in, 열 바탕 `#f0efe9`
  - 카드: 흰색, 1 px `#e1e4e9`, 모서리 0.125 in
- 글자 크기: F1 기본값(제목 18·요약 13·범례 10·출처 9 pt)일 때 시안 pt가 나온다. 시안 pt는 다음과 같다.
  - 제목 15.75 · 범례 9 · 각주 7.5
  - 카드: 질문 9.4 · 앞말 18 · 숫자 43.5 · 대상 21 · 이름 답 23 · 보조 줄 9.4 · 보조 숫자 값 15 / 이름 8.25 · 해석 9.75
  - F1 값을 바꾸면 같은 비율로 커지거나 작아진다.
- 핵심 숫자는 엔진이 이미 낸 지표·행만 읽는다. 엔진 변경은 Task 3(A01 `counted`)과 Task 10(A12 설명선 %)뿐이다. 둘 다 `src/lib/v2/engine/tiles/common.ts`의 리비전을 올리고 `test-v2-tile-registry.mjs:26`을 갱신한다.
- 높이·층수 수치(D05·S01)는 1층 가정 비율을 함께 보인다(저장소 규칙).
- 테스트: 하나만 돌릴 때는 `npx tsx src/scripts/v2/test-v2-<name>.mjs`, 전체는 `npm run test:v2`(첫 실패에서 멈춤), 타입 검사는 `npm run lint`.
- 화면 QA
  - 서버: `http://localhost:3200/site`(Judge가 띄운 서버, 새로 띄우지 않는다)
  - 로그인: `devqa`와 로컬 `DEV_QA_PASSWORD`. 비밀번호는 어디에도 적지 않는다.
  - 분석: dev 0b5ba3aa(대치동 503, 1 km)
  - 도구: `tools/qa/README.md`
- 커밋은 작업별로 `feat(v2):`·`fix(v2):` + 한국어 요약 + Co-Authored-By 줄로 한다. push·배포는 하지 않는다.

## Review Focus

1. **긴 답:** 「제2종일반주거지역」 같은 긴 이름이나 긴 역명이 카드 폭을 넘는 경우다. 숫자를 24 pt(32 px)까지 줄이고, 그래도 넘치면 대상 이름을 보조 줄로 내린다. 큰 답은 줄바꿈하지 않는다. → Task 4 테스트
2. **그래프 자료를 잃은 저장 장:** 저장된 `map-charts`·`numbers-first` 장에 그래프 자료가 없으면(옛 분석, `countedCapped`) 화면과 PPT 모두 ①로 그린다. 빈 그래프 카드를 남기지 않는다. → Task 5 테스트 + Task 7 테스트
3. **A3·A4 판형:** 모든 사각형이 장 안에 있어야 한다. 지도가 가장 크고, 겹침이 없고, 방위표·축척·범례가 지도 틀 안에 있어야 한다. → Task 4 테스트
4. **옮겨 둔 부속:** 저장된 방위표·축척·범례 자리가 새 틀 밖이거나 카드·열과 겹치면 버리고, 안이면 그대로 둔다. → Task 4 테스트
5. **결과가 모자란 타일:** pending(S03·S04)이면 카드가 없다. 지표가 미확인이면 그 보조 숫자를 빼고, `미확인`을 크게 쓰지 않는다. partial이면 상태 배지가 보인다. → Task 1·2 테스트

---

### Task 1: 핵심 숫자 모델과 표본 세 타일

**Files:**
- Modify: `src/lib/v2/tile/types.ts` (`TileClientModule` `:106`, `headlineFor` `:119` 옆에 추가)
- Modify: `src/lib/v2/ui/tile-view.ts` (`TileView` `:28`, `toTileView` `:375`. `headlineFor` 호출 `:410–425` 뒤에서 계산)
- Modify: `src/lib/v2/tile/a01/view.ts`, `src/lib/v2/tile/a12/view.ts`, `src/lib/v2/tile/d03/view.ts`, `src/lib/v2/tile/d01/view.ts`(없으면 만들고 `client.ts`에 등록)
- Modify: TileView를 직접 만드는 곳에 `keyFigure: null`을 넣는다. 대상은 `report-doc-plan.ts:418` `missingView`, `src/lib/v2/ui/sheet.ts`, `src/lib/v2/ui/stack.ts`, `src/lib/v2/tile/s02/view.ts`, `src/scripts/v2/test-v2-tile-image.mjs`.
- Test: Create `src/scripts/v2/test-v2-key-figure.mjs`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type KeyFigure = {
    question: string;                                   // 질문 줄
    answer: { pre?: string; value: string; post?: string; target?: string; kind: "number" | "name" };
    sub?: string;                                       // 보조 줄 (분모·노선 등)
    stats: Array<{ value: string; label: string }>;     // 0–3개, 미확인 값은 넣지 않음
    parts?: Array<{ label: string; share: number; color: string; site?: boolean }>; // 구성 막대(A12), 최대 5 + 「그 밖」
  };
  // TileClientModule
  keyFigureFor?: (result: TileResult, helpers: TileHeadlineHelpers) => KeyFigure | "none" | null;
  ```
- Produces (tile-view.ts): `TileView.keyFigure: KeyFigure | null`
  - status가 `pending`이면 null이다.
  - `keyFigureFor`가 `"none"`이면 null이다.
  - null을 돌려주면 headline에서 만든 카드를 쓴다(`question = headline.label`, `answer.value = headline.value`, stats 없음).
  - headline도 없으면 null이다.
  - A05 필터 등이 적용된 `prepare` 뒤의 결과(`r`)로 계산한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-key-figure.mjs`. 픽스처 결과는 `test-v2-tile-a01-transit.mjs`·`test-v2-zoning.mjs` 방식으로 만든다.
  - `A01`(walk_nearest_rail_min 6, walk_nearest_rail_m 498, 최근접 역 「대치역」, nearest_rail_m 321, walk_nearest_bus_min 4, rail_stations 5, bus_stops 106, 반경 1000)
    - `question === "가장 가까운 지하철역"`
    - `answer` 깊은 같음 `{pre:"도보", value:"6분", target:"대치역", kind:"number"}`
    - `stats.map(s=>s.label)` 깊은 같음 `["정류장까지 도보","1km 안 지하철역","1km 안 정류장"]`
    - `stats[0].value === "4분"`
  - `A01`, walk_nearest_bus_min 없음 → stats에 「정류장까지 도보」가 없다(`미확인` 문자열이 어디에도 없다).
  - `A12`(대지 제3종일반주거지역, 세분 행 50.0/24.9/18.5/5.0/1.6, 주거 95.0)
    - `answer.kind === "name"`, `answer.value === "제3종일반주거지역"`
    - `parts.length <= 6`
    - `parts.find(p=>p.site).label === "제3종일반주거지역"`, 그 share는 50.0
  - `D03`(확인 947동 중 주거 578동, 반경 1,734동, 근린생활 220, 용도 미상 787)
    - `answer` 깊은 같음 `{pre:"주거", value:"61.0%", kind:"number"}`
    - `sub === "용도가 확인된 947동 중 578동"`
  - `D01` → `keyFigure === null`(headline이 있어도)
  - status `pending`인 아무 타일 → `keyFigure === null`
- [ ] **Step 2: 실행해 실패 확인** — `npx tsx src/scripts/v2/test-v2-key-figure.mjs` → `keyFigure` 없음으로 FAIL
- [ ] **Step 3: 구현**
  - 타입, `toTileView` 계산, A01·A12·D03 `keyFigureFor`, D01 `"none"`
  - 반경 표기는 spec 예처럼 `1km`로 한다(500 m면 `500m`).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `npm run lint` 0
- [ ] **Step 5: 커밋** — `feat(v2): 타일 핵심 숫자 모델 — keyFigureFor 선언과 A01·A12·D03 정의`

### Task 2: 나머지 타일 핵심 숫자 정의

**Files:**
- Modify: 각 `src/lib/v2/tile/<code>/view.ts`
  - 대상: a02 a03 a04 a05 a06 a07 a08 a09 a10 a11 d02 d04 d05 d10 d11 d12 d13 d15 d16 d17 d18 d19 d22 d28 d29 s01 s02
  - S03·S04는 정의하지 않는다. pending이면 null이다.
- Test: Modify `src/scripts/v2/test-v2-key-figure.mjs`

**Interfaces:**
- Consumes: Task 1의 `KeyFigure`·`keyFigureFor`
- 정의 내용은 spec §4-2 표를 따른다(질문·큰 답·보조 숫자).
  - 지표 id는 각 타일 `engine.ts`의 metrics에서 찾는다.
  - 표의 값(대치동 503 1 km)은 dev 분석 0b5ba3aa에서 나와야 한다. 확인은 `npx tsx .spike/concept/probe-all.tsx`를 고쳐 `keyFigure`를 찍어 본다.

- [ ] **Step 1: 실패하는 테스트 작성** — 타일마다 한 블록. 픽스처는 정의가 읽는 지표만 넣는다. 확인할 것은 질문과 큰 답이다.
  - `A07` → question `"㎡당 매매가 중앙값"`, answer.value `"3,826만원"`, answer.post `"/㎡"`
  - `A05` 필터 적용 픽스처 → 필터 뒤 세대수가 answer.value
  - `D05` → stats에 「1층 가정」을 포함한 이름의 항목이 있다(`/1층 가정/`)
  - `S01` → stats에 `/1층 가정/` 항목이 있다
  - `D11` → answer.value가 `/㎡$/`로 끝나는 7자리 이상 숫자가 아니다(km²·ha로 환산하거나 구역 이름)
  - `D29` → answer.value `"71%"`(비율 0.71 → %)
  - 그 밖 타일은 spec 표의 질문 문자열과 같아야 한다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — 표대로. 기술 지표 이름(`반경 교차면적: 기타` 등)을 질문·이름에 그대로 쓰지 않는다.
- [ ] **Step 4: 통과 확인** — 테스트 PASS, lint 0. probe 출력을 보고서에 붙인다(타일당 한 줄).
- [ ] **Step 5: 커밋** — `feat(v2): 모든 타일 핵심 숫자 정의(초안 — 갤러리 확인 전)`

### Task 3: A01 그래프 자료

**Files:**
- Modify: `src/lib/v2/tile/a01/engine.ts`
  - 반경 안 버스 `:429–435`(`bus_stop`·`bus_nearest`), 출입구 `:461–472`(`rail_entrance`)에 `counted: true`를 붙인다.
  - 선례는 `src/lib/v2/tile/a02/engine.ts:61`이다.
- Modify: `src/lib/v2/tile/a01/view.ts` — `chart: { subject: "정류장·출입구", countUnit: "곳" }`
- Modify: `src/lib/v2/engine/tiles/common.ts:22` A01 리비전에 `+chart-count-r1`
- Modify: `src/scripts/v2/test-v2-tile-registry.mjs:26`
- Test: `src/scripts/v2/test-v2-tile-a01-transit.mjs`

- [ ] **Step 1: 실패하는 테스트 작성** — 반경 1000 픽스처. 반경 안 정류장 3 + 밖 1, 출입구 2 + 밖 1.
  - `counted===true`인 지물 수가 5다.
  - `analysisCharts(view.map)`가 null이 아니다.
  - 그 `total`이 5다.
  - `composition`의 라벨 집합이 버스정류장과 역 출입구 두 항목이다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** (`_nearest` 층은 `analysisCharts`가 기본 층에 합친다 — `analysis-charts.ts:85–93`)
- [ ] **Step 4: 통과 확인** — `tile-a01-transit`, `tile-registry`, `analysis-charts` PASS
- [ ] **Step 5: 커밋** — `feat(v2): A01 정류장·출입구를 counted로 — 지도 + 그래프 자료`

### Task 4: 장 기하와 카드 맞춤 (순수 함수)

**Files:**
- Create: `src/lib/v2/ui/report-page-layout.ts`
- Create: `src/lib/v2/report/key-figure-fit.ts`(`pptx-kit.ts`의 `fitBlock` `:55`·`textIn` `:49`·`linesOf` `:50`를 쓴다)
- Test: Create `src/scripts/v2/test-v2-report-page-layout.mjs`

**Interfaces:**
- Consumes: `SlideFormat`·`Rect`·`slideGeometry`(`overlay-layout.ts`), `PagePanels`·`normalizePagePanels`(`report-geometry.ts`), Task 1 `KeyFigure`
- Produces:
  ```ts
  // report-page-layout.ts
  export type PageLayoutKind = "map-key" | "map-charts";
  export type ReportPageGeometry = {
    map: Rect; footer: Rect; pageNo: Rect; title: Rect;
    keyCard: Rect | null;                       // ①: 떠 있는 카드 / ②: column.key와 같음 / 숫자 카드 지움이면 null
    column: { rect: Rect; key: Rect; chart1: Rect | null; chart2: Rect | null; sentence: Rect; notesChip: Rect } | null;
    legend: Rect | null; north: Rect; scaleBar: Rect;
    unit: number;                               // 지도 부속 u
    scenePxPerInch: number;                     // 960 / map.w
  };
  export function frameChromeUnit(frameW: number, frameH: number): number; // clamp(1, 1.5, 960*frameH/frameW/360)
  export function reportPageGeometry(input: {
    layout: PageLayoutKind; format: SlideFormat; panels?: PagePanels;
    summaryDeleted: boolean; titleSize: { w: number; h: number };
    keyCardHeight: number; legendSize: { w: number; h: number } | null;
    chartSlots: 0 | 1 | 2; sentenceHeight: number;
  }): ReportPageGeometry;
  // key-figure-fit.ts
  // badges = view.badges의 표시 글, grades = view.grades의 `${target} ${label}`
  export type KeyFigureFitInput = { figure: KeyFigure; badges: string[]; grades: string[]; filterLine: string | null;
    sentence: string | null; width: number; columns: 2 | 3; summaryPt: number };
  export type KeyFigureFit = { height: number; questionPt: number; prePt: number; valuePt: number; targetPt: number;
    subPt: number; statValuePt: number; statLabelPt: number; sentencePt: number;
    targetOnSub: boolean; badgesShown: string[]; badgesMore: number; sentenceLines: string[]; subLines: string[] };
  export function keyFigureFit(input: KeyFigureFitInput): KeyFigureFit;
  ```

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-report-page-layout.mjs`(±0.01 in)
  - wide `map-key`
    - `map` = `{x:0,y:0,w:13.333,h:7.21}`, `footer` = `{x:0,y:7.21,w:13.333,h:0.29}`
    - `keyCard.x===0.25`, `keyCard.y===0.875`, `keyCard.w===3.125`
    - `column===null`
  - wide `map-charts`
    - `map.w≈9.067`, `column.rect.x≈map.w+0.21`
    - `column.rect.x+column.rect.w≈13.333-0.25`, `column.key.y≈0.25`
    - 카드 간격 0.125
    - `column.sentence` 아래 끝 ≈ `footer.y-0.21`
  - `frameChromeUnit` + 방위표 지름 `46*unit*map.w/960`
    - wide map-key ≈ 0.96 in
    - wide map-charts ≈ 0.65 in
    - 5.6×5.4 in 틀 ≈ 0.40 in
  - 모든 판형(wide·a3·a4) × 두 배치
    - `map` 넓이가 다른 모든 사각형보다 크다.
    - `north`·`scaleBar`·`legend`가 `map` 안에 있다.
    - 쌍마다 겹치지 않는다(title·keyCard·column·legend·north·scaleBar·footer).
    - 모든 사각형이 장 안에 있다.
  - 열 높이가 모자라면(`keyCardHeight` 크게) `chart2===null`이고 `chart1!==null`이다. 더 모자라면 둘 다 null이고, key·sentence는 남는다.
  - `summaryDeleted:true`이면 `map-key`는 `keyCard===null`이다. `map-charts`는 `column===null`이고 `map.w===13.333`이다.
  - 저장 panels
    - `north`가 틀 안이고 겹침이 없으면 그 자리를 쓴다.
    - ② 열 위에 놓인 `north`·`legend`는 기본 자리로 돌아간다.
    - legend 저장값의 w·h는 무시하고 `legendSize`를 쓴다.
  - `keyFigureFit`
    - summaryPt 13, A01 표본: `valuePt≈43.5`, `questionPt≈9.4`, `sentencePt≈9.75`
    - summaryPt 15.6이면 각 값이 1.2배다.
    - 폭 2.4 in에 긴 이름 답 「제2종일반주거지역 · 아주긴역이름역」: `valuePt>=24`이다. 넘치면 `targetOnSub===true`다.
    - 배지 4개 → `badgesShown.length===2`, `badgesMore===2`
    - `filterLine` 있음 → height가 없을 때보다 크다.
    - columns 2와 3의 stat 칸 수가 반영된다(height 비교로 충분하다).
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — spec §3·§4 값 그대로. 제목 칩 폭은 `titleSize`로 받는다(글자 맞춤은 호출부가 `titleTextFit`으로 함).
- [ ] **Step 4: 통과 확인**, lint 0
- [ ] **Step 5: 커밋** — `feat(v2): 보고서 장 기하·핵심 숫자 카드 맞춤 공유 함수`

### Task 5: 레이아웃 값·이관·선택지

**Files:**
- Modify: `src/lib/v2/report/report-doc.ts:10` — `ReportLayout`에 `"map-key"` 추가
  - `case "layout"`(`:601`)에서 옛 값을 받으면 `map-key`로 바꾼다.
- Modify: `src/lib/v2/ui/overlay-layout.ts:82` — `ReportLayoutName`에 `"map-key"`
- Modify: `src/lib/v2/ui/board-state.ts`
  - `isReportLayout` `:944`
  - `restoreReportPage` `:1083–1098`
- Modify: `src/lib/v2/report/report-layout.ts`
  - `resolveReportLayout` 추가
  - `reportLayoutDecision` 선택지 교체
- Modify: `src/lib/v2/report/report-doc-plan.ts` — `pageLayoutForSlide` `:129`, `importLegacyReport` `:400`
- Modify: `src/components/v2/report/layout-switcher.tsx` — 미니어처 `:41–44`, `activeLayout` `:52`
- Modify: `src/components/v2/report/report-mode.tsx` — `:1357–1368` 판정, `:1856`
- Test: `src/scripts/v2/test-v2-report-layout.mjs`, `test-v2-report-doc.mjs`, `test-v2-report-doc-plan.mjs`

**Interfaces:**
- Produces:
  ```ts
  export function resolveReportLayout(layout: ReportLayout, page: { hasMap: boolean; figure: boolean; hasCharts: boolean }):
    "map-key" | "map-charts" | "numbers-first";
  ```
  - 지도도 그림도 없으면 → `"numbers-first"`(지금 그대로)
  - `map-charts`·`numbers-first`이고 그래프가 있고 그림이 아니면 → `"map-charts"`
  - 그 밖 → `"map-key"`
- 이관(`restoreReportPage`, tile만)
  - `map-summary`·`side-by-side` → `map-key`
  - `map-full` → `map-key` + `deletedElementKeys`에 `"summary"`
  - 그림 타일의 `numbers-first` → `map-key`(지금 패널 비우기 유지)
  - 그 밖은 그대로
- 선택지: 그래프가 있으면 `[map-key "지도 + 숫자", map-charts "지도 + 그래프"]`, 없으면 `[map-key]`. 그림 타일 이름은 `"그림 + 숫자"`.
- 새 쪽 기본(`pageLayoutForSlide`): 그래프가 있으면 `map-charts`, 아니면 `map-key`. 지도·그림이 없으면 지금처럼 `numbers-first`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `resolveReportLayout`: 아래 6가지 조합 기대값
    - (`numbers-first`, 지도, 그래프) → `map-charts`
    - (`numbers-first`, 지도, 그래프 없음) → `map-key`
    - (`map-charts`, 지도, 그래프 없음) → `map-key`
    - (`map-charts`, 그림) → `map-key`
    - (`numbers-first`, 지도 없음·그림 없음) → `numbers-first`
    - (`map-key`, 지도, 그래프) → `map-key`
  - 이관: 저장 문서 하나에 다섯 옛 값을 섞어 `restoreReportDoc` 결과 layout 배열을 확인한다.
    - 기대값: `["map-key","map-charts","numbers-first","map-key","map-key"]`
    - `map-full` 쪽만 `deletedElementKeys`에 `"summary"`가 있다.
    - 옮긴 `panels.north`는 남아 있다(판정은 Task 4 기하가 한다).
  - `reportLayoutDecision({pageKind:"tile",hasMap:true,hasCharts:true})`의 값 목록은 `["map-key","map-charts"]`이고 라벨은 `["지도 + 숫자","지도 + 그래프"]`다.
  - 그래프가 없으면 `["map-key"]`다. figure이면 라벨이 `"그림 + 숫자"`다.
  - 기존 테스트 기대값 중 옛 이름(`지도 크게`·`숫자 먼저`)은 새 규칙으로 고친다. 고친 줄은 보고서에 적는다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위 세 파일 + `board-state-v4`·`ui-board-state`·`report-mode-state` PASS, lint 0
- [ ] **Step 5: 커밋** — `feat(v2): 보고서 배치를 지도 + 숫자·지도 + 그래프 둘로 — 저장 장 이관`

### Task 6: 화면 렌더 (편집·썸네일·발표·내보내기 캡처)

**Files:**
- Create: `src/components/v2/report/key-figure-card.tsx`
  - `KeyFigureCard({ view, fit, rect, unit, interaction })`
  - 질문 줄 + 배지 / 큰 답 run / 보조 줄 + 등급 칩 / A05 필터 줄 / 구분선 / 보조 숫자 / 구성 막대 / (①) 해석 한 줄
- Modify: `src/components/v2/report/analysis-column.tsx` — `AnalysisColumn`을 카드 3장 + 해석 한 줄로 바꾼다.
  - 「한 줄 통계」 칸은 없앤다.
  - `NotesChip`은 열 맨 아래 오른쪽에 둔다.
- Modify: `src/components/v2/report/slide-surface.tsx`
  - `SlidePreview` `:2440–2480`, `TileSurface` `:2330–2390`, `MapLayer` `:528–620`
  - `SlideFooter` `:1151`(각주 띠: 바탕 `#f2f2ef`, 출처 + `view.caveats[0] ?? view.notes[0]`, 쪽 번호)
  - `ReportTitlePanel` `:1197`(제목 칩)
  - `LegendPanel` `:1273`(내용 크기 흰 판, 6개 이상 2열)
  - `SummaryPanel` `:1218`(①에서 `KeyFigureCard`)
  - 모든 사각형은 `reportPageGeometry`에서 가져온다.
  - `MapLayer` u는 조판 칸과 같은 방식으로 `frameChromeUnit(map.w, map.h)`를 쓴다(`:577–579` 교체).
  - 범례 `PanelTransformFrame`은 크기 핸들 없이 옮기기만 한다.
  - 설명선 회피(spec §3-2): `slideCalloutAvoidance` 호출(`:2360`·`:2464`)에 ① 숫자 카드 사각형을 넘긴다. `calloutTop`은 제목 칩 아래, 왼쪽 설명선은 카드 아래로 내린다(`overlay-layout.ts:376` 입력에 카드 추가).
- Modify: `src/components/v2/report/drawer-map.tsx:50`·`:288–291` — 범례 위치 `지도 위`(`below`)·`숨김` 둘. 저장된 `right`는 `below`로 읽는다.
- Modify: `src/lib/v2/ui/report-scale.ts:28` — `mapFrameWidthMm`이 `reportPageGeometry().map.w`를 쓴다.
- Modify: `src/components/v2/report/report-mode.tsx:1579–1612` — `mapScaleOptions`도 같은 기하를 쓴다.
- Test: `test-v2-analysis-page-surface.mjs`, `test-v2-report-surface.mjs`, `test-v2-report-elements.mjs`, `test-v2-report-scale.mjs`, `test-v2-report-element-handles.mjs`

**Interfaces:**
- Consumes: Task 1 `TileView.keyFigure`, Task 4 `reportPageGeometry`·`keyFigureFit`·`frameChromeUnit`, Task 5 `resolveReportLayout`

- [ ] **Step 1: 실패하는 테스트 작성** — 지금 표면 테스트의 정적 렌더 방식을 따른다.
  - wide ① 쪽 마크업에 `data-part="key-figure"`가 있다. 그 left/top/width가 기하의 keyCard × unit과 같다.
  - ② 쪽의 그래프 카드 수가 2다(`role="img"` SVG 2개).
  - 지도 host 폭이 `map.w×unit`이다.
  - 각주 띠 글이 `출처 `로 시작하고 첫 한계 문구를 포함한다.
  - 범례 선택 시 크기 핸들 0개, 숫자 카드 선택 시 8개다.
  - ② 열 선택 막대에 `지우기`만 있다.
  - `mapFrameWidthMm("wide","map-charts")` ≈ 9.067×25.4다.
  - A12 ① 쪽(설명선 있음) 장면의 설명선 카드·지시선 상자가 숫자 카드 사각형과 겹치지 않는다(`buildMapScene` 결과의 설명선 상자로 확인).
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — 색·글자는 Global Constraints 값. 숫자는 `font-variant-numeric: tabular-nums`. 썸네일·내보내기(`mode` thumb·export)에는 선택 표시와 `주석 N` 칩이 없다.
- [ ] **Step 4: 통과 확인** — 위 테스트, lint 0
- [ ] **Step 5: 화면 확인** — `tools/qa/capture-pages.mjs 0b5ba3aa <out> --widths 1440,1024 --pages 2,15,18`(쪽 번호는 실제 A01·A12·D03 쪽). 겹침 0, 열 밖 글자 0. PNG를 보고서에 붙인다.
- [ ] **Step 6: 커밋** — `feat(v2): 보고서 화면 — 핵심 숫자 카드·그래프 카드 열·각주 띠·제목 칩`

### Checkpoint G: 핵심 숫자 갤러리 (Judge — 실행자 작업 아님)

- [ ] dev 0b5ba3aa에서 모든 지도·그림 타일의 새 장(16:9)을 캡처한다. 결정 페이지(각 장 + 「좋음/고칠 점」 메모 + 결과 블록 `KEY_FIGURE_REVIEW`)로 사용자에게 보인다.
- [ ] 사용자 결과를 Task 2 정의에 반영한다(고칠 타일만, Sonnet 실행자 1회). spec §4-2 표를 확정 값으로 갱신하고 커밋한다.

### Task 7: PPT 렌더 (편집 가능한 도형·이미지 한 장)

**Files:**
- Create: `src/lib/v2/report/key-figure-pptx.ts`
  - `drawKeyFigureCard(s, { view, fit, rect })`
  - 둥근 사각형 1 + 텍스트 상자. 큰 답은 상자 하나에 run 셋(앞말·숫자·대상).
  - 도형 이름은 `panelTag("summary","핵심 숫자",…)`이다.
- Modify: `src/lib/v2/report/analysis-column-pptx.ts:63` `drawAnalysisColumn` — 열 바탕 + 카드 3장 + 해석 한 줄
- Modify: `src/lib/v2/report/render-pptx.ts`
  - `tile()` `:462–600`: `resolveReportLayout` + `reportPageGeometry`
  - `strip` `:69` → 각주 띠
  - `titlePlate` `:167` → 제목 칩
  - `legendPlate` `:315` → 내용 크기 판
  - `pageStyleFor` `:97`·`frameForLayout` `:127` → 기하의 `map`
  - `background` `:495` → 지도 틀 안만
- Modify: `src/lib/v2/report/map-pptx.ts`
  - `sceneFor` `:601–653`: 틀·avoid를 기하에서 가져온다. 설명선 회피 `:622`에도 ① 숫자 카드를 넘긴다(Task 6과 같은 입력).
  - **O-2:** `:545` `cellUnit`을 `frameChromeUnit(cell.w, cell.h)`로, 칸 장면 밀도를 `960/cell.w`로 고친다. `:553–556` 기본 상자도 같이 고친다.
- Modify: `src/lib/v2/report/map-image.ts:289` `extraFor` — 판형별로 기하 `map`을 쓴다(wide 고정 제거).
- Test: `test-v2-analysis-page-pptx.mjs`, `test-v2-report-doc-pptx.mjs`, `test-v2-ppt-editable-maps.mjs`, `test-v2-map-chrome.mjs`, `test-v2-report-font-sizes.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**
  - wide ② PPT 장의 「핵심 숫자」 그룹 x·y·w가 기하의 `column.key`와 같다(±0.01 in).
  - 숫자 run 글자 크기가 `keyFigureFit().valuePt`와 같다.
  - ① 장 지도 그림의 x·w가 기하 `map`과 같다.
  - **그래프 자료가 없는 저장 `map-charts` 장 → 그래프 도형 0개, 핵심 숫자 카드 1개**(Review Focus 2).
  - **O-2:** 2×2 조판 칸 PPT 방위표 지름 = `46*frameChromeUnit(cell.w,cell.h)*cell.w/960`(±0.01). 같은 칸의 화면 값과 같다.
  - 각주 띠 글 pt가 F1 `출처` 9일 때 7.5다. 글은 `출처 `로 시작하고 `view.caveats[0]`을 포함한다(화면 각주와 같은 문자열).
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위 테스트 + `ppt-vector-basemap`·`report`·`sheet` PASS, lint 0
- [ ] **Step 5: 실렌더 확인**
  - `tools/qa/export-pptx.mjs 0b5ba3aa <out> 1440 editable`
  - `tools/qa/render-pptx.ps1 -Pptx <f> -Out <dir> -TimeoutSec 180`
  - A01·A12·D03 장을 Task 6 화면 캡처와 나란히 놓은 PNG를 보고서에 붙인다. 위치·크기·줄바꿈이 같아야 한다.
- [ ] **Step 6: 커밋** — `feat(v2): 보고서 PPT — 화면과 같은 기하로 핵심 숫자 카드·그래프 열·각주, 조판 칸 방위표 단위(O-2)`

### Task 8: 그림 타일과 각주 출처

**Files:**
- Modify: `src/components/v2/report/slide-surface.tsx` — `FigureLayer` `:1484`가 기하 `map` 틀을 채운다.
- Modify: `src/lib/v2/report/render-pptx.ts:599` — `strip(s, p, !chart …)` → 바탕지도를 그린 장만 credit(`footerBasemaps` `pptx-kit.ts:164` 결과가 빈 배열이면 credit 없음)
- Modify: `slide-surface.tsx` `SlideFooter` `:1151` — credit = `!!slide.map || slide.kind==="sheet"`(그림 장 제외 확인)
- Modify: 매스 범례 칩(S3)과 매스 오른쪽 끝·N 표식이 카드·각주에 가리지 않게 `map-image.ts:416` `rasterizeMass` 틀을 기하 `map`으로 맞춘다.
- Test: `test-v2-tile-d22-rose.mjs`, `test-v2-tile-s01-mass.mjs`, `test-v2-report-page-style.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**
  - D22·S01 PPT 장의 각주 글에 `VWorld`·`OpenStreetMap`이 없다.
  - S01 매스 범례 칩 사각형이 `footer`와 겹치지 않는다.
  - 매스 그림 사각형이 기하 `map` 안에 있다.
  - 장미 장 레이아웃 선택지가 `["map-key"]`이고 라벨이 `그림 + 숫자`다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**, lint 0
- [ ] **Step 5: 커밋** — `fix(v2): 그림 타일 장 — 숫자 카드 배치, 바탕지도 없는 장의 출처에서 VWorld 제거, 매스 범례·가장자리`

### Task 9: D17 단면을 그래프 카드 자리에

**Files:**
- Modify: `src/lib/v2/ui/overlay-layout.ts:235` `terrainSectionLayout` — ②에서는 `column.chart1` 사각형을 쓴다. 폭이 3.8 in보다 좁으면 열 폭에 맞춘다.
- Modify: `src/lib/v2/report/report-doc-plan.ts` `pageLayoutForSlide` — D17(단면 있음) 새 쪽 기본은 `map-charts`
- Modify: `src/lib/v2/report/report-layout.ts` `resolveReportLayout` 호출부 — 단면이 있으면 `hasCharts`를 참으로 넘긴다(`chartSlots: 1`).
- Modify: 화면 `TerrainSectionPreview` `:1353`, PPT `render-pptx.ts:579–583` `drawTerrainSectionPptx`
- Test: `test-v2-topo-section-pptx.mjs`, `test-v2-analysis-page-surface.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**
  - D17 새 쪽 layout은 `map-charts`다.
  - 단면 사각형 = `column.chart1`(±0.01)이고 `column.chart2===null`이다.
  - 화면과 PPT의 단면 사각형이 같다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**, lint 0
- [ ] **Step 5: 커밋** — `feat(v2): D17 단면을 지도 + 그래프 열의 그래프 카드 자리에`

### Task 10: 용도지역 설명선 % = 같은 용도지역 합계

**Files:**
- Modify: `src/lib/v2/tile/a12/labels.ts:19` `zoningPolygons`
  - 이름이 붙은(가장 큰) 조각의 sublabel = 같은 이름 조각들의 반경 안 면적 합 몫
  - 이름 없는 조각은 sublabel 없음
  - 같은 함수를 쓰는 `a12/engine.ts:253`·`a12/d08.ts:53`도 함께 바뀐다.
- Modify: `src/lib/v2/engine/tiles/common.ts:33` A12 리비전 `+callout-total-r1`, `test-v2-tile-registry.mjs`
- Test: `test-v2-zoning.mjs`, `test-v2-engine-market-zoning.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**
  - 제2종일반주거 조각 3개(원 면적 몫 5.7·10.2·9.0) 픽스처
  - 이름 붙은 조각 sublabel = `"24.9%"`, 나머지 sublabel = undefined
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** (`percentage` `:13` 재사용)
- [ ] **Step 4: 통과 확인** — 위 + `tile-a12-price`·`tile-registry` PASS, lint 0
- [ ] **Step 5: 커밋** — `fix(v2): 용도지역 설명선 %를 같은 용도지역 합계로`

### Task 11: 정본·전체 검증 (Judge 주도, 기록은 실행자 가능)

**Files:**
- Modify: `docs/design/v2-design-language.md` — §9-8 레이아웃 항목(두 배치·이름·이관·D17), §11 `레이아웃` 줄, §9-12 방위표 크기 식, 범례 위치 2종, 결정 이력 줄(2026-10-30 MAP_LAYOUT_CONCEPT A, 결정 페이지 링크)
- Modify: `tools/qa/README.md` — 새 장 확인 방법 한 단락

- [ ] **Step 1:** `npm run lint` 0, `npm run test:v2` 전체 PASS(출력 마지막 줄 첨부)
- [ ] **Step 2:** 화면 1440×900·1024×768 — `capture-pages.mjs` + my-design-taste `measure.mjs`. A01·A12·D03·D17·D22·S01 장과 A3 판형 1장.
- [ ] **Step 3:** PPT 실렌더(Task 7 Step 5 방식) 같은 장, 화면과 나란히
- [ ] **Step 4:** `tools/qa/export-pdf-png.mjs 0b5ba3aa <out> pdf`, `png` → `pdf-images.mjs`로 빈 쪽 없음·잉크 확인
- [ ] **Step 5:** 정본 갱신 커밋 — `docs(v2): 정본 — 보고서 장 두 배치(지도 + 숫자·지도 + 그래프)`
- [ ] **Step 6:** 최종 브랜치 리뷰(Opus) → 지적 수정 → 사용자에게 배포 여부 질문

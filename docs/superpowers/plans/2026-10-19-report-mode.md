# 보고서 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모달 PPT 미리보기를, 보드와 독립된 페이지 목록을 직접 만들고 고치는 "보고서 모드" 작업 공간으로 바꾼다. 내보내기는 PPT·PDF·PNG다. 타일 모드에서는 보고서 기능을 모두 걷어 낸다.

**Architecture:**
- 순수 모듈 `report-doc.ts`가 보고서 문서 `ReportDoc`(판형 + 페이지 목록)와 리듀서·되돌리기 기록을 갖는다.
- 어댑터 `planReportDoc`가 문서를 기존 `PlannedSlide[]`로 바꾼다. 그래서 PPT 렌더러(`render-pptx.ts`)·지도 그림(`map-image.ts`)·미리보기 표면 컴포넌트를 그대로 확장해 쓴다.
- 보드 상태는 v4로 올린다. `reportDoc`를 저장하고, 옛 보고서 필드는 "불러오기"용으로만 남긴다.

**Tech Stack:** Next.js 15 App Router, React, CSS modules, TS strict, pptxgenjs, html-to-image(설치됨), jszip(설치됨), 테스트는 `node:assert` + `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-10-19-report-mode-design.md` (2026-10-19 승인). 시안: https://claude.ai/artifact/U2a9YuKdD6JvNtibNM7NWj — A1–A4가 기본 화면이고, B3의 숫자 칸·위치도와 C3의 레이아웃 바꾸기·발표 메모, C4의 쓰임 카드를 더한다.

**선행 조건:** 수치지형도 브랜치(`v2-topo-supplement`, Task 10·11)를 `main`에 머지한 뒤 `main`에서 `v2-report-mode` 브랜치를 만든다. Task 10이 D17 단면을 PPT에 넣기 때문에 report 경로가 겹친다.

## Global Constraints

- **의존성:**
  - 새 npm 의존성은 넣지 않는다.
  - `npm install`, `npm ci`는 쓰지 않고 `package.json`과 lock 파일도 고치지 않는다.
  - PDF는 쪽마다 이미지를 만들고 직접 작성한 최소 PDF로 묶는다(스펙 §8 사용자 결정).
- **디자인 언어:**
  - `docs/design/v2-design-language.md`를 따른다.
  - 글꼴: 제목 Do Hyeon, 본문 Noto Sans KR.
  - 색: 글자 `#15171c`, 보조 `#676c76`, 선 `#d9dce2`, 바탕 `#eef0f3`.
  - 선택·포커스 표시는 `#2f6fdb`.
  - 레이어 색과 라벨은 `map-layers.ts`에서만 정한다.
  - 숫자는 `formatMetricValue`로 쓴다.
- **접근성:**
  - 누르는 영역은 44×44 px 이상이고, 포커스 링이 보여야 한다.
  - 호버로만 되는 기능은 없다.
  - 끌어서 하는 조작(페이지 순서, 범례 순서, 타일 넣기)은 모두 버튼이나 키보드로도 할 수 있다(WCAG 2.5.7).
  - 움직임은 150–200 ms `cubic-bezier(0.23, 1, 0.32, 1)`이고, `prefers-reduced-motion`에서는 투명도만 바꾼다.
- **고정 문구** (그대로 쓴다):
  - 빈 상태: `페이지를 추가하세요`, `+ 페이지 추가`, `추천 구성으로 시작`, `이전 보고서 구성 불러오기`
  - 모드 전환: `타일`, `보고서 · {n}쪽`
  - 페이지 종류: `표지`, `분석 타일 한 장`, `여러 타일 비교`, `출처·기준일`, `빈 페이지`
  - 레이아웃: `지도 크게`, `지도 + 요약`, `숫자 먼저`, `다른 타일과 나란히`
  - 내보내기 쓰임: `발표`, `인쇄·제출`, `메신저·문서에 붙이기`, `모두 한 번에`
  - 저장 상태: `저장 안 됨`
- **판형:** `"wide"`는 16:9, 13.333×7.5 in. `"a3"`은 A3 가로, 420×297 mm. `"a4"`는 A4 가로, 297×210 mm. 기본값은 `"wide"`다.
- **화면 = 보고서:** 편집 화면과 내보낸 파일의 배치가 같아야 한다. 페이지 1개는 출력 1쪽이다. 예외는 `출처·기준일` 하나로, 14행을 넘으면 내보낼 때 다음 쪽으로 넘어간다.
- **보드와의 관계:** 보고서 상태는 보드(순서·크기·카드 면·컷·필터·라벨)와 서로 영향을 주지 않는다. 타일의 내용 설정은 페이지에 넣는 순간 복사한다.
- **사용자 말로 쓰기:** 내부 id나 원천 파일명은 화면에 보이지 않는다.

## Review Focus

1. **결과가 바뀐 분석:** 다시 분석해서 어떤 타일 결과가 없어지거나 실패하면, 그 페이지는 자리표시와 `결과 없음`을 그리고 내보내기 전 확인에 경고로 뜬다. 앱이 멈추거나 페이지가 사라지면 안 된다. → Task 3 테스트
2. **옛 저장본을 열 때 타일 id가 바뀐 경우:** v1·v2 저장본의 `rewriteSnapshotIds`가 `reportDoc`와 옛 보고서 필드 모두에 적용돼야 한다. 불러오기 결과에 없는 타일 id가 남으면 안 된다. → Task 4 테스트
3. **고정한 지도에서 판형·레이아웃 바꾸기:** 축척과 중심(`scaleDenominator`, `offsetM`)은 그대로 두고, 보이는 범위만 달라진다. → Task 2, Task 6 테스트
4. **긴 보고서 내보내기:** 35쪽 이상을 PNG·PDF로 내보낼 때, 쪽을 하나씩 순서대로 그려서 메모리가 쌓이지 않아야 한다. 진행률이 보이고, 취소하면 남은 쪽을 그리지 않는다. → Task 9 테스트
5. **글이 있는 페이지 삭제 후 되돌리기:** 발표 메모·글상자·패널 자리까지 그대로 돌아온다. 다시 실행도 된다. 기록은 최대 100단계다. → Task 2 테스트

---

### Task 1: 타일 하나의 슬라이드 생성을 `buildReportPlan`에서 떼어 내기 (동작 변화 없음)

**Files:**
- Modify: `src/lib/v2/report/report-plan.ts:242-545`
- Test: `src/scripts/v2/test-v2-report-tile-slides.mjs`

**Interfaces:**
- Produces:
  - `export type TileReportSettings = { face: OutputFace; callout: CalloutMode; cut?: CutSpec; camera?: CameraPreset; a05Filter?: A05Filter; layer?: string; labels?: PinnedLabel[] }`
  - `export function tileReportSettingsFromBoard(board: BoardState, tileId: string): TileReportSettings`
  - `export function tileSlides(tileId: string, view: TileView, settings: TileReportSettings, ctx: { summary: SummaryView; complexCounts: Record<string, number> }): ReportSlide[]`
    - SHEET, 컷(`CUT_CODES`), 설명선(A05/A06), 앞·뒷면(`both`이면 2장) 분기를 지금 순서 그대로 담는다.
  - `buildReportPlan`은 내부에서 `tileSlides`를 부른다.

- [ ] **Step 1: 실패 테스트 작성**
  - 고덕 픽스처(`GODEOK_RESULTS`)로 `initBoard` 보드를 만든다.
  - `included`인 각 타일에 대해 `tileSlides(...).length`가 `buildReportPlan` 결과 중 같은 타일 접두사 키를 가진 슬라이드 수와 같아야 한다.
  - S02 컷 보드에서 `tileSlides("S02", …)`가 `cut.plan()`이 내는 시트 수 + 단일 1장과 같아야 한다.
  - A05 `callout:"top10"`이면 `calloutReportPages("top10", n)`과 같아야 한다.
- [ ] **Step 2:** `npx tsx src/scripts/v2/test-v2-report-tile-slides.mjs` → `tileSlides is not a function`으로 FAIL해야 한다.
- [ ] **Step 3:** 두 함수를 떼어 내고 `buildReportPlan`이 이를 쓰게 바꾼다.
- [ ] **Step 4:** 새 테스트와 기존 `test-v2-report*.mjs`·`test-v2-ppt-editable-maps.mjs`가 PASS하고, `npm run lint`가 0 errors여야 한다.
- [ ] **Step 5: Commit** — `refactor(v2): 타일 하나의 보고서 슬라이드 생성을 tileSlides로 분리`

### Task 2: 보고서 문서 모델·리듀서·되돌리기 기록

**Files:**
- Create: `src/lib/v2/report/report-doc.ts`
- Test: `src/scripts/v2/test-v2-report-doc.mjs`

**Interfaces:**
- Consumes: Task 1의 `TileReportSettings`
- Produces:
  - 판형과 레이아웃:

    ```ts
    export type ReportFormat = "wide" | "a3" | "a4";
    export type ReportLayout = "map-full" | "map-summary" | "numbers-first" | "side-by-side";
    ```

  - 지도 프레임:

    ```ts
    export type LegendPlacement = "below" | "right" | "hidden";
    export type LabelRule = "site-near" | "all-visible" | "off";
    export type MapFrameState = {
      zoomDelta: number;
      offsetM: [number, number];
      scaleDenominator: number | null;
      locked: boolean;
      basemap: "base" | "road" | "air" | "none";
      hiddenLayers: string[];
      labelRule: LabelRule;
      pinnedKeys: string[];
      legend: { order: string[]; hidden: string[]; visibleOnly: boolean; placement: LegendPlacement };
      decorations: { north: boolean; scaleBar: boolean; locator: boolean };
    };
    ```

  - 페이지:

    ```ts
    export type PagePanels = Partial<Record<"title" | "summary" | "legend", { x: number; y: number; w: number; h: number }>>;
    export type TextBox = { id: string; x: number; y: number; w: number; h: number; text: string; pt: number };
    export type ReportPageBase = { id: string; layout: ReportLayout; panels: PagePanels; textBoxes: TextBox[]; notes: string; titleOverride?: string; summaryOverride?: string };
    export type ReportPage = ReportPageBase & (
      | { kind: "cover" }
      | { kind: "tile"; tileId: string; part: TilePart; settings: TileReportSettings; frame: MapFrameState }
      | { kind: "compare"; grid: "2x2" | "3x2" | "3x1"; cells: { tileId: string; settings: TileReportSettings; frame: MapFrameState }[]; sameExtent: boolean }
      | { kind: "sources" }
      | { kind: "blank" }
    );
    export type TilePart =
      | { type: "single" }
      | { type: "face"; face: "front" | "back" }
      | { type: "callout"; page: number }
      | { type: "cutSheet"; index: number }
      | { type: "cutSingle" };
    export type ReportDoc = { v: 1; format: ReportFormat; pages: ReportPage[] };
    ```

  - 액션과 리듀서:

    ```ts
    export type ReportDocAction =
      | { type: "add"; pages: ReportPage[]; index: number }
      | { type: "remove"; id: string }
      | { type: "move"; id: string; to: number }
      | { type: "duplicate"; id: string }
      | { type: "layout"; id: string; layout: ReportLayout }
      | { type: "frame"; id: string; cell?: number; patch: Partial<MapFrameState> }
      | { type: "panels"; id: string; panels: PagePanels }
      | { type: "notes"; id: string; notes: string }
      | { type: "text"; id: string; title?: string; summary?: string }
      | { type: "textBox"; id: string; box: TextBox | { id: string; remove: true } }
      | { type: "format"; format: ReportFormat }
      | { type: "replaceAll"; pages: ReportPage[] };
    export const EMPTY_REPORT_DOC: ReportDoc; // { v: 1, format: "wide", pages: [] }
    export function reportDocReducer(doc: ReportDoc, action: ReportDocAction): ReportDoc;
    export function defaultFrame(): MapFrameState; // zoomDelta 0, offsetM [0,0], scaleDenominator null, locked false, basemap "base", labelRule "site-near", legend { order: [], hidden: [], visibleOnly: true, placement: "below" }, decorations { north: true, scaleBar: true, locator: false }
    export function newPageId(doc: ReportDoc): string; // "p1", "p2", …, 겹치지 않게
    ```

  - 되돌리기 기록:

    ```ts
    export type ReportHistory = { past: ReportDoc[]; present: ReportDoc; future: ReportDoc[] };
    export function historyApply(h: ReportHistory, a: ReportDocAction): ReportHistory; // past 최대 100
    export function historyUndo(h: ReportHistory): ReportHistory;
    export function historyRedo(h: ReportHistory): ReportHistory;
    ```

  - 규칙:
    - `layout`과 `format`을 바꾸면 해당 페이지(들)의 `panels`를 `{}`로 비운다. 그러면 레이아웃 기본 자리로 돌아간다.
    - 이때 `frame`의 `zoomDelta`·`offsetM`·`scaleDenominator`는 그대로 둔다.
    - `locked`인 프레임에 `zoomDelta`·`offsetM` 패치가 들어오면 무시한다. 다만 `locked: false`를 함께 보내는 패치나 `대지에 맞추기`(`{offsetM:[0,0], zoomDelta:0, scaleDenominator:null}` + `force: true`)는 받는다. 이를 위해 `frame` 액션에 `force?: boolean`을 더한다.

- [ ] **Step 1: 실패 테스트 작성**
  - add·move·duplicate·remove 뒤 페이지 순서와 id가 맞는지 확인한다. `duplicate`는 새 id로 바로 뒤에 넣는다.
  - `layout` 뒤 `panels`는 `{}`이고 `frame.offsetM`은 그대로다.
  - `locked` 프레임은 `{offsetM:[5,5]}`를 무시하고, `force:true`는 받는다.
  - `format:"a3"` 뒤 모든 페이지의 `panels`는 `{}`이고 프레임 값은 그대로다.
  - 기록: 글상자·메모가 있는 페이지를 `remove`한 뒤 `historyUndo`를 하면 원래 문서와 깊은 비교로 같다. `historyRedo` 뒤 다시 지워진다. 101번 적용하면 `past.length === 100`이다.
- [ ] **Step 2:** `npx tsx src/scripts/v2/test-v2-report-doc.mjs` → 모듈이 없어서 FAIL해야 한다.
- [ ] **Step 3:** 구현한다. 리듀서는 불변 갱신만 한다.
- [ ] **Step 4:** PASS, lint 0.
- [ ] **Step 5: Commit** — `feat(v2): 보고서 문서 모델·리듀서·되돌리기 기록`

### Task 3: 문서 → 슬라이드 어댑터, 타일 펼치기, 추천 구성, 옛 구성 불러오기

**Files:**
- Create: `src/lib/v2/report/report-doc-plan.ts`
- Test: `src/scripts/v2/test-v2-report-doc-plan.mjs`

**Interfaces:**
- Consumes: Task 1 `tileSlides`·`tileReportSettingsFromBoard`, Task 2 타입
- Produces:
  - `export function pagesForTile(doc: ReportDoc, tileId: string, view: TileView, settings: TileReportSettings, ctx): ReportPage[]`
    - 타일 하나가 내는 슬라이드 수만큼 `kind:"tile"` 페이지를 만든다.
    - `part`는 슬라이드 종류에 맞춘다. 레이아웃 기본값은 `"map-summary"`이고, 지도가 없는 타일은 `"numbers-first"`다.
  - `export function recommendedPages(doc: ReportDoc, views: Map<string, TileView>, board: BoardState, ctx): ReportPage[]`
    - 표지 → 결과가 있는 타일을 타일 카탈로그 분류 순서로(각각 `pagesForTile`, 설정은 `tileReportSettingsFromBoard`) → 출처.
  - `export function hasLegacyReport(board: BoardState): boolean`
    - `report.extra.length > 0`이거나 `report.styles`에 키가 하나라도 있거나, `included`가 기본값과 다르면 true다.
  - `export function importLegacyReport(doc: ReportDoc, board: BoardState, views, ctx): ReportPage[]`
    - 옛 `buildReportPlan` 순서 그대로 페이지를 만든다.
    - `report.styles[key]`의 `zoomDelta`·`offsetM`·`pinnedKeys`·`hiddenKeys`(→ `legend.hidden`)·`panels`를 해당 페이지로 옮긴다.
  - `export function planReportDoc(doc: ReportDoc, views: Map<string, TileView>, ctx: { summary: SummaryView; analysisDate?: string; sourceMeta?: SourceMeta }): PlannedSlide[]`
    - 페이지마다 `PlannedSlide`를 만든다. 출처만 행 수에 따라 여러 장이 될 수 있다.
    - `key`는 `page.id`이고, 출처의 넘김 쪽은 `${page.id}:${i}`다.
    - `no`와 `total`은 실제 출력 쪽수 기준이다.
    - `PlannedSlide`에 `page: ReportPage`, `format: ReportFormat`, `notes: string`을 더한다(`report-plan.ts`의 타입 확장).
    - 결과가 없는 타일은 `kind:"tile"` + `missing: true` 슬라이드로 만든다. 제목은 타일 카탈로그 이름을 쓴다.
  - `export function printedPageCount(doc, views, ctx): number` — 머리 줄 `보고서 · {n}쪽`에 쓴다.

- [ ] **Step 1: 실패 테스트 작성** (고덕 픽스처)
  - `importLegacyReport`를 `planReportDoc`에 통과시킨 슬라이드 수와 종류 순서가 같은 보드의 `buildReportPlan`과 같다.
  - 옛 `styles`의 `offsetM`이 해당 페이지 `frame.offsetM`으로 옮겨진다.
  - `pagesForTile("S02")`의 길이가 `tileSlides("S02")`의 길이와 같다.
  - A05 `top10`은 개요 1장 + 설명표 장수다.
  - `recommendedPages`의 첫 장은 `cover`, 마지막 장은 `sources`다.
  - 출처 행이 30개이면 출처 1페이지가 슬라이드 3장이 되고 `printedPageCount`에 반영된다.
  - 결과 목록에서 D17을 뺀 뒤 D17 페이지는 `missing:true` 슬라이드가 되고 예외가 나지 않는다(Review Focus 1).
- [ ] **Step 2:** FAIL을 확인한다.
- [ ] **Step 3:** 구현한다.
- [ ] **Step 4:** PASS, lint 0.
- [ ] **Step 5: Commit** — `feat(v2): 보고서 문서를 슬라이드로 바꾸는 어댑터와 추천 구성·옛 구성 불러오기`

### Task 4: 보드 상태 v4 — `reportDoc` 저장과 옛 보고서 보존

**Files:**
- Modify: `src/lib/v2/ui/board-state.ts`
  - 117 `BOARD_STATE_VERSION`
  - 149-190 `BoardState`
  - 1006-1040 snapshot·serialize
  - 1196 `rewriteSnapshotIds`
  - 1319 `migrateSnapshot`
  - 1347 `restoreBoardState`
- Test: `src/scripts/v2/test-v2-board-state-v4.mjs`

**Interfaces:**
- Consumes: Task 2 `ReportDoc`·`EMPTY_REPORT_DOC`·`reportDocReducer`
- Produces:
  - `BoardState.reportDoc: ReportDoc`
  - `BoardAction | { type: "reportDoc"; doc: ReportDoc }`
    - 보고서 모드가 기록 적용 결과를 통째로 넣는다. 보드의 `undoStack`에는 쌓지 않는다.
  - `BOARD_STATE_VERSION = 4`
  - `migrateV3ToV4(snap)`: `reportDoc = EMPTY_REPORT_DOC`. 옛 `report`·`included`·`faces`·`callout`은 그대로 남긴다. 불러오기의 원천이다.
  - `restoreReportDoc(value: unknown, validTileIds: Set<string>): ReportDoc`
    - 모르는 값은 버린다.
    - 없는 타일을 가리키는 페이지는 지우지 않는다. `missing`으로 그리기 위해서다.
    - 그러나 id 형식이 틀린 값은 버린다.
  - `rewriteSnapshotIds`가 `reportDoc` 안의 `tileId`·`cells[].tileId`에도 적용된다.

- [ ] **Step 1: 실패 테스트 작성**
  - v3 저장본 → 복원 결과에 `reportDoc`가 빈 문서이고, `hasLegacyReport`(Task 3)가 옛 `extra`가 있으면 true다.
  - v4로 직렬화하고 복원해도 `reportDoc`가 깊은 비교로 같다.
  - 타일 이름이 바뀐 v1 저장본(`migrateV1ToV2`의 renameTileId 경로)에서 `reportDoc`의 tileId도 새 이름이 된다(Review Focus 2).
  - `{type:"reportDoc"}`는 `undoStack` 길이를 바꾸지 않는다.
  - 버전 5 저장본은 `null`을 반환한다(기존 규칙).
- [ ] **Step 2:** FAIL을 확인한다.
- [ ] **Step 3:** 구현한다. 저장·`projectDirty`·localStorage는 직렬화 결과를 쓰므로 자동으로 따라온다. `page.tsx`는 이 Task에서 바꾸지 않는다.
- [ ] **Step 4:** 새 테스트와 `test-v2-ui-board-state.mjs`가 PASS하고, 전체 `npm run test:v2`가 green, lint 0이어야 한다.
- [ ] **Step 5: Commit** — `feat(v2): 보드 상태 v4에 보고서 문서 저장, 옛 보고서는 불러오기용으로 보존`

### Task 5: PPT 렌더러 확장 — 판형·발표 메모·글상자·레이아웃·지도 프레임 설정

**Files:**
- Modify: `src/lib/v2/report/render-pptx.ts` (294 cover, 331 tile, 429 sheet, 479 sources, 511 `renderReportPptx`)
- Modify: `src/lib/v2/report/map-pptx.ts` (756 `addEditableMap`)
- Modify: `src/lib/v2/report/pptx-kit.ts`
- Modify: `src/lib/v2/ui/overlay-layout.ts:64` (`SLIDE`를 판형별로)
- Test: `src/scripts/v2/test-v2-report-doc-pptx.mjs`

**Interfaces:**
- Consumes: Task 3 `planReportDoc`(슬라이드에 `page`·`format`·`notes`)
- Produces:
  - `export function slideSize(format: ReportFormat): { w: number; h: number }` (인치)
    - `wide` → 13.333×7.5
    - `a3` → 16.535×11.693
    - `a4` → 11.693×8.268
  - `export function layoutRects(layout: ReportLayout, format: ReportFormat): { map: Rect | null; title: Rect; summary: Rect | null; legend: Rect | null; second?: Rect }` (슬라이드 비율 0..1)
    - `map-full`: 지도가 쪽 전체를 채우고 패널이 그 위에 얹힌다(지금 방식).
    - `map-summary`: 지도 왼쪽 약 60%, 오른쪽에 요약.
    - `numbers-first`: 요약 왼쪽, 지도 오른쪽 약 44%.
    - `side-by-side`: 지도 두 칸. 두 번째 칸은 같은 장의 `compare` 2칸으로 그린다.
  - `renderReportPptx(plan)`의 동작:
    - 판형으로 `pptx.defineLayout`을 정한다.
    - `notes`가 있으면 `s.addNotes(notes)`. 자동 노트가 있으면 사용자 메모 뒤에 줄을 바꿔 붙인다.
    - `textBoxes`는 편집 가능한 텍스트 상자로 넣는다.
    - `panels` 비율이 있으면 그 자리, 없으면 `layoutRects` 기본 자리를 쓴다.
  - `addEditableMap`이 `frame`을 반영한다:
    - `hiddenLayers`
    - `labelRule`: `site-near`는 대지 반경 안 지번만, `off`는 없음.
    - 범례: `legend.order` 순서, `hidden` 제외, `visibleOnly`이면 지도 범위 안의 레이어만, `placement`.
    - 장식: 방위표, 축척 막대(축척 막대 m는 1·2·5×10ⁿ 중 지도 폭 20% 이하에서 가장 큰 값), 위치도(대지 중심 2 km 범위 회색 배경 + 대지 사각형).
    - `scaleDenominator`가 있으면 그 축척을 쓴다(`zoomDelta`보다 우선).

- [ ] **Step 1: 실패 테스트 작성** (JSZip으로 PPTX XML 확인, `test-v2-ppt-editable-maps.mjs` 방식)
  - `a3` 문서 → `ppt/presentation.xml`의 `sldSz cx="15120000" cy="10692000"`.
  - 메모 `"남쪽 경계 먼저"` → `ppt/notesSlides/notesSlide1.xml`에 그 글자가 있다.
  - 글상자 `"검토 의견"` → 슬라이드 XML에 `<a:t>검토 의견</a:t>`.
  - `legend.hidden:["건물"]` → 범례 그룹에 "건물"이 없다.
  - `decorations.scaleBar:true`이면 축척 막대 그룹 이름(`editableMapAvoid`과 같은 태그 규칙)이 있고, `false`이면 없다.
  - `layout:"numbers-first"`에서 지도 그룹의 x가 슬라이드 폭 50%보다 크다.
  - 고정 지도(`locked`, `scaleDenominator:2500`)를 `wide`와 `a3`로 각각 그렸을 때 축척 막대 m 값이 같다(Review Focus 3).
- [ ] **Step 2:** FAIL을 확인한다.
- [ ] **Step 3:** 구현한다. `buildReportPlan` 경로(옛 미리보기)는 Task 10에서 지울 때까지 깨지지 않게 둔다.
- [ ] **Step 4:** 새 테스트와 기존 PPT 테스트가 PASS하고, lint 0이어야 한다.
- [ ] **Step 5: Commit** — `feat(v2): PPT에 판형·발표 메모·글상자·레이아웃·지도 프레임 설정 반영`

### Task 6: 미리보기 표면 컴포넌트를 모달에서 떼어 공용으로

**Files:**
- Create: `src/components/v2/report/slide-surface.tsx`, `src/components/v2/report/slide-surface.module.css`
- Modify: `src/components/v2/report-preview.tsx` (285 `MapLayer`, 517–807 패널·표면, 808 `PanelTransformFrame`, 834 `SlidePreview`, 1019 `ThumbnailPreview`). 옮기고 import로 바꾼다.
- Test: `src/scripts/v2/test-v2-report-surface.mjs` (react-dom/server로 정적 렌더)

**Interfaces:**
- Consumes: Task 3 `PlannedSlide`(page·format), Task 5 `layoutRects`·`slideSize`
- Produces:
  - `export function SlideSurface(props: { slide: PlannedSlide; basemap: BasemapChoice; mode: "edit" | "thumb" | "export"; selection?: SurfaceSelection; onSelect?(s: SurfaceSelection): void; onFrame?(cell: number | undefined, patch: Partial<MapFrameState>): void; onPanels?(panels: PagePanels): void; onTextBox?(box: TextBox | { id: string; remove: true }): void; mapActive?: boolean; onMapActive?(active: boolean): void }): JSX.Element`
  - `export type SurfaceSelection = { kind: "map"; cell?: number } | { kind: "panel"; key: "title" | "summary" | "legend" } | { kind: "textBox"; id: string } | null`
  - `mode:"export"`는 선택 테두리·핸들 없이 판형 그대로 그린다. Task 9의 PNG·PDF가 이걸 쓴다.
  - 판형 비율은 `slideSize(format)`을 따르고, 영역은 `layoutRects`·`panels`를 따른다.
  - 지도 활성화:
    - `mapActive`일 때만 끌기와 휠로 `onFrame({offsetM|zoomDelta})`를 보낸다.
    - `locked`이면 끌어도 보내지 않고 `지도 위치 고정됨` 상태 문구를 보인다.

- [ ] **Step 1: 실패 테스트 작성**
  - `renderToStaticMarkup(<SlideSurface mode="export" slide={a3 tile slide}/>)`의 루트 `aspect-ratio`가 `16.535 / 11.693`이다.
  - `mode="thumb"`에는 `button` 요소가 0개다.
  - `numbers-first`에서 지도 영역 `left`가 50%보다 크다.
  - `missing` 슬라이드는 `결과 없음` 글자를 포함한다.
- [ ] **Step 2:** FAIL을 확인한다.
- [ ] **Step 3:** 옮긴다. 옛 모달이 새 컴포넌트를 쓰게 바꾸고, 옛 모달은 Task 10에서 지운다.
- [ ] **Step 4:** PASS, 전체 `test:v2` green, lint 0.
- [ ] **Step 5: Commit** — `refactor(v2): 보고서 페이지 표면을 모달에서 떼어 공용 컴포넌트로`

### Task 7: 보고서 모드 작업 공간 — 모드 전환·빈 상태·도구 레일·서랍·페이지 줄

먼저 `ui-ux-pro-max` 스킬을 읽는다. 시안 A1·A2가 기준이다.

**Files:**
- Create:
  - `src/components/v2/report/report-mode.tsx`, `report-mode.module.css`
  - `page-strip.tsx`
  - `drawer-pages.tsx`
  - `drawer-tiles.tsx`
- Modify: `src/app/v2/page.tsx`
  - 머리 줄에 모드 전환
  - `mode` 상태
  - 보고서 모드일 때 보드 대신 `<ReportMode>`
- Test: `src/scripts/v2/test-v2-report-mode-state.mjs` (순수 헬퍼만)

**Interfaces:**
- Consumes: Task 2 기록 함수, Task 3 `pagesForTile`·`recommendedPages`·`importLegacyReport`·`hasLegacyReport`·`printedPageCount`, Task 4 `{type:"reportDoc"}`, Task 6 `SlideSurface`
- Produces:
  - `export default function ReportMode(props: { board: BoardState; dispatch: Dispatch<BoardAction>; views: Map<string, TileView>; summary: SummaryView; analysisDate: string; basemap: BasemapChoice; dirty: boolean })`
  - 순수 헬퍼 (`src/lib/v2/ui/report-mode-logic.ts`):
    - `insertIndexAfter(doc, selectedId | null): number`
    - `pagesUsingTile(doc, tileId): number[]` — 1부터 센 쪽번호. `n쪽에 있음` 표시에 쓴다.
    - `moveByKey(doc, id, key: "ArrowLeft" | "ArrowRight" | "Home" | "End"): ReportDocAction | null`
- 화면 규칙:
  - **모드 전환:** 머리 줄 가운데 `role="tablist"`. `타일` / `보고서 · {printedPageCount}쪽`. 모드는 URL `?mode=report`에 남아 새로고침해도 유지된다.
  - **빈 상태 (0쪽):**
    - 캔버스 자리에 점선 판형, 제목 `페이지를 추가하세요`, `+ 페이지 추가`(페이지 서랍 열기), `추천 구성으로 시작`을 둔다.
    - `hasLegacyReport`이면 `이전 보고서 구성 불러오기`를 더한다.
    - 페이지 줄에는 `+ 페이지` 하나만 있다.
  - **도구 레일 (76 px):** `페이지` / `분석 타일` / `글상자` / `테마`. 서랍은 312 px이고, 같은 버튼을 다시 누르면 닫힌다.
    - `테마` 서랍은 v1에서 판형 선택과 제목·본문 글자 크기 배율(0.85 / 1 / 1.15)만 다룬다.
  - **페이지 서랍:** 종류 다섯 개를 시안 A1 카드로 보여 준다. 누르면 선택 페이지 뒤에 넣는다(`insertIndexAfter`).
    - `분석 타일 한 장`은 타일 서랍을 연다.
    - `여러 타일 비교`는 칸 구성 선택 → 타일 체크 목록(칸 수까지) → `만들기` 순서다. 시안 B2의 흐름을 서랍 안에서 쓴다.
  - **타일 서랍:**
    - 라벨 있는 검색, 분류 칩(`전체 {n}` + 카탈로그 분류), 타일 행을 둔다. 타일 행은 점·이름·핵심 숫자·`+` 44 px로 이루어진다.
    - 넣은 타일은 `{쪽}쪽에 있음`을 표시한다.
    - 행을 페이지 줄이나 캔버스로 끌어다 놓아도 된다.
    - 키보드로는 행에서 Enter를 누르면 선택 페이지 뒤에 넣는다.
  - **페이지 줄 (128 px):**
    - 썸네일은 `SlideSurface mode="thumb"`이고 아래에 `{n} {제목}`.
    - 출처가 넘치면 `+{k}쪽` 배지를 붙인다.
    - 끌어서 순서를 바꾼다(놓을 자리에 파란 세로선).
    - 썸네일에 포커스를 두고 ←/→/Home/End를 누르면 `moveByKey`로 옮긴다.
    - 썸네일 ⋯ 메뉴: `복제`, `앞으로`, `뒤로`, `삭제`.
  - **추가·삭제 뒤 토스트:** `{제목} 페이지를 {n}쪽에 추가했습니다` / `{제목} 페이지를 지웠습니다` + `되돌리기`.
  - **머리 줄:** 문서 이름(`{주소 짧게} 대지분석 보고서`), 저장 상태(`dirty`이면 `저장 안 됨`), 실행 취소·다시 실행(Ctrl+Z / Ctrl+Shift+Z, 보고서 모드에서만), 판형 select, `발표 미리보기`, `내보내기`.
  - **기록:** 컴포넌트 안에서 `ReportHistory`를 갖고, 바뀔 때마다 `dispatch({type:"reportDoc", doc: present})`를 보낸다.
  - **`발표 미리보기`:** 지금 타일 모드 내보내기 메뉴의 `발표` 기능(`page.tsx` 1110-1150 안의 발표 버튼과 그 핸들러)을 재사용한다. 입력을 `planReportDoc` 슬라이드로 바꾼다. 페이지 0쪽이면 비활성이다.

- [ ] **Step 1: 실패 테스트 작성**
  - `insertIndexAfter(doc,null) === doc.pages.length`이고, 선택이 2번째면 2.
  - `pagesUsingTile`가 펼친 S02 페이지들의 쪽번호를 모두 돌려준다.
  - 첫 페이지에서 `moveByKey(…,"ArrowLeft")`는 `null`이고, `End`는 `{type:"move",to:last}`.
- [ ] **Step 2:** FAIL을 확인한다.
- [ ] **Step 3:** 구현한다.
- [ ] **Step 4:** PASS, lint 0, 전체 `test:v2` green.
- [ ] **Step 5: 브라우저 QA** (Judge가 로그인 세션으로 1280·1440)
  - 0쪽 빈 상태와 문구
  - 추천 구성으로 시작
  - 이전 보고서 구성 불러오기(옛 저장본)
  - 타일 넣기(+, 끌기, Enter)
  - 페이지 줄 끌기·키보드 이동
  - 되돌리기 토스트, Ctrl+Z/Ctrl+Shift+Z
  - 새로고침 뒤 유지
- [ ] **Step 6: Commit** — `feat(v2): 보고서 모드 작업 공간(모드 전환·빈 상태·서랍·페이지 줄)`

### Task 8: 지도 프레임 편집·레이아웃 바꾸기·발표 메모·글상자

먼저 `ui-ux-pro-max` 스킬을 읽는다. 시안 A3(떠 있는 툴바·지도 설정 서랍), B3(숫자 칸·위치도), C3(레이아웃 바꾸기·발표 메모·범례 팝오버)가 기준이다.

**Files:**
- Create:
  - `src/components/v2/report/drawer-map.tsx`
  - `map-toolbar.tsx`
  - `layout-switcher.tsx`
  - `notes-field.tsx`
- Modify: `src/components/v2/report/report-mode.tsx`, `slide-surface.tsx`
- Create: `src/lib/v2/ui/report-scale.ts`
- Test: `src/scripts/v2/test-v2-report-scale.mjs`

**Interfaces:**
- Consumes: Task 2 액션(`frame`·`layout`·`notes`·`textBox`·`text`), Task 6 `SlideSurface` 콜백
- Produces (`report-scale.ts`):
  - `scaleForFrame(frame, mapWidthMm: number, radiusM: number): number` — 현재 축척 분모, 정수, 반올림 10 단위.
  - `zoomForScale(denominator, mapWidthMm, radiusM): number` — `zoomDelta`로 바꾼다.
  - `SCALE_PRESETS = [1000, 2500, 5000, 10000]`
  - `parseScaleInput(text): number | null` — `"1:2,500"`, `"2500"`, `"1/2500"`을 받는다. 범위는 500..50000.
- 화면 규칙:
  - **지도 선택:** 지도를 한 번 누르면 선택(파란 테두리 + 모서리 핸들)이 되고, 지도 설정 서랍이 자동으로 열린다.
  - **지도 안으로 들어가기:** 두 번 누르거나 툴바의 `지도 이동`을 누르면 활성화된다.
    - 활성화 상태에서는 끌어 이동하고 휠로 확대한다.
    - 아래에 `지도를 끌어 옮기고 휠로 확대합니다 · Esc 또는 바깥을 누르면 끝납니다`를 띄운다.
    - Esc나 바깥을 누르면 끝난다.
  - **떠 있는 툴바** (지도 위):
    - `−` / 축척 표시 `1:{n}` / `+`
    - `대지에 맞추기`
    - `지도 이동` ↔ `지도 이동 중 · 끝내기`
    - `⋯`
  - **지도 설정 서랍** (위에서 아래로):
    - 배경지도 4칸(`일반`·`도로`·`항공`·`없음`)
    - 보기 범위:
      - `−`, 축척 입력 칸(`parseScaleInput`, 오류는 칸 아래에 `1:500부터 1:50,000까지 입력합니다`)
      - 프리셋 4개
      - `동쪽으로 {m}`·`북쪽으로 {m}` 숫자 칸
      - `대지에 맞추기`, `반경 전체 보기`
      - `지도 위치 고정` 체크
    - 라벨 3개 라디오(`대지 주변 지번만`·`보이는 지번 모두`·`끄기`)
    - 표시 레이어 체크(이름은 `map-layers.ts` 라벨)
    - 범례:
      - 항목마다 끌기 손잡이 + 체크 + `↑`·`↓` 버튼 + `보이는 것만` 체크
      - 위치 3칸(`지도 아래`·`오른쪽`·`숨김`)
    - 지도 장식: `방위표`·`축척 막대`·`위치도 (넓은 범위에 대지 표시)`
  - **비교 페이지:** 칸을 고른 뒤 같은 서랍을 쓴다. `sameExtent`이면 한 칸에서 바꾼 축척·이동이 모든 칸에 들어간다.
  - **레이아웃 바꾸기:** 캔버스 오른쪽 216 px 세로 목록, 썸네일 4개(C3). `지도 위치와 확대는 그대로 두고 배치만 바꿉니다.`
  - **발표 메모:** 캔버스 아래 라벨 `발표 메모 (내보낸 PPT의 노트에 들어갑니다)`와 textarea. 입력 600 ms 뒤에 반영하고, 되돌리기는 입력 묶음 단위다.
  - **글상자:**
    - 레일 `글상자`를 누르면 선택 페이지 가운데에 `글을 입력하세요` 상자가 생기고 바로 편집 상태가 된다.
    - 끌어서 옮기고 모서리로 크기를 바꾼다.
    - Delete로 지운다(편집 중이 아닐 때).
  - **제목·요약 글자:** 두 번 누르면 바로 고칠 수 있다(`text` 액션).

- [ ] **Step 1: 실패 테스트 작성**
  - `parseScaleInput("1:2,500") === 2500`, `("1/2500") === 2500`, `("abc") === null`, `("1:100") === null`.
  - `zoomForScale(scaleForFrame(f, w, r), w, r)`가 `f.zoomDelta`와 0.01 이내로 같다.
- [ ] **Step 2:** FAIL을 확인한다.
- [ ] **Step 3:** 구현한다.
- [ ] **Step 4:** PASS, lint 0, 전체 `test:v2` green.
- [ ] **Step 5: 브라우저 QA** (Judge, 1280·1440)
  - 지도 활성화와 끌기·휠
  - 고정했을 때 끌기 무시
  - 축척 입력·프리셋
  - 범례 ↑↓·키보드
  - 레이아웃 4종 전환 시 지도 유지
  - 판형 A3 전환 시 축척 유지
  - 발표 메모 입력과 되돌리기
  - 글상자 넣기·옮기기·지우기
- [ ] **Step 6: Commit** — `feat(v2): 보고서 지도 프레임 편집·레이아웃 바꾸기·발표 메모·글상자`

### Task 9: 내보내기 — 쓰임 먼저, 내보내기 전 확인, PPT·PNG·PDF·zip

**Files:**
- Create:
  - `src/components/v2/report/export-panel.tsx`
  - `src/lib/v2/report/preflight.ts`
  - `src/lib/v2/report/raster-export.ts`
  - `src/lib/v2/report/pdf-writer.ts`
- Modify: `src/app/v2/page.tsx` — `makeReport`(805)가 `planReportDoc`를 쓰게 한다.
- Test: `src/scripts/v2/test-v2-report-export.mjs`

**Interfaces:**
- Consumes: Task 3 `planReportDoc`, Task 5 `renderReportPptx`, Task 6 `SlideSurface mode="export"`
- Produces:
  - `export type PreflightIssue = { pageNo: number; pageId: string; level: "warn" | "ok"; text: string }`
  - `export function preflightReport(plan: PlannedSlide[], measures: Map<string, { legendOverflow: boolean }>): PreflightIssue[]`
    - 규칙과 문구:
      - 지도 페이지에 축척 막대·방위표가 없으면 `{n}쪽 지도에 축척 막대나 방위표가 없습니다`
      - 출처 페이지가 없으면 `출처 페이지가 없습니다`
      - 결과 없는 타일 페이지는 `{n}쪽 {타일}의 분석 결과가 없습니다`
      - 범례가 넘치면 `{n}쪽 범례 한 줄이 페이지 밖으로 넘칩니다`
      - 문제가 없으면 `ok` 항목 `모든 지도에 축척·방위표가 있습니다`, `출처 페이지가 들어 있습니다`.
  - `export function writeImagePdf(pages: { jpeg: Uint8Array; widthPx: number; heightPx: number }[], format: ReportFormat): Uint8Array`
    - 의존성 없이 최소 PDF 1.4를 직접 쓴다(쪽마다 `/DCTDecode` 이미지 XObject 1개, MediaBox는 판형 pt).
  - `export async function rasterizePages(plan: PlannedSlide[], opts: { dpi: 150 | 300; format: ReportFormat; signal?: AbortSignal; onProgress?(done: number, total: number): void; render(slide: PlannedSlide): Promise<HTMLElement> }): AsyncGenerator<{ index: number; png: Blob }>`
    - 한 쪽씩 화면 밖 `SlideSurface mode="export"`를 그리고 `html-to-image`의 `toBlob`(pixelRatio = dpi/96)으로 만든 뒤 바로 DOM을 비운다.
  - 내보내기 패널 화면:
    - `내보내기` 버튼 아래 팝오버(A4 위치)다. `role="dialog"`, Esc로 닫고 포커스는 버튼으로 돌아간다.
    - 맨 위 `어디에 쓰실 건가요?` 쓰임 카드 4개(C4):
      - `발표`: PPT, 메모 포함
      - `인쇄·제출`: PDF, 판형 그대로, 300 dpi
      - `메신저·문서에 붙이기`: PNG, 쪽마다, 2쪽 이상이면 zip
      - `모두 한 번에`: zip에 PPT + PDF + PNG 폴더
    - 이어서 페이지(`전체 {n}쪽` / `지금 쪽만` / `골라서` → 페이지 줄에서 체크), PPT일 때 `지도 그리기`(`편집 가능한 도형` / `이미지 한 장`), 파일 이름(`reportFileName` 기본값)
    - `내보내기 전 확인` 목록과 `{n}쪽 보기`
    - 실행 버튼(`PPT 내려받기 · {n}쪽` / `PDF 내려받기 · {n}쪽` / `이미지 내려받기 · {n}쪽` / `모두 내려받기`)
    - 진행 중에는 `{done}/{total}쪽 만드는 중…`과 `취소`를 보인다.

- [ ] **Step 1: 실패 테스트 작성**
  - `writeImagePdf`로 1×1 JPEG 두 쪽을 쓰면 결과가 `%PDF-1.4`로 시작하고, `/Type /Page`가 2번 나오고, `a3`의 MediaBox가 `[0 0 1190.55 841.89]`이고, `%%EOF`로 끝난다.
  - `preflightReport`: 축척 막대를 끈 지도 페이지가 있으면 `warn` 하나에 쪽번호가 맞다. 출처 없는 문서는 `출처 페이지가 없습니다`. 모두 정상이면 `ok` 두 개뿐이다.
  - `rasterizePages`에 가짜 `render`(빈 div)와 `toBlob` 스텁을 넣고, 3쪽 중 2쪽 뒤에 `abort`하면 생성된 쪽은 2개이고 세 번째 `render`는 불리지 않는다(Review Focus 4).
- [ ] **Step 2:** FAIL을 확인한다.
- [ ] **Step 3:** 구현한다.
- [ ] **Step 4:** PASS, lint 0, 전체 `test:v2` green.
- [ ] **Step 5: 브라우저 QA** (Judge)
  - 도곡동 467, 표지 + 타일 4 + 출처로 PPT·PDF·PNG·zip을 각각 내보낸다.
  - PPT를 열어 메모·판형·지도 편집 가능 여부를 확인한다.
  - PDF는 A3 쪽 크기를 확인한다.
  - 35쪽 추천 구성 PDF의 진행률과 취소를 확인한다.
- [ ] **Step 6: Commit** — `feat(v2): 보고서 내보내기(쓰임 먼저·내보내기 전 확인·PPT·PDF·PNG·zip)`

### Task 10: 타일 모드 정리와 옛 미리보기 제거

**Files:**
- Modify: `src/components/v2/tile-card.tsx` (178-189 `FaceSelect`, 448 `MoreMenu` 549-551·625-628, 687-690, 759-762, props 332-333·367-368·393-394·869-870)
- Modify: `src/components/v2/tile-dialog.tsx` (25-33 props, 246-265 `.dlgReport`. PNG·SVG 저장 버튼과 `CutSelect`는 남긴다)
- Modify: `src/app/v2/page.tsx`
  - 1104·1190 표지 안내 문구
  - 1110-1150·1196-1219 내보내기 메뉴 → `파일 ▾`(DXF×2·GLB·DAE·3DM만). PPT와 `발표`는 보고서 모드로 옮겼으므로 뺀다(Task 7).
  - 799 `openReportPreview`
  - 1389-1403 `<ReportPreview>`
  - 1332-1340 `TileDialog`의 보고서 props
  - 914-918 `onTileAction` include·face
- Delete: `src/components/v2/report-preview.tsx`, `report-preview.module.css`, `src/lib/v2/ui/report-preview-logic.ts` 중 Task 6·7이 쓰지 않는 부분. 남는 함수는 `report-mode-logic.ts`로 옮긴다.
- Modify: `src/lib/v2/ui/board-status.ts:103` `exportAvailability`(3D·CAD만)
- Test: `src/scripts/v2/test-v2-tile-mode-no-report.mjs`. 지운 기능을 기대하는 기존 테스트(`test-v2-report-preview.mjs` 등)는 새 경로 테스트로 바꾸거나 지운다. 무엇을 왜 지웠는지 보고서에 적는다.

**Interfaces:**
- Consumes: Task 7 모드 전환(보고서는 거기서만)
- Produces: 타일 모드 화면에 보고서 관련 조작이 없다. 보드 리듀서의 `include`·`face`·`callout`·`pageStyle`·`addPage`·`removePage` 등 옛 보고서 액션은 지운다. 옛 필드는 v4 저장본에 불러오기용으로만 남는다(Task 4).

- [ ] **Step 1: 실패 테스트 작성**
  - `renderToStaticMarkup`으로 `TileCard`(요약면·지도면)와 `TileDialog`를 그렸을 때 `보고서`라는 글자와 `aria-label`이 `보고서 포함`인 요소가 없다.
  - `page.tsx` 소스에 `ReportPreview` import가 없다.
  - `exportAvailability` 결과 키는 `dxf`·`glb`·`dae`·`3dm`뿐이다.
- [ ] **Step 2:** FAIL을 확인한다.
- [ ] **Step 3:** 구현한다. 보고서 모드(Task 7–9) 기능은 그대로여야 한다.
- [ ] **Step 4:** PASS, lint 0, 전체 `test:v2` green.
- [ ] **Step 5: 브라우저 QA** (Judge)
  - 타일 모드 카드·⋯ 메뉴·상세 창에 보고서 조작이 없다.
  - `파일 ▾`에 3D·CAD 내보내기가 남아 있다.
  - 수치지형도·컷·S01 카메라 등 타일 기능은 이전과 같다.
- [ ] **Step 6: Commit** — `refactor(v2): 타일 모드에서 보고서 기능을 걷어 내고 옛 미리보기 제거`

### Task 11: 디자인 언어 문서 반영과 마무리 검증 (Judge)

- [ ] **디자인 언어 문서:** `docs/design/v2-design-language.md`에 §11 "보고서 모드"를 더한다(시안 링크, 사용자 승인 2026-10-19). 넣을 내용은 다음과 같다:
  - 모드 전환
  - 레일·서랍 폭
  - 페이지 줄
  - 지도 활성화
  - 떠 있는 툴바
  - 범례 위치 3종
  - 레이아웃 4종
  - 내보내기 쓰임 4종
  - 고정 문구
- [ ] **lint와 테스트:** `npm run lint` 0, `npm run test:v2` 전체 green. 파일 수가 Task 1 시작 때보다 늘었는지 확인한다.
- [ ] **실제 브라우저 전체 흐름:** 1440·1280에서 다음 순서로 확인하고, 스크린샷을 `scratchpad/report-mode/shots/`에 남긴다.
  1. 분석
  2. 보고서 모드
  3. 0쪽
  4. 추천 구성
  5. 지도 2쪽 편집
  6. A3 전환
  7. 메모
  8. PDF·PPT 내보내기
  9. 타일 모드로 돌아가 보드가 그대로인지 확인
  10. 저장
  11. 새로고침
  12. 프로젝트 다시 열기
- [ ] **390 px:** 보고서 모드는 볼 수 있어야 한다. 페이지 줄과 내보내기가 동작하고 가로 스크롤이 없어야 한다. 편집 서랍은 전체 화면 시트로 연다.
- [ ] **옛 저장본:** 옛 v3 프로젝트 하나를 열어 `이전 보고서 구성 불러오기`로 원래 PPT와 쪽수가 같은지 확인한다.
- [ ] **배포 전 확인:** 사용자 승인 없이 push·배포하지 않는다.

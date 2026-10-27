# 지도 색(바탕 테마·다이어그램 팔레트) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보드와 보고서에서 지도 색을 고른다. 고르는 건 두 층이다. 바탕 테마(프리셋 8개)와 다이어그램 팔레트(프리셋 8개)이고, 둘 다 「색 만들기」로 직접 만들고 「내 테마」(계정에 저장)로 남길 수 있다. 바탕 레이어(건물·필지선·도로·녹지·물)는 하나씩 켜고 끌 수 있다. 고른 색과 켜기 상태는 화면과 PPT 도형·범례에 같게 반영된다.

**사용자 결정(2026-10-27):** UI는 C안. 「내 테마」는 계정에 저장(서버 DB). 바탕 레이어 켜기·끄기를 포함한다. T6 구현은 2단계 시안 작업과 동시에 진행한다.

**Architecture:**
- 색 계산과 프리셋은 순수 모듈 세 개에 둔다: `map-theme.ts`(바탕), `map-palette.ts`(다이어그램), `map-color.ts`(색 계산·생성기·경고).
- 두 층 모두 **지도 모델(`MapModel`)에 실어 보낸다**(`baseTheme`, `palette`). 화면 SVG·PPT 도형·범례는 모델에서 색을 읽는다. 그래서 미리보기와 PPT가 구조상 같아진다.
- 저장 위치: 보드 전체는 `BoardState`, 보고서 전체·쪽별 덮어쓰기는 `ReportDoc`·`ReportPage`, 「내 테마」 목록은 계정(서버 DB 표 `user_map_colors` + `/api/user/map-colors`).
- 바탕 레이어 숨기기는 색 선택과 같은 범위(쪽 > 보고서 > 보드)로 저장한다. 모델의 `baseHide`로 실어 보내고, `buildMapScene`이 기존 타일별 바탕 생략(`BASE_SUPPRESS`)에 더한다.
- UI는 사용자가 고른 C안 작은 팝오버다. 보드는 `기본 지도 ▾`, 보고서는 도구 막대 `지도 색`에서 연다.

**Tech Stack:** Next.js(React) · TypeScript · pptxgenjs · node:assert 테스트(`npx tsx src/scripts/v2/<file>.mjs`, 전체 `npm run test:v2`)

**Spec:** `C:\Users\da\.claude\plans\declarative-painting-sunrise.md` §1-3 T6. UI 결정: `docs/design/v2-design-language.md` 결정 이력 2026-10-27 행. 결정 페이지 소스(프리셋 값·생성 규칙의 출처): `C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/b55c10bb-d12c-4db2-9c95-25579c8ef4f7/scratchpad/theme-ui/page.src.html` (게시본: https://claude.ai/artifact/RbCYZuNnDstjp58whwzcVA).

## Global Constraints

- **기본값은 지금과 같다.** 바탕 `warm` + 팔레트 `app`(= 색을 바꾸지 않음)이면 화면·PPT 출력이 바이트 단위로 지금과 같다. 기존 테스트 기대값을 바꾸지 않는다.
- 엔진 출력은 바꾸지 않는다. 따라서 `TILE_CACHE_REVISION`도 올리지 않는다.
- 바탕 건물은 중성 한 색이다. 용도색은 다이어그램(타일 레이어) 몫이다(사용자 지적 2026-10-27).
- 바탕 라벨 글자색은 모든 프리셋 바탕에서 4.5:1 이상이어야 한다(디자인 언어 §3).
- 사용자 문구는 한국어로 쓰고, 내부 id·영문 코드를 화면에 내보이지 않는다(taste 강한 선호).
- 지원 폭은 1024 px 이상(PC·태블릿 가로)이다. 1023 px 이하에는 새 UI를 넣지 않는다(기존 모바일 코드는 그대로 둔다).
- 편집기 팝오버 폭은 288 px(`.railPopover`)이다. 카드 모양은 흰 바탕·`#e1e4e9` 1 px 테두리·12 px 모서리·기존 그림자·꼬리로 기존 팝오버와 같게 한다. 검은 떠 있는 창은 금지(taste 금지).
- 브리프 공통: 상위 목표 줄을 넣고, 작업 중에는 관련 테스트만, 마지막에 전체 1회 돌린다. UI 작업은 `ui-ux-pro-max`·`my-design-taste`를 적용하고, 보고서 끝에 `skill 후보:`·`taste 후보:` 줄을 둔다.

## Review Focus

1. **옛 저장본·손상된 값:** 모르는 테마 id, hex가 아닌 색, 개수가 틀린 배열이 들어오면 기본값(warm·app)으로 복구하고 오류 없이 연다 → Task 4 `restore` 테스트.
2. **보드 hover 미리보기가 33개 카드를 다시 그림:** 목록 위를 빠르게 훑어도 화면이 멈추지 않아야 한다 → 150 ms 머문 뒤에만 적용, 목록을 떠나면 원래대로(Task 5 테스트 + Judge 실측).
3. **어두운 프리셋(먹):** 라벨·대지 표식·반경 원·방위표·축척 막대가 어두운 바탕에서도 보여야 한다 → Task 1 대비 테스트, Task 3 반경 원 색 테스트.
4. **「이 쪽만」을 조판 쪽에 적용:** 그 쪽의 모든 칸이 같은 덮어쓰기를 따르고, 다른 쪽은 그대로다. 「이 쪽만」을 지우면 보고서 전체 값으로 돌아간다 → Task 4 plan 테스트.
5. **만든 색으로 내보낸 PPT:** 화면 미리보기와 같은 색이어야 하고, 다시 열어도·되돌리기 해도 유지돼야 한다 → Task 3 PPT 색 테스트, Task 4 reducer·restore 테스트.
6. **숨긴 바탕 레이어:** 화면과 PPT 모두에서 빠져야 한다. 그 레이어의 이름 라벨(도로 숨김 → 도로명, 녹지 숨김 → 공원 이름)도 같이 빠진다 → Task 3 테스트.
7. **「내 테마」 API:** 남의 테마는 지울 수 없다. 로그인하지 않았거나 색 형식이 틀리면 거절한다. 종류별 12개를 넘으면 오래된 것부터 지운다 → Task 4 store·검증 테스트.

---

### Task 1: 색 계산·바탕 테마 프리셋 8개·만든 색

**Files:**
- Modify: `src/lib/v2/ui/map-theme.ts`
- Create: `src/lib/v2/ui/map-color.ts`
- Test: `src/scripts/v2/test-v2-map-theme.mjs`(확장), `src/scripts/v2/test-v2-map-color.mjs`(신규)

**Interfaces:**
- Produces (map-theme.ts):
  - `type BaseThemeId = "warm" | "cool" | "paper" | "sage" | "sand" | "blue" | "mono" | "ink"`
  - `type BaseThemeColors = { bg: string; building: string; parcel: string; road: string; green: string; water: string; site: string }`
  - `type BaseThemeRef = BaseThemeId | { name: string; colors: BaseThemeColors }`
  - `BaseTheme`에 필드 2개 추가: `dark: boolean`, `ring: string`(반경 원·대지 주변 선 색).
  - `baseTheme(ref?: BaseThemeRef | string | null): BaseTheme` — 프리셋 id, 만든 색 객체, 모르는 값을 모두 받는다. 모르는 값이면 warm을 준다.
  - `themeFromColors(name: string, colors: BaseThemeColors): BaseTheme`
  - `isBaseThemeRef(value: unknown): value is BaseThemeRef` — 만든 색이면 7개 키가 모두 `#rrggbb`인지 검사한다.
  - `BASE_THEME_IDS: readonly BaseThemeId[]` — 목록 순서대로 둔다.
- Produces (map-color.ts):
  - `contrast(a: string, b: string): number`, `shiftL(hex: string, dl: number): string`
  - `type Mood = "자동" | "부드럽게" | "선명하게" | "따뜻하게" | "차갑게" | "밝게" | "어둡게" | "파스텔"`, `MOODS: readonly Mood[]`
  - `generateBaseColors(mood: Mood, current: BaseThemeColors, locks: Partial<Record<keyof BaseThemeColors, boolean>>, only?: keyof BaseThemeColors, rng?: () => number): BaseThemeColors`
  - `baseThemeWarnings(theme: BaseTheme): { level: "bad" | "ok"; text: string }[]`

- [ ] **Step 1: 실패 테스트.** `test-v2-map-theme.mjs`에 아래를 넣는다.
  - 프리셋 8개가 `BASE_THEME_IDS` 순서로 있다.
  - 각 프리셋의 바탕 라벨(road·place·park·station) 대비가 4.5:1 이상이다.
  - `ink`는 `dark === true`이고 `ring`의 대비가 3:1 이상이다.
  - 기존 3개(warm·cool·paper)의 값이 바뀌지 않았다. 기존 deepEqual은 그대로 둔다.
  - `baseTheme({ name: "내 테마 1", colors })`가 `themeFromColors` 결과와 같다.
  - `baseTheme("nope")`과 `baseTheme({ colors: { bg: "red" } })`가 모두 warm이다.

  `test-v2-map-color.mjs`에 아래를 넣는다.
  - 고정 rng(`() => 0.5`)로 `generateBaseColors` 결과가 결정적이다.
  - `locks.bg`이면 bg가 그대로다. `only: "water"`이면 water만 바뀐다.
  - 모든 결과 색이 `#rrggbb`이다.
  - 바탕과 건물이 같은 색이면 `baseThemeWarnings`가 bad를 준다. warm이면 ok만 준다.
- [ ] **Step 2: 실패 확인.** `npx tsx src/scripts/v2/test-v2-map-theme.mjs` → FAIL(`sage` 없음)
- [ ] **Step 3: 구현.**
  - 프리셋 5개 값은 결정 페이지의 `BASES` 배열(`B('sage'…)`~`B('ink'…)`)에서 그대로 옮긴다(이름: 세이지·모래·청사진·흑백·먹).
  - `ink`(어두운) 바탕의 라벨색은 결정 페이지 `LBL_D`(`road #bdb7ac`, `place #cbc5ba`, `park #9cc28b`, `stn #f2f2f2`)를 쓴다. `ring`은 `#cfcfcf`이다. 나머지 프리셋의 `ring`은 `#3a3a3a`이다.
  - `themeFromColors`의 파생 규칙은 결정 페이지 `baseFromColors`·`siteStyle`을 그대로 따른다. `dark = lum(bg) < 0.2`이고, 건물 선·도로 테두리·녹지 3단·대지 표식을 거기서 계산한다.
  - 생성기는 결정 페이지 `genBase`·`genBaseColor`를 옮긴다. `Math.random` 대신 `rng`를 쓰고, 기본값은 `Math.random`이다.
  - 경고 문구는 결정 페이지 `warnBase` 그대로다.
- [ ] **Step 4: 통과 확인.** 두 파일 PASS, `npx tsx src/scripts/v2/test-v2-basemap-scene.mjs` PASS
- [ ] **Step 5: 커밋** `feat(v2): 바탕 테마 프리셋 8개와 만든 색`

### Task 2: 다이어그램 팔레트와 모델 기준 색 조회

**Files:**
- Create: `src/lib/v2/ui/map-palette.ts`
- Modify: `src/lib/v2/ui/map-layers.ts`(MapModel 필드 2개, `modelLayerStyle`, 범례 함수들), `src/lib/v2/ui/map-color.ts`(팔레트 생성기·경고)
- Test: `src/scripts/v2/test-v2-map-palette.mjs`(신규)

**Interfaces:**
- Consumes: Task 1 `BaseThemeRef`, `Mood`, `contrast`
- Produces (map-palette.ts):
  - `type DiagramPaletteId = "app" | "soft" | "vivid" | "earth" | "pastel" | "safe" | "sea" | "gray"`
  - `type DiagramPaletteColors = { cat: string[] /* 8 */; seq: string[] /* 5, 낮음→높음 */ }`
  - `type DiagramPaletteRef = DiagramPaletteId | { name: string; colors: DiagramPaletteColors }`
  - `PALETTE_IDS`, `paletteName(ref): string`, `paletteColors(ref): DiagramPaletteColors | null`(`app`이면 null), `isPaletteRef(value): value is DiagramPaletteRef`
  - `paletteLayerStyle(layer: string, style: LayerStyle, ref?: DiagramPaletteRef | null): LayerStyle` — `app`·없음이면 **같은 객체(===)를 돌려준다**.
- Produces (map-layers.ts):
  - `MapModel`에 `baseTheme?: BaseThemeRef`, `palette?: DiagramPaletteRef`, `baseHide?: BaseToggleLayer[]` 추가
  - `type BaseToggleLayer = "building" | "parcel" | "road" | "green" | "water"`, `BASE_TOGGLE_LAYERS`(이 순서), `isBaseToggleLayer(value)`. 정의 위치는 `map-theme.ts`.
  - `modelLayerStyle(model: Pick<MapModel, "palette"> | null | undefined, layer: string): LayerStyle`
  - `legendItemsForModel`·`legendItemsOf`·`legendItems`가 모델의 팔레트 색을 범례 색으로 쓴다.
- Produces (map-color.ts): `generatePaletteColors(mood, current: DiagramPaletteColors, locks: Partial<Record<number | "seq", boolean>>, only?: number | "seq", rng?): DiagramPaletteColors`, `paletteWarnings(colors: DiagramPaletteColors): { level; text }[]`

- [ ] **Step 1: 실패 테스트.** `test-v2-map-palette.mjs`
  - `paletteLayerStyle("use:주거", s, "app") === s`, `paletteLayerStyle("use:주거", s, undefined) === s`
  - `vivid`: `use:` 계열 중 기타·미상이 아닌 n번째 레이어(LAYER_STYLES 정의 순서)의 `color`가 `cat[n % 8]`이다. `fill`이 있는 스타일은 `fill`도 같은 색이다.
  - `use:기타`, `use:미상`, `jimok:기타`, `district:기타`는 원래 스타일 그대로다.
  - 순서형 묶음(`trade_q1..q5`, `floors_*`, `bldg_pre1980..2020s`, `trade_district_q*`)은 `legendOrder` 순으로 `seq`를 보간한 색을 받는다. 미상·가정·자료 부족 항목(`floors_unknown`, `floors_assumed_1f_est`, `bldg_unknown`, `trade_district_missing`)은 그대로다.
  - 범주형·순서형에 들지 않는 레이어(`bus_stop`, `rail_line`, `park`, `school_elem`)는 그대로다.
  - `legendItemsForModel({ ...model, palette: "vivid" })`의 색이 `paletteLayerStyle` 결과와 같다.
  - 고정 rng로 `generatePaletteColors`가 결정적이고, 잠근 칸은 유지된다. `cat` 8개·`seq` 5개 모두 hex다.
  - `gray`는 `paletteWarnings`에서 "비슷한 색"이 bad로 나온다. `safe`는 녹색약 경고가 없다.
- [ ] **Step 2: 실패 확인.** `npx tsx src/scripts/v2/test-v2-map-palette.mjs` → FAIL
- [ ] **Step 3: 구현.**
  - 범주형 계열 접두사: `use:`, `store:`, `zone:`, `zone_center:`, `jimok:`, `district:`, `facility:`. 이름이 `기타`·`미상`으로 끝나는 키는 빼고 순번을 센다. 순번은 모듈 로드 때 한 번 계산한다.
  - 순서형 대상: `LEGEND_GROUPS`의 tradeQuantiles·tradeDistrict·d05Floors·d04CompletionYear. 보간은 `seq` 5점을 잇는 구간 선형(RGB) 보간이다.
  - 프리셋 값(`cat` 8개 / `seq` 5개). 앞 4색은 사용자가 결정 페이지에서 본 값이다.
    - soft 부드러운: `#e8c37a #efa492 #93c5a0 #9db5de #c8a8d8 #f0c9a0 #9fd0cc #d8b4a6` / `#eef3f8 #c9d9ec #9db5de #6f8fc4 #4a69a3`
    - vivid 선명: `#f2a900 #e4572e #17a673 #2f6fdb #9b5de5 #f15bb5 #00b4d8 #8d6e63` / `#e0ecff #9cc2ff #4f8ff0 #2f6fdb #173f8f`
    - earth 흙색: `#c99a4e #b5654a #7e9a63 #6e8098 #9c6f8f #d4b26a #5f8c86 #8a6b52` / `#f3ead8 #dcc49a #c09a5e #9a6d38 #6b4520`
    - pastel 파스텔: `#f3de9c #f2b8b5 #c9e2c0 #c5d3ec #dcc8ec #f6cfa8 #bfe3e0 #e6d3c6` / `#f4f6fb #dfe6f4 #c5d3ec #a8bce0 #8aa3d2`
    - safe 색약 안전: `#e69f00 #d55e00 #009e73 #0072b2 #cc79a7 #56b4e9 #f0e442 #000000` / `#fde725 #5ec962 #21918c #3b528b #440154`
    - sea 바다: `#f4b942 #f07167 #4fb0a5 #2b6cb0 #8e7cc3 #5fa8d3 #90be6d #b08968` / `#e6f2f5 #b3dbe3 #6fb8c9 #2f8aa6 #1b5f7a`
    - gray 먹 단계: `#3b3b3b #6a6a6a #969696 #bebebe #525252 #828282 #aaaaaa #d2d2d2` / `#f0f0f0 #c8c8c8 #969696 #646464 #2f2f2f`
  - 이름: 지금 앱 색·부드러운·선명·흙색·파스텔·색약 안전·바다·먹 단계.
  - 생성기·경고는 결정 페이지 `genPal`·`genPalColor`·`warnPal`을 8칸에 맞게 옮긴다. 기준은 ΔE<14면 "비슷한 색", 녹색약 ΔE<11. `seq`는 cat[0]의 색상으로 밝음(L 92)→어두움(L 28) 5점을 만든다.
- [ ] **Step 4: 통과 확인.** 새 파일 PASS, `test-v2-map-layers*`·`test-v2-report.mjs` PASS
- [ ] **Step 5: 커밋** `feat(v2): 다이어그램 팔레트와 모델 기준 레이어 색`

### Task 3: 화면·PPT가 모델의 색을 쓰게 하기

**Files:**
- Modify: 색을 읽는 그리기 경로의 `layerStyle(` 호출 → `modelLayerStyle(model, …)`
  - `src/components/v2/map-figure.tsx`, `src/components/v2/map-box.tsx`, `src/components/v2/report/slide-surface.tsx`
  - `src/lib/v2/ui/map-scene.ts`, `src/lib/v2/ui/callout-layout.ts`, `src/lib/v2/ui/map-labels.ts`(색을 읽는 곳만)
  - `src/lib/v2/report/map-pptx.ts`, `src/lib/v2/report/render-pptx.ts`, `src/lib/v2/report/terrain-section-pptx.ts`
  - 엔진(`src/lib/v2/engine/**`, `tile/*/engine.ts`)의 라벨 조회는 그대로 둔다.
- Modify: 바탕 테마 결정 `src/lib/v2/ui/map-scene.ts`(1479행 부근), `src/components/v2/map-figure.tsx`(405-407행), `src/lib/v2/report/map-pptx.ts`(`addSite`, `sceneFor`) — `model.baseTheme ?? <prop/옵션/컨텍스트>` 순서. 반경 원·대지 주변 선은 바탕이 있으면 `theme.ring`을 쓴다.
- Modify: `BaseThemeId`를 받던 자리(`MapFigureProps.baseTheme`, `MapSceneOptions.baseTheme`, `PptxMapLook.baseTheme`, `buildMapImages` options, `BaseThemeContext`)를 `BaseThemeRef`로 넓힌다.
- Modify: `src/lib/v2/ui/map-scene.ts` `buildMapScene`이 바탕을 빼는 집합(`suppress`, 지금은 `BASE_SUPPRESS[tileCode]`)에 `model.baseHide`를 더한다. 숨긴 층의 라벨도 같은 규칙으로 빠진다: road → 도로명, green → 공원 이름.
- Test: `src/scripts/v2/test-v2-map-palette-render.mjs`(신규)

**Interfaces:**
- Consumes: Task 2 `modelLayerStyle`, `MapModel.palette`·`baseTheme`. Task 1 `baseTheme(ref)`, `BaseTheme.ring`.
- Produces: 모델에 `palette`·`baseTheme`를 붙이면 화면 SVG·PPT 도형·범례 색이 따라 바뀐다. 이것이 Task 4가 기대는 계약이다.

- [ ] **Step 1: 실패 테스트.** `test-v2-map-palette-render.mjs` — `use:주거` 지물이 있는 A 모델(픽스처는 `test-v2-ppt-vector-basemap.mjs`의 `modelOf` 방식).
  - `renderToStaticMarkup(MapFigure)`: `palette: "vivid"`이면 그 지물 fill이 `#f2a900`이다. 팔레트가 없으면 원래 `#D69E2E`다.
  - `renderReportPptx`로 같은 모델의 tile 쪽을 만들면 `GRP|map-…-use:주거` 도형 fill이 `F2A900`이고, 범례 견본도 같은 색이다.
  - `baseTheme: "ink"` 모델의 PPT `map-base-bg` 채움이 `22252A`이고, 반경 원 선이 `CFCFCF`다.
  - `baseTheme: { name, colors }`(만든 색)도 같은 경로로 반영된다.
  - 조판 칸 모델에 팔레트가 있으면 칸 도형에도 반영된다.
  - `baseHide: ["parcel", "road"]` 모델:
    - `buildMapScene`의 `base.buckets`에 parcel·road 층이 없고, road 라벨도 없다.
    - PPT에 `map-base-parcel`·`map-base-road` 도형이 없고, 화면 SVG에 `data-map-base-layer="road"`가 없다.
    - `baseHide: ["green"]`이면 park 라벨이 없다.
  - 기존 `test-v2-ppt-editable-maps.mjs`·`test-v2-ppt-vector-basemap.mjs`·`test-v2-report-doc-pptx.mjs`는 그대로 통과한다(기본값 불변 보장).
- [ ] **Step 2: 실패 확인.** → FAIL(fill이 원래 색)
- [ ] **Step 3: 구현** — 위 파일들의 색 조회를 바꾼다. 그 함수 안에 모델이 없으면 호출자에서 모델(또는 `palette`)을 넘긴다.
- [ ] **Step 4: 통과 확인.** 새 파일과 위 기존 3개 PASS
- [ ] **Step 5: 커밋** `feat(v2): 화면과 PPT가 모델의 팔레트·바탕 테마를 따름`

### Task 4: 상태 저장·적용 범위·내 테마(계정)

**Files:**
- Modify: `src/lib/v2/ui/board-state.ts`(`baseTheme?: BaseThemeRef`, `palette?: DiagramPaletteRef`, `baseHide?: BaseToggleLayer[]`, 액션 `{ type: "baseTheme"; ref: BaseThemeRef }`·`{ type: "palette"; ref: DiagramPaletteRef }`·`{ type: "baseHide"; layers: BaseToggleLayer[] }`, 저장·`restore` 검증. 기존 `{ type: "baseTheme"; id }` 호출은 `ref`로 바꾼다)
- Modify: `src/lib/v2/report/report-doc.ts`(`type MapColorChoice = { base?: BaseThemeRef; palette?: DiagramPaletteRef; hide?: BaseToggleLayer[] }`, `ReportDoc.mapColors?`, `ReportPageBase.mapColors?`, 액션 `{ type: "mapColors"; scope: "document" | "page"; id?: string; patch: MapColorChoice | null }` — page 범위의 `null`은 덮어쓰기를 지운다)
- Modify: `src/lib/v2/ui/board-state.ts` `restoreReportDoc`(검증), `src/lib/v2/report/report-doc-plan.ts` `planReportDoc`(쪽마다 모델에 색을 붙인다), `src/lib/v2/ui/tile-view.ts`(보드 view의 모든 모델에 팔레트를 붙이는 `withPalette(view, ref)`, 기존 `withBase` 옆), `src/app/v2/page.tsx`(보드 view에 `board.palette` 적용)
- Modify: `src/lib/server/database.ts` `initSchema`에 표를 추가한다.
  ```sql
  CREATE TABLE IF NOT EXISTS user_map_colors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('base','palette')), name TEXT NOT NULL,
    colors TEXT NOT NULL, created_at REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
  ```
- Create: `src/lib/server/map-color-store.ts`(서버 저장), `src/app/api/user/map-colors/route.ts`(GET·POST·DELETE, `requireAuth`·`isUser`는 `api/user/api-keys/route.ts`와 같은 방식), `src/lib/v2/ui/my-map-colors.ts`(브라우저에서 부르는 쪽, `authFetch("/site/api/user/map-colors")`)
- Test: `src/scripts/v2/test-v2-map-colors-state.mjs`(신규), `src/scripts/v2/test-v2-map-color-store.mjs`(신규, `DB_PATH`를 임시 파일로 둔 뒤 import)

**Interfaces:**
- Consumes: Task 1·2 ref 타입과 검증기, Task 3의 모델 계약
- Produces:
  - `resolveMapColors(board: Pick<BoardState, "baseTheme" | "palette">, doc: ReportDoc, page?: ReportPage): Required<MapColorChoice>` — 쪽 > 보고서 > 보드 > 기본(warm·app) 순이다.
  - `withMapColors(model: MapModel, colors: MapColorChoice): MapModel`
  - `map-color-store.ts`(서버):
    - `listMapColors(userId: number): { base: SavedBase[]; palette: SavedPalette[] }`(최근 것 먼저)
    - `saveMapColor(userId: number, kind: "base" | "palette", colors: BaseThemeColors | DiagramPaletteColors): SavedBase | SavedPalette`
    - `deleteMapColor(userId: number, id: number): boolean` — 남의 것이면 false.
    - `parseMapColorBody(body: unknown): { kind; colors } | null` — `isBaseThemeRef`·`isPaletteRef`의 색 검사를 다시 쓴다.
    - 종류별 최대 12개(넘으면 오래된 것부터 지움). 이름은 `내 테마 N`이고, N은 그 사용자·종류에서 지금까지 저장한 수 + 1이다.
  - `SavedBase = { id: number; name: string; colors: BaseThemeColors }`, `SavedPalette`도 같은 모양이다.
  - API:
    - `GET` → `{ base, palette }`
    - `POST { kind, colors }` → 저장한 항목. 형식이 틀리면 400.
    - `DELETE ?id=` → 204, 없거나 남의 것이면 404.
    - 로그인하지 않았으면 401(`requireAuth`).
  - `my-map-colors.ts`(브라우저): `loadMyColors(): Promise<…>`, `saveMyColor(kind, colors): Promise<Saved…>`, `removeMyColor(id): Promise<void>`. 실패하면 빈 목록을 돌려주고, 저장 실패는 팝오버에 인라인 문구 "내 테마를 저장하지 못했습니다"로 보인다(토스트 금지).
  - 적용한 「내 테마」는 id가 아니라 `{ name, colors }`로 보드·보고서에 저장한다. 그래서 테마를 지워도 이미 쓴 프로젝트의 색은 그대로다.

- [ ] **Step 1: 실패 테스트.** `test-v2-map-colors-state.mjs`
  - reducer: `baseTheme`·`palette` 액션 → 저장본 → `restore` 왕복이 같은 값이다.
  - `restore`에 모르는 id·잘못된 색·`cat` 7개를 넣으면 그 필드가 빠진다(기본값). 예외가 나지 않는다.
  - `reportDocReducer` `mapColors`:
    - document 범위는 `doc.mapColors`를 바꾼다.
    - page 범위는 그 쪽만 바꾼다.
    - page `null`은 덮어쓰기를 지운다.
    - 히스토리 되돌리기 후 이전 값으로 돌아간다.
  - `resolveMapColors` 우선순위 4단계를 표로 검사한다.
  - `planReportDoc`: 쪽 2개 중 1쪽만 `mapColors.palette: "vivid"`이면, 그 쪽 `map.palette === "vivid"`이고 다른 쪽은 보고서 값이다. 조판 쪽이면 모든 칸 모델이 같은 값을 받는다. 표지 지도는 보고서 값을 따른다.
  - `resolveMapColors`가 `hide`도 같은 우선순위로 정한다. `planReportDoc` 모델에 `baseHide`가 붙는다.

  `test-v2-map-color-store.mjs`(임시 `DB_PATH`)
  - 사용자 2명을 만든다. A의 저장·목록·삭제가 왕복된다.
  - B는 A의 항목을 지울 수 없다(false).
  - 13번째 저장이면 가장 오래된 것이 빠진다.
  - 이름이 `내 테마 1`, `내 테마 2`… 순서로 붙는다.
  - `parseMapColorBody`: 7키가 아닌 base·`cat` 7개·hex가 아닌 값·모르는 kind는 null이다.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** (위 Interfaces 그대로)
- [ ] **Step 4: 통과 확인.** 새 파일 2개, `test-v2-board-state-v4.mjs`, `test-v2-report-doc.mjs`, `test-v2-report-doc-plan.mjs` PASS
- [ ] **Step 5: 커밋** `feat(v2): 지도 색 저장·보고서 전체/이 쪽만·내 테마(계정)`

### Task 5: C안 팝오버 — 보드·보고서 진입, 색 만들기 카드

**Files:**
- Create: `src/components/v2/map-colors/map-color-popover.tsx`, `src/components/v2/map-colors/map-color-maker.tsx`, `src/components/v2/map-colors/map-colors.module.css`
- Modify: `src/app/v2/page.tsx`(배경지도 `기본 지도` 버튼 1089-1097행, 미리보기 상태)
- Modify: `src/components/v2/report/report-mode.tsx`(도구 막대 1762행 `toolPill` — `발표 메모` 다음에 `지도 색` 버튼과 `railPopoverRoot`)
- Modify: `docs/design/v2-design-language.md`(§9-11 「지도 색」 새 절)
- Test: `src/scripts/v2/test-v2-map-color-popover.mjs`(신규)

**Interfaces:**
- Consumes: Task 1·2 프리셋·생성기·경고, Task 4 액션·`my-map-colors`·`resolveMapColors`
- Produces:
  ```ts
  type MapColorPopoverProps = {
    value: Required<MapColorChoice>;
    scope?: { value: "document" | "page"; pageAvailable: boolean; pageOverridden: boolean; onChange(scope: "document" | "page"): void; onClearPage(): void };
    onPreview(choice: MapColorChoice | null): void;
    onApply(patch: MapColorChoice): void;
    onClose(): void;
    makerSide: "left" | "right";
  };
  ```

동작(결정 페이지 C안과 같게):
- **머리:** 탭 `바탕 | 다이어그램`(2칸 segmented)이다. 보고서에서만 그 아래 `보고서 전체 | 이 쪽만`을 둔다.
  - 「이 쪽만」은 선택한 쪽에 지도가 없으면(출처·빈 쪽) `aria-disabled`이고 title은 "이 쪽에는 지도가 없습니다"다.
  - 그 쪽에 덮어쓰기가 있으면 목록 아래에 `보고서 전체 색으로` 보조 버튼을 둔다.
- **목록:** 「내 테마」를 먼저, 이어서 프리셋을 둔다. 한 줄은 높이 34 px로, ✓ 칸 16 px · 이름(말줄임) · 색 띠를 둔다.
  - 색 띠: 바탕은 bg·건물·도로·녹지·물·대지 6칸, 다이어그램은 cat 앞 5칸이다. 칸마다 13×16 px이다.
  - 현재 값 줄은 굵게 쓰고 ✓를 붙인다.
- **미리보기:** 줄 위에 150 ms 머물면 `onPreview(그 줄)`을 부른다. 목록을 떠나거나 팝오버를 닫으면 `onPreview(null)`을 부른다. 누르면 `onApply`를 부른다.
- **`색 만들기…`:** 모양 있는 보조 버튼이다. 누르면 288 px 카드를 팝오버 옆(`makerSide`)에 12 px 간격으로 띄운다.
  - 카드 구성: 머리(`바탕 색 만들기`/`다이어그램 색 만들기`·닫기) → 분위기 칩 8개 → 색 줄 → 경고(bad는 `#b42318`, ok는 `#3f6f45`) → `만들기` 주 버튼 + 되돌리기·다시 아이콘 버튼 → `내 테마로 저장`.
  - 색 줄: 바탕 7줄, 다이어그램 cat 8줄 + `순서형` 1줄. 줄마다 이름 · hex(고정폭) · 고정/섞기/어둡게/밝게/직접 고르기(`<input type="color">`) 아이콘 버튼이 있다. 아이콘 버튼은 26 px이고 맞힘 영역은 24 px 이상이다.
  - 바탕 줄 가운데 건물·필지선·도로·녹지·물 5줄은 맨 앞에 눈 아이콘 토글을 둔다(`aria-pressed`, `aria-label="<층> 숨기기"`/`"<층> 보이기"`). 숨긴 줄은 색 칸을 45% 흐리게 하고 나머지 버튼은 그대로 둔다. 바탕색·대지 줄에는 눈이 없다.
  - 토글은 색을 바꾸지 않고 `onApply({ hide })`만 부른다. 프리셋을 쓰는 중이어도 「만든 색」으로 바뀌지 않는다.
  - 카드에서 바꾼 색은 바로 `onApply({ base | palette: { name: "만든 색", colors } })`로 적용한다. 되돌리기 스택은 40단계다.
  - 저장하면 `saveMyColor`(계정) 후 그 테마를 적용하고 목록 맨 위에 보인다. 실패하면 카드 안에 인라인 문구를 띄운다.
  - 「내 테마」 줄에는 마우스를 올리면 오른쪽 끝에 지우기(휴지통, 24 px) 버튼이 나온다. 누르면 줄 자리에서 `지울까요? 지우기 · 취소` 확인으로 바뀐다(confirm 대화상자 금지).
  - 팝오버를 열 때 `loadMyColors()`를 한 번 부른다. 불러오는 동안 목록 머리에 회색 줄 1개를 둔다.
- **닫기:** Esc는 카드부터 닫고 다음에 팝오버를 닫는다. 바깥 클릭으로 닫는다. 닫으면 트리거로 포커스를 돌린다. 팝오버 안 스크롤은 `overscroll-behavior: contain`이다.
- **보드:**
  - `기본 지도` 버튼이 눌린 상태면 `기본 지도 ▾`로 쓰고 `aria-haspopup="dialog"`·`aria-expanded`를 단다.
  - 눌린 상태에서 다시 누르면 팝오버를 연다. 안 눌린 상태에서 누르면 지금처럼 바탕만 바꾼다.
  - 팝오버는 버튼 아래 8 px에 위쪽 꼬리로 붙는다. 「색 만들기」 카드는 팝오버 왼쪽이다.
  - 적용은 `dispatch({ type: "baseTheme" | "palette", ref })`다. 미리보기는 page 상태(`previewColors`)로 `BaseThemeContext`·view 팔레트에 잠시 덮는다.
- **보고서:**
  - 도구 막대 아이콘은 팔레트 모양이고 `aria-label="지도 색"`이다. 툴팁도 같은 문구다.
  - 팝오버는 기존 `railPopover`·`anchoredCard`·창 투명도(`sidePanelStyle`)를 그대로 쓴다. 「색 만들기」 카드는 오른쪽이다.
  - 적용은 `mapColors` 액션이다(되돌리기 대상). 미리보기는 report-mode 상태로 계획(plan)에만 덮는다.

- [ ] **Step 1: 실패 테스트.** `test-v2-map-color-popover.mjs`(`renderToStaticMarkup` + 이벤트 없는 구조 검사, 기존 컴포넌트 테스트 방식)
  - 탭 2개, 바탕 목록 8줄 + 내 테마 줄, 현재 값 줄에 `aria-pressed="true"`가 있다.
  - 보드(scope 없음)에는 `보고서 전체`가 없다. 보고서 `pageAvailable:false`면 「이 쪽만」에 `aria-disabled`가 있다.
  - 색 띠 칸 수: 바탕 6, 다이어그램 5.
  - 화면 텍스트에 영문 id(`warm`, `vivid` 등)가 없다.
  - 만들기 카드(바탕): 눈 토글 5개, 바탕색·대지 줄에는 없음. `hide`에 road가 있으면 도로 줄 토글이 `aria-pressed="true"`이고 라벨이 "도로 보이기"다.
  - 배선 검사: page.tsx `기본 지도 ▾`·`aria-haspopup`, report-mode.tsx `aria-label="지도 색"`·`mapColors` 액션 dispatch.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 위 동작 그대로 만든다. 문구는 이 계획의 따옴표 안 그대로 쓴다. §9-11에 치수(288·34·13×16·12·150 ms)를 적는다.
- [ ] **Step 4: 통과 확인.** 새 파일 PASS, `npm run lint` PASS, 마지막에 `npm run test:v2` 전체 1회 PASS
- [ ] **Step 5: 커밋** `feat(v2): 지도 색 팝오버(C안)와 색 만들기 카드`

### Task 6: Judge 실렌더 QA (실행자 아님)

- [ ] dev 서버(3200, 재사용)에서 분석 fe9e688b(대치동 503) 보드와 보고서 18쪽을 연다. 팝오버·만들기 카드를 연 상태를 1440·1280·1024로 캡처한다. `my-design-taste` measure(`--widths 1440,1280,1024`)로 가림·대비·맞힘 영역을 잰다.
- [ ] 보드 hover 미리보기 반응을 잰다: 8줄을 연속으로 훑을 때 long task와 화면 멈춤이 없는지 Performance 기록으로 확인한다.
- [ ] 바탕 `ink` + 팔레트 `vivid`, 「이 쪽만」 1쪽 덮어쓰기로 PPT를 내보낸다. PowerPoint SaveAs PNG로 실렌더하고 미리보기와 나란히 비교한다. 도형 색 변경 가능 여부, 파일 크기·열기 시간을 기록한다.
- [ ] 새로고침 뒤 보드·보고서 색이 유지되는지, 되돌리기·다시가 동작하는지 확인한다.
- [ ] 「내 테마」를 저장한 뒤 다른 브라우저 문맥(새 storageState)으로 같은 계정에 들어가 목록이 보이는지 확인한다. 도로·필지선을 숨긴 상태로 PPT를 내보내 두 층이 빠졌는지 확인한다.

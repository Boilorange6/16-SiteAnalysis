# 지도 부속·레이어 톤·겹친 면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 2026-10-29에 고른 지도 부속(방위표 A·축척 막대 B·치수선 A·표고 C)과 주제 레이어 톤을 화면·PPT에 똑같이 넣는다. 벡터 바탕 1단계에서 미룬 M-1(겹친 면 구멍)·M-4(라벨이 위치도·옮긴 방위표를 못 피함)·M-8(흐린 장 PPT 합성)을 같이 고친다. 2D·3D 용도색은 한 곳에서 나오게 한다.

**Architecture:**
- 기하는 지금처럼 `buildMapScene`(`src/lib/v2/ui/map-scene.ts`)에서 한 번 계산하고, 화면 SVG(`src/components/v2/map-figure.tsx`)와 PPT(`src/lib/v2/report/map-pptx.ts`)는 그리기만 한다.
- 대지 치수·표고 자료는 `Scene`에서 만든다(대지 바깥 윤곽 합집합 + 꼭짓점 DEM 표고). `toTileView`가 `mapBaseFromScene`처럼 `MapModel`에 실어 보낸다. `Scene`이 `MapModel`에 닿는 곳은 `tile-view.ts:486` 한 곳뿐이다.
- 레이어 톤은 `map-layers.ts`의 함수 하나(`polygonTone`·`polygonPaint`)가 정하고, 두 렌더러와 범례 견본이 같이 쓴다.
- 엔진 출력은 바꾸지 않는다.

**Tech Stack:** Next.js(React) · TypeScript · pptxgenjs · @turf/turf 7.3.5(이미 설치) · node:assert 테스트(`npx tsx src/scripts/v2/<file>.mjs`, 전체 `npm run test:v2`, 타입 `npm run lint`)

**Spec:** `docs/design/v2-design-language.md` §9-12(수치의 정본)와 결정 이력 2026-10-29 행. 결정 페이지 https://claude.ai/artifact/F1o8iwcGUSWVJUaY1F5Aj6 — 시안 그리기 코드(치수선·표고 기하의 참고 구현)는 `.spike/t5/page.template.html`의 `north()`·`dims()`·`els()`다(커밋 안 됨, 같은 PC에 있음). 미룬 항목 근거: `.superpowers/sdd/2026-10-27-vector-basemap/final-review-report.md` M-1(74행)·M-4(77행)·M-8(81행).

## Global Constraints

- §9-12의 값을 그대로 쓴다. 지도 단위 u = 1(카드 330 px)일 때 다음과 같다.
  - 방위표: 지름 46 → 반지름 23u.
  - 축척 막대: 최대 길이 134u, 글자 12u.
  - 치수선: 띄움 8u, 글자 10.5u, 35 m 미만 변 생략.
  - 표고: 글자 8.5u.
  - 레이어 톤: 떨어진 면은 외곽선 없음·채움 0.25. 구역 면은 흰 `#ffffff` 1.7u·채움 0.30.
- 화면과 PPT는 같은 장면 값에서 그린다. 렌더러에 새 상수를 따로 두지 않는다(mistakes #13 미리보기 ≠ PPT).
- 엔진 출력이 바뀌지 않으므로 `TILE_CACHE_REVISION`을 올리지 않는다.
- 사용자에게 보이는 말은 한국어로 쓴다. 내부 id·영문 코드는 화면에 내보이지 않는다. PPT 도형 이름의 표시명도 한국어다.
- 지원 폭은 1024 px 이상이다. 화면 QA는 1440×900과 1024×768에서 한다.
- 브리프 공통:
  - 첫 줄에 `상위 목표: 주소 하나로 대지분석 PPT 자동 생성(v2) > 아키맵 Site report 수준 도판 품질 > 지도 부속·레이어 톤(§9-12)`을 둔다.
  - 작업 중에는 관련 테스트만 돌리고, 커밋 직전에 `npm run test:v2`와 `npm run lint`를 1회 돌린다.
  - UI 작업은 `ui-ux-pro-max`·`my-design-taste`를 적용하고 `docs/design/v2-design-language.md`를 먼저 읽는다.
  - 보고서 끝에 `skill 후보:`·`taste 후보:` 줄을 둔다.
- 커밋은 로컬 `v2-cartography`에만 한다. push·배포는 하지 않는다. 다른 실행자의 변경을 되돌리지 않는다.
- 실행자는 Sonnet effort high, 리뷰·인수는 Opus다. 이 로드맵의 2026-10-27 사용자 지시를 이어 쓴다.

## Review Focus

1. **대지·DEM이 없는 분석:** 주소만으로 만든 분석(`site` 없음), 평지(`ground.kind === "flat"`), 옛 장면에서 치수·표고를 켜도 오류가 나지 않아야 한다. 대지가 없으면 아무것도 그리지 않고, DEM이 없으면 표고만 생략한다 → Task 2 `no-site`·`flat` 테스트, Task 3 `empty` 테스트.
2. **여러 필지 대지:** 필지 사이의 안쪽 변에는 치수가 없고 바깥 윤곽에만 있어야 한다 → Task 2 `union` 테스트.
3. **저장된 방위표·축척 상자:** 보고서에 저장된 `panels.north`·`panels.scaleBar` 크기는 기본 반지름이 23u로 바뀌어도 그 상자 안에 그려진다. 상자를 넘치거나 다른 크기로 튀지 않는다 → Task 1 `saved-box` 테스트.
4. **커진 부속과 좁은 지도:** 조판 칸, 1024 카드, 하단 띠가 있는 보고서 장에서 방위표(46)·축척 막대(134)가 지도 밖으로 나가거나 범례·대지 표식·콜아웃과 겹치지 않아야 한다 → Task 1 `fits` 테스트 + Task 9 실캡처.
5. **위성·래스터 위 톤:** D01·D10 위성 바탕에서는 채움 0.45를 유지하고, 외곽선 규칙은 톤을 따른다. 추정 빗금, 범례 강조의 검은 외곽선, 선택 파란 외곽선은 지금처럼 톤보다 먼저다 → Task 4 `states` 테스트.

---

### Task 1: 방위표 A형과 축척 막대 크기 (§9-12)

**Files:**
- Modify: `src/lib/v2/ui/map-scene.ts`(:57-63 `northArrowBox`, :98-116 `scaleBarLayout`·`scaleBarBox`, :1234 `scaleMaxPx`, :1346-1347)
- Modify: `src/components/v2/map-figure.tsx`(:1302, :1770-1788)
- Modify: `src/lib/v2/report/map-pptx.ts`(:620 `northY`, :1021-1031 `addNorth`, :1033-1049 `addScale`)
- Modify: `src/components/v2/report/slide-surface.tsx`(:605-609 대체값 `26 * layoutUnit`, :1944, :2334 `+ 13 * northUnit`)
- Modify: `src/lib/v2/report/map-image.ts`(:325, :331, :336, :403 — `north: 24`를 새 상수로)
- Modify: `src/lib/v2/report/report-doc.ts`(:18 `DEFAULT_REPORT_FONT_SIZES.scale` 9 → 11)
- Test: `src/scripts/v2/test-v2-map-chrome.mjs`(신규)
- Test 갱신: `test-v2-report-page-style.mjs`(:483, :496-497), `test-v2-topo-section-pptx.mjs`(:114, :148, :191), `test-v2-basemap-scene.mjs`(:224-227), `test-v2-report-font-sizes.mjs`(:59-62, :134-136), `test-v2-report-element-handles.mjs`. 테스트에 복사된 숫자 13·14·88·9.5는 새 상수를 import해서 쓴다.

**Interfaces:**
- Produces (map-scene.ts export):
  - `NORTH_RADIUS = 23`, `NORTH_INSET = 30`(중심이 오른쪽·위 가장자리에서 떨어진 거리 = 반지름 + 7)
  - `SCALE_MAX_PX = 134`, `SCALE_FONT_PX = 12`
  - `northArrowBox(width, height, rightInset = 0, north?: number | false, unitOverride?: number): MapSceneBox | null` — 시그니처 그대로, 상자 ±`NORTH_RADIUS`·u, 기본 중심 (`width − rightInset − NORTH_INSET·u`, `north || NORTH_INSET·u`)
  - `scaleBarBox(..., maxBarPx = SCALE_MAX_PX)` — 판 위 끝 = `y − (SCALE_FONT_PX + 5)·u`(지금 14u), 좌우 6u, 아래 8u는 그대로
- 방위표 그림(u = `scene.northUnit`, 중심 기준):
  - 불투명 흰 원 r 23. 그림자는 아래 1u, 번짐 1.4u, 검정 28 %(화면 `feDropShadow`, PPT `shadow: { type: "outer", angle: 90 }`).
  - 화살촉: 끝 (0, −15.6), 날개 (±7.8, 2.8), 파인 곳 (0, −0.9), `INK`.
  - `N`: 중심 (0, +12.4), 11u, 700, `INK`.
- 축척 막대: 모양은 지금 그대로다(흰 85 % 판, 양 끝 눈금, 위 굵은 글자). 글자만 9.5 → `SCALE_FONT_PX`이고 기준선은 `barY − 6·tc·u` 그대로다. PPT 글자 상자는 화면 글자와 같은 기준선·크기가 되게 지금의 비율(높이 8/9.5 × 글자)로 늘린다.
- 보고서 축척 글자: pt가 정본이다. 글자 px = `pt × 9.5/9 × u`이므로 `scaleFontScale = (pt × 9.5 / 9) / SCALE_FONT_PX`로 바꾼다. 기본 pt는 11이다(카드 12 px와 같은 크기, F1 범위 7–14 그대로).

- [ ] **Step 1: `test-v2-map-chrome.mjs` 작성 — 실패 확인**
  ```js
  // box: 기본 방위표 상자는 반지름 23u, 중심 (W-30u, 30u)
  assert.deepEqual(northArrowBox(800, 330), { x0: 800-30-23, y0: 30-23, x1: 800-30+23, y1: 30+23 });
  // svg: MapFigure SVG에 반지름 23 원 + feDropShadow + "N" 11px
  assert.match(svg, /<circle[^>]*r="23"[^>]*fill="#fff"/); assert.match(svg, /feDropShadow/); assert.match(svg, /font-size="11"[^>]*>N</);
  // scale: 최대 134 px 안에서 1·2·5×10ⁿ, 글자 12
  assert.ok(scene.scale.px <= 134 && scene.scale.px > 134 / 5); assert.match(svg, /font-size="12"[^>]*>\d+ ?k?m</);
  // pptx: addNorth의 ellipse에 shadow, 지름 46u px를 인치로
  // saved-box: northScale 저장(상자 높이 30 px) → 그린 원 지름이 30 px 이하
  // fits: 1024 카드(지도 높이 250)·조판 칸(높이 180)에서 northArrowBox·scaleBarBox가 지도 안이고 서로 안 겹침
  ```
  실행: `npx tsx src/scripts/v2/test-v2-map-chrome.mjs` → FAIL(반지름 13).
- [ ] **Step 2: 상수·`northArrowBox`·`scaleBarLayout`·`scaleBarBoxFromLayout`을 바꾸고 map-figure·map-pptx·slide-surface·map-image가 상수를 쓰게 한다.**
- [ ] **Step 3:** `test-v2-map-chrome.mjs`와 위 「테스트 갱신」 5개 파일을 실행 → PASS.
- [ ] **Step 4: 커밋** `feat(v2): 방위표 A형(그림자 원)·축척 막대 134 px·12 px — §9-12`

---

### Task 2: 대지 바깥 윤곽과 꼭짓점 표고 자료

**Files:**
- Create: `src/lib/v2/ui/site-outline.ts`
- Modify: `src/lib/v2/ui/map-layers.ts`(:27 근처 `MapModel`에 `siteOutline?: SiteOutline | null`)
- Modify: `src/lib/v2/ui/tile-view.ts`(:484-488 `base`를 붙이는 곳에 `siteOutline`도)
- Test: `src/scripts/v2/test-v2-site-outline.mjs`(신규)

**Interfaces:**
- Produces:
  ```ts
  export type SiteOutline = { rings: Array<{ points: LngLat[]; elevations: Array<number | null> }> };
  export function siteOutlineFromScene(scene: Scene): SiteOutline | null;
  ```
  - `scene.site`(로컬 m 고리들, 합쳐지지 않음)를 `@turf/turf` `union`으로 합친다. 좌표는 평면으로 그대로 넣어도 된다. 바깥 고리만 남기고 구멍은 버린다.
  - 2 m 허용 Douglas–Peucker로 줄인다. **닫힌 고리는 첫 점에서 가장 먼 점으로 둘로 나눠 각각 줄인다**(첫 점 = 끝 점이면 그냥 줄였을 때 2점만 남는 함정이 있다).
  - 표고는 `ground.kind === "dem"`이면 `round1(originZ + groundZAt(ground, x, y))`, 아니면 `null`이다.
  - 좌표는 `toLngLat([origin.x + x, origin.y + y])`로 바꾼다.
  - `scene.site`가 없거나 비면 `null`이다.
  - 같은 `Scene` 객체는 `WeakMap`으로 한 번만 계산한다(타일 33개가 같은 장면을 쓴다).
- `toTileView`는 `scene`이 있으면 `model.siteOutline = siteOutlineFromScene(scene)`을 붙인다.

- [ ] **Step 1: 테스트 작성 — 실패 확인**
  ```js
  // union: 맞닿은 두 정사각형(0..10, 10..20) → 고리 1개, 꼭짓점 4개(안쪽 변 없음)
  // closed: 변마다 점 20개인 직사각형 → 꼭짓점 4개
  // dem: z = 0.01·x 평면 DEM, originZ 15 → x=100 꼭짓점 표고 16.0
  // flat: ground flat → 표고 모두 null, 꼭짓점은 그대로
  // no-site: site null → null
  // real(선택): 대치동 503 장면 고정 자료가 있으면 변 길이 151.6·303.2·188.5·140.6 m가 나온다
  ```
- [ ] **Step 2: 구현**
- [ ] **Step 3:** `npx tsx src/scripts/v2/test-v2-site-outline.mjs`와 `test-v2-tile-view*.mjs`(있으면) → PASS
- [ ] **Step 4: 커밋** `feat(v2): 대지 바깥 윤곽·꼭짓점 표고를 지도 모델에 싣기`

---

### Task 3: 치수선 A형·표고 C형 그리기와 장식 켜기

**Files:**
- Modify: `src/lib/v2/ui/map-scene.ts`(옵션 `siteMarks`, 장면 필드 `siteDims`·`siteElevations`, 상자를 바탕 라벨 점유에 추가 :1503)
- Modify: `src/components/v2/map-figure.tsx`(대지 표식 다음, 라벨 앞에 그림)
- Modify: `src/lib/v2/report/map-pptx.ts`(`addSite` 다음에 `addSiteMarks`, 이름 `tag(code, "site-dims", "대지 치수", i)`·`"대지 표고"`)
- Modify: `src/lib/v2/report/report-doc.ts`(:104 `decorations`에 `siteDims`·`siteElevations`, :223 기본값 false)
- Modify: `src/lib/v2/ui/board-state.ts`(:1041-1046 정규화)
- Modify: `src/components/v2/report/drawer-map.tsx`(:182-184, :216, :335-337 장식 체크에 `대지 치수`·`대지 표고`)
- Modify: `src/components/v2/report/slide-surface.tsx`(:577 근처 읽어서 MapFigure에 `siteMarks`), `map-pptx.ts`(:623-624 읽기), `src/lib/v2/report/preflight.ts`(:11-38)
- Test: `src/scripts/v2/test-v2-site-marks.mjs`(신규)
- Docs: `docs/design/v2-design-language.md` §11 지도 설정 서랍의 장식 목록에 `대지 치수`·`대지 표고` 추가

**Interfaces:**
- Consumes: `MapModel.siteOutline`(Task 2), `SCALE_*`·`NORTH_*`(Task 1)
- Produces:
  ```ts
  // MapSceneOptions
  siteMarks?: { dims: boolean; elevations: boolean };
  // MapScene
  siteDims: Array<{ ext: Array<[[number, number], [number, number]]>; line: [[number, number], [number, number]];
    ticks: Array<[[number, number], [number, number]]>; text: string; x: number; y: number; angle: number; fontSize: number; box: MapSceneBox }>;
  siteElevations: Array<{ x: number; y: number; text: string; tx: number; ty: number;
    anchor: "start" | "middle" | "end"; fontSize: number; box: MapSceneBox }>;
  ```
  옵션이 꺼져 있거나 `siteOutline`이 없으면 둘 다 `[]`다.
- 기하(§9-12, 모두 ×u):
  - 변 길이는 m이다. 두 꼭짓점을 `toUtmk`로 바꿔 잰 거리이고 35 m 미만은 뺀다.
  - 바깥 방향 n은 변 가운데 + n·4 px가 대지 밖인 쪽이다(점-다각형 판정).
  - 평행선은 각 끝 + n·8이다. 연장선은 꼭짓점 + n·2에서 + n·(8+4)까지 간다. 사선은 각 끝 ± (d+n)·3.2다.
  - 글자 `151.6 m`는 가운데 + n·(8 + 0.8·10.5)에 놓고 각도는 −90~90°로 돌린다.
  - 표고: × 반폭 3. 글자 `18.9`는 꼭짓점 + (중심 방향)·1.1·8.5에 놓는다. anchor는 |n.x| < 0.35면 middle, n.x > 0이면 start, 아니면 end다. 이미 표시한 꼭짓점과 3.2·8.5 안이면 생략하고, 표고 `null`도 생략한다.
- 색·선:
  - 치수: `#2b2b2b`. 평행선 0.8, 연장선 0.7, 사선 1.1. 글자 굵기 500, 흰 halo(글자 × 0.36).
  - 표고: × 흰 3 + `#16181d` 1.2. 글자 400 `#16181d` + 흰 halo.
  - PPT 글자 halo는 바탕 라벨이 쓰는 halo 글상자 방식을 다시 쓴다.
- 장식 기본값은 꺼짐이다. 3단계 「대지 개요」 장이 켤 예정이다. 보드 카드에는 그리지 않는다.

- [ ] **Step 1: 테스트 작성 — 실패 확인**
  ```js
  // dims: 100×60 m 직사각형 outline, mpp 1 → siteDims 4개, text "100.0 m"/"60.0 m", 선이 대지 밖(n쪽) 8 px
  // short: 30 m 변은 빠짐
  // els: 표고 [18.9, 17.5, null, 18.0] → 3개, text "18.9", 단위 없음
  // empty: siteMarks 없음 → [] / siteOutline null → []
  // labels: 바탕 라벨 상자가 siteDims·siteElevations 상자와 안 겹침
  // svg: MapFigure siteMarks on → "100.0 m" 글자와 회전 transform, × 경로
  // pptx: decorations.siteDims true인 장 → 도형 이름에 "대지 치수", false면 없음
  // state: 옛 decorations({north,scaleBar,locator})를 정규화하면 siteDims·siteElevations false
  ```
- [ ] **Step 2: 장면 기하 구현** → `test-v2-site-marks.mjs` 장면 부분 PASS
- [ ] **Step 3: 두 렌더러·장식 상태·서랍 체크 구현** → 나머지 PASS, `test-v2-basemap-scene.mjs`·`test-v2-report-scale.mjs`(:199 고정 자료에 새 키) PASS
- [ ] **Step 4: 정본 §11 장식 목록 갱신, 커밋** `feat(v2): 대지 치수선·꼭짓점 표고 장식(보고서 지도 설정) — §9-12`

---

### Task 4: 주제 레이어 톤 — 떨어진 면 / 구역 면

**Files:**
- Modify: `src/lib/v2/ui/map-layers.ts`(톤 함수·상수)
- Modify: `src/components/v2/map-figure.tsx`(:1296 다각형, :1351 빗금 견본)
- Modify: `src/lib/v2/report/map-pptx.ts`(:775-777 `addPolygons`)
- Modify: 범례 면 견본에 `polygonOpacity`를 쓰는 곳(grep `polygonOpacity`)은 모두 `polygonPaint`로 바꾼다
- Test: `src/scripts/v2/test-v2-polygon-tone.mjs`(신규)

**Interfaces:**
- Produces (map-layers.ts):
  ```ts
  export const POLYGON_TONES = { separate: { fillOpacity: 0.25, stroke: null, strokeWidth: 0 },
                                 zone: { fillOpacity: 0.3, stroke: "#ffffff", strokeWidth: 1.7 } } as const;
  export function polygonTone(layer: string): "separate" | "zone" | null;
  export function polygonPaint(layer: string, style: LayerStyle, satellite: boolean): { fillOpacity: number; stroke: string | null; strokeWidth: number };
  ```
- 분류(제 판단 — 사용자 지시는 「건물은 A, 용도지역은 흰 외곽선」):
  - 레이어 스타일이 `fillOpacity`·`stroke`·`strokeWidth`·`dash`·`hatch` 중 하나라도 직접 정하면 `null`이다. 지금 값 그대로 두는 예외다(`use:미상`, `maint_area:*`, `maint_stage:정비계획`, `school_zone_*`, `park` 등 flatPolygon, `districtPolygon`, `dens_0`, `block_open`, `svf_building`, `sun_face`, `topo_coverage`, `parcel_picker`).
  - 나머지 중 `/^(use:|floors_|tall_|low_|bldg_)/`이거나 `isBuildingLayer`면 `"separate"`다.
  - 그 밖의 면은 모두 `"zone"`이다(`zone:*`, `district:*`, `facility:*`, `jimok:*`, `lot_*`, `block_*`, `dens_q*`, 나머지 `maint_stage:*` 등).
- `polygonPaint`:
  - 톤이 `null`이면 지금 식 그대로다. 채움은 `style.fillOpacity ?? (satellite ? 0.45 : 0.35)`, 선은 `style.stroke ?? style.color`·`style.strokeWidth ?? 1`.
  - 톤이 있으면 `POLYGON_TONES` 값을 쓰되, 위성이면 채움만 0.45다.
  - 선 굵기에는 렌더러가 u를 곱한다.
  - `stroke: null`이면 화면은 `stroke="none"`, PPT는 선 없음이다.
  - 선택(파랑)·강조(INK)·흐림·추정 빗금은 지금처럼 이 값보다 먼저다.

- [ ] **Step 1: 테스트 작성 — 실패 확인**
  ```js
  assert.equal(polygonTone("use:주거"), "separate"); assert.equal(polygonTone("floors_5_8"), "separate"); assert.equal(polygonTone("bldg_1990s"), "separate");
  assert.equal(polygonTone("zone:주거"), "zone"); assert.equal(polygonTone("district:지구단위계획구역"), "zone"); assert.equal(polygonTone("jimok:site"), "zone");
  for (const l of ["use:미상", "maint_area:모아타운", "school_zone_elem", "park", "dens_0"]) assert.equal(polygonTone(l), null);
  // svg: use:주거 면 → fill-opacity="0.25" stroke="none"; zone:주거 → fill-opacity="0.3" stroke="#ffffff" stroke-width="1.7"
  // states: 범례 강조 중인 zone 면 → stroke INK; 추정 면 → 빗금 fill url(#…); 위성 바탕 use:주거 → fill-opacity="0.45"
  // pptx: use:주거 도형 선 없음·채움 투명도 75, zone:주거 흰 선
  ```
- [ ] **Step 2: 구현** → 신규 테스트와 `test-v2-map-palette*.mjs`·`test-v2-tile-a04-green-space.mjs`·`test-v2-tile-a09-maintenance.mjs`·`test-v2-tile-d16-density.mjs` PASS(예외 레이어 값 불변)
- [ ] **Step 3: 커밋** `feat(v2): 주제 레이어 톤 — 건물 외곽선 없음 25 %, 구역 면 흰 외곽선 1.7 px 30 % — §9-12`

---

### Task 5: 겹친 면 구멍(M-1)

**Files:**
- Modify: `src/lib/v2/ui/basemap.ts`(`mapBaseFromScene`)
- Modify: `src/lib/v2/report/map-pptx.ts`(:762-785 `addPolygons` 묶음)
- Test: `src/scripts/v2/test-v2-basemap-overlap.mjs`(신규), `test-v2-ppt-vector-basemap.mjs`(:108-109 기대값 확인)

**Interfaces:**
- 바탕:
  - `mapBaseFromScene`이 같은 층(건물, 녹지 종류별, 물) 안에서 면이 실제로 겹치는 것끼리 `@turf/turf` `union`으로 합친다. bbox로 먼저 거르고, 겹침 넓이가 0보다 큰 쌍만 합친다.
  - 바탕 지물은 선택·라벨 대상이 아니므로 합쳐도 잃는 것이 없다.
  - 같은 `Scene`은 `WeakMap`으로 한 번만 계산한다. 묶음 구조(층당 경로 하나·custGeom 하나)는 그대로다.
- PPT 주제 면:
  - `addPolygons`는 같은 스타일 묶음 안에서 겹치는 면을 하위 묶음으로 나눈다(`splitOverlapping(polys): Ring[][][]`).
  - 나누는 방법은 탐욕 배정이다. 앞 하위 묶음 중 겹치는 면이 없는 첫 곳에 넣는다.
  - 화면 주제 면은 이미 면마다 경로가 따로라 그대로 둔다.

- [ ] **Step 1: 테스트 작성 — 실패 확인**
  ```js
  // base: 겹치는 두 사각형 건물 → MapBase 건물 1개, 겹친 점을 even-odd로 칠해도 안(구멍 아님); 떨어진 두 사각형 → 2개
  // svg: 바탕 건물 경로에서 겹친 점 (15,15)이 evenodd 판정으로 채워짐(작은 point-in-path 함수)
  // pptx: 겹치는 use:주거 면 두 개 → custGeom 2개(하위 묶음), 안 겹치는 면 10개 → 1개
  ```
- [ ] **Step 2: 구현** → 신규 테스트, `test-v2-ppt-vector-basemap.mjs`, `test-v2-basemap-scene.mjs` PASS
- [ ] **Step 3: 커밋** `fix(v2): 같은 층 겹친 면이 구멍으로 그려지던 문제(M-1) — 바탕은 합치고 PPT 주제 면은 나눔`

---

### Task 6: 바탕 라벨이 위치도·옮긴 방위표를 피함(M-4)

**Files:**
- Modify: `src/lib/v2/ui/map-scene.ts`(:57 `northArrowBox`에 `x?: number`, :1347에서 `northX` 전달)
- Modify: `src/components/v2/report/slide-surface.tsx`(:587-602 — 위치도 상자를 먼저 계산해 `avoid`에 넣고, 저장된 방위표 상자도 넣음)
- Modify: `src/lib/v2/report/map-pptx.ts`(:625-639 `sceneFor` 같은 방식, :1171-1199 `editableMapAvoid`에 저장 상자·위치도)
- Test: `test-v2-basemap-scene.mjs`(추가), `test-v2-report-doc-pptx.mjs`(추가)

**Interfaces:**
- `northArrowBox(width, height, rightInset = 0, north?: number | false, unitOverride?: number, x?: number)` — `x`가 있으면 그 중심으로 계산한다.
- 위치도 상자는 `locatorBox(w, h, ppi, 위치도 없이 만든 avoid)`로 먼저 구한다. 장식이 켜져 있을 때만 `avoid`에 더한다. 위치도 자신은 지금처럼 나머지를 피한다.

- [ ] **Step 1: 테스트 작성 — 실패 확인**
  ```js
  // scene: northX = 100 → occupiedBoxes에 x 77..123 상자, 바탕 라벨이 그 상자와 안 겹침
  // pptx: 위치도 켠 장 → 바탕 라벨 글상자들이 위치도 그룹 상자와 안 겹침; 방위표를 왼쪽 위로 옮긴 장 → 라벨이 그 상자와 안 겹침
  ```
- [ ] **Step 2: 구현** → PASS
- [ ] **Step 3: 커밋** `fix(v2): 바탕 라벨이 위치도·옮긴 방위표를 피함(M-4)`

---

### Task 7: 흐린 장 PPT 합성(M-8)

**Files:**
- Modify: `src/lib/v2/report/map-pptx.ts`(:704 `BASE_MUTED_OPACITY`, :714-729 `addBaseMap`)
- Test: `test-v2-ppt-vector-basemap.mjs`(:406-416 근처에 추가)

**Interfaces:**
- 흐린 장의 처리:
  - 바탕 묶음 도형은 흐리지 않은 장과 똑같이 그린다(묶음 자체 `opacity`만, 흐림 배율 없음).
  - 묶음 다음에 지도 프레임 크기의 `base.bg` 사각형 하나를 불투명도 `1 − 0.55 = 0.45`(투명도 55)로 덮는다. 이름은 `tag(code, "base-muted", "바탕 흐림", 0)`이다.
  - 바탕 라벨은 지금 방식(글자 알파 55 %, halo 없음) 그대로다.
- 화면은 이미 「묶음 그룹 opacity 0.55 over bg」라 바꾸지 않는다.

- [ ] **Step 1: 테스트 작성 — 실패 확인**
  ```js
  // muted 장: 건물 custGeom에 <a:alpha 없음; 묶음 뒤에 "바탕 흐림" 사각형, 채움 alpha 45000; 흐리지 않은 장에는 없음
  ```
- [ ] **Step 2: 구현** → PASS
- [ ] **Step 3: 커밋** `fix(v2): 흐린 장 바탕을 한 장 덮개로 합성해 교차부가 진해지지 않게(M-8)`

---

### Task 8: 2D·3D 용도색 한 곳(T1) — **사용자 확인 후 진행**

> 확인할 것: 3D(S01) 용도색이 2D 값으로 바뀐다(예: 주거 `#F2D46E` → `#D69E2E`, 공업 `#A28775` → `#718096`). 높이색은 이미 같다. 연대색(3D 갈색 / 2D viridis)은 이 Task에 넣지 않는다.

**Files:**
- Modify: `src/lib/v2/ui/mass-projection.ts`(`MASS_USE_COLORS`, :421 `USE_FILL`)
- Modify: `src/lib/v2/ui/mass-3d-runtime.ts`(:7, :177), `src/components/v2/mass-figure.tsx`(:3, :198)
- Modify: `MassModel`에 `palette?: DiagramPaletteRef | null` — `MapModel.palette`를 싣는 곳(보드·보고서)에서 함께 싣는다
- Test: `test-v2-tile-s01-mass.mjs`(:182), 신규 단언

**Interfaces:**
- `export function massUseColors(palette?: DiagramPaletteRef | null): Record<string, string>` — 용도 이름 → `paletteLayerStyle("use:" + 이름, layerStyle("use:" + 이름), palette).color`다. `MASS_USE_COLORS` 상수는 지우고 소비처는 이 함수를 쓴다.
- 건너뛴 것: `map-layers.ts`의 나머지 hex 316개를 다른 파일로 옮기기. 정본 §3이 이미 「레이어 색은 map-layers.ts 한 곳」이라 옮겨도 얻는 것이 없다.

- [ ] **Step 1: 테스트** — `massUseColors(null)["주거"] === layerStyle("use:주거").color`, `"vivid"`이면 2D vivid 색과 같음 → FAIL
- [ ] **Step 2: 구현** → `test-v2-tile-s01-mass.mjs`(기대값 `#D69E2E`로 갱신)·`test-v2-map-palette*.mjs` PASS
- [ ] **Step 3: 커밋** `refactor(v2): 3D 용도색을 2D 용도색·팔레트에서 가져옴(T1)`

---

### Task 9: Judge 인수 — 실렌더

- [ ] `npm run test:v2` 전체·`npm run lint` 1회 PASS. `test-v2-topo-terrain` 성능 예산이 실패하면 단독으로 다시 돌린다.
- [ ] 개발 서버(V2_DATA_DIR=`D:/V-coding/16-SiteAnalysis/.cache/v2/data`)에서 대치동 503(pnu 있는 분석, 예: `fe9e688b`)을 새로 분석한다.
  - 1440×900·1024×768에서 D03·D05·A12 카드, 펼침, 보고서 장을 캡처한다. 보고서 장은 장식 `대지 치수`·`대지 표고`를 켠 A12 장 하나를 포함한다.
  - `.spike/snap-measure.mjs`로 겹침·잘림을 잰다.
  - 결정 페이지의 「고른 조합」과 나란히 놓고 비교한다.
- [ ] PPT로 내보내 `tools/qa/render-pptx.ps1`(PowerPoint SaveAs PNG, 시간 제한)로 실렌더한다. 미리보기와 나란히 비교하고, 바탕 흐린 장 1쪽을 포함한다.
- [ ] S01 3D 용도색 전·후 캡처를 사용자에게 보인다(Task 8을 했으면).
- [ ] 진행 기록은 `.superpowers/sdd/2026-10-29-map-chrome-tone/progress.md`에 남긴다.

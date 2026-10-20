# 보고서 모드 B안(떠 있는 패널) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보고서 모드에서 슬라이드를 화면의 25%에서 73%로 키운다. 지도는 두 번 눌러 바로 편집하고, 페이지 줄은 방향키로 넘기고 끌어서 옮기게 바꾼다.

**Architecture:**
- 레일·서랍·레이아웃 칸으로 된 3열 grid를 없앤다. 무대 하나 위에 떠 있는 카드를 얹는다: 도구 막대, 서랍, 페이지 줄, 지도 설정 카드.
- 조작 규칙(키 해석, 놓을 자리 계산, 지도 상태 전이)은 `report-mode-logic.ts`의 순수 함수로 두고 테스트한다. 컴포넌트는 그 결과만 반영한다.
- 앱 머리 줄은 하나로 합친다. 보고서 동작은 portal로 앱 topbar 안의 칸에 그린다.

**Tech Stack:** Next.js(React 19) · TypeScript · CSS Modules · node `assert` + `renderToStaticMarkup` 테스트(`npm run test:v2`) · `tsc --noEmit`(`npm run lint`)

**Spec:** `docs/superpowers/specs/2026-10-20-report-b-layout-design.md` (상위: `docs/superpowers/specs/2026-10-19-report-mode-design.md`). 시안: https://claude.ai/artifact/BC55sQupgmp3qaWyoRkQQX

**Branch:** `main`(19092fe 이후)에서 `v2-report-b-layout`을 만든다. 지금 작업 트리(`v2-topo-supplement`)에는 보고서 모드 코드가 없다.

## Global Constraints

- **글꼴:** Do Hyeon(제목) / Noto Sans KR(본문)
- **색 토큰:** `#15171c` / `#676c76` / `#d9dce2` / `#eef0f3`, 강조 `#2f6fdb`, 검정 `#16181d`
- **조작:** 모든 조작은 누르는 영역 44×44 px 이상, 포커스 링을 보이고, 일반 글자 대비 4.5:1 이상
- **호버·끌기만으로 되는 조작 금지:** 순서 바꾸기·추가·범례 순서는 버튼이나 키보드로도 되어야 한다.
- **편집기 겉면 글자:** 크기 20/16/14/13/12만, 굵기 400/500/700만
  - 대상은 `report-mode.module.css`다. `slide-surface.module.css`와 내보내기 결과물은 바꾸지 않는다.
- **움직임:**
  - 나타날 때 180 ms `cubic-bezier(.23,1,.32,1)`, 사라질 때 120 ms
  - 키보드 조작에는 애니메이션 없음
  - `prefers-reduced-motion`에서는 투명도만
- **새 npm 의존성 금지**
- **사용자에게 보이는 말은 한국어**, 동작은 동사로 쓴다.
- **파일 수정은 `Edit`/`Write` 도구로만** 한다. 셸 치환 heredoc 금지(CLAUDE.md).

## Review Focus

1. **입력 중에 키가 페이지를 넘기면 안 된다.** 메모 textarea, 글상자 contentEditable, 축척 입력칸에서 ←/→/PageUp/PageDown을 눌러도 페이지는 그대로이고, 커서만 움직여야 한다. → Task 1 `isTypingTarget` 테스트, Task 2 전역 키 처리에서 사용
2. **이어지는 장(출처 +n쪽)은 한 페이지다.** 페이지 줄의 한 칸으로 방향키 이동은 되지만, 같은 페이지의 이어지는 장 위에 놓는 것은 아무 일도 하지 않아야 한다. → Task 1 `dropMoveIndex` 테스트
3. **고정된 지도는 편집에 들어가지 않는다.** 두 번 누르거나 Enter를 눌러도 편집이 시작되지 않고, 휠도 지도를 바꾸지 않는다. 대신 자물쇠 버튼만 강조한다. → Task 1 `transitionMapInteraction` 테스트
4. **Esc는 한 단계씩 물러난다.** 편집 중이면서 설정 카드가 열려 있을 때 Esc를 세 번 누르면 편집 끝 → 카드 닫기 → 선택 해제 순서여야 한다. → Task 1 테스트
5. **390 px에서도 쓸 수 있어야 한다.** 떠 있는 요소가 슬라이드를 다 가리면 안 되고, 서랍·설정 카드는 아래 시트로 열리고 포커스를 가둔다. → Task 5 CSS 계약 테스트, Task 9 브라우저 QA

---

### Task 1: 조작 규칙 순수 함수

**Files:**
- Modify: `src/lib/v2/ui/report-mode-logic.ts`
- Test: `src/scripts/v2/test-v2-report-mode-state.mjs`

**Interfaces:**
- Produces:
  - `type StripKey = "ArrowLeft" | "ArrowRight" | "Home" | "End"`
  - `stripKeyIntent(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): { kind: "navigate"; key: StripKey } | { kind: "reorder"; key: "ArrowLeft" | "ArrowRight" } | null`
  - `stripNavIndex(count: number, current: number, key: StripKey | "PageUp" | "PageDown"): number | null` — 같은 자리이거나 범위 밖이면 `null`
  - `dropMoveIndex(pageIds: readonly string[], sourceId: string, overId: string, side: "before" | "after"): number | null` — 반환값은 reducer `{ type: "move", id, to }`의 `to`. 같은 자리면 `null`.
  - `reorderMessage(from: number, to: number): string` — 0부터 센 위치를 받는다.
  - `isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean`
  - `MapInteractionState`에 `settingsOpen: boolean`을 더한다.
  - `MapInteractionEvent`에 `"open-settings" | "close-settings"`를 더한다.
  - `transitionMapInteraction(state, event, locked = false)`
- 바꾸지 않는 것: `moveByKey`. 재배치 단축키가 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트를 `test-v2-report-mode-state.mjs`에 추가한다**

```js
assert.deepEqual(stripKeyIntent({ key: "ArrowRight", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }), { kind: "navigate", key: "ArrowRight" });
assert.deepEqual(stripKeyIntent({ key: "ArrowLeft", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }), { kind: "reorder", key: "ArrowLeft" });
assert.deepEqual(stripKeyIntent({ key: "ArrowLeft", ctrlKey: false, metaKey: true, shiftKey: true, altKey: false }), { kind: "reorder", key: "ArrowLeft" }, "mac ⌘+Shift");
assert.equal(stripKeyIntent({ key: "ArrowLeft", ctrlKey: false, metaKey: false, shiftKey: false, altKey: true }), null, "Alt+←는 브라우저 뒤로 가기에 맡긴다");
assert.equal(stripKeyIntent({ key: "Home", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }), null, "Home은 재배치 대상이 아니다");
assert.equal(stripNavIndex(5, 2, "ArrowRight"), 3);
assert.equal(stripNavIndex(5, 0, "ArrowLeft"), null);
assert.equal(stripNavIndex(5, 2, "End"), 4);
assert.equal(stripNavIndex(5, 4, "PageDown"), null);
assert.equal(stripNavIndex(5, 3, "PageUp"), 2);
const ids = ["p1", "p2", "p3", "p4", "p5"];
assert.equal(dropMoveIndex(ids, "p3", "p5", "after"), 4, "3쪽을 5쪽 뒤로");
assert.equal(dropMoveIndex(ids, "p3", "p1", "before"), 0);
assert.equal(dropMoveIndex(ids, "p3", "p4", "before"), null, "제자리");
assert.equal(dropMoveIndex(ids, "p3", "p3", "after"), null, "자기 자신(이어지는 장 포함)");
assert.equal(dropMoveIndex(ids, "p9", "p1", "before"), null);
assert.equal(reorderMessage(2, 4), "3쪽을 5쪽 뒤로 옮겼습니다");
assert.equal(reorderMessage(2, 0), "3쪽을 1쪽 앞으로 옮겼습니다");
assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
assert.equal(isTypingTarget(null), false);
const sel = { selected: true, moveActive: false, settingsOpen: false };
const editingWithSettings = { selected: true, moveActive: true, settingsOpen: true };
assert.deepEqual(transitionMapInteraction(sel, "enter-move", true), sel, "고정된 지도는 편집에 들어가지 않는다");
assert.deepEqual(transitionMapInteraction(sel, "open-settings"), { selected: true, moveActive: false, settingsOpen: true });
assert.deepEqual(transitionMapInteraction(editingWithSettings, "escape"), { selected: true, moveActive: false, settingsOpen: true }, "Esc 1: 편집 끝");
assert.deepEqual(transitionMapInteraction({ selected: true, moveActive: false, settingsOpen: true }, "escape"), sel, "Esc 2: 카드 닫기");
assert.deepEqual(transitionMapInteraction(sel, "escape"), { selected: false, moveActive: false, settingsOpen: false }, "Esc 3: 선택 해제");
assert.deepEqual(transitionMapInteraction(editingWithSettings, "outside-page"), { selected: false, moveActive: false, settingsOpen: false });
```

기존 `transitionMapInteraction` 단언은 모두 `settingsOpen: false`를 가진 상태로 고친다.

- [ ] **Step 2:** `npx tsx src/scripts/v2/test-v2-report-mode-state.mjs`를 실행한다. 기대: 새 import가 없으므로 FAIL
- [ ] **Step 3:** 위 Interfaces대로 구현한다.
  - `select`는 `settingsOpen`을 유지한다.
  - `toggle-move`·`enter-move`는 `locked`이면 상태를 그대로 돌려준다.
  - `outside-slide`는 지금처럼 편집 중이면 편집만 끝낸다. 편집 중이 아니면 `settingsOpen`과 선택을 모두 해제한다.
- [ ] **Step 4:** 같은 명령을 다시 실행한다. 기대: `report mode state: PASS`
- [ ] **Step 5:** 커밋 — `feat(v2): 보고서 페이지 줄 키·놓을 자리·지도 편집 상태 규칙을 순수 함수로`

### Task 2: 페이지 줄 — 방향키는 이동, 끌어 놓기는 순서

**Files:**
- Modify: `src/components/v2/report/page-strip.tsx`, `src/components/v2/report/report-mode.tsx`(movePage·dropMovePage·전역 keydown), `src/components/v2/report/report-mode.module.css`
- Create (test): `src/scripts/v2/test-v2-report-page-strip-ui.mjs`

**Interfaces:**
- Consumes (Task 1): `stripKeyIntent`, `stripNavIndex`, `dropMoveIndex`, `reorderMessage`, `isTypingTarget`, `moveByKey`
- Produces: `PageStripProps`를 바꾼다.
  - 없애는 것: `onMove(id, key)`
  - 더하는 것: `onNavigate(index: number)` — 페이지 줄 항목 index를 받고, 그 항목의 `page.id`·`slide.key`를 선택한다.
  - 더하는 것: `onReorder(id: string, key: "ArrowLeft" | "ArrowRight")` — 안에서 `moveByKey`를 호출한다.
  - 바꾸는 것: `onDropMove(sourceId: string, to: number)` — 대상 id가 아니라 `to` index를 받는다.

- [ ] **Step 1: 실패하는 테스트 `test-v2-report-page-strip-ui.mjs`를 만든다**
  - `renderToStaticMarkup(createElement(PageStrip, …))`로 항목 3개를 그리고, 두 번째 항목을 선택한다. fixture는 `test-v2-report-doc-plan.mjs`가 쓰는 `pageStripItems`에서 가져온다.
  - 단언 1: `tabindex="0"`은 정확히 1개이고 선택한 항목의 버튼에 있다. `tabindex="-1"`은 2개다.
  - 단언 2: 목록 `aria-label="보고서 페이지"`가 있다.
  - 단언 3: page-strip 소스에 `onMove(`가 없다. `readFileSync` 후 `assert.doesNotMatch(src, /onMove\(/)`
  - 단언 4: CSS에 `.pageDropIndicator`가 있고 `width: 3px`, 강조색 `#2f6fdb`를 쓴다.
- [ ] **Step 2:** `npx tsx src/scripts/v2/test-v2-report-page-strip-ui.mjs`를 실행한다. 기대: FAIL
- [ ] **Step 3: `page-strip.tsx`를 구현한다**
  - **키 처리:** 썸네일 keydown에서 `stripKeyIntent` 결과가
    - `navigate`이면 `stripNavIndex`로 다음 index를 구해 `onNavigate`를 호출하고, `requestAnimationFrame` 뒤 그 버튼에 포커스를 준다.
    - `reorder`이면 `onReorder`를 호출하고 포커스를 유지한다.
  - **끌기 중 상태:** dragover에서 썸네일 가운데 x를 기준으로 `side`를 정해 `dropAt: { overId, side } | null` 상태에 둔다.
    - 그 썸네일의 앞(`before`) 또는 뒤(`after`)에 `<span class={styles.pageDropIndicator} aria-hidden>`을 그린다.
    - 끄는 항목에는 `data-dragging="true"`를 준다.
  - **자동 스크롤:** 목록 dragover에서 포인터가 왼쪽·오른쪽 끝 48 px 안이면 `scrollBy({ left: ±16 })`
  - **놓기:** drop에서 `dropMoveIndex(pageIds, sourceId, overId, side)`가 `null`이 아니면 `onDropMove`를 호출한다. `pageIds`는 `items`에서 중복 없이 뽑은 `page.id`다.
  - **포커스 순서:** 선택한 항목 버튼만 `tabIndex={0}`, 나머지는 `-1`이다.
- [ ] **Step 4: `report-mode.tsx`를 고친다**
  - `dropMovePage(id, to)`는 `apply({ type: "move", id, to }, reorderMessage(from, to))`를 호출한다.
  - `onReorder`도 같은 메시지로 apply한다.
  - 전역 keydown에서 PageUp/PageDown을 처리한다. `isTypingTarget(event.target)`이거나 지도 편집 중이면 무시한다. 그 외에는 `stripNavIndex`로 현재 페이지 줄 항목 index를 바꾼다.
- [ ] **Step 5: CSS를 더한다**
  - `.pageDropIndicator`: `position: absolute; top: -6px; bottom: -6px; width: 3px; border-radius: 2px; background: #2f6fdb`
  - `[data-dragging="true"]`: `opacity: .35`
- [ ] **Step 6:** `npm run lint && npx tsx src/scripts/v2/test-v2-report-page-strip-ui.mjs && npx tsx src/scripts/v2/test-v2-report-mode-state.mjs`를 실행한다. 기대: 오류 0, PASS 둘
- [ ] **Step 7:** 커밋 — `feat(v2): 보고서 페이지 줄 방향키는 페이지 이동, 순서는 끌어 놓기와 Ctrl+Shift+화살표`

### Task 3: 지도 — 두 번 눌러 편집, 편집 중 조작

**Files:**
- Modify: `src/components/v2/report/slide-surface.tsx`(지도 상호작용 컴포넌트와 `SlidePreview`의 `onDoubleClick`·keydown), `src/components/v2/report/slide-surface.module.css`
- Create: `src/lib/v2/ui/map-edit-hint.ts`
- Test: `src/scripts/v2/test-v2-report-surface.mjs`(추가), `src/scripts/v2/test-v2-report-mode-state.mjs`(hint)

**Interfaces:**
- Produces:
  - `readMapEditHintDismissed(storage: Pick<Storage, "getItem"> | null): boolean`
  - `dismissMapEditHint(storage: Pick<Storage, "setItem"> | null): void`
  - 저장소 키는 `"v2.report.mapEditHint"`, 값은 `"dismissed"`. 두 함수 모두 저장소가 없거나 예외를 던지면 조용히 넘어간다.
  - 편집 중이면 슬라이드 canvas에 `data-map-editing="true"`를 단다.
- Consumes: 같은 파일의 `zoomViewAt(baseViewport, view, delta, px, py, 3, -3)`. 휠 처리가 쓰는 그것이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - **surface 테스트:** `mode: "edit"`, `mapActive: true`로 그린 markup에 `data-map-editing="true"`가 있다.
  - **CSS 계약:** `[data-map-editing="true"] [data-panel-key]`에 `opacity: .35`와 `pointer-events: none`이 있다. `[data-map-editing="true"] [data-preview-map]`에 `cursor: grab`이 있다.
  - **CSS 계약:** `[data-map-editing="true"] [data-preview-map][data-dragging="true"]`에 `cursor: grabbing`이 있다.
  - **hint 테스트:**
    - `readMapEditHintDismissed({ getItem: () => "dismissed" }) === true`
    - `readMapEditHintDismissed({ getItem: () => { throw new Error("blocked"); } }) === false`
    - `readMapEditHintDismissed(null) === false`
- [ ] **Step 2:** 두 테스트를 실행한다. 기대: FAIL
- [ ] **Step 3: 구현한다**
  - **두 번 누르기:** `SlidePreview`의 `onDoubleClick`
    - 이미 편집 중이면 지도 상호작용 컴포넌트 안에서 `zoomViewAt(…, +0.5, px, py, …)`로 그 위치를 확대하고, 휠 확정과 같은 `patchRef.current(...)` 경로로 기록한다. 이때 `SlidePreview`의 `onDoubleClick`은 `mapActive`이면 아무것도 하지 않는다.
    - 편집 중이 아니면 지금처럼 `onMapMoveActive(true)`를 호출한다.
  - **키보드:** 지도에 포커스가 있을 때
    - Enter를 누르면 `onMapMoveActive(true)`를 호출한다.
    - 편집 중이면 `+`/`=`는 `zoomDelta + 0.25`, `-`는 `zoomDelta - 0.25`를 `onPatch`로 보낸다.
    - 방향키 이동은 그대로 둔다.
  - **고정과 휠:** 고정이면 `interactive=false`가 되어 휠이 막히는 지금 경로를 그대로 쓴다. Task 1의 `locked` 인자로 진입도 막힌다.
- [ ] **Step 4:** 테스트를 실행한다. 기대: PASS
- [ ] **Step 5:** 커밋 — `feat(v2): 보고서 지도는 두 번 눌러 편집, 편집 중 두 번 누르기 확대·+/− 키, 패널 흐림`

### Task 4: 머리 줄 한 줄로 합치기

**Files:**
- Modify: `src/app/v2/page.tsx:1005-1075`(topbar), `src/components/v2/board.module.css`(page.tsx가 쓰는 스타일 — 모드 탭 배지 `.modeCount`), `src/components/v2/report/report-mode.tsx`(`reportHeader`)
- Test: `src/scripts/v2/test-v2-tile-mode-no-report.mjs`(추가)

**Interfaces:**
- Produces:
  - topbar 안에 `<div id="v2-report-actions" />`를 둔다. `boardMode === "report"`일 때만 렌더하고, 위치는 `spacer` 뒤다.
  - `ReportMode`는 이 요소를 찾아 `createPortal`로 되돌리기·다시 실행·판형·발표·내보내기를 그린다. 이 요소가 없으면(테스트·SSR) 아무것도 그리지 않는다.
  - 내보내기 패널의 기준 위치는 portal 안의 `exportTriggerRef`를 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `report-mode.tsx` 소스에 `styles.reportHeader`와 `대지분석 보고서`가 없다.
  - `page.tsx` 소스에 `id="v2-report-actions"`가 있고, 모드 탭 문자열 `보고서 · `가 없다.
- [ ] **Step 2:** 실행한다. 기대: FAIL
- [ ] **Step 3: 구현한다**
  - 모드 탭은 `보고서<span className={styles.modeCount}>{reportDocPageCount}</span>`로 바꾼다. `aria-label`은 `보고서, ${n}쪽`이다.
  - `.reportRoot`의 grid rows는 `minmax(0, 1fr)` 하나가 된다.
- [ ] **Step 4:** `npm run lint && npm run test:v2`를 실행한다. 기대: 전체 PASS
- [ ] **Step 5:** 커밋 — `feat(v2): 보고서 모드 머리 줄을 앱 머리 줄 하나로 합침`

### Task 5: 떠 있는 무대 배치

**Files:**
- Modify: `src/components/v2/report/report-mode.tsx`(본문 JSX), `src/components/v2/report/report-mode.module.css`, `src/components/v2/report/notes-field.tsx`, `src/components/v2/report/layout-switcher.tsx`
- Create (test): `src/scripts/v2/test-v2-report-chrome-style.mjs`

**Interfaces:**
- Consumes (Task 4): 머리 줄이 빠진 `.reportRoot`
- Produces:
  - **무대 여백 변수:** `.reportStage`가 `--stage-left`, `--stage-right`, `--stage-bottom`을 쓴다. 기본값은 각각 `88px`, `24px`, `100px`이다.
    - `data-drawer-open="true"`이면 `--stage-left: 418px`
    - `data-settings-open="true"`이면 `--stage-right: 328px`
  - **슬라이드 맞춤:** `.stageFit`이 `position:absolute; inset: 16px var(--stage-right) var(--stage-bottom) var(--stage-left); container-type: size`를 갖는다. 슬라이드 너비는 `min(100cqw, calc(100cqh * 16 / 9))`다. A3·A4는 그 판형의 비율을 쓴다.
  - **떠 있는 카드 클래스:** `.floatCard` 하나를 공통으로 쓴다(`border-radius: 12px; border: 1px solid #e1e4e9; box-shadow: 0 1px 2px rgba(21,23,28,.06), 0 8px 24px rgba(21,23,28,.10)`). 도구 막대 `.toolPill`, 서랍 `.drawerCard`, 페이지 줄 `.pageDock`, 설정 카드 `.settingsCard`가 이것을 함께 쓴다.
  - **페이지 줄 앞쪽 버튼:**
    - 레이아웃 메뉴 버튼은 `aria-haspopup="menu"`이고, 그 안에 `LayoutSwitcher`를 compact 모드(`compact` prop)로 그린다.
    - 메모 버튼은 `aria-expanded`이고 popover 안에 `NotesField`를 그린다. 메모가 있으면 점(`data-has-notes`)을 표시한다.
  - **`NotesField`, `LayoutSwitcher`:** `compact?: boolean` prop을 더한다. compact이면 설명 문장과 카드 테두리를 그리지 않는다.

- [ ] **Step 1: 실패하는 CSS 계약 테스트 `test-v2-report-chrome-style.mjs`를 만든다**
  - `.reportBody`에 `grid-template-columns`가 없다(3열 grid를 없앴는지 확인).
  - `.stageFit`에 `container-type: size`가 있다.
  - `.floatCard`에 `border-radius: 12px`가 있다.
  - 390 px 미디어쿼리(`max-width: 639px`) 안에서 `.drawerCard`와 `.settingsCard`가 `bottom: 0`인 시트다.
  - `@media (prefers-reduced-motion: reduce)` 안에서 `.floatCard`의 `transform`이 `none`이다.
  - 나타남 애니메이션에 `cubic-bezier(.23,1,.32,1)`과 `180ms`가 있다.
- [ ] **Step 2:** 실행한다. 기대: FAIL
- [ ] **Step 3: JSX와 CSS를 바꾼다**
  - 레일 → `.toolPill`, `drawerColumn` → `.drawerCard`, `editorSide` 삭제, `NotesField` → 페이지 줄 popover, `PageStrip` → `.pageDock` 안
  - `useFocusTrap`과 `data-mobile-sheet` 논리는 그대로 둔다. 붙이는 대상만 `.drawerCard`·`.settingsCard`로 바꾼다.
- [ ] **Step 4:** `npm run lint && npm run test:v2`를 실행한다. 기대: 전체 PASS
- [ ] **Step 5:** 커밋 — `feat(v2): 보고서 모드를 떠 있는 패널 무대로 재배치(슬라이드 25%→73%)`

### Task 6: 지도 막대와 설정 카드 상태

**Files:**
- Modify: `src/components/v2/report/map-toolbar.tsx`, `src/components/v2/report/report-mode.tsx`(`mapEditing`, `openMapSettings`, `toggleMapMove`, Escape 처리), `src/components/v2/report/report-mode.module.css`
- Test: `src/scripts/v2/test-v2-report-page-strip-ui.mjs`에 MapToolbar SSR 단언 추가

**Interfaces:**
- Consumes (Task 1): `transitionMapInteraction(state, event, locked)` + `settingsOpen`. Task 3: `readMapEditHintDismissed`, `dismissMapEditHint`
- Produces:
  - `MapToolbarProps = { scale: number; locked: boolean; editing: boolean; settingsOpen: boolean; lockAttention: boolean; onZoom(delta: number): void; onFit(): void; onToggleLock(): void; onToggleSettings(): void; onDone(): void }`
  - `onToggleMove`는 없앤다.
- 렌더 조건: `selection?.kind === "map"`일 때만 그린다. 위치는 슬라이드 상자 아래 가장자리에서 위로 14 px, 가운데다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `editing: false` markup: 버튼 aria-label이 `축척 줄이기`, `축척 키우기`, `대지 맞춤`, `지도 위치 고정`, `지도 설정` 순서로 있다. `이동`이나 `지도 이동` 라벨은 없다.
  - `editing: true` markup: `지도 편집 끝내기 (Esc)` 버튼과 축척 −/+만 있다.
  - `lockAttention: true`이면 고정 버튼에 `data-attention="true"`가 있다.
  - 소스 단언: `report-mode.tsx`에 `styles.mapHint`와 `지도를 끌어 옮기고`가 없다.
- [ ] **Step 2:** 실행한다. 기대: FAIL
- [ ] **Step 3: 구현한다**
  - **설정 카드:** `report-mode.tsx`에 `settingsOpen` state를 둔다. `mapEditing`(= 선택만으로 드로어에 설정 열기)을 `settingsOpen && 지도 선택`으로 바꾼다. 이때 `DrawerMap`은 `.settingsCard` 안에 그린다.
  - **고정 강조:** 고정 상태에서 편집 진입을 시도하면 `lockAttention`을 600 ms 동안 `true`로 둔다.
  - **안내:** 지도를 처음 선택했고 `!readMapEditHintDismissed(safeLocalStorage())`이면 `두 번 눌러 지도 편집` 칩(`role="status"`, × 버튼 44 px)을 막대 위 12 px에 띄운다.
    - 편집을 시작하거나 ×를 누르면 `dismissMapEditHint`를 호출한다.
    - `safeLocalStorage()`는 `try { return window.localStorage } catch { return null }`다.
- [ ] **Step 4:** `npm run lint && npm run test:v2`를 실행한다. 기대: 전체 PASS
- [ ] **Step 5:** 커밋 — `feat(v2): 지도 막대는 선택할 때만, 이동 버튼 제거, 설정은 오른쪽 카드로`

### Task 7: 지도 설정 카드 정리

**Files:**
- Modify: `src/components/v2/report/drawer-map.tsx`, `src/components/v2/report/report-mode.module.css`
- Test: `src/scripts/v2/test-v2-report-chrome-style.mjs`(추가)

**Interfaces:**
- Consumes: 지금의 `DrawerMap` props. 바꾸지 않는다.
- Produces:
  - 펼쳐 두는 묶음: 축척(입력 + 프리셋 4개), 배경지도(견본 4개), 범례 위치(3칸 분할 버튼)
  - 접는 묶음: 레이어, 지번 라벨, 범례 항목, 장식, 중심 이동, (비교 페이지면) 같은 위치·확대
  - 접는 묶음은 각각 네이티브 `<details>`로 만든다. `<summary>`에는 이름과 현재 값 요약을 한 줄로 쓴다(예: `레이어 · 2개 켬`, `중심 이동 · 동 0 m, 북 0 m`).
  - `위치 고정`은 카드 머리의 토글 버튼(`aria-pressed`)으로 둔다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `drawer-map.tsx` 소스에 `<details`가 5개 이상 있다.
  - 다음 문자열이 없다: `1:500부터 1:50,000까지 입력합니다`, `지도가 잠겨 있어`, `잠금 해제 후 이동 가능`
  - 축척 오류 문구는 `scaleError`일 때만 렌더한다(조건부 렌더 단언).
- [ ] **Step 2:** 실행한다. 기대: FAIL
- [ ] **Step 3:** 구현한다. 지금 쓰는 `fieldset` 테두리는 없애고 간격 20과 구분선으로 나눈다.
- [ ] **Step 4:** `npm run lint && npm run test:v2`를 실행한다. 기대: 전체 PASS
- [ ] **Step 5:** 커밋 — `feat(v2): 지도 설정 카드는 자주 쓰는 3묶음만 펼치고 나머지는 현재 값 한 줄로 접음`

### Task 8: 글자·간격·문구 정리

**Files:**
- Modify: `src/components/v2/report/report-mode.module.css`, `src/components/v2/report/drawer-pages.tsx`, `src/components/v2/report/drawer-tiles.tsx`, `src/components/v2/report/notes-field.tsx`, `src/components/v2/report/layout-switcher.tsx`
- Test: `src/scripts/v2/test-v2-report-chrome-style.mjs`(추가)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
const css = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");
const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
assert.deepEqual([...new Set(sizes)].filter((s) => ![12, 13, 14, 16, 20].includes(s)), [], "편집기 글자 5단계");
assert.doesNotMatch(css, /font-weight:\s*(800|900)/, "굵기 400/500/700");
assert.match(css, /\.reportRoot\s*\{[^}]*word-break:\s*keep-all/s);
for (const [file, text] of [
  ["drawer-pages.tsx", "한 타일을 크게 배치합니다"], ["drawer-pages.tsx", "보고서 구성"],
  ["drawer-tiles.tsx", "비교할 타일을 2개 이상"], ["notes-field.tsx", "PPT 발표자 메모에 저장됩니다"],
  ["layout-switcher.tsx", "배치만 바꿉니다"],
]) assert.doesNotMatch(readFileSync(new URL(`../../components/v2/report/${file}`, import.meta.url), "utf8"), new RegExp(text), `${file}: ${text}`);
```

- [ ] **Step 2:** 실행한다. 기대: FAIL
- [ ] **Step 3: 구현한다**
  - **글자 크기 매핑:** 10·11 → 12, 15 → 14, 17·18 → 16, 21·22 → 20. `emptyCanvasMark`의 30은 글자가 아니라 기호라서 SVG 아이콘으로 바꾼다.
  - **굵기:** 800·900 → 700. 버튼 기본 굵기는 500이다.
  - **페이지 종류 카드:** 설명 줄 대신 레이아웃을 보여 주는 작은 SVG를 둔다.
  - **비교 만들기 버튼:** `비교 페이지 만들기 · ${selected}/${grid}`로 쓰고, 2개 미만이면 `disabled`
  - **목록 행:** `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`. 전체 이름은 `title`로 준다.
- [ ] **Step 4:** `npm run lint && npm run test:v2`를 실행한다. 기대: 전체 PASS
- [ ] **Step 5:** 커밋 — `style(v2): 보고서 편집기 글자 5단계·굵기 3단계·설명 문장을 상태로 대체`

### Task 9: 디자인 언어 문서와 브라우저 QA

**Files:**
- Modify: `docs/design/v2-design-language.md`(§9-3 아래에 `## 9-5. 보고서 모드 B 배치 (2026-10-20 승인 — 시안 https://claude.ai/artifact/BC55sQupgmp3qaWyoRkQQX)` 추가, 결정 이력 한 줄)

- [ ] **Step 1:** 사양 §2–§5의 규칙을 디자인 언어 문서에 옮긴다. 수치는 사양 문서에서 그대로 복사한다.
- [ ] **Step 2: 인증된 Chrome으로 운영 빌드 또는 `next dev`를 열고 확인한다(`/browse` 스킬 사용)**
  - **1440×900:** 슬라이드 너비가 1290 px 이상이다(`getBoundingClientRect`).
  - **서랍을 열고 닫을 때:** 슬라이드가 카드에 가려지지 않는다(겹침 0 px).
  - **설정 카드를 열고 닫을 때:** 마찬가지로 겹침 0 px이다.
  - **1280×800 · 390×844:** 가로 스크롤이 없다. 390에서는 서랍이 아래 시트이고 포커스를 가둔다.
  - **키보드:** Tab으로 페이지 줄에 들어가 ←/→로 이동하고, Ctrl+Shift+→로 옮긴 뒤 토스트의 되돌리기까지 확인한다. 메모 textarea에서 ←를 눌러도 페이지가 그대로다.
  - **지도:** 두 번 눌러 끌기·휠·두 번 누르기 확대 → Esc 세 번(편집 끝 → 카드 닫기 → 선택 해제)을 확인한다. 고정한 뒤 두 번 누르면 자물쇠가 강조되는지 본다.
  - **끌어 놓기:** 3쪽을 5쪽 뒤로 끌어 막대 위치와 토스트 문구 `3쪽을 5쪽 뒤로 옮겼습니다`를 확인한다.
  - **내보내기 회귀:** PPT·PDF·PNG를 한 번씩 만들고 **픽셀을 열어** 빈 이미지가 아닌지 확인한다(메모리: 내보내기 QA는 픽셀 확인).
- [ ] **Step 3:** `npm run lint && npm run test:v2`를 실행한다. 기대: 오류 0, `v2 tests: N files passed`
- [ ] **Step 4:** 커밋 — `docs(v2): 보고서 모드 B 배치·조작 규칙을 디자인 언어에 기록`

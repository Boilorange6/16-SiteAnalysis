# Task 5 보고서 — 떠 있는 무대 배치

## 상위 목표와 세션 목표

- 상위 목표: 주소 하나로 대지분석 33타일과 PPT 보고서를 자동 생성하는 웹앱의 v2 개선 > 보고서 모드 B안(떠 있는 패널)으로 슬라이드를 키우고 지도·페이지 조작을 고친다.
- 세션 목표: 보고서 모드의 3열 rail/drawer/editor grid를 없애고, 무대 위 떠 있는 도구 막대·서랍·페이지 dock·설정 카드 자리를 만들며 슬라이드를 남은 공간에 판형 비율로 맞춘다.
- 완료 조건: brief·constraints·권위 사양 준수, TDD RED/GREEN, 지정 테스트·lint·전체 `test:v2` 통과, 보고서·지정 커밋 작성.

## 결과

보고서 모드를 하나의 `.reportStage` 위에 떠 있는 카드들을 배치하는 구조로 바꿨다. 슬라이드는 `.stageFit`의 크기 컨테이너 안에서 `slideGeometry(format)`의 판형 비율을 재사용해 최대 크기로 맞춰지고, 페이지 줄 왼쪽에는 compact 레이아웃 메뉴와 메모 popover가 들어간다.

## 구현 내용

- `src/components/v2/report/report-mode.tsx`
  - `.reportBody` 안의 3열 레일·서랍·작업 공간을 `.reportStage` 하나로 교체했다.
  - 무대에 `data-drawer-open`과 Task 5 동안 고정된 `data-settings-open="false"`를 둔다.
  - `.stageFit`에 `container-type: size`, `slideGeometry(history.present.format)` 기반 CSS 변수를 주고 `.stageSlide`를 가운데 정렬한다. `MapToolbar`는 Task 6 결정대로 이번에는 기존 무대 안 위치를 유지했다.
  - 기존 페이지·타일·글상자·테마 버튼을 `.toolPill`로 옮기고 `aria-pressed`, `aria-expanded`, `aria-controls`를 유지·보강했다. `rail === "layout"` 서랍 분기도 보존했다.
  - 서랍은 `.floatCard.drawerCard`로 바꾸고 `useFocusTrap`, `data-mobile-sheet`, 닫기·복귀 흐름을 유지했다.
  - `.pageDock`의 `dockLead`에 레이아웃 메뉴와 메모 버튼을 만들었다. 레이아웃은 `aria-haspopup="menu"` + `LayoutSwitcher compact`, 메모는 `aria-haspopup="dialog"` + `NotesField compact`로 연결하고 메모가 있으면 `data-has-notes`와 점을 표시한다.
  - popover는 바깥 누르기와 Esc로 닫히며 Esc 시 연 버튼으로 포커스를 복귀한다. 기존 `isTypingTarget` 경로를 보존해 textarea의 방향키·PageUp/PageDown이 페이지를 넘기지 않는다.
- `src/components/v2/report/report-mode.module.css`
  - `.reportBody`의 3열 grid 규칙과 사용하지 않는 `.reportRail`, `.drawerColumn`, `.reportWorkspace`, `.editorSide`, `.stageFrame` 계열을 제거했다.
  - 기본 무대 여백을 `--stage-left: 88px`, `--stage-right: 24px`, `--stage-bottom: 100px`로 두고 서랍·설정 상태별 여백을 연결했다.
  - `.floatCard` 공통 모양, 180ms `cubic-bezier(.23,1,.32,1)` 진입, reduced-motion 규칙을 추가했다.
  - desktop dock은 남은 무대 폭 안에 놓고, 페이지 썸네일은 사양의 88×50 콘텐츠 크기에 맞춰 카드 높이를 줄였다. 모바일에서는 `--stage-left/right: 16px`, `--stage-bottom: 200px`, 아래 가로 도구 막대와 2줄 dock을 적용했다.
  - `.settingsCard`는 Task 6에서 state를 연결할 수 있는 동일한 float-card/모바일 시트 CSS 자리만 만들었다.
- `src/components/v2/report/notes-field.tsx`, `layout-switcher.tsx`
  - `compact?: boolean`을 추가하고 compact 모드에서 설명 문장·카드 테두리를 생략했다.
- `src/scripts/v2/test-v2-report-chrome-style.mjs`
  - 3열 제거, stage 여백·container query·판형 fit, float-card 공통 모양, mobile sheet, reduced motion, popover/compact/typing 계약을 단언한다. `run-tests.mjs`의 자동 `test-v2-*.mjs` 탐색으로 전체 회귀에 포함됐다.

## TDD 증거

### RED

구현 전에 새 테스트를 만들고 실행했다.

```text
$ npx tsx src/scripts/v2/test-v2-report-chrome-style.mjs
AssertionError [ERR_ASSERTION]: reportBody는 3열 grid를 예약하지 않는다
actual: .reportBody { display: grid; grid-template-columns: 76px minmax(260px, 312px) minmax(0, 1fr); ... }
exit 1
```

### GREEN

구현과 최종 계약 보강 뒤 같은 테스트를 실행했다.

```text
$ npx tsx src/scripts/v2/test-v2-report-chrome-style.mjs
v2 report chrome style tests passed
exit 0
```

## 검증 결과

- `npx tsx src/scripts/v2/test-v2-report-chrome-style.mjs`: PASS — `v2 report chrome style tests passed`.
- `npm run lint`: PASS — `tsc --noEmit`, exit 0.
- `npm run test:v2`: PASS — `v2 tests: 195 files passed`, exit 0. 새 테스트가 기존 194개에서 195개로 자동 포함됐다. Node `DEP0190` deprecation warning은 있었지만 실패는 없었다.
- `git diff --check`: PASS — whitespace 오류 없음. Git의 LF→CRLF 정규화 경고만 출력됐다.
- 구식 3열 클래스 검색: 실제 JSX/CSS 사용은 제거됐고, 남은 `reportRail|drawerColumn|editorSide|reportWorkspace` 문자열은 새 테스트의 “남지 않음” 정규식뿐이다.
- `ui-ux-pro-max` 점검: 떠 있는 카드가 포커스를 가리지 않도록 무대 여백·visible focus 기준을 적용하고, 모바일 bottom sheet·44px 조작 영역·reduced motion을 확인했다. 사용자의 floating-panel 취향과 “슬라이드 위를 가리지 않기” 실수 기록도 반영했다.
- 실제 화면 점검 시도: `npm run dev -- --hostname 127.0.0.1 --port 3195`에서 `/site/v2`와 `/site/v2?mode=report`는 HTTP 200이었다. Chrome/Playwright는 인증 화면에서 멈춰 인증된 보고서 무대 DOM에 진입하지 못했다. 따라서 1280px·390px의 실제 픽셀/overflow 판정은 주장하지 않는다.

## 바뀐 파일

- `src/components/v2/report/report-mode.tsx`
- `src/components/v2/report/report-mode.module.css`
- `src/components/v2/report/notes-field.tsx`
- `src/components/v2/report/layout-switcher.tsx`
- `src/scripts/v2/test-v2-report-chrome-style.mjs`
- `.superpowers/sdd/2026-10-20-report-b-layout/task-5-report.md`

## 자기 검토

- 지도 막대는 이번 Task에서 페이지 dock으로 옮기지 않았고, Task 6이 교체할 `.dockLead` 자리와 설정 카드 CSS만 준비했다.
- `data-settings-open`은 임시 `false`로 고정했으며 `DrawerMap`은 기존 `.drawerCard` 안에 남겼다.
- 새 판형 상수를 만들지 않고 기존 `slideGeometry`를 재사용했다. 슬라이드 surface·내보내기 출력물은 변경하지 않았다.
- drawer가 닫히면 `aria-hidden`·`inert`·pointer 이벤트가 함께 꺼지고, mobile open 상태에서는 기존 focus trap과 sheet close를 유지한다.
- 새 CSS 규칙은 지정된 12/13/14/20px 및 400/500/700 굵기 체계를 따랐고, 범위 밖 기존 규칙은 Task 8 대상으로 남겼다.

## 우려

- 인증 가능한 Judge 브라우저가 없어 실제 1280px에서 슬라이드가 무대 폭의 대부분을 차지하는지, 390px에서 dock·도구 막대가 슬라이드를 가리지 않는지 최종 픽셀 증거는 아직 없다. 다음 인증 QA에서 확인해야 한다.
- Task 6에서 `settingsOpen` state를 만들 때 `.settingsCard`를 실제 설정 내용으로 연결하고, 선택 지도 상태에서 `MapToolbar`를 `.dockLead`로 교체해야 한다.

## 작성 시점 `git log -1 --format=%B` 출력

```text
fix(v2): topbar로 옮긴 보고서 동작에 색 토큰·비활성 표시를 같이 적용

portal된 .reportHeaderActions는 .reportRoot 밖이라 --report-dark 등이 정의되지 않아 내보내기 버튼이 투명 바탕 흰 글자로 보이지 않았다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PL4UbX46BtRp6j2rFpJyRT
```

skill 후보: 없음
taste 후보: 없음

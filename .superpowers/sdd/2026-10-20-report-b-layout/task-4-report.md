# Task 4 보고서 — 보고서 모드 머리 줄을 앱 머리 줄 하나로 합침

## 상위 목표와 세션 목표

- 상위 목표: 주소 하나로 대지분석 33타일과 PPT 보고서를 자동 생성하는 웹앱의 v2 개선 > 보고서 모드 B안(떠 있는 패널)으로 슬라이드를 키우고 지도·페이지 조작을 고친다.
- 세션 목표: Task 4의 보고서 머리 줄을 제거하고 저장·되돌리기·다시 실행·판형·발표·내보내기를 앱 topbar portal에 연결한다.
- 완료 조건: brief·constraints·design spec 준수, TDD RED/GREEN, 지정 테스트·lint·전체 `test:v2` 통과, 보고서·커밋 작성.

## 결과

보고서 모드의 별도 `reportHeader`를 제거하고 앱 topbar의 `spacer` 뒤에 보고서 동작 portal 칸을 만들었다. 보고서 동작 묶음은 저장 상태와 되돌리기·다시 실행·판형·발표 미리보기·내보내기를 유지하며, modal 상태에서는 기존과 같은 `inert` 규칙을 적용한다.

## 구현 내용

- `src/app/v2/page.tsx`
  - `boardMode === "report"`일 때만 `spacer` 바로 뒤에 `#v2-report-actions.reportActionsSlot`을 렌더링했다.
  - 모드 탭을 `보고서` + 쪽수 배지로 바꾸고 `aria-label={`보고서, ${reportDocPageCount}쪽`}`를 추가했다.
- `src/components/v2/report/report-mode.tsx`
  - `useEffect`에서 `document.getElementById("v2-report-actions")`를 찾아 상태에 저장하고, 대상이 없으면 SSR·테스트에서 portal을 렌더링하지 않게 했다.
  - `createPortal` 안에 저장 상태, 되돌리기·다시 실행, 판형 select, 발표 미리보기, 내보내기를 함께 옮겼다.
  - portal 묶음에 `inert={modalContentInert || undefined}`를 유지했다. `exportTriggerRef`와 `ExportPanel`의 `restoreFocusRef`도 보존했다.
  - 별도 제목은 지우고 루트 안에 `<h1 className={styles.srOnly}>{summary.address} 보고서</h1>`를 남겼다.
- `src/components/v2/report/report-mode.module.css`
  - `.reportRoot`의 grid row를 `minmax(0, 1fr)` 하나로 바꿨다.
  - 죽은 `.reportHeader`, `.reportHeaderSpacer`, `.reportHeading`과 해당 responsive 규칙을 제거했다.
  - portal 밖에서도 포커스 링이 보이도록 `.reportHeaderActions :focus-visible`을 기존 규칙에 포함했다.
  - `.exportPanel`의 기준 위치를 `top: 8px`로 바꿨다(좁은 화면 override도 같은 기준으로 정리했으며, 390px 전체 화면 패널은 기존 모바일 규칙을 유지한다).
- `src/components/v2/board.module.css`
  - `.reportActionsSlot`을 `display:flex; align-items:center; gap:6px`로 추가했다.
  - `.modeCount`를 12px/500/#676c76/왼쪽 6px 배지로 추가하고, 선택 탭에서는 `#d9dce2`로 바꿔 대비를 확보했다.
- `src/scripts/v2/test-v2-tile-mode-no-report.mjs`
  - 옛 header·눈썹 제목·점 구분 쪽수의 부재를 단언한다.
  - portal import/target/effect, spacer 뒤·report mode 조건, inert 묶음, 숨은 h1, grid row, CSS 계약, 쪽수 aria-label과 배지를 단언한다.

## TDD 증거

### RED

구현 전에 새 계약 단언을 먼저 추가하고 실행했다.

```text
$ npx tsx src/scripts/v2/test-v2-tile-mode-no-report.mjs
AssertionError [ERR_ASSERTION]: ReportMode가 별도 보고서 머리 줄을 렌더링한다
    at .../src/scripts/v2/test-v2-tile-mode-no-report.mjs:82:8
exit 1
```

초기 단언의 정규식이 `styles.reportHeaderActions`까지 prefix로 잡은 것은 테스트 자체의 경계 오류였으므로 `\b` 경계를 보강한 뒤, 구현 전 RED 증거는 위 header 잔존 실패로 고정했다.

### GREEN

구현 및 최종 계약 보강 후 같은 지정 테스트를 실행했다.

```text
$ npx tsx src/scripts/v2/test-v2-tile-mode-no-report.mjs
v2 tile mode no-report tests passed
exit 0
```

## 검증 결과

- `npx tsx src/scripts/v2/test-v2-tile-mode-no-report.mjs`: PASS — `v2 tile mode no-report tests passed`.
- `npm run lint`: PASS — `tsc --noEmit`, exit 0.
- `git diff --check`: PASS — LF→CRLF 정규화 경고만 있고 whitespace 오류는 없다.
- `npm run test:v2`: PASS — `v2 tests: 194 files passed`, exit 0.
  - 전체 회귀에서 `v2 report doc plan/PPTX/doc`, export panel/export, report mode state, page strip, page style, surface, tile slides 테스트를 확인했다.
  - 기존 Node `DEP0190` deprecation warning은 출력됐지만 실패는 없었다.
- UI/UX 점검: `ui-ux-pro-max` 검색에서 portal 컨트롤의 visible focus, 배지의 의미 있는 aria label, focus obscured 기준을 확인하고 적용했다. 모든 새/기존 보고서 조작 버튼은 44px 이상 규칙을 유지한다.
- 실제 브라우저 점검 시도: 설치된 Chrome으로 dev 서버를 열었으나 `/site/v2`가 인증 없는 세션을 `/site/login?next=%2Fv2`로 리디렉션했다. `role=tab`과 보고서 화면이 생성되지 않아 1280px/390px의 실제 portal·overflow·픽셀 캡처는 검증하지 못했다. Playwright 내장 Chromium도 실행 파일이 없어 설치하지 않았다(새 의존성/설치 금지 준수).

## 바뀐 파일

- `src/app/v2/page.tsx`
- `src/components/v2/board.module.css`
- `src/components/v2/report/report-mode.module.css`
- `src/components/v2/report/report-mode.tsx`
- `src/scripts/v2/test-v2-tile-mode-no-report.mjs`
- `.superpowers/sdd/2026-10-20-report-b-layout/task-4-report.md`

## 자기 검토

- portal 대상은 보고서 모드에서만 생성되고 `spacer` 뒤에 위치한다. ReportMode effect 시점에는 같은 커밋의 topbar가 먼저 존재하며, 대상이 없으면 null로 남는다.
- 저장 상태를 portal 이동 과정에서 누락하지 않았고, export trigger ref와 focus restoration 계약을 유지했다.
- modalContentInert를 portal wrapper에 적용해 내보내기/모바일 drawer가 열릴 때 topbar 보고서 조작이 비활성화된다.
- 별도 header와 주소 제목은 제거했지만 screen reader용 h1과 topbar의 주소 제목은 남겼다.
- 선택 모드의 쪽수 배지는 기본 회색, 선택 상태는 밝은 색으로 분리해 지정 색·4.5:1 대비 요구를 함께 만족시켰다.
- 새 npm 의존성·구조 밖의 파일·슬라이드 surface/export 결과물은 변경하지 않았다.

## 우려

- 코드 계약·타입·전체 회귀는 통과했지만 인증 세션 없이 실제 Chrome에 접근할 수 없어 390px/1280px의 최종 픽셀 및 실제 portal mount는 아직 브라우저 증거가 없다. 인증 가능한 Judge 브라우저에서 Task 5·9와 함께 narrow topbar overflow 및 발표 버튼 축약을 확인해야 한다.
- 390px에서 발표 미리보기 아이콘 축약은 사용자 지시대로 Task 5·9에서 다시 검토하도록 이번 Task에서는 큰 재배치를 하지 않았다.

## 작성 시점 `git log -1 --format=%B` 출력

```text
fix(v2): 지도 편집 중 패널 흐림 선택자가 slide canvas 속성을 찾도록

data-map-editing은 surfaceRoot 안의 slide canvas에 붙는데 선택자가 surfaceRoot 자신을 찾아 흐림·grab 커서가 적용되지 않았다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PL4UbX46BtRp6j2rFpJyRT
```

skill 후보: 없음
taste 후보: 없음

# Task 3 보고서 — 지도 두 번 눌러 편집, 편집 중 조작

## 결과

보고서 편집 표면의 지도는 두 번 눌러 편집을 시작하고, 편집 중에는 기존 드래그·휠 확대와 함께 두 번 누른 위치 확대, `+`/`=`/`-` 키 확대·축소를 지원한다. 편집 중 슬라이드 canvas에는 `data-map-editing="true"`가 붙고 제목·요약·범례 패널은 흐려지며 포인터 입력을 받지 않는다.

## 구현 내용

- `src/components/v2/report/slide-surface.tsx`
  - 편집 중 지도 상호작용 컴포넌트에서 `zoomViewAt(baseViewport, view, 0.5, px, py, 3, -3)`를 호출하고 `patchRef.current(...)`로 `zoomDelta`와 `offsetM`을 기록한다. `stopPropagation()`으로 `SlidePreview`의 재진입 처리를 막는다.
  - 지도 포커스의 Enter는 `onMapMoveActive(true)`를 호출한다. 선택만 된 비-interactive 지도도 편집 표면·지도 선택 가능 조건에서만 `tabIndex={0}`과 `aria-label="${label} 지도. Enter 또는 두 번 눌러 편집합니다."`를 받는다. thumb/export에는 이 진입 조건을 전달하지 않는다.
  - 편집 중 `event.key`가 `+`/`=`이면 `+0.25`, `-`이면 `-0.25`를 적용하고 `[-3, 3]`으로 자른다. 방향키·Home 동작은 유지한다.
  - `mapActive`가 true인 slide canvas에 `data-map-editing="true"`를 설정하고, map double-click 이벤트가 이미 처리된 경우 상위 `SlidePreview`는 아무 동작도 하지 않는다.
- `src/components/v2/report/slide-surface.module.css`
  - `.surfaceRoot[data-map-editing="true"]` 범위에서 `[data-panel-key]`의 `opacity: .35`, `pointer-events: none`을 적용한다.
  - 편집 중 지도 커서를 `grab`, 실제 끌기 중을 `grabbing`으로 표시한다. CSS Modules 순수 선택자 규칙을 지키기 위해 `.surfaceRoot`를 로컬 앵커로 사용했다.
- `src/lib/v2/ui/map-edit-hint.ts`
  - 저장소 키 `v2.report.mapEditHint`, 값 `dismissed`를 사용하는 `readMapEditHintDismissed`와 `dismissMapEditHint` 두 함수를 추가했다. null 저장소와 저장소 예외는 조용히 무시한다.
- 테스트
  - surface 테스트에 canvas 식별자, 패널 흐림/입력 차단, grab/grabbing, 선택 상태 지도 포커스·안내를 추가했다.
  - report mode state 테스트에 hint 읽기·쓰기, null·예외 경로를 추가했다.

## TDD 증거

### RED

구현 전에 실행:

```text
npx tsx src/scripts/v2/test-v2-report-surface.mjs
AssertionError [ERR_ASSERTION]: 지도 편집 중인 slide canvas 식별자
exit code: 1

npx tsx src/scripts/v2/test-v2-report-mode-state.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../src/lib/v2/ui/map-edit-hint.ts
exit code: 1
```

### GREEN

구현 후 최종 변경 기준:

```text
npx tsx src/scripts/v2/test-v2-report-surface.mjs
v2 report surface tests passed

npx tsx src/scripts/v2/test-v2-report-mode-state.mjs
report mode state: PASS

npx tsx src/scripts/v2/test-v2-css-modules-pure.mjs
[css-modules-pure] 11 files PASS
[css-modules-imports] PASS

npm run lint
> site-analysis@0.1.0 lint
> tsc --noEmit
exit code: 0

npm run test:v2
v2 tests: 194 files passed
exit code: 0
```

`git diff --check`도 exit code 0으로 통과했다. Git의 LF→CRLF 정규화 경고만 있었고 whitespace 오류는 없었다.

## 변경 파일

- `.superpowers/sdd/2026-10-20-report-b-layout/task-3-report.md`
- `src/components/v2/report/slide-surface.tsx`
- `src/components/v2/report/slide-surface.module.css`
- `src/lib/v2/ui/map-edit-hint.ts`
- `src/scripts/v2/test-v2-report-surface.mjs`
- `src/scripts/v2/test-v2-report-mode-state.mjs`

## 자기 검토

- 더블클릭 확대는 지도 상호작용 컴포넌트 안에서만 확정되며 상위 canvas의 편집 진입과 중복되지 않는다.
- 확대 위치는 실제 요소 크기와 slide canvas 좌표를 환산한 뒤 휠과 동일한 `zoomViewAt` 경로를 쓴다. 키보드 확대도 동일한 최대·최소 범위를 사용한다.
- `data-map-editing`은 `SlidePreview`의 편집 canvas에만 있고 export 표면에는 `mapActive`가 전달되지 않는다. CSS는 `.surfaceRoot` 아래로 한정했다.
- Enter용 포커스는 editable + 지도 선택 가능 + non-thumb 조건으로만 노출된다. 고정 지도에서 진입을 허용할지 여부는 명세대로 Task 6의 `enterMapMove`에 남겼다.
- 새 npm 의존성·외부 파일·Obsidian vault 변경은 없다. 사용자 지정 worktree 밖은 변경하지 않았다.
- UI 작업 지침에 따라 `ui-ux-pro-max`의 키보드 포커스·focus not obscured·keyboard navigation·dragging alternative 점검을 적용했다. 지도 위에 새 떠 있는 카드를 추가하지 않았다.

## 우려 및 검증 한계

- 지정된 SSR/계약 테스트, TypeScript lint, 전체 v2 회귀는 통과했지만 실제 브라우저에서 포인터 드래그·휠·더블클릭·키보드 이벤트를 물리적으로 수행하는 별도 Playwright 세션은 실행하지 않았다. 따라서 해당 상호작용의 실브라우저 픽셀/입력 증거는 후속 Judge 브라우저 QA가 필요하다.
- 전체 회귀 중 기존 테스트의 Node deprecation warning이 출력됐지만 이번 변경에서 발생한 실패는 없었다.

## 작성 시점 `git log -1 --format=%B` 출력

```text
fix(v2): 페이지 줄 끌기 표시 막대·키보드 재배치 포커스·타일 드롭 전파·수정자 PageUp 가드

- dragover에서 보호 모드 getData 대신 dragstart에서 기억한 page id로 놓을 자리 표시
- 페이지 끌기가 아닌 드롭(타일 등)은 전파를 막지 않음
- Ctrl+Shift+화살표 재배치 뒤 같은 썸네일로 포커스 복구
- Ctrl/Alt/Shift/Meta가 눌린 PageUp/PageDown은 가로채지 않음

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PL4UbX46BtRp6j2rFpJyRT
```

taste 후보: 없음
skill 후보: 없음

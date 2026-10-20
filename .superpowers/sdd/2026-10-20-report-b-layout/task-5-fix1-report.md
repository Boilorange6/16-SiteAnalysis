# Task 5 수정 1회차 보고서 — 떠 있는 무대 배치

## 상위 목표와 완료 조건

- 상위 목표: 주소 하나로 대지분석 33타일과 PPT 보고서를 자동 생성하는 웹앱의 v2 개선 > 보고서 모드 B안(떠 있는 패널)으로 슬라이드를 키우고 지도·페이지 조작을 고친다.
- 이번 목표: 슬라이드를 남은 무대에 contain으로 맞추고, 추천 구성의 서랍 기본값·topbar overflow·390px 도구/페이지 줄 배치를 수정한다.
- 완료 조건: §1–2와 constraints 준수, CSS/상태 계약 보강, 인증 브라우저 4개 뷰포트 수치·스크린샷 확인, lint와 `test:v2` 통과, 지정 커밋 작성.

## 고친 내용

### 1. 슬라이드 contain과 무대 chrome

- `.stageFit`을 카드 배경·테두리·padding 없는 크기 컨테이너로 바꾸고 앱 배경 위에 슬라이드 surface만 띄웠다.
- `.stageSlide`는 `min(100cqw, 100cqh × 판형 비율)`로 가로·세로 중 먼저 닿는 쪽까지 확장한다. `SlideSurface` 루트의 100% width/height도 유지해 래퍼가 다시 줄이지 않도록 했다.
- 서랍이 열리면 `--stage-left: 418px`, 닫히면 `88px`을 사용하며, 페이지 dock은 남은 영역의 하단에 둔다.

### 2. rail 초기값

- `initialReportRail(hasPages)`를 추가해 페이지가 있으면 `null`, 페이지가 없으면 `"pages"`를 반환한다.
- `ReportMode`의 초기 state와 추천 구성 완료 흐름 모두 이 계약을 사용한다. 추천 14쪽으로 시작하면 서랍은 닫힌다.

### 3. topbar overflow

- report topbar에서 빈 spacer를 제거하고 제목에 160px(1361px 이상), 80px(640–1360px) 최소 폭을 배정했다.
- 1360px 이하에서는 `발표 미리보기`를 시각적으로 `발표`로 축약하고 `aria-label="발표 미리보기"`를 유지했다.
- 저장 상태는 같은 구간에서 12px 상태 점으로 축약하고, 판형 select 폭을 132px로 제한했다. 모든 누름 영역은 44px 이상이다.

### 4. 390px 배치

- report topbar DOM order를 로고·모드 탭 → 보고서 동작 → 주소/프로젝트 줄 순서로 고정했다.
- 도구 막대는 무대 위쪽 가로줄(`order: 1`), 슬라이드는 그 아래(`order: 2`), 페이지 dock은 화면 흐름 안 하단(`order: 3`)으로 바꿨다.
- report root/body를 viewport 높이에 맞춘 flex 흐름으로 바꾸고, dock에는 `overflow-x: auto` 페이지 줄을 유지했다.

## 브라우저 확인

dev 서버는 지정 worktree의 `next dev -p 3192`를 사용했다. 인증은 QA 계정으로 수행했고, `localhost`의 IPv6 rate limit을 피하기 위해 같은 서버의 `127.0.0.1:3192/site`로 접속했다. 추천 구성 14쪽에서 시작한 뒤 페이지 rail 버튼을 눌러 1440px 서랍 열림도 측정했다.

측정 배열은 `[x, y, width, height]`이며, `slide`는 `[data-slide-surface]`, `dock`은 페이지 dock, `strip`은 페이지 가로줄, `pill`은 도구 막대다.

| 뷰포트/상태 | slide | dock / strip | 도구 막대 | drawer | topbar / 문서 |
|---|---|---|---|---|---|
| 1440×900 닫힘 | `[126,96,1252,704]` | `[227,796,1050,88]` / `[399,805,869,70]` | `[16,346,56,287]` | `false` | topbar `[0,14,1440,52]`, scrollW `1440`, docW `1440` |
| 1440×900 열림 | `[418,167,998,561]` | `[418,796,998,88]` / `[590,805,817,70]` | `[16,346,56,287]` | `true` | topbar `[0,14,1440,52]`, scrollW `1440`, docW `1440` |
| 1280×800 닫힘 | `[147,96,1074,604]` | `[159,696,1050,88]` / `[331,705,869,70]` | `[40,296,56,287]` | `false` | topbar `[24,14,1256,52]`, clientW/scrollW `1256/1256`, docW `1280` |
| 390×844 닫힘 | `[16,398,358,201]` | `[16,724,358,112]` / `[25,768,340,76]` | `[16,205,358,69]` | `false` | topbar `[0,0,390,197]`, scrollW `390`, docH `844`, docW `390` |

인수 기준과의 비교:

- 1440px 닫힘 슬라이드 폭은 `1252px`로 기준 `≥1250px`를 넘는다.
- 1440px 서랍 열림은 남은 폭 기준 `1440−418−24−16=982px`보다 큰 `998px`이며, 세로 여유가 남아 가로가 먼저 닿는다.
- 1280px에서는 topbar scroll width가 client width와 같고, 안정화 후 모든 topbar button의 오른쪽 끝이 `1280px` 이하(`수치지형도 추가` right `1280`)였다.
- 390px에서는 dock bottom이 `836px`로 viewport 안이고, 문서 가로폭은 `390px`이다. 도구 줄은 슬라이드 위에 있고 페이지 strip만 가로 스크롤한다.

직접 확인한 스크린샷:

- `C:\Users\da\AppData\Local\Temp\claude\D--V-coding-16-SiteAnalysis\73274449-fecc-4108-8df5-cb19b9cb680c\scratchpad\t5-1440-closed-final.png`
- `C:\Users\da\AppData\Local\Temp\claude\D--V-coding-16-SiteAnalysis\73274449-fecc-4108-8df5-cb19b9cb680c\scratchpad\t5-1440-open-final.png`
- `C:\Users\da\AppData\Local\Temp\claude\D--V-coding-16-SiteAnalysis\73274449-fecc-4108-8df5-cb19b9cb680c\scratchpad\t5-1280-final.png`
- `C:\Users\da\AppData\Local\Temp\claude\D--V-coding-16-SiteAnalysis\73274449-fecc-4108-8df5-cb19b9cb680c\scratchpad\t5-390-final.png`

1440px 닫힘/열림 모두 별도 회색 무대 카드가 슬라이드를 감싸지 않고 앱 배경이 주변에 보이며, 열린 서랍이 슬라이드를 가리지 않는다. 1280px은 주소 제목이 말줄임되고 `발표`·저장 점·수치지형도 버튼이 한 줄 안에 들어간다. 390px은 보고서 동작 줄이 모드 탭 아래, 도구 막대가 슬라이드 위, 페이지 줄이 하단에 보인다.

## 계약 및 테스트

- `src/scripts/v2/test-v2-report-chrome-style.mjs`에 stageFit chrome 제거, cqw/cqh contain, 좁은 topbar 축약, 초기 rail, 모바일 도구/dock 흐름 계약을 추가했다.
- `src/scripts/v2/test-v2-report-mode-state.mjs`의 초기 rail 기대값을 페이지 존재 여부 계약으로 갱신했다.
- `npx tsx src/scripts/v2/test-v2-report-chrome-style.mjs`: PASS — `v2 report chrome style tests passed`.
- `node src/scripts/v2/test-v2-report-mode-state.mjs`: PASS — `report mode state: PASS`.
- `npm run lint`: PASS — `tsc --noEmit`, exit 0.
- `git diff --check`: PASS — whitespace 오류 없음. LF→CRLF 정규화 경고만 출력됐다.
- `npm run test:v2`: PASS — `v2 tests: 195 files passed`, exit 0. 최종 실행의 D2Q9 측정은 `21615ms`, hard ceiling `40000ms` 이하였다.

첫 전체 실행에서는 누적 실행 부하로 D2Q9가 `44291ms`가 되어 중단됐지만, 단독 재실행은 `20774ms`로 통과했고 최종 전체 재실행도 통과했다. 이 변동성은 기능 변경이 아닌 기존 성능 게이트의 환경 민감도다.

ui-ux-pro-max 점검에서 확인한 기준은 44px 조작 영역, 문서 가로 overflow 금지, 페이지 strip에만 제한된 가로 스크롤, 떠 있는 카드가 슬라이드·포커스를 가리지 않는 무대 여백, reduced-motion 계약이다. 기존 디자인 취향의 절제된 카드/회색 앱 배경을 유지하고 작은 화면에서는 줄 순서와 가시성을 우선했다.

## 바뀐 파일

- `src/components/v2/board.module.css`
- `src/components/v2/report/report-mode.module.css`
- `src/components/v2/report/report-mode.tsx`
- `src/lib/v2/ui/report-mode-logic.ts`
- `src/scripts/v2/test-v2-report-chrome-style.mjs`
- `src/scripts/v2/test-v2-report-mode-state.mjs`
- `.superpowers/sdd/2026-10-20-report-b-layout/task-5-fix1-report.md`

## 우려

- 전체 회귀의 D2Q9 성능은 실행 부하에 따라 20.8–44.3초로 흔들릴 수 있으나, 최종 전체 실행은 21.6초로 통과했다.
- 이번 수정은 report chrome 배치와 초기 rail에 한정했다. 실제 PPT 내보내기 산출물의 렌더링·네이티브 지도 조작은 기존 계약 범위로 유지했으며, 별도 변경하지 않았다.

## 커밋 시점 `git log -1 --format=%B`

```text
fix(v2): 보고서 무대에서 슬라이드를 남은 영역에 꽉 맞추고 서랍 기본 닫힘·머리 줄 넘침·390 페이지 줄 수정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PL4UbX46BtRp6j2rFpJyRT
```

skill 후보: 없음
taste 후보: 없음

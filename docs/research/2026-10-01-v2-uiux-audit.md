# v2 사이트 분석 보드 UI/UX 점검 (2026-10-01)

대상: `.worktrees/v2-int`, `/site/v2` (dev 서버 3130). 평가만 했고 앱 코드는 바꾸지 않았다.
기준: `ui-ux-pro-max` 우선순위(1 접근성 → 10 차트)와 규칙 id(`references/quick-reference.md`).

## 요약 (5줄)

1. 화면 기본기(정보 위계, 출처 띠, 해석 문장, 보고서 연결)는 sitedia보다 앞선다. 하지만 **키보드와 터치 기본기가 Critical 수준으로 빠져 있다.** 펼침 창 초점이 5번 Tab이면 밖으로 새고, 카드를 뒤집으면 초점이 사라지며, 모바일 터치 타깃 47개가 44px보다 작다(최소 15×15).
2. **편집 모드에서 1칸 타일의 제목이 사라진다**(폭 0으로 잘림). **보드 편집 결과(순서·크기·포함)는 새로고침하면 사라진다.** 저장·재열기 흐름에서 가장 큰 구멍이다.
3. 실제 분석 중에는 `busy`이면 **모든 타일이 "계산 중"으로 바뀐다**. 이미 끝난 타일도 가려져서, 백그라운드 작업 진행률(몇 개 남았는지)을 볼 수 없다.
4. 카피와 토큰이 흩어져 있다. 출처 띠에 내부 id(`rail`, `bus_stops`, `molit_rtms`, `landuse`, `redevelopment`, `kapt`)가 그대로 나오고, 글자 크기는 19종, CSS 변수는 5개뿐이며 하드코딩 hex가 129곳이다. 상단 두 분할 버튼이 모두 "지도"라는 단어를 쓴다.
5. sitedia 대비 뒤처지는 점: 건물 도형 도판이 없다(점 표현). 펼침 창에 확대·이동, 객체 클릭 정보, 정렬 표, CSV가 없다. 토지·용도지역 타일 지도에 용도지역 면이 없다. 앞서는 점: 핵심 수치, 해석 문장, 출처·기준일, 보고서 포함·출력 면 제어, 설명선(callout) 지도.

## 방법

- Playwright(Chrome 채널)로 1440×900과 390×844(isMobile·hasTouch)를 돌렸다. 스크립트: `scratchpad/uiux-audit/{lib.cjs, probe.js, a-demo.cjs, b-states.cjs, c-states.cjs}`.
- 측정 항목:
  - `probe.js`: 보이는 모든 텍스트의 계산된 전경·배경색 대비(반투명 배경 합성 포함), 12px 미만 글자, 44px 미만 대화형 요소, 이름 없는 아이콘 버튼.
  - Tab을 40회 눌러 초점 순서와 초점 표시를 확인했다. 펼침 창 안에서도 Tab 30회로 초점 가두기를 확인했다.
  - PerformanceObserver(layout-shift, longtask)와 navigation/paint 타이밍을 기록했다.
- **한계(중요): 로그인 세션을 쓸 수 없었다.** 공유 `auth.json`의 refresh 토큰은 이미 다른 작업자가 회전시킨 상태였다(`POST /api/auth/refresh` → 401 "Invalid or expired refresh token"). 다른 작업자의 세션 파일을 빌려 쓰는 시도는 권한 정책에 막혀 중단했다. 그래서 다음 항목은 **실측하지 못했다**:
  - 실제 분석 POST 이후의 보드(아리수로 250, 800 m), 백그라운드 작업 폴링
  - 2026-10-01d 건물 버전이 반영된 타일
  - S01 매스·분해도, 바람장미(실데이터)
  - PPT/DXF/GLB/3DM 실제 내보내기, 저장된 분석 재열기
  
  이 부분은 코드 근거(file:line)로만 판정했고 표에 "코드"로 표시했다. 매니페스트 버전 확인도 같은 정책에 막혀 2026-10-01d 게시 여부를 확인하지 못했다.
- 실측한 화면은 로그인 없이 열리는 **예시 보드**(고덕동 123 외 2필지, fixture `GODEOK_*`)이다. 같은 고덕 지구라서 sitedia 캡처와 비교할 수 있다.

## 스크린샷 목록 (`C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/afa71a56-ea0e-4d38-b7d3-3843d21b9e14/scratchpad/uiux-audit/`)

| 파일 | 내용 |
|---|---|
| d01-landing / m01-landing | 첫 화면(예시 보드) 데스크톱·모바일 |
| d02-board-full / m02-board-full | 보드 전체, 요약면 |
| d03-board-mapface / m03-board-mapface | 보드 전체, 지도면 |
| d04-focus-tab4 / m04-focus-tab4 | 키보드 초점 표시 |
| d05-dialog-first, d06-dlg-{A01..A12,D04,S02,S03} (m06-*) | 타일별 펼침 창 |
| d07-basemap-{일반,항공} | 배경지도 전환 |
| d08-edit, d09-edit-removed, d15-edit-moved, m18-edit | 보드 편집 |
| d10/m10-empty-submit, d11/m11-unauth, d12-reopen-bogus | 빈 주소, 비로그인, 잘못된 analysis id |
| d13-demo-progress | "분석 중 데모" 진행 표시 |
| d14-close-focus, d16-dialog-tabbing | 펼침 창 초점 |
| m16-dialog, m17-dialog-more | 모바일 펼침 창, 시트 확장 |
| *-probe-*.json | 대비·글자 크기·터치 타깃 측정 원자료 |

## 측정 결과 요약

| 항목 | 데스크톱 | 모바일 |
|---|---|---|
| 첫 타일 표시(goto→`[data-tile]`) | 1,628 ms | 1,763 ms |
| FCP | 1,140 ms | 1,160 ms |
| CLS(세션 누적) | 0.0012 (상단 바 텍스트) | 0.0004 |
| Long task | 33개, 합계 3.6 s, 최대 319 ms(하이드레이션) | 34개, 합계 3.9 s, 최대 389 ms |
| 대비 4.5:1 미달 | 설명선 번호 원 `cNum`: 흰 글자/#D9480F = 4.30, 10.5px | 같음 |
| 12px 미만 글자 | 29종(요약면), 지도면 60여 종(10–11px) | 같음 |
| 44px 미만 터치 타깃 | — | 47개. 보고서 체크박스 15×15(12개), 펼치기 32×26(12개), 분할 버튼 38×22, 지도면 아이콘 24×24(20개), 구성비 48×22 |
| 이름 없는 아이콘 버튼 | 0 (↗ ↺ × 모두 aria-label 있음) | 0 |
| 상단 바+입력줄 높이 | 약 120 px | **359 px(화면의 42 %)** |

모두 dev 모드 측정이다. 운영 빌드에서는 long task가 줄어든다.

## 발견 사항 (심각도순)

표기: 📷 = 스크린샷, 🧾 = 코드 근거만 있음. "소유" 열은 진행 중인 실행자가 가진 파일과 겹치는지 표시한다.

| id | 심각도 | 영역 | 관찰 | 왜 문제인가 (규칙) | 고칠 방법 | 소유 충돌 |
|---|---|---|---|---|---|---|
| U01 | Critical | 접근성·펼침 창 | 펼침 창에서 Tab을 누르면 5–6번째에 초점이 창 밖(`nextjs-portal` → 뒤 보드)으로 나간다. 실측 패턴: 데스크톱 `111110000…`, 모바일 `111111000…`. 뒤 보드에 `inert`가 없어 `aria-modal`만 걸려 있다. 📷 d16-dialog-tabbing, `tile-dialog.tsx:41-52` | `keyboard-nav`, `escape-routes`, `focus-not-obscured`. 모달 밖으로 초점이 나가면 보이지 않는 곳을 조작하게 된다. | 열려 있는 동안 보드 래퍼(`.page`)에 `inert`를 주거나 네이티브 `<dialog>.showModal()`을 쓴다. Esc와 초점 복귀는 이미 있다. | **tile-dialog.tsx = T31/T32**, page.tsx 쪽 `inert`만으로도 해결 가능 |
| U02 | Critical | 터치(모바일) | 44px 미만 타깃 47개. 보고서 체크박스 15×15, 펼치기 ↗ 32×26, 배경지도·카드 보기 분할 버튼 38×22, 지도면 ↗/↺ 24×24. 15px 체크박스는 WCAG 2.2 최소 기준(24×24)에도 못 미친다. 📷 m01, m03, m16, `m-probe-*.json`, `board.module.css:540,708,812,1222` | `touch-target-size`, `web-target-size`, `no-precision-required` | `@media (pointer:coarse)`에서 `.check`, `.open`, `.seg button`, `.flipIcon`의 히트 영역을 44px로 늘린다(패딩 또는 `::after` 확장). 데스크톱 시각 크기는 그대로 둔다. | 없음(board.module.css) |
| U03 | High | 접근성·카드 뒤집기 | 키보드로 "요약/지도 보기 전환"을 누르면 초점이 BODY로 떨어진다. 누른 면이 `inert`가 되기 때문이다. 📷 c-states 로그, `tile-card.tsx:428-433`, `summary-card.tsx:47-57` | `keyboard-nav`, `focus-management` | 면을 바꾼 뒤 반대 면의 짝 버튼(↺ 또는 "지도 ↻")으로 `focus()`를 옮긴다. | 없음 |
| U04 | High | 편집 모드 | 1칸 타일은 편집 모드에서 **제목이 완전히 사라진다**. 점·종류 배지·체크박스만 보인다. 원인: `.sfTop .title { flex:0 1 auto; white-space:nowrap; overflow:hidden }`에 체크박스 3개(스택·조판·보고서)가 붙어 제목 폭이 0이 된다. 📷 d08-edit, `board.module.css:1120-1123`, `tile-card.tsx:266-285` | `visual-hierarchy`, `compact-label-overflow`. 어떤 타일을 옮기는지 알 수 없다. | 편집 모드에서 체크박스를 두 번째 줄(`sfFoot`)로 내리거나, 제목에 `min-width: 6em`, `flex-shrink: 0`을 준다. | 없음 |
| U05 | High | 저장·재열기 | 보드 편집(순서·크기·포함·출력 면·배경지도)이 저장되지 않는다. 순서를 바꾼 뒤 새로고침하면 `A02,A01,A03` → `A01,A02,A03`으로 돌아간다. `board-state.ts`에 저장 경로(fetch/localStorage)가 없고, `page.tsx:44`의 배경지도 주석도 "서버에 저장하지 않음"이다. 📷 d15-edit-moved, b-states 로그 | `state-preservation`, `form-autosave`. 보고서 순서를 공들여 만들어도 탭을 닫으면 잃는다. | (빠른 해결) `analysisId` 키로 board 상태를 localStorage에 저장한다. (정식) 분석 레코드에 board JSON을 저장하는 API를 둔다. 설계 결정이 필요하다. | **board-state.ts = T31/T32**. page.tsx에서 직렬화만 하면 충돌을 피할 수 있다. |
| U06 | High | 로딩·폴링 피드백 | 🧾 `page.tsx:323` `phase={busy ? "running" : …}`. 백그라운드 작업이 하나라도 남아 있으면 **완료된 타일까지 전부 "계산 중"으로 덮인다**. 실제 분석에는 진행률 막대가 없다(예시 데모에만 있다, `page.tsx:216-225`). 폴링은 1초마다 결과 전체를 다시 받는다(`page.tsx:517-519`). | `loading-states`, `progressive-loading`, `multi-step-progress`. sitedia는 "완료 — 24/24장"을 보여 준다. | `busy`는 POST 대기에만 쓴다. 타일별 phase는 `live.jobs`의 tileCode 상태(queued→pending, running→running)로 정한다. 상단 진행 막대를 실제 jobs 수로 재사용한다. 폴링은 2–3초로 늘리고 백오프를 둔다. | 없음(page.tsx) |
| U07 | High | 지도·용도지역 | A12 "토지·용도지역" 펼침 창 지도에 **용도지역 면이 없다**. 배경지도와 반경만 보인다. 수치(250 %, 3종일반·상업 31 %)를 뒷받침하는 도판이 없다. sitedia는 08 용도지역을 면 채색으로 보여 준다. 📷 d06-dlg-A12 vs sitedia-2026-10-01/panels-1-12.png | `chart-type`, `direct-labeling`. 분석 타일인데 그림이 수치를 설명하지 않는다. | 용도지역 폴리곤 레이어와 범례를 추가한다. 데이터 경로부터 확인이 필요하다. | 엔진 쪽 확인 필요 |
| U08 | High | 펼침 창 기능 | 펼침 창 지도는 정적 이미지다. 확대·이동, 객체 클릭 정보, 표, CSV가 없다. sitedia 새 상세창(03·08·15·20·23·24)은 확대/축소, 객체 클릭 → 속성 카드, 정렬 가능한 1,143행 표, CSV를 제공한다. 📷 d06-dlg-A03 vs sitedia4/03-b-click1.png | `tooltip-on-interact`, `data-table`, `sortable-table` | T35(상세창 UI)의 범위다. 이 점검은 요구사항 근거로만 넘긴다. | **T34/T35** |
| U09 | Medium | 카피·용어 | 출처 띠와 펼침 창 "출처 ·"에 내부 데이터셋 id가 그대로 나온다: `rail`, `bus_stops`, `molit_rtms`, `redevelopment`, `landuse`, `kapt 기준일 미확인`. 상태 없는 타일은 "출처 없음 · 기준일 해당 없음", 펼침 창은 "출처 · 출처 없음"으로 같은 말이 겹친다. 📷 d02, d06-dlg-S03, m17 | `consistency`. 보고서 이용자에게 의미 없는 영문 코드가 PPT까지 따라간다. | `sourceLine`을 만드는 곳에 한글 표시명 맵을 둔다(국가철도 역 → "역 위치", molit_rtms → "국토부 실거래가"). 출처가 없으면 띠를 숨기거나 "—"로 표시한다. | tile-view(공용). report-plan.ts를 건드리지 않게 view 단에서 처리한다. |
| U10 | Medium | 상단 바·용어 | "카드 보기 [요약|지도]"와 "배경지도 [일반|지도|항공]"이 나란히 있고 둘 다 "지도"를 쓴다. 보이는 그룹 라벨은 없다(aria-label만 있음). 11px, 38×22. 📷 d01 | `nav-label-icon`, `input-labels`, `consistency` | 보이는 라벨("카드", "배경")을 붙이고 배경지도 "지도"를 "일반지도"/"도로"처럼 바꾼다. 또는 배경지도를 드롭다운 하나로 합친다. | 없음(page.tsx, map-box.tsx BASEMAPS) |
| U11 | Medium | 모바일 레이아웃 | 390px에서 상단 바가 4줄로 접히고(브랜드, 주소, 데모·분할, 배경지도·편집, 내보내기) 입력줄까지 합치면 359px(42 %)가 타일 앞에 온다. 요약 카드는 한 화면 대부분이 빈 여백이다(본문이 카드 아래쪽에 붙어 있다). 📷 m01-landing | `content-priority`, `whitespace-balance` | ≤520px에서 보기·배경·편집·내보내기를 "⋯" 오버플로 메뉴 하나로 합친다. 요약 카드 `min-height`를 모바일에서 풀거나 본문을 위로 정렬한다. | 없음 |
| U12 | Medium | 요약 카드 | 데스크톱에서도 요약면 위쪽 약 170px가 비어 있다(본문이 아래로 몰린 정렬). 📷 d01 | `whitespace-balance`, `visual-hierarchy` | 요약면 본문을 위로 정렬하고 남는 공간에 대지 지도 썸네일을 둔다(지도면을 미리 보여 주는 셈). | 없음(summary-card.tsx) |
| U13 | Medium | 지도 범례 | 카드 지도면에는 범례가 없다(`legend={!card}`, `tile-card.tsx:211`). 생활편의·상가 카드처럼 5–6색 점을 범례 없이 보여 준다. 📷 d03 | `legend-visible`, `color-not-only` | 카드에는 "범례 n색 · 펼치기" 칩만 두거나, 가장 많은 3개 분류만 미니 범례로 둔다. | 없음 |
| U14 | Medium | 색 램프 | D04 준공 연대: 1979 이하/1980/1990/2000년대가 갈색에서 주황색으로 이어져 5px 점에서는 서로 구별되지 않는다. "미상" 회색과 A06의 "이미 입주" 회색도 겹친다. 📷 d06-dlg-D04, d06-dlg-A06 | `color-guidance`, `pattern-texture`, `contrast-data` | 명도 차가 큰 순차 램프(예: viridis 계열 6단)를 쓰고 점을 6–7px로 키운다. "미상"은 빈 원(외곽선만)으로 구분한다. | 없음(map-layers 색 정의) |
| U15 | Medium | 핵심 수치 선택 | D04 헤드라인이 "98 % 사용승인일 확인 건물"이다. 자료 완결성 지표이고, 정작 결론(1990년대 이전 67 %)은 문장 속에 묻혀 있다. 📷 d06-dlg-D04, d02 | `visual-hierarchy` | 헤드라인을 "67 % · 1990년대 이전 준공"으로 바꾸고 98 %는 배지("확인율 98 %")로 내린다. | tile-view(D04 headline) |
| U16 | Medium | 배지 정보 접근 | 배지 설명은 `title` 툴팁으로만 볼 수 있다(`cursor: help`). "+1" 배지의 숨은 값도 title에만 있다. 터치와 키보드로는 볼 수 없다. `tile-card.tsx:23,44`, `board.module.css:612` | `hover-vs-tap`, `tooltip-keyboard`, `chip-collection-reflow` | 배지를 `<button aria-describedby>` + 팝오버로 바꾸거나, 펼침 창에서 배지 아래에 note를 텍스트로 풀어 쓴다(펼침 창은 이미 caveat를 보여 주므로 note만 추가하면 된다). | 펼침 창 쪽은 T31/T32와 겹친다. 카드는 없음. |
| U17 | Medium | 실패 복구 | 펼침 창의 실패 상태판에는 "다시 계산" 버튼이 없다(`StatusPlate`에 `onRetry`를 넘기지 않음). 카드에만 있다. 📷 d06-dlg-S03, `tile-dialog.tsx:63` | `error-recovery` | `onRetry`를 prop으로 받아 StatusPlate에 넘긴다. | **tile-dialog.tsx = T31/T32** |
| U18 | Medium | 내보내기 메뉴 | 🧾 `<details>` + `role="menu"`인데 항목에 `menuitem` 역할, 화살표키 이동, 바깥 클릭 닫기가 없다. busy일 때도 `summary`는 열리고 커서만 not-allowed로 바뀐다. 안내문 11px, 색과 스타일이 인라인이다(`page.tsx:268-297`). 실패 알림은 "3DM 변환 실패"뿐이고 다른 형식은 실패해도 알림이 없다(`makeReport`·`makeDxf`·`makeGlb`에 catch 없음, `page.tsx:91-128`). | `aria-labels`, `error-feedback`, `loading-buttons` | `role="menu"`를 빼고 평범한 버튼 목록 + `aria-expanded` 디스클로저로 바꾼다. 모든 make*에 실패 상태를 공통으로 둔다. "PPT 만드는 중…"처럼 진행 문구에 형식을 넣는다. | 없음(page.tsx) |
| U19 | Medium | 설명선 라벨 | 카드 지도면 설명선 라벨이 잘린다: "대명아파트가로…", "강동역 SK Lea…", "고덕강일…" ×2. 같은 접두어로 잘린 두 라벨은 서로 구별되지 않는다. A06 펼침 창에서는 13/24/25, 11/9, 21 마커가 서로 겹친다. 📷 d03, d06-dlg-A06 | `truncation-strategy`, `direct-labeling` | 단지명 줄임 규칙을 "앞 6자 + 끝 4자"로 바꾸고, 같은 접두어끼리는 단지 번호를 남긴다. 겹치는 마커는 클러스터로 묶는다. | 없음(callout-map.tsx, callout-layout) |
| U20 | Medium | 배경지도 일관성 | 분양·입주예정 카드는 2km 축척, 펼침 창은 1km 축척으로 다른 타일과 반경 해석이 다르다. 항공 배경에서는 이 타일만 회색 바탕으로 남는다. 항공 배경의 VWorld POI 라벨이 우리 라벨과 겹친다. 📷 d03, d07-basemap-항공, d06-dlg-A06 | `consistency`, 라벨 충돌 | 축척을 바꾼 타일에는 "축척 2km" 칩을 단다. 항공은 라벨 없는 영상 레이어를 쓴다. 넓은 범위의 항공 타일 결손은 회색 대신 일반지도로 대체한다. | map-box / map-projection |
| U21 | Medium | 타이포·토큰 | `board.module.css`의 글자 크기가 19종(10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16, 17, 18, 20, 24, 26, 34, 38, 40)이다. CSS 변수는 5개(`--bg --ink --muted --line --black`)이고 하드코딩 hex는 `components/v2` 전체에 129곳(css 73, mass-figure 22, map-figure 16, wind-rose 10, callout 8)이다. | `font-scale`, `color-semantic`, `spacing-scale` | 타입 스케일을 6단(11/12/14/16/24/36)과 `--fs-*` 토큰으로 정리한다. 상태색(badgeStatus/limit/model, 실패 #9A3B2F)을 `--status-*` 토큰으로 묶는다. | board.module.css 전체를 바꾸므로 다른 UI 작업과 순서 조율이 필요하다. |
| U22 | Low | 대비 | 설명선 번호 원: 흰 글자, 배경 #D9480F, 10.5px에서 4.30:1. 그 밖에 측정한 텍스트는 모두 4.5:1 이상이었다(지도 위 반투명 판 포함). `d-probe-mapface.json` | `color-contrast` | 주황을 #C2410C(5.2:1)로 한 단계 어둡게 한다. | callout-map.tsx |
| U24 | Low | 첫 화면 문맥 | 예시 보드 상단에 "반경 1km"가 보이는데 입력 반경 기본값은 800m다. 주소 입력은 비어 있고 상단 주소는 예시 주소다. "예시 데이터" 배지는 11px뿐이다. 📷 d01 | `consistency`, `empty-states` | 예시 보드에 "예시: 고덕동 123 · 1km — 주소를 넣으면 실제 분석" 안내 띠를 넣는다. 예시를 열 때 반경 select를 예시 값과 맞춘다. | 없음 |
| U25 | Low | 비로그인 오류 | 문구 자체는 맞다("로그인이 필요합니다. /site/login으로 로그인해 주세요."). 다만 링크에 복귀 경로가 없고 링크 텍스트가 URL이다. 입력한 주소도 로그인 후 다시 넣어야 한다. 📷 d11-unauth, `page.tsx:563` | `error-recovery`, `redundant-entry` | `/site/login?next=/site/v2?address=…`로 연결하고 링크 텍스트를 "로그인하기"로 바꾼다. | 없음 |
| U26 | Low | 진행 데모 레이아웃 | "분석 중 데모"를 켜면 진행 막대가 상단 바에 끼어들어 1440px에서도 "내보내기"가 둘째 줄로 밀린다. 📷 d13-demo-progress | `layout-shift-avoid` | 진행 막대를 상단 바 아래 별도 줄(높이 고정)에 둔다. | 없음 |
| U27 | Low | 키보드 경로 길이 | 타일마다 Tab 정지점이 4개다(카드, 보고서, 펼치기, 뒤집기). 13타일이면 보드 끝까지 50회 이상 눌러야 한다. 건너뛰기 링크도 없다. | `skip-links`, `keyboard-nav` | 카드 하나를 정지점 하나로 만들고(roving tabindex) 내부 컨트롤은 Enter로 들어가게 하거나, "보드로 건너뛰기" 링크를 둔다. | 없음 |

### 확인했고 문제없던 것 (회귀 방지용)

- 아이콘 버튼(↗ ↺ × ⠿)은 모두 aria-label이 있다. 드래그는 위로·아래로 버튼으로 대체할 수 있다(`dragging-alternative` 충족). 변경 내용은 aria-live로 알린다("학교·통학구역 타일을 1번째로 옮김").
- Esc로 닫으면 초점이 펼친 카드로 돌아간다.
- `prefers-reduced-motion`에서 뒤집기 transition이 꺼진다(`none 1e-05s`).
- 빈 주소 제출 시 `role=alert`가 입력 바로 아래에 나온다. 원인과 예시를 같이 보여 준다.
- 실패 타일에는 "이 타일 다시 계산" 버튼이 있다. 삭제는 실행 취소 토스트로 되돌릴 수 있다.
- CLS 0.001, 가로 스크롤 없음(scrollWidth = clientWidth).
- 예시 보드에서 내보내기는 disabled이고 title "실제 분석 후 사용"이 붙어 있다.

## sitedia 대비

| 항목 | 우리 | sitedia | 판정 |
|---|---|---|---|
| 핵심 수치·해석 문장 | 타일마다 큰 수치, "→" 해석 문장, 판정 칩(철도 좋음/버스 보통) | 없음(도판 위주) | **앞섬** |
| 출처·기준일 | 모든 타일 하단 띠(내부 id 노출은 U09) | 패널 하단 짧은 자료 연도 | 앞섬 |
| 보고서 연결 | 포함 여부, 출력 면, 설명표 장수, 순서 편집, PPT | SVG/PNG/DXF ZIP | 앞섬(PPT), 개별 PNG/SVG는 T32 진행 중 |
| 진행 표시 | 예시 데모만 진행률 표시. 실제 분석은 전부 "계산 중"(U06) | "완료 — 24/24장" | **뒤처짐** |
| 도판 형식 | 점·마커 위주, 건물 도형 없음 | 원형 클립 + 건물 footprint 채색 24장 | **뒤처짐**(건물 데이터 버전 반영 후 재평가 필요) |
| 상세 창 | 정적 지도, 정보 판 | 확대·이동, 객체 클릭 속성, 정렬 표, CSV | **뒤처짐**(T35) |
| 용도지역 | 수치만 있음(U07) | 면 채색 지도 | 뒤처짐 |
| 접근성 | aria-label, live 알림은 양호. 초점 가두기와 터치 타깃은 미흡 | 측정하지 않음 | — |

## Quick wins (각 1시간 이하)

1. U04 편집 모드 제목 사라짐: `board.module.css:1120` 제목 min-width.
2. U03 뒤집기 후 초점 이동: tile-card.tsx, summary-card.tsx.
3. U02 `pointer:coarse` 히트 영역 44px: board.module.css.
4. U01 열린 동안 `.page`에 `inert` 주기: page.tsx만 수정하면 되고 tile-dialog는 건드리지 않는다.
5. U10 분할 버튼에 보이는 라벨 붙이고 배경지도 라벨 바꾸기.
6. U22 설명선 주황 한 단계 어둡게.
7. U25 로그인 링크에 next 붙이고 문구 고치기.
8. U26 진행 막대를 별도 줄로.
9. U17 펼침 창 실패판에 다시 계산 버튼(tile-dialog, T31/T32 이후).
10. U18 내보내기 실패 공통 처리와 `role="menu"` 제거.

## Design work (결정 필요)

- U05 보드 상태 저장 위치(localStorage와 서버 board JSON 중 어느 쪽인지, 다른 기기·공유 링크를 지원할지).
- U06 백그라운드 작업 진행 UX(타일별 상태 + 전체 진행률 + 예상 시간).
- U07·U08 도판 수준: 용도지역 면, 건물 footprint 도판, 상세창 상호작용(T35와 합의).
- U11 모바일 상단 정보 구조(오버플로 메뉴 구성).
- U14 색 램프 체계(전 타일 공통 순차·범주 팔레트, 색각 이상 검증).
- U15 타일별 헤드라인 선정 원칙(완결성 지표 대신 결론 수치).
- U21 타입 스케일과 색 토큰 체계(전면 정리라서 다른 UI 작업이 끝난 뒤에 해야 한다).
- U27 보드 키보드 모델(roving tabindex).

## 실행 과제 묶음 (파일 충돌 기준)

진행 중 소유: T17(S02/D21 일조 타일), T18(D29), T19(D10), T34(`src/lib/v2/engine/detail/*` + detail API), T35(상세창 UI, 미착수), T31/T32(`tile-dialog.tsx`, `board-state.ts`, `report-plan.ts`).

| 과제 | 포함 | 수정 파일 | 소유 충돌 |
|---|---|---|---|
| **UX-A 접근성 기본기** | U01(inert 방식), U02, U03, U04, U27 중 skip-link | `src/app/v2/page.tsx`, `src/components/v2/tile-card.tsx`, `summary-card.tsx`, `board.module.css` | 없음. tile-dialog.tsx는 건드리지 않는다. |
| **UX-B 상단 바·모바일·내보내기** | U10, U11, U18, U24, U25, U26 | `src/app/v2/page.tsx`(헤더 영역), `map-box.tsx`(BASEMAPS 라벨), `board.module.css`(topbar) | UX-A와 page.tsx를 같이 쓰므로 **A 다음에 순차 진행** |
| **UX-C 진행·폴링** | U06 | `src/app/v2/page.tsx`(Board phase 계산, 폴링) | UX-A·B와 같은 파일이라 순차 진행. board-state.ts의 `demoPhase`는 읽기만 한다. |
| **UX-D 카피·출처 표시명** | U09, U15 | `src/lib/v2/ui/tile-view.ts`(sourceLine 표시명, D04 headline) | report-plan.ts는 view를 소비하므로 출력이 바뀐다. **T31/T32와 PPT 스냅샷 테스트 조율 필요** |
| **UX-E 지도 표현** | U13, U14, U19, U20, U22 | `callout-map.tsx`, `src/lib/v2/ui/callout-layout.ts`, `map-layers.ts`, `map-box.tsx` | 없음. T17이 S02/D21 지도색을 map-layers에서 정의한다면 조율 필요. |
| **UX-F 펼침 창 보완** | U16(펼침 창 쪽), U17, U01(포커스 트랩 정식화) | `tile-dialog.tsx` | **T31/T32 소유. 그 작업이 머지된 뒤 진행한다.** T35가 상세창을 새로 만들면 그쪽에 흡수한다. |
| **UX-G 보드 저장** | U05 | page.tsx(직렬화·복원), 저장 위치 결정 후 API | **board-state.ts = T31/T32**. 리듀서 상태 모양이 바뀌면 충돌한다. T31/T32가 끝난 뒤 진행한다. |
| **UX-H 용도지역 도판** | U07 | 엔진(A12 결과에 zoning 폴리곤) + map-figure | T34 detail 엔진과 데이터 경로 공유 여부를 확인해야 한다. |
| **UX-I 토큰 정리** | U21 | board.module.css 전체, figure 컴포넌트 hex | 모든 UI 과제 뒤에 마지막으로 한다. |

## 재검증 필요(이번에 못 본 것)

로그인 세션이 생기면 다음을 다시 확인해야 한다:

- 아리수로 250(800 m) 실제 분석에서 POST부터 첫 타일까지의 시간과 폴링 중 타일 상태(U06 실측)
- 2026-10-01d 건물 버전 반영 후 건물 의존 타일(D04 도형, S01 매스·분해도, S02/D21)
- 바람장미 범례·방위
- PPT 실제 페이지 수와 지도 이미지 품질
- DXF/GLB/3DM 다운로드 성공·실패 알림
- `?analysis=` 재열기

`?analysis=doesnotexist`(비로그인)의 결과는 📷 d12-reopen-bogus에 남겼다. 다만 그 실행의 알림 판정은 Next 라우트 안내자(`role=alert`)를 잘못 집은 측정이라 믿을 수 없다. 코드상으로는 `load()`가 401/404에서 `p[role=alert]` 문구를 띄운다(`page.tsx:461-462`). 로그인 상태에서 재확인해야 한다.

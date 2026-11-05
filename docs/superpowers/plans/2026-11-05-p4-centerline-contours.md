# 지도 라벨·지도 표현·자료 보강 P4 — 도로중심선(E1)·등고선(E2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국토지리정보원 연속수치지형도 도로중심선(VWorld 다운로드 dsId 30182)과 등고선(dsId 30185)을 전국 reference에 적재하고, D17은 원본 5 m 등고선과 그 선으로 다시 만든 상대고 면을 그리며(Q10 c), D13은 `rvwd` 정의·채움률을 확인한 뒤 사용자가 고르면 모든 분석에 폭을 붙인다(Q8 c 2단계).

**Architecture:** 두 원천은 새 적재기 하나(`ingest/sources/ngii-lines.ts`)가 reference `feature`에 새 kind(`road_centerline`·`contour`)로 넣는다. OSM `road` kind와 섞지 않으므로 D15·A01·D28·장면은 움직이지 않는다. D17은 분석 때 반경 안 등고선을 읽어 업로드 경로의 보간(`interpolateTopoDem`)으로 5 m DEM을 만들고, D17 전용 reader(업로드 수치지형도 → 전국 등고선 DEM → GLO-30)로 상대고 면·큰 답을 낸다. D18·장면·S01~S04는 지금 reader를 그대로 쓴다. D13 폭은 라벨에 고른 OSM 도로에 같은 방향·10 m 안의 중심선 `rvwd` 중앙값을 붙이는 순수 함수로 하고, `mergedRoadLines`는 고치지 않는다.

**Tech Stack:** TypeScript · better-sqlite3 · tsx · `ingest/shp.ts`(EPSG:5179 읽기) · turf · 테스트 `src/scripts/v2/test-v2-*.mjs`(`npx tsx`) · `npm run vworld:fetch`/`vworld:fetch-large` · `npm run data:build` · `src/scripts/v2/data-gc.mjs`

**Spec:** `docs/superpowers/specs/2026-11-03-labels-map-expression-design.md`(확정 2026-11-03) §2-5 E1·E2, §3 P4 행, §3-1 E, §3-2(E 행·움직이는 고정값), §4-1 Q8 c·Q10 c와 그 아래 Judge 판정 2·3·4. **사용자 결정(2026-11-05)이 spec보다 우선한다:** vault `10-Projects/16-SiteAnalysis/Decisions/2026-11-05 P4·P5 원천은 VWorld 다운로드 CC BY와 토지이음 SHP.md`, 조사 `.superpowers/sdd/2026-11-05-p4p5-license/report.md`, 그리고 `Decisions/2026-11-04 VWorld 허가 없음 정정과 API 저장 금지.md`(오픈API 자료는 저장 경로에 쓰지 않는다). 근거 조사: `.superpowers/sdd/2026-10-30-report-page-layout/next-plan-inv-sources.md` 질문 1·2. 실행자는 spec·결정 노트·이 계획을 함께 읽는다. file:line은 HEAD `946d9138`(브랜치 `v2-cartography`) 기준이다.

## Global Constraints

- **원천 경로(사용자 결정):** 저장하는 자료는 VWorld **다운로드 서비스** 파일(dsId 30182·30185, 자료별 「CC BY」)만 쓴다. VWorld 오픈API(2D 데이터 API `LT_L_N3A0020000`, NED 등) 응답은 저장 경로에 쓰지 않는다(약관 19조 6항, 2026-11-04 결정).
- **출처 문구(결정 원문):** 도로중심선 `국토지리정보원 연속수치지형도(도로중심선) · CC BY` + 링크, 등고선 `국토지리정보원 연속수치지형도(등고선) · CC BY` + 링크. 등고선 가공물(원본 선으로 만든 DEM·상대고 면)에는 출처 장·가이드에 `가공: 본 서비스, 원저작자는 가공물을 보증하지 않음`을 단다. 비영리 전제이며 영리 전환 시 재검토한다(AGENTS).
- **품질 우선(AGENTS):** 원본 선을 단순화하거나 꼭짓점을 줄이지 않는다. 크기·시간 문제는 측정한 뒤 저장 방식·알고리즘으로 푼다. 낮은 대안은 비용·권리로 불가할 때만 고르고, 그때는 사용자에게 수치와 함께 묻는다.
- **범위(spec):** 전국 5 m DEM 격자는 만들지 않는다. D18은 GLO-30 그대로다. 다른 TOPO_AFFECTED_TILES(`topo/context.ts:13-16`)는 대상이 아니다. 등고선 계곡선은 표고 25 m 배수 규칙으로 정하고(`d17/engine.ts:29-39`) `divi`에 기대지 않는다.
- **D13 단계(Q8 c):** 1단계는 적재와 `rvwd` 정의·채움률 확인뿐이고 D13 출력은 바꾸지 않는다(상세 줄은 P1대로 위계, 업로드 분석만 폭). 2단계(모든 분석에 폭)는 Checkpoint U1에서 사용자가 고른 뒤에만 한다(spec 판정 4). 「중심선 속성 · 접도 판정 아님」 한계는 유지한다.
- **리비전:** D17은 `TILE_CACHE_REVISION.D17`(`common.ts:44`)과 `NO_TOPO_CACHE_REVISION.D17`(`common.ts:58`)에 같은 접미 `+contour-src-r1`, D13(2단계)은 `common.ts:41`에 `+centerline-width-r1`. 적재만 바뀌는 단계는 manifestHash가 키를 바꾸므로 올리지 않는다(`run.ts:71-80`). 고정값은 `updating-hash-pinned-baselines`로, 「바뀐 필드만 떼면 옛 해시와 같다」 근거를 보고서에 남긴다.
- **1층 3m 추정·높이 규칙은 건드리지 않는다.**
- **데이터 위치:** `C:/SiteAnalysisData/v2`(본 저장소 `.cache/v2`는 junction). 받기 `--out D:/V-coding/16-SiteAnalysis/.cache/v2/raw`, 빌드·dev 서버·GC는 `V2_DATA_DIR=D:/V-coding/16-SiteAnalysis/.cache/v2/data`. 옛 버전은 손으로 지우지 않는다. GC: `V2_DATA_DIR=D:/V-coding/16-SiteAnalysis/.cache/v2/data npx tsx src/scripts/v2/data-gc.mjs --app-db C:/SiteAnalysisData/v2/app.sqlite,C:/SiteAnalysisData/serve/app.sqlite`.
- **운영도 같은 데이터 폴더를 쓴다**(`C:/SiteAnalysisServe/serve.env`, P2 계획 확인). reference 새 버전 게시는 운영 새 분석의 데이터 전환이라 사용자 승인 뒤에만 한다.
- **화면·표기:** 화면에 닿는 Task(9·10)는 시작 전에 `docs/design/v2-design-language.md` §1·§6·§8·§9-2·§9-4·§9-8·§9-12·§10을 읽고 `ui-ux-pro-max`·`my-design-taste`를 쓴다(Codex에도 `~/.codex/skills/`에 있다). 정본에 없는 패턴은 만들지 말고 보고한다. 보고서 끝에 `taste 후보: <한 줄|없음>`. 사용자에게 보이는 말은 한국어, 수는 `toLocaleString("en-US")`, 거리는 `formatDistanceM`.
- **파일 편집:** Edit/Write 도구로만 한다(sed·python·heredoc 패치 금지). 바꿀 줄만 바꾼다.
- **검증:** 실행자는 관련 테스트만(`npx tsx src/scripts/v2/test-v2-<name>.mjs`, `npm run lint`). 전체 `npm run test:v2`는 Judge가 Task 12에서 한 번. PPT는 PowerPoint Presentation SaveAs PNG(시간 제한), PDF·PNG는 실제 렌더·불투명 픽셀·잉크·내장 이미지까지 본다(AGENTS).
- **화면 QA:** 서버 `http://localhost:3200/site`(Judge가 띄운 것, 새로 띄우지 않는다), 로그인 `devqa` + 로컬 `DEV_QA_PASSWORD`(어디에도 적지 않는다). 엔진을 바꾼 뒤에는 `node tools/qa/refresh-analysis.mjs <id> <out.json>`로 다시 계산한다(저장 분석은 리비전으로 자동 재계산되지 않는다). 캡처는 1440×900·1024×768 `tools/qa/capture-pages.mjs`, PPT는 `tools/qa/export-pptx.mjs` → `tools/qa/render-pptx.ps1 -TimeoutSec 180`.
- **커밋:** Task별 `feat(v2):`/`fix(v2):`/`docs(v2):` + 한국어 요약 + 실제 실행 모델의 Co-Authored-By 줄. push·배포는 하지 않는다.

## 실행자 라우팅

| 역할 | 누가 | 근거 |
|---|---|---|
| 구현 Task 2·4·7·9·10 | **Executor A `gpt-6.1-terra`**(`codex exec`, service tier fast). Task 2는 `medium`(고칠 자리가 정해진 소형), 4·7·9·10은 `xhigh`(새 기능·여러 파일) | 사용자 전역 규칙 기본값. Codex에 `ui-ux-pro-max`·`my-design-taste`·`playwright`가 있어 Task 9·10의 캡처·디자인 점검도 예외 없이 A가 한다 |
| Task 1 원천 확인, Task 3 받기, Task 6 판정, Task 8 빌드·게시, Task 11 정본, Task 12 인수, Checkpoint | **Judge(메인 세션)** | Task 1은 Aside(사용자 브라우저)로 원문을 읽고 사용자 로그인이 걸릴 수 있다. 빌드·게시는 운영 데이터 전환이다 |
| Task 5 리허설 측정 | Executor A `medium`(기계적 측정) → 판정은 Judge(Task 6) | |
| Task 리뷰 | Opus(Judge 또는 같은 모델 서브에이전트) | 실행자 PASS를 그대로 받지 않는다. 캡처는 Judge가 직접 연다 |

- 디스패치: `codex exec -m gpt-6.1-terra -c 'model_reasoning_effort="xhigh"' -c 'service_tier="fast"' -c 'notify=[]' --color never -o <lastmsg.txt> - < <prompt.md>`(소형은 `"medium"`). 실제 모델을 stdout 헤더로 확인해 원장에 적는다.
- 브리프 필수 줄: 상위 목표 다음 줄에 `역할: 실행자. 직접 구현한다. 하위 에이전트는 읽기 전용 조사에만 쓴다. 독립된 갈래로 나눌 만큼 크면 구현하지 말고 '분할 필요: <갈래>'를 보고하고 끝낸다.` + `Judge가 이미 나눈 단위이니 분할 보고 금지`(2026-11-04 교훈) + 실패 넘기기 줄 + 정본 필독 줄 + 이 Task 전문 + Global Constraints + 원장 경로. 보고서는 `collecting-tdd-ledger-reports` 형식(RED·GREEN 원문)과 `skill 후보:` 줄.

## 원장과 재개 (회사 PC 06:00·18:00 종료)

- 원장: `.superpowers/sdd/2026-11-05-p4-centerline-contours/progress.md`. 맨 위에 계획·spec·결정 노트 경로, 시작 HEAD, 라우팅 표, QA 분석 id를 적는다. Task 산출(`sources-check.md`, `rehearsal.md`, `stage1-width.md`)도 이 폴더에 둔다.
- Task 하나는 한 세션(2~3시간) 안에 끝나는 크기다. 시작 전 `(Get-CimInstance Win32_OperatingSystem).LastBootUpTime`·현재 시각을 보고, 다음 종료까지 3시간 미만이면 코드 Task를 시작하지 않는다.
- Step이 끝날 때마다 원장에 `T<n> S<k> 완료 · <커밋|미커밋> · 다음: <Step>`. 오래 걸리는 명령(받기·리허설·빌드·refresh·SaveAs) **앞**에도 남긴다.
- **받기(Task 3)는 재개된다:** `VworldSession.download`와 `vworld-fetch-large`는 `<zip>.done.json`의 `fileSq`·`baseDate`가 같으면 건너뛴다(`ingest/vworld.ts:205-212`, `vworld-fetch-large.mjs:97-105`). 끊기면 같은 명령을 다시 돌린다. `.part`는 스스로 지운다.
- **빌드(Task 8)는 단계 단위로 재개된다:** reference는 원천 파일 단계마다 한 트랜잭션 + 진행표 행이다(`data-build.mjs:559-567`). PC가 꺼지면 같은 버전 이름에 `--resume`을 붙인다. 진행표 지문이 바뀌면(적재기 코드 변경) 이어 가지 못한다.
- 재개 전: 부팅 시각, 원장 마지막 줄, `git status`, 콘솔 로그 끝 줄·수정 시각, 남은 `node`(data-build·vworld-fetch)·`POWERPNT` 프로세스를 본다. 남은 프로세스는 정지하고 확인한다.

## 데이터 버전과 GC

- reference 빌드는 reference 전체를 새로 만든다(모든 단계가 다시 돈다). 등고선이 들어간 뒤의 모든 reference 빌드(교체 계획·P5 포함)는 등고선 적재 시간을 함께 쓴다. 그래서 **권장 순서**는 R1 = 용도지역·공시지가 원천 교체(`2026-11-05-zoning-landprice-source-swap.md`, 짧음) → R2 = 이 계획 Task 8(중심선 + 등고선, 준비됐으면 P5 Task 3 용도지구 적재도 같은 빌드에) → GC 한 번이다. 순서가 바뀌면 원장에 적는다.
- data-build는 데이터 폴더 잠금을 하나만 허용한다. P2 core·buildings 빌드(P2 Task 10)와 겹치지 않게 `--wait-lock 60`을 붙이고, 시작 전에 다른 data-build·data-gc 프로세스가 없는지 본다.
- 게시 뒤 갤러리를 통과하면 GC를 한 번 돌린다. 저장 분석은 고정한 버전으로 계속 열린다(자동 재계산 없음). 등고선이 들어간 reference는 한 판이 수십 GB일 수 있다. 저장 분석이 고정한 옛 판은 GC가 지키므로 디스크 여유를 Task 6에서 함께 잰다.

## Review Focus

1. **자료가 없는 분석.** 옛 reference 판을 고정한 저장 분석, 전국 등고선·중심선 범위 밖, 적재 전 판에서 D17·D13 출력은 지금과 바이트가 같아야 한다(출력의 `engineVersion`은 전역 `ENGINE_VERSION`이라 리비전은 해시에 들어가지 않는다, `common.ts:373`). → Task 9 Step 1 ⑥, Task 10 Step 1 ⑤
2. **등고선 간격이 넓은 평지.** 사분면 IDW는 60 m 안에 두 사분면 이상의 점이 없으면 NaN이다(`topo/dem.ts:18·64`). 그 셀은 GLO-30으로 채워지고, 채운 비율이 지표·한계 문구로 보여야 한다. 수직 기준(NGII 표고 vs GLO-30 EGM2008) 차이도 한계에 적는다. → Task 9 Step 1 ③
3. **원본 선이 줄거나 잘린다.** `lineCandidate`는 200점으로 단순화하고(`common.ts:282`, `MAX_LINE_VERTICES` 200) 지도 선은 2,000개 상한이다(`tile-result.ts:93`). 원본 선은 200점 이하 조각으로 나눠 꼭짓점을 그대로 두고, 상한에 걸리면 계곡선을 먼저 남기고 `partial` 한계를 단다. → Task 9 Step 1 ②
4. **OSM 도로와 중심선 오짝.** 나란한 이면도로(간선 옆 12 m), 직교 교차로, 고가·지하차도에서 엉뚱한 폭이 붙으면 안 된다. 짝이 모자라면 폭을 붙이지 않는다. → Task 7 Step 1
5. **업로드 수치지형도가 있는 분석.** 업로드 DEM이 범위 안에서 먼저이고 범위 밖은 전국 등고선, 그 밖은 GLO-30이다. 업로드 분석의 D13 폭·D17 원본 선은 전국 자료와 같아야 한다(같은 연속수치지형도). → Task 9 Step 1 ⑤, Task 12 Step 4

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/v2/ingest/vworld.ts`, `src/scripts/v2/vworld-fetch.mjs`, `vworld-fetch-large.mjs` | 30182·30185 목록 선택·파일명·폴더 | 2 |
| `src/lib/v2/ingest/sources/ngii-lines.ts`(새 파일) | 중심선·등고선 적재기, 권리 상수 | 4 |
| `src/scripts/v2/data-build.mjs` | reference 단계 2종(zip마다 임시 추출) | 4 |
| `src/lib/v2/ui/source-details.ts`, `src/lib/v2/ui/tile-catalog.ts` | 원천 등록(이름·정의·고지문), D13·D17 원천 목록 | 4·9·10 |
| `src/lib/v2/engine/tiles/road-centerline.ts`(새 파일) | OSM 도로–중심선 폭 짝짓기 | 7 |
| `src/lib/v2/engine/tiles/topo-roads.ts` | `centerlineFrontageWidthM`(접한 도로 폭, 기존 사적 함수 재사용) | 7 |
| `src/scripts/v2/centerline-width-report.mjs`(새 파일) | 1단계 측정표(채움률·차로수별 폭·짝짓기 범위·표본 대조 HTML) | 7 |
| `src/lib/v2/topo/build.ts` | `addContourPoints` export(지금 사적 함수) | 9 |
| `src/lib/v2/engine/tiles/terrain-shared.ts` | `contourDem`·`d17DemReader`·`d17CellM`·`d17Sources` | 9 |
| `src/lib/v2/tile/d17/engine.ts`, `src/lib/v2/tile/d13/engine.ts`, `src/lib/v2/engine/tiles/common.ts` | D17 원본 선·면, D13 폭, 리비전 | 9·10 |
| 테스트 | `test-v2-vworld.mjs`, `test-v2-ngii-lines.mjs`(새), `test-v2-road-centerline.mjs`(새), `test-v2-d17-contours.mjs`(새), `test-v2-source-details.mjs`, `test-v2-admin-source-ops.mjs` + 고정값(`test-v2-tile-registry.mjs:46·49`, `test-v2-topo-run.mjs:38·41`, `test-v2-topo-roads.mjs:26`, `test-v2-topo-terrain.mjs:25`) | 각 Task |
| `docs/design/v2-design-language.md`, `docs/research/2026-10-26-archimap-benchmark.md` | §9-4·§10 문구, 결정 이력, 벤치마크 정정 | 11 |

## P1·P2·P3과 겹치는 파일과 순서

| 파일 | 다른 계획 | P4 | 처리 |
|---|---|---|---|
| `tile/d13/engine.ts`, `common.ts:41`, `test-v2-topo-roads.mjs:26`, `test-v2-topo-run.mjs:38`, `test-v2-tile-registry.mjs:46` | P1 Task 9: D13 이름별 최근접 6개, 상세 `직선 Xm · 위계`, topo 경로 `· 폭 Nm`, `+labels-r1` | Task 10: 폭을 모든 분석에 | **겹침.** Task 10은 P1 Task 9 커밋이 기준 브랜치에 들어간 뒤 rebase해서 한다. P1이 topo 경로에 쓴 `· 폭 Nm` 표기를 그대로 쓴다 |
| `common.ts:44·58`(D17) | 없음(P3 C-2는 `relief_*` 채움 톤만, 렌더 전용) | Task 9 | 겹치지 않는다. P3 C-2가 먼저 들어오면 D17 캡처의 면 톤이 45 %인 것을 감안해 비교한다 |
| `ui/map-layers.ts` | P3 C(색·선) | 고치지 않는다. 원본 선은 기존 `contour` 레이어 스타일(`#8a5a2e`, 정본 §9-4)을 쓴다 | 겹치지 않는다 |
| `data-build.mjs` reference 단계 | 교체 계획 Task 2(용도지역·공시지가·구역·정비 단계), P5 Task 3(용도지구 단계), P2 Task 8(buildings 단계, 다른 builder) | Task 4: 새 단계 2개 | 같은 파일의 다른 블록이다. 동시에 고치지 않고 커밋 순서대로 rebase한다. SLOT 번호는 25·26을 쓴다(지금 최대 24, `data-build.mjs:570`). P5는 27부터 |
| `ui/source-details.ts`·`tile-catalog.ts` | 교체 계획 Task 2, P5 Task 2·3 | Task 4·9·10 | 줄이 다르다. 커밋 순서대로 rebase |
| 데이터 잠금 | P2 Task 10(core·buildings 약 3.5시간) | Task 8 | 같은 시각에 돌리지 않는다(`--wait-lock 60`) |

**순서:** 준비 → T1 → T2 → T3(백그라운드 받기 시작) ∥ T4 → T5(서울 리허설) → T6(판정) → T7 → **Checkpoint U1** → T8(사용자 승인) → T9 → T10(P1 Task 9 뒤, U1이 b일 때만) → T11 → T12. T9는 T8 게시 전에도 fixture로 구현·테스트할 수 있고, Step 4·7(실데이터)만 T8 뒤에 한다.

## 판단 기록 (spec이 계획에 맡긴 것)

- **새 kind로 적재한다(`road_centerline`·`contour`).** OSM과 같은 `road`로 넣으면 `ctx.hits("reference", ["road"])`를 쓰는 D13(`d13/engine.ts:160·189`)·D15·A01·D28·장면(`engine/scene.ts:368`)이 모두 바뀌어 고정값과 리비전이 크게 번진다. 원천 id는 `ngii_centerline`·`ngii_contour`(기존 `ngii_topo`·`ngii_air`와 같은 꼴)다.
- **저장은 spec대로 reference `feature` 표이고, 측정으로 막을 기준을 둔다.** 반경 질의는 R*Tree를 바깥 루프로 돌린 뒤 kind로 거른다(`data/features.ts:243-256`). 등고선 수천만 개가 같은 R*Tree에 들어가면 기존 kind 질의가 느려질 수 있다. Task 5에서 대치동 503 1 km·평창동 22 2 km의 `ctx.hits("reference", ["road"])`·`["district_area"]` 시간을 전후로 재고, p50이 20 % 넘게 늘거나 50 ms 넘게 늘면 Task 6 판정으로 등고선만 reference 안 전용 표 + 전용 R*Tree로 옮긴다(선례: reference의 `land_price` 표, `a12/engine.ts:81`). 새 데이터 파일 종류는 만들지 않는다(spec).
- **zip은 단계마다 임시 폴더에 풀고 지운다.** 13.4 GB zip을 `extractAll`로 원천 폴더에 풀면 C:에 수십 GB가 남는다. 서울플랜+ 단계(`data-build.mjs:871-880`, `mkdtempSync` → `extractAll` → `rmSync`)와 같은 방식으로 필요한 레이어 파일(`.shp`·`.shx`·`.dbf`·`.prj`·`.cpg`)만 푼다.
- **좌표는 0.1 m로 반올림하고 단순화하지 않는다.** 용도지역과 같은 `roundM: 0.1`(`ingest/sources/zoning.ts:37`)이다. 1:5,000 위치 정확도보다 훨씬 작다. 단순화는 Task 6에서 디스크 기준을 넘을 때만 사용자에게 묻는다.
- **등고선 DEM은 분석 때 만든다(적재 때가 아니다).** spec 판정 3이 자리를 계획에 맡겼다. 전국 5 m 격자는 비목표이고 새 데이터 파일 종류도 금지라서, 반경 + 65 m(IDW 60 m + 셀 5 m) 안의 등고선만 읽어 업로드 경로와 같은 `interpolateTopoDem(points, bounds, 5)`(`topo/dem.ts:77`)로 만든다. 점은 업로드와 같은 5 m 조밀화(`topo/build.ts:89-104`)다.
- **D17 전용 reader를 따로 둔다.** `demReader`(`terrain-shared.ts:52-69`)는 D18·장면·S01~S04·상세가 함께 쓰므로 바꾸지 않는다. D17은 `d17DemReader`(업로드 DEM → 전국 등고선 DEM → GLO-30)와 따로 된 memo 키(`dem:reader:d17`, `terrain:grid:d17:<cell>`)를 쓴다. 단면(`terrain-section.ts:304`)은 업로드가 있을 때만 그리고 대부분 업로드 범위 안이라 지금 reader를 그대로 둔다(열린 질문 1).
- **상대고 면은 등고선 DEM의 10 m 격자로 만든다.** 지금 5 m 업로드는 isobands 인자 전개 문제로 30 m 격자에서 면을 만든다(`d17/engine.ts:127-131`). 원본 선과 면이 어긋나지 않게 10 m를 기본으로 하고, Task 9에서 r = 2 km가 오류 없이 3 s 안에 끝나지 않으면 15 m로 한다. 5 m가 그 기준을 지키면 5 m를 쓴다.
- **D13 폭은 라벨 상세 줄과 접한 도로 폭 지표에만 붙인다.** spec E1 「라벨에 고른 OSM 도로에 `rvwd` 중앙값」 그대로다. `mergedRoadLines`(`topo-roads.ts:191-224`)에 폭을 넣으면 D15(`test-v2-topo-roads.mjs:27`)와 장면 해시가 움직이므로 넣지 않는다.
- **짝짓기 기준값(10 m·20°·표본 절반)은 이 계획의 제안이다.** spec은 「방향이 같고 10 m 안」까지만 정했다. 각도 20°와 표본 50 %는 Task 7 측정과 함께 Checkpoint U1에서 사용자에게 보인다.
- **받기 선택 규칙을 고친다.** 30182 zip은 기준일이 2026-10-01·10-14로 섞여 있다(조사). 지금 `latestFull`(`vworld.ts:99-103`)은 가장 최근 기준일 한 벌만 남겨 앞 날짜 zip을 버린다.

---

### 준비 (Judge — 실행자 작업 아님)

- [ ] 원장 `.superpowers/sdd/2026-11-05-p4-centerline-contours/progress.md`를 만든다(계획·spec·결정 노트 경로, 시작 HEAD, 라우팅 표).
- [ ] QA 분석 id를 적는다: 대치동 503 주소 분석 `fe9e688b-f7d0-4eda-b00a-7867ea6636ee`(1 km), 대치동 503 2 km `541bd2cf`. devqa로 「서울특별시 종로구 평창동 22」 주소 분석(1 km·2 km, 산지)과, 대치동 503 1 km에 Desktop `(B020)연속수치지도_202610156533.zip`을 올린 업로드 분석을 만든다. zip 범위(UTM-K x 958,919~962,517, y 1,941,954~1,945,194)가 대지를 덮는지 화면 범위 표시로 확인한다.
- [ ] **전 캡처:** 네 분석의 D13·D17 장(1440·1024 화면 + PPT SaveAs)을 `…\scratchpad\p4\before\`에 둔다.

### Task 1: 원천 확인 — 라이선스 원문·로그인·목록·ZIP 레이어·데이터 설명서 (Judge, 사용자 조치 가능)

**Files:**
- Create: `.superpowers/sdd/2026-11-05-p4-centerline-contours/sources-check.md`
- Create(저장소 밖): `…\scratchpad\p4\t1\`(목록 HTML, 시험 zip 목록, DBF 표본 통계, PDF 발췌)
- Create: `src/scripts/v2/fixtures/vworld-list-30182.html`, `vworld-list-30185.html`(목록 HTML에서 항목 3개만 남긴 것, Task 2 테스트용)

**Interfaces:**
- Produces(Task 2·4·7이 쓴다): 목록 항목의 `region`·`title`·`kind`·`baseDate`·`approxBytes` 실제 값, zip 안 파일 이름(레이어명), DBF 필드 이름·형, `.prj` CRS, UFID 중복 여부, `rvwd`·`rdln`·`cont`·`divi`의 공식 정의 원문.

- [ ] **Step 1: 로그인 확인.** 2026-11-04에 사용자가 약관 변경에 동의했다(vault 세션 노트). 저장소에서 scratch 스크립트로 `new VworldSession().login(id, pw)` 후 `listFiles("30182")`·`listFiles("30185")`를 부르고 `parseFileList` 결과를 JSON으로 저장한다. 자격 증명은 `.env.local`에서 읽고 출력하지 않는다.
  - `useChk`나 `LOGIN_FAILED`가 나오면 멈추고 **사용자 조치**로 넘긴다: 「vworld.kr에 직접 로그인해 안내 화면(약관 변경·비밀번호 기간 등)을 처리해 주세요」. 처리 뒤 이 Step을 다시 한다.
  - 30182 8개·30185 19개가 나오는지, `kind`가 「전체데이터」인지, `region`이 비거나 겹치는지, 기준일이 섞였는지 적는다. 목록 서비스 코드가 NA가 아니면(빈 목록) `SVC_CDE`(`vworld.ts:39`)에 넣을 값을 적는다.
- [ ] **Step 2: 라이선스 원문 재대조(Aside, 읽기 전용).** `using-aside-browser`로 `https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30182`와 `…dsId=30185` 상세 페이지의 라이선스 문구·링크 대상(CC BY 2.0 KR 여부)·제공기관·갱신주기를 원문 그대로 옮긴다. 약관(`https://www.vworld.kr/v4po_prcint_a001.do`, 2026-10-30 시행) 19조 6항 원문도 옮긴다. 조사 인용(Aside가 옮긴 것)과 한 글자라도 다르면 표에 적는다.
- [ ] **Step 3: 받기에 로그인이 필요한지.** 가장 작은 30182 zip 하나를 로그인 세션 `download()`로 받는다(대용량이면 `vworld:fetch-large` 경로). 같은 파일을 로그인 없는 세션으로 요청해 응답 형식만 본다(받지 않는다). 동의 화면·추가 신청이 뜨면 사용자 조치로 넘긴다.
- [ ] **Step 4: ZIP 안 레이어와 DBF.** 받은 zip을 `tar -tf`로 나열하고(레이어명이 `N3L_A0020000`인지), 새 빈 폴더에 풀어 `.prj`의 CRS와 `.cpg`를 본다. `readShp(…, { native: true })`로 DBF 필드 이름·형과 표본 통계(행 수, `rvwd` 0·결측 비율, 최소·중앙·최대, `rdln`별 `rvwd` 중앙값, UFID 중복 수)를 낸다. 30185는 가장 작은 zip 하나만 받아 `N3L_F0010000`·`cont` 범위·`divi` 값 분포·UFID 중복을 본다(나머지는 Task 3). 받은 파일은 Task 3의 원천 폴더 규칙(`raw/<folder>/<baseDate>/<rawZipName>`)대로 옮겨 다시 받지 않게 한다.
- [ ] **Step 5: 데이터 설명서.** VWorld 목록에 있는 「연속수치지형도_데이터_설명서.pdf」(약 738 KB)를 받아 `rvwd`·`rdln`·`rddv`·`cont`·`divi`의 정의 문구를 쪽 번호와 함께 그대로 옮긴다. PDF에 없으면 「없음」과 찾은 곳을 적고, 조사의 1:1,000 정의(법제처 별표)는 「1:5,000 적용 근거 없음」 표시와 함께 참고로만 둔다. 정의를 지어내지 않는다.
- [ ] **Step 6: fixture 저장.** 목록 HTML에서 항목 3개(기준일이 다른 것 포함)만 남겨 두 fixture 파일로 저장한다.
- [ ] **Step 7: 판정과 기록(Judge).** `sources-check.md`에 위 사실을 표로 적고, 결정 노트의 「남은 확인」 다섯 줄 각각에 답을 단다. 라이선스가 결정과 다르면(예: CC BY가 아님) 멈추고 사용자에게 묻는다. 커밋: `docs(v2): P4 원천 확인 — VWorld 30182·30185 라이선스 원문·레이어·rvwd 정의` (fixture 포함).

### Task 2: 받기 도구 — 30182·30185 폴더·선택·파일명

**Files:**
- Modify: `src/scripts/v2/vworld-fetch.mjs:9`(`FOLDERS`)
- Modify: `src/scripts/v2/vworld-fetch-large.mjs:12`(`FOLDERS`), `:46`(목록 선택)
- Modify: `src/lib/v2/ingest/vworld.ts:118`(`rawZipName`), `:258`(`fetchDatasets` 선택), 필요하면 `:39`(`SVC_CDE`, Task 1 Step 1 결과)
- Test: `src/scripts/v2/test-v2-vworld.mjs`

**Interfaces:**
- Consumes: Task 1 fixture 2개와 목록 사실.
- Produces:
  ```ts
  // vworld.ts
  export const NGII_LINE_DATASETS: ReadonlySet<string>; // new Set(["30182", "30185"])
  /** 제목·지역마다 가장 최근 기준일 한 건. 변동데이터는 뺀다. 기준일이 섞인 데이터셋(30182)용 */
  export function latestPerFile(files: VworldFile[]): VworldFile[];
  // rawZipName: NGII_LINE_DATASETS면 파일 시스템에 쓸 수 없는 글자(\ / : * ? " < > |)를 _로 바꾼 title + (title이 .zip으로 끝나지 않으면 ".zip")
  ```
  `FOLDERS`에 `30182: "road_centerline"`, `30185: "contour"`를 더한다(두 스크립트 모두). `fetchDatasets`와 `vworld-fetch-large`는 `NGII_LINE_DATASETS`면 `latestPerFile`을 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-vworld.mjs`에 블록을 더한다.
  ```js
  const files30182 = parseFileList(readFileSync(".../fixtures/vworld-list-30182.html", "utf8"), "30182");
  assert.equal(files30182.length, 3);
  assert.deepEqual(latestPerFile(files30182).map((f) => f.fileSq).sort(), [/* Task 1 fixture의 기준일이 다른 두 파일 fileSq */].sort(), "기준일이 섞여도 파일마다 최신 한 건");
  assert.notEqual(rawZipName(files30182[0]), rawZipName(files30182[1]), "같은 지역이어도 파일 이름이 겹치지 않는다");
  assert.match(rawZipName(files30182[0]), /\.zip$/);
  assert.equal(rawZipName({ ...files30182[0], dsId: "23", region: "세종특별자치시" }), "세종특별자치시.zip", "다른 데이터셋은 그대로");
  ```
  (fixture의 실제 값으로 기대값을 채운다. 변동데이터 항목이 fixture에 있으면 빠지는 단언도 둔다.)
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-vworld.mjs` → `latestPerFile is not a function`
- [ ] **Step 3: 구현** — 위 Interfaces대로.
- [ ] **Step 4: 통과 확인** — 같은 테스트 PASS, `npm run lint` 0. `npx tsx src/scripts/v2/vworld-fetch.mjs --ds 30182 --region <없는 이름>`이 「no files」로 끝나는지(자격 증명 출력 없음)만 본다.
- [ ] **Step 5: 커밋** — `feat(v2): VWorld 받기에 연속수치지형도 도로중심선·등고선(30182·30185) — 파일마다 최신, 제목으로 파일 이름`

### Task 3: 받기 시작 (Judge, 백그라운드)

**Files:** 원천 `C:/SiteAnalysisData/v2/raw/road_centerline/<baseDate>/`, `…/raw/contour/<baseDate>/`, 콘솔 로그 `C:/SiteAnalysisData/v2/fetch-p4.console.log`

- [ ] **Step 1: 디스크 확인** — `Get-PSDrive C`. 여유가 13.4 GB + 1.6 GB + 30 GB(작업 여유) 이상인지 본다. 모자라면 사용자에게 알린다.
- [ ] **Step 2: 래퍼(Write)** — `C:/SiteAnalysisData/v2/p4-fetch.sh`: 저장소로 cd → `npm run vworld:fetch -- --ds 30182 --out D:/V-coding/16-SiteAnalysis/.cache/v2/raw` → `npm run vworld:fetch -- --ds 30185 --out …` → 일반 다운로더가 `NOT_A_FILE`로 남긴 큰 파일은 `npm run vworld:fetch-large -- --ds 30185 --out …`(그리고 30182에 실패가 있으면 같은 명령). 각 명령 앞뒤에 `--- start`·`EXIT <rc> <시각>`을 콘솔 로그에 남긴다.
- [ ] **Step 3: 시작** — `nohup bash /c/SiteAnalysisData/v2/p4-fetch.sh > /dev/null 2>&1 &`. 시작 시각을 원장에 적는다. Task 4~7은 기다리지 않고 진행한다.
- [ ] **Step 4: 감시와 재개** — Monitor로 콘솔 로그의 `EXIT`를 기다린다. PC가 꺼졌으면 다음 부팅 때 같은 래퍼를 다시 띄운다(완료 파일은 건너뛴다).
- [ ] **Step 5: 검산** — 받은 zip 수(8·19)와 합계 크기를 목록 표시값과 대조하고(13.4 GB 검산, 결정 노트 「남은 확인」), 모든 zip이 `tar -tf`로 열리는지 본다. 원장에 표로 적는다.

### Task 4: 적재기 — 도로중심선·등고선(`ngii-lines.ts`)과 reference 단계, 원천 등록

**Files:**
- Create: `src/lib/v2/ingest/sources/ngii-lines.ts`(`osm-roads.ts`·`districts.ts` 꼴)
- Modify: `src/scripts/v2/data-build.mjs` — import(`:37` 근처), osm_roads 단계(`:674-692`) 뒤에 단계 2종, `SLOT`(`:570`)에 `centerline: 25, contour: 26`
- Modify: `src/lib/v2/ui/tile-catalog.ts`(`SOURCE_NAMES` `:117-`), `src/lib/v2/ui/source-details.ts`(`SOURCE_DETAIL_DEFINITIONS` `:80-`, `ngii_topo` `:157` 근처)
- Create: `src/scripts/v2/test-v2-ngii-lines.mjs`(SHP 쓰기 헬퍼는 `test-v2-zoning.mjs:23` `writeShp`와 `topo-fixture.mjs`의 `PRJ_5179`를 쓴다)
- Modify: `src/scripts/v2/test-v2-source-details.mjs`, `src/scripts/v2/test-v2-admin-source-ops.mjs:4-18`(rows)

**Interfaces:**
- Consumes: Task 1의 필드 이름·CRS·UFID 사실, Task 2의 원천 폴더 이름.
- Produces:
  ```ts
  export const NGII_CENTERLINE_SOURCE_ID = "ngii_centerline";
  export const ROAD_CENTERLINE_KIND = "road_centerline";
  export const NGII_CONTOUR_SOURCE_ID = "ngii_contour";
  export const CONTOUR_KIND = "contour";
  export const NGII_LINE_RIGHTS: {
    license: "CC BY 2.0 KR"; attribution: "국토지리정보원 연속수치지형도";
    downloadedFrom: "VWorld 다운로드 서비스(dsId 30182·30185)";
    termsBasis: "VWorld 이용약관(2026-10-30 시행) 19조 6항 단서 — 다운로드 서비스 개별 라이선스";
    decision: "2026-11-05 사용자 결정(P4·P5 원천)";
  };
  export interface NgiiLineBuildOptions { legalCodeOf?: (lng: number, lat: number) => string | null }
  export function buildRoadCenterlines(db: Db, records: AsyncIterable<ShpRecord>, releaseId: string, opts?: NgiiLineBuildOptions, seen?: Map<string, number>): Promise<SourceStats>;
  export function buildContours(db: Db, records: AsyncIterable<ShpRecord>, releaseId: string, opts?: NgiiLineBuildOptions, seen?: Map<string, number>): Promise<SourceStats>;
  ```
  - 중심선 properties: `{ ufid, widthM, lanes, roadClass, scls, name, roadNo }` — `widthM = rvwd > 0 ? rvwd : null`, `lanes = rdln > 0 ? rdln : null`, `roadClass = rddv`, `name = name ?? rdnm`, `roadNo = rdnu`(필드 이름은 대소문자 무시, `topo/build.ts:49-64`와 같은 규칙). feature `name`은 `name`.
  - 등고선 properties: `{ ufid, elevationM, divi }` — `elevationM = cont`(유한수가 아니면 reject).
  - stableId `<kind>:<ufid>`, 같은 UFID가 다시 오면 `#<n>`(districts의 `seen` 방식, `districts.ts:212-214`). UFID가 없으면 reject. 선 도형이 아니면 reject. `insertFeature(…, roundM: 0.1)`.
  - `SourceStats`: 중심선 필드 `["widthM", "lanes", "name"]`, 등고선 `["elevationM"]`, 지역은 `legalCodeOf` 첫 점의 시도 2자리(osm-roads `regionOf`와 같다).
- **reference 단계(data-build)**
  - 원천: `raw/road_centerline/<baseDate>/*.zip`, `raw/contour/<baseDate>/*.zip`(`.done.json`이 있는 zip만). 단계 id는 `road_centerline/<zip 이름>`·`contour/<zip 이름>`, 지문 파일은 zip 자체.
  - 단계 안: `mkdtempSync(join(tmpdir(), "siteanalysis-ngii-"))` → `extractSelected`로 해당 레이어(`N3L_A0020000`·`N3L_F0010000`)의 `.shp/.shx/.dbf/.prj/.cpg`만 → `readShp(shp)` → 적재 → `finally`에서 임시 폴더 삭제.
  - release: `sourceId`는 위 상수, `provider: "국토지리정보원(VWorld 다운로드 연속수치지형도)"`, `sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30182"`(등고선 30185), `sourceAsOf`는 그 데이터셋 zip들 `.done.json` `baseDate` 중 가장 이른 값(공시지가 단계와 같은 규칙, `data-build.mjs:780`), `licenseCode: "CC-BY"`, `rights: { ...NGII_LINE_RIGHTS, layer }`. zip마다 같은 sourceId로 release를 하나씩 넣는다(공시지가 단계 선례).
  - 폴더가 없으면 단계를 만들지 않고 한 줄 로그만 남긴다(지금 OSM·구역 단계와 같다).
- **원천 등록**
  - `SOURCE_NAMES`: `ngii_centerline: "국토지리정보원 연속수치지형도(도로중심선) · CC BY"`, `ngii_contour: "국토지리정보원 연속수치지형도(등고선) · CC BY"`(정본 §10 「표시 이름에 조건」, 결정 원문).
  - `SOURCE_DETAIL_DEFINITIONS`:
    - `ngii_centerline: { provider: "국토지리정보원", name: "연속수치지형도(도로중심선)", usedFor: "도로 폭(참고)·접한 도로 폭", collect: "수동 파일", cycle: "연 1회", group: "연속수치지형도(VWorld 다운로드)" }`
    - `ngii_contour: { provider: "국토지리정보원", name: "연속수치지형도(등고선)", notices: ["가공: 본 서비스, 원저작자는 가공물을 보증하지 않음"], usedFor: "원본 등고선과 등고선 보간 지형(상대고 면·중심 표고)", collect: "수동 파일", cycle: "연 1회", group: "연속수치지형도(VWorld 다운로드)" }`
  - 타일 원천 목록(`TILE_CATALOG` D13·D17)은 실제로 쓰는 Task 9·10에서 더한다(정본 §9-2 「실제로 쓰인 원천만」).

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-ngii-lines.mjs`
  - 중심선 SHP(EPSG:5179 prj): ① `rvwd 8, rdln 2, ufid U1` ② `rvwd 0, rdln 0, ufid U2` ③ ufid 없음 ④ 점 도형 ⑤ `ufid U1` 다시 → feature 3개. `U1` properties `widthM 8`, `lanes 2`. `U2`는 `widthM null`·`lanes null`. 두 번째 U1은 stableId `road_centerline:U1#1`. `stats` received 5·accepted 3. 저장 좌표를 다시 UTM-K로 바꿨을 때 원본과 0.1 m 안이다.
  - 등고선 SHP: `cont 35`, `cont 40`, `cont` 빈 값 → feature 2개, `elevationM` 35·40, kind `contour`.
  - 원천 등록: `sourceName("ngii_contour")`가 위 문자열, `sourceDetailsFor`의 `ngii_contour` 행 `notices`에 가공 문구, `license`가 `CC BY 2.0 KR(저작자표시)`(`licenseLabel("CC-BY")`). admin rows에 두 원천(`["ngii_centerline", "수동 파일", "연 1회", "연속수치지형도(VWorld 다운로드)"]` 등).
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-ngii-lines.mjs` → 모듈 없음
- [ ] **Step 3: 구현** — 위대로. data-build 단계도 함께 넣는다.
- [ ] **Step 4: 통과 확인** — 새 테스트, `test-v2-source-details.mjs`, `test-v2-admin-source-ops.mjs`, `test-v2-ingest-resume.mjs` PASS, lint 0. scratch 데이터 폴더에서 `npm run data:build -- --data-dir <scratch> --version dry --only reference --dry-run --raw D:/V-coding/16-SiteAnalysis/.cache/v2/raw`가 새 단계를 목록에 보이며 오류 없이 끝난다(받기가 끝난 zip만 단계가 된다).
- [ ] **Step 5: 커밋** — `feat(v2): 연속수치지형도 도로중심선·등고선 적재기와 reference 단계 — CC BY 출처·가공 고지 등록`

### Task 5: 서울 리허설 측정 (실행: Executor A medium)

**Files:**
- Create(저장소 밖): `C:/SiteAnalysisData/v2-scratch/p4-rehearsal/`(scratch reference), `…\scratchpad\p4\t5\measure.mts`
- Create: `.superpowers/sdd/2026-11-05-p4-centerline-contours/rehearsal.md`

**Interfaces:**
- Consumes: Task 4 적재기, Task 3이 받은 zip(서울을 덮는 zip — Task 1·3 목록에서 고른다).
- 지금 reference(`versions/2026-11-04-koies/reference.sqlite`, 10.25 GiB)는 읽기만 한다. scratch에는 그 파일의 **복사본**(하드링크 금지 — 쓰기가 들어간다)을 둔다.

- [ ] **Step 1: 시간 확인** — 다음 종료까지 2시간 이상인지 본다. 원장에 「T5 시작」.
- [ ] **Step 2: 적재** — scratch 복사본에 서울을 덮는 중심선 zip 전부와 등고선 zip 하나를 `buildRoadCenterlines`·`buildContours`로 넣는다(release는 Task 4 규칙). zip마다 행 수, 걸린 시간, 파일 크기 증가(VACUUM 없이 `page_count × page_size` 차이)를 잰다. 중심선 8개는 크기가 작으니 전국을 모두 넣어 시도별 채움률을 함께 낸다.
- [ ] **Step 3: 질의 시간 전후** — 같은 스크립트에서 적재 전 사본과 적재 뒤 사본으로 대치동 503 1 km·평창동 22 2 km 중심에 `queryFeaturesInRadius(db, c, r, ["road"])`·`["district_area"]`·`["store"]`를 각 30회 재고 p50·p95를 낸다.
- [ ] **Step 4: 전국 어림** — 등고선 zip 크기 비율로 전국 행 수·크기·적재 시간을 어림한다(19개 zip 크기 합 기준). 지금 C: 여유(`Get-PSDrive C`)와 그 절반을 함께 적는다.
- [ ] **Step 5: 분석 때 DEM 비용** — 평창동 22 2 km 반경 + 65 m의 등고선 hit을 읽어 `interpolateTopoDem`(5 m)을 돌린 시간·셀 수·NaN 비율, 대치동 503 1 km의 NaN 비율을 낸다.
- [ ] **Step 6: 보고서** — `rehearsal.md`에 위 표와 원 수치. 커밋하지 않는다(Task 6이 판정과 함께 커밋).

### Task 6: 리허설 판정 (Judge, 사용자 조치 가능)

- [ ] **Step 1: 디스크 기준(spec)** — 전국 등고선 어림 크기가 지금 C: 여유의 절반을 넘으면 사용자에게 묻는다. 묻는 표: 원본 그대로(크기·시간), 0.5 m 단순화(측정한 최대 편차·크기), 서울·수도권만 먼저, 전용 표(크기 차이). 품질이 낮은 안에는 그 사실을 적는다.
- [ ] **Step 2: 질의 기준** — 기존 kind 질의 p50이 20 % 또는 50 ms 넘게 늘면 「등고선 전용 표」로 정한다(판단 기록). 그 경우 Task 4를 고치는 후속 Task를 이 계획에 추가하고(전용 표 `contour_line(feature_id, release_id, elevation_m, divi, geom_json)` + `contour_rtree`, 엔진 조회 함수 하나), Task 9는 그 조회 함수를 쓴다.
- [ ] **Step 3: DEM 비용 기준** — 2 km 등고선 DEM이 5 s를 넘으면 Task 9에 성능 Step(점 버킷 크기·조밀화 간격을 바꾸지 않는 범위의 알고리즘 개선)을 더한다. 품질(5 m 셀·5 m 조밀화)은 낮추지 않는다.
- [ ] **Step 4: 기록과 커밋** — 판정을 원장과 `rehearsal.md` 끝에 적고 커밋: `docs(v2): P4 서울 리허설 — 등고선 적재 크기·시간·질의 영향 측정과 판정`

### Task 7: 1단계 — 폭 짝짓기 함수와 측정표

**Files:**
- Create: `src/lib/v2/engine/tiles/road-centerline.ts`
- Modify: `src/lib/v2/engine/tiles/topo-roads.ts`(`topoFrontageWidthM` `:237-248` 옆에 새 함수, 사적 `lineToSiteDistance` `:172-189` 재사용)
- Create: `src/scripts/v2/test-v2-road-centerline.mjs`
- Create: `src/scripts/v2/centerline-width-report.mjs`(test-v2가 아니어서 러너가 돌리지 않는다)
- Create: `.superpowers/sdd/2026-11-05-p4-centerline-contours/stage1-width.md`

**Interfaces:**
- Consumes: Task 4의 `ROAD_CENTERLINE_KIND`, feature properties `widthM`.
- Produces:
  ```ts
  // road-centerline.ts — 좌표는 엔진 hit과 같은 UTM-K 미터
  export const PAIR_SAMPLE_STEP_M = 10;
  export const PAIR_MAX_DISTANCE_M = 10;
  export const PAIR_MAX_ANGLE_DEG = 20;
  export const PAIR_MIN_MATCHED_SHARE = 0.5;
  export interface CenterlineWidth { widthM: number; samples: number; matched: number }
  export function centerlineWidthFor(road: LineString | MultiLineString, centerlines: readonly FeatureHit[]): CenterlineWidth | null;
  // topo-roads.ts
  export function centerlineFrontageWidthM(ctx: EngineContext, radiusM?: number): number | null;
  ```
- **규칙(`centerlineWidthFor`)**
  1. 도로 선을 시작점부터 10 m마다(끝점 포함) 표본점으로 나눈다. 표본점마다 그 점이 놓인 도로 조각의 방향을 잰다.
  2. 표본점에서 10 m 안에 있는 중심선 선분 가운데, 방향 차이(방향 없는 각, 0~90°)가 20° 이하이고 `widthM`이 있는 것 중 가장 가까운 선분의 `widthM`을 그 표본의 폭으로 한다.
  3. 폭이 잡힌 표본이 2개 미만이거나 표본의 50 % 미만이면 null이다.
  4. `widthM` = 잡힌 폭들의 중앙값을 0.5 m 단위로 반올림한 값.
- **`centerlineFrontageWidthM`**: `topoFrontageWidthM`과 같은 규칙(대지와 `widthM/2 + 3 m` 안의 중심선 중 최대 폭)을 `ctx.hits("reference", [ROAD_CENTERLINE_KIND], radiusM)`에 적용한다. 대지 도형이 없으면 중심점 거리. 공통 부분은 사적 함수 하나로 뽑아 두 함수가 함께 쓴다(`topoFrontageWidthM` 출력은 그대로).

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-road-centerline.mjs`(hit은 `{ featureId, geometry, properties: { widthM } }` 꼴로 직접 만든다)
  ```js
  const road = line([[0, 0], [200, 0]]);
  assert.deepEqual(centerlineWidthFor(road, [hit(1, [[0, 2], [200, 2]], 8)]), { widthM: 8, samples: 21, matched: 21 });
  assert.equal(centerlineWidthFor(road, [hit(1, [[0, 12], [200, 12]], 20)]), null, "12 m 떨어진 나란한 도로는 짝이 아니다");
  assert.equal(centerlineWidthFor(road, [hit(1, [[100, -100], [100, 100]], 30)]), null, "직교 교차로는 짝이 아니다");
  assert.equal(centerlineWidthFor(road, [hit(1, [[0, 2], [80, 2]], 8)]), null, "표본의 절반 미만만 잡히면 null");
  assert.equal(centerlineWidthFor(road, [hit(1, [[0, 2], [120, 2]], 6), hit(2, [[120, 2], [200, 2]], 12)]).widthM, 6, "중앙값");
  assert.equal(centerlineWidthFor(road, [hit(1, [[0, 2], [200, 2]], null)]), null, "폭 없는 중심선은 쓰지 않는다");
  assert.equal(centerlineWidthFor(road, [hit(1, [[0, 9], [200, 9]], 4), hit(2, [[0, 1], [200, 1]], 10)]).widthM, 10, "가까운 선분");
  // 고가 아래 지하차도처럼 같은 자리에 두 선이 있으면 가까운 쪽(같은 거리면 featureId 작은 쪽)
  ```
  - `centerlineFrontageWidthM`: 대지 사각형에서 3 m 떨어진 폭 6 m 중심선과 30 m 떨어진 폭 40 m 중심선 → 6. 엔진 fixture(`engine-fixture.mjs`)의 reference에 `road_centerline` feature를 넣어 확인한다.
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-road-centerline.mjs` → 모듈 없음
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 새 테스트, `test-v2-topo-roads.mjs`(바뀌지 않아야 한다) PASS, lint 0
- [ ] **Step 5: 측정 스크립트** — `centerline-width-report.mjs --data <scratch reference 또는 게시 데이터> --sites daechi,pyeongchang --out <md>`:
  - 시도별 `rvwd` 채움률(`widthM` 있음 ÷ 전체), 시도별 중앙값, `rdln`별 `rvwd` 중앙값(단조 증가 여부)
  - 사이트마다 반경 1 km의 이름 있는 OSM 도로(보행·자전거 제외)를 위계별로 세고, `centerlineWidthFor`가 폭을 낸 비율
  - 무작위 40쌍의 대조 HTML(`…\scratchpad\p4\t7\pairs.html`): 쌍마다 작은 SVG(OSM 선 빨강, 짝 중심선 파랑, 30 m 안 다른 중심선 회색)와 위계·폭·표본 비율
- [ ] **Step 6: 측정 실행과 보고** — Task 5 scratch(전국 중심선 적재본)로 돌려 `stage1-width.md`에 표를 쓰고, Task 1의 `rvwd` 정의 원문을 맨 위에 옮긴다. Judge가 40쌍 HTML을 직접 열어 오짝 수를 센다.
- [ ] **Step 7: 커밋** — `feat(v2): OSM 도로–연속수치지형도 중심선 폭 짝짓기와 1단계 측정표(D13 출력은 그대로)`

### Checkpoint U1: D13 2단계 여부 (사용자)

- [ ] Judge가 결정 페이지(my-design-taste 결정 페이지 방식, Artifact)를 만든다: `rvwd` 정의 원문(없으면 「공식 정의 미확인」과 근거), 시도별 채움률, 차로수별 폭, 짝짓기 범위·40쌍 오짝 수, 대치동 503 D13 장에 폭을 붙인 모의 2장, 기준값(10 m·20°·50 %). 선택지는 spec Q8 그대로: **b** 모든 분석에 폭 / **a** 지금대로(업로드 분석만 폭). 추천은 측정값으로 정한다.
- [ ] 답을 원장에 적는다. a면 Task 10을 하지 않고 Task 11에 그 사실을 적는다. 기준값을 사용자가 바꾸면 Task 10 전에 Task 7 상수와 테스트를 고친다.

### Task 8: reference 빌드·게시 (Judge, 사용자 승인 뒤)

**전제:** Task 4·6 통과, 받기(Task 3) 끝, 사용자에게 운영 데이터 전환 승인. 「데이터 버전과 GC」의 R1(원천 교체)이 먼저 끝났거나 이 빌드에 함께 들어간다.

- [ ] **Step 1: 시각·자원** — 부팅 시각·다음 종료, `Get-PSDrive C`(Task 6 어림 + 20 GB 이상), 다른 data-build·data-gc 없음, `.lock` 없음. 남은 시간이 Task 6 어림 + 30분보다 짧으면 시작하되 끊길 것을 전제로 `--resume`을 준비한다(reference는 단계 재개가 된다).
- [ ] **Step 2: 래퍼(Write)** — `C:/SiteAnalysisData/v2/p4-build.sh`(P2 `p2-build.sh` 꼴): `v=<YYYY-MM-DD>-ngii-lines`, `npm run data:build -- --version $v --only reference --raw D:/V-coding/16-SiteAnalysis/.cache/v2/raw --wait-lock 60 --log C:/SiteAnalysisData/v2/build-$v.log`, 버전 폴더가 있으면 `--resume`. 콘솔 로그에 시작·`EXIT`.
- [ ] **Step 3: 시작·감시** — `nohup … &`, Monitor로 `^EXIT`. 단계 진행 줄을 원장에 남긴다. `[gate] FAIL`이면 코드와 상세를 적고, 새 원천(`ngii_centerline`·`ngii_contour`) 때문이면 `--reset-baseline ngii_centerline,ngii_contour`로 같은 이름에 `--resume`.
- [ ] **Step 4: 결과** — `EXIT 0`, `manifest.json` reference가 새 판, 두 원천 release 행·feature 수가 리허설 어림과 ±10 % 안. dev에서 새 분석 하나가 오류 없이 끝나는지.
- [ ] **Step 5: GC** — Task 12 갤러리 뒤로 미룬다(옛 판 비교용).

### Task 9: D17 — 원본 등고선과 등고선 DEM의 상대고 면

**Files:**
- Modify: `src/lib/v2/topo/build.ts:89-104`(`addContourPoints`를 export만)
- Modify: `src/lib/v2/engine/tiles/terrain-shared.ts`(새 함수, 기존 `demReader`·`demGridFor`·`terrainCellM`은 그대로)
- Modify: `src/lib/v2/tile/d17/engine.ts:102-221`
- Modify: `src/lib/v2/engine/tiles/common.ts:44`·`:58`, `src/lib/v2/ui/tile-catalog.ts:64`(D17 sources에 `ngii_contour`)
- Create: `src/scripts/v2/test-v2-d17-contours.mjs`
- 고정값: `test-v2-tile-registry.mjs:49`, `test-v2-topo-run.mjs:41`(D17 키), `test-v2-topo-terrain.mjs:25`(움직이면 근거)

**Interfaces:**
- Consumes: Task 4 `CONTOUR_KIND`·`NGII_CONTOUR_SOURCE_ID`, `interpolateTopoDem`·`TopoDemReader`(`topo/dem.ts:77·116`), `addContourPoints`.
- Produces:
  ```ts
  // terrain-shared.ts
  export const CONTOUR_DEM_PAD_M = 65; // IDW 60 m + 셀 5 m
  export interface ContourDem { reader: TopoDemReader; hits: FeatureHit[]; cells: number; validCells: number }
  export function contourDem(ctx: EngineContext): ContourDem | null;        // 반경 + 65 m 안 contour hit이 없으면 null. memo "dem:contour"
  export function d17DemReader(ctx: EngineContext): TerrainDemReader | null; // 업로드 DEM → contourDem → GLO-30. memo "dem:reader:d17"
  export function d17CellM(ctx: EngineContext): 5 | 30;                     // contourDem이 있거나 업로드가 중심을 덮으면 5
  export function d17GridFor(ctx: EngineContext, cellM: number): TerrainGrid | null; // terrainGridFor와 같은 모양, memo "terrain:grid:d17:<cell>"
  export function d17Sources(ctx: EngineContext): SourceRef[];               // demSources + (contourDem 있으면) ngii_contour
  ```
- **D17 규칙**
  - reader·격자: `demReader`/`terrainGridFor`/`terrainCellM` 자리에 `d17DemReader`/`d17GridFor`/`d17CellM`. `contourDem`이 null이면 지금과 같은 값이 나와야 한다(Review Focus 1).
  - 면 격자: `contourDem`이 있으면 `d17GridFor(ctx, 10)`(판단 기록의 측정 규칙으로 5·15 m). 없으면 지금 규칙(`d17/engine.ts:130`) 그대로.
  - 선: `contourDem`이 있으면 `terrainContourLines` 대신 contour hit을 `clipLineToCircle`로 자르고, 각 조각을 **200점 이하로 나눠**(꼭짓점을 버리지 않는다. 이웃 조각은 끝점을 공유) `lineCandidate`에 넣는다. layer `contour`, `contourInfo(\`${elevationM}m\`)`로 이름·우선순위·강조를 정하고, 계곡선은 `capPriority: 1`. fid는 `contour:<stableId>:<part>:<chunk>`.
  - 지표: `contourDem`이 있으면 `obs("contour_dem_pct", "등고선 보간 셀 비율", …, "%", "d17-contour-dem@1:원 안 셀 중심 중 전국 등고선 보간이 유효한 셀÷원 안 셀")`을 더한다. `contour_interval_m`(5)은 그대로.
  - 한계: `contourDem`이 있으면 「등고선은 연속수치지형도 원본 선이고, 지형(상대고 면·중심 표고)은 그 선을 보간한 추정입니다. 원 안 n %는 등고선 간격이 넓어 30m DEM(EGM2008)으로 채웠고, 두 자료의 높이 기준이 달라 경계에 단차가 생길 수 있습니다.」(n = 100 − `contour_dem_pct`, 소수 1자리). 선이 상한에 걸리면 `{ kind: "partial", note: \`등고선 ${total}개 조각 중 ${shown}개만 표시했습니다(계곡선 우선).\` }`. 업로드가 있으면 지금 `topoTerrainLimitation`을 함께 둔다.
  - 원천: `d17Sources(ctx)`. 판단 문장(`d17/engine.ts:210`)의 「25m 배수 표고 라벨을 포함한 절대고 등고선」은 등고선이 원본일 때 「연속수치지형도 원본 등고선(25m 배수 표고 라벨)」으로 바꾼다.
  - 리비전: `TILE_CACHE_REVISION.D17`과 `NO_TOPO_CACHE_REVISION.D17` 끝에 `+contour-src-r1`.

- [ ] **Step 1: 정본 읽기와 실패하는 테스트 작성** — 정본 §9-4·§9-8 D17 줄·§9-12를 읽고, `ui-ux-pro-max`·`my-design-taste`로 「원본 선 + 면」이 정본 등고선 색·계곡선 규칙에 맞는지 보고서에 한 줄 적는다. `test-v2-d17-contours.mjs`(엔진 fixture에 `terrain: true`, reference에 contour feature를 넣는다)
  - ① 원뿔 fixture(중심 150 m, 반지름 20 m마다 5 m씩 낮아지는 동심원 등고선, 각 600점) → D17 `lines` 중 layer `contour`의 고유 표고 수 = 반경 안 등고선 수, `name`은 125·100 m에만 `표고 125m`·`표고 100m`, 그 밖 null
  - ② 600점 원 하나의 조각들의 꼭짓점 합 = 600 + 조각 수 − 1(공유 끝점), 모든 조각 ≤ 200점. 등고선 2,100개 조각 fixture → `lines.length ≤ 2000`, 계곡선 조각은 모두 남고 `partial` 한계 문구가 위 꼴
  - ③ 등고선 사이가 200 m인 평지 fixture → `contour_dem_pct < 100`, 한계에 「30m DEM(EGM2008)으로 채웠고」
  - ④ 원뿔 fixture에서 등고선 꼭짓점 100곳의 `d17DemReader` 표고가 그 등고선 표고와 0.5 m 안, `center_elevation_m`이 150에 가깝다(±2.5 m)
  - ⑤ 업로드 fixture(`topo-fixture.mjs`) + 전국 등고선이 함께 있으면, 업로드 범위 안 점의 표고는 업로드 DEM 값과 같고 범위 밖은 전국 등고선 DEM 값이다
  - ⑥ contour feature가 없으면 D17 출력 sha256이 `test-v2-topo-terrain.mjs:25`(no-topo)와 같다. `contour_dem_pct`가 없다
  - ⑦ `d17Sources`에 `ngii_contour`가 있고, `sourceDetailsFor`로 만든 D17 출처 행의 `notices`에 가공 문구가 있다
  - ⑧ D18·장면 출력 sha256은 등고선 fixture가 있어도 등고선 없을 때와 같다(전용 reader 확인)
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-d17-contours.mjs` → `contourDem` 없음
- [ ] **Step 3: 구현과 리비전**
- [ ] **Step 4: 면 격자 측정** — 게시된 판(Task 8)으로 평창동 22 2 km에서 면 격자 5·10·15 m의 D17 시간과 오류 여부를 재고 판단 기록의 규칙으로 정한다. 정한 값을 보고서에 적는다. 2 km 등고선 DEM이 5 s를 넘으면(Task 6 Step 3) 같은 결과를 내는 범위에서 고친다.
- [ ] **Step 5: 고정값** — `updating-hash-pinned-baselines`로 움직이는 값을 먼저 보고한다(registry D17 문자열, topo-run D17 키). `topo-terrain.mjs:25`는 ⑥으로 그대로여야 한다. 움직이면 원인을 고친다.
- [ ] **Step 6: 통과 확인** — 새 테스트, `test-v2-topo-terrain.mjs`·`test-v2-tile-registry.mjs`·`test-v2-topo-run.mjs`·`test-v2-source-details.mjs` PASS, lint 0, `node src/scripts/v2/harness/tile-literals.mjs D17`
- [ ] **Step 7: 실데이터 확인** — 평창동 22(1·2 km)·대치동 503·업로드 분석을 refresh하고 D17 장 1440·1024 + PPT SaveAs(시간 기록, 180 s 제한). 원본 선이 면 경계와 어긋나 보이지 않는지, 계곡선 라벨, 선 수·SaveAs 시간을 「전」 캡처와 나란히 둔다.
- [ ] **Step 8: 커밋** — `feat(v2): D17 원본 등고선과 그 선으로 보간한 상대고 면 — 전국 연속수치지형도, 없으면 30m 그대로`

### Task 10: D13 2단계 — 모든 분석에 폭 (Checkpoint U1이 b일 때만, P1 Task 9 뒤)

**Files:**
- Modify: `src/lib/v2/tile/d13/engine.ts`(P1 Task 9 뒤의 줄 — 지금 기준 no-topo 선 루프 `:221-236`, 지표 `:245-249`, 한계 `:254-259`, topo 경로 OSM 조각 `:104-121`)
- Modify: `src/lib/v2/engine/tiles/common.ts:41`, `src/lib/v2/ui/tile-catalog.ts:61`(D13 sources에 `ngii_centerline`)
- Modify: `src/scripts/v2/test-v2-road-centerline.mjs`
- 고정값: `test-v2-tile-registry.mjs:46`, `test-v2-topo-run.mjs:38`, `test-v2-topo-roads.mjs:26`(D13만. `:27` D15·`:28` 장면은 움직이면 안 된다)

**Interfaces:**
- Consumes: Task 7 `centerlineWidthFor`·`centerlineFrontageWidthM`, P1 Task 9의 D13 라벨 대상(우선순위 2)과 topo 경로 `· 폭 Nm` 표기.
- **규칙**
  - 우선순위 2인 OSM 조각(no-topo 경로 전부, topo 경로는 업로드 범위 밖 OSM 조각)에 `centerlineWidthFor(조각이 속한 OSM 도로 전체 도형, ctx.hits("reference", [ROAD_CENTERLINE_KIND], 반경 + 20))`가 값을 내면 상세 줄 끝에 P1과 같은 `· 폭 Nm`을 붙인다. 값이 없으면 붙이지 않는다.
  - no-topo 경로에 `frontage_width_m`(이름·식은 topo 경로 `d13/engine.ts:124-126`과 같게, 식 문자열만 「연속수치지형도 중심선」)을 `centerlineFrontageWidthM(ctx)`로 더한다. topo 경로는 지금처럼 업로드 값을 쓰고, 없을 때만 전국 값을 쓴다.
  - 한계: 「도로 폭은 연속수치지형도 중심선 속성(참고)을 같은 방향·10m 안의 OSM 도로에 붙인 값이며 접도 판정이 아닙니다.」를 더한다(topo 경로의 기존 문구 `:147`은 그대로).
  - 원천: 폭을 하나라도 붙였거나 `frontage_width_m`이 전국 값이면 `ctx.sources("reference", ["ngii_centerline"])`를 sources에 더한다.
  - `mergedRoadLines`·D15·장면은 고치지 않는다.
  - 리비전: `common.ts:41` D13 끝에 `+centerline-width-r1`.

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-road-centerline.mjs`에 「D13」 블록(엔진 fixture에 OSM 도로 + 중심선)
  - ① 나란한 중심선(폭 8)이 있는 이름 있는 국지 도로의 우선순위 2 상세가 `/직선 \d+m · 국지 · 폭 8m$/`
  - ② 짝이 없는 도로는 `· 폭`이 없다
  - ③ `frontage_width_m`이 대지 옆 중심선 폭과 같다
  - ④ sources에 `ngii_centerline`, limitations에 위 문구
  - ⑤ 중심선 feature가 없는 fixture의 D13 출력 sha256이 P1 뒤 `test-v2-topo-roads.mjs:26` 값과 같다. D15·장면 sha256은 중심선이 있어도 그대로다
- [ ] **Step 2: 실패 확인** — 같은 테스트 FAIL
- [ ] **Step 3: 구현과 리비전**
- [ ] **Step 4: 고정값** — registry D13, topo-run D13. topo-roads D13은 ⑤로 그대로여야 한다.
- [ ] **Step 5: 통과 확인** — 위, `test-v2-topo-roads.mjs`·`test-v2-tile-d15-blocks.mjs`·`test-v2-tile-registry.mjs`·`test-v2-topo-run.mjs` PASS, lint 0, `tile-literals.mjs D13`
- [ ] **Step 6: 실데이터 확인** — 대치동 503·평창동 22·업로드 분석을 refresh하고 D13 ① 장 1440·1024 + PPT SaveAs. 업로드 분석의 폭과 같은 도로의 전국 폭이 같은지 표로 적는다.
- [ ] **Step 7: 커밋** — `feat(v2): D13 가까운 도로 라벨과 접한 도로 폭에 연속수치지형도 폭 — 모든 분석(Q8 b)`

### Task 11: 정본·문서 (Judge 주도)

**Files:**
- Modify: `docs/design/v2-design-language.md` §9-4(L156–L198), §10(L331–L334), 결정 이력 표 끝
- Modify: `docs/research/2026-10-26-archimap-benchmark.md`(등고선 갱신일·zip 수)

- [ ] **Step 1: §9-4** — 「분석별 추가 자료」 문구를 「전국 연속수치지형도 도로중심선·등고선은 기본 자료다. 업로드는 선택이며, 올리면 범위 안에서 먼저 쓴다」로 바꾼다(spec §2-5). 영역별 배분 표의 지형 행은 「D17: 업로드 → 전국 등고선 → GLO-30, D18·D29·S01–S04: 업로드 → GLO-30」, 도로 행은 Task 10 결과대로 적는다. 단면은 「업로드가 있을 때만」 그대로.
- [ ] **Step 2: §10** — 출처 표시 이름 예에 `국토지리정보원 연속수치지형도(등고선) · CC BY`를 더하고, 가공물 고지 규칙(출처 장 표 아래 `가공: 본 서비스, 원저작자는 가공물을 보증하지 않음`)을 적는다.
- [ ] **Step 3: 결정 이력** — 2026-11-05 줄: P4 원천(VWorld 다운로드 30182·30185 CC BY), D17 원본 선·등고선 DEM 면(Q10 c), D13 폭(U1 답).
- [ ] **Step 4: 벤치마크 정정** — 등고선 「2026-10-06 갱신」 → 「SHP 2026-10-01(10-06은 목록 xlsx 날짜)」, 「약 20개 zip」 → 「19개」(spec §2-5).
- [ ] **Step 5: 커밋** — `docs(v2): 정본 — 전국 연속수치지형도(도로중심선·등고선) 기본 자료, 가공 고지, D17·D13 결정 이력`

### Task 12: 인수 (Judge)

- [ ] **Step 1:** `npm run lint` 0, `npm run test:v2` 전체 PASS(마지막 줄 첨부. 첫 실패에서 멈추면 고친 뒤 그 파일부터 다시).
- [ ] **Step 2:** 고정값 표 — 6개 파일 64-hex 전부를 `updating-hash-pinned-baselines` 「Find every pin first」로 보고: 움직인 것(registry D13·D17, topo-run D13·D17)과 근거, 그대로인 것(topo-terrain D17·장면, topo-roads D13·D15·장면).
- [ ] **Step 3:** 화면 1440·1024 — 네 QA 분석의 D13·D17 장을 `capture-pages.mjs` + `measure.mjs`로 잰다(겹침·열 밖 글자·잘림 0). 정본 §9-4·§9-8·§9-12와 대조. 출처 장에 두 원천 행(제공처 국토지리정보원·자료명·기준일·`CC BY 2.0 KR(저작자표시)`·VWorld 링크)과 가공 고지가 있는지, 카드 출처 줄이 결정 문구인지 본다. 가이드(`ui/guide-sources.ts`가 그리는 표)에도 같은 행이 있는지 본다.
- [ ] **Step 4:** 업로드 대조 — 업로드 분석에서 D13 폭이 같은 도로의 전국 폭과 같은지, D17 전국 원본 선이 업로드 등고선과 겹치는지(같은 표고 선의 꼭짓점 거리 중앙값 ≤ 1 m)를 표로 적는다(spec §3-1 E).
- [ ] **Step 5:** PPT SaveAs 같은 장, 화면과 나란히. 시간 기록(180 s). `node tools/qa/export-pdf-png.mjs fe9e688b <out> pdf`·`png` → `tools/qa/pdf-images.mjs`로 빈 쪽·잉크·내장 이미지 확인.
- [ ] **Step 6:** 저장 분석이 옛 판으로 열리고 D17·D13이 옛 모양인지(고정 버전) 확인한 뒤 GC(「데이터 버전과 GC」 명령). deleted 목록에 현재·이전 매니페스트와 고정 버전이 없는지, 확보 용량을 적는다.
- [ ] **Step 7:** 최종 브랜치 리뷰(Opus) → 지적 수정 → 사용자에게 운영 배포 여부를 묻는다. vault 세션 노트(`ai-memory:obsidian-memory`). 원장에 라우팅 기록 줄(`task | role | requested | actual | QA | Judge`).

---

## 범위 밖

- 전국 5 m DEM 격자, D18 해상도, D29·S01~S04 지형 원천 교체(spec 비목표).
- 도로경계 면(`N3A_A0010000`, dsId 30179)으로 도로를 실제 폭의 면으로 그리기(조사 추천 2, 결정 없음).
- 도로명주소 도로구간(30055, CC BY-NC-ND)·실폭도로(30057, 미지정).
- 단면 A–A′·B–B′를 업로드 없는 분석으로 넓히기(열린 질문 1).

## 열린 질문

1. **(사용자) 단면을 모든 분석으로 넓히는가.** 정본 §9-4는 단면을 「수치지형도가 있을 때만」 둔다. 전국 등고선이 생기면 모든 분석에서 같은 단면을 만들 수 있다. 이 계획은 그대로 두었다(단면은 업로드 분석만, `terrain-section.ts:304`는 지금 reader). 넓히면 D17 장 모양이 모든 분석에서 바뀌어 시안이 필요하다.
2. **(사용자) 표고점(dsId 30245, 126 MB, CC BY)을 더하는가.** 업로드 보간은 등고선 + 표고점이다(`topo/build.ts:268-271`). 평지는 등고선 간격이 넓어 Review Focus 2의 GLO-30 채움이 커진다. 같은 계열·같은 라이선스지만 사용자 결정 목록에 없어 넣지 않았다.
3. **(Judge) 사분면 IDW → TIN.** `topo/dem.ts:105`의 shortcut 주석대로 IDW는 등고선 사이에 계단이 남는다. 품질 우선 기준으로는 제약 Delaunay(TIN)가 낫다. 업로드 경로와 같이 바뀌므로 이 계획 밖 별도 Task로 둘지 정한다.
4. **(Judge) 도로중심선 가공 고지.** 결정은 등고선 가공물에만 고지를 정했다. D13 2단계는 중심선 폭을 OSM 도로에 붙이는 가공이다. CC BY 2.0은 2차적 저작물에 원저작물 이용 표시를 요구한다. 기본값은 Task 10에서 `ngii_centerline` 정의에도 같은 고지문을 더하는 것이다(지금 Task 4에는 넣지 않았다).
5. **(Judge·사용자) 등고선 저장 위치.** Task 5·6 측정이 기준을 넘으면 전용 표로 옮긴다(판단 기록). 그와 별도로, 등고선이 reference에 들어가면 이후 모든 reference 빌드가 등고선 적재 시간을 함께 쓰고, 저장 분석이 고정한 판마다 수십 GB가 남는다. terrain 파일에 두는 길은 spec이 「새 종류 금지」만 막았으므로 가능하지만 terrain builder에는 단계 재개가 없다. Task 6 수치로 정한다.
6. **(사용자) 운영 데이터 전환 시점.** Task 8 게시는 운영 새 분석에도 바로 적용된다. 옛 운영 코드는 새 kind를 읽지 않으므로 오류는 없지만 reference 크기가 커진다. P2 판정(Ruling 49)과 같이 사용자 승인 뒤에 한다.
7. **(Judge) 짝짓기 기준값.** 10 m는 spec, 20°·표본 50 %·0.5 m 반올림은 이 계획의 제안이다. U1에서 사용자에게 함께 보인다.
8. **(자료) Task 1 뒤에야 아는 것:** 목록의 지역·제목 꼴, 큰 zip에 RaonK가 필요한지, UFID 중복, `rvwd` 공식 정의. 결과에 따라 Task 2의 파일 이름 규칙과 Task 4의 stableId 규칙을 고친다.

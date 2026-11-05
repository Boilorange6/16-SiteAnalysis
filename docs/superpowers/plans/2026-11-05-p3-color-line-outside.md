# P3 지도 색·선·원 밖 바탕 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 반경 원 밖에 회색조로 옅게 한 바탕지도(건물·도로·녹지·물)를 그리고(D, Q1 B 세기 0.50), 지도 면의 색·선·범례 견본을 결정대로 고친다(C: 구역 흰 선 0.6u·둥근 모서리, 단계 면 45 %, A09 5군 색 55 %, A12 세분 색표 50 %, D03 미상 회색, D29 건물 선, 옅은 점 윤곽, 범례 견본 = 지도 표식). 보드 카드·펼침 창·보고서·PNG·PDF·PPT가 같은 모양이다.

**Architecture:** 엔진 `buildScene`이 반경 밖 사각 범위를 bbox 질의로 읽어 장면의 선택 필드 `outer`에 2D 도형만 담는다(원 밖 부분만, 1 m 단순화, 범위 상자로 자름). `scene.buildings`·`counts`·`context`는 그대로라 S01~S04·DXF/GLB/3DM 입력과 벡터 바탕 사용 판정은 움직이지 않는다. 렌더는 원 밖 묶음을 미리 계산한 회색(채도 0) 색으로 원 안 묶음 아래에 그리고, 그 위에 「틀 − 원」 모양의 바탕색 막(불투명도 0.50)을 한 장 덮는다. 이 두 단계는 장면 값(`MapScene.outside`)으로 정해져 화면 `MapFigure`와 PPT 도형이 같은 순서·같은 색으로 그린다. VWorld 일반·항공 바탕은 화면이 같은 결과를 SVG 필터로 만들고, PPT는 그 화면을 구운 배경 그림을 그대로 쓴다. 색·선은 `map-layers.ts` 한 곳(`LAYER_STYLES`·`POLYGON_TONES`·`polygonPaint`)에서 바꾸므로 렌더 전용이고, 범례 label이 엔진 결과에 실리는 A09와 레이어 id가 바뀌는 A12만 리비전을 올린다.

**Tech Stack:** Next.js 15 · TypeScript · zod · React SVG · pptxgenjs 3.12 · jszip · better-sqlite3 · @turf/turf · 테스트 `src/scripts/v2/test-v2-*.mjs`(`npx tsx`)

**Spec:** `docs/superpowers/specs/2026-11-03-labels-map-expression-design.md`(확정 2026-11-03). 이 계획은 §2-3 C(C-1~C-8)·§2-4 D 전문, §3 P3 행(258행)과 순서 2·4, §3-1 C·D 검증, §3-2 C·D 행, §4-1 Q1 B·Q2·Q4 c·Q5와 Judge 판정 5·6·7·9를 구현한다. **spec보다 뒤의 사용자 결정이 우선한다:** 정본 `docs/design/v2-design-language.md` 결정 이력 2026-11-05 A09_GROUPS A(군 색·채움 55 %)·A12_ZONING C(세분 색표·채움 50 %), §1·§6·§8-1·§9-12의 P3 표시 문장. file:line은 HEAD `044aa261`(브랜치 `v2-cartography`, 2026-11-05) 기준이다. 실행자는 spec·정본·이 계획을 함께 읽는다.

**순서 바꿈(사용자 질문 「원 반경 밖 지도 표현은 언제 반영할거야?」, 2026-11-05):** spec §3 순서 4는 D를 C 뒤에 두었다. 이 계획은 D를 맨 앞에 둔다. spec이 C 뒤에 둔 이유 두 가지는 이렇게 지킨다. ① Q1 B 첫 캡처 확인은 Checkpoint D5에서 지금 안쪽 톤으로 한 번, Checkpoint C에서 최종 안쪽 톤(45 %·0.6u)과 함께 한 번 더 본다. ② 「PPT 무게는 C·D가 합쳐진 장에서 잰다」는 인수 Task에서 다시 잰다.

## Global Constraints

- **정본 필독.** 화면·타일·펼침 창·PPT를 고치는 Task는 시작 전에 `docs/design/v2-design-language.md` §1·§6·§8-1·§9·§9-11·§9-12·§9-13·결정 이력을 읽는다. 정본에 없는 패턴은 만들지 말고 보고한다. UI Task(D2~D4, C1~C7)는 `ui-ux-pro-max`와 `my-design-taste`를 쓰고 보고서 끝에 `taste 후보: <한 줄|없음>`을 적는다.
- **결정값(그대로 쓴다)**
  - 원 밖: 바탕을 채도 0으로 바꾸고 바탕색 위에 불투명도 **0.50**으로 얹는다(Q1 B, 판정 5). 원 밖 이름 라벨은 두지 않는다. 분석 결과는 원 안에만(`clipPath r`), `isUnclippedZoneLayer` 구역 면 예외는 그대로. 흰 바탕은 원 밖에 바탕색만. 지금 화면의 어두운 막 9 %(`map-figure.tsx:1482`)는 없앤다.
  - 구역 면 흰 외곽선 **0.6u**·화면 `strokeLinejoin="round"`(Q2, 정본 §9-12).
  - 단계 면 채움 **45 %**(결정 ramp). A09 **55 %**, A12 **50 %**(결정 이력 2026-11-05). 인접 단계 목표 ΔE2000 ≥ 6(spec Judge 제안, 정본의 A09·A12 결정 페이지와 같은 ΔE2000).
  - A09 5군 + 미확인: 계획(정비계획·구역지정) `#EE7FB0` · 추진(추진위·조합) `#C2479A` · 사업(사업시행·관리처분) `#8450C0` · 공사(착공) `#3F5CB8` · 완료(준공) `#5F7F93` · 미확인 `#A9A3A6`. 범례는 군 이름, 설명선 상세 줄은 세부 단계 그대로.
  - A12 세분 색표(결정 페이지 https://claude.ai/artifact/5FGp43PEukTvdbF4ujsudQ C안 전문): 제1종전용주거 `#FFFFDC` · 제2종전용주거 `#FFFF96` · 제1종일반주거 `#F0EA82` · 제2종일반주거 `#D6C83A` · 제3종일반주거 `#E3A33B` · 준주거 `#B08A2E` · 중심상업 `#FF6E6E` · 일반상업 `#FF8C8C` · 근린상업 `#FFD2D2` · 유통상업 `#FFBEBE` · 전용공업 `#EBD7FA` · 일반공업 `#E1BEFA` · 준공업 `#D29BFA` · 보전녹지 `#C8FA8C` · 생산녹지 `#82F005` · 자연녹지 `#78DC0A` · 계획관리 `#64C8C8` · 생산관리 `#96DCDC` · 보전관리 `#C8F0F0` · 농림 `#96FA96` · 자연환경보전 `#46FA46`(모두 이름 끝 「지역」).
  - D03 용도 미상: 선·빗금 없는 회색 채움 `#94A3B8` **35 %**(Q4 c, 판정 6). 추정 빗금(§8-1)은 그대로.
  - 범례 견본 = 지도 표식 모양(점은 원, 선은 선, 면은 면 칸, 기호·번호 원은 그 모양), 견본 색 = 지도와 같은 합성색, 대지 견본은 그린 표식대로(필지 있으면 ◇ + 윤곽, 없으면 크로스헤어 링)(Q5, 판정 7). **노선색 원 + 약칭 견본은 시안 대기**라 이 계획의 Task로 구현하지 않는다(Checkpoint R).
- **장면 입력 분리(spec §1-3):** `outer`는 `scene.buildings`·`scene.counts`·`scene.context`에 섞지 않는다. S01~S04·DXF·GLB·3DM은 `scene.buildings`만 읽으므로 그대로여야 한다. `SCENE_VERSION`은 올리지 않는다(선택 필드).
- **리비전:** A09 `+stage-groups-r1`(P1 T12의 `+zone-vertices-r1` 뒤에 한 번 더 — P1 Ruling 46-4), A12 `+zoning-fine-r1`. 그 밖 C·D는 렌더 전용이라 올리지 않는다. 장면은 타일이 아니다(장면 해시 3곳만 움직인다).
- **고정값:** 64-hex는 `test-v2-topo-run.mjs`(cache key)·`test-v2-topo-supplement.mjs`·`test-v2-topo-roads.mjs`·`test-v2-topo-terrain.mjs`, 리비전 문자열은 `test-v2-tile-registry.mjs:25-58`. 고칠 때는 `updating-hash-pinned-baselines`를 따르고 보고서에 「바뀐 키만 지웠더니 옛 해시와 같다(stripped == old <hash8>)」를 남긴다. 다르면 멈추고 diff를 보고한다.
- **편집:** Edit/Write 도구로만 한다. `sed -i`·python·node·셸 heredoc으로 파일을 고치지 않는다(P1 T12c에서 sed·node 스크립트 편집 위반이 있었다). `git stash`를 쓰지 않는다(RED는 구현 전에 테스트를 먼저 돌려 확인한다). 바꿀 줄만 바꾼다.
- 사용자에게 보이는 말은 한국어, 수는 `toLocaleString("en-US")`.
- **테스트:** 하나씩 `npx tsx src/scripts/v2/test-v2-<name>.mjs`, 타입 `npm run lint`, 공유 코드 타일 문자열 검사 `node src/scripts/v2/harness/tile-literals.mjs <codes…>`. **전체 `npm run test:v2`는 Judge가 인수 Task에서 한 번만** 돌린다.
- **화면 QA**
  - 서버 `http://localhost:3200/site`(Judge가 띄운 서버를 다시 쓴다. 새로 띄우지 않는다. `V2_DATA_DIR=D:/V-coding/16-SiteAnalysis/.cache/v2/data`). 장면 코드를 바꾼 뒤 refresh한 장면에 `outer`가 없으면 Judge에게 서버 재시작을 요청한다(작업 러너가 옛 모듈을 쥐고 있을 수 있다).
  - 로그인 `devqa` + 로컬 `DEV_QA_PASSWORD`. 비밀번호는 어디에도 적지 않는다.
  - 분석(P1 원장과 같다): 대치동 503 1 km `fe9e688b-f7d0-4eda-b00a-7867ea6636ee`, **건물이 촘촘한 대지** 갈현동 545 1 km `eb7210b9-344b-4eb7-88bd-f808fe35fb62`, 반경 2 km 대치동 503 `541bd2cf`(devqa 소유), 고덕동 693 `f7550b02-61ab-4ff3-9017-a47edb750e8c`. 쪽 번호(대치·갈현 같음): A01 2 · A02 3 · A03 4 · A04 5 · A05 6·7 · A06 8·9 · A07 10 · A08 11 · D03 17 · D04 18 · D05 19 · D10 20 · D12 22 · D13 23. 나머지(A09·A11·A12·D16·D17·D18·D19·D28·D29)는 실제 장에서 확인해 원장에 적는다.
  - 캡처 1440×900·1024×768 `node tools/qa/capture-pages.mjs <id> <out> --widths 1440,1024 --pages <쪽>`. PPT는 `node tools/qa/export-pptx.mjs <id> <out> 1440 editable` → `powershell -NoProfile -ExecutionPolicy Bypass -File tools/qa/render-pptx.ps1 -Pptx <f> -Out <dir> -TimeoutSec 180`(PowerPoint Presentation SaveAs PNG, 지도 도형이 많은 장이라 Slide Export는 쓰지 않는다). PDF·PNG는 `node tools/qa/export-pdf-png.mjs <id> <out> pdf|png` → `node tools/qa/pdf-images.mjs`(실제 렌더·불투명 픽셀·잉크·내장 이미지).
  - **PowerPoint 남김 정리:** SaveAs 뒤 `Get-CimInstance Win32_Process -Filter "Name='POWERPNT.EXE'" | Select-Object ProcessId,CreationDate,CommandLine`로 보고, 명령줄에 `/AUTOMATION`이 있고 이 Task가 시작한 뒤 생긴 것만 `Stop-Process -Id <pid> -Confirm:$false`로 끈다. 사용자가 연 PowerPoint는 건드리지 않는다. 끈 PID를 원장에 적는다.
  - 캡처·중간 파일은 scratchpad `…\scratchpad\p3-color-line-outside\<Task>\`에 둔다.
  - 엔진을 바꾼 Task(C3·C4) 뒤에는 dev DB 해당 행 `cache_key` 끝에 `#stale-20261105-<task>`를 붙여(삭제 금지, P1 방식) `node tools/qa/refresh-analysis.mjs <id> <out.json>`로 다시 계산한다. 렌더 전용 변경은 저장 분석에 바로 보인다.
- 커밋은 Task(또는 Step에 적은 단위)별로 `feat(v2):`·`fix(v2):`·`docs(v2):` + 한국어 요약 + 실제 실행 모델의 Co-Authored-By 줄. push·배포는 하지 않는다. 재적재는 없다. 데이터 파일은 읽기만 한다.

## 실행자 라우팅

| 역할 | 누가 | 근거 |
|---|---|---|
| 구현 D1~D4, C1~C7 | **Sonnet high 실행자**(계획서 예외 — 사용자가 P1·P2 계획에서 정한 관행: 디자인 스킬·Playwright 캡처·같은 실행자 `SendMessage` 재개) | **Judge가 디스패치 때 `routing-work-by-model-tier`로 다시 정하고**, 모델을 명시해 고른 뒤 실제 모델을 원장에 적는다 |
| Task 리뷰 | Opus(Judge 또는 같은 모델 서브에이전트) | 실행자 PASS를 그대로 받지 않는다. 캡처는 Judge가 직접 연다 |
| 준비, Checkpoint D5·C·R, 정본, 인수 | Judge | 정본은 사용자 결정의 기록이다 |
| 전체 `npm run test:v2` | Judge, 인수 Task에서 1회 | |

실행자 브리프: 상위 목표 줄 다음에 `역할: 실행자. 직접 구현한다. 하위 에이전트는 읽기 전용 조사에만 쓴다.` + `Judge가 이미 나눈 단위이니 분할 보고 금지` + 정본 필독 줄 + `ui-ux-pro-max`·`my-design-taste` 사용 + 이 계획의 해당 Task 전문 + Global Constraints + 원장 경로. 보고서는 `collecting-tdd-ledger-reports` 형식(RED·GREEN 원문 포함)과 `taste 후보:` 줄.

## 원장과 재개 (회사 PC 06:00·18:00 종료)

- 원장: `.superpowers/sdd/2026-11-05-p3-color-line-outside/progress.md`. 맨 위에 계획·spec 경로, 시작 HEAD, 라우팅 표, QA 분석 id·쪽 번호를 적는다.
- Task 하나는 한 세션(2~3시간) 안에 끝나는 크기다. 시작 전에 `(Get-CimInstance Win32_OperatingSystem).LastBootUpTime`과 현재 시각을 본다. 다음 종료까지 3시간 미만이면 그 Task를 시작하지 않는다.
- 원장 줄 형식: `T<n> S<k> 완료 · <커밋 해시|미커밋> · 다음: <Step>`. 오래 걸리는 명령(refresh·export·SaveAs·측정 스크립트) **앞**에도 `T<n> S<k> <명령> 시작(긴 명령) · <커밋|미커밋>`을 남긴다.
- 재개할 때는 부팅 시각, 원장 마지막 줄, `git status`, 남은 node·POWERPNT 프로세스를 먼저 본다. 남은 프로세스는 정지하고 확인한다.

## Review Focus

1. **장면 입력이 오염된다.** `outer` 건물이 `scene.buildings`·`counts`에 들어가거나 상한 판정(`base.flaw = "truncated"`)을 건드리면 S01 매스·그림자·DXF/GLB/3DM 건물 수가 바뀌고 벡터 바탕이 꺼진다. → Task D1 Step 1 ④·⑥
2. **옛 저장 장면·흰 바탕·바탕을 끈 칸.** `outer`가 없는 옛 장면은 원 밖이 지금처럼 비어야 하고(오류·회색 띠 없음), 흰 바탕과 `transparent`(PPT 값 래스터 PNG)에는 막이 없어야 한다. → Task D2 Step 1 ⑤·⑥
3. **화면 ≠ PPT.** 회색 식·막 순서가 화면과 PPT에서 다르면 원 밖 색이 갈린다. 특히 원 밖으로 걸치는 값 래스터(D10 수관 등)는 화면에서 막 아래인데 PPT에서 막 위면 다르다. → Task D2 Step 1 ③·⑤, Task D3 Step 1 ②, Task D3 Step 5 픽셀 표본
4. **타일별 바탕 생략이 원 밖에 안 먹는다.** D13(도로 생략)·A01·A10(철도·역 생략)과 사용자가 숨긴 층(`baseHide`)이 원 밖 회색 묶음에도 적용돼야 한다. 안 그러면 D13 원 밖에 회색 도로가 남는다. → Task D2 Step 1 ②
5. **PPT가 무거워져 SaveAs가 멈춘다.** 원 밖 넓이는 원의 2.36배 이상이다(spec §2-4). 벡터 바탕 장의 slide XML·SaveAs 시간이 2배를 넘으면 멈춘다. → Task D3 Step 6

---

## 파일 구조

| 파일 | 맡는 일 | Task |
|---|---|---|
| `src/lib/v2/scene.ts` | `SceneOuter`·`Scene.outer?`·스키마·`isPreOuterScene` | D1 |
| `src/lib/v2/engine/tiles/geo.ts` | `clipLineOutsideCircle`·`polygonOutsideCircle`·`simplifyPathM` | D1 |
| `src/lib/v2/engine/scene.ts` | `buildSceneOuter`(bbox 읽기·원 밖 자르기·범위 자르기·가까운 순 상한), 범위·상한 상수 | D1 |
| `src/lib/v2/engine/jobs.ts` | worker 장면 갱신 조건에 `isPreOuterScene` | D1 |
| `src/scripts/v2/engine-fixture.mjs` | `options.outer`(반경 밖 건물·도로·녹지·물) | D1 |
| `src/lib/v2/ui/basemap.ts` | `MapBase.outer` | D2 |
| `src/lib/v2/ui/map-scene.ts` | 원 밖 회색 묶음, `grayHex`, `OUTSIDE_TONE`, `MapScene.outside` | D2 |
| `src/components/v2/map-figure.tsx` | 9 % 막 제거, 타일 회색 사본, 원 밖 막, 면 둥근 모서리 | D2·C1 |
| `src/lib/v2/report/map-pptx.ts` | 원 밖 묶음 이름, `addOutsideVeil`, 면 선 | D3·C1·C5 |
| `src/lib/v2/ui/map-layers.ts` | 톤·색·A09 군·A12 세분·미상·D29, `legendSwatchShape` | C1~C5·C7 |
| `src/lib/v2/engine/tiles/zoning-shared.ts`, `src/lib/v2/tile/a12/{engine,d08,view}.ts` | A12 세분 레이어 id | C4 |
| `src/lib/v2/report/chart-geometry.ts` | 거리 그래프 옅은 점 윤곽 | C6 |
| `src/components/v2/map-legend-strip.tsx`, `src/components/v2/report/slide-surface.tsx`, `src/lib/v2/report/render-pptx.ts` | 범례 견본 세 경로 | C7 |
| `src/lib/v2/engine/tiles/common.ts` | A09·A12 리비전 | C3·C4 |
| 새 테스트 `test-v2-scene-outer.mjs`(D1), `test-v2-outside-basemap.mjs`(D2), `test-v2-legend-swatch.mjs`(C7) | | |
| `docs/design/v2-design-language.md` | §9-12 원 밖 줄, 톤 줄, P3 표시 정리, 결정 이력 | D5·정본 |

## 판단 기록 (spec이 계획에 맡긴 것)

- **원 밖 도형은 원 밖 부분만 담는다.** 도로는 `clipLineToCircle`(`geo.ts:129-167`)의 여집합 구간, 녹지·물은 `clipToCircle`(`geo.ts:365`)과 같은 96각형을 뺀 나머지, 건물은 반경 질의(`ctx.hits("buildings", ["building"])`)에 걸린 feature를 뺀 나머지다. 그러면 원 안 장면과 겹치는 도형이 없어 그리기 순서에 기대지 않고, 페이로드도 줄며, 원 안 장면이 상한(`SCENE_MAX_ROADS` 4,000·`SCENE_MAX_CONTEXT_POLYGONS` 2,000, `engine/scene.ts:152-153`)에 걸려도 원 안에 회색이 비치지 않는다.
- **원 밖 도형은 범위 상자로 자른다**(`@turf/turf` `bboxClip`). bbox 질의는 상자에 걸친 도형 전체를 돌려주므로(`features.ts:324-`) 몇 km짜리 숲·하천이 통째로 실리는 것을 막는다.
- **범위는 spec 값을 그대로 쓰지 않고 잰다.** spec ±2.2r × ±1.2r는 「원 지름 ≈ 0.9 × 높이」 어림이다([계산 추정]). HEAD 기본 맞춤은 `fill 0.8`(`map-projection.ts:35-50`, 지름 = 0.8 × 높이)이라 ① 틀(960×519)의 세로 반폭이 1.25r로 spec 범위를 넘는다. 설명선 개요 장은 `SLIDE_OVERVIEW_FILL` 0.72(`callout-layout.ts:499`), D17 단면 배치는 `mapFill` 0.28~0.52(`overlay-layout.ts:268`)다. D1 Step 5에서 기본 보기들의 보이는 사각형을 r 배수로 재고 Judge가 정한다(열린 질문 1).
- **원 밖 건물은 철거 판정을 하지 않는다.** 판정(`filterRetiredRows`, `buildings-shared.ts:607`)에는 `building_fact`·대장·필지 결합이 필요하다. 원 밖은 회색조 바탕뿐이고, 겹친 옛·새 바닥은 화면 `mergeOverlapping`(`basemap.ts:48`)이 한 모양으로 합친다. D1 Step 5에서 원 밖 겹친 바닥 비율을 재 보고한다(열린 질문 2).
- **원 안 장면이 상한에 잘린 분석은 `outer`를 읽지 않는다.** 그 분석은 벡터 바탕을 쓰지 않는다(`basemap.ts:61-63,70`). 2 km 분석은 대개 VWorld 바탕이 되고, 그 원 밖 회색은 화면 필터와 PPT 배경 그림이 맡는다.
- **수치지형도 분석의 원 밖 도로도 OSM이다.** 원 안 도로는 `mergedRoadLines`(`engine/scene.ts:368`)를 쓰지만 원 밖은 회색 바탕이라 위계 폭(`roadWidthM`, `engine/scene.ts:166`)으로 충분하다.
- **worker 갱신 조건을 하나 더한다(spec §2-4 「리비전과 저장 분석」).** `isPreOuterScene` = 맥락층이 있고, `outer`가 없고, 원 안 장면이 상한에 잘리지 않은 장면. 저장 분석은 stale 타일이 있는 refresh 때만 장면을 다시 만든다(`jobs.ts:280,363-366`). 화면을 다시 여는 것은 장면을 만들지 않는다.
- **원 밖 회색은 「미리 계산한 회색 묶음 + 바탕색 막」으로 그린다.** 회색 묶음을 바탕 위에 그리고 「틀 − 원」 막(바탕색, 불투명도 1 − 0.50)을 덮으면, 화면의 「채도 0 그룹을 불투명도 0.50으로」와 겹친 반투명 묶음까지 같은 픽셀이 된다. PPT에는 채도 필터가 없어 이 방식만 화면 = PPT를 보장한다. 회색 식은 SVG `feColorMatrix type="saturate" values="0"`의 계수(0.213·0.715·0.072)를 sRGB에서 쓰고, 화면 필터에 `color-interpolation-filters="sRGB"`를 줘 타일 회색과 벡터 회색을 같은 식으로 맞춘다.
- **막은 값 래스터 위, 주제 면 아래다.** 화면 순서는 바탕(원 밖 회색 → 원 안) → 값 래스터 → 막 → 자르지 않는 구역 면 → 원 안 주제다. PPT 벡터 장은 `addBaseMap` → `options.underlay`(값 래스터 PNG) → `addOutsideVeil` → `addPolygons` 순이다(`map-pptx.ts:1242-1244`). 그래서 원 밖에 걸친 래스터도 화면과 PPT에서 같은 막을 받는다.
- **위성 바탕의 면 채움은 `max(톤 채움, 0.45)`다.** 지금 규칙(`polygonPaint`가 위성이면 0.45, `map-layers.ts:874`)은 낮은 톤을 올리려던 것이라, 55 %·50 %인 A09·A12를 위성에서 낮추지 않는다(열린 질문 9).
- **A09 범례 문구는 `정비사업 · <군>`이다**(지금 `정비사업 · <단계>` 꼴, `map-layers.ts:331-342`). 같은 label은 범례(`legendItems`)와 구성비 그래프(`analysis-charts.ts:98-104`), 엔진 범례(`common.ts:364-369` Set)가 한 항목으로 묶는다(열린 질문 8).
- **A12 레이어 id는 `zone:<분류>:<세분 원천 이름>`이다**(예 `zone:주거:제1종일반주거지역`). 21종 표에 없는 이름(「도시지역(세분 미확인)」 등)은 지금처럼 `zone:<분류>`로 두어 큰 분류 색을 쓴다. 팔레트(§9-11)는 `zone`·`maint_stage` 접두를 다루지 않으므로(`map-palette.ts:97`) 결정 색이 그대로 나온다.
- **D03 미상 label은 「용도 미상」 그대로 둔다.** label을 바꾸면 D03 엔진 범례가 바뀌어 리비전이 든다. 정본 「범례 이름 『미상』으로 구분」은 label에 「미상」이 있어 지켜진다.
- **단계 면 45 %의 대상**은 spec C-2 그대로다: A11 `pop_dens_*`, D16 `dens_q*`, D17 `relief_*`, D18 `slope_*`, D28 `walk_5·10·15`(구역 톤: 흰 0.6u), D04 `bldg_<연대>`, D05 `floors_*`(떨어진 톤: 선 없음). 같은 묶음의 미상·결측·가정 항목도 같은 45 %다(한 범례 묶음 = 한 톤). D04·D05는 spec의 Judge 메모라 Checkpoint C에서 사용자에게 보인다(열린 질문 7).
- **C-7 윤곽은 색 하나가 아니라 대비 규칙이다.** 거리 그래프 점 묶음(`chart-geometry.ts:166`)에서 흰 카드 위 합성 색(점 불투명도 0.8·0.5 반영)의 대비가 3:1 미만이면 윤곽을 둔다. A07 `#BFD7F5`만 고치면 같은 문제를 가진 다른 옅은 색이 남는다(열린 질문 10).

---

### 준비 (Judge — 실행자 작업 아님)

- [ ] 원장을 만든다(계획·spec 경로, 시작 HEAD, 라우팅, QA 분석 id·쪽 번호).
- [ ] dev 서버가 `V2_DATA_DIR=D:/V-coding/16-SiteAnalysis/.cache/v2/data`로 떠 있는지 본다.
- [ ] **전 캡처(비교 기준):** 대치 `fe9e688b`·갈현 `eb7210b9`의 A03 4쪽(①)·D03 17쪽(②)·A09·A12·D18·D19 장을 1440·1024 화면과 PPT SaveAs로 찍어 `…\p3-color-line-outside\before\`에 둔다. 같은 두 분석의 펼침 창(A03)을 바탕 4종(기본·일반·항공·흰)으로 찍는다.

### Task D1: 장면 `outer` — 원 밖 바탕 도형 읽기

**Files:**
- Modify: `src/lib/v2/scene.ts` — `Scene`(`:99-113`), `SceneSchema`(`:209-253`), `isPreBasemapScene` 옆(`:123-126`)
- Modify: `src/lib/v2/engine/tiles/geo.ts` — `clipLineToCircle`(`:129`)·`clipToCircle`(`:365`) 옆
- Modify: `src/lib/v2/engine/scene.ts` — `buildScene`(`:425-`), 장면 객체(`:498-`), 한계 문구(`:471-496`)
- Modify: `src/lib/v2/engine/jobs.ts:14,280`
- Modify: `src/scripts/v2/engine-fixture.mjs`(`options.outer`)
- Test: Create `src/scripts/v2/test-v2-scene-outer.mjs`
- Modify(고정값): `test-v2-topo-supplement.mjs:37`, `test-v2-topo-roads.mjs:28`, `test-v2-topo-terrain.mjs:32`

**Interfaces:**
- Produces:
  ```ts
  // scene.ts — 좌표는 장면 로컬 m(대지 중심 원점), 원 밖 부분만, 범위 상자로 자름, 1 m 단순화
  export interface SceneOuter {
    halfWidthM: number;   // 읽은 상자의 가로 반폭
    halfHeightM: number;  // 세로 반폭
    buildings: Ring[][];  // 반경과 겹치지 않는 건물 바닥, 대지에서 가까운 순, 상한까지
    roads: Array<Pick<SceneRoad, "points" | "widthM" | "hierarchy">>; // 원 밖 구간, 이름 없음
    green: Ring[][]; greenKinds: GreenKind[]; // 같은 길이·순서
    water: Ring[][];
    counts: { buildingsTotal: number; buildingsIncluded: number };
  }
  export interface Scene { /* 기존 */ outer?: SceneOuter }
  export const isPreOuterScene: (scene: Pick<Scene, "context" | "outer" | "counts">) => boolean;
  // geo.ts — EPSG:5179
  export function clipLineOutsideCircle(center: LngLat, radiusM: number, g: Geometry): number[][][]; // clipLineToCircle의 여집합 구간, 꼭짓점·교점 보존
  export function polygonOutsideCircle(center: LngLat, radiusM: number, g: Geometry): number[][][][] | null; // clipToCircle과 같은 96각형을 뺀 면. 계산 실패 null
  export function simplifyPathM(path: number[][], toleranceM: number, closed: boolean): number[][]; // 고정 허용치 Douglas–Peucker(파일 안 segDist 재사용)
  // engine/scene.ts
  export const SCENE_OUTER_EXTENT: { readonly x: number; readonly y: number }; // 반경 배수(Step 5에서 정함)
  export const SCENE_OUTER_MAX_BUILDINGS: number;                              // Step 5에서 정함
  export function buildSceneOuter(ctx: EngineContext, origin: { x: number; y: number }, options?: { maxBuildings?: number }): { outer: SceneOuter; limitations: Scene["limitations"] };
  ```
- 상수는 Step 3에서 spec 값(`x: 2.2`, `y: 1.2`)과 임시 상한으로 두고 Step 5 판정 뒤 바꾼다.
- 읽기: `queryFeaturesInBboxes(ctx.db(key), [[cx − X, cy − Y, cx + X, cy + Y]], kinds)`(`features.ts:324`) 한 번씩 — buildings `["building"]`, reference `["road"]`·`["landuse"]`·`["water"]`. `ctx.hits`는 원 질의이고 5 km 상한이 있어(`features.ts:237`) 쓰지 않는다. 원천이 미적재면 그 층은 빈 배열이고 원 안 장면과 같은 `sources()` 판정을 쓴다.
- `buildScene`은 원 안 장면이 상한에 걸리지 않았을 때만(`rows.length ≤ SCENE_MAX_BUILDINGS` 그리고 `parcelHits.length ≤ SCENE_MAX_PARCELS`) `outer`를 붙인다. 건물 상한에 걸리면 `limitations`에 `{ kind: "partial", note: "원 밖 바탕 건물은 대지에서 가까운 N동까지 그렸습니다." }`를 더한다. `counts`·`buildings`·`context`·`sources`의 기존 값은 바꾸지 않는다(원 밖 원천은 원 안과 같은 원천이라 `sources`에 새 항목이 생기지 않아야 한다 — 생기면 보고).
- 녹지 분류는 `greenKindOf`(`engine/scene.ts:214`), 도로 폭은 `roadWidthM(roadHierarchy(hit))`.

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-scene-outer.mjs`. fixture는 `buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true, roads: true, landuse: true, rail: true, basemap: true, outer: true })`, 반경 800 m(`test-v2-scene-basemap-context.mjs` 방식). `options.outer`는 반경 밖 건물 3동(대지 동쪽 1,000 m·1,300 m·1,600 m), 원을 가로지르는 도로 1개, 원 경계에 걸친 녹지 1개·물 1개, 범위 상자 밖까지 뻗는 녹지 1개를 더한다.
  - ① `scene.outer`가 있다. 모든 `outer.buildings` 고리의 원점까지 최소 거리 ≥ 800 − 0.01이다.
  - ② `outer.roads`의 모든 점이 `Math.hypot(x, y) ≥ 800 − 0.05`다. 가로지르는 도로의 원 안 길이(`context.roads`) + 원 밖 길이 = 원래 길이 ± 0.5 m.
  - ③ 경계에 걸친 녹지·물: 원 안 면적 + 원 밖 면적 = 원래 면적 ± 0.5 %. `greenKinds.length === green.length`.
  - ④ 원 안 불변: 반경 밖 건물 3동은 `scene.buildings`에 없고, `scene.counts.buildingsTotal`은 반경 안 건물 수와 같다. DXF 내보내기(`test-v2-export-dxf.mjs` 방식) 건물 수 = `scene.buildings.length`. 바이트 불변은 Step 4의 장면 해시(stripped == old)로 보인다.
  - ⑤ 범위: 모든 `outer` 좌표가 `|x| ≤ halfWidthM + 1e-6`, `|y| ≤ halfHeightM + 1e-6`이다.
  - ⑥ 상한: `buildSceneOuter(ctx, origin, { maxBuildings: 2 })` → 가까운 두 동(1,000·1,300 m)만, `counts.buildingsTotal === 3`, `buildingsIncluded === 2`. 그 장면의 `mapBaseFromScene(scene).flaw === undefined`(벡터 바탕 유지).
  - ⑦ `simplifyPathM`: 직선에서 0.4 m 튄 꼭짓점은 빠지고 1.5 m 튄 꼭짓점은 남는다. 닫힌 고리는 닫힘을 유지한다.
  - ⑧ `isPreOuterScene`: 맥락 있음·`outer` 없음·안 잘림 → true. `outer` 있음 → false. `context` 없음 → false. `counts.buildingsTotal > buildingsIncluded` → false.
  - ⑨ 왕복: `saveScene` → `loadScene` 뒤에도 `outer`가 남는다(zod가 모르는 키를 지우므로 스키마에 넣어야 한다).
- [ ] **Step 2: 실행해 실패 확인** — `npx tsx src/scripts/v2/test-v2-scene-outer.mjs` → `outer` 없음/함수 없음으로 FAIL. RED 원문을 보고서에 붙인다.
- [ ] **Step 3: 구현** — 위 계약대로. `jobs.ts:280`에 `|| isPreOuterScene(scene)`.
- [ ] **Step 4: 통과·고정값** — 새 테스트, `test-v2-scene-build.mjs`·`test-v2-scene-contract.mjs`·`test-v2-scene-basemap-context.mjs`·`test-v2-basemap-scene.mjs`·`test-v2-rail-scene.mjs`·`test-v2-export-dxf.mjs`·`test-v2-export-glb.mjs` PASS, lint 0.
  - 장면 해시 3곳(`updating-hash-pinned-baselines`): `outer` 키를 뺀 replacer로 다시 해시해 옛 값과 같으면 새 해시로 갱신하고 주석에 날짜·이유를 쓴다. `stripped == old <hash8>`를 세 줄 적는다. 다르면 멈추고 diff를 보고한다.
  - `test-v2-topo-terrain.mjs`의 S01·D17·D18 해시와 `test-v2-topo-supplement.mjs`의 타일 해시, `test-v2-topo-run.mjs`는 움직이지 않아야 한다(PASS).
- [ ] **Step 5: 실데이터 측정(긴 명령 앞 원장 줄)** — scratchpad 스크립트(`npx tsx`)로 현재 manifest를 열고 세 분석(대치 1 km·갈현 1 km·대치 2 km, 중심·반경은 `/api/v2/analyses/<id>`)의 `buildScene`을 돌려 표로 적는다.
  - 기본 보기 범위: `framedViewport`·`slideViewport`로 ① 틀(960×519, siteX 0.5)·② 지도 틀·설명선 개요(fill 0.72)·카드·펼침 창·D17 단면 배치(mapFill 0.28·0.52)의 보이는 사각형 반폭을 r 배수로.
  - `outer` 건물·도로·녹지·물 개수, 원 밖 겹친 건물 바닥 비율, 장면 JSON 바이트와 gzip 바이트(전/후), `buildScene` ms(전/후), 2 km의 원 안 상한 여부.
  - 이 표로 `SCENE_OUTER_EXTENT`(①·②·개요·카드·펼침 창 중 가장 넓은 기본 보기 + 10 %)와 `SCENE_OUTER_MAX_BUILDINGS`(대치·갈현 1 km 원 밖 건물이 모두 들어가는 값)의 후보를 제안하고 **Judge 판정을 받은 뒤** 상수를 넣는다. 테스트 ⑤는 상수와 무관하게 통과해야 한다.
- [ ] **Step 6: 커밋** — `feat(v2): 장면에 원 밖 바탕 도형(outer) — 건물·도로·녹지·물, 원 밖 부분만, 장면 입력과 분리`

리비전: 없다(장면). 고정값: 장면 해시 3곳.

**Judge(D1 수락 뒤):** 세 분석의 dev DB A10 행 `cache_key` 끝에 `#stale-20261105-p3d1`을 붙이고 refresh한다 → worker가 `isPreOuterScene`으로 장면을 다시 만든다. `/api/v2/analyses/<id>/scene`에 `outer`가 있는지 확인하고, **D2 전 캡처**(아직 렌더가 `outer`를 그리지 않는 상태)로 Task D3 Step 6의 「전」 PPT(XML 크기·`a:pt` 수·SaveAs 시간)를 잰다.

### Task D2: 화면 — 원 밖 회색조와 바탕색 막

**Files:**
- Modify: `src/lib/v2/ui/basemap.ts` — `MapBase`(`:12-26`), `mapBaseFromScene`(`:31-64`)
- Modify: `src/lib/v2/ui/map-scene.ts` — `MapSceneBaseBucket`(`:20-32`), `MapScene`(`:732` 근처), `baseProjection`(`:1368-1462`), 장면 반환(`:1905-1917-`)
- Modify: `src/components/v2/map-figure.tsx` — defs(`:1367-1383`), 타일 묶음(`:1422-1439`), 벡터 바탕(`:1442-1460`), 막(`:1482`)
- Test: Create `src/scripts/v2/test-v2-outside-basemap.mjs`

**Interfaces:**
- Consumes: D1 `Scene.outer`
- Produces:
  ```ts
  // basemap.ts — outer가 없는 장면이면 없음. flaw 판정(scene.counts)은 그대로
  MapBase.outer?: { buildings: LngLat[][][]; water: LngLat[][][]; green: { kind: GreenKind; rings: LngLat[][] }[]; roads: { hierarchy: string; widthM: number; points: LngLat[] }[] };
  // map-scene.ts
  export const OUTSIDE_TONE = { saturation: 0, opacity: 0.5 } as const; // Q1 B
  export function grayHex(hex: string): string; // round(0.213R + 0.715G + 0.072B), sRGB
  MapSceneBaseBucket.outside?: true;            // 원 밖 회색 묶음
  MapScene.outside: { bg: string; opacity: number } | null; // null: 원을 그리지 않음·흰 바탕·바탕 없음
  ```
- `baseProjection`은 `base.outer`가 있으면 원 밖 묶음을 **원 안 묶음보다 먼저** 낸다: `outer-water`·`outer-green-<kind>`·`outer-road-casing-*`·`outer-road-fill-*`·`outer-building`. 색은 같은 층 테마 색의 `grayHex`, 굵기·폭 규칙은 원 안과 같다. 필지·철도·역은 원 밖에 없다. `suppress`(타일 `baseSuppress` + `baseHide`)를 원 밖에도 적용한다. 원 밖 이름 라벨은 만들지 않는다.
- `MapScene.outside`: `showRadius`이고 바탕이 벡터(`base` 있음)거나 타일(`tiles.length > 0`)이면 `{ bg: base?.bg ?? "#f2f2ef", opacity: OUTSIDE_TONE.opacity }`(화면 바탕 사각형과 같은 bg, `map-figure.tsx:1410`), 아니면 null.
- MapFigure:
  - `:1482` 9 % 막을 지운다.
  - 막: `scene.outside && !transparent`이면 값 래스터 다음·자르지 않는 구역 면 앞에 `<path data-map-outside="veil" d={dim} fillRule="evenodd" fill={outside.bg} fillOpacity={1 − outside.opacity} pointerEvents="none" />`. `showNativeChrome`과 무관하다(PPT 타일 배경 그림 = `backgroundOnly`에도 들어가야 한다). `:1481`의 조각(`!backgroundOnlyActive || backgroundLayerSet.size > 0`) **밖에** 둔다 — 밀집 층이 없는 타일 바탕 PPT는 `backgroundOnly: []`라 그 조각이 그려지지 않는다.
  - 타일 바탕(`tiles.length > 0 && scene.outside`): 타일 묶음과 그 위 흰·검은 막(`:1422-1439`)을 한 `<g id>`로 묶고, 그 바로 뒤에 `<use href>`로 다시 그리되 원 밖 clipPath(틀 − 원, `clipRule="evenodd"`)와 채도 0 필터(`feColorMatrix type="saturate" values="0"`, `colorInterpolationFilters="sRGB"`)를 준다.
  - 벡터 바탕: 원 밖 묶음은 `baseBucketPaths`가 그대로 그린다(이미 회색).

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-outside-basemap.mjs`(장면은 `test-v2-basemap-scene.mjs` 방식의 손 장면에 `outer`를 더한다)
  - ① `mapBaseFromScene`: `outer` → `base.outer` 길이가 같다. `outer` 없는 장면 → `base.outer === undefined`. `outer.counts`가 잘렸어도 `flaw === undefined`.
  - ② 묶음: 원 밖 묶음이 모두 원 안 묶음보다 앞에 있고 `outside === true`, `fill`/`stroke`가 테마 색의 `grayHex`다. `suppress = {"road"}`(D13) → `outer-road-*` 없음. `baseHide: ["building"]` → `outer-building` 없음.
  - ③ `grayHex("#ff0000") === "#363636"`(0.213 × 255 = 54.3), `grayHex("#808080") === "#808080"`, `grayHex("#0000ff") === "#121212"`.
  - ④ `MapScene.outside`: 벡터 + 원 표시 → `{ bg: theme.bg, opacity: 0.5 }`. 흰 바탕 → null. `showRadius: false` → null. 일반(타일 있음) → `bg "#f2f2ef"`.
  - ⑤ MapFigure 마크업(`renderToStaticMarkup`, 벡터 장면): `fill="#14161c"`가 없다. `data-map-outside="veil"` 경로가 `fill-rule="evenodd"`·`fill-opacity="0.5"`이고, 문서 순서가 `data-map-base="vector"` 뒤(값 래스터가 있는 장면이면 `data-raster` 뒤)·`data-radius-clip` 앞이다. 원 밖 묶음 경로가 원 안 묶음 경로보다 앞이다. `transparent` → 막 없음. 흰 바탕 → 막 없음. 타일 바탕 + `backgroundOnly: []`(밀집 층 없음)와 `backgroundOnly: ["…"]` 둘 다 → 막과 `<use>`(`filter`·`clip-path` 있음)가 있고 필터에 `color-interpolation-filters="sRGB"`가 있다.
  - ⑥ 옛 장면(`outer` 없음): 오류 없이 그리고 원 밖 묶음이 없다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 새 테스트, `test-v2-basemap-scene.mjs`·`test-v2-basemap-overlap.mjs`·`test-v2-map-chrome.mjs`·`test-v2-map-palette-render.mjs`·`test-v2-site-marks.mjs`·`test-v2-polygon-tone.mjs`·`test-v2-map.mjs`·`test-v2-label-render.mjs` PASS, lint 0, `tile-literals.mjs A01 A10 D13`.
- [ ] **Step 5: 화면 캡처(긴 명령 앞 원장 줄)** — 대치·갈현 A03 4쪽(①)·D03 17쪽(②), 1440·1024. 보고서 지도 틀 배경을 `기본`(벡터)·`항공`·`없음`으로, 펼침 창 A03은 바탕 탭 4종(기본·일반·항공·흰)으로. 준비 단계 전 캡처와 나란히 둔다. 원 밖 픽셀 3곳을 떠 「0.5 × 회색 + 0.5 × bg」 계산값과 채널마다 ± 3 안인지 표로 적는다. 첫 그림 시간(펼침 창 열기 → 지도 그림)을 전/후로 적는다.
- [ ] **Step 6: 커밋** — `feat(v2): 원 밖 바탕을 회색조 0.50으로 — 9 % 어두운 막 대신 바탕색 막, 벡터·VWorld 바탕 공통`

리비전·고정값: 없다(렌더).

### Task D3: PPT — 원 밖 묶음·막과 무게 측정

**Files:**
- Modify: `src/lib/v2/report/map-pptx.ts` — `addBaseMap`(`:755-775`), 새 `addOutsideVeil`, `addEditableMap` 순서(`:1242-1244`)
- Check: `src/lib/v2/report/map-image.ts:448-458,511-513` — 타일 바탕의 배경 그림(`backgroundOnly`)에 D2의 회색 사본·막이 들어가는지(코드 변경이 필요하면 이 Task에서)
- Test: `src/scripts/v2/test-v2-ppt-vector-basemap.mjs`(이어 씀)

**Interfaces:**
- Consumes: D2 `MapSceneBaseBucket.outside`, `MapScene.outside`
- 원 밖 묶음의 도형 이름은 `tag(code, \`outer-${bucket.layer}\`, \`바탕 · 원 밖 ${BASE_LAYER_NAME[bucket.layer]}\`, bucket.key)` → `GRP|map-base-outer-building|…`. 「바탕 도형이 그림보다 먼저」 단언(`GRP|map-base-` 접두)은 그대로 성립한다.
- `addOutsideVeil(slide: Slide, code: string, scene: MapScene): void` — `scene.base && scene.outside`일 때만. `addCustom`(`:402-456`)에 닫힌 경로 둘(지도 틀 사각형, 반경 원 다각형)을 넘긴다. 원 다각형은 꼭짓점 사이 처짐이 `BASE_SIMPLIFY_PX`(0.25 px) 이하가 되게 나눈다. 채움 `outside.bg`, `fillOpacity = 1 − outside.opacity`, 선 없음, 이름 `tag("outside", "veil", "원 밖 흐림", "0")` → `GRP|map-outside-veil|…`(조판 칸이면 code를 `${options.scope}-outside`로). 호출 자리는 `options.underlay?.()` 바로 뒤, `addPolygons` 앞이다. 막의 구멍(even-odd)은 SaveAs로 확인한다.
- 타일 바탕(일반·항공) PPT는 배경 그림이 원 밖 회색을 이미 담으므로 도형 막을 더하지 않는다. 흰 바탕은 아무것도 더하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-ppt-vector-basemap.mjs`에 `outer`가 있는 장면 블록을 더한다.
  - ① `GRP|map-base-outer-building|` 도형이 있고 `GRP|map-base-building|`보다 앞이다. 원 밖 묶음도 층마다 도형 하나다.
  - ② `GRP|map-outside-veil|` 도형이 하나이고, 값 래스터 `<p:pic>` 뒤·첫 주제 도형 앞이다. 채움색 = 테마 bg, `<a:alpha val="50000"/>`, `<a:moveTo>` 2개.
  - ③ 프레임 배경 `none`(흰) → 막·원 밖 묶음 없음. `air` → 도형 막 없음, `<p:pic>` 배경 1장.
  - ④ `outer` 없는 옛 장면 → 막은 있고(`scene.outside`는 장면 값) 원 밖 묶음은 없다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `test-v2-ppt-vector-basemap.mjs`·`test-v2-ppt-editable-maps.mjs`·`test-v2-report-doc-pptx.mjs`·`test-v2-analysis-page-pptx.mjs`·`test-v2-polygon-tone.mjs` PASS, lint 0.
- [ ] **Step 5: PPT 실렌더(긴 명령 앞 원장 줄)** — 대치·갈현·2 km를 export → SaveAs(180 s). A03 4쪽·D03 17쪽 PNG를 D2 화면 캡처와 나란히 놓고 원 밖 같은 자리 픽셀 3곳의 차가 채널마다 ≤ 6인지 적는다. 막 구멍이 원 안을 덮지 않는지 본다. PowerPoint 남김 정리.
- [ ] **Step 6: 무게 표(Judge가 D1 뒤에 잰 「전」과 비교)**
  - 장(대치·갈현 A03·D03, 2 km 같은 장)마다 slide XML 바이트, `custGeom` 수, `a:pt` 수, PPTX 전체 바이트, 덱 SaveAs ms, 그 장의 바탕 종류(벡터/일반 — 2 km는 원 안 상한으로 일반일 수 있다)
  - 장면 JSON·gzip 바이트(D1 Step 5 값)
  - **장 XML 크기나 SaveAs 시간이 「전」의 2배를 넘으면 멈추고 Judge에게 보고한다.** 대책(원 밖만 배경 그림으로 굽기, spec §2-4 기준)은 Judge 판정 뒤 따로 한다. 임의로 만들지 않는다.
- [ ] **Step 7: 커밋** — `feat(v2): PPT 원 밖 바탕 — 회색 묶음 도형과 바탕색 막, 값 래스터 위·주제 아래`

리비전·고정값: 없다.

### Task D4: 같은 장면을 그리는 나머지 표면 확인 — PNG·PDF·보드 카드·펼침 창

코드 변경이 없으면 커밋하지 않는다. 고칠 것이 나오면 그것만 고치고 테스트를 더해 `fix(v2):`로 커밋한다.

- [ ] **Step 1: PDF·PNG(긴 명령 앞 원장 줄)** — `export-pdf-png.mjs fe9e688b <out> pdf`·`png`, 갈현도. `pdf-images.mjs`로 빈 쪽 0, 잉크·내장 이미지 있음, 원 밖 회색이 화면 캡처와 같은지(같은 쪽 픽셀 3곳).
- [ ] **Step 2: 보드 카드** — 보드 화면 1440·1024에서 카드 6장 이상을 찍어 원 밖 회색·막이 카드에도 있는지, 카드 첫 그림 시간을 전/후로(벡터 바탕 33장).
- [ ] **Step 3: 펼침 창** — A03·D13(도로 생략 타일)·A01(철도 생략) 펼침 창에서 원 밖에 생략 층이 나오지 않는지, 확대·이동해 범위 밖이 지금처럼 빈 바탕인지.
- [ ] **Step 4: 입력 불변** — S01 3D 장면 건물 수와 DXF 내보내기 건물 수가 D1 전과 같은지(화면 S01 장 + 내보내기 파일).
- [ ] **Step 5: 보고** — 표 하나(표면 · 바탕 · 원 밖 회색 여부 · 화면과 차 · 시간).

리비전·고정값: 없다(고친 것이 렌더뿐일 때). 장면을 고쳐야 하면 멈추고 Judge에게 보고한다(장면 해시 3곳이 다시 움직인다).

### Checkpoint D5: 원 밖 첫 캡처 (Judge → 사용자, spec Q1 「첫 캡처로 확인」)

- [ ] 대치·갈현 ①·② 장(벡터·항공·흰 바탕), PPT SaveAs, 준비 단계 전 캡처를 나란히 놓은 결정 페이지를 만든다(`my-design-taste` 방식, 결과 블록 `OUTSIDE_REVIEW_1`). 묻는 것: 세기 0.50 그대로/조정(슬라이더는 무작위에서 시작), 흰 바탕의 원 밖이 9 % 막 없이 바탕색만인 것, D3 무게 표.
- [ ] 승인되면 Judge가 정본 §9-12에 「원 밖 바탕」 줄(채도 0·0.50, 흰 바탕은 바탕색, 분석 결과는 원 안, 범위 밖·상한 분석은 빈 바탕)과 결정 이력 한 줄을 커밋한다(`docs(v2): 정본 §9-12 원 밖 바탕`). 세기를 바꾸면 `OUTSIDE_TONE` 한 줄만 고친다.

### Task C1: 구역 면 흰 외곽선 0.6u·둥근 모서리

**Files:**
- Modify: `src/lib/v2/ui/map-layers.ts:856-859`(`POLYGON_TONES.zone.strokeWidth`), 주석 `:855`
- Modify: `src/components/v2/map-figure.tsx:1337`(면 경로 `strokeLinejoin="round"`)
- Modify: `src/scripts/v2/test-v2-polygon-tone.mjs:1,19,40,42,79-80`
- Check: PPT 면 선(`map-pptx.ts:824`)은 톤 값 × `scene.unit`을 이미 쓴다.

- [ ] **Step 1: 테스트 고치기(실패 확인용)** — `POLYGON_TONES.zone`을 `{ fillOpacity: 0.3, stroke: "#ffffff", strokeWidth: 0.6 }`로, `polygonPaint("zone:주거", …)`의 `strokeWidth` 0.6, 화면 구역 경로 굵기 / u = 0.6(`:79-80`), 구역 경로에 `stroke-linejoin="round"`, PPT 같은 장의 구역 면 선 굵기 = 0.6 × `scene.unit` 환산 pt(지금 `:75-80` 방식).
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `test-v2-polygon-tone.mjs`·`test-v2-ppt-editable-maps.mjs`·`test-v2-map-palette-render.mjs`·`test-v2-tile-d19-parcels.mjs` PASS, lint 0.
- [ ] **Step 5: 실렌더(긴 명령 앞 원장 줄)** — 대치·갈현 A12·D19·D18 장 1440·1024 화면과 PPT SaveAs. D18 경사 면의 꺾인 모서리를 화면·PPT 각각 300 % 크기로 잘라 흰 뿔이 보이는지 보고한다. D19 필지(작은 면)에서 선이 면을 얼마나 덮는지 캡처로 보인다(spec 위험).
- [ ] **Step 6: 커밋** — `feat(v2): 구역 면 흰 외곽선 0.6u·둥근 모서리(Q2)`
- [ ] **Step 7(게이트, Judge 판정 뒤에만):** Step 5에서 PPT에만 흰 뿔이 보이면, 저장한 PPTX의 구역 톤 면 `<a:ln>`에 `<a:round/>`를 넣는 후처리를 더한다(`jszip`은 이미 의존성, 저장 경로는 `render-pptx.ts`). 테스트: 같은 덱 XML에서 구역 면 도형의 `<a:ln>` 안에 `<a:round/>`가 있고 다른 도형에는 없다. 뿔이 없으면 하지 않는다(spec C-1). 커밋 `feat(v2): PPT 구역 면 선 이음을 둥글게`.

리비전·고정값: 없다(렌더, 64-hex 아님).

### Task C2: 단계 면 45 %와 A11 밝은 끝

**Files:**
- Modify: `src/lib/v2/ui/map-layers.ts` — `POLYGON_TONES`·`polygonTone`·`polygonPaint`(`:856-878`), A11 `pop_dens_0`·`pop_dens_1`(`:343-344`)
- Test: `src/scripts/v2/test-v2-polygon-tone.mjs`

**Interfaces:**
- `polygonPaint`는 화면·PPT의 단일 입구로 남는다. 결과(위성 아님):
  - `pop_dens_*`·`dens_q*`·`relief_*`·`slope_*`·`walk_5|10|15` → `{ fillOpacity: 0.45, stroke: "#ffffff", strokeWidth: 0.6 }`
  - `bldg_<연대>`(`bldg_pre1980`~`bldg_unknown`)·`floors_*` → `{ fillOpacity: 0.45, stroke: null, strokeWidth: 0 }`
  - `use:*`(미상 제외)·그 밖 떨어진 면 → 0.25 그대로, 그 밖 구역 면 → 0.3 그대로
  - 위성 → `fillOpacity = max(위 값, 0.45)`
- 스타일이 채움·선을 직접 정한 레이어(`TONE_EXEMPT_KEYS`, `:861`)는 지금처럼 톤을 받지 않는다. `pop_dens_*` 등에 그런 키가 있으면 보고한다.

- [ ] **Step 1: 실패하는 테스트 작성** — 위 결과를 레이어마다 `deepEqual`로. `polygonTone("use:주거") === "separate"`는 그대로. 위성: `polygonPaint("maint_stage:조합", …, true).fillOpacity`는 C3 전이므로 0.45, `polygonPaint("relief_ge20", …, true).fillOpacity === 0.45`.
  - A11 대비: 테스트 안에 ΔE2000(CIEDE2000) 함수를 두고, 기본 테마 바탕(`BASE_THEMES` 기본 id의 `bg`, 지금 warm `#f6f4ef`) 위 45 % 합성색으로 `pop_dens_0..5` 인접 쌍의 ΔE ≥ 6을 단언한다. D16·D17·D18·D28·D04·D05 인접 쌍도 같은 단언을 둔다(spec C-2 계산은 CIE76이라 값이 다르다 — 실패하는 쌍은 보고한다).
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — A11 밝은 두 색(`#F0F4F8`·`#CFE8E6`)은 같은 청록 계열 안에서 ΔE ≥ 6이 되게 다시 고른다(spec §6: 실행자가 값을 정한다). 고른 값과 쌍별 ΔE 표를 보고서에 적는다. D16 `dens_q1`도 `#CFE8E6`이라 같은 문제가 있으면 함께 보고하고 고치지는 않는다(Checkpoint C에서 Judge).
- [ ] **Step 4: 통과 확인** — `test-v2-polygon-tone.mjs`·`test-v2-tile-a11-density.mjs`·`test-v2-tile-d16-density.mjs`·`test-v2-tile-d18-slope.mjs`·`test-v2-tile-d28-walk.mjs`·`test-v2-map-palette.mjs`·`test-v2-map-palette-render.mjs`·`test-v2-ppt-editable-maps.mjs` PASS, lint 0.
- [ ] **Step 5: 실렌더** — 대치·갈현 A11·D04·D05·D16·D17·D18·D28 장 1440 화면과 PPT SaveAs(1024는 A11·D05만). 45 % 면이 바탕 도로·건물 이름 라벨을 덮지 않는지(라벨이 면 위인지) 본다.
- [ ] **Step 6: 커밋** — `feat(v2): 순서형 단계 면 채움 45 % — A11 밝은 끝 다시 고름`

리비전·고정값: 없다(렌더). 범례 견본 합성색은 C7이다.

### Task C3: A09 정비 단계 5군 색·채움 55 %

**Files:**
- Modify: `src/lib/v2/ui/map-layers.ts:331-342`(`maint_stage:*` 9단계 label·색), `polygonPaint`(`maint_stage:` 채움 0.55)
- Modify: `src/lib/v2/engine/tiles/common.ts:30`(A09 `+stage-groups-r1`)
- Modify(고정값): `test-v2-tile-registry.mjs:34`, `test-v2-topo-run.mjs:26`
- Test: `src/scripts/v2/test-v2-tile-a09-maintenance.mjs`, `test-v2-polygon-tone.mjs`

**Interfaces:**
- 레이어 id 9개(`maint_stage:정비계획`…`maint_stage:미확인`)는 그대로다. label만 군 이름(`정비사업 · 계획`·`· 추진`·`· 사업`·`· 공사`·`· 완료`·`· 미확인`), 색은 Global Constraints 값이다. `maint_area:*`(관리 경계, 채움 6 %·자기 색 테두리)는 그대로다.
- `polygonPaint("maint_stage:*")` → `{ fillOpacity: 0.55, stroke: "#ffffff", strokeWidth: 0.6 }`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - A09 fixture 결과의 `presentation.legend` label 집합이 군 이름 6개 이하이고 단계 이름이 없다. `정비계획`·`구역지정` 면이 같은 label·같은 색이다.
  - 설명선 상세 줄(`sublabel`)은 세부 단계를 그대로 쓴다(예 `… · 조합`).
  - 구성비 그래프(`analysisCharts`)가 군마다 한 항목이다.
  - 이웃 군 ΔE2000 ≥ 6(55 % 합성, 기본 테마 bg) — 결정 페이지 값 8.1~14.3과 같은 범위인지 보고.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**, 리비전
- [ ] **Step 4: 고정값** — `topo-run`(cache key)은 A09 키만, `tile-registry`는 A09 줄만 움직인다. 다른 키가 움직이면 멈춘다. A09 fixture 결과 JSON을 고치기 전·후로 diff해 바뀐 경로가 `presentation.legend`뿐임을 보고서에 붙인다.
- [ ] **Step 5: 통과 확인** — 위 테스트, `test-v2-analysis-charts.mjs`·`test-v2-map-legend.mjs`·`test-v2-ppt-editable-maps.mjs` PASS, lint 0, `tile-literals.mjs A09`.
- [ ] **Step 6: 실데이터** — 대치·갈현 A09 행 stale → refresh(긴 명령 앞 원장 줄) → 엔진 버전 문자열에 새 접미가 실렸는지 확인. A09 장 1440·1024 + PPT SaveAs.
- [ ] **Step 7: 커밋** — `feat(v2): A09 정비 단계를 5군 + 미확인 색으로, 채움 55 %`

### Task C4: A12 용도지역 세분 색표·채움 50 %

**Files:**
- Modify: `src/lib/v2/engine/tiles/zoning-shared.ts:68`(면 레이어 id)
- Modify: `src/lib/v2/tile/a12/engine.ts:251`, `src/lib/v2/tile/a12/d08.ts:51`(`layers` 목록: 그린 세분 레이어 + 분류 대체 레이어)
- Check: `src/lib/v2/tile/a12/view.ts:16-19`(`zoneColor`는 면 레이어 스타일을 읽으므로 그대로 세분 색이 나와야 한다)
- Modify: `src/lib/v2/ui/map-layers.ts:248-252`(세분 21종 스타일 추가, `zone:<분류>` 대체 스타일 유지), `polygonPaint`(`zone:` 채움 0.5)
- Modify: `src/lib/v2/engine/tiles/common.ts:33`(A12 `+zoning-fine-r1`)
- Modify(고정값): `test-v2-tile-registry.mjs:37`, `test-v2-topo-run.mjs:29`
- Test: `test-v2-engine-market-zoning.mjs`, `test-v2-tile-a12-price.mjs`, `test-v2-key-figure.mjs`, `test-v2-map.mjs`, `test-v2-map-palette.mjs`, `test-v2-ppt-editable-maps.mjs`

**Interfaces:**
- 면 레이어 id: 원천 이름이 21종 표에 있으면 `zone:<분류>:<원천 이름>`, 없으면 `zone:<분류>`. 세분 스타일 label = 원천 이름(예 `제1종일반주거지역`), 색 = 표 값. `zone_center:*`는 그대로다.
- `polygonPaint("zone:…")` → `{ fillOpacity: 0.5, stroke: "#ffffff", strokeWidth: 0.6 }`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - fixture 면 `제1종일반주거지역` → 레이어 `zone:주거:제1종일반주거지역`, 스타일 색 `#F0EA82`. 표에 없는 이름 → `zone:주거`.
  - 엔진 `presentation.legend`가 세분 이름이다. 카드 구성 막대(`keyFigureFor`)의 색이 같은 세분 색이다.
  - 21종 표의 색·이름이 Global Constraints 표와 한 글자도 다르지 않다(표를 테스트에 그대로 둔다).
  - 주거 세분 4종 50 % 합성 인접 ΔE2000을 계산해 보고한다(결정 이력 「최소 5.6 — 갤러리에서 확인」, 단언하지 않는다).
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**, 리비전
- [ ] **Step 4: 고정값** — `topo-run`(cache key)은 A12 키만, `tile-registry`는 A12 줄만 움직인다. A12 fixture 결과 JSON을 고치기 전·후로 diff해 바뀐 경로가 면 `layer`·`presentation.legend`·`presentation.layers`뿐임을 보고서에 붙인다.
- [ ] **Step 5: 통과 확인** — 위 테스트, `test-v2-polygon-tone.mjs`·`test-v2-analysis-charts.mjs` PASS, lint 0, `tile-literals.mjs A12`.
- [ ] **Step 6: 실데이터** — 대치·갈현 A12 stale → refresh → A12 장 1440·1024 + PPT SaveAs. 갈현(주거 세분이 많은 곳)에서 1·2·3종·준주거가 구별되는지 픽셀 표본 ΔE를 적는다.
- [ ] **Step 7: 커밋** — `feat(v2): A12 용도지역 세분 색표(토지이음 출발·주거 세분 간격) — 채움 50 %`

### Task C5: D03 용도 미상 회색 채움·D29 건물 선 없음

**Files:**
- Modify: `src/lib/v2/ui/map-layers.ts:272`(`use:미상`), `:262`(`svf_building`), `buildingStyleForRaster`(`:884-887`)
- Check: `src/components/v2/map-figure.tsx:1325-1337`, `src/lib/v2/report/map-pptx.ts:815-824`(`style.hatch`면 추정으로 보고 점선 — 미상에서 빠져야 한다)
- Test: `test-v2-tile-d03-buildings.mjs`, `test-v2-tile-d29-svf.mjs`, `test-v2-polygon-tone.mjs`

**Interfaces:**
- `use:미상` = `{ label: "용도 미상", color: "#94A3B8", fill: "#94A3B8", fillOpacity: 0.35, stroke: "none", strokeWidth: 0 }`(빗금 없음). `polygonPaint` → `{ fillOpacity: 0.35, stroke: "none", strokeWidth: 0 }`(물·수관과 같은 꼴).
- `svf_building`: 지도 면은 선이 없다. `buildingStyleForRaster("svf_building", true)`는 중립 선을 주지 않는다. 범례 견본만 윤곽을 둔다(흰 판 위 3:1). S01~S04 마스크는 그대로다.

- [ ] **Step 1: 실패하는 테스트 작성** — 화면 마크업에서 `use:미상` 면: `fill="#94A3B8"`·`fill-opacity="0.35"`·`stroke="none"`, 빗금 pattern 없음. PPT: 같은 면이 점선이 아니고 선이 투명하다. 추정 레이어(`*_est`)는 여전히 빗금·점선이다. D29 `svf_building` 면은 화면·PPT 모두 선이 없고 범례 견본은 선이 있다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위 테스트, `test-v2-map-legend.mjs`·`test-v2-ppt-editable-maps.mjs` PASS, lint 0.
- [ ] **Step 5: 실렌더** — 대치·갈현 D03 17쪽·D29 장 1440·1024 + PPT SaveAs.
- [ ] **Step 6: 커밋 두 개** — `feat(v2): D03 용도 미상은 선·빗금 없는 회색 채움(Q4 c)` / `feat(v2): D29 건물 면 선 없앰(범례 견본만 윤곽)`

리비전: 없다(label 그대로, 렌더).

### Task C6: 거리 그래프 옅은 점 윤곽

**Files:**
- Modify: `src/lib/v2/report/chart-geometry.ts:166`(점 묶음), 필요하면 `:14` 색 상수
- Test: `test-v2-chart-geometry.mjs`

**Interfaces:** 점 묶음마다 「흰 바탕 위 점 불투명도로 합성한 색」과 `#ffffff`의 대비(WCAG 상대 휘도)가 3:1 미만이면 `stroke`·`strokeWidth`(pt)를 단다. 윤곽 색은 점 색의 HSL 명도만 낮춰 흰 바탕 대비 ≥ 3:1이 되는 첫 값(1 % 간격)이다. 이미 `stroke`를 가진 대지 점(`:206`)은 그대로다. 화면 SVG와 PPT는 같은 `ChartShape`를 그리므로 따로 고치지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** — A07 `trade_q1` `#BFD7F5` 점 묶음(불투명도 0.8·0.5 둘 다)에 윤곽이 있고 그 윤곽의 흰 바탕 대비 ≥ 3:1이다. 대비가 충분한 진한 색(`#125C5A`)에는 윤곽이 없다. 윤곽을 받는 색 목록을 테스트 출력으로 남긴다.
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `test-v2-chart-geometry.mjs`·`test-v2-analysis-charts.mjs`·`test-v2-analysis-page-surface.mjs`·`test-v2-analysis-page-pptx.mjs` PASS, lint 0.
- [ ] **Step 5: 실렌더** — 대치 A07 10쪽 1440 화면 + PPT SaveAs. 윤곽을 받은 다른 타일 거리 그래프 장을 표로(타일 · 색 · 대비 전/후).
- [ ] **Step 6: 커밋** — `fix(v2): 거리 그래프 옅은 점에 윤곽 — 흰 카드 위 비텍스트 대비 3:1`

리비전·고정값: 없다(그래프는 렌더가 엔진 결과로 그린다, 64-hex 아님).

### Task C7: 범례 견본 = 지도 표식 (모양·합성색·대지)

**Files:**
- Modify: `src/lib/v2/ui/map-layers.ts` — `legendItems` 근처에 `legendSwatchShape`
- Modify: `src/components/v2/map-legend-strip.tsx:45-140`(보드 범례 띠), `src/components/v2/report/slide-surface.tsx:65-76,1420-1435`(보고서 범례 판), `src/lib/v2/report/render-pptx.ts`(`legendPlate` `:338-`, 견본 분기 `:391-`)
- Test: Create `src/scripts/v2/test-v2-legend-swatch.mjs`; `test-v2-map-legend-strip.mjs`·`test-v2-map-legend.mjs`

**Interfaces:**
- Produces:
  ```ts
  // map-layers.ts — 세 경로가 같은 판정을 쓴다
  export type LegendSwatchShape = "circle" | "line" | "square" | "site-parcel" | "site-ring" | "badge" | "rail-axis" | "rail-exit" | "raster";
  export function legendSwatchShape(item: { site?: boolean; siteMode?: "parcel" | "ring"; symbol?: string; badge?: string; swatch?: string; lineSwatch?: boolean; legendSwatch?: "line" | "polygon" }): LegendSwatchShape;
  // 면 견본 칠: 지도 면 채움(polygonPaint)을 바탕색 위에 합성한 불투명 색. 위성 바탕은 원색 + 불투명도 그대로
  export function legendSwatchFill(layer: string, style: LayerStyle, bg: string, satellite: boolean): { color: string; opacity: number };
  ```
- 대지 견본: 지도에 필지 윤곽이 있으면(`MapScene.siteMode === "parcel"`과 같은 판정의 모델 값) `site-parcel`(◇ + 윤곽, 정본 §9 표식 축소), 없으면 `site-ring`(크로스헤어 링). 범례 항목에 `siteMode`를 싣는다.
- 지금 화면 보고서 판은 점을 직사각형(`slide-surface.tsx:75`)으로, 보드는 CSS 칸으로 그려 PPT(원·막대·번호 원)와 다르다(spec Q5). 세 경로가 같은 모양·같은 칠을 내게 맞춘다. 새 모양은 만들지 않는다(노선색 원 + 약칭은 Checkpoint R).

- [ ] **Step 1: 실패하는 테스트 작성** — 점 레이어(A03 상가)·선 레이어(A01 노선)·면 레이어(A12 세분·D03 용도·A09 군)·대지(필지 있음·없음)·번호 원(A05 개요) 항목마다:
  - `legendSwatchShape` 값이 기대와 같다.
  - 보드 띠 마크업·보고서 판 마크업·PPT `legendPlate` XML이 같은 모양이다(원 → `<circle>`/`ellipse`, 면 → `<rect>`/`rect`, 선 → `<line>`/`line`, 대지 → 마름모+윤곽 또는 링).
  - 면 견본 색 = `legendSwatchFill`의 합성색이고, 같은 장 지도 면 픽셀 합성색과 같다(테마 bg 위 계산값으로 비교, 채널 ± 2). 위성 바탕 → 원색 + 불투명도 0.45 이상.
  - D29 `svf_building` 견본만 윤곽이 있다(C5).
- [ ] **Step 2: 실행해 실패 확인**
- [ ] **Step 3: 구현** — 접근성 계약(§6: native button, `aria-pressed`, 견본 24 px 읽힘·누름 영역 44 px)은 바꾸지 않는다.
- [ ] **Step 4: 통과 확인** — 위 테스트, `test-v2-analysis-page-surface.mjs`·`test-v2-analysis-page-pptx.mjs`·`test-v2-report-doc-pptx.mjs`·`test-v2-ui-polish.mjs` PASS, lint 0, `tile-literals.mjs A01 A03 A05 A09 A12 D03 D29`.
- [ ] **Step 5: 실렌더** — 대치·갈현 A01 2쪽·A03 4쪽·A05 6쪽·A09·A12·D03 17쪽 1440·1024 화면 + PPT SaveAs. 같은 장에서 범례 견본과 지도 표식을 나란히 잘라 붙인 대조 그림을 보고서에 둔다.
- [ ] **Step 6: 커밋** — `feat(v2): 범례 견본은 지도 표식 모양·합성색 — 보드·보고서·PPT 한 판정, 대지 견본은 그린 표식대로(Q5)`

리비전: 없다(렌더).

### Checkpoint C: 색·선 갤러리 (Judge → 사용자)

- [ ] 대치·갈현에서 A09·A11·A12·D03·D04·D05·D16·D17·D18·D19·D28·D29·A07 장을 1440 화면 + PPT SaveAs로, 준비 단계 전 캡처와 나란히 놓은 갤러리(결과 블록 `COLOR_REVIEW_1`). 원 밖 회색(D)과 최종 안쪽 톤이 함께 보이는 ①·② 장을 넣어 Q1 B를 한 번 더 확인한다(spec §3 순서 4).
- [ ] 묻는 것: A12 주거 세분 구별(ΔE 5.6 — 결정 이력 「갤러리에서 확인」), D19 0.6u, D04·D05 45 %(열린 질문 7), A11 새 밝은 끝, C6 윤곽 범위(열린 질문 10), 범례 견본 대조.
- [ ] 고칠 것은 같은 실행자를 `SendMessage`로 재개해 고친다. 정본에 닿으면 정본 Task 목록에 더한다.

### Checkpoint R: 노선색 원 + 약칭 견본 시안 (게이트)

정본 §6 「시안 대기: 노선색 원 + 약칭(3호선 「3」, 수인분당선 「수인」) 등 새 견본 모양」. 이 계획의 Task는 이 모양을 구현하지 않는다.
- [ ] Judge가 실제 A01 장 위에 후보를 놓은 시안 페이지를 만들어 사용자 승인을 받는다(노선 약칭 표 포함, `my-design-taste`).
- [ ] 승인되면 Judge가 정본 §6에 넣고 커밋한 뒤, 이 계획 끝에 구현 Task(C8)를 더해 디스패치한다. 승인 전에는 원장에 「R 대기」만 적는다.

### Task 정본 마무리 (Judge 주도)

**Files:** `docs/design/v2-design-language.md` §1(L13)·§6·§8-1·§9-12·결정 이력

- [ ] **Step 1:** §9-12 「주제 레이어 톤」에 줄을 더한다: 순서형 단계 면 45 %(대상 목록), A09 55 %, A12 50 %(세분 색표는 결정 이력 표). 떨어진 면 25 % 줄에 D04·D05 예외(Checkpoint C 답대로).
- [ ] **Step 2:** P3 표시를 지운다: §1·§8-1 「코드 적용 P3 C-5」, §6 「코드 적용 P3 C-8」(시안 대기 줄은 Checkpoint R 결과대로), §9-12 「코드 적용은 P3 C-1. 그 전 코드는 1.7u」.
- [ ] **Step 3:** §6에 「범례 견본 칠 = 지도 면 채움을 바탕색 위에 합성한 불투명 색, 위성은 원색 + 불투명도」를 한 줄(C7 구현과 같게).
- [ ] **Step 4:** 결정 이력 2026-11-05(또는 시행일) 줄: 원 밖 바탕(D5 답), 단계 면 45 %, 구역 선 0.6u 적용, A09·A12 적용, 미상 회색·D29 적용, 거리 그래프 윤곽, 범례 견본.
- [ ] **Step 5: 확인·커밋** — 정본에서 `코드 적용 P3`가 0건(Checkpoint R 대기 줄 제외). `docs(v2): 정본 — P3 색·선·원 밖 바탕 적용`

### Task 인수 (Judge)

- [ ] **Step 1:** `npm run lint` 0, `npm run test:v2` 전체 PASS(마지막 줄 첨부. 첫 실패에서 멈추므로 실패하면 고치고 그 파일만 다시 돌린 뒤 전체 한 번 더).
- [ ] **Step 2:** `tile-literals.mjs A01 A03 A05 A09 A10 A12 D03 D13 D29` 통과. 고정값 표(`updating-hash-pinned-baselines` 「Find every pin first」 방식, 64-hex 전부): 움직인 것(장면 해시 3·A09·A12 키·registry 2줄)과 근거, 그대로인 것.
- [ ] **Step 3:** 화면 1440·1024 — 대치·갈현·고덕의 C·D가 닿은 장 전부를 `capture-pages.mjs`로. 겹침 0·열 밖 글자 0·잘림 0. 정본 §6·§9-12와 대조.
- [ ] **Step 4: C·D 합친 PPT 무게(spec §3 순서 4)** — D3 Step 6과 같은 표를 대치·갈현·2 km로 다시 잰다. 「D1 뒤 전」 대비 2배를 넘으면 배포 전에 Judge가 대책을 정한다.
- [ ] **Step 5:** PDF·PNG(`export-pdf-png.mjs` → `pdf-images.mjs`), 빈 쪽 0, 잉크·내장 이미지 있음.
- [ ] **Step 6:** 최종 브랜치 리뷰(Opus) → 지적 수정 → 사용자에게 운영 배포 여부를 묻는다(배포는 승인 뒤 따로). vault 작업 기록(`obsidian-memory`).

---

## 범위 밖 (이 계획에서 하지 않음)

- 노선색 원 + 약칭 견본(Checkpoint R 승인 뒤 따로 Task).
- 순서형 범례의 개수순 정렬 문제(A11 p14, spec §2-3 「범위 밖 발견」) — `legendGroup`·`legendOrder` 패턴 적용은 따로 묻는다.
- 원 밖 바탕을 배경 그림으로 굽는 대책(D3 Step 6이 2배를 넘을 때만 Judge가 따로 정한다).
- 원 밖 철도·역·필지·이름 라벨, 원 밖 분석 결과(결정 outsideBasemap).
- 저장 분석의 장면 일괄 재생성(저장 분석은 stale 타일이 있는 refresh 때만 `isPreOuterScene`으로 다시 만든다).
- 반경 2 km 이상 벡터 바탕(장면 5,000동 상한, 10-29 인계 백로그).

## 열린 질문

1. **(Judge, D1 Step 5 뒤) 원 밖 읽기 범위.** spec ±2.2r × ±1.2r는 지름 0.9 × 높이 어림이고 HEAD 기본 맞춤은 fill 0.8이다(① 세로 반폭 1.25r). 개요 장(0.72)·D17 단면 배치(0.28~0.52)는 더 넓다. 기본값: ①·②·개요·카드·펼침 창 중 가장 넓은 기본 보기 + 10 %. D17 단면 배치의 남는 띠는 빈 바탕으로 받아들이고 측정값을 보고한다.
2. **(Judge) 원 밖 건물 철거 판정 생략.** 기본값: 생략(회색 바탕, 겹친 바닥은 화면에서 합쳐짐). D1 Step 5의 원 밖 겹친 바닥 비율이 크면 다시 정한다.
3. **(Judge) worker 갱신 조건 `isPreOuterScene` 추가.** 기본값: 더한다(spec이 제시한 길, `isPreBasemapScene`과 같은 꼴).
4. **(Judge) 원 안 상한에 잘린 분석은 `outer`를 읽지 않는다.** 기본값: 읽지 않는다(벡터 바탕을 쓰지 않는 분석). 2 km 측정은 VWorld 배경 그림 경로를 잰다.
5. **(Judge) 수치지형도 분석의 원 밖 도로는 OSM 위계 폭.** 기본값: 그렇게 한다.
6. **(사용자, Checkpoint D5)** 원 밖 세기 0.50 첫 캡처 확인, 흰 바탕 원 밖이 9 % 막 없이 바탕색만인 것.
7. **(사용자, Checkpoint C) D04·D05 건물 연대·층수 면도 45 %인가.** spec C-2의 Judge 메모이고 결정 ramp는 「단계 면」이다. 정본 §9-12 「떨어진 면 25 %」를 바꾼다. 기본값: 넣는다(순서형 단계).
8. **(Judge) A09 범례 문구.** 기본값 `정비사업 · 계획`. 괄호로 세부 단계를 붙이는 꼴(`정비사업 · 계획(정비계획·구역지정)`)은 범례 판 폭을 늘린다.
9. **(Judge) 위성 바탕 면 채움 `max(톤, 0.45)`.** 기본값: 그렇게 한다(지금 「위성 0.45」는 낮은 톤을 올리던 규칙).
10. **(Judge/사용자) C6 윤곽을 대비 규칙으로 모든 거리 그래프 점에.** 기본값: 규칙으로 한다(spec C-7은 A07 한 색이지만 같은 원인이 다른 옅은 색에 남는다). 바뀌는 타일 목록은 C6 Step 5 표.
11. **(Judge, C1 Step 5 뒤) PPT `<a:round/>` 후처리.** 기본값: PPT에만 흰 뿔이 보일 때만 C1 Step 7을 한다.
12. **(사용자, Checkpoint R)** 노선색 원 + 약칭 견본 시안.

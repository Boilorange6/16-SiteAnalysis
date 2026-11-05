# 용도지역·구역·정비구역·공시지가 원천 교체(VWorld 24·6 → data.go.kr) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VWorld 다운로드 dsId 24(용도지역지구정보, 「라이센스 미지정」)와 dsId 6(개별공시지가, 「라이센스 미지정」)에서 받아 저장해 쓰던 자료를 공공데이터포털의 같은 국토교통부 자료 — 15148355 일별용도지역지구정보 SHP(「이용허락범위 제한 없음」)와 15052266 개별공시지가정보 CSV(「제한 없음」) — 로 바꾼 reference 새 판을 게시하고, 출처 장·각주·가이드 문구를 바꾼다. 같은 원본인지 먼저 대조하고, 다르면 멈춘다.

**Architecture:** 엔진·표·kind·원천 id는 그대로 두고 적재 입력과 출처 기록만 바꾼다(2026-11-04 학구도 KOIES 교체 `3c4e64a3`와 같은 방식). dsId 24에서 온 네 묶음 — 용도지역 5종(`zoning_*`, A12·A04 D09·상세), 구역·도시계획시설 13종(`district_*`·`facility_*`, D11·D12), 정비구역 5종(`mzone_*`, A09), 그리고 dsId 6 공시지가(`land_price`, A12·상세) — 의 reference 단계가 새 원천 폴더 `raw/datagokr/<데이터셋 id>/<기준일>/`을 읽고, release의 제공처·URL·권리 기록을 data.go.kr로 적는다. VWorld 받기 도구에서 24·6을 뺀다. 원천 교체만으로는 엔진 리비전이 필요 없고(manifestHash가 키를 바꾼다), D11의 「VWorld」 문구만 고쳐 D11 리비전을 한 번 올린다.

**Tech Stack:** TypeScript · better-sqlite3 · tsx · `ingest/shp.ts` · `a0/measure.ts`(`csvRecords`) · `npm run data:build` · `src/scripts/v2/data-gc.mjs` · 테스트 `src/scripts/v2/test-v2-*.mjs`

**Spec/결정:** vault `10-Projects/16-SiteAnalysis/Decisions/2026-11-05 용도지역·공시지가 원천을 data.go.kr 제한 없음 파일로 교체.md`(순서: ① 같은 원본 대조 → ② 계획서 → ③ 새 데이터 버전 적재·게시 → ④ 출처 장·각주 문구, 대조가 다르면 다시 묻는다, 그동안 운영 화면은 그대로). 조사: `.superpowers/sdd/2026-11-05-p4p5-license/report.md` 「추가 조사」 절. 선례: `3c4e64a3`(학구도 원천 교체), vault `Sessions/2026-11-04 VWorld 약관 변경 동의와 인증키 확인.md` 후속 2·3(reference 단독 빌드 약 30분, REGION_MISSING → `--resume --reset-baseline`, 게시 뒤 옛 raw 삭제·GC). 관련 계획: `docs/superpowers/plans/2026-11-05-p4-centerline-contours.md`·`2026-11-05-p5-d11-checklist.md`, spec `docs/superpowers/specs/2026-11-03-labels-map-expression-design.md` §2-3 C-4(A12 세분 색, 2026-11-05 정본 결정 이력). file:line은 HEAD `946d9138`(브랜치 `v2-cartography`) 기준이다.

## Global Constraints

- **게시 전까지 운영 화면은 그대로(결정).** 운영(serve)은 같은 데이터 폴더를 쓰므로(`C:/SiteAnalysisServe/serve.env`) reference 새 판 게시가 곧 운영 새 분석의 원천 전환이다. 게시(Task 3)는 사용자 승인 뒤에 한다.
- **같은 원본이 아니면 멈춘다(결정).** Task 1 게이트를 넘지 못하면 Task 2 이후를 하지 않고 사용자에게 묻는다(Checkpoint S).
- **약관 근거(조사 인용):** VWorld 이용약관 19조 「오픈플랫폼에서 제공되는 데이터는 무단으로 저장하지 못합니다. 다만, 다운로드 서비스의 개별 라이선스가 표시된 자료는 해당 라이선스에 따릅니다.」 → 개별 라이선스가 표시되지 않은 24·6은 예외에 들지 않는다. 21 법정구역·23 연속지적도·18 GIS건물은 CC BY라 바꾸지 않는다. 30056 도로명주소 건물(CC BY-NC-ND)도 그대로다.
- **엔진·kind·원천 id는 바꾸지 않는다.** `zoning_area`·`district_area`·`plan_facility`·`maintenance_zone` kind, `zoning_*`·`district_*`·`facility_*`·`mzone_*`·`land_price` 원천 id와 `land_price` 표 열은 그대로다. 그래야 저장 분석·운영 코드·고정값이 원천 교체만으로 움직이지 않는다.
- **리비전:** D11만 `common.ts:39`에 `+source-swap-r1`(판단 문장의 「VWorld」 제거). 나머지는 manifestHash로 충분하다(`run.ts:71-80`). 고정값은 `updating-hash-pinned-baselines`로.
- **데이터 위치·GC:** `C:/SiteAnalysisData/v2`(`.cache/v2`는 junction). 빌드·dev·GC는 `V2_DATA_DIR=D:/V-coding/16-SiteAnalysis/.cache/v2/data`, raw는 `D:/V-coding/16-SiteAnalysis/.cache/v2/raw`. 옛 버전은 손으로 지우지 않는다. GC: `V2_DATA_DIR=D:/V-coding/16-SiteAnalysis/.cache/v2/data npx tsx src/scripts/v2/data-gc.mjs --app-db C:/SiteAnalysisData/v2/app.sqlite,C:/SiteAnalysisData/serve/app.sqlite`.
- **받은 파일은 믿지 않는 자료다.** 새 빈 폴더에 두고, 읽는 스크립트는 다른 폴더에 둔다(환경 지시).
- **출처 표기:** 출처 장·카드 출처 줄·가이드는 `SOURCE_NAMES`·`SOURCE_DETAIL_DEFINITIONS`·release 기록에서 나온다(`ui/source-details.ts` `termsFor`, `ui/guide-sources.ts`). 「제한 없음」은 `licenseLabel("UNRESTRICTED")` → 「이용허락범위 제한 없음」. 비영리 전제(AGENTS).
- **파일 편집:** Edit/Write 도구로만. 바꿀 줄만.
- **검증:** 실행자는 관련 테스트만. 전체 `npm run test:v2`는 Judge가 Task 5에서 한 번. 화면 QA는 Judge가 띄운 `http://localhost:3200/site`와 `devqa`(비밀번호는 적지 않는다).
- **커밋:** Task별 + 실제 실행 모델의 Co-Authored-By 줄. push·배포 금지.

## 실행자 라우팅

| 역할 | 누가 | 근거 |
|---|---|---|
| Task 1 대조 스크립트 실행 | **Executor A `gpt-6.1-terra` `medium`** | 기계적 측정. 판정은 Judge |
| Task 2 적재 경로 교체 | **Executor A `gpt-6.1-terra` `xhigh`** | 네 묶음·받기 도구·출처 등록에 걸친 변경 |
| Task 4 캡처 | Executor A `medium` → 판정 Judge | |
| Task 1 받기·원문 대조(Aside), Checkpoint S, Task 3 빌드·게시, Task 4 정본·A0 문서, Task 5 인수·GC | **Judge** | data.go.kr 로그인이 걸릴 수 있고(사용자 조치), 게시는 운영 데이터 전환이다 |
| Task 리뷰 | Opus(Judge 또는 같은 모델 서브에이전트) | |

디스패치·브리프 필수 줄은 P4 계획 「실행자 라우팅」과 같다.

## 원장과 재개 (회사 PC 06:00·18:00 종료)

- 원장: `.superpowers/sdd/2026-11-05-zoning-landprice-swap/progress.md`(결정 노트·계획 경로, 시작 HEAD, 라우팅). 산출 `same-source-check.md`도 이 폴더.
- Step마다 원장에 한 줄, 받기·빌드 앞에도 한 줄. 재개 전 부팅 시각·원장 마지막 줄·`git status`·콘솔 로그 끝·남은 node 프로세스를 본다.
- 빌드는 reference 단계 재개(`--resume`)가 된다. 학구도 교체 때 reference 단독 빌드는 약 30분이었다. 단, P4 등고선 적재 코드와 원천 zip이 이미 있으면 같은 빌드에 등고선 단계가 들어가 몇 시간이 될 수 있다(「데이터 버전과 GC」).

## 데이터 버전과 GC

- 세 계획의 reference 빌드 순서(권장): **R1 = 이 계획 Task 3**(짧다) → R2 = P4 Task 8(중심선·등고선, P5 용도지구 함께) → GC 한 번. R1을 P4 Task 4(적재기) 커밋 전에 돌리면 등고선 단계가 들어가지 않는다. 이미 커밋됐으면 원천 zip 폴더(`raw/road_centerline`·`raw/contour`)가 있는 한 단계가 생기므로, 시간을 원장에 미리 적고 그대로 한 빌드로 간다.
- P2 core·buildings 빌드(P2 Task 10)와 같은 시각에 돌리지 않는다(데이터 폴더 잠금, `--wait-lock 60`).
- 저장 분석은 고정한 옛 판으로 계속 열린다. 옛 판 안의 VWorld 24·6 자료는 GC가 저장 분석을 위해 남긴다(열린 질문 2).

## Review Focus

1. **data.go.kr 페이지가 VWorld 파일로 연결된다.** A0 문서는 15045898·15052266을 「→ VWorld dsId=24·6」로 적었다(`docs/superpowers/a0/2026-09-29-a0-verification.md:23-24`). 15148355·15052266이 포털에서 직접 파일을 주지 않고 VWorld로 넘기면, 받는 파일은 같은 「미지정」 파일이라 교체의 근거가 사라진다. → Task 1 Step 1 게이트
2. **포털 판이 더 오래됐다.** 조사는 공시지가를 「VWorld 2026-05-26 vs 포털 수정 2025-09-08」로 적었다. 포털 파일의 기준연도가 2025면 교체는 공시지가를 1년 되돌린다(A12 「대상 필지 개별공시지가」·상세). → Task 1 Step 4 게이트
3. **같은 원본인데 파일 꼴이 다르다.** 파일 이름(`AL_D124_00_YYYYMMDD.shp`·`AL_D151_11_YYYYMMDD.csv` 꼴)·필드 이름(`A0~A9`, `고유번호`·`기준연도`·`기준월`·`공시지가`·`표준지여부`·`법정동명`)·좌표계·인코딩이 다르면 지금 판별(`zoningLayerFiles`·`districtLayerFiles`·`mzoneLayerFiles`·`latestLandPricePerSido`)이 조용히 0건을 낸다. → Task 1 Step 2, Task 2 Step 1 ③
4. **시도 코드 변경(2026 행정구역).** 학구도 교체 때 전남광주통합(코드 12)으로 REGION_MISSING이 났다. 공시지가 적재는 core로 옛 코드를 옮기지만(`data-build.mjs:796-797`), 용도지역·구역의 시군구 코드(`A4`)는 그대로 저장된다. → Task 3 Step 3
5. **같은 출처 이름이 남는다.** 카드 출처 줄 `국토교통부 VWorld 용도지구·구역`(`tile-catalog.ts:164-168`)과 D11 판단 문장의 「VWorld」가 교체 뒤에도 보이면 출처가 틀린다. → Task 2 Step 1 ④, Task 4 Step 2

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `src/scripts/v2/data-build.mjs` | 용도지역(`:745-770`)·공시지가(`:772-800`)·정비구역(`:802-852`)·구역(`:915-944`) 단계의 원천 폴더·release 기록·안내 문구 | 2 |
| `src/lib/v2/ingest/sources/zoning.ts:29-34`, `districts.ts:1-8·52-56`, `maintenance-zone.ts:30`, `land-price.ts:11-15` | 권리 상수(`*_RIGHTS`)와 머리 주석 | 2 |
| `src/scripts/v2/vworld-fetch.mjs:9-11·40-47`, `vworld-fetch-large.mjs:12·44-46`, `src/lib/v2/ingest/vworld.ts:105-118·239-258` | 24·6과 그 전용 경로(레이어 고르기·폴더 바꾸기) 삭제 | 2 |
| `src/lib/v2/ui/tile-catalog.ts:164-168` | `district_*` 표시 이름 | 2 |
| `src/lib/v2/tile/d11/engine.ts:1·137`, `src/lib/v2/tile/d12/engine.ts:1`, `src/lib/v2/engine/tiles/common.ts:39` | 「VWorld」 문구, D11 리비전 | 2 |
| 테스트 | `test-v2-districts.mjs:27`, `test-v2-land-price.mjs:60`, `test-v2-zoning.mjs`, `test-v2-mzone.mjs`, `test-v2-vworld.mjs`, `test-v2-source-details.mjs`, `test-v2-report-doc-plan.mjs:337` 근처, 고정값 `test-v2-tile-registry.mjs:44`·`test-v2-topo-run.mjs:36` | 2 |
| `src/scripts/v2/source-swap-compare.mjs`(새 파일) | 옛/새 원천 대조표(Task 1, 다음 판 교체 때도 쓴다) | 1 |
| `docs/design/v2-design-language.md`(결정 이력), `docs/superpowers/a0/2026-09-29-a0-verification.md:23-24·65-66·75` | 기록 | 4 |

## P1·P2·P3·P4·P5와 겹치는 파일과 순서

| 파일 | 다른 계획 | 이 계획 | 처리 |
|---|---|---|---|
| `ingest/sources/zoning.ts`, `test-v2-zoning.mjs` | P3 C-4(A12 세분 색표). spec이 고칠 곳으로 `zoning.ts:42`(`zoningClass`)를 적었다 | 권리 상수만(`:29-34`) | C-4가 적재 분류를 바꾸면 reference를 다시 빌드해야 한다. **C-4의 적재 변경이 있으면 Task 3 빌드 전에 커밋**해 한 판으로 낸다. 없으면(엔진·`zoning-shared.ts`만) 순서 무관. C-4의 A12 리비전은 별개다 |
| `tile/d11/engine.ts`, `common.ts:39`, D11 고정값 | P5 Task 5(D11 체크리스트, `+checklist-r1`) | 문구 한 줄, `+source-swap-r1` | 이 계획이 먼저(P5가 교체 판 위에서 QA). P5는 rebase 뒤 접미를 덧붙인다. D11은 두 번 오른다 |
| `ingest/sources/districts.ts`, `data-build.mjs` 구역 단계 | P5 Task 3(새 단계·새 파일), P5 Checkpoint A-1(15148355에서 용도지구를 받는 경우) | 원천 폴더·권리 | 이 계획이 먼저. P5 A-1이 15148355면 이 계획의 원천 폴더를 그대로 쓴다 |
| `ingest/vworld.ts:118`(`rawZipName`), `vworld-fetch*.mjs` `FOLDERS` | P4 Task 2(30182·30185 추가, `rawZipName`·선택 규칙) | 24·6 삭제 | 같은 줄을 고친다. 먼저 커밋한 쪽 위에서 rebase. P4가 먼저면 이 계획은 24 분기만 지운다 |
| `ui/tile-catalog.ts`·`source-details.ts` | P4 Task 4·9·10, P5 Task 2·3·5 | `district_*` 이름 | 다른 줄 |
| `a12/*`, `a09/*` | P1 Task 12(A09 꼭짓점), P3 C-3·C-4 | 고치지 않는다 | 겹치지 않는다 |
| 데이터 잠금 | P2 Task 10, P4 Task 8 | Task 3 | 같은 시각에 돌리지 않는다 |

**순서:** 준비 → T1 → (게이트 실패 시 Checkpoint S) → T2 → T3(사용자 승인) → T4 → T5.

## 판단 기록

- **원천 폴더를 새로 둔다(`raw/datagokr/15148355/<기준일>/`, `raw/datagokr/15052266/<기준일>/`).** 옛 VWorld 폴더(`raw/zoning`·`raw/districts`·`raw/maintenance_zone`·`raw/land_price`, 각 `2026-09-09`·`2026-05-26`)에 섞으면 날짜로 고르는 판별(`latestShpPerSido`)이 어느 쪽 파일을 읽었는지 기록과 어긋날 수 있다. 새 폴더 하나만 읽게 하고, 옛 폴더는 게시·GC 뒤 사용자 결정으로 지운다(Task 5).
- **15148355 한 원천이 dsId 24의 세 묶음(용도지역·구역·정비)을 모두 대신하는지 Task 1에서 확인한다.** 지금 세 단계는 같은 dsId 24의 레이어 23개(용도지역 `AL_D124~128`, 구역·시설 `AL_D140·D032·D025·D033·D060·D142~D149`, 정비 `AL_D029·D027·D314·D316·D028`, `zoning.ts:18-24`·`districts.ts:33-47`·`maintenance-zone.ts:20-26`)를 읽는다. 한 레이어라도 없으면 그 묶음은 교체하지 못하므로 게이트에서 멈춘다.
- **엔진 출력은 그대로가 목표다.** 원천이 같으면 feature는 같고 바뀌는 것은 release(제공처·URL·기준일·권리)뿐이다. 그래서 A12·A04·A09·D12 리비전을 올리지 않는다(manifestHash로 키가 바뀐다). D11만 문구 때문에 올린다.
- **VWorld 받기 경로를 지운다.** 학구도 교체가 VWorld 학구도 받기 스크립트를 지운 것(`3c4e64a3`)과 같다. 24·6을 다시 받아 저장하는 실수를 막는다. 이 변경으로 쓸모가 없어지는 `latestFullPerLayer`·`rawZipName`의 24 분기·`fetchDatasets`의 `layers` 옵션도 함께 지운다(자기 변경이 만든 죽은 코드).
- **대조 스크립트를 저장소에 둔다.** 다음 판(월간·연간)에도 「같은 원본인지」를 다시 볼 일이 있어 `source-swap-compare.mjs`로 남긴다(dryrun 스크립트 선례).

---

### 준비 (Judge)

- [ ] 원장을 만든다. dev에 대치동 503 주소 분석 `fe9e688b-f7d0-4eda-b00a-7867ea6636ee`가 있는지, 정비 단계가 보이는 대지(A09, P1 원장의 고덕동 693 `02b2623e` 등)와 녹지가 있는 대지(A04 D09)를 고른다.
- [ ] **전 캡처:** 그 분석들의 A12·A04·A09·D11·D12 장과 출처 장(1440·1024 + PPT SaveAs)을 `…\scratchpad\swap\before\`에 둔다.

### Task 1: 받기와 같은 원본 대조 (Judge 주도, 스크립트는 Executor A medium)

**Files:**
- 원천: `C:/SiteAnalysisData/v2/raw/datagokr/15148355/<기준일>/`, `…/15052266/<기준일>/`(받은 파일 그대로 + `meta.json`: 페이지 URL·실제 다운로드 URL·시각·크기·sha256)
- Create: `src/scripts/v2/source-swap-compare.mjs`
- Create: `.superpowers/sdd/2026-11-05-zoning-landprice-swap/same-source-check.md`

**Interfaces:**
- Produces(Task 2가 쓴다): 새 파일 이름 꼴, 레이어 23개 대응표, 필드 이름·형, `.prj` CRS, 인코딩(`.cpg`), 기준일, 공시지가 CSV 열·나뉨(시도별/전국)·기준연도·기준월.
- `source-swap-compare.mjs` CLI:
  `npx tsx src/scripts/v2/source-swap-compare.mjs --zoning-old <raw/zoning·districts·maintenance_zone 날짜 폴더들> --zoning-new <raw/datagokr/15148355/<기준일>> --price-old <raw/land_price/2026-05-26> --price-new <raw/datagokr/15052266/<기준일>> --sigungu 11680 --out <md>`
  - 레이어마다(fileTag 기준): 전국 행 수(옛/새), 필드 이름·형 목록 비교, `.prj` 비교, 기준일
  - 강남구(`A4 = 11680`) 표본: `A1` 집합의 겹침(옛∩새 ÷ 옛∪새), 겹친 `A1`의 `A5·A6·A7·A8·A9` 일치율, 도형 면적 상대 차이 중앙값·최대(UTM-K), 중심점 거리 최대
  - 공시지가: 열 이름 비교, 파일 나뉨, 기준연도·기준월 분포, 강남구 PNU(`11680`으로 시작) 겹침률, 같은 기준연도인 PNU의 공시지가 일치율

- [ ] **Step 1: 원문과 연결 경로(Aside, 읽기 전용)** — data.go.kr 15148355·15052266 페이지의 이용허락범위 문구, 제공기관, 등록·수정일, 파일 목록(이름·크기), 다운로드 버튼이 **포털에서 파일을 직접 주는지, VWorld(또는 다른 사이트)로 넘기는지**를 원문 그대로 옮긴다. VWorld로 넘기면 **게이트 실패**(Review Focus 1)로 Checkpoint S.
- [ ] **Step 2: 받기** — 포털에서 두 데이터셋을 받는다. 로그인·활용 신청이 필요하면 **사용자 조치**로 넘긴다(「data.go.kr에 로그인해 두 파일을 받아 경로를 알려 주세요」). 새 빈 폴더에 두고 `meta.json`을 쓴다. zip은 새 빈 폴더에 푼다.
- [ ] **Step 3: 대조 스크립트 작성·실행**(Executor A medium) — 위 CLI. 스크립트는 저장소에, 입력은 받은 폴더 경로로 넘긴다. 결과 md를 `same-source-check.md`에 붙인다.
- [ ] **Step 4: 게이트 판정(Judge)** — 아래를 모두 넘어야 Task 2로 간다.
  - 연결 경로: 포털이 직접 파일을 준다(Step 1).
  - 레이어: 지금 쓰는 23개 fileTag가 모두 있다. 필드 이름·형이 같다(`A0~A9`). CRS가 같다(다르면 `crsFromPrj`가 읽는지 확인하고 「다름」으로 적는다).
  - 강남구 표본: 기준일이 같으면 `A1` 겹침 ≥ 99 %, 겹친 행의 속성 일치 ≥ 99 %, 면적 상대 차이 중앙값 ≤ 0.1 %. 기준일이 다르면 겹친 행의 속성·도형 기준은 같고, 겹침률은 차이와 날짜를 함께 적어 Judge가 판단한다.
  - 공시지가: 열 이름이 같고(`고유번호`·`기준연도`·`기준월`·`공시지가`·`표준지여부`·`법정동명`), **기준연도가 지금 적재본(2026) 이상**이다. 같은 기준연도면 강남구 PNU 겹침 ≥ 99.5 %·공시지가 일치 ≥ 99.9 %.
  - 하나라도 못 넘으면 Checkpoint S. 넘으면 원장에 「게이트 통과」와 수치.
- [ ] **Step 5: 커밋** — `feat(v2): VWorld 24·6과 data.go.kr 15148355·15052266 같은 원본 대조 스크립트와 결과` (스크립트 + `same-source-check.md`)

### Checkpoint S (게이트 실패 때만): 사용자에게 묻기

- [ ] Judge가 실패 항목과 수치를 결정 페이지로 낸다. 예상 선택지(실패 종류별): 포털이 VWorld로 넘김 → 「미지정 파일을 data.go.kr 표시만으로 쓴다 / 다른 원천(토지이음 SHP 15047831 등)을 찾는다 / 그대로 두고 영리 전환 때 재검토」, 포털 판이 오래됨 → 「1년 전 공시지가로 내린다 / 공시지가만 VWorld 유지」, 레이어 누락 → 「그 묶음만 VWorld 유지 / 그 묶음을 뺀다」. 답에 따라 이 계획을 고친다.

### Task 2: 적재 경로 교체

**Files:** 위 「파일 구조」의 Task 2 줄 전부.

**Interfaces:**
- Consumes: Task 1의 파일 이름 꼴·대응표.
- Produces:
  - data-build: 용도지역·구역·정비구역 세 단계는 `raw/datagokr/15148355`의 가장 최근 기준일 폴더를 `extractAll` 한 뒤 지금 판별 함수에 넘긴다. 공시지가 단계는 `raw/datagokr/15052266`. 옛 폴더(`raw/zoning` 등)는 읽지 않는다. 새 폴더가 없으면 그 단계를 만들지 않고 안내 줄만 남긴다. 레이어가 빠지면 지금처럼 오류를 내되 안내를 「data.go.kr 15148355에서 받아 raw/datagokr/15148355/<기준일>/에 두세요」로 바꾼다.
  - release(네 단계): `provider: "국토교통부(공공데이터포털 일별용도지역지구정보)"` / `"국토교통부(공공데이터포털 개별공시지가정보)"`, `sourceUrl: "https://www.data.go.kr/data/15148355/fileData.do"` / `"https://www.data.go.kr/data/15052266/fileData.do"`, `licenseCode: "UNRESTRICTED"`(그대로), `sourceAsOf`는 지금 규칙(파일 이름 날짜) 그대로, `fetchedAt`·`checksum`도 지금 규칙.
  - 권리 상수:
    ```ts
    // zoning.ts
    export const ZONING_RIGHTS = {
      basis: "data.go.kr 15148355 일별용도지역지구정보 '이용허락범위 제한 없음'",
      downloadedFrom: "공공데이터포털 파일데이터(15148355)",
      decision: "2026-11-05 사용자 결정: VWorld dsId=24(라이선스 미지정, 약관 19조 저장 예외 아님) 대신 data.go.kr 파일",
      excluded: "연속주제 파일 15147018(공공누리 4유형)은 쓰지 않는다",
    } as const;
    // land-price.ts
    export const LAND_PRICE_RIGHTS = {
      basis: "data.go.kr 15052266 개별공시지가정보 '이용허락범위 제한 없음'",
      downloadedFrom: "공공데이터포털 파일데이터(15052266)",
      decision: "2026-11-05 사용자 결정: VWorld dsId=6(라이선스 미지정) 대신 data.go.kr 파일. CSV(속성)만 적재",
    } as const;
    ```
    `DISTRICT_RIGHTS`·`MZONE_RIGHTS`의 `note`는 「VWorld dsId=24」를 「같은 data.go.kr 15148355 파일」로 바꾼다. 머리 주석(`districts.ts:1-8`, `d11/engine.ts:1`, `d12/engine.ts:1`)의 「VWorld dsId 24」도 같이 바꾼다.
  - 받기 도구: `FOLDERS`에서 `24`·`6`을 뺀다(두 스크립트). `ZONING_LAYERS`(`vworld-fetch.mjs:11`), 6·24 전용 `layers`·`--folder`·`--since`·`--layers` 처리(`:40-47`, `vworld-fetch-large.mjs:44-46`), `vworld.ts`의 `latestFullPerLayer`(`:105-115`)·`rawZipName` 24 분기(`:117-118`)·`fetchDatasets`의 `layers` 옵션(`:244-258`)을 지운다. P4 Task 2가 먼저 들어왔으면 그 Task가 쓰는 것은 남긴다.
  - 표시 이름: `SOURCE_NAMES.district_*` 다섯 개를 `"국토교통부 용도지구·구역"`으로.
  - D11 판단 문장(`d11/engine.ts:137`)의 「VWorld 최신 자료와 고시 원문 확인 필요」 → 「최신 자료와 고시 원문 확인 필요」. 리비전 `common.ts:39` D11 끝에 `+source-swap-r1`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - ① `test-v2-districts.mjs:27`을 `assert.match(DISTRICT_RIGHTS.basis, /15148355/)`로, `test-v2-land-price.mjs`에 `assert.match(LAND_PRICE_RIGHTS.decision, /dsId=6/)`·`assert.match(LAND_PRICE_RIGHTS.downloadedFrom, /15052266/)`, `test-v2-zoning.mjs`에 `assert.match(ZONING_RIGHTS.basis, /15148355/)`
  - ② `test-v2-vworld.mjs`: 24 전용 단언을 지우고, `FOLDERS`에 24·6이 없다는 단언(스크립트를 import할 수 없으면 `vworld-fetch.mjs` 본문에 `24: "zoning"`·`6: "land_price"`가 없는지 문자열로)
  - ③ (자동 테스트가 아니라 Step 5의 확인 명령) data-build 원천 판별: scratch raw에 Task 1 대응표 꼴의 작은 fixture(레이어마다 한 파일)를 `raw/datagokr/15148355/20261101/`에, 옛 꼴을 `raw/zoning/2026-09-09/`에 함께 두고 `npm run data:build -- --data-dir <scratch> --version dry --only reference --dry-run --raw <scratch raw>`를 돌린다. 출력의 단계 id 23개(레이어)와 공시지가 단계가 모두 `datagokr/` 경로이고 `zoning/2026-09-09`가 하나도 없어야 한다
  - ④ `sourceName("district_area") === "국토교통부 용도지구·구역"`. `test-v2-report-doc-plan.mjs:337` 근처의 같은 이름 단언·주석을 새 이름으로
  - ⑤ D11 반경 교차 0건 fixture의 판단 문장에 「VWorld」가 없다
- [ ] **Step 2: 실패 확인** — ①②④⑤ 테스트 FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 고정값** — registry D11(`test-v2-tile-registry.mjs:44`), topo-run D11 키(`:36`). 다른 키는 움직이면 안 된다(`updating-hash-pinned-baselines`).
- [ ] **Step 5: 통과 확인** — `test-v2-districts.mjs`·`test-v2-land-price.mjs`·`test-v2-zoning.mjs`·`test-v2-mzone.mjs`·`test-v2-code-remap.mjs`·`test-v2-vworld.mjs`·`test-v2-source-details.mjs`·`test-v2-report-doc-plan.mjs`·`test-v2-ingest-resume.mjs`·`test-v2-tile-registry.mjs`·`test-v2-topo-run.mjs` PASS, lint 0, ③ dry-run 확인. `grep -rn "dsId=24\|dsId 24\|dsId=6" src/lib/v2 src/scripts/v2/data-build.mjs`에 남은 것이 권리 기록의 「대신」 문장뿐인지 본다.
- [ ] **Step 6: 커밋** — `fix(v2): 용도지역·구역·정비구역·공시지가를 VWorld 24·6 대신 data.go.kr 15148355·15052266 파일로 적재 — 라이선스 미지정 자료 저장 중단`

### Task 3: reference 빌드·게시 (Judge, 사용자 승인 뒤)

- [ ] **Step 1: 승인과 시각** — 사용자에게 「게시하면 운영 새 분석의 용도지역·구역·정비구역·공시지가 원천이 data.go.kr 판으로 바뀐다(값은 Task 1 대조대로 같다)」를 알리고 승인을 받는다. 부팅 시각·다음 종료, `Get-PSDrive C`, 다른 data-build·data-gc 없음, `.lock` 없음. P3 C-4 적재 변경이 있으면 커밋됐는지(겹침 표).
- [ ] **Step 2: 래퍼와 시작** — `C:/SiteAnalysisData/v2/swap-build.sh`(P2 `p2-build.sh` 꼴): `v=<YYYY-MM-DD>-datagokr`, `npm run data:build -- --version $v --only reference --raw D:/V-coding/16-SiteAnalysis/.cache/v2/raw --wait-lock 60 --log C:/SiteAnalysisData/v2/build-$v.log`, 버전 폴더가 있으면 `--resume`. 콘솔 로그에 시작·`EXIT`. `nohup … &`로 띄우고 Monitor로 `^EXIT`.
- [ ] **Step 3: 게이트 실패 처리** — `[gate] FAIL code=…`이면 코드·원천·상세를 적는다. 의도한 변화(기준일 차이로 행 수 변동, 시도 코드 변경으로 REGION_MISSING 등, Review Focus 4)면 그 원천을 `--reset-baseline <원천들>`에 넣어 같은 이름에 `--resume`(학구도 선례). 의도하지 않은 실패면 원인을 고친 뒤 다시.
- [ ] **Step 4: 결과** — `EXIT 0`, manifest reference가 새 판. 새 판 `source_release`에서 네 묶음의 `provider`·`source_url`이 data.go.kr이고 VWorld가 없다(`SELECT source_id, provider, source_url FROM source_release WHERE source_url LIKE '%vworld%'`가 0행). 레이어별 feature 수가 옛 판과 Task 1 기대값 안.

### Task 4: 갤러리·출처 장·기록 (Judge, 캡처는 Executor A medium 가능)

- [ ] **Step 1: 새 분석 갤러리** — 준비 단계의 대지를 새로 분석해 A12·A04·A09·D11·D12 장을 1440·1024(`capture-pages.mjs` + `measure.mjs`)와 PPT SaveAs(180 s)로 찍고, 「전」 캡처와 나란히 둔다. 값(용도지역 면적·공시지가·정비구역·구역 면적)이 Task 1 대조대로 같은지 본다. 다른 값은 기준일 차이로 설명되는지 적는다.
- [ ] **Step 2: 출처 장·카드 출처 줄·가이드** — 출처 장 표에서 네 묶음 행이 「국토교통부(공공데이터포털 …)」·「이용허락범위 제한 없음」·data.go.kr 링크이고 VWorld가 없다. 카드 출처 줄이 `국토교통부 용도지구·구역`이다. 가이드(`ui/guide-sources.ts` 표)도 같다. PDF·PNG(`tools/qa/export-pdf-png.mjs` → `pdf-images.mjs`)에서 출처 장 잉크를 본다.
- [ ] **Step 3: 저장 분석** — 교체 전에 만든 저장 분석이 옛 판으로 열리고 출처 장이 옛 VWorld 기록 그대로인지 본다(고정 버전, 자동 재계산 없음).
- [ ] **Step 4: 기록** — 정본 결정 이력에 2026-11-05 줄(「용도지역·구역·정비구역·공시지가 원천: VWorld 다운로드 24·6(라이선스 미지정) → data.go.kr 15148355·15052266(제한 없음)」, 근거 결정 노트). A0 문서 `:23-24`·`:65-66`·`:75`에 「(2026-11-05 data.go.kr 파일로 교체, 이 계획)」을 붙인다(옛 기록은 지우지 않는다). 커밋: `docs(v2): 용도지역·공시지가 원천 교체 기록 — 정본 결정 이력, A0 표`

### Task 5: 인수·GC·옛 원천 파일 (Judge)

- [ ] **Step 1:** `npm run lint` 0, `npm run test:v2` 전체 PASS(마지막 줄 첨부). 고정값 표(움직인 것은 D11 두 곳뿐인지).
- [ ] **Step 2: GC** — 「데이터 버전과 GC」 명령. deleted 목록에 현재·이전 매니페스트와 저장 분석 고정 판이 없는지, 확보 용량.
- [ ] **Step 3: 옛 VWorld raw 폴더(사용자 결정, 열린 질문 2)** — 승인되면 `raw/zoning/2026-09-09`·`raw/districts/2026-09-09`·`raw/maintenance_zone/2026-09-09`·`raw/land_price/2026-05-26`이 일반 폴더(링크 아님)인지 확인하고 지운다(학구도 `raw/school_zone/vworld` 선례). 크기를 원장에 적는다.
- [ ] **Step 4:** 최종 리뷰(Opus) → 사용자에게 운영 코드 배포 여부를 묻는다(D11 문구는 코드 배포 전까지 옛 문구). vault 세션 노트, 원장 라우팅 줄.

---

## 열린 질문

1. **(자료, Task 1) 포털이 파일을 직접 주는가.** A0 문서는 15045898·15052266을 「→ VWorld dsId=24·6」로 적었다. 15148355도 VWorld로 넘기면 교체 근거가 없어진다(게이트).
2. **(사용자) 옛 판 안의 VWorld 24·6 자료.** 저장 분석이 고정한 옛 reference 판(예: `2026-11-04-koies` 이하)에는 VWorld에서 받은 용도지역·공시지가가 남는다. GC는 저장 분석을 지키려고 이 판을 남긴다. 지우려면 그 저장 분석을 새 판으로 다시 분석해야 한다. 옛 raw 폴더(Task 5 Step 3) 삭제와 함께 정한다.
3. **(자료, Task 1) 공시지가 기준연도.** 포털 판이 2025 기준이면 교체는 1년 전 값으로 내린다(Checkpoint S).
4. **(Judge) P3 C-4의 적재 변경 여부.** spec C-4 코드 목록에 `ingest/sources/zoning.ts:42`가 있다. P3 계획이 적재 분류를 바꾸면 Task 3 빌드 전에 들어와야 한 판으로 끝난다.
5. **(Judge) 15148355에 용도지구 레이어가 있는가.** 있으면 P5 Checkpoint A-1의 대체 후보가 된다. Task 1 Step 3 레이어 목록에서 함께 적는다(이 계획은 적재하지 않는다).

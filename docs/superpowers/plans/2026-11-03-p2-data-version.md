# 지도 라벨·지도 표현·자료 보강 P2 — 자료 버전(A-2·A-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표제부·전유부·도로명주소 건물을 다시 결합해 오피스텔 누락(A-2)과 건물 이름·준공 연대·용도 결측(A-3)을 줄인 core·buildings 새 데이터 버전을 게시한다. PNU로 옮겨 채운 값과 추정값은 확정값과 따로 센다.

**Architecture:** 「PNU → 표제부 주건축물 행 집합」 요약 함수 하나(`summarizePnuTitleRows`)를 A-2 오피스텔(core)과 A-3 건물 결합(buildings)이 함께 쓴다(spec 추천 2). 확정값은 기존 열(`use_code`·`approval_date`)에, 라벨 전용 이름과 추정 용도는 새 열(`label_name`·`use_code_estimated`)에 두고 출처는 `field_provenance_json`에 남긴다. 엔진은 새 열을 `BuildingRow`에 싣고 D03(추정 용도 분리)·D04(승인일 출처별 한계 문구)만 바꾼다. 빌드 전에 같은 함수로 지금 데이터의 규칙 정확도를 재고, scratch 데이터 폴더에서 리허설한 뒤, 부팅 직후 core·buildings를 한 번에 빌드한다(약 3.5시간, 재개 불가).

**Tech Stack:** TypeScript · better-sqlite3(SQLite JSON1) · tsx · 테스트 `src/scripts/v2/test-v2-*.mjs`(`npx tsx`) · `npm run data:build` · `src/scripts/v2/data-gc.mjs`

**Spec:** `docs/superpowers/specs/2026-11-03-labels-map-expression-design.md`(2026-11-03 확정). §2-1의 A-2·A-3 ①~⑥·「A-3 N1·N3」·「데이터 버전과 보호」, §3 P2 행, §3-1 A, §3-2, §4-1, §5-1~5-3을 따른다. 근거 조사는 `.superpowers/sdd/2026-10-30-report-page-layout/`의 `usage-unknown-research.md`·`unnamed-buildings-research.md`·`next-plan-inv-buildings.md`·`next-plan-spec-rulings.md`(C2·C3)다. 실행자는 spec과 이 계획을 함께 읽는다.

## Global Constraints

- **라우팅(사용자 지시, 원장 라우팅 예외):** 구현 Task(1·3~7·8의 코드·9)는 Sonnet high 실행자가 하고 리뷰는 Opus가 한다. Task 2·8의 판정, Task 10·11은 Judge(메인 세션)가 한다. 실행자는 관련 테스트만 돌린다. 전체 `npm run test:v2`는 Judge가 인수할 때 한 번 돌린다. 실행자 보고는 `collecting-tdd-ledger-reports` 형식(RED·GREEN 출력 원문)으로 받고, 원장 폴더는 `.superpowers/sdd/2026-11-03-p2-data-version/`이다.
- **작업 위치:** P1과 병렬이라 P2는 worktree `.worktrees/p2-data`(브랜치 `v2-p2-data`, `v2-cartography`에서 분기)에서 한다. node_modules는 본 저장소를 가리키는 junction으로 둔다. worktree를 지울 때는 reparse point를 확인하고, 재귀 옵션 없이 링크만 끊은 뒤 삭제한다(AGENTS, vault `30-Patterns/Windows junction 안의 node_modules 와 재귀 삭제.md`).
- **파일 편집:** Edit/Write 도구로만 한다. sed·python·heredoc 패치는 쓰지 않는다.
- **데이터 위치:** `C:/SiteAnalysisData/v2`이고, 본 저장소 `.cache/v2`는 이를 가리키는 junction이다. 빌드·dev 서버·GC는 `V2_DATA_DIR=D:/V-coding/16-SiteAnalysis/.cache/v2/data`, raw는 `--raw D:/V-coding/16-SiteAnalysis/.cache/v2/raw`로 지정한다. 옛 버전은 손으로 지우지 않는다. GC 명령은 `V2_DATA_DIR=D:/V-coding/16-SiteAnalysis/.cache/v2/data npx tsx src/scripts/v2/data-gc.mjs --app-db C:/SiteAnalysisData/v2/app.sqlite,C:/SiteAnalysisData/serve/app.sqlite`다.
- **운영(serve)도 같은 데이터 폴더를 쓴다.** `C:/SiteAnalysisServe/serve.env`에 `V2_DATA_DIR=C:/SiteAnalysisData/v2/data`가 있다(2026-11-03 확인). 그래서 Task 10의 게시는 곧 운영 새 분석의 데이터 전환이다. 사용자 승인 뒤에만 한다(열린 질문 1). 리허설은 scratch 폴더에서만 한다.
- **추정은 확정과 섞지 않는다.**
  - `use_code`에는 GIS A8과 결합 행(R1) 값만 넣는다. PNU 단일 주용도(R2)는 `use_code_estimated`에 넣는다.
  - 라벨 이름(⑤ 결합 행 건물명, N1 `POS_BUL_NM`)은 `label_name`에만 둔다. `feature.name`·`hit.name`은 바꾸지 않는다. 그래야 D02·D29·장면 해시·교체 판정 입력이 그대로다.
- **1층 3m 추정은 그대로다.** 높이·층수 경로는 바꾸지 않는다. 비교표에는 1층 가정 비율을 옛 판과 새 판으로 함께 낸다(AGENTS).
- **넣지 않는 규칙(spec):**
  - S4(가장 이른 날짜), R3(`BDTYP_CD` 대응표), R4(다수결), N2(표제부 PNU 단일 건물명)
  - N4(상가정보), N5(수치지형도 NAME), 부번 보정, 동 번호 붙이기
  - R5(동 이름 결합)도 이번 빌드에서는 뺀다(열린 질문 4).
- **리비전:** 엔진 리비전은 Task 9의 D03·D04만 올린다. 적재 변경은 manifestHash가 키를 바꾸므로(`run.ts:71-80`) A05·A07 등은 올리지 않는다. 고정값은 `updating-hash-pinned-baselines`로 갱신한다.
- **화면·표기:**
  - 화면에 닿는 Task 9는 시작 전에 `docs/design/v2-design-language.md` §1·§6·§8·§8-1을 읽는다. `ui-ux-pro-max`와 `my-design-taste`를 쓰고, 정본에 없는 패턴은 만들지 않고 보고한다.
  - D03 큰 답 보조 줄(추정 동수)은 시안 전이라 바꾸지 않는다(spec §5-1).
  - 사용자에게 보이는 문구는 한국어로 쓴다. 수는 `toLocaleString("en-US")`로 쓴다.
- **커밋:** Task별로 `feat(v2):`/`fix(v2):` + 한국어 요약 + 세션 attribution 줄을 단다. push·배포는 하지 않는다.
- **회사 PC 종료:** PC가 06:00·18:00에 꺼진다. 리허설·빌드 시작 전에 부팅 시각, 다음 종료까지 남은 시간, 로그, 프로세스를 확인한다.

## Review Focus

1. **옛 판과 새 판이 섞일 때.** 새 엔진이 새 열이 없는 옛 buildings 파일(저장 분석이 고정한 `2026-10-10b`)을 열어도 오류 없이 새 필드를 null로 둬야 한다. 옛 엔진(운영 main)이 새 열·새 출처 문자열·`officetel:<pnu>` feature를 읽어도 오류가 없어야 한다. → Task 9 옛 스키마 테스트, Task 8 리허설의 엔진 호출
2. **1:N 폐기와 라벨 순서.** 같은 표제부 PK가 두 동에 붙어 버려진 건물에는 ⑤ 이름이 남지 않아야 하고, 먼저 써 둔 POS는 남아야 한다. 결합이 확정된 건물에서는 ⑤가 POS를 이긴다. → Task 6 테스트
3. **단지 안 상가·교회.** 비주거 건물(use_code 03·04·06 등, 확정이 없으면 추정·`BDTYP_CD`)에는 같은 PNU 단지명과 같은 POS가 붙지 않아야 한다. 「아파트」·동 번호·공백 차이도 같은 이름으로 본다. 공동주택 동에는 붙는다. → Task 1·7 테스트
4. **새 승인일과 철거 판정.** S1·S3·③ 날짜가 생긴 옛 GIS 건물이 교체·철거 판정(`juso-buildings.ts:522-530`, `buildings-shared.ts:531-588`)에 새로 걸려 반경 건물이 줄 수 있다. → Task 2 상한, Task 8·11 비교표의 철거 제외 수(증가가 반경 동수의 1 %p를 넘으면 사례 확인)
5. **한 필지에 단지와 오피스텔이 섞인 경우.** 타워팰리스처럼 단지 필지에는 officetel을 만들지 않는다. 표제부와 전유부가 같은 필지에 있으면 officetel feature는 하나다. → Task 3 테스트

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/v2/ingest/sources/ledger.ts` | PNU 표제부 요약·core 단지 사실(규칙 함수), A-2 오피스텔 | 1·3 |
| `src/lib/v2/ingest/sources/buildings.ts` | GIS 건물 적재: S1·S3·③·R1·R2·⑤, 1:N 판정 | 1·4·5·6 |
| `src/lib/v2/ingest/sources/juso-buildings.ts` | 도로명주소 건물: ④(PNU 규칙)·N1 POS, 단지명 비교 | 1·7 |
| `src/lib/v2/data/schema.ts` | `building_fact.use_code_estimated`·`label_name` | 4 |
| `src/scripts/v2/data-build.mjs` | core·ledger를 적재기에 넘김, 진행표 지문 | 8 |
| `src/scripts/v2/building-fill-compare.mjs`(새 파일) | 옛/새 판 비교표(리허설·게시 뒤 재사용) | 8 |
| `src/lib/v2/engine/tiles/buildings-shared.ts` | `BuildingRow` 새 필드·출처 분류 | 9 |
| `src/lib/v2/tile/d03/engine.ts`·`d04/engine.ts`·`ui/map-layers.ts`·`engine/tiles/common.ts` | D03 추정 분리, D04 한계 문구, `use:*_est` 레이어, 리비전 | 9 |
| 테스트 | `test-v2-ledger-rules.mjs`(새 파일), `test-v2-building-ledger-fill.mjs`(새 파일), `test-v2-ledger.mjs`, `test-v2-height2.mjs`, `test-v2-juso-buildings.mjs`, `test-v2-tile-d03-buildings.mjs`, `test-v2-tile-d04-years.mjs`, `test-v2-building-quality.mjs` + 고정값 3곳 | 각 Task |

## P1(라벨)과 겹치는 파일

spec §3은 P2를 「적재기만 바꿔 P1과 파일이 겹치지 않는다」고 보았다. Task 1~8(적재·리허설)은 그 말대로 P1 파일을 건드리지 않는다. 그러나 spec이 P2에 넣은 엔진 변경(D03 추정 분리·D04 한계 문구, §2-1 A-3)은 P1과 같은 파일을 고친다.

| 파일 | P1 | P2(Task 9) | 처리 |
|---|---|---|---|
| `engine/tiles/buildings-shared.ts` | P1 Task 5: `pnuSupplement?`(A-1 이름·승인일)과 `buildingLabelName(row)`(잡음이 아닌 `hit.name` ?? `pnuSupplement.name`) | `BuildingRow`에 선택 필드 `labelName?`·`labelNameSource?`·`useCodeEstimated?`를 더하고 새 열을 읽는다. 승인일 출처를 분류하고, `buildingLabelName` 순서에 `labelName`을 끼운다 | **겹침.** Task 9는 P1 Task 5 커밋이 기준 브랜치에 들어간 뒤 rebase해서 한다. 둘을 동시에 고치지 않는다. 필드는 P1처럼 값이 있을 때만 둔다. 이름 순서는 잡음이 아닌 `hit.name` → 잡음이 아닌 `labelName` → `pnuSupplement.name`이다(spec 「적재 값과 겹치면 적재 값, A-1은 빈 칸만」) |
| `tile/d03/engine.ts`·`tile/d04/engine.ts` | B-3 라벨 대상·상세 줄, A-1 `core_ledger_pnu` 문구 | 추정 용도 분리, 새 한계 문구 2~3개 | **겹침.** 위와 같은 순서로 한다. 기존 `ledgerBackfilled` 문구는 P1 몫이라 P2는 건드리지 않는다 |
| `engine/tiles/common.ts` | 리비전 11개 | D03·D04 리비전 한 번 더 | **겹침.** rebase 뒤 접미사를 덧붙인다 |
| `test-v2-tile-registry.mjs:40-41`·`test-v2-topo-run.mjs:32-33`·`test-v2-topo-supplement.mjs:29-30` | 고정값 갱신 | D03·D04 고정값 갱신 | **겹침.** rebase 뒤 한 번에 다시 만든다 |
| `ingest/sources/building-names.ts` | P1 Task 5: `isLabelNoiseName`(N3) | 고치지 않는다(새 함수는 `juso-buildings.ts`에 둔다). 적재(N1)는 잡음 판정 없이 의미 있는 POS를 그대로 `label_name`에 둔다. 잡음 걸러내기는 엔진의 `buildingLabelName`이 `labelName`에도 적용한다(Task 9) | 겹치지 않는다. Task 1~8은 P1 Task 5를 기다리지 않는다. P1 계획의 「P2 N1은 `isLabelNoiseName`을 쓴다」는 Task 9에서만 맞다(열린 질문 8). P1이 `composeBuildingName`(`:34-35`)도 바꾸면 그 변경이 P2 빌드 데이터에 실린다 |
| `ui/map-layers.ts` | (B-2는 고치지 않음) | `use:*_est` 9개 추가 | P1과는 겹치지 않는다. P3 C-5가 `use:미상`(`:272`)을 고친다 |
| 정본 §8 | B-4 수정점 | 건물 면 이름 출처 표 | Judge가 한 번에 고친다(Task 11) |

**순서:** T1 → T2(판정) → T3 ∥ (T4 → T5 → T6 → T7) → T8(판정) → T10(사용자 승인) → T11. T9는 P1의 겹치는 커밋 뒤, T11 갤러리 전에 한다. T9가 늦으면 T11의 D03·D04 확인을 T9 뒤로 미룬다.

---

### Task 1: 표제부 PNU 해석·이름 후보 규칙(순수 함수)

**Files:**
- Modify: `src/lib/v2/ingest/sources/ledger.ts`
  - `LedgerFloorLookup`(`:61-65`)
  - `sqlLedgerLookup`(`:238-279`)
  - 새 함수는 `normalizedLedgerName`(`:90`) 아래에 둔다.
- Modify: `src/lib/v2/ingest/sources/juso-buildings.ts`(`coreApprovalByPnu` `:96-128` 아래)
- Modify: `src/lib/v2/ingest/sources/buildings.ts`(`heightOf` `:50` 아래)
- Create: `src/scripts/v2/test-v2-ledger-rules.mjs`

**Interfaces:**
- Produces:
  ```ts
  // ledger.ts
  export function uniqueNonNull(values: Iterable<string | null | undefined>, key?: (value: string) => string | null): string | null;
  export interface PnuTitleSummary { mainRows: number; approvalDate: string | null; useCode: string | null; buildingName: string | null; floorsAbove: number | null }
  export function summarizePnuTitleRows(rows: ReadonlyArray<{ approvalDate: string | null; useCode: string | null; buildingName: string | null; floorsAbove: number | null }>): PnuTitleSummary;
  // LedgerFloorLookup에 선택 메서드: 표제부 주건축물(is_main = 1) 행만 본다. 행이 없으면 null
  pnuSummary?(pnu: string): PnuTitleSummary | null;
  export interface CoreComplexFacts { approvalDate: string | null; names: string[] }
  export function coreComplexFactsByPnu(core: Db | null | undefined, sido: string): Map<string, CoreComplexFacts>;
  // juso-buildings.ts
  export function sameComplexName(a: string | null, b: string | null): boolean;
  export function posLabelCandidate(input: { pos: string | null; currentName: string | null; useCode: string | null; complexNames: readonly string[] }): string | null;
  // buildings.ts
  export function titleLabelCandidate(match: Pick<LedgerFloorMatch, "buildingName"> | null, currentName: string | null): string | null;
  ```
- **규칙**
  - `uniqueNonNull`: null·undefined·빈 문자열은 건너뛴다. `key`로 비교해 서로 다른 값이 하나뿐이면 처음 나온 원래 값을 돌려준다. 아니면 null이다.
  - `summarizePnuTitleRows`
    - `approvalDate = uniqueNonNull(날짜)`(S1, 조사 `appr.mjs`와 같다)
    - `useCode = uniqueNonNull(용도코드)`(R2)
    - `buildingName = uniqueNonNull(건물명, normalizedLedgerName)`
    - `floorsAbove`는 `mainRows === 1`일 때만 그 행 값이다.
  - `pnuSummary`(SQL 구현): `SELECT approval_date, use_code, building_name, floors_above FROM ledger_title_dong WHERE pnu = ? AND is_main = 1`로 읽는다. core feature 폴백(`ledgerFloorLookup`의 `:295-356` 경로)에는 두지 않는다.
  - `coreComplexFactsByPnu`: `coreApprovalByPnu`처럼 시도마다 한 번 범위 질의하고 결과를 캐시한다.
    - `approvalDate`는 총괄 단지(`housing_complex` 중 `stable_id LIKE 'recap:%'`)와 `kapt_complex`의 `approvalDate`를 합친 집합에 `uniqueNonNull`을 적용한 값이다(S3). `title-housing:`은 넣지 않는다(S1 몫). 날짜는 실재하는 `YYYY-MM-DD`만 받는다.
    - `names`는 모든 `housing_complex`의 name과 `kapt_complex`의 name·nameAppraisal·nameLedger·nameRoad를 모으고 중복을 뺀 목록이다.
  - `sameComplexName`
    - 비교 키: `normalizeBuildingName(x)`에서 「아파트」를 모두 지우고, 끝의 `/(\d+|[a-z]|[가나다라마바사아자차카타파하])동$/u`를 한 번 뗀 값이다.
    - 두 키가 모두 2자 이상이고, 같거나 한쪽이 다른 쪽을 포함하면 true다.
  - `posLabelCandidate`: 다음을 차례로 본다.
    1. pos를 NFKC·trim한다. `isMeaningfulBuildingName`가 아니면 null이다.
    2. `normalizeBuildingName(pos) === normalizeBuildingName(currentName)`이면 null이다(새 값이 없다).
    3. `useCode` 앞 2자리가 있고 01·02가 아니며, `complexNames` 가운데 `sameComplexName(pos, n)`인 것이 있으면 null이다(단지 안 상가·교회 차단).
    4. 그 밖에는 pos를 돌려준다.
  - `titleLabelCandidate`: buildingName이 의미 있는 이름이고 정규화 값이 `currentName`과 다르면 trim 값을 돌려준다. 아니면 null이다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-ledger-rules.mjs`(core 픽스처는 `test-v2-height2.mjs:49-71`의 `createLedgerTitleIndex(core, true)`·`insertLedgerTitleIndexRow` 방식을 쓴다)
  ```js
  assert.equal(uniqueNonNull(["2001-01-02", null, "2001-01-02"]), "2001-01-02");
  assert.equal(uniqueNonNull(["2001-01-02", "1999-03-04"]), null);
  assert.equal(uniqueNonNull([null, undefined, ""]), null);
  const row = (approvalDate, useCode, buildingName, floorsAbove) => ({ approvalDate, useCode, buildingName, floorsAbove });
  assert.deepEqual(summarizePnuTitleRows([row("1983-05-01", "02000", "은마아파트", 14), row("1983-05-01", "02000", "은마 아파트", 14)]),
    { mainRows: 2, approvalDate: "1983-05-01", useCode: "02000", buildingName: "은마아파트", floorsAbove: null });
  assert.equal(summarizePnuTitleRows([row(null, "02000", null, 5), row(null, "11000", null, 1)]).useCode, null, "공동주택+노유자 → 추정하지 않음");
  assert.equal(summarizePnuTitleRows([row("1990-01-01", null, null, 7)]).floorsAbove, 7);
  // ledgerTitleLookup(core).pnuSummary: 주건축물 2행(19830501) + 부속 1행(20010101) → approvalDate "1983-05-01", mainRows 2
  // 행 없는 PNU → null
  // coreComplexFactsByPnu: 같은 PNU에 recap:(approvalDate 2004-02-03, name "도곡렉슬"), kapt(2004-02-03, nameAppraisal "도곡렉슬아파트"), title-housing:(2001-01-01)
  //   → approvalDate "2004-02-03", names에 "도곡렉슬"·"도곡렉슬아파트". recap 2004 + kapt 2005인 PNU → approvalDate null
  assert.equal(sameComplexName("한보미도맨션", "미도맨션아파트"), true);
  assert.equal(sameComplexName("대치삼성아파트 101동", "대치삼성"), true);
  assert.equal(sameComplexName("우일빌딩", "개포우성"), false);
  assert.equal(sameComplexName(null, "대치삼성"), false);
  assert.equal(posLabelCandidate({ pos: "우일빌딩", currentName: null, useCode: "04000", complexNames: [] }), "우일빌딩");
  assert.equal(posLabelCandidate({ pos: "라이프시티아파트", currentName: "상가동", useCode: "03000", complexNames: ["라이프시티"] }), null, "단지 안 상가");
  assert.equal(posLabelCandidate({ pos: "라이프시티아파트", currentName: "102동", useCode: "02000", complexNames: ["라이프시티"] }), "라이프시티아파트", "공동주택 동은 허용");
  assert.equal(posLabelCandidate({ pos: "청암빌라트", currentName: "공동주택", useCode: "02000", complexNames: [] }), "청암빌라트", "잡음 이름 대체는 엔진이 정한다");
  assert.equal(posLabelCandidate({ pos: "청암빌라트", currentName: "청암 빌라트", useCode: null, complexNames: [] }), null);
  assert.equal(posLabelCandidate({ pos: "---", currentName: null, useCode: null, complexNames: [] }), null);
  assert.equal(titleLabelCandidate({ buildingName: "동하빌딩" }, null), "동하빌딩");
  assert.equal(titleLabelCandidate({ buildingName: "동하 빌딩" }, "동하빌딩"), null);
  assert.equal(titleLabelCandidate(null, null), null);
  ```
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-ledger-rules.mjs` → export 없음으로 FAIL
- [ ] **Step 3: 구현** — 위 Interfaces 규칙대로 만든다.
- [ ] **Step 4: 통과 확인** — 같은 명령이 PASS하고, `npx tsx src/scripts/v2/test-v2-height2.mjs` PASS, `npm run lint` 0
- [ ] **Step 5: 커밋** — `feat(v2): 표제부 PNU 요약·단지명 비교·라벨 이름 후보 규칙 함수`

### Task 2: 빌드 전 규칙 정확도 측정 (판정: Judge)

**Files:**
- Create(저장소 밖): `<scratchpad>/p2-accuracy/measure.mts`, `result-daechi.json`, `result-galhyeon.json`
- Create: `.superpowers/sdd/2026-11-03-p2-data-version/p2-accuracy.md`

**Interfaces:**
- Consumes: Task 1의 모든 함수(worktree의 `src/...`를 `file:///` 절대 경로로 import), `useClassOf`(`d03/engine.ts:58`), `decadeLayer`(`ui/callout-layout`)
- 데이터는 읽기 전용이다. buildings `2026-10-10b`, core `2026-10-08d`, 표제부 `title_202608.csv`를 쓴다.
- 표본은 엔진 `buildingRows` 중 중심점이 반경 1 km 안인 동이다.
  - 대치동 503: `127.05998, 37.49123`
  - 갈현동 545: `126.91131, 37.62307`
- 입력은 조사 추출물을 다시 쓴다. 경로는 모두 이 세션 scratchpad 아래다: `usage-unknown/rows-*.json`·`raw-*.json`·`title-eunpyeong.json`, `np-inv-buildings/title-gangnam.json`·`recap-gangnam.json`·`kapt-gangnam.json`·`topo-join.json`, `unnamed/juso-extra-*.json`·`core-*.json`·`title-41281.json`. 없거나 형식이 다르면 같은 폴더의 `rows.mts`·`raw.mts`·`scan-title.mjs`·`juso-extra.mts`·`core.mjs`로 다시 만든다.

| 규칙 | 정답 | 모집단 | 지표 | 통과 기준 | 조사값 |
|---|---|---|---|---|---|
| S1 | GIS A13 | A13이 있는 GIS 건물에 `summarizePnuTitleRows(PNU 주건축물).approvalDate` | 연대 구간(`decadeLayer`) 일치 | 두 지역 각각 ≥ 90 %(n ≥ 100) | 대치 92.3 %(n=780). 뺀 S4는 85.7 % |
| S3 | GIS A13 | A13이 있는 GIS 중 S1이 null이고 `coreComplexFacts.approvalDate`가 있는 동 | 연대 일치 | ≥ 90 %(n ≥ 30) | K-APT 93 %(n=353) |
| ③ | GIS A13 | 같은 표제부 PK가 표본 GIS 2동 이상에 붙는 결합. `ledgerTitleLookup`으로 재현한다(조사 `join3.mjs` 방식 + 1:N) | 결합 행 승인일 연대 일치 | ≥ 90 %(n ≥ 30) | 처음 잰다 |
| R1 | GIS A8 | A8이 있고 행 결합된 GIS | D03 10분류 일치 | ≥ 95 % | 95.9 % / 100 % |
| R2 | GIS A8 | A8이 있는 GIS에 `summary.useCode` | 10분류 일치 | 각 ≥ 93 %. 부속 대리 지표는 보고만 한다 | 95.5 % / 99.8 %. 뺀 R3는 86.6~90.6 %, R4는 89.5 % |
| ⑤ | 지금 이름(잡음 제외) | 이름이 있고 행 결합된 GIS에 `titleLabelCandidate(match, null)` | `sameComplexName` 일치 | ≥ 95 % | 99.3 % / 99.9 % |
| N1 | 지금 이름(잡음 제외) | 이름이 있는 건물에 `posLabelCandidate({ currentName: null, … })`(단지 차단 포함) | `sameComplexName` 일치 | 각 ≥ 88 %, 대치 수치지형도 NAME 대조 ≥ 85 % | 89.6 % / 95.4 %, 55/61 |

- [ ] **Step 1: 입력 확인** — 위 추출물이 있는지 본다. 다시 만들었으면 그 명령을 보고서에 적는다.
- [ ] **Step 2: `measure.mts` 작성** — 규칙마다 표의 일치율과 n, 그리고 효과(지금 빈 칸 중 채워지는 동수, 반경 동수 대비 %p)를 낸다. 잡음 이름 판정은 조사 `unnamed/analyze.mjs`의 규칙을 그대로 쓴다. 철거 판정 상한도 같이 낸다(새로 승인일이 생기는 GIS 동 중 연도 ≤ 2010인 동수, `RETIRED_GIS_MAX_APPROVAL_YEAR`).
- [ ] **Step 3: 실행** — `npx tsx <scratchpad>/p2-accuracy/measure.mts` → JSON 두 개
- [ ] **Step 4: 보고서** — `p2-accuracy.md`에 규칙·지역·n·일치율·기준·통과 여부·효과 표를 쓴다. 조사값과 3 %p 넘게 다른 칸에는 원인을 적는다(함수 구현과 조사 시뮬레이션의 차이).
- [ ] **Step 5: 판정(Judge)**
  - 통과한 규칙 목록을 원장 `progress.md`에 적는다.
  - 떨어진 규칙은 Task 4~7에서 해당 단계를 건너뛴다. Task 1 함수와 테스트 중 쓸 곳이 없어진 것은 지운다(`fix(v2): 측정에서 떨어진 규칙 함수 제거`).
  - n이 기준 미만인 지역은 「판정 불가」로 적고 다른 지역 값으로 정한다.

### Task 3: A-2 오피스텔 — 전유부 PNU로 officetel 만들기 (core)

**Files:**
- Modify: `src/lib/v2/ingest/sources/ledger.ts`
  - `buildLedger` `:363-491`
  - `buildLedgerUnitTypes` `:521-615`
  - `targetForRow` `:510-518`
- Modify: `src/scripts/v2/test-v2-ledger.mjs`

**Interfaces:**
- Consumes: Task 1의 `summarizePnuTitleRows`, `ledgerTitleLookup(db)?.pnuSummary`. 같은 실행의 `ledger_title_dong`이고, `:407`에서 만든다.
- Produces: core feature `kind: "officetel"`를 PNU마다 하나 만든다. `stableId: "officetel:<pnu>"`, properties는 다음과 같다.
  ```ts
  { source: "exclusive" | "title"; ledgerPk: string | null; units: number | null; unitsSource: "title_호_수" | "exclusive_units";
    floorsAbove: number | null; floorsSource: "title" | "exclusive_max_floor" | null; heightM: number | null;
    approvalDate: string | null; otherUse: string | null; titleRows: number } // + 기존 unitTypes·unitTypesSource·unitTypeBasis
  ```
  A05가 읽는 `units`·`approvalDate`·`floorsAbove`(`a05/engine.ts:59-60·102·123-126`)의 이름과 뜻은 바꾸지 않는다.
- 통계
  - `ledger_title_officetel`은 지금처럼 표제부 행 단위로 센다.
  - 새로 `ledger_exclusive_officetel`(fields `units`·`floorsAbove`·`approvalDate`, type `officetel`)을 두고, 전유부로 만든 feature 단위로 센다.
  - releaseId는 전유부로 만든 feature가 `exclusiveReleaseId`, 표제부만 있는 feature가 `titleReleaseId`다.
- **규칙(spec A-2, 우선순위는 Judge 제안)**
  1. **표제부 후보 행.** `(mainUse === "업무시설" && otherUse?.includes("오피스텔")) || (otherUse?.includes("오피스텔") && positive(호_수) !== null)`인 행이다. `mainUse === "공동주택"` 행은 지금처럼 공동주택 분기(`:428`)가 먼저 가져간다. 후보 행은 곧바로 feature로 넣지 않고 PNU마다 모은다. PK 중복은 지금처럼 reject한다.
  2. **제외 PNU.** 총괄 단지 PNU(`recapPnus`)와 공동주택 분기 PNU(`housing`)는 제외한다. 제외 PNU의 후보 행은 reject로 센다.
  3. **전유부 행으로 만들기.** 전유부 오피스텔 행(`exclusiveRowIsEligible === "officetel"`)의 PNU가 제외 PNU가 아니고 아직 officetel이 없으면, 처음 본 행에서 `officetel:<pnu>`를 만들고 `byPnu`에 넣는다.
     - 전유부는 한 번만 읽는다. core 빌드는 재개할 수 없으므로 시간을 늘리지 않는다.
     - 이름·층수·승인일은 그 PNU의 표제부 후보 모음에서 먼저 가져온다. 없으면 `pnuSummary(pnu)`에서, 그것도 없으면 전유부(`건물_명`, 지상 `층_번호` 최댓값 → `floorsSource: "exclusive_max_floor"`)에서 가져온다. 이 경우 승인일은 null이다.
     - 위치는 `lookupParcelPoint`로 정한다. 없으면 unlocated로 센다.
  4. **보조 규칙.** 전유부 행이 없는 후보 PNU는 표제부 모음만으로 `officetel:<pnu>`(source `"title"`)를 만든다.
  5. **여러 PK를 모은 PNU.** 공동주택 분기(`:446-452`)처럼 ledgerPk·floorsAbove·heightM은 null로 두고, 승인일은 가장 이른 값, 호수는 합으로 한다.
  6. **호수.** `units`는 표제부 호수 합을 쓰고, 없으면 전유부의 전유 호 수(타입 합계)를 쓴다.
  7. **타입 보강.** 타입 보강은 이 feature를 대상으로 한다. `exclusive`가 없으면 3단계 없이 4단계만 한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-ledger.mjs`에 「A-2」 블록을 더한다(parcel_point·`from()` 픽스처는 파일 앞부분 방식).
  - PNU_A: 업무시설 + 기타 「오피스텔」 PK 2개(호수 120·80) → feature 1개 `officetel:PNU_A`, `units === 200`, `ledgerPk === null`, `titleRows === 2`
  - PNU_C: 표제부 오피스텔 후보 없음. 표제부 주건축물(업무시설, 건물_명 「메트하임」, 사용승인 20190101, 지상 15) + 전유부 14202 호 3개 → `source "exclusive"`, name 「메트하임」, `approvalDate "2019-01-01"`, `floorsAbove 15`, `units 3`, `unitTypes` 있음
  - PNU_D: 전유부 14202만 있음(건물_명 「클래시아」, 지상 층 3·12) → name 「클래시아」, `approvalDate null`, `floorsAbove 12`, `floorsSource "exclusive_max_floor"`
  - PNU_E: 공동주택 표제부 단지 + 전유부 14202 행 → officetel 없음(타워팰리스 규칙)
  - PNU_F: 주용도 「제2종근린생활시설」 + 기타 「오피스텔」 + 호수 0 → officetel 없음
  - `SELECT COUNT(*) FROM feature WHERE kind='officetel'` === 3. `ledger_exclusive_officetel` accepted === 2
  - 지금 테스트의 `title:<pk>` officetel 단언은 새 규칙에 맞춰 고친다. 바꾼 단언은 보고서에 나열한다.
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-ledger.mjs` → officetel 수·stableId 단언 FAIL
- [ ] **Step 3: 구현** — 위 규칙 1~7대로. 내부 보조 함수 이름은 실행자가 정한다.
- [ ] **Step 4: 통과 확인** — `test-v2-ledger.mjs`·`test-v2-ledger-rules.mjs`·`test-v2-buildings.mjs` PASS, `npm run lint` 0
- [ ] **Step 5: 커밋** — `feat(v2): 오피스텔을 전유부 PNU로 만든다 — 필지당 하나, 단지 필지는 제외`

### Task 4: 건물 적재 — 새 열과 승인일 규칙(S1·S3·③)

**Files:**
- Modify: `src/lib/v2/data/schema.ts`(`BUILDINGS_SQL` `:101-118`)
- Modify: `src/lib/v2/ingest/sources/buildings.ts`
  - `buildBuildings` `:181-271`
  - `finalizeLedgerMatches` `:143-179`
- Create: `src/scripts/v2/test-v2-building-ledger-fill.mjs`. 헬퍼(`title`·`record`·`square`·`rows`·`fact`)는 `test-v2-height2.mjs:48-106`에서 옮긴다.
- Modify: `src/scripts/v2/test-v2-height2.mjs:102-103`

**Interfaces:**
- Consumes: Task 1의 `pnuSummary`, `coreComplexFactsByPnu`
- Produces
  - `building_fact`에 nullable 열을 더한다. Task 2를 통과한 규칙이 쓰는 열만 더한다: `use_code_estimated TEXT`(R2), `label_name TEXT`(⑤ 또는 N1). schemaVersion은 올리지 않는다. 옛 파일에는 열이 없고, 엔진이 열이 있는지 본다(Task 9).
  - `buildBuildings(db, records, releaseId, opts)`의 `opts`에 `core?: Db | null`을 더한다.
  - 승인일 provenance `approval_date`
    - S1: `{ source: "ledger_pnu.title.사용승인_일", pnu }`
    - S3: `{ source: "ledger_pnu.recap_kapt.사용승인_일", pnu }`
    - ③: 지금의 `{ source: "ledger.title.사용승인_일", … }`에 `oneToMany: true`를 더한다.
- **규칙**
  - **행마다 적용 순서.** A13 → 행 결합 승인일(지금 `:229`) → S1(`opts.ledger?.pnuSummary?.(pnu)?.approvalDate`) → S3(`coreComplexFactsByPnu(opts.core, pnu.slice(0, 2)).get(pnu)?.approvalDate`). 앞에서 채워지면 뒤는 보지 않는다. 모든 값은 `validDate(…, maxYear)`로 거른다. PNU가 없거나 `pnuSummary`·`core`가 없으면 그 단계를 건너뛴다.
  - **통계.** `stats.accept`의 `approvalDate`에 S1·S3 값을 넣는다.
  - **③ 1:N 되돌림(`:156-169`).**
    - 높이·층수·ledger_pk는 base 값으로 되돌린다. `approval_date`는 applied 값을 남긴다.
    - provenance는 base 값 위에 applied의 `approval_date`를 얹는다. 출처가 `ledger.title.사용승인_일`이면 `oneToMany: true`를 더한다.
    - `replaceTag`의 `newProps.approvalDate`는 applied 값이다.
  - **떨어진 규칙.** Task 2에서 떨어진 규칙(S1·S3·③)은 넣지 않는다. ③이 떨어지면 지금처럼 모두 되돌린다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test-v2-building-ledger-fill.mjs` 「승인일」 블록
  - PNU_S1: 주건축물 2행(이름·면적 불일치, 둘 다 19830501). GIS에는 A13이 없고 행 결합도 없다 → `approval_date "1983-05-01"`, provenance `approval_date.source === "ledger_pnu.title.사용승인_일"`
  - PNU_S3: 주건축물 날짜 19830501·19900101. core에 `recap:` 19850301 → `"1985-03-01"`, source `"ledger_pnu.recap_kapt.사용승인_일"`
  - PNU_S3X: recap 19850301 + kapt 19860101 → `approval_date null`
  - A13 「2001-02-03」이 있는 건물 → 그대로, provenance에 `ledger_pnu` 없음
  - `opts.core` 없이 PNU_S3 → null, 예외 없음
  - `stats.snapshot().fillRates.approvalDate`가 채운 수만큼 오른다.
  - `test-v2-height2.mjs`: `ONE-TO-MANY-A/B`는 `height_method "unknown"`(지금 단언 유지)이고 `approval_date === "2020-01-02"`, provenance `approval_date.oneToMany === true`
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-building-ledger-fill.mjs`, `npx tsx src/scripts/v2/test-v2-height2.mjs` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위 둘과 `test-v2-buildings.mjs`·`test-v2-data-schema.mjs`·`test-v2-ingest-resume.mjs` PASS, `npm run lint` 0
- [ ] **Step 5: 커밋** — `feat(v2): 건물 승인일을 표제부 PNU·총괄·K-APT 날짜로 채우고 1:N 폐기에도 승인일은 남긴다`

### Task 5: 건물 적재 — 용도 R1·R2

**Files:**
- Modify: `src/lib/v2/ingest/sources/buildings.ts`
  - useCode `:210`
  - insertFact `:190-191·248-262`
  - 후보 표 `:112-131·196-198·266`
  - 되돌림 `:156-169`
- Modify: `src/scripts/v2/test-v2-building-ledger-fill.mjs`

**Interfaces:**
- Consumes: Task 4의 `use_code_estimated` 열, `pnuSummary`
- Produces
  - R1: `use_code = str(p.A8) ?? ledgerMatch?.useCode ?? null`. 결합 행에서 왔으면 provenance `use_code: { source: "ledger.title.주_용도_코드", ledgerPk, match }`를 남긴다.
  - R2: A8이 없으면 결합 여부와 무관하게 `use_code_estimated = pnuSummary(pnu)?.useCode ?? null`, provenance `use_code_estimated: { source: "ledger_pnu_single_use", pnu }`를 남긴다. A8이 있으면 null이다. 결합과 무관하게 적는 이유는 R1이 1:N로 되돌려져도 추정이 남게 하려는 것이다. 엔진은 use_code가 null일 때만 추정을 쓴다.
  - 후보 표에 `base_use_code TEXT`·`applied_use_code TEXT` 열을 더한다. 1:N 되돌림 때는 use_code와 provenance `use_code`를 base로 되돌린다. `replaceTag`의 old/new에 useCode를 넣는다.
  - stats의 useCode 채움률은 확정 값(A8·R1)만 센다.

- [ ] **Step 1: 실패하는 테스트 작성** — 「용도」 블록
  - A8이 비고 결합 행 주_용도_코드가 「04000」 → `use_code "04000"`, provenance `use_code.source === "ledger.title.주_용도_코드"`
  - A8 「03000」, 결합 행 「04000」 → `use_code "03000"`, `use_code_estimated null`
  - 결합이 없고 PNU 주건축물 용도가 모두 「02000」 → `use_code null`, `use_code_estimated "02000"`, provenance source `"ledger_pnu_single_use"`
  - PNU 용도가 「02000」·「11000」 → 둘 다 null
  - 1:N로 버려진 결합(결합 행 「02000」, PNU 단일 용도 「02000」) → `use_code null`, `use_code_estimated "02000"`
  - `fillRates.useCode`는 확정 동수 ÷ 전체
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-building-ledger-fill.mjs` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위와 `test-v2-height2.mjs`·`test-v2-buildings.mjs` PASS, lint 0
- [ ] **Step 5: 커밋** — `feat(v2): 결합 행 주용도는 확정으로, PNU 단일 주용도는 추정 열로 적재한다`

### Task 6: 건물 적재 — 결합 행 건물명(⑤)을 라벨 열에

**Files:**
- Modify: `src/lib/v2/ingest/sources/buildings.ts`
  - 후보 표에 `applied_label_name TEXT`를 더한다.
  - `buildBuildings`
  - `finalizeLedgerMatches`
- Modify: `src/scripts/v2/test-v2-building-ledger-fill.mjs`

**Interfaces:**
- Consumes: Task 1의 `titleLabelCandidate`, Task 4의 `label_name` 열
- Produces: `finalizeLedgerMatches(...) → { matched: number; rejectedOneToMany: number; titleLabels: number }`, provenance `label_name: { source: "ledger.title.건물_명", ledgerPk }`
- **규칙**
  - **GIS 단계.** label_name을 쓰지 않는다. 1:N 판정이 끝나야 결합이 확정되기 때문이다. `titleLabelCandidate(ledgerMatch, name)`은 후보 표에만 둔다.
  - **finalize.** 1:N 중복 PK가 아닌 후보 중 `applied_label_name`이 있는 행에 `label_name = applied_label_name`을 쓰고, provenance는 `json_set(field_provenance_json, '$.label_name', json(?))`로 고친다. 한 번의 집합 UPDATE로 한다. 도로명주소 POS(Task 7)가 먼저 써 둔 값이 있어도 ⑤가 이긴다(정확도 99.3 % > 약 97 %, 열린 질문 9).
  - **1:N 폐기 행.** ⑤를 쓰지 않는다. 먼저 써 둔 POS가 남는다.
  - **이름 열.** `feature.name`은 바꾸지 않는다.
  - **떨어진 경우.** Task 2에서 ⑤가 떨어지면 이 Task는 하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** — 「이름」 블록
  - A24가 비고 결합 행 건물_명이 「동하빌딩」 → finalize 뒤 `label_name "동하빌딩"`, provenance `label_name.source === "ledger.title.건물_명"`, `feature.name === null`
  - A24 「동하빌딩」, 결합 행 「동하 빌딩」 → `label_name null`
  - 1:N로 버려진 두 동 → `label_name null`
  - finalize 전에 `UPDATE building_fact SET label_name='우일빌딩'`(POS 흉내)을 해 둔다.
    - 결합 확정 동 → ⑤ 값으로 바뀐다.
    - 1:N 폐기 동 → 「우일빌딩」 그대로
  - 반환 `titleLabels`가 쓴 동수와 같다.
- [ ] **Step 2: 실패 확인** — 같은 테스트 FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위와 `test-v2-height2.mjs` PASS, lint 0
- [ ] **Step 5: 커밋** — `feat(v2): 결합이 확정된 표제부 건물명을 라벨 전용 열에 적재한다`

### Task 7: 도로명주소 건물 — PNU 규칙(④)과 POS 라벨(N1)

**Files:**
- Modify: `src/lib/v2/ingest/sources/juso-buildings.ts`
  - `buildJusoBuildings` opts `:349-355`
  - 단독 건물 insert `:408-409·549-566`
  - attach `:537-547·572-616`
  - `loadGisIndex` `:266-291`
- Modify: `src/scripts/v2/test-v2-juso-buildings.mjs`. 픽스처 dbf에 `POS_BUL_NM` 필드를 더한다.

**Interfaces:**
- Consumes: Task 1의 `posLabelCandidate`·`coreComplexFactsByPnu`·`pnuSummary`, Task 4·5·6의 열과 provenance 형식
- Produces
  - `buildJusoBuildings(..., opts.ledger?: LedgerFloorLookup | null)`
  - provenance `label_name: { source: "juso:POS_BUL_NM", jusoBuildingMgtSn }`
  - 단독 건물의 `approval_date`·`use_code_estimated` provenance는 Task 4·5와 같은 문자열로 남긴다.
- **규칙**
  - **④ 단독 건물(겹침 없이 새로 넣는 행).**
    - `approval_date`는 S1이고, 없으면 S3다(`validCoreApprovalDate(…, coreApprovalMaxDate)`). `use_code_estimated`는 `pnuSummary.useCode`다.
    - `use_code`는 계속 NULL이다. 행 단위 결합(R1·⑤·층수)은 하지 않는다. 1:N 판정이 GIS 후보만 보기 때문이다(`buildings.ts:147`, 열린 질문 2).
  - **N1 단독 건물.** `label_name = posLabelCandidate({ pos: POS_BUL_NM, currentName: composeBuildingName 결과, useCode: use_code_estimated ?? BDTYP_CD, complexNames: coreFacts.names })`
  - **N1 겹친 GIS 건물.**
    - GIS마다 POS가 있는 도로명주소 행 가운데 겹친 면적이 가장 큰 행 하나를 따로 고른다. 면적이 같으면 `BD_MGT_SN`이 작은 쪽이다.
    - 높이용 `attach`와 따로, `need`와 무관하게 고른다. 높이 있는 무명 juso가 이름 있는 juso를 이기는 손실(조사 ②)을 피하기 위해서다.
    - 쓰기는 `label_name IS NULL`일 때만 한다. 값은 `posLabelCandidate({ pos, currentName: GIS feature.name, useCode: GIS use_code ?? use_code_estimated, complexNames })`다.
  - **`loadGisIndex`.** SELECT에 `b.use_code`와, 열이 있으면 `b.use_code_estimated`를 더한다.
  - **바꾸지 않는 것.** `POS_BUL_NM`은 feature properties에 남기지 않는다(라벨 열·provenance에만 둔다). 교체 판정(`:522-530`)과 이름 보태기(`:599-609`)도 바꾸지 않는다.
  - **입력이 없을 때.** `opts.ledger`·`opts.core`가 없으면 해당 규칙을 건너뛴다. N1이 떨어지면 N1 부분은 하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** — 「P2」 블록
  - 겹침 없는 단독 juso, PNU에 주건축물 날짜 2행이 같음(20150301)·용도 「04000」, `BULD_NM` 빈 값, POS 「우일빌딩」 → `approval_date "2015-03-01"`, `use_code null`, `use_code_estimated "04000"`, `label_name "우일빌딩"`, provenance `label_name.source === "juso:POS_BUL_NM"`
  - A24가 없는 GIS + 겹친 juso 두 개(POS 없음·높이 있음 / POS 「동하빌딩」·높이 없음) → 높이는 첫째에서, `label_name "동하빌딩"`은 둘째에서 온다. `feature.name`은 그대로다.
  - GIS `use_code "03000"`, core에 그 PNU 단지 「라이프시티」, POS 「라이프시티아파트」 → `label_name null`
  - 높이·이름이 다 있는 GIS(need 0) + POS 「경빌딩」 → `label_name "경빌딩"`
  - `opts.ledger`·`opts.core` 없이 → 승인일·추정·차단을 건너뛰고 예외가 없다.
  - 기존 교체·retired 단언은 그대로 PASS
- [ ] **Step 2: 실패 확인** — `npx tsx src/scripts/v2/test-v2-juso-buildings.mjs` → FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위와 `test-v2-building-ledger-fill.mjs`·`test-v2-ingest-resume.mjs`·`test-v2-building-quality.mjs` PASS, lint 0
- [ ] **Step 5: 커밋** — `feat(v2): 도로명주소 건물에 표제부 PNU 날짜·추정 용도와 시군구용건물명 라벨을 붙인다`

### Task 8: data-build 연결·비교 스크립트·scratch 리허설 (판정: Judge)

**Files:**
- Modify: `src/scripts/v2/data-build.mjs`
  - 진행표 지문 `:292-298`
  - `buildBuildings` `:328`·`:348`
  - `buildJusoBuildings` `:357-362`
  - 로그 `:331`·`:370`
- Create: `src/scripts/v2/building-fill-compare.mjs`(test-v2가 아니므로 러너가 돌리지 않는다)
- 리허설 산출: `C:/SiteAnalysisData/v2-scratch/p2-rehearsal/`, 보고서 `.superpowers/sdd/2026-11-03-p2-data-version/p2-rehearsal.md`

**Interfaces:**
- **연결**
  - 두 `buildBuildings` 호출에 `core: ctx.core`를, `buildJusoBuildings`에 `ledger`를 넘긴다.
  - 진행표 메타에 `ledgerRules: "a3-r1"`을 더하고, juso 블록에 `posLabel: "pos-v1"`을 더한다. 지문이 바뀌어 옛 규칙의 끊긴 빌드를 새 코드로 잇지 못하게 하려는 것이다.
  - finalize 로그에 `titleLabels`를 더한다.
- **`building-fill-compare.mjs` CLI**
  - 형식: `npx tsx src/scripts/v2/building-fill-compare.mjs --old <dataDir>[#<manifest.json>] --new <dataDir>[#<manifest.json>] --sites daechi,galhyeon --out <md>`
  - 행 선택은 엔진 `buildingRows`·`isCounted`(반경 1 km)로 한다. 새 열은 `building_fact`에서 feature_id로 직접 읽고, 열이 없으면 null이다.
  - 사이트마다 같은 엔진으로 `d02`·`d03`·`d04`·`d05`·`a05`를 한 번씩 부르고 예외가 없어야 한다(Review Focus 1).
  - 칸
    - 반경 건물 수, 철거 제외 수, 1층 가정 비율
    - officetel feature 수와 서로 다른 PNU 수(반경 1 km)
    - 이름 있음, 라벨 이름 있음(이름 ∪ `label_name`), `label_name` 출처별 수. 잡음 규칙은 조사 `unnamed/analyze.mjs`의 것을 이름과 `label_name`에 모두 적용한다. 조사값과 비교하기 위해서다. P1의 `isLabelNoiseName`이 있으면 그 기준 값도 함께 낸다
    - 연대 미상 %와 승인일 출처별 수(A13·결합·S1·S3·1:N 유지·`core_ledger_pnu`)
    - 용도 미상 %(확정만, 확정+추정), 추정 동수

- [ ] **Step 1: 연결 구현과 확인** — `V2_DATA_DIR=<scratch>/data npm run data:build -- --version dry --dry-run --raw D:/V-coding/16-SiteAnalysis/.cache/v2/raw`가 오류 없이 끝나야 한다. `test-v2-ingest-resume.mjs` PASS, lint 0
- [ ] **Step 2: 커밋** — `feat(v2): 적재기에 core·표제부 조회를 넘기고 옛/새 판 건물 채움 비교 스크립트를 더한다`
- [ ] **Step 3: 리허설 준비(PowerShell)**
  - 다음 종료까지 2시간 이상 남았는지 본다.
  - scratch 데이터 폴더 `S = C:/SiteAnalysisData/v2-scratch/p2-rehearsal/data`를 만든다.
  - parcels는 복사(31.5 GiB) 대신 하드링크로 둔다: `New-Item -ItemType HardLink -Path S/versions/2026-10-01e/parcels.sqlite -Target C:/SiteAnalysisData/v2/data/versions/2026-10-01e/parcels.sqlite`. 같은 C: 볼륨이고, junction은 쓰지 않는다.
  - `S/manifest.json`에는 실제 매니페스트의 parcels 항목만 그대로 옮긴다(Write). `M.readManifest(S)`로 읽히는지 확인한다.
- [ ] **Step 4: core 리허설** — `nohup` 래퍼(Task 10 Step 2의 래퍼와 같은 꼴)로 `V2_DATA_DIR=S npm run data:build -- --data-dir S --version r-core --only core --raw … --log C:/SiteAnalysisData/v2-scratch/p2-rehearsal/build-r-core.log`를 돌린다(약 70분, 재개 불가). 실측 시간과 officetel 통계 줄을 기록한다.
- [ ] **Step 5: buildings 리허설(서울)** — `--data-dir S --version r-bldg11 --only buildings --sido 11 --log …`(약 25분). ctx.core는 리허설 core다.
- [ ] **Step 6: 게이트 대조** — scratch 스크립트로 리허설 파일과 실제 현재 파일의 `ingest_run.snapshot_json`(`build.ts:850-858`)을 읽어 `evaluateIngest`(`data/quality-gate.ts:63`)를 돌린다.
  - core 원천은 모두 대조한다.
  - building 원천은 서울만 있으므로 `FILL_RATE_DROP`·`TYPE_MISSING`만 본다.
  - 의도한 변화로 실패하는 원천은 `--reset-baseline` 목록으로 정한다. `ledger_title_officetel`이 들어갈 것으로 예상한다.
- [ ] **Step 7: 비교표** — `npx tsx src/scripts/v2/building-fill-compare.mjs --old D:/V-coding/16-SiteAnalysis/.cache/v2/data --new S --sites daechi,galhyeon --out …/p2-rehearsal.md`. 갈현 반경의 고양(시도 41) 몫은 리허설에 없으므로 서울 몫만 비교한다고 표에 적는다.
- [ ] **Step 8: 판정(Judge)** — 모두 통과해야 Task 10으로 간다. 못 넘으면 원인 Task를 고치고 해당 리허설을 다시 한다.
  - 리허설 두 빌드가 EXIT 0으로 게시됐고, 엔진 호출에 예외가 없다.
  - 오피스텔: 대치 반경 12필지(±2), 강남구 회수가 빠진 114필지 중 100필지 이상이다.
  - 기대값과 ±3 %p 안이다. 기대값은 Task 2 실측 효과로 고친다. 떨어진 규칙은 그만큼 뺀다.
    - 대치: 라벨 이름 채움 ≈ 39.9 %(32.3 + N1 5.8 + ⑤ 1.8), 연대 미상 ≈ 23.5 %, 용도 미상(확정+추정) ≈ 33.9 %
    - 갈현(서울 몫): 라벨 이름 ≈ 21.3 %, 용도 미상 ≈ 6.6 %
  - 철거 제외 수 증가가 반경 동수의 1 %p 이하다. 넘으면 사례 10건을 지도로 본다.
  - 1층 가정 비율 변화가 ±0.1 %p 안이다.
  - `--reset-baseline` 목록이 정해졌다.
  - 실제 빌드 예상 시간 = core 실측 + buildings 140.7분 × (리허설 증가율)이다. 4시간이 넘으면 (b)를 권한다.

### Task 9: 엔진 — `BuildingRow` 새 필드, D03 추정 용도 분리, D04 승인일 출처별 한계 (P1 겹침)

**전제:** P1이 이 Task의 파일(`buildings-shared.ts`·`d03`·`d04`·`common.ts`·고정값 3곳)에 낸 커밋이 기준 브랜치에 들어간 뒤 rebase하고 시작한다. P1 Task 5(`isLabelNoiseName`·`pnuSupplement`·`buildingLabelName`)와 P1 Task 6(D03~D05 라벨) 다음이다.

**Files:**
- Modify: `src/lib/v2/engine/tiles/buildings-shared.ts`
  - `BuildingRow` `:29-43`
  - `topoBuildingRow` `:286-303`
  - `buildingRowsUncached` `:606-660`
- Modify: `src/lib/v2/tile/d03/engine.ts`, `src/lib/v2/tile/d04/engine.ts`
- Modify: `src/lib/v2/ui/map-layers.ts`(`use:*` `:263-272` 아래)
- Modify: `src/lib/v2/engine/tiles/common.ts`(D03 `:35`, D04 `:36`)
- Test: `test-v2-tile-d03-buildings.mjs`, `test-v2-tile-d04-years.mjs`, `test-v2-building-quality.mjs`, `test-v2-building-label-supplement.mjs`(P1 Task 5가 만든다)
- 고정값: `test-v2-tile-registry.mjs:40-41`, `test-v2-topo-run.mjs:32-33`, `test-v2-topo-supplement.mjs:29-30`

**Interfaces:**
- Consumes(P1 Task 5): `isLabelNoiseName`, `PnuSupplement`, `buildingLabelName(row)`
- Produces(`BuildingRow`, P1의 `pnuSupplement?`처럼 값이 있을 때만 둔다)
  ```ts
  labelName?: string;                            // building_fact.label_name. hit.name과 섞지 않는다
  labelNameSource?: "ledger_title" | "juso_pos"; // provenance label_name.source에서
  useCodeEstimated?: string;                     // useCode가 null일 때만 둔다
  approvalDateSource: "building_fact" | "ledger_title" | "ledger_title_pnu" | "ledger_recap_kapt" | "core_ledger_pnu" | null;
  // buildingLabelName(row) 순서를 바꾼다: 잡음이 아닌 hit.name ?? 잡음이 아닌 labelName ?? pnuSupplement?.name ?? null
  ```
- **출처 분류(`approval_date.source`, 앞에서부터)**
  - `ledger_pnu.title` → `ledger_title_pnu`
  - `ledger_pnu.recap_kapt` → `ledger_recap_kapt`
  - `ledger.title` → `ledger_title`
  - 그 밖 → `building_fact`
  - 라벨 출처: `ledger.title.건물_명` → `ledger_title`, `juso:POS_BUL_NM` → `juso_pos`
- **열 읽기.** 열 목록은 `columns(db, "building_fact")`(`:144`)를 ctx마다 한 번 memo해서 본다. 새 열은 있을 때만 SELECT하고, 없으면 null이다. provenance는 행마다 한 번만 파싱한다.
- **D03**
  - **추정 행.** `useClassOf(row.useCode) === "미상"`이고 `useClassOf(row.useCodeEstimated) !== "미상"`인 행이다. 레이어는 `use:<분류>_est`, sublabel은 `` `${useLabelOf(row.useCodeEstimated)}(추정)` ``, labelPriority는 지금 규칙이다.
  - **그대로 두는 지표.** `fill_use_pct`와 `share_use_1..9`는 확정 행만 센다.
  - **미상.** `share_use_10`(미상)은 확정도 추정도 없는 행만 센다.
  - **새 지표.**
    - `share_use_est`: `est()`, label 「구성비: 용도 추정」, formula `d03-share-use-est@1:PNU 단일 주용도로 추정한 건물 동수÷반경 안(중심점 기준) 건물 동수`
    - `area_share_est`: 같은 방식으로 만든다.
    - total이 0이면 둘 다 missing이다.
  - **한계 문구.** 추정 m > 0이면 `{ kind: "estimated", note: "용도 추정 " + m + "동: 건축물대장과 동 단위로 이어지지 않은 건물에, 같은 필지(PNU) 표제부 주건축물의 주용도가 하나일 때 그 용도를 추정으로 붙였습니다. 확인된 용도 집계에는 넣지 않았습니다." }`를 단다.
  - **layers.** 지금 10개에 `use:<분류>_est` 9개(미상 제외)를 더한다.
  - **그대로 두는 것.** 판단 문장과 큰 답은 확정 기준 그대로다. `share_use_10`을 읽는 곳(d03 view·해석 줄)을 grep해 의미 변화(추정 제외)를 보고서에 적는다.
- **map-layers.** `"use:주거_est": S("[추정] 주거", "#D69E2E")`처럼 9개를 같은 분류색으로 더한다(D05 `tall_ge35_est` 선례). 빗금은 `_est` 접미사로 화면(`map-figure.tsx:721`)과 PPT가 이미 그린다.
- **D04**
  - 기존 `ledgerBackfilled`(`core_ledger_pnu`) 문구는 P1 몫이라 건드리지 않는다. 확인 비율 집계도 지금처럼 S1·S3를 포함한다(spec 추천 3).
  - 새 한계 문구(kind `estimated`, counted 행 기준)
    - `ledger_title_pnu` n > 0: `` `표제부 PNU 날짜 ${n}동: 건축물대장과 동 단위로 이어지지 않은 건물에, 같은 필지(PNU) 표제부 주건축물의 사용승인일이 모두 같아 그 날짜를 썼습니다.` ``
    - `ledger_recap_kapt` n > 0: `` `K-APT·총괄 ${n}동: 표제부 날짜가 갈리거나 없는 필지에서 총괄표제부·K-APT 단지의 사용승인일이 하나여서 그 날짜를 썼습니다.` ``
    - 미상 > 0일 때 S4 사실을 남긴다(열린 질문 7): `한 필지에 사용승인일이 서로 다른 표제부가 여러 개인 건물은 날짜를 고르지 않고 미상으로 두었습니다.`
- **리비전.** D03 끝에 `+use-estimate-r1`, D04 끝에 `+approval-source-r1`을 붙인다.

- [ ] **Step 1: 정본 읽기** — 정본 §1·§6·§8·§8-1을 읽는다. `ui-ux-pro-max`·`my-design-taste`를 불러, `[추정]` 범례 항목이 정본 §8-1(추정은 빗금)과 D05 선례에 맞는지 보고서에 한 줄 적는다.
- [ ] **Step 2: 실패하는 테스트 작성**
  - `test-v2-building-quality.mjs`
    - provenance 출처 4종을 가진 fact 행 → `approvalDateSource`가 위 분류대로 나온다.
    - D04 limitations에 세 문장이 동수와 함께 정확히 있다.
  - **옛 스키마.** `ALTER TABLE building_fact DROP COLUMN label_name`·`DROP COLUMN use_code_estimated`를 한 픽스처에서도 `buildingRows`가 돌고, `labelName`·`useCodeEstimated`가 없다.
  - **라벨 이름 순서.** `test-v2-building-label-supplement.mjs`(P1)에 블록을 더한다.
    - `hit.name` 「102동」 + `label_name` 「청암빌라트」 + PNU 단지명 → `buildingLabelName === "청암빌라트"`
    - `label_name`이 「6」(잡음)이면 PNU 단지명이 나온다.
    - `hit.name` 「동하빌딩」이면 `label_name`이 있어도 「동하빌딩」이다.
  - `test-v2-tile-d03-buildings.mjs`
    - `use_code null`·`use_code_estimated "04000"` 행 → 면 레이어 `use:근린생활_est`, sublabel 「제2종근린생활시설(추정)」. `share_use_est`의 numerator는 1이다. `share_use_10`과 `fill_use_pct`는 그 행을 세지 않는다.
    - `use_code "02000"`·추정 「04000」 → 확정 주거로 센다.
    - limitation 문구가 정확하다.
- [ ] **Step 3: 실패 확인** — 세 테스트 FAIL
- [ ] **Step 4: 구현과 리비전**
- [ ] **Step 5: 고정값** — `updating-hash-pinned-baselines`를 따른다.
  - 움직이는 값을 먼저 보고한다(레지스트리 문자열 2, topo-run 키 2, topo-supplement D03; D04는 출력이 같으면 그대로).
  - 「새 지표·레이어·필드를 떼면 옛 해시와 같다」는 근거를 남긴 뒤 갱신한다.
- [ ] **Step 6: 통과 확인** — 위 테스트, `test-v2-tile-registry.mjs`·`test-v2-topo-run.mjs`·`test-v2-topo-supplement.mjs`·`test-v2-polygon-tone.mjs`·`test-v2-map-contract.mjs` PASS, lint 0
- [ ] **Step 7: 커밋** — `feat(v2): D03은 추정 용도를 따로 세고 D04는 승인일 출처별 한계를 단다`

### Task 10: 빌드 실행 (Judge 주도, 사용자 승인 뒤)

**전제:** 아래가 모두 갖춰져야 시작한다.
- Task 3~8이 빌드 worktree에 있고, Task 8이 통과 판정을 받았다.
- 열린 질문 1(운영 데이터 전환)에 사용자가 답했다.
- (권장) Task 9가 main에 들어가 serve가 다시 배포됐거나, 사용자가 그 전의 공백을 받아들였다.

- [ ] **Step 1: 시각·자원 확인(PowerShell)**
  ```powershell
  (Get-CimInstance Win32_OperatingSystem).LastBootUpTime; Get-Date
  Get-PSDrive C | Select-Object Free
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -match 'data-build|data-gc' | Select-Object ProcessId,CommandLine
  Test-Path D:/V-coding/16-SiteAnalysis/.cache/v2/data/.lock
  ```
  - 다음 종료(06:00·18:00)까지 Task 8 예상 시간 + 30분(최소 4시간)이 남으면 (a)로 한다. 모자라면 (b)로 하거나 다음 부팅을 기다린다.
  - C: 여유는 60 GiB 이상이어야 한다(새 한 쌍 약 24.3 GiB + 빌드 중 임시 공간).
  - 다른 빌드·GC가 없어야 한다.
- [ ] **Step 2: 래퍼 작성(Write)** — `C:/SiteAnalysisData/v2/p2-build.sh`. `w5-build.sh` 꼴을 따른다. 시작·EXIT 표식은 console 로그에 둔다.
  ```bash
  #!/bin/bash
  cd /d/V-coding/16-SiteAnalysis/.worktrees/p2-data || exit 1
  export V2_DATA_DIR=D:/V-coding/16-SiteAnalysis/.cache/v2/data
  v=<YYYY-MM-DD>-ledger-a3; D=/c/SiteAnalysisData/v2; con=$D/build-$v.console.log
  echo "--- start $v core,buildings $(git rev-parse --short HEAD) $(date '+%F %T')" >> $con
  npm run data:build -- --version $v --only core,buildings --raw D:/V-coding/16-SiteAnalysis/.cache/v2/raw --wait-lock 60 --reset-baseline <Task 8 목록> --log C:/SiteAnalysisData/v2/build-$v.log >> $con 2>&1
  rc=$?; echo "EXIT $rc $(date '+%F %T')" >> $con; exit $rc
  ```
  (b)이면 같은 꼴로 두 단계를 잇는다.
  - 1단계: `<date>-ledger-core`, `--only core`, 그 원천의 reset-baseline
  - 2단계: `<date>-ledger-bldg`, `--only buildings`. 버전 폴더가 있으면 `--resume`을 붙인다(w5 방식).
- [ ] **Step 3: 시작(Bash)** — 세션이 끝나도 살도록 `nohup bash /c/SiteAnalysisData/v2/p2-build.sh > /dev/null 2>&1 &`로 띄운다. 시작 시각과 커밋 해시를 원장 `progress.md`에 적는다.
- [ ] **Step 4: 감시** — Monitor로 console 로그에 `^EXIT`가 나올 때까지 기다린다. core 단계 줄과 `[ingest] step k/39` 줄을 진행 기록으로 원장에 남긴다. (a)는 재개할 수 없으므로 이 기록은 다음 시작 시각을 정하는 데만 쓴다.
- [ ] **Step 5: 결과 확인** — `EXIT 0`, `published <hash>`, `manifest.json`의 version이 새 이름이고 `manifest.prev.json`이 `2026-10-29-seoulplan`이어야 한다.
  - **PC 종료·프로세스 사망(EXIT 없음).** 다음 부팅 때 `LastBootUpTime`·로그 수정 시각·프로세스를 본다.
    - (a)는 새 버전 이름으로 처음부터 다시 한다. 시간이 모자라면 (b)로 한다.
    - (b) 2단계는 같은 이름에 `--resume`을 붙인다.
    - 끊긴 버전 폴더는 지우지 않는다(GC가 정리한다). 죽은 PID의 잠금은 data-build가 회수한다.
  - **`[gate] FAIL code=…`.** 코드와 상세를 기록한다. 의도한 원천 변화면 `--reset-baseline`에 그 원천을 더해 새 이름으로 다시 빌드한다(core,buildings는 재개 불가). 의도하지 않은 실패면 원인을 고치고, 해당 리허설을 거친 뒤 다시 한다.
  - **예외(EXIT≠0이고 gate 줄 없음).** 로그 끝 50줄을 보고 원인을 고친 뒤 리허설을 거쳐 다시 한다.
  - **(b) 게시 사이.** 두 게시 사이에는 dev에서 새 분석을 만들지 않는다. 운영 사용자는 그 사이에 분석할 수 있으므로 사용자에게 알린다.

### Task 11: 비교표·저장 분석 고정 확인·갤러리·GC·기록 (Judge)

- [ ] **Step 1: 비교표** — `V2_DATA_DIR=… npx tsx src/scripts/v2/building-fill-compare.mjs --old D:/V-coding/16-SiteAnalysis/.cache/v2/data#C:/SiteAnalysisData/v2/data/manifest.prev.json --new D:/V-coding/16-SiteAnalysis/.cache/v2/data --sites daechi,galhyeon --out .superpowers/sdd/2026-11-03-p2-data-version/p2-compare.md`
  - 기준은 Task 8 Step 8과 같다. 갈현은 고양 몫까지 포함해 본다.
  - 대치 officetel 0 → 12필지, 1층 가정 비율 불변, 철거 제외 증가 ≤ 1 %p를 확인한다.
  - juso 단독 건물 중 아직 `core_ledger_pnu`(가장 이른 날짜)로 채워지는 동수를 따로 적는다(C2, 열린 질문 3).
- [ ] **Step 2: 저장 분석 고정 확인**
  - dev 앱 DB에서 0b5ba3aa·fe9e688b가 옛 매니페스트 해시를 고정하고 있는지 본다(`pinnedManifestHashes`, `src/lib/v2/app-db.ts`).
  - dev 화면(devqa)에서 열어 A05 오피스텔 0곳과 D04 미상 41.7 %가 옛 값 그대로인지 캡처한다.
- [ ] **Step 3: 새 분석 갤러리**
  - 대치동 503(주소 분석, 1 km)과 갈현동 545(1 km)를 새로 분석한다.
  - D02~D05·A05 장을 1440×900·1024×768에서 `tools/qa/capture-pages.mjs`로 캡처한다. D03·D04는 PowerPoint Presentation SaveAs PNG(시간 제한)로도 렌더한다.
  - 확인 항목
    - A05 오피스텔이 12필지이고, 출처 줄·출처 장에 건축HUB 전유공용면적이 있다.
    - D03 추정 빗금과 「[추정] …」 범례가 있고 미상이 줄었다.
    - D04 한계 문구가 있다.
    - D02 동수 변화가 철거 제외 변화로 설명된다.
    - 높이를 설명할 때 1층 가정 비율이 함께 있다.
  - Task 9가 아직이면 D03·D04는 옛 모양이다. Task 9 뒤에 다시 본다.
- [ ] **Step 4: 롤백 분기**
  - 기준을 못 넘고 원인이 데이터면 사용자에게 알린 뒤(운영도 함께 되돌아간다) scratch 스크립트로 되돌린다.
    ```js
    const M = await import("file:///D:/V-coding/16-SiteAnalysis/src/lib/v2/data/manifest.ts");
    await M.rollbackManifest(process.env.V2_DATA_DIR);
    ```
  - (b)에서는 한 번만 되돌릴 수 있다. 그 결과는 새 core와 옛 buildings다.
- [ ] **Step 5: GC** — 갤러리를 통과한 뒤 Global Constraints의 GC 명령을 돌린다.
  - deleted 목록에 현재·이전 매니페스트와 고정 버전(2026-10-08d core·2026-10-10b buildings 등)이 없는지 확인한다.
  - 확보한 용량을 기록한다.
- [ ] **Step 6: 리허설 정리**
  - `fsutil hardlink list <scratch parcels>`로 하드링크인지 확인한다.
  - 그 파일 하나만 재귀 옵션 없이 지우고, 원본 parcels 크기가 그대로인지 확인한다.
  - 그다음 나머지 scratch를 지운다.
- [ ] **Step 7: 기록**
  - 정본 §8 「건물 면 이름 출처」 표에 라벨 이름 순서와 추정 용도 표시를 반영한다. 순서는 지물명 → 표제부 결합 건물명 → 도로명주소 시군구용건물명 → (P1) PNU 단지명 → 용도 이름이다. P1의 §8 수정과 한 번에 한다.
  - spec §2-1에 실측 비교표 경로를 단다.
  - vault 세션 노트를 쓴다(`ai-memory:obsidian-memory`).
  - 운영 코드 배포는 사용자 결정으로 남긴다.

---

## 열린 질문

1. **운영 데이터 전환.** serve가 같은 데이터 폴더를 쓰므로 Task 10의 게시는 운영 새 분석의 데이터 전환이다. 옛 운영 코드(main)는 S1·S3 날짜를 한계 문구 없이 확정처럼 센다. 그 밖에는 새 데이터를 오류 없이 읽는다(Task 8에서 확인).
   - 권장: Task 9를 main에 넣고 serve를 다시 배포한 뒤에 빌드한다.
   - 다른 길: 공백을 받아들이고 먼저 빌드한다.
2. **④의 범위.** 도로명주소 단독 건물에는 PNU 규칙(S1·S3·R2)만 쓰고 행 단위 결합(R1·⑤·층수)은 하지 않는다. 1:N 판정이 GIS 후보만 보기 때문이다. spec의 「같은 결합을 적용」과 다르니 확인이 필요하다.
3. **C2.** juso 단독 건물의 core PNU 「가장 이른 날짜」 엔진 보충(`buildings-shared.ts:629`)은 spec대로 그대로 둔다. A-3 뒤에 남는 동수는 Task 11 비교표에 낸다. 그 수를 보고 단일 feature 판정으로 맞출지 정한다.
4. **R5.** 동 이름 결합(99.1 %, 대치 +3.5 %p)은 적재 순서를 바꿔야 해서(M) 재개할 수 없는 빌드에 위험하다. 그래서 이번에는 뺐다. 다음 buildings 판에 넣을지 정한다.
5. **임시 오피스텔 한계(spec 「한계 문구」).** P2 빌드가 이어지므로 「표제부 용도 표기로 가린 오피스텔」 렌더 주석은 생략했다. 옛 판을 고정한 저장 분석에도 달려면 데이터 버전 판정이 필요하다.
6. **D03 추정 표시.**
   - `[추정] 주거` 등 `_est` 9개(D05 선례) 때문에 범례·구성비에 항목이 따로 생긴다. 갤러리에서 무게를 본다.
   - P1의 D03·D04 라벨 대상(「용도별 최근접」·공동주택 판정)에서 추정 용도 건물을 빼는지 정해야 한다. 권장은 확정만 쓰는 것이다.
7. **D04 S4 사실 문장.** spec 추천 3의 「사실은 한계 문구에 남긴다」를 Task 9의 셋째 문장(수치 없음)으로 넣었다. 그대로 둘지 정한다.
8. **P1 조율.**
   - P1 계획(`2026-11-03-p1-labels.md` 518행)은 「P2 N1이 `isLabelNoiseName`을 쓰므로 P1 Task 5가 먼저」라고 적었다. 이 계획은 적재에서 잡음 판정을 하지 않는다. 의미 있는 POS를 그대로 두고, 엔진 `buildingLabelName`이 `labelName`에도 잡음 규칙을 적용한다(Task 9). 그러면 잡음 규칙을 고쳐도 다시 빌드하지 않아도 되고, Task 1~8은 P1을 기다리지 않는다. 두 계획 중 어느 쪽 문장을 고칠지 Judge가 정한다.
   - P1이 `composeBuildingName`(`building-names.ts:34-35`)도 바꾸면 그 변경이 P2 빌드 데이터에 실린다. 그 경우 Task 8 리허설 전에 들어와야 한다.
9. **⑤와 N1의 우선순위.** 둘 다 있을 때 ⑤(표제부 결합 건물명, 99.3 %)를 POS(약 97 %)보다 앞에 두었다. 단지 동에서는 POS가 단지명, ⑤가 등록 건물명일 수 있다.
10. **규칙 기준값.** Task 2의 통과 기준(S1·S3·③ ≥ 90 %, R1 ≥ 95 %, R2 ≥ 93 %, ⑤ ≥ 95 %, N1 ≥ 88 %)은 이 계획의 제안이다. 채택한 규칙과 뺀 규칙(S4·R3·R4) 사이에 기준선을 두었다. Judge가 확정한다.

### Judge 판정 (2026-11-03, Ruling 49)

1. 권장대로: Task 9(엔진)를 main에 넣고 운영을 다시 배포한 뒤 빌드한다. **Task 10의 게시는 운영 새 분석의 데이터를 바꾸므로 사용자 승인 뒤에 한다**(배포와 같은 급).
2. 그대로: 도로명주소 단독 건물에는 PNU 규칙(S1·S3·R2)만. 1:N 판정이 GIS 후보만 보는 구조라 행 결합은 오탐 위험. spec 「같은 결합을 적용」과의 차이는 Task 11 비교표에 적는다.
3. 그대로(spec대로 두고 Task 11 동수로 판단).
4. 그대로: R5는 이번 빌드에서 뺀다(재개 불가 빌드에 적재 순서 변경은 위험). 다음 buildings 판 후보로 남긴다.
5. 그대로 생략.
6. `_est` 항목은 갤러리에서 무게를 본다. P1 D03·D04 라벨 대상은 **확정 용도만** 쓴다(추정 건물이 「용도별 최근접」 라벨이 되지 않게).
7. 그대로 둔다.
8. **P2 방식이 맞다**: 적재는 POS를 그대로 싣고 잡음은 엔진 `buildingLabelName`이 거른다(규칙을 고쳐도 다시 빌드하지 않음). P1 계획 「범위 밖」 문장을 이에 맞게 고쳤다. P1이 `composeBuildingName`을 바꾸면 그 커밋은 Task 8 리허설 전에 들어와야 한다.
9. 그대로: ⑤가 N1보다 먼저.
10. 제안 기준값을 확정한다.

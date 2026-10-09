# 리팩터 이후 타일 에이전트 브리프

상위 목표: 대지 분석 v2 앱 — 타일마다 다른 에이전트가 동시에 고칠 수 있는 구조 > `<CODE>` 타일 작업

기준: 작업 브랜치를 만든 시점의 `v2-int` 커밋(이하 `<BASE>`). `refactor-base`는 리팩터 전체 비교용이라 타일 작업 기준으로 쓰면 리팩터 변경이 전부 범위 밖으로 잡힌다.

## 소유권

- 허용: `src/lib/v2/tile/<host>/**`, `src/scripts/v2/test-v2-tile-<host>*.mjs`
- 흡수 코드는 호스트로 해석한다: D06·D07→D05, D08→A12, D09→A04, D14→A01, D20→D19, D21→S02, D23→A09, D24→A10, D25→A07, D26→A02, D27→A11.
- A05와 A06은 한 소유 단위다. 서로의 `src/lib/v2/tile/a05/**`·`a06/**`와 `test-v2-tile-a05*`·`test-v2-tile-a06*`를 허용한다.
- 계획서 소유표의 기존 위치 예외:
  - S01: `src/components/v2/mass-3d*.tsx`, `src/components/v2/mass-figure.tsx`, `src/lib/v2/ui/mass-3d*.ts`, `src/lib/v2/ui/mass-projection.ts`
  - S03: `src/components/v2/wind-panel.tsx`, `src/lib/v2/ui/wind-upload.ts`, `src/lib/v2/engine/wind-api.ts`
  - D22: `src/lib/v2/ui/wind-rose*.ts`, `src/lib/v2/ui/rose-season.ts`, `src/components/v2/wind-rose*.tsx`
  - A05+A06: `src/lib/v2/ui/callout-*.ts`, `src/components/v2/callout-map.tsx`, `src/lib/v2/engine/a05-filter.ts`
- 그 밖의 `src/lib/v2/engine/**`, `src/lib/v2/ui/**`, `src/components/v2/**`, `src/app/v2/**`, 보고서·fixture·package 파일은 공용이다.

## 금지와 공용 요청

공용 파일을 직접 고치거나 공개 API 시그니처를 바꾸지 않는다. 필요하면 보고서에 다음 한 줄을 남기고 Judge가 먼저 반영한 뒤 rebase한다.

`SHARED-REQUEST: <파일> — <필요한 훅/필드> — <타일 코드와 이유> — <cache revision bump 필요 여부>`

## 공용 예외와 `tile-scope`

- 웨이브에서 승인된 공용 파일은 타일 소유 범위 밖이므로 `tile-scope`에 **정확한 저장소 상대 경로**를 반복해서 넘긴다. glob, 디렉터리 prefix, 절대 경로는 허용하지 않는다.

```powershell
node src/scripts/v2/harness/tile-scope.mjs <CODE> --base <BASE> --allow <path> --allow <path>
```

- `--allow`는 변경된 그 파일만 예외로 삼는다. 출력에는 `explicit --allow`로 남으므로, 보고서에는 각 예외가 어느 웨이브의 어떤 승인인지와 해당 파일 안에서 바꾼 행/단언을 함께 적는다. 허용 경로와 실제 타일 소유 경로가 섞이면 허용되지 않은 경로는 계속 `OUTSIDE`로 실패해야 한다.
- `--allow`가 없는 실행은 기존과 같은 소유권 판정을 한다. `--self-test`에는 코드나 `--allow`를 붙이지 않는다. 여러 번 같은 경로를 넘겨도 한 번만 판정한다.

## 라벨·표식 계약

- 결과의 feature·polygon·line은 필요한 경우 `name`, `sublabel`, `labelPriority`를 낸다. `name`은 원천 지물명, `sublabel`은 타일이 단위·거리·쉼표까지 서식한 값, `labelPriority`는 `0/1/2`다. 값이 없으면 `null`을 명시하고 레이어명·`미상`을 대체 값으로 만들지 않는다.
- 자동 라벨은 `labelPriority >= 1`이며 `name`이 있는 요소만 `name`으로 낸다. 호버·고정 라벨은 `name · sublabel`이고, 이름이 없을 때만 범례 표시 이름을 사용한다. `sublabel`이 비어 있거나 `미상`이면 생략한다. 같은 문구는 하나만, 같은 priority에서는 엔진 출력 순서를 유지한다.
- 최근접 라벨·점선·강조는 **그 지표의 값을 정한 바로 그 지물**에만 붙인다. 임의로 더 가까워 보이는 지물을 선택하지 말고, 거리/시간/접근성 metric의 원천 feature와 이름·값·highlight를 함께 전달한다.
- 면이 정상적으로 있으면 같은 지물의 대표점을 만들지 않는다. 대표점은 도형 생성 실패분의 폴백으로만 허용한다. 선은 `MapLine`으로 그리고 선 위 샘플 점·점 사슬을 만들지 않는다. 같은 좌표의 전세·월세처럼 의미가 다른 점은 텍스트 배지로 한 점에 합친다.
- 추정·미상은 색만으로 전달하지 않는다. 빗금·테두리·빈 모양·문구 중 하나 이상을 함께 사용한다. 원천 철도 노선색은 `rail_line`에 한해 허용하되 이름·흰 케이싱·선 모양을 함께 제공한다.

## 캐시 revision과 공용 단언 정합

- 타일의 결과 JSON(특히 `presentation`, feature/polygon/line의 라벨·표식·범례·스타일)이 바뀌면 `src/lib/v2/engine/tiles/common.ts`의 해당 `TILE_CACHE_REVISION` 행 끝에 `+w3-r1`을 붙인다. 기존 suffix를 덮어쓰거나 다른 타일 행을 함께 바꾸지 않는다.
- 같은 타일의 기대값은 `src/scripts/v2/test-v2-tile-registry.mjs` 기대표에도 같은 suffix를 반영한다. 두 파일은 해당 타일 행만 수정한다. 결과 JSON이 바뀌지 않는 문서·하네스·순수 UI 변경은 bump하지 말고 보고서에 `cache revision: 불필요`라고 적는다.
- RED 단계에서 새 계약 단언을 먼저 추가한다. GREEN에서는 `name`·`sublabel`·`labelPriority`의 null/priority/형식, 대표점·선 샘플 점의 부재, 최근접 지물 동일성, 실제 범례 경계값을 확인한다. 옛 `label`이나 레이어명을 새 계약의 성공 증거로 되살리지 않는다.
- 공용 assertion을 바꿔야 하면 소유 타일 테스트와 같은 기대를 사용하고 `SHARED-REQUEST`를 남긴다. cache bump와 registry 기대표는 서로 다른 값을 가질 수 없다.

## 완료 게이트

```powershell
node src/scripts/v2/harness/tile-scope.mjs <CODE> --base <BASE> [--allow <approved-path> ...]
node src/scripts/v2/harness/tile-literals.mjs <CODE>
npm run test:v2
npm run lint
```

비교 게이트는 항상 돌린다. 기준 산출물은 작업 시작 전에 `<BASE>`에서 만든다(`golden-engine.mjs --write`, `shots.mjs --out`, `V2_REPORT_SAMPLE_PATH=<기준 .pptx> npx tsx src/scripts/v2/test-v2-report.mjs`, `equivalence.mjs --write <기준 폴더>`). 리팩터면 차이 0, 기능 변경이면 의도한 타일·필드만 달라야 한다.

```powershell
npx tsx src/scripts/v2/harness/golden-engine.mjs --check <기준 golden JSON>
npx tsx src/scripts/v2/harness/shots.mjs --out <후보 shots 폴더> --compare <기준 shots 폴더>
npx tsx src/scripts/v2/harness/pptx-diff.mjs --base <기준 .pptx> --candidate <후보 .pptx>
npx tsx src/scripts/v2/harness/equivalence.mjs --check <기준 폴더>
```

`equivalence --check <기준 폴더>`는 엔진 결과의 presentation과 컷 화면을 비교한다. golden/equivalence/shots/PPTX 차이가 있으면 숨기지 말고, 의도한 동작 변경인지와 변경 이유를 보고한다. 동작을 바꾸지 않은 리팩터라면 차이 0을 확인한다.

## 실데이터 캡처 주의

- 임시 QA 스크립트는 저장소 밖(scratch)에 둔다. `src/scripts/v2/test-v2-*.mjs` 이름이면 `npm run test:v2`가 집어 간다.
- 캡처기는 요청된 원본을 scratch의 `capture-w3.mjs`로 복사해 수정한다. 원본 `capture-w2b.mjs`와 `prompt.md`는 고치지 않는다.
- 캐시 revision을 먼저 반영하고 지정 DB를 그대로 읽는지 확인한다. 오래된 `app.sqlite` 결과를 새 코드의 증거로 쓰지 않으며, 필요하면 보조 임시 DB에서 새 결과를 확인한다. 원본 데이터와 지정 DB는 삭제·덮어쓰지 않는다.
- 분석 타일이 `pending`이면 지도/호버를 찍지 말고 완료 상태가 될 때까지 기다린다. 캡처 경로, 타일별 상태, console/page error와 캐시 사용 여부를 보고한다.
- 보드 편집 중에는 타일이 요약 면으로 고정된다. 열 수를 바꾼 뒤 `완료` → 지도 면 전환 → 측정 순서로 찍는다.
- 로그인 429는 서버 메모리의 rate limit이다. 서버를 재시작하고 같은 계정으로 다시 시도한다. 자격 증명은 보고서에 적지 않는다.
- 겹침을 고칠 때는 고친 두 요소만 보지 말고, 그 수정으로 줄어든 요소끼리(예: 방향 글자끼리)도 겹치지 않는지 캡처로 확인한다.

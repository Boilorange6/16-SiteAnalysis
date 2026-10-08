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

## 완료 게이트

```powershell
node src/scripts/v2/harness/tile-scope.mjs <CODE> --base <BASE>
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

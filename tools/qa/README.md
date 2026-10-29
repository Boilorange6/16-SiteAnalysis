# tools/qa — 실화면·PPT 실렌더 QA runner

모두 프로젝트 루트에서 실행한다. 서버는 이미 떠 있어야 하고(기본 `http://localhost:3200/site`, 바꾸려면 `QA_BASE`), 이 폴더는 서버를 켜거나 끄지 않는다.

- `auth.mjs` — 공통 로그인. `tools/qa/.auth.json`(git 제외)의 세션이 살아 있으면 재사용, 아니면 `.env.local`의 `DEV_QA_*`로 한 번 로그인해 저장.
- `refresh-analysis.mjs` — 분석을 다시 계산하고 끝나면 JSON 저장. `node tools/qa/refresh-analysis.mjs <analysisId> <out.json>`
- `capture-pages.mjs` — 보고서 쪽을 폭별로 캡처하고 DOM을 잰다. `node tools/qa/capture-pages.mjs <analysisId> <outDir> [--widths 1440,1280,1024] [--pages 10,19,20] [--layout keep|charts]` (`keep`은 있는 그대로, `charts`는 「지도 + 그래프」로 전환)
- `export-pptx.mjs` — PPT 실제 내보내기. `node tools/qa/export-pptx.mjs <analysisId> <outDir> [width] [editable|image]`
- `export-pdf-png.mjs` — 보고서 PDF·PNG 실제 내보내기(전체 쪽). `node tools/qa/export-pdf-png.mjs <analysisId> <outDir> [pdf|png]`
- `pdf-images.mjs` — PDF 안 쪽별 JPEG(DCTDecode)를 꺼낸다(pdftoppm 없는 PC에서 PDF를 Read로 보는 방법). `node tools/qa/pdf-images.mjs <file.pdf> <outDir> [15,18]` — 스트림 크기 목록이 같이 나오니 유난히 작은 쪽(빈 쪽 의심)부터 연다
- `render-pptx.ps1` — PowerPoint SaveAs PNG로 장별 렌더. `powershell -NoProfile -ExecutionPolicy Bypass -File tools/qa/render-pptx.ps1 -Pptx <file.pptx> -Out <dir>`
- `perf-map-colors.mjs` — 보드에서 다이어그램 색을 연달아 바꿀 때 걸리는 시간. `node tools/qa/perf-map-colors.mjs <analysisId> [횟수]` (`paint` 누른 반응이 보이기까지, `settle` 지도 색이 다 바뀌기까지. 개발 서버 대치동 503 기준 2026-10-29: paint 중앙값 21 ms·settle 309 ms, 고치기 전 600·603 ms)
- `render-map-svg.tsx` — 서버 없이 저장 분석의 타일 지도를 화면과 같은 `MapFigure` SVG로 쓰고, 대지 바깥 윤곽(`siteOutlineFromScene`)의 변 길이·꼭짓점 표고를 출력. 결정 페이지 시안·치수 검산용. `npx tsx tools/qa/render-map-svg.tsx <analysisId 전체> <outDir> [A12,D03] [460x330]` (대치동 503 `fe9e688b-…` 2026-10-29: 변 151.6/7.5/303.2/15.0/188.5/140.6/37.3/124.0 m, 표고 17.4–19.1 m)
- `probe-charts.mts` — 엔진을 직접 돌려(DB 쓰기 없음) 타일별 `countedCapped`·payload 수·그래프 한 줄 통계·문장 머리를 출력. `npx tsx tools/qa/probe-charts.mts <analysisId> D03,A07,A09` (`V2_DATA_DIR`, `V2_APP_DB_PATH`로 경로 변경)

## 전체 UI 검수 순서

refresh → capture → export → render → PNG를 직접 열어 본다.

## 함정

- 로그인은 IP당 15분에 5회로 제한된다. 저장된 세션이 통하면 다시 로그인하지 않게 `auth.mjs`로만 들어간다. 직접 로그인 코드를 새로 쓰지 말 것.
- 쪽 목록 썸네일에도 `[data-analysis-column]`이 있다. 「이미 그래프 레이아웃」 판정은 본 장(가장 넓은 열)만 보고 한다.
- DOM 수치(겹침·열 밖 글자)만 믿지 말고 스크린샷·렌더 PNG를 열어 눈으로 확인한다. PNG 크기만 보고 빈 이미지를 놓친 적이 있다.
- PPT 렌더는 `SaveAs`(PNG)만 쓴다. `Slide.Export`는 지도 장에서 멈춘다. 스크립트는 Start-Job 타임아웃으로 멈춘 PowerPoint를 정리한다.
- `export-pptx`·`export-pdf-png`는 「추천 구성으로 시작」이 보이면 눌러 새 문서로 내보낸다. 장식(대지 치수·표고 등)을 켠 장을 확인하려면 UI에서 켠 뒤 같은 창에서 내보내야 한다.
- `refresh-analysis`는 공유 분석의 결과를 바꾼다. 다른 테스트가 같은 분석을 쓰는 동안은 돌리지 않는다.

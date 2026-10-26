import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { SlideSurface } = await import("../../components/v2/report/slide-surface.tsx");

const exportSurfaceCss = readFileSync(new URL("../../components/v2/report/slide-surface.module.css", import.meta.url), "utf8");
const reportSurfaceCss = readFileSync(new URL("../../components/v2/report-surface.module.css", import.meta.url), "utf8");
const slideSurfaceSource = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
const reportModeSource = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const reportModeCss = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");
const drawerTilesSource = readFileSync(new URL("../../components/v2/report/drawer-tiles.tsx", import.meta.url), "utf8");
const drawerMapSource = readFileSync(new URL("../../components/v2/report/drawer-map.tsx", import.meta.url), "utf8");

const source = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
assert.ok(source, "A01 fixture가 필요하다");
const base = buildReportPlan({
  summary: toSummaryView(GODEOK_SUMMARY, [source]),
  views: new Map([[source.tileId, toTileView(source)]]),
  board: initBoard([source]),
  analysisDate: "2026-10-19",
}).find((slide) => slide.kind === "tile" && slide.view.code === "A01");
assert.ok(base, "A01 표면 fixture가 필요하다");

const a3 = { ...base, no: 1, total: 1, key: "t-A01", format: "a3", page: { kind: "tile", ...base.page, layout: "numbers-first" } };
const exportMarkup = renderToStaticMarkup(createElement(SlideSurface, { slide: a3, basemap: "none", mode: "export" }));
assert.match(exportMarkup, /aspect-ratio:16\.535 \/ 11\.693/, "A3 표면 비율");
assert.match(exportMarkup, /data-surface-mode="export"/, "export 표면 모드 식별자");
assert.match(exportMarkup, /data-frame-ready="false"/, "export frame은 측정 전 대기 상태를 표시한다");
assert.match(exportSurfaceCss, /.surfaceRoot\[data-surface-mode="export"\]\s*\{[\s\S]*?color:\s*#15171c;/s, "export 표면의 상속 색은 편집 화면의 잉크 색이다");
assert.match(exportSurfaceCss, /\.surfaceRoot\[data-surface-mode="export"\]\s*\[data-preview-frame="true"\]\s*\{[\s\S]*?box-sizing:\s*border-box[\s\S]*?width:\s*100%\s*!important[\s\S]*?height:\s*100%\s*!important[\s\S]*?border:\s*0[\s\S]*?border-radius:\s*0[\s\S]*?box-shadow:\s*none/s, "export frame은 host를 채우고 chrome이 없다");
assert.match(exportSurfaceCss, /\.surfaceRoot\[data-surface-mode="export"\]\s*\*,[\s\S]*?transition:\s*none\s*!important;[\s\S]*?animation:\s*none\s*!important;/s, "export 표면의 transition·animation은 꺼진다");
assert.match(exportSurfaceCss, /\.surfaceRoot\[data-surface-mode="export"\]\s*\[data-report-source-table="true"\]\s*th,[\s\S]*?line-height:\s*1\.05;/s, "export 출처 행은 표 상자 안에 맞는 밀도로 조판한다");
assert.doesNotMatch(exportMarkup, />A01<\//, "슬라이드 제목의 내부 타일 코드는 사용자에게 보이지 않는다");
assert.match(reportSurfaceCss, /\.slidePanel\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?padding:\s*calc\(var\(--slide-unit\)\s*\*\s*0\.22\)/s, "공용 slidePanel 여백은 유지된다");
assert.match(reportSurfaceCss, /\.legendPanel\s*\{[\s\S]*?padding:\s*calc\(var\(--slide-unit\)\s*\*\s*var\(--legend-pad\)\)/s, "범례 패널만 정본 padding 변수를 쓴다");
assert.match(reportSurfaceCss, /\.legendRow[\s\S]*?grid-template-columns:\s*calc\(var\(--slide-unit\)\s*\*\s*var\(--legend-icon-column\)\)/s, "범례 아이콘 열은 정본 CSS 변수다");
assert.match(reportSurfaceCss, /\.legendRow[\s\S]*?gap:\s*calc\(var\(--slide-unit\)\s*\*\s*var\(--legend-gap\)\)/s, "범례 행 간격은 정본 CSS 변수다");
assert.match(reportSurfaceCss, /\.legendRow[\s\S]*?min-height:\s*calc\(var\(--slide-unit\)\s*\*\s*var\(--legend-row\)\)/s, "범례 항목 행은 정본 CSS 변수 높이를 가진다");
assert.match(reportSurfaceCss, /\.legendNote\s*\{[\s\S]*?min-height:\s*calc\(var\(--slide-unit\)\s*\*\s*var\(--legend-note\)\)/s, "범례 문구 행도 정본 CSS 변수 높이를 가진다");
assert.match(slideSurfaceSource, /"--legend-pad":\s*String\(legendGeometry\.padding\)/, "범례 패널 padding 변수는 공용 geometry를 쓴다");
assert.match(slideSurfaceSource, /"--legend-icon-column":\s*String\(legendGeometry\.iconColumn\)/, "범례 아이콘 열 변수는 공용 geometry를 쓴다");
assert.match(slideSurfaceSource, /"--legend-gap":\s*String\(legendGeometry\.gap\)/, "범례 간격 변수는 공용 geometry를 쓴다");
assert.match(slideSurfaceSource, /fitBlock\(\[item\.label\][\s\S]*?w:\s*Math\.max\(0\.2,\s*legendGeometry\.labelW\)/s, "미리보기 범례 라벨 폭은 공용 geometry를 쓴다");

const editMarkup = renderToStaticMarkup(createElement(SlideSurface, { slide: a3, basemap: "none", mode: "edit", mapActive: true }));
assert.match(editMarkup, /data-map-editing="true"/, "지도 편집 중인 slide canvas 식별자");
assert.doesNotMatch(exportSurfaceCss, /\.surfaceRoot\[data-map-editing/, "data-map-editing은 surfaceRoot가 아니라 그 안의 slide canvas에 붙는다");
assert.match(exportSurfaceCss, /\[data-map-editing="true"\]\s+\[data-panel-key\][\s\S]*?opacity:\s*\.35[\s\S]*?pointer-events:\s*none/s, "지도 편집 중 제목·요약·범례 패널은 흐리고 누를 수 없다");
assert.match(exportSurfaceCss, /\[data-map-editing="true"\]\s+\[data-preview-map\][\s\S]*?cursor:\s*grab/s, "지도 편집 중 커서는 grab이다");
assert.match(exportSurfaceCss, /\[data-map-editing="true"\]\s+\[data-preview-map\]\[data-dragging="true"\][\s\S]*?cursor:\s*grabbing/s, "지도 끌기 중 커서는 grabbing이다");
const selectedMapMarkup = renderToStaticMarkup(createElement(SlideSurface, { slide: a3, basemap: "none", mode: "edit", mapActive: false, onMapMoveActive: () => undefined }));
assert.match(selectedMapMarkup, /data-preview-map="true"[^>]*tabindex="0"/, "선택만 된 지도도 Enter를 받을 수 있다");
assert.match(selectedMapMarkup, /aria-label="[^"]+지도\. Enter 또는 두 번 눌러 편집합니다\."/, "선택만 된 지도에 편집 진입 안내를 제공한다");

const thumbMarkup = renderToStaticMarkup(createElement(SlideSurface, { slide: a3, basemap: "none", mode: "thumb" }));
assert.equal((thumbMarkup.match(/<button\b/g) ?? []).length, 0, "thumb 표면은 조작 버튼이 없다");
assert.match(exportMarkup, /data-surface-map[^>]*left:55%/, "numbers-first 지도 영역은 오른쪽에 있다");
assert.match(slideSurfaceSource, /fixed=\{!thumbnail\}/, "축소판 지도는 축소판 전용 대지 크기를 사용한다");
assert.doesNotMatch(slideSurfaceSource, /slide\.kind === "sheet" \? "조판" : slide\.view\.code/, "축소판 대체 문구에 내부 타일 코드를 쓰지 않는다");
assert.doesNotMatch(slideSurfaceSource, /\{cell\.view\.code\} · \{cell\.view\.title\}/, "조판 셀 라벨에 내부 타일 코드를 쓰지 않는다");
assert.doesNotMatch(slideSurfaceSource, /\$\{cell\.view\.code\} \$\{cell\.view\.title\} 타일 선택/, "조판 셀 접근성 이름에 내부 타일 코드를 쓰지 않는다");
assert.doesNotMatch(drawerTilesSource, /타일 이름이나 코드 검색/, "타일 검색 안내문에 코드 문구를 노출하지 않는다");
assert.match(drawerTilesSource, /placeholder="타일 이름 검색"/, "타일 검색 안내문은 이름 중심이다");
assert.match(reportModeSource, /viewBox="0 0 20 20"/, "보고서 도구 막대는 20px 인라인 SVG 아이콘을 사용한다");
assert.doesNotMatch(reportModeSource, />▤<|>◈<|>◌</, "보고서 도구 막대에 유니코드 기호를 쓰지 않는다");
assert.match(reportModeCss, /\.searchBox input[\s\S]*?min-height:\s*44px[\s\S]*?height:\s*44px/s, "검색 입력이 44px 전체 높이를 채운다");
assert.match(drawerMapSource, /aria-label="개요 장 추가"/, "설명표 장에서 개요 장 추가 경로를 제공한다");
assert.match(reportModeSource, /firstDetailIndex[\s\S]*?calloutPageFor\(history\.present,[\s\S]*?, 0\)/s, "개요 장은 첫 설명 장 앞에 page 0으로 만든다");
assert.match(reportModeSource, /index: firstDetailIndex/, "개요 장 삽입 위치는 첫 설명 장 앞이다");
assert.match(reportModeSource, /commitDoc\(next, "개요 장을 추가했습니다\."\)/, "개요 장 추가는 commitDoc으로 실행 취소 가능하다");
assert.match(slideSurfaceSource, /data-callout-point="true"/, "설명선 개요·번호 점에 44px hit 영역을 둔다");
assert.match(slideSurfaceSource, /data-callout-hover-tooltip="true"/, "설명선 점 hover 정보는 미리보기 층에만 둔다");

const missing = {
  ...a3,
  key: "missing",
  missing: true,
  body: { kind: "state", face: "single", message: "결과 없음" },
  map: null,
};
const missingMarkup = renderToStaticMarkup(createElement(SlideSurface, { slide: missing, basemap: "none", mode: "export" }));
assert.match(missingMarkup, /결과 없음/, "missing 표면 문구");

const sourceSlide = {
  ...a3,
  key: "sources:0",
  kind: "sources",
  rows: [{ provider: "제공처", source: "자료", asOf: "2026", license: "미기록", url: "", tiles: "입지·대중교통" }],
  analysisDate: "2026-10-20",
  map: null,
  page: { ...a3.page, id: "p-sources", kind: "sources" },
};
const sourceMarkup = renderToStaticMarkup(createElement(SlideSurface, { slide: sourceSlide, basemap: "none", mode: "export" }));
assert.match(sourceMarkup, /data-report-source-table="true"/, "출처 표는 export 행 밀도 계약의 대상이다");

console.log("v2 report surface tests passed");

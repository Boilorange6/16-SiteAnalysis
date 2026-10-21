/** P4 T2 래스터 계약·저장·조회·지도 렌더 회귀. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

globalThis.React = React;

const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { effectiveLayer } = await import("../../lib/v2/report/map-image.ts");
const { default: MapFigure, mapLabelEntries, siteMarkerMode, siteMarkerRadius } = await import("../../components/v2/map-figure.tsx");
const { framedViewport, worldPx } = await import("../../lib/v2/ui/map-projection.ts");
const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { rasterAffine, paintRgba } = await import("../../lib/v2/ui/raster-image.ts");
const { RASTER_STYLES, legendItemsOf } = await import("../../lib/v2/ui/map-layers.ts");
const { encodeRaster, loadTileRaster, saveTileRasters } = await import("../../lib/v2/raster-store.ts");
const { getTileRaster } = await import("../../lib/v2/engine/raster-api.ts");
const A = await import("../../lib/v2/app-db.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");

// 대지 윤곽은 필지 외곽 상자의 짧은 변이 10px 이상일 때만 쓰고, 카드·상세·PPT는 승인된 r을 쓴다.
assert.deepEqual(
  [
    siteMarkerMode([[0, 0], [12, 0], [12, 12], [0, 12], [0, 0]]),
    siteMarkerMode([[0, 0], [10, 0], [10, 12], [0, 12], [0, 0]]),
    siteMarkerMode([[0, 0], [9, 0], [9, 12], [0, 12], [0, 0]]),
    siteMarkerMode([[0, 0], [12, 0], [12, 12], [0, 12]]),
    siteMarkerMode([[0, 0], [0.5, 0], [1, 0], [60, 0], [60, 40], [0, 40], [0, 0]]),
    siteMarkerRadius(280),
    siteMarkerRadius(540),
    siteMarkerRadius(540, true),
    siteMarkerRadius(48),
  ],
  ["parcel", "parcel", "ring", "parcel", "parcel", 4, 7, 10, 1.6],
  "대지 표식 판정과 컨텍스트별 반지름",
);

const refInput = {
  name: "sun_hours",
  kind: "scalar",
  crs: "EPSG:5179",
  x0: 930000,
  y0: 1810000,
  cellM: 10,
  cols: 2,
  rows: 2,
  dtype: "u8",
  bands: 1,
  scale: 1,
  offset: 0,
  nodata: 255,
  palette: "sun_hours",
  label: "합성 일조",
};
const encoded = encodeRaster({ ref: refInput, values: new Uint8Array([0, 1, 2, 255]) });
assert.equal(encoded.ref.bytes, encoded.blob.length, "ref.bytes는 압축 blob 길이");
assert.match(encoded.ref.sha256, /^[0-9a-f]{64}$/);

const db = A.openV2AppDb(":memory:");
const manifestHash = "a".repeat(64);
const runInput = (analysisId, userId) => ({
  analysisId,
  address: "테스트 대지",
  center: [127.15, 37.55],
  radiusM: 800,
  analysisDate: "2026-09-30",
  manifestHash,
  engineVersion: "v2-p4-ext-1",
  parameters: {},
  userId,
});
A.createAnalysisRun(db, runInput("raster-a", 17));
A.createAnalysisRun(db, runInput("raster-b", 17));
saveTileRasters(db, "cache-raster", [encoded]);
const loaded = loadTileRaster(db, "cache-raster", "sun_hours");
assert.deepEqual(loaded?.ref, encoded.ref);
assert.deepEqual(loaded?.blob, encoded.blob);

const base = structuredClone(GODEOK_RESULTS.find((result) => result.tileCode === "A01"));
const makeResult = (analysisId) => ({
  ...base,
  analysisId,
  tileId: `${analysisId}-D01`,
  tileCode: "D01",
  tileType: "diagram",
  status: "complete",
  judgment: null,
  provenance: { ...base.provenance, manifestHash },
  presentation: { ...base.presentation, features: [], polygons: [], lines: [], rasters: [encoded.ref], basemap: "Satellite" },
});
for (const analysisId of ["raster-a", "raster-b"]) {
  const result = parseTileResult(makeResult(analysisId));
  A.saveTileResult(db, result, "cache-raster");
}
const sameBlob = getTileRaster(db, "raster-b", "D01", "sun_hours", 17);
assert.equal(sameBlob.status, 200);
assert.deepEqual(sameBlob.body, encoded.blob, "동일 캐시 키의 blob 재사용");
assert.equal(getTileRaster(db, "raster-b", "D01", "sun_hours", 18).status, 403, "남의 분석은 403");
assert.equal(getTileRaster(db, "raster-b", "D01", "missing", 17).status, 404);
assert.equal(getTileRaster(db, "raster-b", "D02", "sun_hours", 17).status, 404);

const view = toTileView(parseTileResult(makeResult("raster-a")));
assert.ok(view.map, "래스터만 있는 결과도 지도 모델");
assert.equal(view.map.basemap, "Satellite");
assert.ok(!view.map.notes.includes("반경 안 표시할 지물 없음"), "basemap-only 지도에는 지물 없음 노트를 붙이지 않는다");
assert.equal(effectiveLayer(view.map, "white"), "Satellite");
assert.throws(() => parseTileResult({ ...makeResult("raster-a"), presentation: { ...makeResult("raster-a").presentation, basemap: "Base" } }));

const vp = framedViewport([127.15, 37.55], 1000, 1200, 900);
const [cx, cy] = toUtmk([127.15, 37.55]);
const affineRef = { ...refInput, x0: cx - 600, y0: cy - 450, cellM: 10, cols: 120, rows: 90 };
const matrix = rasterAffine(affineRef, vp);
const affine = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
const expected = (x, y) => {
  const [lng, lat] = toLngLat([x, y]);
  const [wx, wy] = worldPx(lng, lat, vp.zoom);
  const [cxw, cyw] = worldPx(vp.center[0], vp.center[1], vp.zoom);
  return [wx - cxw + vp.width / 2, wy - cyw + vp.height / 2];
};
for (const [x, y] of [[affineRef.x0, affineRef.y0 + affineRef.rows * affineRef.cellM], [affineRef.x0 + affineRef.cols * affineRef.cellM, affineRef.y0 + affineRef.rows * affineRef.cellM], [affineRef.x0, affineRef.y0], [affineRef.x0 + 600, affineRef.y0 + 450], [affineRef.x0 + affineRef.cols * affineRef.cellM, affineRef.y0]]) {
  const got = affine((x - affineRef.x0) / affineRef.cellM, (affineRef.rows * affineRef.cellM - (y - affineRef.y0)) / affineRef.cellM);
  const want = expected(x, y);
  assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) < 1, `affine 오차 ${got} vs ${want}`);
}

const rgba = paintRgba({ ...encoded.ref, cols: 2, rows: 2 }, new Uint8Array([0, 1, 2, 255]), { mode: "stepped", colors: ["#0000ff", "#00ff00", "#ff0000"], breaks: [1, 2] }, 2, 2);
assert.equal(rgba.length, 16);
assert.equal(rgba[7], 0, "nodata는 투명");
assert.notDeepEqual([...rgba.slice(0, 4)], [...rgba.slice(4, 8)], "계단 팔레트 경계 색");

const roofRef = { ...encoded.ref, name: "sun_hours_summer", palette: "sun_hours", cols: 3, rows: 3, nodata: 255 };
const roofRgba = paintRgba(roofRef, new Uint8Array(9).fill(254), RASTER_STYLES.sun_hours, 3, 3);
assert.ok(roofRgba[0] < 120 && roofRgba[1] < 140 && roofRgba[2] < 160, "건물 표식 외곽선은 어두운 중립색");
const roofCenter = (1 * 3 + 1) * 4;
assert.ok(roofRgba[roofCenter] > 240 && roofRgba[roofCenter + 1] > 240 && roofRgba[roofCenter + 2] > 240, "건물 표식 내부는 밝은 중립색");
assert.equal(RASTER_STYLES.sun_hours.colors.length, 16, "sun_hours 공용 팔레트는 16색이어야 한다");
assert.deepEqual(RASTER_STYLES.sun_hours.breaks, Array.from({ length: 15 }, (_, index) => index + 1), "sun_hours 경계는 1~15시간이어야 한다");
assert.equal(RASTER_STYLES.wind_ratio.mode, "stepped", "wind_ratio는 계단형 범례여야 한다");
assert.deepEqual(RASTER_STYLES.wind_ratio.legendTicks, [0, 0.5, 0.8, 1.2, 1.5], "wind_ratio 범례 눈금");
assert.deepEqual(RASTER_STYLES.wind_ratio.legendLabels, ["0~0.5", "0.5~0.8", "0.8~1.2", "1.2 이상"], "wind_ratio 범주 어휘");

const svfStyle = RASTER_STYLES.svf;
assert.deepEqual(svfStyle.stops, [0, 0.25, 0.5, 0.65, 0.75, 0.85, 0.92, 1], "SVF는 상위 구간을 세분한 stop을 쓴다");
assert.equal(svfStyle.colors[0], "#1b2b5a", "SVF 최저값은 navy");
assert.equal(svfStyle.colors.at(-1), "#f7fbff", "SVF 최고값은 near-white");
const svfRef = { ...encoded.ref, name: "svf", scale: 1 / 250, palette: "svf" };
const svfRgba = paintRgba(svfRef, new Uint8Array([250, 255, 0, 125]), svfStyle, 2, 2);
assert.ok(svfRgba[0] < 80 && svfRgba[1] < 100 && svfRgba[2] < 150, "SVF 0은 어두운 navy");
assert.ok(svfRgba[8] > 235 && svfRgba[9] > 240 && svfRgba[10] > 245, "SVF 1은 near-white");

const svg = renderToStaticMarkup(createElement(MapFigure, {
  model: view.map,
  width: 800,
  height: 500,
  basemap: "none",
  fixed: true,
  rasterHref: () => "data:image/png;base64,AAAA",
}));
assert.match(svg, /<image/);
assert.match(svg, /matrix\(/);
assert.match(svg, /image-rendering:pixelated/, "단계형 래스터는 셀 경계를 보존한다");
assert.match(svg, /data-radius-clip="true"/);
assert.match(svg, /role="img" aria-label="분석 대지"/);
assert.ok(svg.indexOf("data-raster") < svg.indexOf("data-poly") || !svg.includes("data-poly"), "래스터는 면보다 아래");

// 범례 강조는 래스터·도형만 약화하고, 고정 라벨/콜아웃은 MapFigure와 PPT에서 함께 보존한다.
const focusMap = toTileView(GODEOK_RESULTS.find((result) => result.tileCode === "A01") ?? base).map;
assert.ok(focusMap, "범례 강조용 A01 지도");
const focusLegend = legendItemsOf(focusMap).find((entry) => !entry.site);
const focusLabel = mapLabelEntries(focusMap)[0];
assert.ok(focusLegend && focusLabel, "범례 강조·고정 라벨 회귀용 지도 요소");
const focusRasterMap = { ...focusMap, rasters: [encoded.ref], rasterOptions: [encoded.ref], defaultRaster: encoded.ref.name };
const focusSvg = renderToStaticMarkup(createElement(MapFigure, {
  model: focusRasterMap,
  width: 800,
  height: 500,
  basemap: "none",
  fixed: true,
  legendFocus: focusLegend.label,
  highlightLabel: focusLegend.label,
  pinnedKeys: [focusLabel.key],
  rasterHref: () => "data:image/png;base64,AAAA",
}));
assert.match(focusSvg, /data-map-label-variant="fixed"/, "고정 라벨이 범례 강조 지도에 있다");
assert.doesNotMatch(focusSvg, /data-map-label-variant="fixed"[^>]*opacity="0\.2"/, "고정 라벨이 범례 강조로 dim되지 않는다");
assert.match(focusSvg, /data-raster/, "범례 강조 래스터 경로가 유지된다");

const svfModel = { ...view.map, rasters: [svfRef], notes: ["SVF 색 구간 0·25·50·65·75·85·92·100%"] };
const svfSvg = renderToStaticMarkup(createElement(MapFigure, {
  model: svfModel,
  width: 800,
  height: 500,
  basemap: "none",
  fixed: true,
  legend: true,
  legendY: -20,
  rasterHref: () => "data:image/png;base64,AAAA",
}));
assert.match(svfSvg, /data-raster-legend="svf"/);
assert.match(svfSvg, /image-rendering:auto/, "연속형 래스터는 부드럽게 보간한다");
for (const tick of ["0%", "25%", "50%", "75%", "100%"])
  assert.match(svfSvg, new RegExp(tick.replace("%", "\\%")), `SVF 범례 ${tick}`);

const sunRef = { ...encoded.ref, name: "sun_hours_summer", palette: "sun_hours", label: "하지 일조시간" };
const sunLegend = Array.from({ length: 16 }, (_, index) => ({
  label: index === 15 ? "일조시간 · 15시간 이상" : `일조시간 · ${index}시간`,
  min: index,
  max: index === 15 ? null : index + 1,
}));
const sunModel = {
  ...view.map,
  tileCode: "S02",
  notes: [],
  polygons: [{ layer: "sun_face", rings: [[[127.149, 37.549], [127.151, 37.549], [127.151, 37.551], [127.149, 37.551]]] }],
  rasters: [sunRef],
  rasterOptions: [sunRef],
  defaultRaster: sunRef.name,
  legend: sunLegend,
};
const sunSvg = renderToStaticMarkup(createElement(MapFigure, {
  model: sunModel,
  width: 375,
  height: 360,
  basemap: "none",
  fixed: true,
  rasterHref: () => "data:image/png;base64,AAAA",
}));
assert.match(sunSvg, /data-raster-legend-title="true"[^>]*>일조시간</);
assert.equal((sunSvg.match(/data-raster-legend-entry=/g) ?? []).length, 16, "S02 범례는 16칸 단일 바");
for (const tick of ["0", "3", "6", "9", "12", "15+"]) {
  assert.match(sunSvg, new RegExp(`data-raster-legend-tick="${tick.replace("+", "\\+")}"`), `S02 범례 ${tick}`);
}
assert.doesNotMatch(sunSvg, />일조시간 · 6시간</, "반복 스와치 라벨을 그리지 않음");

const sunCardSvg = renderToStaticMarkup(createElement(MapFigure, {
  model: sunModel,
  width: 336,
  height: 280,
  basemap: "none",
  fixed: true,
  legend: false,
  rasterHref: () => "data:image/png;base64,AAAA",
}));
assert.doesNotMatch(sunCardSvg, /data-map-legend/);
assert.doesNotMatch(sunCardSvg, /data-raster-legend/);
assert.doesNotMatch(sunCardSvg, /raster-gradient/);

const winterRef = { ...sunRef, name: "sun_hours_winter", label: "동지 일조시간" };
const winterLegend = sunLegend.slice(0, 13).map((entry, index, all) => ({ ...entry, label: index === all.length - 1 ? "일조시간 · 12시간 이상" : entry.label, max: index === all.length - 1 ? null : entry.max }));
const winterCardSvg = renderToStaticMarkup(createElement(MapFigure, {
  model: { ...sunModel, tileCode: "S02", polygons: [], rasters: [winterRef], rasterOptions: [winterRef], defaultRaster: winterRef.name, legend: winterLegend },
  width: 336,
  height: 280,
  basemap: "none",
  fixed: true,
  legend: false,
  rasterHref: () => "data:image/png;base64,AAAA",
}));
assert.doesNotMatch(winterCardSvg, /data-map-legend/);
assert.doesNotMatch(winterCardSvg, /data-raster-legend/);
assert.doesNotMatch(winterCardSvg, /raster-gradient/);

const buildingModel = {
  ...svfModel,
  polygons: [{ layer: "svf_building", rings: [[[127.149, 37.549], [127.151, 37.549], [127.151, 37.551], [127.149, 37.551]]], fid: "building-1" }],
};
const buildingSvg = renderToStaticMarkup(createElement(MapFigure, {
  model: buildingModel,
  width: 800,
  height: 500,
  basemap: "none",
  fixed: true,
  rasterHref: () => "data:image/png;base64,AAAA",
}));
assert.match(buildingSvg, /fill="#F8FAFC"/, "래스터 위 건물은 중립 채움");
assert.match(buildingSvg, /stroke="#475569"/, "래스터 위 건물은 중립 외곽선");
const buildingCardSvg = renderToStaticMarkup(createElement(MapFigure, {
  model: buildingModel,
  width: 336,
  height: 280,
  basemap: "none",
  fixed: true,
  legend: false,
  rasterHref: () => "data:image/png;base64,AAAA",
}));
assert.doesNotMatch(buildingCardSvg, /data-map-legend/);
assert.doesNotMatch(buildingCardSvg, /data-raster-legend/);
assert.doesNotMatch(buildingCardSvg, /raster-gradient/);

if (process.env.P4_VISUAL === "1") {
  const requireMain = createRequire("D:/V-coding/16-SiteAnalysis/package.json");
  const sharp = requireMain("D:/V-coding/16-SiteAnalysis/node_modules/sharp");
  const PptxGenJS = requireMain("D:/V-coding/16-SiteAnalysis/node_modules/pptxgenjs");
  const { createHash } = await import("node:crypto");
  const { writeFile } = await import("node:fs/promises");
  const { toUtmk: toUtmkVisual, toLngLat: toLngLatVisual } = await import("../../lib/v2/crs.ts");
  mkdirSync("docs/design/p4", { recursive: true });
  const [vx, vy] = toUtmkVisual([127.15, 37.55]);
  const visualRef = {
    name: "synthetic_concentric",
    kind: "classes",
    crs: "EPSG:5179",
    x0: vx - 400,
    y0: vy - 400,
    cellM: 10,
    cols: 80,
    rows: 80,
    dtype: "u8",
    bands: 1,
    scale: 1,
    offset: 0,
    nodata: null,
    palette: "synthetic",
    label: "합성 동심원",
    bytes: 1,
    sha256: "0".repeat(64),
  };
  const values = new Uint8Array(80 * 80);
  for (let y = 0; y < 80; y += 1) for (let x = 0; x < 80; x += 1) {
    const distance = Math.hypot(x + 0.5 - 40, y + 0.5 - 40);
    values[y * 80 + x] = distance <= 30 ? 3 : distance <= 50 ? 2 : distance <= 70 ? 1 : 0;
  }
  const style = { mode: "stepped", colors: ["#F8FAFC", "#B8E0D2", "#5AA897", "#257A67"], breaks: [1, 2, 3], opacity: 0.86, label: "합성 동심원" };
  const rgbaVisual = paintRgba(visualRef, values, style, 80, 80);
  const pngBuffer = await sharp(Buffer.from(rgbaVisual), { raw: { width: 80, height: 80, channels: 4 } }).png().toBuffer();
  const imageHref = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  const ring = [];
  for (let i = 0; i <= 64; i += 1) {
    const angle = (i / 64) * Math.PI * 2;
    ring.push(toLngLatVisual([vx + 300 * Math.cos(angle), vy + 300 * Math.sin(angle)]));
  }
  const visualModel = {
    center: [127.15, 37.55],
    radiusM: 400,
    features: [],
    total: 0,
    notes: ["합성 동심원 래스터 · 10 m 셀", "같은 300 m 원 벡터 테두리"],
    rasters: [visualRef],
    polygons: [{ layer: "parcel", rings: [ring], label: "300 m 경계" }],
  };
  const visualSvg = renderToStaticMarkup(createElement(MapFigure, {
    model: visualModel,
    width: 1200,
    height: 800,
    basemap: "none",
    fixed: true,
    layer: "white",
    rasterHref: () => imageHref,
    label: "P4 래스터 affine 시각 검증",
  }));
  const mapPngPath = "docs/design/p4/raster-map-compare.png";
  await sharp(Buffer.from(visualSvg)).png().toFile(mapPngPath);
  const mapPng = await (await import("node:fs/promises")).readFile(mapPngPath);
  const mapHref = `data:image/png;base64,${mapPng.toString("base64")}`;
  const slideSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#f5f4ef"/><image href="${mapHref}" x="0" y="80" width="1600" height="820" preserveAspectRatio="xMidYMid slice"/><rect width="1600" height="80" fill="#16181d"/><text x="48" y="50" fill="#ffffff" font-family="Arial, sans-serif" font-size="28" font-weight="700">P4 래스터 지도 · PPT 합성 캡처</text></svg>`;
  const pptPngPath = "docs/design/p4/raster-ppt-compare.png";
  await sharp(Buffer.from(slideSvg)).png().toFile(pptPngPath);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Site Analysis v2";
  const slide = pptx.addSlide();
  slide.background = { color: "F5F4EF" };
  slide.addText("P4 래스터 지도 · PPT 합성 캡처", { x: 0.4, y: 0.18, w: 8, h: 0.32, fontFace: "Arial", fontSize: 16, bold: true, color: "FFFFFF", margin: 0 });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.67, fill: { color: "16181D" }, line: { color: "16181D" } });
  slide.addImage({ data: mapHref, x: 0, y: 0.67, w: 13.333, h: 5.58 });
  slide.addText("10 m 셀 · 동심원 분류 래스터 + 같은 EPSG:5179 원 경계 · affine 오차 1 px 미만", { x: 0.4, y: 6.6, w: 12.2, h: 0.28, fontFace: "Arial", fontSize: 9, color: "555A64", margin: 0 });
  await pptx.writeFile({ fileName: "docs/design/p4/raster-ppt-compare.pptx" });
  assert.equal(createHash("sha256").update(pngBuffer).digest("hex").length, 64);
  await writeFile("docs/design/p4/raster-visual-metadata.json", JSON.stringify({ mapPngPath, pptPngPath, rasterBytes: pngBuffer.length, polygonRadiusM: 300, cells: "80x80 @ 10m" }, null, 2));
}

db.close();
console.log("✓ v2 raster");

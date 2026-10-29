import assert from "node:assert/strict";
import React from "react";

// tsx uses the repository's classic JSX transform (tsconfig jsx: preserve).
globalThis.React = React;

const { tileFileName, tileSvg } = await import("../../lib/v2/export/tile-image.ts");

const tilePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const model = {
  center: [127.154, 37.555],
  radiusM: 800,
  features: [],
  total: 0,
  notes: ["하지 13:00"],
  analysisId: "qa-analysis",
  tileCode: "S02",
};
const view = {
  tileId: "qa-s02",
  code: "S02",
  tileType: "simulation",
  title: "일조·그림자",
  color: "#5E83B3",
  status: "complete",
  badges: [],
  headline: { value: "2.1", label: "일조시간", aux: "시간" },
  headlineMetricId: "mean_sun_h_winter",
  rows: [],
  sentence: null,
  grade: null,
  grades: [],
  caveats: ["법적 일조 판정 아님"],
  notes: ["하지 13:00"],
  sourceLine: "국토교통부 분석자료 2026-10-08",
  sourceRefs: [],
  chart: null,
  hasFace: false,
  retryable: false,
  map: model,
  backdrop: model,
  kindLabel: "시뮬레이션",
  callout: null,
  mass: null,
  rose: null,
  roses: null,
  stackLayers: null,
  sheetTiles: null,
  sheetGrid: null,
  layerOptions: [],
  defaultLayer: "default",
};

const svg = tileSvg(view, {
  width: 1600,
  height: 1200,
  withFrame: true,
  tileHref: () => tilePng,
});

assert.match(svg, /일조·그림자/);
assert.match(svg, /범례/);
assert.match(svg, /출처 · 국토교통부 분석자료 2026-10-08/);
assert.match(svg, /한계 · 법적 일조 판정 아님/);
assert.match(svg, /하지 13:00/);
assert.match(svg, /href="data:image\/png/);
assert.doesNotMatch(svg, /(?:href|xlink:href)="https?:\/\//);
// D22는 지도와 바람장미를 둘 다 가진다 — 저장 파일에 바람장미가 그려져야 한다(지도만 나오던 회귀)
{
  const dirs = Array.from({ length: 16 }, (_, dir) => (dir === 14 ? [0, 40, 0, 0, 0] : [1, 0, 0, 0, 0]));
  const rose = { station: "near", dirs, calmHours: 10, missingHours: 5, totalHours: 100 };
  const roseSvg = tileSvg({ ...view, code: "D22", title: "바람장미", rose }, { width: 1600, height: 1200, withFrame: true, tileHref: () => tilePng });
  assert.match(roseSvg, /data-rose-dir=/, "D22 저장 SVG에 바람장미 쐐기가 있어야 한다");
}
assert.equal(tileFileName("S02","일조·그림자", "서울특별시 강동구/고덕동 250", "2026-10-08", "png"), "사이트분석_S02_일조·그림자_서울특별시_강동구_고덕동_250_20261008.png");
assert.equal(tileFileName("D22", "바람장미", "서울특별시 강동구 고덕동 250", "20261008", "svg"), "사이트분석_D22_바람장미_서울특별시_강동구_고덕동_250_20261008.svg");

const plate = tileSvg(view, { width: 1600, height: 1200, withFrame: false, tileHref: () => tilePng });
assert.doesNotMatch(plate, /<text[^>]*>범례/);
assert.match(plate, /href="data:image\/png/);

// I-4: 타일 저장은 고른 바탕 테마를 따르고, 실제로 그린 바탕의 출처를 적는다
{
  const { baseTheme } = await import("../../lib/v2/ui/map-theme.ts");
  const base = {
    buildings: [], parcels: [], water: [], green: [], rail: [], stations: [], places: [],
    roads: [{ hierarchy: "간선", widthM: 20, name: null, points: [[127.15, 37.555], [127.158, 37.555]] }],
  };
  const vectorView = { ...view, map: { ...model, base }, backdrop: { ...model, base } };
  const opts = { width: 1600, height: 1200, layer: "vector" };
  const warm = tileSvg(vectorView, { ...opts, withFrame: true });
  const cool = tileSvg(vectorView, { ...opts, withFrame: true, baseTheme: "cool" });
  assert.ok(cool.includes(baseTheme("cool").bg), "cool 바탕색");
  assert.ok(!cool.includes(baseTheme("warm").bg) && warm.includes(baseTheme("warm").bg), "기본은 warm 바탕색");
  assert.match(cool, /바탕지도 · © OpenStreetMap contributors/, "판 출처 줄에 OSM 문구");
  // 모델에 붙은 테마가 먼저
  const modelFirst = tileSvg({ ...vectorView, map: { ...vectorView.map, baseTheme: "ink" } }, { ...opts, withFrame: true, baseTheme: "cool" });
  assert.ok(modelFirst.includes(baseTheme("ink").bg) && !modelFirst.includes(baseTheme("cool").bg), "model.baseTheme > 옵션");
  // 판 없는 도판은 지도 안 credit이 출처를 맡는다
  const platePlain = tileSvg(vectorView, { ...opts, withFrame: false, baseTheme: "cool" });
  assert.match(platePlain, /© OpenStreetMap contributors/);
  assert.ok(!/바탕지도 ·/.test(platePlain));
  // 일반지도(VWorld)로 그리면 VWorld 문구
  assert.match(tileSvg(view, { width: 1600, height: 1200, withFrame: true }), /바탕지도 · © VWorld/);
  // 바탕이 없는 3D 매스·바람장미 저장에는 바탕 출처를 붙이지 않는다
  const dirs = Array.from({ length: 16 }, () => [1, 0, 0, 0, 0]);
  assert.doesNotMatch(tileSvg({ ...view, code: "D22", rose: { station: "near", dirs, calmHours: 1, missingHours: 0, totalHours: 10 } }, { width: 1600, height: 1200, withFrame: true }), /바탕지도 ·/);
}

console.log("✓ v2 tile SVG external-free contract and file names");

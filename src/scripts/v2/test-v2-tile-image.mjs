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

console.log("✓ v2 tile SVG external-free contract and file names");

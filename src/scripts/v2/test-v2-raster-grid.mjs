import assert from "node:assert/strict";

const { toUtmk } = await import("../../lib/v2/crs.ts");
const { bandPolygons, contourLines, gridQuantiles, gridStats, localGrid } = await import("../../lib/v2/engine/tiles/raster-grid.ts");

const CENTER = [127.1, 37.5];
const RADIUS_M = 800;
const CELL_M = 25;
const [cx, cy] = toUtmk(CENTER);

const plane = localGrid(CENTER, RADIUS_M, CELL_M, (x, y) => 0.05 * (x - cx) + 0.001 * (y - cy));
assert.equal(plane.cx, cx);
assert.equal(plane.cy, cy);
assert.equal(plane.x0, cx - (RADIUS_M + CELL_M));
assert.equal(plane.y0, cy - (RADIUS_M + CELL_M));
assert.equal(plane.cols, 67);
assert.equal(plane.rows, 67);

const stats = gridStats(plane, RADIUS_M);
assert.ok(stats.cells > 0);
assert.equal(stats.valid, stats.cells);
assert.equal(stats.cells, gridStats(plane, RADIUS_M).cells, "gridStats는 결정적이어야 한다");

const quantiles = gridQuantiles(plane, RADIUS_M, [0, 0.25, 0.5, 0.75, 1]);
assert.equal(quantiles.length, 5);
assert.ok(quantiles.every(Number.isFinite));
assert.ok(quantiles.every((value, index) => index === 0 || value >= quantiles[index - 1]));

const layers = ["relief_lt_m20", "relief_m20_m5", "relief_m5_5", "relief_5_20", "relief_ge20"];
const bands = bandPolygons(CENTER, RADIUS_M, plane, [-20, -5, 5, 20], layers, "dem_nodata");
assert.equal(bands.areaM2.length, 6);
const circleArea = Math.PI * RADIUS_M ** 2;
const bandArea = bands.areaM2.reduce((sum, value) => sum + value, 0);
assert.ok(Math.abs(bandArea - circleArea) / circleArea < 0.02, `band area ${bandArea} should cover the circle ${circleArea}`);
const ge20Share = bands.areaM2[4] / circleArea;
const ge20Expected = (RADIUS_M ** 2 * Math.acos(400 / RADIUS_M) - 400 * Math.sqrt(RADIUS_M ** 2 - 400 ** 2)) / circleArea;
assert.ok(Math.abs(ge20Share - ge20Expected) < 0.05, `relief_ge20 share ${ge20Share} should follow the plane segment ${ge20Expected}`);
assert.ok(bands.polygons.some((candidate) => candidate.p.layer === "relief_ge20"));

const missing = localGrid(CENTER, RADIUS_M, CELL_M, (x, y) => {
  const dx = x - cx;
  const dy = y - cy;
  return Math.abs(dx) <= 100 && Math.abs(dy) <= 100 ? null : 0.05 * dx;
});
const missingStats = gridStats(missing, RADIUS_M);
assert.ok(missingStats.valid < missingStats.cells);
const missingBands = bandPolygons(CENTER, RADIUS_M, missing, [-20, -5, 5, 20], layers, "dem_nodata");
assert.ok(missingBands.areaM2.at(-1) > 0, "결측 면적은 nodata 마지막 구간에 들어가야 한다");
assert.ok(missingBands.polygons.some((candidate) => candidate.p.layer === "dem_nodata"));

const lines = contourLines(CENTER, RADIUS_M, plane, 5, "contour");
assert.ok(lines.length >= 10);
assert.ok(lines.every((candidate) => candidate.l.layer === "contour" && candidate.l.points.length >= 2));
assert.ok(lines.every((candidate) => /m$/.test(candidate.l.label ?? "")));
const lineXs = lines.map((candidate) => candidate.l.points.map((point) => toUtmk(point)[0] - cx));
assert.ok(lineXs.some((xs) => Math.max(...xs) - Math.min(...xs) < 1), "평면 등고선은 수직선이어야 한다");

console.log("✓ v2 raster grid");

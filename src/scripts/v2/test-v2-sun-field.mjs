import assert from "node:assert/strict";
import { area, featureCollection, polygon, union } from "@turf/turf";

const { kst, kstForTrueSolar, sunPosition, sunriseSunsetKstMin } = await import("../../lib/v2/sim/sun.ts");
const { buildingShadow } = await import("../../lib/v2/sim/shadow.ts");
const { computeSunlight } = await import("../../lib/v2/sim/sunlight.ts");
const { computeSunField, fillRing, shadowPieces } = await import("../../lib/v2/sim/sun-field.ts");

const LAT = 37.55;
const LON = 127.15;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (±${tolerance})`);

function grid({ x0 = -100, y0 = -100, cellM = 2, cols = 100, rows = 100, receiver = 1 } = {}) {
  return {
    x0,
    y0,
    cellM,
    cols,
    rows,
    receiver: new Uint8Array(cols * rows).fill(receiver),
    groundZ: null,
  };
}

function box(x, y, width, depth, heightM, kind = "building", id = "b") {
  return { id, ring: [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]], heightM, baseZ: null, kind };
}

function valueAt(result, g, x, y, values = result.sunMin) {
  const col = Math.floor((x - g.x0) / g.cellM);
  const row = Math.floor((y - g.y0) / g.cellM);
  return values[row * g.cols + col];
}

// 1) scanline fill: convex, concave, and clipped polygons use cell-center parity.
{
  const g = grid({ x0: 0, y0: 0, cellM: 1, cols: 10, rows: 10, receiver: 0 });
  const mask = new Uint8Array(100);
  fillRing(mask, g, [[2, 2], [6, 2], [6, 6], [2, 6]]);
  assert.equal(mask.reduce((sum, v) => sum + v, 0), 16, "4x4 square cell centers");

  const lMask = new Uint8Array(100);
  fillRing(lMask, g, [[1, 1], [5, 1], [5, 2], [2, 2], [2, 5], [1, 5]]);
  assert.equal(lMask.reduce((sum, v) => sum + v, 0), 7, "concave L cell centers");

  const clipped = new Uint8Array(100);
  fillRing(clipped, g, [[-2, -2], [3, -2], [3, 3], [-2, 3]]);
  assert.equal(clipped.reduce((sum, v) => sum + v, 0), 9, "grid clipping");
}

// 2) swept pieces have the same union as the existing Turf shadow implementation.
{
  const ring = [[0, 0], [20, 0], [20, 10], [12, 10], [12, 20], [0, 20]];
  const v = [14, 9];
  const pieces = shadowPieces(ring, v).map((r) => polygon([[...r, r[0]]]));
  const swept = union(featureCollection(pieces));
  const baseline = buildingShadow({ id: "l", ring, heightM: 10 }, { altitudeDeg: Math.atan2(10, Math.hypot(...v)) * 180 / Math.PI, azimuthDeg: Math.atan2(-v[0], -v[1]) * 180 / Math.PI + 360 }).geometry;
  const baselineFeature = { type: "Feature", properties: {}, geometry: baseline };
  near(area(swept), area(baselineFeature), area(baselineFeature) * 0.01, "shadow pieces union area");
}

// 3) a winter noon shadow falls north; an open southern cell keeps the full day.
{
  const g = grid();
  const r = computeSunField({
    grid: g,
    obstacles: [box(0, 0, 20, 20, 20)],
    latDeg: LAT,
    lonDeg: LON,
    date: { year: 2026, month: 12, day: 22 },
  });
  assert.ok(valueAt(r, g, 10, 30) < valueAt(r, g, 10, -20), "north cell is less sunny than south cell");
  const open = valueAt(r, g, -80, -80);
  const day = sunriseSunsetKstMin(LAT, LON, 2026, 12, 22);
  near(open, day.sunset - day.sunrise, 10, "open cell day length");
}

// 4) true-solar 09:00 at longitude 127.15E is around 09:33 KST on the winter solstice.
near(kstForTrueSolar(LON, 2026, 12, 22, 540), 9 * 60 + 33, 3, "true solar to KST");

// 5) within the old 09:00-15:00 KST window, the new raster agrees with computeSunlight.
{
  const site = [[-30, -30], [30, -30], [30, 30], [-30, 30]];
  const building = { id: "south", ring: [[-20, -90], [20, -90], [20, -70], [-20, -70]], heightM: 30 };
  const old = computeSunlight({ site, buildings: [building], latDeg: LAT, lonDeg: LON, date: { year: 2026, month: 12, day: 22 }, gridM: 2, influenceM: 300 });
  const g = grid({ x0: -30, y0: -30, cols: 30, rows: 30 });
  const current = computeSunField({ grid: g, obstacles: [{ ...building, baseZ: null, kind: "building" }], latDeg: LAT, lonDeg: LON, date: { year: 2026, month: 12, day: 22 } });
  const medianOldMin = old.medianHours * 60;
  const sortedNew = Array.from(current.longestRunTst0915).sort((a, b) => a - b);
  const medianNewMin = sortedNew[Math.floor(sortedNew.length / 2)];
  near(medianNewMin, medianOldMin, 10, "09-15 cross-check");
}

// 6) a 15 degree horizon shades only intervals whose sun is below that horizon.
{
  const g = grid({ x0: -20, y0: -20, cols: 20, rows: 20 });
  const r = computeSunField({ grid: g, obstacles: [], latDeg: LAT, lonDeg: LON, date: { year: 2026, month: 6, day: 21 }, horizon: () => 15 });
  const day = sunriseSunsetKstMin(LAT, LON, 2026, 6, 21);
  const expectedAbove = r.sunMin[0];
  assert.ok(expectedAbove < day.sunset - day.sunrise, "horizon removes low-altitude intervals");
  assert.equal(r.stats.receivers, 400);
}

// 6b) unknown-height roofs are excluded from receivers and never treated as zero-height shadows.
{
  const g = grid({ x0: -20, y0: -20, cols: 20, rows: 20 });
  const r = computeSunField({ grid: g, obstacles: [box(-10, -10, 10, 10, Number.NaN)], latDeg: LAT, lonDeg: LON, date: { year: 2026, month: 6, day: 21 } });
  assert.equal(r.obstacles.excludedNoHeight, 1);
  assert.equal(r.stats.receivers, 375);
  assert.ok(r.hourly.every(({ shade }) => shade.length === Math.ceil((g.cols * g.rows) / 8)));
  assert.equal(g.receiver.every((value) => value === 1), true, "input receiver mask is not mutated");
}

// 7) hourly masks include the expected number of >=5 degree KST snapshots.
for (const [month, expected] of [[12, 9], [3, 11], [6, 13]]) {
  const g = grid({ x0: -20, y0: -20, cols: 20, rows: 20 });
  const r = computeSunField({ grid: g, obstacles: [], latDeg: LAT, lonDeg: LON, date: { year: 2026, month, day: month === 12 ? 22 : month === 6 ? 21 : 20 } });
  assert.ok(Math.abs(r.hourly.length - expected) <= 1, `${month} hourly count ${r.hourly.length}`);
}

// 8) quality-first performance gate: 800m radius at 2m cells and 3,000 buildings.
if (process.env.SUN_FIELD_PERF !== "skip") {
  let seed = 0xdecafbad;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const g = grid({ x0: -800, y0: -800, cellM: 2, cols: 800, rows: 800 });
  const obstacles = [];
  for (let i = 0; i < 3000; i++) {
    const x = -760 + random() * 1520;
    const y = -760 + random() * 1520;
    obstacles.push(box(x, y, 10 + random() * 50, 10 + random() * 50, 10 + random() * 50, "building", `b${i}`));
  }
  const t0 = performance.now();
  const r = computeSunField({ grid: g, obstacles, latDeg: LAT, lonDeg: LON, date: { year: 2026, month: 6, day: 21 } });
  const ms = performance.now() - t0;
  console.log(`sun-field perf: ${obstacles.length} buildings, ${g.cols * g.rows} cells, ${r.hourly.length} hourly masks -> ${ms.toFixed(0)} ms`);
  assert.ok(ms < 6000, `sun-field exceeds CI performance allowance: ${ms} ms`);
}

console.log("v2 sun-field: ok");

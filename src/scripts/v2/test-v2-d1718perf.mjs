/** P4 D17·D18 지형 격자 공유·성능 회귀. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { readManifest, openDataFile } = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d17 } = await import("../../lib/v2/tile/d17/engine.ts");
const { d18 } = await import("../../lib/v2/tile/d18/engine.ts");
const { demGridFor, demReader } = await import("../../lib/v2/engine/tiles/terrain-shared.ts");
const { bandPolygons, contourLines, gridStats } = await import("../../lib/v2/engine/tiles/raster-grid.ts");
const terrainGrid = await import("../../lib/v2/engine/tiles/terrain-grid.ts");

const CENTER = [127.1506, 37.6245];
const RADIUS_M = 800;
const ANALYSIS_DATE = "2026-10-01";
const RELIEF_BREAKS = [-20, -5, 5, 20];
const RELIEF_LAYERS = ["relief_lt_m20", "relief_m20_m5", "relief_m5_5", "relief_5_20", "relief_ge20"];
const SLOPE_BREAKS = [5, 10, 15, 20];
const SLOPE_LAYERS = ["slope_0_5", "slope_5_10", "slope_10_15", "slope_15_20", "slope_ge20"];

const dataDir = mkdtempSync(join(tmpdir(), "v2-d1718-perf-"));
await buildEngineFixture(dataDir, "v1", { terrain: true });

function context(id) {
  const manifest = readManifest(dataDir);
  assert.ok(manifest, "fixture manifest");
  const core = openDataFile(dataDir, manifest, "core");
  return new EngineContext(dataDir, manifest, id, {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: RADIUS_M,
    analysisDate: ANALYSIS_DATE,
    pnu: null,
  }, { core });
}

function relativeGrid(grid, originZ) {
  return { ...grid, values: Float64Array.from(grid.values, (value) => Number.isFinite(value) ? value - originZ : Number.NaN) };
}

function valuesInCircle(grid, radiusM) {
  const values = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const x = grid.x0 + col * grid.cellM;
      const y = grid.y0 + row * grid.cellM;
      if (Math.hypot(x - grid.cx, y - grid.cy) > radiusM + 1e-9) continue;
      const value = grid.values[row * grid.cols + col];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

/** v2-int D18의 중앙차분 기준선. */
function legacySlopeGrid(dem) {
  const values = new Float64Array(dem.values.length);
  values.fill(Number.NaN);
  for (let row = 1; row < dem.rows - 1; row += 1) {
    for (let col = 1; col < dem.cols - 1; col += 1) {
      const west = dem.values[row * dem.cols + col - 1];
      const east = dem.values[row * dem.cols + col + 1];
      const south = dem.values[(row - 1) * dem.cols + col];
      const north = dem.values[(row + 1) * dem.cols + col];
      if (![west, east, south, north].every(Number.isFinite)) continue;
      const dzdx = (east - west) / (2 * dem.cellM);
      const dzdy = (north - south) / (2 * dem.cellM);
      values[row * dem.cols + col] = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
    }
  }
  for (const row of [0, dem.rows - 1]) {
    for (let col = 0; col < dem.cols; col += 1) {
      const sourceRow = row === 0 ? 1 : dem.rows - 2;
      const candidate = values[sourceRow * dem.cols + Math.min(dem.cols - 2, Math.max(1, col))];
      if (Number.isFinite(candidate)) values[row * dem.cols + col] = candidate;
    }
  }
  for (const col of [0, dem.cols - 1]) {
    for (let row = 1; row < dem.rows - 1; row += 1) {
      const sourceCol = col === 0 ? 1 : dem.cols - 2;
      const candidate = values[row * dem.cols + sourceCol];
      if (Number.isFinite(candidate)) values[row * dem.cols + col] = candidate;
    }
  }
  return { ...dem, values };
}

function legacyD17Artifacts(ctx) {
  const reader = demReader(ctx);
  const dem = demGridFor(ctx, 30);
  assert.ok(reader && dem);
  const absolute = valuesInCircle(dem, RADIUS_M);
  const center = reader.elevation(...CENTER);
  const origin = center ?? median(absolute);
  const relative = relativeGrid(dem, origin);
  return {
    stats: gridStats(relative, RADIUS_M),
    bands: bandPolygons(CENTER, RADIUS_M, relative, RELIEF_BREAKS, RELIEF_LAYERS, "dem_nodata"),
    lines: contourLines(CENTER, RADIUS_M, dem, 5, "contour"),
  };
}

function legacyD18Artifacts(ctx) {
  const dem = demGridFor(ctx, 30);
  assert.ok(dem);
  const slope = legacySlopeGrid(dem);
  return {
    slope,
    stats: gridStats(slope, RADIUS_M),
    bands: bandPolygons(CENTER, RADIUS_M, slope, SLOPE_BREAKS, SLOPE_LAYERS, "slope_nodata"),
  };
}

function closeEnough(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let i = 0; i < actual.length; i += 1) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `${label}[${i}] ${actual[i]} vs ${expected[i]}`);
  }
}

function candidateCoordinates(candidates) {
  return candidates.map((candidate) => candidate.p ?? candidate.l).map((value) => JSON.stringify(value));
}

function meaningfulPolygons(candidates) {
  return candidates.filter((candidate) => candidate.areaM2 > 0.5);
}

function pointToSegmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function ringHausdorffDistance(actual, expected) {
  const directed = (from, to) => Math.max(...from.map((point) => {
    let best = Number.POSITIVE_INFINITY;
    for (let segment = 1; segment < to.length; segment += 1) best = Math.min(best, pointToSegmentDistance(point, to[segment - 1], to[segment]));
    if (to.length > 1) best = Math.min(best, pointToSegmentDistance(point, to[to.length - 1], to[0]));
    return best;
  }));
  return Math.max(directed(actual, expected), directed(expected, actual));
}

function assertPolygonGeometryClose(actualCandidates, expectedCandidates, label) {
  const actual = meaningfulPolygons(actualCandidates);
  const expected = meaningfulPolygons(expectedCandidates);
  assert.equal(actual.length, expected.length, `${label} count`);
  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(actual[index].p.layer, expected[index].p.layer, `${label}[${index}] layer`);
    assert.ok(Math.abs(actual[index].areaM2 - expected[index].areaM2) <= 1, `${label}[${index}] area`);
    assert.equal(actual[index].p.rings.length, expected[index].p.rings.length, `${label}[${index}] rings`);
    for (let ringIndex = 0; ringIndex < actual[index].p.rings.length; ringIndex += 1) {
      const distance = ringHausdorffDistance(actual[index].p.rings[ringIndex], expected[index].p.rings[ringIndex]);
      assert.ok(distance <= 3e-6, `${label}[${index}] ring ${ringIndex} geometry ${distance}`);
    }
  }
}

// Shared DEM sampling is one Float32 grid per analysis, not one sample pass per tile.
{
  const ctx = context("d1718-regression");
  try {
    const first = terrainGrid.terrainGridFor(ctx, 30);
    const second = terrainGrid.terrainGridFor(ctx, 30);
    assert.ok(first);
    assert.strictEqual(first, second, "D17/D18 shared terrain grid is memoized");
    assert.ok(first.values instanceof Float32Array, "shared terrain grid uses Float32Array");

    const legacy17 = legacyD17Artifacts(ctx);
    const optimizedRelative = terrainGrid.relativeTerrainGrid(first, demReader(ctx).elevation(...CENTER));
    const optimized17Bands = terrainGrid.terrainBandPolygons(CENTER, RADIUS_M, optimizedRelative, RELIEF_BREAKS, RELIEF_LAYERS, "dem_nodata");
    const optimized17Lines = terrainGrid.terrainContourLines(CENTER, RADIUS_M, first, 5, "contour");
    closeEnough(optimized17Bands.areaM2, legacy17.bands.areaM2, 1, "D17 band area");
    assertPolygonGeometryClose(optimized17Bands.polygons, legacy17.bands.polygons, "D17 polygons");
    assert.deepEqual(candidateCoordinates(optimized17Lines), candidateCoordinates(legacy17.lines), "D17 contours");

    const legacy18 = legacyD18Artifacts(ctx);
    const optimizedSlope = terrainGrid.slopeGrid(first);
    const optimizedClassSlope = optimizedSlope.classificationValues;
    assert.ok(optimizedClassSlope, "D18 legacy-compatible class slope");
    const finiteSlope = [];
    for (let index = 0; index < optimizedSlope.values.length; index += 1) {
      const actual = optimizedSlope.values[index];
      const expected = legacy18.slope.values[index];
      if (Number.isFinite(expected)) {
        assert.ok(Number.isFinite(actual), `D18 slope finite at ${index}`);
        assert.ok(Number.isFinite(optimizedClassSlope[index]), `D18 class slope finite at ${index}`);
        assert.ok(Math.abs(optimizedClassSlope[index] - expected) <= 1e-9, `D18 class slope regression at ${index}`);
        finiteSlope.push(Math.abs(actual - expected));
      } else {
        assert.ok(!Number.isFinite(actual), `D18 slope nodata at ${index}`);
        assert.ok(!Number.isFinite(optimizedClassSlope[index]), `D18 class slope nodata at ${index}`);
      }
    }
    console.log(`D18 Horn-vs-legacy slope max delta=${Math.max(...finiteSlope).toFixed(6)}°`);
    const optimized18Bands = terrainGrid.terrainBandPolygons(CENTER, RADIUS_M, optimizedSlope, SLOPE_BREAKS, SLOPE_LAYERS, "slope_nodata");
    closeEnough(optimized18Bands.areaM2, legacy18.bands.areaM2, 1, "D18 band area");
    assertPolygonGeometryClose(optimized18Bands.polygons, legacy18.bands.polygons, "D18 polygons");

    const tile17 = d17(ctx);
    const tile18 = d18(ctx);
    const tile18Metrics = new Map(tile18.metrics.map((metric) => [metric.id, metric.value]));
    const legacySlopeValues = valuesInCircle(legacy18.slope, RADIUS_M);
    assert.ok(Math.abs(tile18Metrics.get("slope_median_deg") - median(legacySlopeValues)) <= 1e-9, "D18 median output");
    assert.ok(Math.abs(tile18Metrics.get("slope_max_deg") - Math.max(...legacySlopeValues)) <= 1e-9, "D18 max output");
    assert.equal(tile17.status, "complete");
    assert.equal(tile18.status, "complete");
    assert.ok(tile17.presentation.lines.length > 0);
    assert.ok(tile18.presentation.polygons.length > 0);
  } finally {
    ctx.close();
  }
}

function medianMs(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

function measure(label, compute) {
  const values = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const ctx = context(`d1718-perf-${label}-${iteration}`);
    try {
      const started = performance.now();
      const tile = compute(ctx);
      const elapsed = performance.now() - started;
      assert.equal(tile.status, "complete", `${label} status`);
      values.push(elapsed);
    } finally {
      ctx.close();
    }
  }
  const median = medianMs(values);
  console.log(`${label} perf: ${values.map((value) => value.toFixed(1)).join(" / ")} ms; median ${median.toFixed(1)} ms`);
  return { values, median };
}

// Keep the old path measurable in the same run so the report can show the actual before/after delta.
const legacy17Perf = measure("D17 legacy", (ctx) => {
  legacyD17Artifacts(ctx);
  return { status: "complete" };
});
const legacy18Perf = measure("D18 legacy", (ctx) => {
  legacyD18Artifacts(ctx);
  return { status: "complete" };
});
const optimized17Perf = measure("D17 optimized", (ctx) => d17(ctx));
const optimized18Perf = measure("D18 optimized", (ctx) => d18(ctx));
assert.ok(optimized17Perf.median <= 300, `D17 median ${optimized17Perf.median.toFixed(1)} ms exceeds 300 ms budget`);
assert.ok(optimized18Perf.median <= 300, `D18 median ${optimized18Perf.median.toFixed(1)} ms exceeds 300 ms budget`);

if (process.env.P4_VISUAL === "1") {
  const { createElement } = await import("react");
  const React = await import("react");
  globalThis.React = React;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
  const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
  const requireMain = createRequire("D:/V-coding/16-SiteAnalysis/package.json");
  const sharp = requireMain("D:/V-coding/16-SiteAnalysis/node_modules/sharp");
  const visualDir = process.env.P4_VISUAL_DIR ?? join(tmpdir(), "site-analysis-p4-d1718perf");
  mkdirSync(visualDir, { recursive: true });
  const ctx = context("d1718-visual");
  try {
    for (const [code, tile] of [["D17", d17(ctx)], ["D18", d18(ctx)]]) {
      const view = toTileView(tile);
      const svg = renderToStaticMarkup(createElement(MapFigure, {
        model: view.map,
        width: 1200,
        height: 800,
        basemap: "none",
        fixed: true,
        label: `우리 v2 · ${code} ${code === "D17" ? "지형·등고선" : "경사도"}`,
      }));
      const output = join(visualDir, `${code.toLowerCase()}-ours.png`);
      await sharp(Buffer.from(svg)).png().toFile(output);
      console.log(`${code} visual: ${output}`);
    }
    const reference = "D:/V-coding/16-SiteAnalysis/.worktrees/v2-p4-d1718perf/docs/design/sitedia-2026-10-01/panels-13-24.png";
    const label = (text, width, height, fill = "#0F172A") => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#FFFFFF"/><text x="18" y="${height - 13}" fill="${fill}" font-family="Arial, sans-serif" font-size="22" font-weight="700">${text}</text></svg>`);
    const ours17 = await sharp(join(visualDir, "d17-ours.png")).resize(430, 540, { fit: "contain", background: "#F8FAFC" }).png().toBuffer();
    const ours18 = await sharp(join(visualDir, "d18-ours.png")).resize(430, 540, { fit: "contain", background: "#F8FAFC" }).png().toBuffer();
    const referencePane = await sharp(reference).resize(880, 600, { fit: "contain", background: "#FFFFFF" }).png().toBuffer();
    const compare = await sharp({ create: { width: 1840, height: 700, channels: 3, background: "#F8FAFC" } })
      .composite([
        { input: label("우리 v2", 900, 50), left: 0, top: 0 },
        { input: label("sitedia 캡처", 900, 50), left: 920, top: 0 },
        { input: label("D17 지형·등고선", 430, 42), left: 10, top: 55 },
        { input: ours17, left: 10, top: 97 },
        { input: label("D18 경사도", 430, 42), left: 460, top: 55 },
        { input: ours18, left: 460, top: 97 },
        { input: referencePane, left: 920, top: 55 },
      ])
      .png()
      .toBuffer();
    const comparePath = join(visualDir, "d1718-ours-compare.png");
    await sharp(compare).toFile(comparePath);
    console.log(`D17/D18 visual compare: ${comparePath} (우리 v2 panels; reference crop: sitedia 캡처)`);
  } finally {
    ctx.close();
  }
}

console.log(`✓ v2 D17/D18 terrain-grid performance (${legacy17Perf.median.toFixed(1)}→${optimized17Perf.median.toFixed(1)} ms; ${legacy18Perf.median.toFixed(1)}→${optimized18Perf.median.toFixed(1)} ms)`);

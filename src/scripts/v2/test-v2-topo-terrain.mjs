import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { buildScene } = await import("../../lib/v2/engine/scene.ts");
const { demReader, demSources, terrainCellM, topoTerrainLimitation } = await import("../../lib/v2/engine/tiles/terrain-shared.ts");
const { terrainGridFor, slopeGridFor } = await import("../../lib/v2/engine/tiles/terrain-grid.ts");
const { d17 } = await import("../../lib/v2/tile/d17/engine.ts");
const { d18 } = await import("../../lib/v2/tile/d18/engine.ts");
const { d29 } = await import("../../lib/v2/tile/d29/engine.ts");
const { s01 } = await import("../../lib/v2/tile/s01/engine.ts");
const { s02 } = await import("../../lib/v2/tile/s02/engine.ts");
const { s03 } = await import("../../lib/v2/tile/s03/engine.ts");
const { TopoDemReader } = await import("../../lib/v2/topo/dem.ts");
const { LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");

const BASELINE_HASHES = {
  D17: "71d58ac52570d71703262d133604b00a2b4ede45ce09a521081f59f8802b688e",
  D18: "05cd00f2fe70bb30de9b562ec4bf3346e2b320e3d78d020969a8b585fe48627c",
  D29: "253f79378578a536d38a805c4f6222b6238f47947e72ca65a541552918f39dc5",
  S01: "7096241cd92a2281fe81c2424e77da39215ecd0b4a62ea5e977dce832c654f2e",
  // 2026-10-27: provenance에 terrain_tiles 기록 추가로 갱신(값 계산은 동일).
  S02: "1ed4816fa938f936e5621ae34ff798ff99416053a644a6e5297b6729853d0017",
  S03: "2444261cf7a4ea714574e2102da4b6f2a3e3527433a558fa2a327d963455a89b",
  scene: "a09661a192a021ffe8833ac7de3a9786a4207823c293a75309eeaa8108219967",
};

const ADDRESS = "경기도 남양주시 다산동 100";
const ANALYSIS_DATE = "2026-10-01";
const RADIUS_M = 800;

function jsonSha(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function openContext(dataDir, id, center, radiusM, topo = null, { weather = false } = {}) {
  const manifest = M.readManifest(dataDir);
  const core = M.openDataFile(dataDir, manifest, "core");
  const buildings = M.openDataFile(dataDir, manifest, "buildings");
  const handles = { core, buildings };
  if (manifest.files.parcels) handles.parcels = M.openDataFile(dataDir, manifest, "parcels");
  if (weather && manifest.files.weather) handles.weather = M.openDataFile(dataDir, manifest, "weather");
  return new EngineContext(dataDir, manifest, id, {
    address: ADDRESS,
    center,
    radiusM,
    analysisDate: ANALYSIS_DATE,
    pnu: null,
  }, handles, { topo });
}

function coneDem(center, halfSpanM = 1_200, cellM = 5) {
  const [cx, cy] = toUtmk(center);
  const x0 = cx - halfSpanM;
  const y0 = cy - halfSpanM;
  const cols = Math.ceil((2 * halfSpanM) / cellM);
  const rows = cols;
  const values = new Float32Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = x0 + (col + 0.5) * cellM;
      const y = y0 + (row + 0.5) * cellM;
      values[row * cols + col] = 100 - Math.hypot(x - cx, y - cy) / 10;
    }
  }
  return {
    reader: new TopoDemReader({ x0, y0, cellM, cols, rows, values }),
    bbox: [x0, y0, x0 + cols * cellM, y0 + rows * cellM],
  };
}

function coverageRing(bbox) {
  const [minX, minY, maxX, maxY] = bbox;
  return [
    toLngLat([minX, minY]),
    toLngLat([maxX, minY]),
    toLngLat([maxX, maxY]),
    toLngLat([minX, maxY]),
    toLngLat([minX, minY]),
  ];
}

function retainingHit(center) {
  const [cx, cy] = toUtmk(center);
  return {
    featureId: 901,
    stableId: "topo-fixture:retaining:1",
    kind: "topo_retaining",
    releaseId: "topo-fixture",
    name: null,
    pnu: null,
    legalCode: null,
    properties: { heightM: 4.2, kind: "retaining_wall" },
    geometry: {
      type: "LineString",
      coordinates: [[cx - 180, cy - 100], [cx + 180, cy - 100]],
    },
    distanceM: 100,
  };
}

function topoHandle(center, radiusM, { dem, bbox, hits = [] }) {
  const summary = {
    crs: "EPSG:5179",
    bboxUtmk: bbox,
    coverageWgs84: coverageRing(bbox),
    counts: { topo_retaining: hits.length },
    demCells: dem ? dem.gridCells ?? 1 : 0,
    buildingFloorsOnePct: null,
  };
  const [minX, minY, maxX, maxY] = bbox;
  return {
    sha256: "a".repeat(64),
    summary,
    source: {
      sourceId: "ngii_topo",
      releaseId: "ngii_topo@aaaaaaaaaaaa",
      sourceAsOf: null,
      fetchedAt: "2026-10-17T00:00:00.000Z",
    },
    hits(kinds) {
      return hits.filter((hit) => kinds.includes(hit.kind));
    },
    covers(x, y) {
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    },
    dem: dem?.reader ?? null,
  };
}

async function fixtureData() {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-t4-topo-terrain-"));
  await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true, terrain: true });
  return dataDir;
}

// Baseline fixture was generated at HEAD 2bdb40c before this test or any Task 4 edit.
{
  const dataDir = await fixtureData();
  const ctx = openContext(dataDir, "t4-baseline-no-topo", CENTER, RADIUS_M);
  try {
    assert.equal(ctx.topo, null);
    const values = { D17: d17(ctx), D18: d18(ctx), S01: s01(ctx), scene: buildScene(ctx) };
    for (const [key, value] of Object.entries(values)) {
      assert.equal(jsonSha(value), BASELINE_HASHES[key], `no-topo ${key} must remain byte-identical to HEAD 2bdb40c`);
    }
  } finally {
    ctx.close();
  }
}

// D29/S02/S03 also consume the shared DEM reader downstream. Their no-topo
// JSON hashes were captured from the same fixture at HEAD 2bdb40c.
{
  const dataDir = await fixtureData();
  const ctx = openContext(dataDir, "t4-baseline-d29-s02", CENTER, RADIUS_M);
  try {
    const values = { D29: d29(ctx), S02: s02(ctx) };
    for (const [key, value] of Object.entries(values)) {
      assert.equal(jsonSha(value), BASELINE_HASHES[key], `no-topo ${key} must remain byte-identical to HEAD 2bdb40c`);
    }
  } finally {
    ctx.close();
  }
}

{
  const dataDir = mkdtempSync(join(tmpdir(), "v2-t4-topo-s03-"));
  await buildEngineFixture(dataDir, "s03", { buildings: true, weather: true });
  const ctx = openContext(dataDir, "t4-baseline-s03", CENTER, RADIUS_M, null, { weather: true });
  try {
    assert.equal(jsonSha(s03(ctx)), BASELINE_HASHES.S03, "no-topo S03 must remain byte-identical to HEAD 2bdb40c");
  } finally {
    ctx.close();
  }
}

// A 5 m cone plus one retaining wall exercises the topo branch and the D17 additions.
{
  const dataDir = await fixtureData();
  const cone = coneDem(CENTER);
  const ctx = openContext(dataDir, "t4-topo-cone", CENTER, RADIUS_M, {
    ...topoHandle(CENTER, RADIUS_M, { dem: cone, bbox: cone.bbox, hits: [retainingHit(CENTER)] }),
  });
  try {
    assert.equal(terrainCellM(ctx), 5);
    assert.equal(terrainGridFor(ctx, terrainCellM(ctx))?.cellM, 5);
    assert.equal(slopeGridFor(ctx, 5)?.cellM, 5, "D18 slope grid uses the topo 5 m cell");

    const reader = demReader(ctx);
    assert.ok(reader);
    assert.equal(reader.resolution(), 5);
    assert.ok((reader.elevation(...CENTER) ?? Number.NaN) > 90);
    assert.deepEqual(demSources(ctx).map((source) => source.sourceId), ["ngii_topo", "terrain_tiles"]);

    const d17Tile = d17(ctx);
    assert.equal(d17Tile.provenance.sources[0].sourceId, "ngii_topo");
    assert.ok(d17Tile.limitations.some((limitation) => limitation.note === topoTerrainLimitation.note));
    assert.ok(!d17Tile.limitations.some((limitation) => limitation.note.includes("30m 격자 보간선")));
    assert.ok(d17Tile.presentation.lines?.some((line) => line.layer === "retaining_wall"));
    assert.equal(d17Tile.presentation.lines?.find((line) => line.layer === "retaining_wall")?.name, "옹벽 4.2m");
    assert.equal(d17Tile.metrics.find((metric) => metric.id === "retaining_count")?.value, 1);
    assert.equal(d17Tile.presentation.polygons?.filter((polygon) => polygon.layer === "topo_coverage").length, 1);
    assert.equal(LAYER_STYLES.topo_coverage.color, "#2350b8");
    assert.equal(LAYER_STYLES.topo_coverage.dash, "10 6");
    assert.equal(LAYER_STYLES.topo_coverage.label, "수치지형도 범위 · 밖은 기존 자료");
    assert.equal(LAYER_STYLES.contour.color, "#8a5a2e");

    const d18Tile = d18(ctx);
    assert.ok(d18Tile.provenance.sources.some((source) => source.sourceId === "ngii_topo"));
    assert.ok(d18Tile.limitations.some((limitation) => limitation.note === topoTerrainLimitation.note));

    const scene = buildScene(ctx);
    assert.ok(scene?.ground.kind === "dem");
    assert.equal(scene.ground.resolutionM, 5);
    assert.equal(scene.ground.sourceId, "ngii_topo");
  } finally {
    ctx.close();
  }
}

// The DEM reader can be present while the analysis-center coverage policy
// intentionally stays at the 30 m cell when the topo bbox misses the center.
{
  const dataDir = await fixtureData();
  const cone = coneDem(CENTER);
  const seamBbox = cone.bbox.map((value) => value + 1_300);
  const ctx = openContext(dataDir, "t4-topo-outside-center", CENTER, RADIUS_M, topoHandle(CENTER, RADIUS_M, { dem: cone, bbox: seamBbox }));
  try {
    assert.equal(terrainCellM(ctx), 30, "coverage outside the analysis center keeps the 30 m cell");
  } finally {
    ctx.close();
  }
}

// A topo handle without a DEM must fall through to the published GLO-30 reader.
{
  const dataDir = await fixtureData();
  const baseline = openContext(dataDir, "t4-glo-baseline", CENTER, RADIUS_M);
  const expected = demReader(baseline)?.elevation(...CENTER);
  baseline.close();
  const cone = coneDem(CENTER);
  const ctx = openContext(dataDir, "t4-topo-no-dem", CENTER, RADIUS_M, topoHandle(CENTER, RADIUS_M, { dem: null, bbox: cone.bbox }));
  try {
    const reader = demReader(ctx);
    assert.ok(reader);
    assert.equal(reader.resolution(), 5);
    assert.equal(reader.elevation(...CENTER), expected, "topo.dem=null falls back to GLO-30");
  } finally {
    ctx.close();
  }
}

// Task 4 performance gate: radius 1 km, 5 m DEM, D17 + D18 together <= 1.5 s.
{
  const dataDir = await fixtureData();
  const cone = coneDem(CENTER, 1_200, 5);
  const ctx = openContext(dataDir, "t4-topo-perf", CENTER, 1_000, topoHandle(CENTER, 1_000, { dem: cone, bbox: cone.bbox }));
  try {
    assert.equal(terrainCellM(ctx), 5);
    const started = performance.now();
    const d17Tile = d17(ctx);
    const d18Tile = d18(ctx);
    const elapsedMs = performance.now() - started;
    assert.equal(d17Tile.status, "complete");
    assert.equal(d18Tile.status, "complete");
    assert.ok(elapsedMs <= 1_500, `D17+D18 5m perf ${elapsedMs.toFixed(1)}ms exceeds 1500ms`);
    console.log(`D17+D18 topo 5m perf: ${elapsedMs.toFixed(1)}ms / 1km radius (budget 1500ms)`);
  } finally {
    ctx.close();
  }
}

console.log("✓ v2 topo terrain");

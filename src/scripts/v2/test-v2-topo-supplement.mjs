import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";

const Database = (await import("better-sqlite3")).default;
const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { buildScene } = await import("../../lib/v2/engine/scene.ts");
const { d02 } = await import("../../lib/v2/tile/d02/engine.ts");
const { d03 } = await import("../../lib/v2/tile/d03/engine.ts");
const { d04 } = await import("../../lib/v2/tile/d04/engine.ts");
const { d05 } = await import("../../lib/v2/tile/d05/engine.ts");
const { d06 } = await import("../../lib/v2/tile/d05/d06.ts");
const { d07 } = await import("../../lib/v2/tile/d05/d07.ts");
const { d10 } = await import("../../lib/v2/tile/d10/engine.ts");
const { d16 } = await import("../../lib/v2/tile/d16/engine.ts");
const { s01 } = await import("../../lib/v2/tile/s01/engine.ts");
const { buildingRows } = await import("../../lib/v2/engine/tiles/buildings-shared.ts");
const { TOPO_AFFECTED_TILES } = await import("../../lib/v2/topo/context.ts");

const BASELINE_HASHES = {
  D02: "11f4bb0f56fa4da13f8e0b6a09162fca9f273f6c0f753fc882c6104dc1cec2c3",
  D03: "53e3271b3aa34b387fc08bd19859a74ebfb77b4d4e9d0c5f01b7574a80ceeab6",
  D04: "61bd348315ccf5ae67e70a03bcc979319a23f8e6a6f7725e43841b26dbe6ec91",
  D05: "2db2b61b84bc60579ff713d5feabdbca4d64d5b173e0fff559314cb3ceacf437",
  D06: "ba6dea03bc92765463d56fa84ff35ec809cee81bbbf285d741b4f689f8ca32c9",
  D07: "3449042e8d029aa49a2368ae872151646740ffdc33166d0f4af54c3bc39e41c9",
  D10: "d6713c1843d3eb6bf270ba51a18573d8afa2cb786dd3650b34be15c1d204585c",
  D16: "61edc5ebc98a921c31de55b381f14f2a954f00e9e6bcab48188b543ebfae8317",
  S01: "aff5b8d52517cf3355f406d7b96dbe42b27f6eda07de8f9ba8049d78d4966a2e",
  scene: "5b65b2ce8f6341e9b980bdf4619f202888c93b6d8db258b89e1abcbc773f8640",
};

const TILE_FACTORIES = { D02: d02, D03: d03, D04: d04, D05: d05, D06: d06, D07: d07, D10: d10, D16: d16, S01: s01 };
const BUILDING_DEPENDENT_TILES = ["D02", "D03", "D04", "D05", "D06", "D07", "D16", "D29", "S01", "S02", "S03", "S04"];
const RELEASE_ID = "ngii_topo@0123456789ab";
const [CENTER_X, CENTER_Y] = toUtmk(CENTER);
const SITE = { pnus: [], geometry: null, kind: "address" };

function sha(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rectangle(cx, cy, width, height = width) {
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  return { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] };
}

function coverageFor(bbox) {
  const [minX, minY, maxX, maxY] = bbox;
  return [toLngLat([minX, minY]), toLngLat([maxX, minY]), toLngLat([maxX, maxY]), toLngLat([minX, maxY]), toLngLat([minX, minY])];
}

function topoHit(featureId, geometry, properties = {}, kind = "topo_building") {
  return {
    featureId,
    stableId: `ngii_topo:${kind}:${featureId}`,
    kind,
    releaseId: RELEASE_ID,
    name: null,
    pnu: null,
    legalCode: null,
    properties,
    geometry,
    distanceM: null,
  };
}

function topoHandle(hits, bbox = [CENTER_X - 2_000, CENTER_Y - 2_000, CENTER_X + 2_000, CENTER_Y + 2_000]) {
  const byKind = new Map();
  for (const hit of hits) {
    const list = byKind.get(hit.kind) ?? [];
    list.push(hit);
    byKind.set(hit.kind, list);
  }
  return {
    sha256: "0".repeat(64),
    summary: { crs: "EPSG:5179", bboxUtmk: bbox, coverageWgs84: coverageFor(bbox), counts: {}, demCells: 0, buildingFloorsOnePct: null },
    source: { sourceId: "ngii_topo", releaseId: RELEASE_ID, sourceAsOf: null, fetchedAt: "2026-10-17T00:00:00.000Z" },
    hits(kinds) {
      return kinds.flatMap((kind) => byKind.get(kind) ?? []).sort((a, b) => a.featureId - b.featureId);
    },
    covers(x, y) {
      return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
    },
    dem: null,
  };
}

function openContext(dataDir, id, topo = null, radiusM = 800) {
  const manifest = M.readManifest(dataDir);
  const handles = {
    core: M.openDataFile(dataDir, manifest, "core"),
    buildings: M.openDataFile(dataDir, manifest, "buildings"),
    parcels: M.openDataFile(dataDir, manifest, "parcels"),
  };
  return new EngineContext(dataDir, manifest, id, {
    address: "fixture",
    center: CENTER,
    radiusM,
    analysisDate: "2026-10-01",
    pnu: null,
    site: SITE,
  }, handles, { topo });
}

function replaceBuildingsWithMinimalFixture(dataDir) {
  const dbPath = join(dataDir, "versions", "v1", "buildings.sqlite");
  const db = new Database(dbPath);
  try {
    db.exec("DELETE FROM building_fact; DELETE FROM feature_rtree; DELETE FROM feature;");
    const releaseId = db.prepare("SELECT release_id FROM source_release WHERE source_id = 'building' LIMIT 1").pluck().get();
    const insertFact = db.prepare(`INSERT INTO building_fact
      (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
      VALUES (?, NULL, ?, ?, ?, NULL, ?, NULL, NULL, ?, '{}')`);
    const add = (stableId, cx, cy, size, heightM, method, floors, useCode) => {
      const featureId = insertFeature(db, {
        stableId,
        kind: "building",
        sourceKey: stableId,
        releaseId,
        geometry: rectangle(cx, cy, size),
        geometryIsUtmk: true,
        name: stableId,
      });
      insertFact.run(featureId, heightM, method, floors, useCode, size * size);
    };
    add("building:existing-null-floor", CENTER_X, CENTER_Y, 20, 8, "source", null, "02000");
    add("building:existing-five-floor", CENTER_X + 100, CENTER_Y, 20, 15, "source", 5, "03000");
  } finally {
    db.close();
  }
}

function addDenseExistingBuildings(dataDir, count) {
  const dbPath = join(dataDir, "versions", "v1", "buildings.sqlite");
  const db = new Database(dbPath);
  try {
    const releaseId = db.prepare("SELECT release_id FROM source_release WHERE source_id = 'building' LIMIT 1").pluck().get();
    const insertFact = db.prepare(`INSERT INTO building_fact
      (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
      VALUES (?, NULL, 6, 'source', 2, NULL, '02000', NULL, NULL, 64, '{}')`);
    const insert = db.transaction(() => {
      for (let index = 0; index < count; index += 1) {
        const col = index % 150;
        const row = Math.floor(index / 150);
        const cx = CENTER_X - 700 + col * 9.25;
        const cy = CENTER_Y - 450 + row * 9.25;
        const stableId = `building:perf:${index}`;
        const featureId = insertFeature(db, {
          stableId,
          kind: "building",
          sourceKey: stableId,
          releaseId,
          geometry: rectangle(cx, cy, 8),
          geometryIsUtmk: true,
          name: null,
        });
        insertFact.run(featureId);
      }
    });
    insert();
  } finally {
    db.close();
  }
}

function denseTopoHits(count) {
  return Array.from({ length: count }, (_, index) => {
    const col = index % 150;
    const row = Math.floor(index / 150);
    const cx = CENTER_X - 700 + col * 9.25;
    const cy = CENTER_Y - 450 + row * 9.25;
    return topoHit(10_000 + index, rectangle(cx, cy, 8), { floorsAbove: 2 });
  });
}

async function buildFixture(options = { buildings: true, parcels: true, terrain: true, landuse: true }) {
  const root = mkdtempSync(join(tmpdir(), "v2-t6-topo-supplement-"));
  const dataDir = join(root, "data");
  await buildEngineFixture(dataDir, "v1", options);
  return { root, dataDir };
}

const { root: baselineRoot, dataDir: baselineData } = await buildFixture();
try {
  for (const [code, factory] of Object.entries(TILE_FACTORIES)) {
    const ctx = openContext(baselineData, `baseline-${code}`);
    try {
      assert.equal(sha(factory(ctx)), BASELINE_HASHES[code], `no-topo ${code} must remain byte-identical to HEAD 01e8932`);
    } finally {
      ctx.close();
    }
  }
  const sceneCtx = openContext(baselineData, "baseline-scene");
  try {
    assert.equal(sha(buildScene(sceneCtx)), BASELINE_HASHES.scene, "no-topo scene must remain byte-identical to HEAD 01e8932");
  } finally {
    sceneCtx.close();
  }
} finally {
  // The fixture directory is intentionally left to the process cleanup below.
}

for (const code of BUILDING_DEPENDENT_TILES) {
  assert.ok(TOPO_AFFECTED_TILES.includes(code), `${code} reaches buildingRows directly or indirectly and must be topo-cache scoped`);
}

const { root: minimalRoot, dataDir: minimalData } = await buildFixture({ buildings: true, parcels: true });
try {
  replaceBuildingsWithMinimalFixture(minimalData);
  const existingNull = rectangle(CENTER_X, CENTER_Y, 20);
  const existingValue = rectangle(CENTER_X + 100, CENTER_Y, 20);
  const topoBuildings = [
    topoHit(101, existingNull, { floorsAbove: 5 }),
    topoHit(102, rectangle(CENTER_X + 250, CENTER_Y, 10), { floorsAbove: 1 }),
    topoHit(103, rectangle(CENTER_X + 300, CENTER_Y, 10), { floorsAbove: 4 }),
    topoHit(104, rectangle(CENTER_X + 14, CENTER_Y, 10), { nmly: 3 }),
  ];
  const topo = topoHandle(topoBuildings);
  const ctx = openContext(minimalData, "t6-building-supplement", topo);
  try {
    const rows = buildingRows(ctx);
    assert.ok(rows);
    assert.equal(rows.length, 5, "overlapping topo building fills a row; three non-duplicate buildings are appended");
    const filled = rows.find((row) => row.hit.featureId === 1 || row.hit.stableId === "building:existing-null-floor");
    assert.ok(filled);
    assert.equal(filled.floorsAbove, 5, "topo nmly fills a missing existing floor count");
    assert.equal(filled.heightMethod, "floors_estimate");
    assert.equal(filled.heightM, 15);
    const existing = rows.find((row) => row.hit.stableId === "building:existing-five-floor");
    assert.ok(existing);
    assert.equal(existing.floorsAbove, 5, "existing floor value is never overwritten");
    const oneFloor = rows.find((row) => row.hit.featureId === 102);
    assert.ok(oneFloor);
    assert.equal(oneFloor.heightMethod, "assumed_one_floor");
    assert.equal(oneFloor.floorsAbove, 1);
    assert.equal(oneFloor.heightM, 3);
    const fourFloor = rows.find((row) => row.hit.featureId === 103);
    assert.ok(fourFloor);
    assert.equal(fourFloor.heightMethod, "floors_estimate");
    assert.equal(fourFloor.floorsAbove, 4);
    assert.equal(fourFloor.heightM, 12);
    const coverageEdge = rows.find((row) => row.hit.featureId === 104);
    assert.ok(coverageEdge, "intersection/topoArea < 0.2 is a new row even when the bboxes touch");
    assert.equal(coverageEdge.heightMethod, "floors_estimate");
    assert.equal(coverageEdge.floorsAbove, 3);
    assert.equal(coverageEdge.heightM, 9);
    assert.equal(fourFloor.hit.releaseId, RELEASE_ID, "topo row remains traceable to the topo release");
    for (const row of rows) {
      assert.equal(typeof row.rawHeightMethod, "string");
      assert.ok(["source", "ledger_height", "floors_estimate", "user", "unknown"].includes(row.rawHeightMethod));
      assert.ok(row.hit.geometry.type === "Polygon" || row.hit.geometry.type === "MultiPolygon");
    }
    const d02Tile = d02(ctx);
    assert.equal(d02Tile.provenance.sources.at(-1)?.sourceId, "ngii_topo", "D02 appends topo source only after supplement is applied");
  } finally {
    ctx.close();
  }
  const earlySourceCtx = openContext(minimalData, "t6-building-source-before-rows", topo);
  try {
    assert.equal(d04(earlySourceCtx).provenance.sources.at(-1)?.sourceId, "ngii_topo", "D04 source captured before buildingRows still receives the applied topo source last");
  } finally {
    earlySourceCtx.close();
  }
  const duplicateOnlyCtx = openContext(minimalData, "t6-building-no-op", topoHandle([topoHit(105, existingNull, { floorsAbove: 1 })]));
  try {
    assert.notEqual(d02(duplicateOnlyCtx).provenance.sources.at(-1)?.sourceId, "ngii_topo", "duplicate topo buildings that add no row or floor do not add a topo source");
  } finally {
    duplicateOnlyCtx.close();
  }
} finally {
  // Each fixture uses a unique temp directory.
}

const { root: waterRoot, dataDir: waterData } = await buildFixture();
try {
  const waterRects = [
    rectangle(CENTER_X, CENTER_Y - 400, 300, 60),
    rectangle(CENTER_X + 180, CENTER_Y - 400, 60, 60),
  ];
  const waterTopo = topoHandle(waterRects.map((geometry, index) => topoHit(100 + index, geometry, { kind: "water" }, "topo_water")));
  const ctx = openContext(waterData, "t6-water-supplement", waterTopo);
  try {
    const tile = d10(ctx);
    assert.ok(tile.presentation.polygons?.some((polygon) => polygon.layer === "water"), "topo water is appended as layer water");
    assert.equal(tile.provenance.sources.at(-1)?.sourceId, "ngii_topo", "D10 appends topo source last when topo water is applied");
    const metric = tile.metrics.find((candidate) => candidate.id === "osm_water_pct");
    assert.ok(metric);
    assert.equal(metric.numerator, 21_600, "water area metric uses union, not OSM plus duplicated topo area");
    assert.ok(tile.presentation.layers?.includes("water"));
  } finally {
    ctx.close();
  }
} finally {
  // Each fixture uses a unique temp directory.
}

const { root: perfRoot, dataDir: perfData } = await buildFixture({ buildings: true, parcels: true });
try {
  const density = 15_000;
  addDenseExistingBuildings(perfData, density);
  const noTopo = openContext(perfData, "t6-perf-no-topo", null, 1_000);
  let noTopoMs;
  try {
    const started = performance.now();
    d02(noTopo);
    d03(noTopo);
    noTopoMs = performance.now() - started;
  } finally {
    noTopo.close();
  }
  const topo = topoHandle(denseTopoHits(density));
  const withTopo = openContext(perfData, "t6-perf-topo", topo, 1_000);
  let topoMs;
  try {
    const started = performance.now();
    d02(withTopo);
    d03(withTopo);
    topoMs = performance.now() - started;
  } finally {
    withTopo.close();
  }
  assert.ok(topoMs <= noTopoMs * 2, `D02+D03 topo perf ${topoMs.toFixed(1)}ms exceeds 2x no-topo ${noTopoMs.toFixed(1)}ms`);
  console.log(`D02+D03 perf: no-topo ${noTopoMs.toFixed(1)}ms, topo ${topoMs.toFixed(1)}ms / 1km radius (${density.toLocaleString("en-US")} topo buildings)`);
} finally {
  // Each fixture uses a unique temp directory.
}

void [baselineRoot, minimalRoot, waterRoot, perfRoot];
console.log("✓ v2 topo supplement");

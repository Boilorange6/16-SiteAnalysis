/** OSM 녹지·수계 면 분류·적재·fixture·성능 계약 테스트. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const {
  OSM_GREEN_LAYERS,
  OSM_LANDUSE_SOURCE_ID,
  OSM_WATER_LAYERS,
  OSM_WATER_SOURCE_ID,
  GREEN_CLASSES,
  buildOsmAreas,
  greenClassOf,
  waterClassOf,
} = await import("../../lib/v2/ingest/sources/osm-landuse.ts");

assert.deepEqual(GREEN_CLASSES, ["forest", "park", "grass", "orchard"]);
assert.deepEqual(OSM_GREEN_LAYERS, ["gis_osm_landuse_a_free_1", "gis_osm_natural_a_free_1"]);
assert.deepEqual(OSM_WATER_LAYERS, ["gis_osm_water_a_free_1"]);
assert.equal(OSM_WATER_SOURCE_ID, "osm_water");

assert.equal(greenClassOf("wood"), "forest");
assert.equal(greenClassOf(" forest "), "forest");
assert.equal(greenClassOf("residential"), null);
assert.equal(greenClassOf("vineyard"), "orchard");
assert.equal(waterClassOf("riverbank"), "water");
assert.equal(waterClassOf("wetland"), "wetland");
assert.equal(waterClassOf("basin"), "water");
assert.equal(waterClassOf("reservoir"), "water");
assert.equal(waterClassOf("park"), null);

const rect = (x0, x1, y0, y1) => ({
  type: "Polygon",
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});
const centerRect = (dx, dy, width = 0.001) => {
  const [lng, lat] = CENTER;
  return rect(lng + dx - width / 2, lng + dx + width / 2, lat + dy - width / 2, lat + dy + width / 2);
};

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const landuseRelease = insertRelease(db, {
  sourceId: OSM_LANDUSE_SOURCE_ID,
  provider: "test",
  sourceUrl: "https://example.invalid/osm",
  sourceAsOf: "2026-09-29",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "fixture-landuse",
  licenseCode: "ODbL-1.0",
});
const waterRelease = insertRelease(db, {
  sourceId: OSM_WATER_SOURCE_ID,
  provider: "test",
  sourceUrl: "https://example.invalid/osm",
  sourceAsOf: "2026-09-29",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "fixture-water",
  licenseCode: "ODbL-1.0",
});

async function* landuseRecords() {
  yield { properties: { osm_id: "forest-1", fclass: "wood", name: "시험 숲", layer: OSM_GREEN_LAYERS[1] }, geometry: centerRect(0, 0) };
  yield { properties: { osm_id: "park-1", fclass: "park", name: "시험 공원", layer: OSM_GREEN_LAYERS[0] }, geometry: centerRect(0.002, 0) };
  yield { properties: { osm_id: "residential-1", fclass: "residential", name: "비대상 시가지", layer: OSM_GREEN_LAYERS[0] }, geometry: centerRect(0, 0.002) };
  yield { properties: { osm_id: "bad-geometry", fclass: "forest", name: "도형 없음", layer: OSM_GREEN_LAYERS[0] }, geometry: null };
  yield { properties: { osm_id: "park-1", fclass: "park", name: "중복", layer: OSM_GREEN_LAYERS[0] }, geometry: centerRect(0.003, 0) };
  yield { properties: { osm_id: "multi-1", fclass: "meadow", name: null, layer: OSM_GREEN_LAYERS[1] }, geometry: {
    type: "MultiPolygon",
    coordinates: [centerRect(0.004, 0.001).coordinates, centerRect(0.005, 0.001).coordinates],
  } };
}

const landuseStats = await buildOsmAreas(db, landuseRecords(), landuseRelease, "landuse");
assert.deepEqual([landuseStats.received, landuseStats.accepted, landuseStats.rejected], [6, 3, 3]);
assert.deepEqual(landuseStats.byType, { forest: 1, park: 1, grass: 1 });
assert.equal(landuseStats.snapshot().fillRates.name, 2 / 3);

async function* waterRecords() {
  yield { properties: { osm_id: "river-1", fclass: "riverbank", name: "시험 하천", layer: OSM_WATER_LAYERS[0] }, geometry: rect(127.149, 127.152, 37.6239, 37.6245) };
  yield { properties: { osm_id: "wetland-1", fclass: "wetland", name: "시험 습지", layer: OSM_WATER_LAYERS[0] }, geometry: rect(127.149, 127.152, 37.625, 37.626) };
  yield { properties: { osm_id: "reservoir-1", fclass: "reservoir", name: null, layer: OSM_WATER_LAYERS[0] }, geometry: rect(127.149, 127.152, 37.621, 37.622) };
  yield { properties: { osm_id: "park-2", fclass: "park", name: "비대상", layer: OSM_WATER_LAYERS[0] }, geometry: rect(127.149, 127.152, 37.62, 37.621) };
}

const waterStats = await buildOsmAreas(db, waterRecords(), waterRelease, "water");
assert.deepEqual([waterStats.received, waterStats.accepted, waterStats.rejected], [4, 3, 1]);
assert.deepEqual(waterStats.byType, { water: 2, wetland: 1 });

const forest = db.prepare("SELECT stable_id, kind, name, properties_json FROM feature WHERE stable_id = ?").get("osm:gis_osm_natural_a_free_1:forest-1");
assert.ok(forest);
assert.deepEqual([forest.kind, forest.name], ["landuse", "시험 숲"]);
assert.deepEqual(JSON.parse(forest.properties_json), {
  osmId: "forest-1",
  fclass: "wood",
  cls: "forest",
  name: "시험 숲",
  layer: OSM_GREEN_LAYERS[1],
});
assert.equal(db.prepare("SELECT COUNT(*) FROM feature WHERE kind = 'landuse'").pluck().get(), 3);
assert.equal(db.prepare("SELECT COUNT(*) FROM feature WHERE kind = 'water'").pluck().get(), 3);
assert.equal(queryFeaturesInRadius(db, CENTER, 500, ["landuse"]).length, 3);
assert.equal(queryFeaturesInRadius(db, CENTER, 500, ["water"]).length, 3);
db.close();

// options.landuse is the shared engine fixture contract used by later P4 tasks.
const fixtureDir = mkdtempSync(join(tmpdir(), "v2-osm-landuse-fixture-"));
await buildEngineFixture(fixtureDir, "v1", { landuse: true });
const manifest = M.readManifest(fixtureDir);
const reference = M.openDataFile(fixtureDir, manifest, "reference");
assert.equal(reference.prepare("SELECT COUNT(*) FROM feature WHERE kind = 'landuse'").pluck().get(), 3);
assert.equal(reference.prepare("SELECT COUNT(*) FROM feature WHERE kind = 'water'").pluck().get(), 1);
assert.equal(queryFeaturesInRadius(reference, CENTER, 800, ["landuse"]).length, 3);
assert.equal(queryFeaturesInRadius(reference, CENTER, 800, ["water"]).length, 1);
assert.equal(reference.prepare("SELECT rights_json FROM source_release WHERE source_id = 'osm_landuse'").pluck().get() !== undefined, true);
reference.close();

// Performance budget: 500 valid polygon records in an in-memory reference file ≤ 1.5s.
const perfDb = new Database(":memory:");
initDataFileSchema(perfDb, "reference");
const perfRelease = insertRelease(perfDb, {
  sourceId: OSM_LANDUSE_SOURCE_ID,
  provider: "test",
  sourceUrl: "https://example.invalid/osm",
  sourceAsOf: "2026-09-29",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "fixture-performance",
  licenseCode: "ODbL-1.0",
});
async function* perfRecords() {
  for (let i = 0; i < 500; i++) {
    const lng = 127.14 + (i % 25) * 0.0004;
    const lat = 37.615 + Math.floor(i / 25) * 0.0004;
    yield { properties: { osm_id: `perf-${i}`, fclass: i % 2 === 0 ? "forest" : "park", name: null, layer: OSM_GREEN_LAYERS[0] }, geometry: rect(lng, lng + 0.0002, lat, lat + 0.0002) };
  }
}
const started = performance.now();
const perfStats = await buildOsmAreas(perfDb, perfRecords(), perfRelease, "landuse");
const elapsedMs = performance.now() - started;
assert.equal(perfStats.accepted, 500);
assert.ok(elapsedMs <= 1500, `OSM 면 적재 성능 예산 초과: ${elapsedMs.toFixed(1)}ms > 1500ms`);
console.log(`osm landuse performance: ${elapsedMs.toFixed(1)}ms / 500 polygons (budget 1500ms)`);
perfDb.close();

console.log("✓ v2 OSM landuse/water");

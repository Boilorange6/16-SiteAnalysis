import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease, SourceStats } = await import("../../lib/v2/ingest/build.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { buildOsmRoads, OSM_ROADS_RIGHTS, ROAD_HIERARCHIES, roadHierarchy } = await import("../../lib/v2/ingest/sources/osm-roads.ts");
const { crsFromPrj } = await import("../../lib/v2/ingest/shp.ts");
const { lineLengthInCircle } = await import("../../lib/v2/engine/tiles/geo.ts");
const { d13 } = await import("../../lib/v2/engine/tiles/d13.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const M = await import("../../lib/v2/data/manifest.ts");

assert.equal(crsFromPrj('GEOGCS["WGS 84",DATUM["WGS_1984"],UNIT["degree",0.0174532925199433]]'), "EPSG:4326");
assert.deepEqual(
  ["motorway", "motorway_link", "trunk_link", "primary", "secondary_link", "tertiary", "residential", "track", "mystery"].map(roadHierarchy),
  ["고속도로", "고속도로", "간선", "간선", "보조간선", "집산", "국지", "보행·자전거", "기타"],
);
assert.ok(ROAD_HIERARCHIES.includes("기타"));

const CENTER = [127.1506, 37.6245];
const [cx, cy] = toUtmk(CENTER);
const at = (dx, dy = 0) => [...toLngLat([cx + dx, cy + dy])];
const line = (osmId, fclass, a, b, extra = {}) => ({
  properties: { osm_id: osmId, code: 5111, fclass, name: `도로-${osmId}`, ref: `R-${osmId}`, oneway: "B", maxspeed: "50", layer: 0, bridge: "F", tunnel: "F", ...extra },
  geometry: { type: "LineString", coordinates: [at(...a), at(...b)] },
});

// ── loader fixture: 계층 분류·미상 보존·속성·SourceStats ─────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "reference");
  const release = insertRelease(db, {
    sourceId: "osm_roads",
    provider: "Geofabrik test",
    sourceUrl: "https://example.invalid/osm",
    sourceAsOf: "2026-09-29",
    fetchedAt: "2026-10-01T00:00:00Z",
    checksum: "fixture",
    licenseCode: "ODbL-1.0",
    rights: OSM_ROADS_RIGHTS,
  });
  const records = [
    line("m1", "motorway", [-100, 0], [100, 0]),
    line("p1", "primary_link", [-100, 100], [100, 100], { bridge: "T", tunnel: "F", oneway: "T" }),
    line("t1", "track", [-100, -100], [100, -100]),
    line("u1", "future_unknown", [-100, 200], [100, 200], { name: "미분류 도로", ref: null }),
    { properties: { osm_id: "bad-shape", fclass: "service" }, geometry: null },
  ];
  async function* stream() { yield* records; }
  const stats = await buildOsmRoads(db, stream(), release, { legalCodeOf: () => "4136011800" });
  assert.ok(stats instanceof SourceStats);
  assert.deepEqual([stats.received, stats.accepted, stats.rejected], [5, 4, 1]);
  assert.equal(stats.received, stats.accepted + stats.unlocated + stats.rejected);
  assert.deepEqual(stats.byType, { 고속도로: 1, 간선: 1, "보행·자전거": 1, 기타: 1 });
  assert.deepEqual(stats.byRegion, { 41: 4 });
  const road = db.prepare("SELECT stable_id, kind, name, properties_json FROM feature WHERE stable_id = 'road:p1'").get();
  assert.deepEqual([road.stable_id, road.kind, road.name], ["road:p1", "road", "도로-p1"]);
  const props = JSON.parse(road.properties_json);
  assert.deepEqual([props.hierarchy, props.ref, props.bridge, props.tunnel, props.oneway], ["간선", "R-p1", "T", "F", "T"]);
  assert.equal(queryFeaturesInRadius(db, CENTER, 500, ["road"]).length, 4);
  const rights = JSON.parse(db.prepare("SELECT rights_json FROM source_release WHERE source_id = 'osm_roads'").pluck().get());
  assert.deepEqual([rights.license, rights.attribution], ["ODbL 1.0", "© OpenStreetMap contributors"]);
  db.close();
}

// ── line length: 선분이 원을 가로지르는 구간만 실제 길이로 계산 ───────────────
const across = { type: "LineString", coordinates: [[cx - 1200, cy], [cx + 1200, cy]] };
assert.ok(Math.abs(lineLengthInCircle(CENTER, 800, across) - 1600) < 0.05);
assert.equal(lineLengthInCircle(CENTER, 800, { type: "LineString", coordinates: [[cx + 900, cy], [cx + 1200, cy]] }), 0);

// ── D13 engine fixture: metrics·100% 구성비·최근접 간선 이상·지도 ──────────────
const dataDir = mkdtempSync(join(tmpdir(), "v2-d13-"));
const versionDir = join(dataDir, "versions", "v1");
mkdirSync(versionDir, { recursive: true });
const referencePath = join(versionDir, "reference.sqlite");
{
  const db = new Database(referencePath);
  initDataFileSchema(db, "reference");
  const release = insertRelease(db, {
    sourceId: "osm_roads",
    provider: "Geofabrik test",
    sourceUrl: "https://example.invalid/osm",
    sourceAsOf: "2026-09-29",
    fetchedAt: "2026-10-01T00:00:00Z",
    checksum: "fixture",
    licenseCode: "ODbL-1.0",
    rights: OSM_ROADS_RIGHTS,
  });
  const records = [
    line("motorway-outside", "motorway", [-1200, 1000], [1200, 1000]),
    line("primary", "primary", [-1200, 300], [1200, 300]),
    line("secondary", "secondary", [-1200, -250], [1200, -250]),
    line("tertiary", "tertiary", [-150, -1200], [-150, 1200]),
    line("residential", "residential", [-600, -600], [600, 600]),
    line("footway", "footway", [-700, 0], [700, 0]),
    line("unknown", "motorboat", [0, -700], [0, 700]),
  ];
  async function* stream() { yield* records; }
  const stats = await buildOsmRoads(db, stream(), release);
  db.prepare(`INSERT INTO ingest_run
    (run_id, source_id, started_at, finished_at, status, received_count, accepted_count, rejected_count, release_id, snapshot_json)
    VALUES ('osm_roads:1', 'osm_roads', 'a', 'b', 'succeeded', ?, ?, ?, ?, ?)`).run(
      stats.received,
      stats.accepted,
      stats.rejected,
      release,
      JSON.stringify({ ...stats.snapshot(), unlocated: stats.unlocated }),
    );
  db.close();
}
const manifest = {
  version: "v1",
  createdAt: "2026-10-01T00:00:00Z",
  files: { reference: { path: "versions/v1/reference.sqlite", sha256: await M.sha256File(referencePath), kind: "reference", schemaVersion: 2 } },
};
assert.ok((await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }))).published);
const published = M.readManifest(dataDir);
const ctx = new EngineContext(dataDir, published, "d13-test", {
  address: "테스트",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: null,
});
const tile = d13(ctx);
parseTileResult(tile);
assert.equal(tile.status, "partial");
assert.equal(tile.tileType, "diagram");
assert.equal(tile.provenance.sources[0].sourceId, "osm_roads");
assert.ok(tile.limitations.some((limitation) => limitation.note.includes("© OpenStreetMap contributors") && limitation.note.includes("ODbL 1.0")));
const metric = (id) => tile.metrics.find((item) => item.id === id);
assert.ok(metric("road_length_in_radius_m").value > 0);
assert.equal(metric("nearest_arterial_or_higher_m").value, 300);
const shares = tile.metrics.filter((item) => item.id.startsWith("share_road_"));
assert.equal(shares.length, ROAD_HIERARCHIES.length);
assert.ok(Math.abs(shares.reduce((sum, item) => sum + item.value, 0) - 100) < 1e-9);
assert.ok(shares.every((item) => item.denominator === metric("road_length_in_radius_m").numerator));
assert.ok(tile.presentation.features.length > 0);
assert.ok(tile.presentation.features.some((feature) => feature.layer === "road:간선"));
assert.ok(tile.presentation.features.some((feature) => feature.layer === "road:보행·자전거"));
assert.ok(tile.presentation.features.some((feature) => feature.layer === "road:기타"));
assert.match(toTileView(tile).sourceLine, /OpenStreetMap 도로/);
ctx.close();

const absent = new EngineContext("", { version: "v1", createdAt: "2026-10-01T00:00:00Z", files: {} }, "d13-missing", {
  address: "테스트",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: null,
});
assert.equal(d13(absent).status, "not_provided");
absent.close();

console.log("✓ v2 D13 OSM roads loader and tile");

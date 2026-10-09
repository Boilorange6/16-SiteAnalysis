import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { DEM_NODATA, insertDemTile } = await import("../../lib/v2/data/terrain.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d29 } = await import("../../lib/v2/tile/d29/engine.ts");
const { LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
const { svfFor, SVF_CELL_M } = await import("../../lib/v2/engine/tiles/svf-shared.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");

const CENTER = [127.1506, 37.6245];
const [CX, CY] = toUtmk(CENTER);
const at = (x, y) => toLngLat([CX + x, CY + y]);
const rectangle = (x0, x1, y0, y1) => [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]];

function insertBuilding(db, releaseId, id, x0, x1, y0, y1, heightM = 20, floorsAbove = null) {
  const featureId = insertFeature(db, {
    stableId: `building:${id}`,
    kind: "building",
    sourceKey: id,
    releaseId,
    geometry: { type: "Polygon", coordinates: rectangle(x0, x1, y0, y1) },
    name: id,
  });
  db.prepare(`INSERT INTO building_fact
    (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
    VALUES (?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, '{}')`).run(featureId, heightM, heightM === null ? "unknown" : "source", floorsAbove, (x1 - x0) * (y1 - y0));
}

async function makeFixture({ buildings = null, terrain = true } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-d29-"));
  const version = "v1";
  const versionDir = join(dataDir, "versions", version);
  mkdirSync(versionDir, { recursive: true });
  const files = {};

  if (terrain) {
    const terrainPath = join(versionDir, "terrain.sqlite");
    const terrainDb = new Database(terrainPath);
    initDataFileSchema(terrainDb, "terrain");
    const terrainRelease = insertRelease(terrainDb, {
      sourceId: "terrain_tiles",
      provider: "테스트 DEM",
      sourceUrl: "https://example.invalid/terrain",
      sourceAsOf: "2026-10-01",
      fetchedAt: "2026-10-01T00:00:00Z",
      checksum: "d29-terrain",
      licenseCode: "TEST",
    });
    const meta = {
      tile: "flat",
      lat0: 37.60,
      lon0: 127.12,
      rows: 101,
      cols: 101,
      cellDeg: 0.0005,
      nodata: DEM_NODATA,
      vertical: "EGM2008",
      resolutionM: 30,
    };
    insertDemTile(terrainDb, meta, terrainRelease, Array.from({ length: meta.rows }, (_, row) => {
      const data = Buffer.alloc(meta.cols * 2);
      for (let col = 0; col < meta.cols; col += 1) data.writeInt16BE(0, col * 2);
      return { row, data };
    }));
    terrainDb.close();
    files.terrain = "terrain";
  }

  if (buildings !== null) {
    const buildingsPath = join(versionDir, "buildings.sqlite");
    const db = new Database(buildingsPath);
    initDataFileSchema(db, "buildings");
    const releaseId = insertRelease(db, {
      sourceId: "building",
      provider: "테스트 건물",
      sourceUrl: "https://example.invalid/buildings",
      sourceAsOf: "2026-10-01",
      fetchedAt: "2026-10-01T00:00:00Z",
      checksum: "d29-buildings",
      licenseCode: "TEST",
    });
    for (const building of buildings) insertBuilding(db, releaseId, ...building);
    db.close();
    files.buildings = "buildings";
  }

  const manifest = { version, createdAt: "2026-10-01T00:00:00Z", files: {} };
  for (const kind of Object.values(files)) {
    manifest.files[kind] = {
      path: `versions/${version}/${kind}.sqlite`,
      sha256: await M.sha256File(join(dataDir, `versions/${version}/${kind}.sqlite`)),
      kind,
      schemaVersion: 2,
    };
  }
  const published = await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }));
  assert.equal(published.published, true);
  return dataDir;
}

function makeContext(dataDir, radiusM = 800) {
  return new EngineContext(dataDir, M.readManifest(dataDir), "d29-test", {
    address: "테스트 개방감",
    center: CENTER,
    radiusM,
    analysisDate: "2026-10-01",
    pnu: null,
  });
}

function metric(tile, id) {
  return tile.metrics.find((item) => item.id === id);
}

function indexAt(grid, x, y) {
  const col = Math.round((x - grid.x0) / grid.cellM - 0.5);
  const row = Math.round((y - grid.y0) / grid.cellM - 0.5);
  return row * grid.cols + col;
}

// Two 20 m walls leave a narrow alley at the center. The outer part of the
// same 800 m domain remains open, so both visual extremes are deterministic.
const walls = [
  ["west", -11, -9, -500, 500, 20, 6],
  ["east", 9, 11, -500, 500, 20],
];
const dataDir = await makeFixture({ buildings: walls });
const ctx = makeContext(dataDir);
try {
  const started = performance.now();
  const tile = d29(ctx);
  const elapsed = performance.now() - started;
  parseTileResult(tile);
  assert.ok(["complete", "partial"].includes(tile.status));
  assert.ok(elapsed <= 4000, `D29 performance budget exceeded: ${elapsed.toFixed(0)} ms (target 4s)`);
  console.log(`D29 perf: radius 800m / 2m -> ${elapsed.toFixed(0)} ms`);

  const shared = svfFor(ctx, null);
  assert.ok(shared, "SVF shared result");
  const alley = shared.svf[indexAt(shared.grid, CX, CY)];
  assert.ok(alley < 0.7, `building alley should be closed, got ${alley}`);
  const open = Array.from(shared.svf).reduce((best, value) => Number.isFinite(value) ? Math.max(best, value) : best, 0);
  assert.ok(open > 0.95, `open cells should approach full sky, got ${open}`);

  const shares = [
    "share_svf_lt03_pct",
    "share_svf_03_05_pct",
    "share_svf_05_07_pct",
    "share_svf_ge07_pct",
  ].map((id) => metric(tile, id)?.value);
  assert.ok(shares.every((value) => typeof value === "number"));
  assert.ok(Math.abs(shares.reduce((sum, value) => sum + value, 0) - 100) <= 0.5, `SVF shares ${shares}`);
  assert.ok(metric(tile, "svf_median")?.value >= 0);
  assert.ok(metric(tile, "svf_p10")?.value >= 0);
  assert.ok(metric(tile, "svf_site_median")?.value >= 0);

  const raster = tile.presentation.rasters?.find((item) => item.name === "svf");
  assert.ok(raster, "D29 SVF raster ref");
  assert.equal(raster.kind, "scalar");
  assert.equal(raster.dtype, "u8");
  assert.equal(raster.scale, 1 / 250);
  assert.equal(raster.bands, 1);
  assert.equal(raster.nodata, 255);
  assert.equal(raster.cellM, SVF_CELL_M);
  assert.match(raster.sha256, /^[0-9a-f]{64}$/);
  assert.ok((ctx.takeRasters("D29").find((item) => item.ref.name === "svf")?.blob.length ?? 0) > 0);
  assert.ok(tile.presentation.legend.some((item) => item.label.includes("하늘열림") && item.min === 0 && item.max === 1));
  const westMask = tile.presentation.polygons?.find((polygon) => polygon.name === "west");
  assert.ok(westMask);
  assert.equal(westMask.sublabel, "6층");
  assert.equal(westMask.labelPriority, 0);
  assert.equal(westMask.label, null);
  assert.equal(tile.presentation.legend.find((item) => item.min === null && item.max === null)?.label, LAYER_STYLES.svf_building.label);
  assert.ok(tile.limitations.some((item) => item.note.includes("수목 제외")));
  assert.match(tile.judgment.sentence, /하늘열림 중앙값/);
  assert.match(tile.judgment.sentence, /대지 하늘열림 중앙값 .*반경 800m 하늘열림 중앙값/);
  assert.doesNotMatch(JSON.stringify(tile), /종합|법적 적합|개발 가능|건강 위험 예측/);
} finally {
  ctx.close();
}

// A published buildings file with zero features is a complete open field.
const emptyDir = await makeFixture({ buildings: [] });
const emptyCtx = makeContext(emptyDir, 80);
try {
  const tile = d29(emptyCtx);
  const shared = svfFor(emptyCtx, null);
  assert.equal(tile.status, "complete");
  assert.ok(Array.from(shared.svf).filter(Number.isFinite).every((value) => Math.abs(value - 1) <= 0.01));
  assert.ok(tile.metrics.find((item) => item.id === "svf_median")?.value > 0.99);
} finally {
  emptyCtx.close();
}

// A missing buildings publication is different from a published empty file.
const missingDir = await makeFixture();
const missingCtx = makeContext(missingDir, 80);
try {
  const tile = d29(missingCtx);
  assert.equal(tile.status, "not_provided");
  assert.equal(tile.presentation.rasters, undefined);
} finally {
  missingCtx.close();
}

// Buildings remain useful when GLO-30 is not published: use a flat terrain
// horizon and mark the result partial instead of hiding the building SVF.
const flatDir = await makeFixture({ buildings: walls, terrain: false });
const flatCtx = makeContext(flatDir, 80);
try {
  const tile = d29(flatCtx);
  assert.equal(tile.status, "partial");
  assert.ok(tile.presentation.rasters?.some((item) => item.name === "svf"));
  assert.ok(tile.limitations.some((item) => item.note.includes("평탄면(0°)")));
  assert.ok(tile.limitations.some((item) => item.note.includes("중심 주변 50m")));
  assert.equal(tile.conditions.simulation.terrain, "flat-no-dem");
} finally {
  flatCtx.close();
}

// A raw height/floor unknown is a 3 m obstacle in the engine, while remaining
// separately countable from the SVF result.
const assumedDir = await makeFixture({ buildings: [["assumed", 100, 110, 100, 110, null]] });
const assumedCtx = makeContext(assumedDir, 80);
try {
  const tile = d29(assumedCtx);
  assert.equal(metric(tile, "assumed_one_floor_buildings")?.value, 1);
  assert.equal(tile.conditions.simulation.assumedOneFloorBuildings, 1);
  assert.ok(tile.limitations.some((item) => item.note.includes("높이·층수 자료가 없는 건물 1동(100%)은 1층(3 m)으로 가정")));
} finally {
  assumedCtx.close();
}

console.log("✓ v2 D29 sky-view-factor tile");

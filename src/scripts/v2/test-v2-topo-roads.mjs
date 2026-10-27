import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JSZip = (await import("jszip")).default;
const Database = (await import("better-sqlite3")).default;
const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { BASE_X, BASE_Y, buildFixture } = await import("./topo-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { toLngLat } = await import("../../lib/v2/crs.ts");
const { openV2AppDb } = await import("../../lib/v2/app-db.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { buildScene } = await import("../../lib/v2/engine/scene.ts");
const { d13 } = await import("../../lib/v2/tile/d13/engine.ts");
const { d15 } = await import("../../lib/v2/tile/d15/engine.ts");
const { putTopoUpload } = await import("../../lib/v2/topo/upload.ts");
const { topoHandleFor } = await import("../../lib/v2/topo/context.ts");
const { mergedRoadLines, topoFrontageWidthM, widthBand } = await import("../../lib/v2/engine/tiles/topo-roads.ts");
const { LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");

const BASELINE_HASHES = {
  D13: "849aa2e3c8ff423b31022383476b9c409c69db79f72b63d2ad1136214f73865a",
  D15: "25a6b0d25cb9466815d35bd64555e3996ff9b0b37f87e3d639c6b83bf8c11e75",
  scene: "0d7a34371e9744dfc0bf63c6054d3e8456a9d7f65723f3b7957ef2d53a658147", // 2026-10-27 벡터 바탕지도 Task 1: 장면 맥락층 optional 필드(name·greenKinds·places) 추가로 갱신
};

const RADIUS_M = 800;
const PERF_RADIUS_M = 1_000;
const USER_ID = 17;
const CENTER = toLngLat([BASE_X, BASE_Y]);
const SITE = {
  pnus: [],
  geometry: {
    type: "Polygon",
    coordinates: [[[BASE_X - 40, BASE_Y - 150], [BASE_X + 40, BASE_Y - 150], [BASE_X + 40, BASE_Y + 50], [BASE_X - 40, BASE_Y + 50], [BASE_X - 40, BASE_Y - 150]]],
  },
  kind: "polygon",
};

function roadRecord(id, points, hierarchy) {
  return {
    stableId: `road:${id}`,
    kind: "road",
    sourceKey: id,
    geometry: { type: "LineString", coordinates: points.map(([x, y]) => [BASE_X + x, BASE_Y + y]) },
    geometryIsUtmk: true,
    properties: { hierarchy, name: null },
  };
}

function addFixtureFeatures(dataDir) {
  const manifest = M.readManifest(dataDir);
  const add = (key, sourceId, records) => {
    const db = new Database(join(dataDir, manifest.files[key].path));
    const releaseId = db.prepare("SELECT release_id FROM source_release WHERE source_id = ? LIMIT 1").get(sourceId).release_id;
    for (const record of records) insertFeature(db, { ...record, releaseId });
    db.close();
  };
  add("reference", "osm_roads", [
    roadRecord("arterial-outside", [[-600, 300], [600, 300]], "간선"),
    roadRecord("edge-crossing", [[-600, 50], [600, 50]], "국지"),
    roadRecord("block-bottom", [[-400, -400], [400, -400]], "국지"),
    roadRecord("block-top", [[-400, 400], [400, 400]], "국지"),
    roadRecord("block-left", [[-400, -400], [-400, 400]], "국지"),
    roadRecord("block-right", [[400, -400], [400, 400]], "국지"),
    roadRecord("walk-crossing", [[0, -600], [0, 600]], "보행·자전거"),
  ]);
  add("buildings", "building", [{
    stableId: "building:base",
    kind: "building",
    sourceKey: "building:base",
    geometry: { type: "Polygon", coordinates: [[[BASE_X - 30, BASE_Y - 30], [BASE_X + 30, BASE_Y - 30], [BASE_X + 30, BASE_Y + 30], [BASE_X - 30, BASE_Y + 30], [BASE_X - 30, BASE_Y - 30]]] },
    geometryIsUtmk: true,
    name: "기준 건물",
    properties: {},
  }]);
}

async function fixtureZip() {
  const sourceDir = mkdtempSync(join(tmpdir(), "v2-topo-roads-zip-"));
  try {
    buildFixture(sourceDir);
    const zip = new JSZip();
    for (const name of readdirSync(sourceDir)) zip.file(name, readFileSync(join(sourceDir, name)));
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(sourceDir, { recursive: true, force: true });
  }
}

function openContext(dataDir, id, center = CENTER, radiusM = RADIUS_M, topo = null) {
  const manifest = M.readManifest(dataDir);
  const handles = {
    core: M.openDataFile(dataDir, manifest, "core"),
    buildings: M.openDataFile(dataDir, manifest, "buildings"),
    parcels: M.openDataFile(dataDir, manifest, "parcels"),
  };
  return new EngineContext(dataDir, manifest, id, {
    address: "fixture",
    center,
    radiusM,
    analysisDate: "2026-10-01",
    pnu: null,
    site: SITE,
  }, handles, { topo });
}

function lineParts(geometry) {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates.flat();
  return [];
}

function pointInsideTopoBbox([x, y], bbox) {
  return x > bbox[0] + 1e-7 && x < bbox[2] - 1e-7 && y > bbox[1] + 1e-7 && y < bbox[3] - 1e-7;
}

function assertOsmOutsideTopoBbox(lines, bbox) {
  for (const line of lines.filter((candidate) => candidate.source === "osm_roads")) {
    for (const part of lineParts(line.geometry)) {
      for (let index = 1; index < part.length; index += 1) {
        const midpoint = [(part[index - 1][0] + part[index][0]) / 2, (part[index - 1][1] + part[index][1]) / 2];
        assert.equal(pointInsideTopoBbox(midpoint, bbox), false, "OSM 선은 topo bbox 내부에 남으면 안 됨");
      }
    }
  }
}

function metric(tile, id) {
  return tile.metrics.find((item) => item.id === id);
}

function sha(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertNoTopoBaseline(dataDir) {
  const ctx = openContext(dataDir, "t5-baseline");
  try {
    assert.equal(ctx.topo, null);
    assert.equal(sha(d13(ctx)), BASELINE_HASHES.D13, "D13 no-topo output must remain byte-identical to HEAD 4f12d76");
    assert.equal(sha(d15(ctx)), BASELINE_HASHES.D15, "D15 no-topo output must remain byte-identical to HEAD 4f12d76");
    assert.equal(sha(buildScene(ctx)), BASELINE_HASHES.scene, "scene no-topo output must remain byte-identical to HEAD 4f12d76");
  } finally {
    ctx.close();
  }
}

const root = mkdtempSync(join(tmpdir(), "v2-topo-roads-"));
const dataDir = join(root, "data");
const appDb = openV2AppDb(join(root, "app.sqlite"));

try {
  assert.equal(widthBand(12), "12+");
  assert.equal(widthBand(7.9), "4-8");
  assert.equal(widthBand(8), "8-12");
  assert.equal(widthBand(4), "4-8");
  assert.equal(widthBand(null), "<4", "null width uses the explicit unknown/<4 fallback");

  const widthStyles = ["road:width:12+", "road:width:8-12", "road:width:4-8", "road:width:<4"].map((layer) => LAYER_STYLES[layer]);
  assert.ok(widthStyles.every(Boolean), "all topo road width bands must have styles");
  assert.equal(new Set(widthStyles.map((style) => style.color)).size, widthStyles.length, "width bands must not rely on one color");
  assert.ok(widthStyles[0].strokeWidth > widthStyles[1].strokeWidth);
  assert.ok(widthStyles[1].strokeWidth > widthStyles[2].strokeWidth);
  assert.ok(widthStyles[2].strokeWidth > widthStyles[3].strokeWidth);

  await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true, roads: true, landuse: true, terrain: true });
  addFixtureFeatures(dataDir);
  assertNoTopoBaseline(dataDir);

  const upload = await putTopoUpload(appDb, join(root, "upload-data"), await fixtureZip(), USER_ID);
  assert.equal(upload.status, 201);
  const topoId = upload.body.topoId;
  const topoSha256 = appDb.prepare("SELECT sha256 FROM topo_upload WHERE topo_id = ?").get(topoId).sha256;
  const topo = topoHandleFor(appDb, { topo: { id: topoId, sha256: topoSha256 } }, USER_ID);
  assert.ok(topo);

  const ctx = openContext(dataDir, "t5-topo", CENTER, RADIUS_M, topo);
  try {
    const merged = mergedRoadLines(ctx, RADIUS_M);
    const topoRoads = merged.filter((line) => line.source === "ngii_topo");
    const osmRoads = merged.filter((line) => line.source === "osm_roads");
    assert.equal(topoRoads.length, 1);
    assert.equal(topoRoads[0].widthM, 6);
    assert.equal(topoRoads[0].lanes, 2);
    assert.equal(topoRoads[0].hierarchy, null);
    assert.equal(osmRoads.filter((line) => line.hierarchy === "간선").length, 1, "one OSM arterial remains outside topo bbox");
    assert.ok(osmRoads.some((line) => line.hierarchy === "보행·자전거"), "merged input keeps OSM pedestrian lines for D15-only filtering");
    assertOsmOutsideTopoBbox(merged, topo.summary.bboxUtmk);

    assert.equal(topoFrontageWidthM(ctx), 6);
    const d13Topo = d13(ctx);
    assert.equal(d13Topo.presentation.lines?.filter((line) => line.layer === "road:width:4-8").length, 1);
    assert.equal(d13Topo.presentation.lines?.filter((line) => line.layer === "road:간선").length, 1);
    assert.equal(metric(d13Topo, "frontage_width_m")?.value, 6);
    assert.equal(metric(d13Topo, "frontage_width_m")?.label, "접한 도로 폭원(참고)");
    assert.deepEqual(d13Topo.provenance.sources.map((source) => source.sourceId), ["ngii_topo", "osm_roads"]);
    assert.ok(d13Topo.limitations.some((limitation) => limitation.note === "도로 폭원은 수치지형도 중심선 속성(참고)이며 접도 판정이 아닙니다."));

    const d15Topo = d15(ctx);
    assert.deepEqual(d15Topo.provenance.sources.map((source) => source.sourceId), ["ngii_topo", "osm_roads"]);
    assert.ok((d15Topo.presentation.polygons?.length ?? 0) > 0, "D15 still produces block output with merged topo/OSM roads");

    const sceneTopo = buildScene(ctx);
    const topoSceneRoad = sceneTopo?.context?.roads.find((road) => Math.abs(road.widthM - 6) < 1e-9);
    assert.ok(topoSceneRoad, "scene road width must use topo widthM");
  } finally {
    ctx.close();
  }

  const noTopoPerf = openContext(dataDir, "t5-perf-no-topo", CENTER, PERF_RADIUS_M);
  let noTopoMs;
  try {
    const started = performance.now();
    d13(noTopoPerf);
    d15(noTopoPerf);
    noTopoMs = performance.now() - started;
  } finally {
    noTopoPerf.close();
  }

  const perfTopo = topoHandleFor(appDb, { topo: { id: topoId, sha256: topoSha256 } }, USER_ID);
  assert.ok(perfTopo);
  const topoPerf = openContext(dataDir, "t5-perf-topo", CENTER, PERF_RADIUS_M, perfTopo);
  let topoMs;
  try {
    const started = performance.now();
    d13(topoPerf);
    d15(topoPerf);
    topoMs = performance.now() - started;
  } finally {
    topoPerf.close();
  }
  assert.ok(topoMs <= noTopoMs * 2, `D13+D15 topo perf ${topoMs.toFixed(1)}ms exceeds 2x no-topo ${noTopoMs.toFixed(1)}ms`);
  console.log(`D13+D15 perf: no-topo ${noTopoMs.toFixed(1)}ms, topo ${topoMs.toFixed(1)}ms / 1km radius (budget <=2x)`);
} finally {
  appDb.close();
  rmSync(root, { recursive: true, force: true });
}

console.log("✓ v2 topo roads");

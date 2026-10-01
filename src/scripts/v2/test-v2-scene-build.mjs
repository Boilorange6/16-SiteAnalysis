import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

const { CENTER, PNU_DASAN_100, buildEngineFixture } = await import("./engine-fixture.mjs");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { openV2AppDb, loadScene } = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { buildScene } = await import("../../lib/v2/engine/scene.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { getScene } = await import("../../lib/v2/engine/api.ts");
const { groundZAt } = await import("../../lib/v2/scene.ts");

const input = { address: "경기도 남양주시 다산동 100", radiusM: 800, analysisDate: "2026-09-30" };
const dataDir = mkdtempSync(join(tmpdir(), "v2-scene-build-"));
const appDb = openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-scene-app-")), "app.sqlite"));

try {
  await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true });
  const outcome = runAnalysis(appDb, dataDir, input);
  assert.equal(outcome.ok, true);

  const scene = loadScene(appDb, outcome.analysisId);
  assert.ok(scene);
  assert.equal(scene.buildings.length, 6, "반경 밖 건물은 장면에서 제외한다");
  assert.equal(scene.parcels.length, 8, "반경 밖 필지는 장면에서 제외한다");
  assert.deepEqual(scene.counts, { buildingsTotal: 6, buildingsIncluded: 6, parcelsTotal: 8, parcelsIncluded: 8 });
  assert.deepEqual(scene.site?.[0], [[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]]);

  const [originX, originY] = toUtmk(CENTER);
  assert.equal(scene.origin.x, originX);
  assert.equal(scene.origin.y, originY);
  assert.equal(scene.origin.epsg, "EPSG:5179");
  assert.equal(scene.origin.lng, CENTER[0]);
  assert.equal(scene.origin.lat, CENTER[1]);

  const allPoints = [
    ...(scene.site ?? []).flat(),
    ...scene.buildings.flatMap((building) => building.rings.flat()),
    ...scene.parcels.flatMap((parcel) => parcel.rings.flat()),
  ];
  assert.ok(allPoints.every(([x, y]) => Math.abs(x) <= 901 && Math.abs(y) <= 901), "장면 좌표는 분석 반경 주변에 있어야 한다");
  assert.equal(scene.buildings.filter((building) => building.heightM === null).length, 2);
  assert.ok(scene.sources.some((source) => source.sourceId === "building"));
  assert.ok(scene.sources.some((source) => source.sourceId === "parcel_polygon"));
  assert.ok(scene.limitations.some((limitation) => limitation.kind === "incomplete"));

  assert.equal(getScene(appDb, "missing").status, 404);
  const apiScene = getScene(appDb, outcome.analysisId);
  assert.equal(apiScene.status, 200);
  assert.deepEqual(apiScene.body, scene);

  const contextDir = mkdtempSync(join(tmpdir(), "v2-scene-context-"));
  await buildEngineFixture(contextDir, "v1", { buildings: true, parcels: true, roads: true, landuse: true });
  const contextOutcome = runAnalysis(appDb, contextDir, { ...input, analysisDate: "2026-10-03" });
  assert.equal(contextOutcome.ok, true);
  const contextScene = loadScene(appDb, contextOutcome.analysisId);
  assert.ok(contextScene?.context, "도로·녹지·수계 자료가 있으면 장면 맥락층을 저장한다");
  assert.equal(contextScene.context.roads.length, 7);
  assert.equal(contextScene.context.green.length, 3);
  assert.equal(contextScene.context.water.length, 1);
  assert.equal(contextScene.context.canopy, undefined, "수관은 무거운 타일이므로 장면에서 기본 비움");
  assert.deepEqual(
    [...new Set(contextScene.context.roads.map((road) => road.widthM))].sort((a, b) => a - b),
    [3, 6],
    "도로 폭은 차로 수가 아니라 hierarchy 고정값을 쓴다",
  );
  assert.ok(contextScene.context.roads.every((road) => road.points.length >= 2));
  assert.ok(contextScene.sources.some((source) => source.sourceId === "osm_roads"));
  assert.ok(contextScene.sources.some((source) => source.sourceId === "osm_landuse"));
  assert.ok(contextScene.sources.some((source) => source.sourceId === "osm_water"));
  const contextPoints = [
    ...contextScene.context.roads.flatMap((road) => road.points),
    ...contextScene.context.green.flatMap((polygon) => polygon.flat()),
    ...contextScene.context.water.flatMap((polygon) => polygon.flat()),
  ];
  assert.ok(contextPoints.every(([x, y]) => Math.hypot(x, y) <= 800.5), "맥락층 좌표는 분석 반경 안으로 절단한다");

  const manifest = M.readManifest(contextDir);
  const core = M.openDataFile(contextDir, manifest, "core");
  const smallContext = new EngineContext(contextDir, manifest, "small-context", {
    address: input.address,
    center: CENTER,
    radiusM: 200,
    analysisDate: input.analysisDate,
    pnu: PNU_DASAN_100,
  }, { core });
  const started = performance.now();
  const smallScene = buildScene(smallContext);
  const elapsedMs = performance.now() - started;
  smallContext.close();
  assert.ok(smallScene?.context);
  assert.ok(smallScene.context.roads.some((road) => road.points.some(([x, y]) => Math.abs(Math.hypot(x, y) - 200) < 1)), "반경을 가로지르는 도로는 경계에서 절단한다");
  assert.equal(smallScene.context.water.length, 0, "반경 밖 수계는 맥락층에서 제외한다");
  assert.ok(smallScene.context.green.length < contextScene.context.green.length, "반경 밖 녹지 면은 맥락층에서 제외한다");
  assert.ok(elapsedMs <= 1500, `장면 맥락층 성능 예산 초과: ${elapsedMs.toFixed(1)}ms > 1500ms`);
  console.log(`scene context performance: ${elapsedMs.toFixed(1)}ms / 200m radius (budget 1500ms)`);

  const terrainDir = mkdtempSync(join(tmpdir(), "v2-scene-terrain-"));
  await buildEngineFixture(terrainDir, "v1", { buildings: true, parcels: true, terrain: true });
  const terrainOutcome = runAnalysis(appDb, terrainDir, { ...input, analysisDate: "2026-10-01" });
  assert.equal(terrainOutcome.ok, true);
  const terrainScene = loadScene(appDb, terrainOutcome.analysisId);
  assert.ok(terrainScene);
  assert.equal(terrainScene.ground.kind, "dem");
  assert.equal(terrainScene.ground.cols, 56);
  assert.equal(terrainScene.ground.rows, 56);
  assert.ok(Math.abs(terrainScene.ground.originZ - 50) <= 0.5);
  const office = terrainScene.buildings.find((building) => building.id === "building:b_office");
  assert.ok(office);
  assert.ok(office.baseZ !== null && Math.abs(office.baseZ - 3.5) <= 0.75, `office baseZ ${office.baseZ}`);
  const unknown = terrainScene.buildings.find((building) => building.id === "building:b_unknown");
  assert.ok(unknown);
  assert.equal(unknown.heightM, null);
  assert.ok(unknown.baseZ !== null, "unknown-height building still gets terrain baseZ");
  const hill = terrainScene.ground.kind === "dem" ? terrainScene.ground.z
    .map((value, index) => value === null ? null : [value, index] )
    .filter((value) => value !== null)
    .reduce((best, value) => value[0] > best[0] ? value : best, [-Infinity, -1]) : null;
  assert.ok(hill && hill[0] > 25, "terrain grid keeps the fixture hill");
  assert.ok(terrainScene.sources.some((source) => source.sourceId === "terrain_tiles"));
  assert.ok(terrainScene.limitations.some((limitation) => limitation.kind === "estimated" && limitation.note.includes("EGM2008")));
  assert.deepEqual(loadScene(appDb, terrainOutcome.analysisId), terrainScene, "DEM scene round-trips through app DB");

  const largeTerrainOutcome = runAnalysis(appDb, terrainDir, { ...input, radiusM: 3000, analysisDate: "2026-10-02" });
  assert.equal(largeTerrainOutcome.ok, true);
  const largeTerrainScene = loadScene(appDb, largeTerrainOutcome.analysisId);
  assert.ok(largeTerrainScene?.ground.kind === "dem");
  const largeOffice = largeTerrainScene.buildings.find((building) => building.id === "building:b_office");
  assert.ok(largeOffice?.baseZ !== null);
  const groundAtOffice = groundZAt(largeTerrainScene.ground, 70, 0);
  assert.ok(groundAtOffice !== null);
  assert.ok(Math.abs(groundAtOffice - largeOffice.baseZ) <= 0.3, `office ground ${groundAtOffice} vs baseZ ${largeOffice.baseZ}`);

  const noBuildingsDir = mkdtempSync(join(tmpdir(), "v2-scene-no-buildings-"));
  await buildEngineFixture(noBuildingsDir, "v1");
  const withoutBuildings = runAnalysis(appDb, noBuildingsDir, { ...input, analysisDate: "2026-10-01" });
  assert.equal(withoutBuildings.ok, true);
  assert.equal(loadScene(appDb, withoutBuildings.analysisId), null, "건물 파일이 없으면 장면을 저장하지 않는다");
} finally {
  appDb.close();
}

const { NextRequest } = await import("next/server");
const { GET } = await import("../../app/api/v2/analyses/[id]/scene/route.ts");
const unauthenticated = await GET(new NextRequest("http://localhost/site/api/v2/analyses/missing/scene"), { params: Promise.resolve({ id: "missing" }) });
assert.equal(unauthenticated.status, 401);

console.log("✓ v2 scene build");

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { CENTER, buildEngineFixture } = await import("./engine-fixture.mjs");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { openV2AppDb, loadScene } = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");
const { getScene } = await import("../../lib/v2/engine/api.ts");

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

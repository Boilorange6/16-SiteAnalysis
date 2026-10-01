/** S02 수광면·정시 그림자·D21 공유 계산 계약. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { s02, sunlightFor } = await import("../../lib/v2/engine/tiles/s02.ts");
const { polygonArea } = await import("../../lib/v2/engine/tiles/geo.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-s02-cuts-"));
await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true });
const manifest = M.readManifest(dataDir);

function makeContext(id, pnu) {
  return new EngineContext(dataDir, manifest, id, {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu,
  });
}

const parcelCtx = makeContext("s02-parcel", PNU_DASAN_100);
try {
  const shared = sunlightFor(parcelCtx);
  assert.ok(shared);
  assert.strictEqual(shared, sunlightFor(parcelCtx), "공유 일조 계산은 ctx 안에서 memoized 되어야 한다");
  assert.equal(shared.siteKind, "parcel");
  assert.equal(shared.site.length, 4, "필지 외곽의 고유 꼭짓점");
  const uniqueSite = shared.site;
  assert.ok(Math.abs(uniqueSite[1][0] - uniqueSite[0][0]) >= 20);
  assert.ok(Math.abs(uniqueSite[2][1] - uniqueSite[1][1]) >= 20);

  const tile = s02(parcelCtx);
  assert.equal(tile.engineVersion, "v2-sim-sun@2");
  assert.equal(tile.conditions.simulation.site, "parcel");
  assert.deepEqual(new Set(tile.presentation.layers), new Set(["shadow_09", "shadow_12", "shadow_15", "sun_face"]));
  assert.ok(tile.presentation.polygons?.some((polygon) => polygon.layer === "sun_face"));
  for (const layer of ["shadow_09", "shadow_12", "shadow_15"]) {
    assert.ok(tile.presentation.polygons?.some((polygon) => polygon.layer === layer), `${layer} 면`);
  }

  const shadowArea = (hour) => shared.shadows[hour].reduce((sum, rings) => sum + polygonArea(rings), 0);
  assert.ok(shadowArea("12") < shadowArea("09"), "9시 그림자가 12시보다 넓어야 한다");
} finally {
  parcelCtx.close();
}

const boxCtx = makeContext("s02-box", null);
try {
  const shared = sunlightFor(boxCtx);
  assert.ok(shared);
  assert.equal(shared.siteKind, "box");
  assert.equal(shared.site.length, 4);
  assert.equal(s02(boxCtx).conditions.simulation.site, "box");
} finally {
  boxCtx.close();
}

console.log("✓ v2 S02 cuts and shared sunlight");

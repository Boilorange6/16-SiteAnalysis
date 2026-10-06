import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d09 } = await import("../../lib/v2/engine/tiles/d09.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

const makeContext = async (options, radiusM = 800) => {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-d09-"));
  await buildEngineFixture(dataDir, "v1", options);
  const manifest = M.readManifest(dataDir);
  return new EngineContext(dataDir, manifest, "d09-test", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM,
    analysisDate: "2026-09-30",
  });
};

// 세 원천이 모두 있으면 공원 점·지목 도형·녹지지역 도형을 각각 계산한다.
{
  const ctx = await makeContext({ parcels: true, zoning: "overlap" });
  try {
    const tile = d09(ctx);
    parseTileResult(tile);
    assert.equal(tile.tileCode, "D09");
    assert.equal(tile.status, "partial");
    assert.equal(value(tile, "parks"), 3, "기존 park 점 p1~p3");
    assert.equal(metric(tile, "parks").unit, "곳");
    assert.equal(metric(tile, "park_area_source_m2").label.includes("반경 교차 아님"), true);
    assert.equal(value(tile, "park_area_source_m2"), 15000);
    assert.deepEqual([metric(tile, "park_area_source_m2").numerator, metric(tile, "park_area_source_m2").denominator], [2, 3]);

    const water = metric(tile, "share_water_pct");
    const greenParcel = metric(tile, "share_green_parcel_pct");
    const greenZone = metric(tile, "share_green_zone_pct");
    assert.equal(water.status, "observed");
    assert.equal(greenParcel.status, "observed");
    assert.equal(greenZone.status, "observed");
    near(water.numerator, 20000, 10, "천 지목 반경 교차면적");
    near(greenParcel.numerator, 40000, 10, "임 지목 반경 교차면적");
    assert.ok(greenZone.numerator > 0, "녹지지역 교차면적");
    assert.equal(metric(tile, "back_other_pct").status, "observed");

    assert.ok(tile.presentation.features.some((f) => f.layer === "park"));
    assert.ok(tile.presentation.polygons.some((p) => p.layer === "green_zone"));
    assert.ok(tile.presentation.polygons.some((p) => p.layer === "water_parcel"));
    assert.ok(tile.presentation.polygons.some((p) => p.layer === "green_parcel"));
    assert.ok(tile.limitations.some((l) => l.note.includes("OSM 수계 자료는 확인하지 못했습니다")));
    assert.ok(tile.limitations.some((l) => l.note.includes("계획 공원")));
    assert.ok(tile.limitations.some((l) => l.note.includes("녹지지역은 지목과 겹칠 수 있어")));
    assert.equal(tile.judgment.level, null);
  } finally {
    ctx.close();
  }
}

// zoning_area 원천이 없으면 녹지지역만 missing이고, park·parcel 지표는 유지한다.
{
  const ctx = await makeContext({ parcels: true });
  try {
    const tile = d09(ctx);
    assert.equal(value(tile, "parks"), 3);
    assert.equal(metric(tile, "share_green_zone_pct").status, "missing");
    assert.equal(metric(tile, "share_water_pct").status, "observed");
    assert.equal(metric(tile, "share_green_parcel_pct").status, "observed");
    assert.equal(metric(tile, "back_other_pct").status, "observed");
  } finally {
    ctx.close();
  }
}

// parcels 파일이 없으면 지목 기반 지표만 missing이고 park·zoning은 유지한다.
{
  const ctx = await makeContext({ zoning: "overlap" });
  try {
    const tile = d09(ctx);
    assert.equal(value(tile, "parks"), 3);
    assert.equal(metric(tile, "share_water_pct").status, "missing");
    assert.equal(metric(tile, "share_green_parcel_pct").status, "missing");
    assert.equal(metric(tile, "back_other_pct").status, "missing");
    assert.equal(metric(tile, "share_green_zone_pct").status, "observed");
  } finally {
    ctx.close();
  }
}

console.log("✓ v2 D09 tile");

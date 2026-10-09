import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d04 } = await import("../../lib/v2/tile/d04/engine.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const metric = (tile, id) => {
  const found = tile.metrics.find((item) => item.id === id);
  assert.ok(found, `${tile.tileCode}: metric ${id}`);
  return found;
};

const context = (dataDir, analysisId) => new EngineContext(
  dataDir,
  M.readManifest(dataDir),
  analysisId,
  { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM: 800, analysisDate: "2026-09-30", pnu: null },
);

// 정상 도형은 발자국만 그려 대표점과의 중복을 만들지 않는다.
const dataDir = mkdtempSync(join(tmpdir(), "v2-d04-years-"));
await buildEngineFixture(dataDir, "v1", { buildings: true });
const ctx = context(dataDir, "d04-years");
try {
  const tile = d04(ctx);
  assert.equal(tile.presentation.polygons.length, 6);
  assert.equal(tile.presentation.featuresTotal, 0, "정상 도형에는 중복 대표점이 없다");
  assert.equal(tile.presentation.features.length, 0);

  // UI 헤더는 반올림된 퍼센트 합이 아니라 세부 metric의 count 합으로 다시 계산한다.
  const rounded = structuredClone(tile);
  for (const [index, id] of ["share_pre1980", "share_1980s", "share_1990s"].entries()) {
    const part = metric(rounded, id);
    Object.assign(part, { value: index < 2 ? 33.3 : 0, numerator: index < 2 ? 1 : 0, denominator: 3 });
  }
  const roundedView = toTileView(rounded);
  assert.equal(roundedView.headlineMetricId, "share_pre2000");
  assert.equal(roundedView.headline?.label, "2000년 이전 준공");
  assert.equal(roundedView.headline?.value, "66.7%");
} finally {
  ctx.close();
}

// 도형 계산에 실패한 건물만 대표점 fallback으로 남긴다.
const fallbackDataDir = mkdtempSync(join(tmpdir(), "v2-d04-years-fallback-"));
await buildEngineFixture(fallbackDataDir, "v1", { buildings: true });
const fallbackDb = new Database(join(fallbackDataDir, "versions", "v1", "buildings.sqlite"));
let unknownId;
try {
  const [cx, cy] = (await import("../../lib/v2/crs.ts")).toUtmk(CENTER);
  const invalidFootprint = {
    type: "Polygon",
    coordinates: [[[cx - 10, cy - 10], [cx + 10, cy - 10], [cx, cy + 10]]],
  };
  unknownId = fallbackDb.prepare("SELECT feature_id FROM feature WHERE stable_id = ?").get("building:b_unknown").feature_id;
  fallbackDb.prepare("UPDATE feature SET geom_json = ? WHERE stable_id = ?").run(JSON.stringify(invalidFootprint), "building:b_unknown");
} finally {
  fallbackDb.close();
}
const fallbackCtx = context(fallbackDataDir, "d04-years-fallback");
try {
  const fallback = d04(fallbackCtx);
  assert.equal(fallback.presentation.polygons.length, 5);
  assert.equal(fallback.presentation.featuresTotal, 1);
  assert.equal(fallback.presentation.features[0].fid, String(unknownId));
  assert.equal(fallback.presentation.features[0].layer, "bldg_2000s");
} finally {
  fallbackCtx.close();
}

console.log("✓ v2 D04 years tile");

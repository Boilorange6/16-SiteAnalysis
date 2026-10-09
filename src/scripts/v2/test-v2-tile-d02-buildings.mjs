import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const Database = (await import("better-sqlite3")).default;
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { d02 } = await import("../../lib/v2/tile/d02/engine.ts");
const { d02ClientModule } = await import("../../lib/v2/tile/d02/view.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const metric = (tile, id) => {
  const found = tile.metrics.find((m) => m.id === id);
  assert.ok(found, `metric ${id}`);
  return found;
};

const context = (dataDir, manifest, analysisId) => new EngineContext(dataDir, manifest, analysisId, {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: PNU_DASAN_100,
});

// buildings 파일이 있으면 반경과 교차하는 6동과 발자국 면적을 모두 계산한다.
const dataDir = mkdtempSync(join(tmpdir(), "v2-d02-"));
await buildEngineFixture(dataDir, "v1", { buildings: true });
const manifest = M.readManifest(dataDir);
const ctx = context(dataDir, manifest, "d02-test");
try {
  const result = d02(ctx);
  assert.equal(result.status, "partial");
  assert.equal(metric(result, "buildings").value, 6);
  assert.equal(metric(result, "back_buildings").value, 6);

  const geometry = metric(result, "fill_geometry_pct");
  assert.equal(geometry.value, 100);
  assert.equal(geometry.numerator, 6);
  assert.equal(geometry.denominator, 6);

  const footprint = metric(result, "share_footprint_pct");
  assert.ok(Math.abs(footprint.numerator - 1069) <= 2, `footprint numerator ${footprint.numerator}`);
  assert.equal(footprint.denominator, Math.round(Math.PI * 800 ** 2));
  assert.equal(metric(result, "share_non_building_pct").value, 99.9);

  assert.equal(result.presentation.polygons.length, 6);
  assert.equal(result.presentation.polygonsTotal, 6);
  assert.equal(result.presentation.featuresTotal, 0, "면이 있는 정상 도형에는 대표점이 없다");
  assert.equal(result.presentation.features.length, 0, "정상 도형 건물은 대표점 fallback을 만들지 않는다");
  assert.ok(result.presentation.polygons.every((p) => p.layer === "bldg_footprint"));
  assert.ok(result.presentation.polygons.every((p) => p.label !== null), "모든 건물 면은 높이와 무관하게 이름을 보존한다");
  assert.ok(result.presentation.polygons.some((p) => p.label === "b_unknown"), "높이 미상 건물도 이름을 보존한다");
  assert.ok(result.limitations.some((l) => l.kind === "estimated" && l.note.includes("발자국 겹침")));
  assert.ok(result.limitations.some((l) => l.note.includes("완전성")));

  const view = toTileView(result);
  assert.equal(view.hasFace, true);
  assert.equal(view.map.polygons.length, 6);
  assert.ok(!/도보|\d\s*분|종합/.test(JSON.stringify(view)));
} finally {
  ctx.close();
}

// 도형 계산에 실패한 건물만 대표점 fallback으로 남긴다.
const fallbackDataDir = mkdtempSync(join(tmpdir(), "v2-d02-fallback-"));
await buildEngineFixture(fallbackDataDir, "v1", { buildings: true });
const fallbackDb = new Database(join(fallbackDataDir, "versions", "v1", "buildings.sqlite"));
let unknownId;
try {
  const [cx, cy] = toUtmk(CENTER);
  const invalidFootprint = {
    type: "Polygon",
    coordinates: [[[cx - 10, cy - 10], [cx + 10, cy - 10], [cx, cy + 10]]],
  };
  unknownId = fallbackDb.prepare("SELECT feature_id FROM feature WHERE stable_id = ?").get("building:b_unknown").feature_id;
  fallbackDb.prepare("UPDATE feature SET geom_json = ? WHERE stable_id = ?").run(JSON.stringify(invalidFootprint), "building:b_unknown");
} finally {
  fallbackDb.close();
}
const fallbackCtx = context(fallbackDataDir, M.readManifest(fallbackDataDir), "d02-fallback");
try {
  const fallback = d02(fallbackCtx);
  const fallbackGeometry = metric(fallback, "fill_geometry_pct");
  assert.equal(fallbackGeometry.numerator, 5, "실패한 도형은 유효 도형 수에서 빠진다");
  assert.equal(fallbackGeometry.denominator, 6);
  assert.equal(fallback.presentation.polygons.length, 5);
  assert.equal(fallback.presentation.featuresTotal, 1, "실패한 도형만 대표점 fallback으로 남긴다");
  assert.equal(fallback.presentation.features[0].fid, String(unknownId));
  assert.equal(fallback.presentation.features[0].layer, "bldg_point");
} finally {
  fallbackCtx.close();
}

// 대표 좌표조차 없는 malformed 도형은 점 fallback을 생략하되 타일은 계속 산출한다.
const malformedCtx = context(dataDir, M.readManifest(dataDir), "d02-malformed");
const originalMalformedHits = malformedCtx.hits.bind(malformedCtx);
malformedCtx.hits = (key, kinds, radiusM) => originalMalformedHits(key, kinds, radiusM).map((hit) => hit.stableId === "building:b_unknown"
  ? { ...hit, geometry: { type: "GeometryCollection", geometries: [] } }
  : hit);
try {
  const malformed = d02(malformedCtx);
  assert.equal(malformed.presentation.polygons.length, 5);
  assert.equal(malformed.presentation.featuresTotal, 0, "대표 좌표가 없으면 점 fallback을 생략한다");
} finally {
  malformedCtx.close();
}

assert.equal(d02ClientModule.mapNote, undefined, "높이 미상 테두리-only mapNote를 제거한다");

// buildings 파일이 게시되지 않으면 SQL 예외가 아니라 not_provided 결과를 낸다.
const absentDir = mkdtempSync(join(tmpdir(), "v2-d02-absent-"));
await buildEngineFixture(absentDir, "v1");
const absentCtx = context(absentDir, M.readManifest(absentDir), "d02-absent");
try {
  const absent = d02(absentCtx);
  assert.equal(absent.status, "not_provided");
  assert.equal(absent.limitations[0].kind, "not_provided");
} finally {
  absentCtx.close();
}

console.log("✓ v2 D02 building tile");

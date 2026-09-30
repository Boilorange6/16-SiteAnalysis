import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d02 } = await import("../../lib/v2/engine/tiles/d02.ts");
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
  assert.equal(result.presentation.featuresTotal, 6);
  assert.ok(result.presentation.polygons.every((p) => p.layer === "bldg_footprint"));
  assert.ok(result.presentation.features.every((f) => f.layer === "bldg_point"));
  assert.ok(result.presentation.polygons.some((p) => p.label === null), "높이 미상 건물은 면 라벨 없음");
  assert.ok(result.limitations.some((l) => l.kind === "estimated" && l.note.includes("발자국 겹침")));
  assert.ok(result.limitations.some((l) => l.note.includes("완전성")));

  const view = toTileView(result);
  assert.equal(view.hasFace, true);
  assert.equal(view.map.polygons.length, 6);
  assert.ok(!/도보|\d\s*분|종합/.test(JSON.stringify(view)));
} finally {
  ctx.close();
}

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

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d16, gfaMetrics } = await import("../../lib/v2/engine/tiles/d16.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const metric = (tile, id) => {
  const found = tile.metrics.find((item) => item.id === id);
  assert.ok(found, `${tile.tileCode}.${id}`);
  return found;
};

const makeContext = (dataDir, analysisId) => new EngineContext(
  dataDir,
  M.readManifest(dataDir),
  analysisId,
  {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: null,
  },
);

const dataDir = mkdtempSync(join(tmpdir(), "v2-d16-"));
await buildEngineFixture(dataDir, "v1", { buildings: true });
const buildingsDb = new Database(join(dataDir, "versions", "v1", "buildings.sqlite"));
const setGfa = buildingsDb.prepare(`UPDATE building_fact SET gross_floor_area_m2 = ?
  WHERE feature_id = (SELECT feature_id FROM feature WHERE stable_id = ?)`);
setGfa.run(1200, "building:b_apt");
setGfa.run(2400, "building:b_office");
buildingsDb.close();

const pureGfa = gfaMetrics([
  { grossFloorM2: 1200 },
  { grossFloorM2: null },
  { grossFloorM2: 800 },
], 800);
assert.equal(pureGfa.totalM2, 2000);
assert.equal(pureGfa.knownCount, 2);
assert.equal(pureGfa.totalCount, 3);
assert.equal(pureGfa.fillPct, 66.7);
assert.ok(Math.abs(pureGfa.perHa - (2000 / (Math.PI * 800 ** 2 / 10000))) < 1e-9);
const missingGfa = gfaMetrics([{ grossFloorM2: null }], 800);
assert.deepEqual([missingGfa.totalM2, missingGfa.fillPct, missingGfa.perHa], [null, null, null]);

const ctx = makeContext(dataDir, "d16-test");
try {
  const startedAt = performance.now();
  const tile = d16(ctx);
  const elapsedMs = Math.round((performance.now() - startedAt) * 10) / 10;
  console.log(`D16 perf: ${elapsedMs} ms (POST 경량 타일 예산 1500 ms)`);
  parseTileResult(tile);

  assert.equal(tile.tileCode, "D16");
  assert.equal(tile.tileType, "diagram");
  assert.equal(tile.status, "partial", "fixture는 반경에 걸친 시도 중 일부 건물 적재 이력이 없어 partial");
  assert.equal(metric(tile, "kde_bandwidth_m").value, 100);
  assert.equal(metric(tile, "kde_cell_m").value, 20);
  assert.equal(metric(tile, "buildings_input").value, 6, "반경 밖 300m 버퍼 안의 6동만 입력");
  assert.ok(metric(tile, "dens_break_1").value < metric(tile, "dens_break_4").value);
  assert.ok(metric(tile, "dens_max").value > metric(tile, "dens_break_4").value);

  const shares = Array.from({ length: 6 }, (_, i) => metric(tile, `share_dens_${i}`));
  assert.ok(Math.abs(shares.reduce((sum, item) => sum + item.value, 0) - 100) <= 0.5, "밀도 구간 면적비 합계");
  assert.ok(shares.every((item) => item.denominator === Math.round(Math.PI * 800 ** 2)));

  assert.equal(metric(tile, "gfa_total_m2").value, 3600);
  assert.equal(metric(tile, "gfa_total_m2").status, "observed");
  assert.equal(metric(tile, "fill_gfa_pct").value, 33.3);
  assert.deepEqual([metric(tile, "fill_gfa_pct").numerator, metric(tile, "fill_gfa_pct").denominator], [2, 6]);
  assert.equal(metric(tile, "gfa_per_ha").status, "estimated");
  assert.match(metric(tile, "gfa_per_ha").label, /연면적 밀도\(㎡\/ha\) — 용적률 아님/);
  assert.equal(metric(tile, "gfa_per_ha").value, Math.round((3600 / (Math.PI * 800 ** 2 / 10000)) * 10) / 10);
  assert.deepEqual(tile.presentation.layers, ["dens_0", "dens_q1", "dens_q2", "dens_q3", "dens_q4", "dens_q5"]);

  const q5 = tile.presentation.polygons.filter((polygon) => polygon.layer === "dens_q5");
  assert.ok(q5.length > 0, "상위 20% 밀도 면");
  assert.ok(q5.some((polygon) => {
    const points = polygon.rings.flat();
    const lngs = points.map(([lng]) => lng);
    const lats = points.map(([, lat]) => lat);
    return Math.min(...lngs) <= CENTER[0] && CENTER[0] <= Math.max(...lngs)
      && Math.min(...lats) <= CENTER[1] && CENTER[1] <= Math.max(...lats);
  }), "상위 20% 면이 중심 부근을 포함");

  assert.match(tile.limitations.find((item) => item.kind === "estimated")?.note ?? "", /커널 밀도 추정/);
  assert.match(tile.limitations.map((item) => item.note).join(" "), /연면적은 대장 값이며 동수 KDE와 섞지 않음/);
  assert.doesNotMatch(JSON.stringify(toTileView(tile)), /도보|\d\s*분|종합|법적 적합|개발 가능/);
} finally {
  ctx.close();
}

const noGfaDir = mkdtempSync(join(tmpdir(), "v2-d16-no-gfa-"));
await buildEngineFixture(noGfaDir, "v1", { buildings: true });
const noGfaCtx = makeContext(noGfaDir, "d16-no-gfa");
try {
  const noGfaTile = d16(noGfaCtx);
  assert.deepEqual(["gfa_total_m2", "fill_gfa_pct", "gfa_per_ha"].map((id) => metric(noGfaTile, id).status), ["missing", "missing", "missing"]);
} finally {
  noGfaCtx.close();
}

const absentDir = mkdtempSync(join(tmpdir(), "v2-d16-absent-"));
await buildEngineFixture(absentDir, "v1", { buildings: false });
const absentCtx = makeContext(absentDir, "d16-absent");
try {
  assert.equal(d16(absentCtx).status, "not_provided");
} finally {
  absentCtx.close();
}

console.log("✓ v2 D16 engine tile");

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { buildingRows } = await import("../../lib/v2/engine/tiles/buildings-shared.ts");
const { hitPoint } = await import("../../lib/v2/engine/tiles/common.ts");
const { localGrid, gridQuantiles, bandPolygons } = await import("../../lib/v2/engine/tiles/raster-grid.ts");
const { kdeBandPolygons, kdeGrid } = await import("../../lib/v2/engine/tiles/d16-kde.ts");
const { d16, gfaMetrics } = await import("../../lib/v2/engine/tiles/d16.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const metric = (tile, id) => {
  const found = tile.metrics.find((item) => item.id === id);
  assert.ok(found, `${tile.tileCode}.${id}`);
  return found;
};

const DENSITY_LAYERS = ["dens_0", "dens_q1", "dens_q2", "dens_q3", "dens_q4", "dens_q5"];
const legacyKdeGrid = (center, radiusM, cellM, points) => {
  const normalizer = 1 / (2 * Math.PI * 100 ** 2);
  return localGrid(center, radiusM, cellM, (x, y) => {
    const value = points.reduce((sum, [px, py]) => sum + Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * 100 ** 2)) * normalizer, 0) * 1e6;
    return value < 0.5 ? 0 : value;
  });
};
const displayBreaks = (quantiles) => {
  const out = [0.5];
  for (const value of quantiles) {
    const previous = out[out.length - 1];
    out.push(value > previous ? value : previous + Math.max(Number.EPSILON, Math.abs(previous) * Number.EPSILON));
  }
  return out;
};
const roundedPct = (part, whole) => Math.round((part / whole) * 1000) / 10;
const assertPolygonsClose = (actual, expected, tolerance = 2e-6) => {
  assert.equal(actual.length, expected.length, "밀도 밴드 면 수");
  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(actual[index].p.layer, expected[index].p.layer, `밀도 밴드 ${index} 레이어`);
    assert.equal(actual[index].p.rings.length, expected[index].p.rings.length, `밀도 밴드 ${index} 고리 수`);
    for (let ringIndex = 0; ringIndex < actual[index].p.rings.length; ringIndex += 1) {
      assert.equal(actual[index].p.rings[ringIndex].length, expected[index].p.rings[ringIndex].length, `밀도 밴드 ${index} 고리 ${ringIndex} 꼭짓점 수`);
      for (let pointIndex = 0; pointIndex < actual[index].p.rings[ringIndex].length; pointIndex += 1) {
        const [ax, ay] = actual[index].p.rings[ringIndex][pointIndex];
        const [ex, ey] = expected[index].p.rings[ringIndex][pointIndex];
        assert.ok(Math.abs(ax - ex) <= tolerance && Math.abs(ay - ey) <= tolerance, `밀도 밴드 ${index} 꼭짓점 오차`);
      }
    }
  }
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
  const regressionRows = buildingRows(ctx, 1100);
  assert.ok(regressionRows);
  const regressionPoints = regressionRows.map((row) => toUtmk(hitPoint(row.hit)));
  const legacyGrid = legacyKdeGrid(CENTER, 800, 20, regressionPoints);
  const optimizedGrid = kdeGrid(CENTER, 800, 20, regressionPoints);
  assert.deepEqual([optimizedGrid.cols, optimizedGrid.rows, optimizedGrid.cellM], [legacyGrid.cols, legacyGrid.rows, legacyGrid.cellM]);
  let maxGridDiff = 0;
  for (let index = 0; index < legacyGrid.values.length; index += 1) maxGridDiff = Math.max(maxGridDiff, Math.abs(optimizedGrid.values[index] - legacyGrid.values[index]));
  assert.ok(maxGridDiff <= 1e-7, `KDE 분리 계산 오차 ${maxGridDiff}`);
  const legacyQuantiles = gridQuantiles({ ...legacyGrid, values: Float64Array.from(legacyGrid.values, (value) => value > 0 ? value : Number.NaN) }, 800, [0.2, 0.4, 0.6, 0.8]);
  const optimizedQuantiles = gridQuantiles({ ...optimizedGrid, values: Float64Array.from(optimizedGrid.values, (value) => value > 0 ? value : Number.NaN) }, 800, [0.2, 0.4, 0.6, 0.8]);
  legacyQuantiles.forEach((value, index) => assert.ok(Math.abs(value - optimizedQuantiles[index]) <= 1e-7, `KDE 백분위 ${index + 1}`));
  const legacyBands = bandPolygons(CENTER, 800, legacyGrid, displayBreaks(legacyQuantiles), DENSITY_LAYERS, null);
  const optimizedBands = kdeBandPolygons(CENTER, 800, optimizedGrid, displayBreaks(optimizedQuantiles), DENSITY_LAYERS);
  legacyBands.areaM2.forEach((area, index) => assert.ok(Math.abs(area - optimizedBands.areaM2[index]) <= 1, `KDE 밴드 ${index} 면적 오차`));
  assertPolygonsClose(optimizedBands.polygons, legacyBands.polygons);

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
  assert.deepEqual(tile.presentation.layers, DENSITY_LAYERS);
  optimizedQuantiles.forEach((value, index) => assert.equal(metric(tile, `dens_break_${index + 1}`).value, Math.round(value * 1000) / 1000));
  const legacyMax = Math.max(...Array.from(legacyGrid.values));
  assert.equal(metric(tile, "dens_max").value, Math.round(legacyMax * 1000) / 1000);
  legacyBands.areaM2.forEach((area, index) => assert.equal(metric(tile, `share_dens_${index}`).value, roundedPct(area, Math.round(Math.PI * 800 ** 2))));

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

const perfDir = mkdtempSync(join(tmpdir(), "v2-d16-perf-"));
try {
  await buildEngineFixture(perfDir, "v1", { buildings: true });
  const [cx, cy] = toUtmk(CENTER);
  const at = (x, y) => toLngLat([cx + x, cy + y]);
  const positions = [];
  for (let y = -975; y <= 975; y += 30) {
    for (let x = -975; x <= 975; x += 30) {
      if (Math.hypot(x, y) <= 975) positions.push([x, y]);
    }
  }
  assert.ok(positions.length >= 3000, `합성 도시 건물 수 ${positions.length}`);
  const buildingsDb = new Database(join(perfDir, "versions", "v1", "buildings.sqlite"));
  const releaseId = buildingsDb.prepare("SELECT release_id FROM source_release WHERE source_id = 'building' LIMIT 1").get().release_id;
  const insertFact = buildingsDb.prepare(`INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
    VALUES (?, NULL, ?, 'source', ?, NULL, '02000', '2020-01-01', ?, ?, '{}')`);
  buildingsDb.transaction(() => {
    positions.forEach(([x, y], index) => {
      const size = 12 + (index % 5);
      const half = size / 2;
      const geometry = { type: "Polygon", coordinates: [[
        at(x - half, y - half), at(x + half, y - half), at(x + half, y + half), at(x - half, y + half), at(x - half, y - half),
      ]] };
      const featureId = insertFeature(buildingsDb, { stableId: `synthetic:${index}`, kind: "building", sourceKey: `synthetic:${index}`, releaseId, geometry });
      insertFact.run(featureId, 8 + (index % 5), 2 + (index % 4), 450 + (index % 11) * 25, size * size);
    });
  })();
  buildingsDb.close();

  const perfCtx = new EngineContext(perfDir, M.readManifest(perfDir), "d16-perf", {
    address: "synthetic city",
    center: CENTER,
    radiusM: 1000,
    analysisDate: "2026-09-30",
    pnu: null,
  });
  try {
    const perfRows = buildingRows(perfCtx, 1000);
    assert.ok(perfRows && perfRows.length >= 3000, `반경 1km 합성 건물 수 ${perfRows?.length ?? 0}`);
    const startedAt = performance.now();
    const perfTile = d16(perfCtx);
    const elapsedMs = performance.now() - startedAt;
    console.log(`D16 synthetic perf: ${Math.round(elapsedMs * 10) / 10} ms (${perfRows.length} buildings, budget 1500 ms)`);
    assert.ok(elapsedMs <= 1500, `3,000동 이상 반경 1km D16 성능 ${elapsedMs.toFixed(1)} ms > 1500 ms`);
    parseTileResult(perfTile);
    assert.ok(metric(perfTile, "buildings_input").value >= 3000);
  } finally {
    perfCtx.close();
  }
} finally {
  rmSync(perfDir, { recursive: true, force: true });
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

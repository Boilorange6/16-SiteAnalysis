/** D15 도로 폐합 블록: 실제 도로망 노딩·폐합·반경 교차 집계 계약. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { readManifest } = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d15, BLOCK_ROAD_FILTER } = await import("../../lib/v2/engine/tiles/d15.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");

const metric = (tile, id) => tile.metrics.find((item) => item.id === id);

function syntheticRoadHits(center, radiusM) {
  const [cx, cy] = toUtmk(center);
  const half = radiusM + 500 + 200;
  let featureId = 1;
  const hits = [];
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const addLine = (coordinates, hierarchy = "국지") => {
    hits.push({
      featureId: featureId++,
      stableId: `road:${featureId}`,
      kind: "road",
      releaseId: "osm-roads",
      name: null,
      pnu: null,
      legalCode: null,
      properties: { hierarchy },
      geometry: { type: "LineString", coordinates },
      distanceM: null,
    });
  };
  const step = 60;
  for (let x = -half; x <= half; x += step) {
    const coordinates = [];
    for (let y = -half; y <= half; y += 25) coordinates.push([cx + x + (random() - 0.5) * 6, cy + y]);
    addLine(coordinates, x % 300 === 0 ? "간선" : "국지");
  }
  for (let y = -half; y <= half; y += step) {
    const coordinates = [];
    for (let x = -half; x <= half; x += 25) coordinates.push([cx + x, cy + y + (random() - 0.5) * 6]);
    addLine(coordinates);
  }
  for (let i = 0; i < 20; i++) {
    const a = [cx + (random() - 0.5) * 2 * half, cy + (random() - 0.5) * 2 * half];
    const b = [cx + (random() - 0.5) * 2 * half, cy + (random() - 0.5) * 2 * half];
    addLine([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 10], b]);
  }
  for (let i = 0; i < 300; i++) {
    const a = [cx + (random() - 0.5) * 2 * half, cy + (random() - 0.5) * 2 * half];
    addLine([a, [a[0] + 20, a[1] + 15]], "보행·자전거");
    addLine([a, [a[0] - 17, a[1] + 11]]);
  }
  return hits;
}

const d15Summary = (tile) => Object.fromEntries(tile.metrics.map((item) => [item.id, {
  value: item.value,
  numerator: item.numerator,
  denominator: item.denominator,
  status: item.status,
}]));

// 최적화 전 현재 구현에서 같은 입력으로 얻은 결과. 성능 개선이 수치·구성비를 바꾸지 않는지 고정한다.
const SYNTHETIC_EXPECTED = {
  800: {
    blocks: { value: 786, numerator: 786, denominator: null, status: "observed" },
    fill_closed_pct: { value: 100, numerator: 2010609, denominator: 2010619, status: "observed" },
    median_block_ha: { value: 0.3422541442871094, numerator: null, denominator: null, status: "observed" },
    share_count_lt05: { value: 96.4, numerator: 758, denominator: 786, status: "observed" },
    share_area_lt05: { value: 87, numerator: 1749428, denominator: 2010619, status: "observed" },
    share_count_05_1: { value: 1.9, numerator: 15, denominator: 786, status: "observed" },
    share_area_05_1: { value: 5.6, numerator: 112992, denominator: 2010619, status: "observed" },
    share_count_1_2: { value: 1.7, numerator: 13, denominator: 786, status: "observed" },
    share_area_1_2: { value: 7.4, numerator: 148189, denominator: 2010619, status: "observed" },
    share_count_2_5: { value: 0, numerator: 0, denominator: 786, status: "observed" },
    share_area_2_5: { value: 0, numerator: 0, denominator: 2010619, status: "observed" },
    share_count_ge5: { value: 0, numerator: 0, denominator: 786, status: "observed" },
    share_area_ge5: { value: 0, numerator: 0, denominator: 2010619, status: "observed" },
    share_open_pct: { value: 0, numerator: 10, denominator: 2010619, status: "observed" },
  },
  2000: {
    blocks: { value: 4494, numerator: 4494, denominator: null, status: "observed" },
    fill_closed_pct: { value: 100, numerator: 12566308, denominator: 12566371, status: "observed" },
    median_block_ha: { value: 0.34904589233398436, numerator: null, denominator: null, status: "observed" },
    share_count_lt05: { value: 97.8, numerator: 4396, denominator: 4494, status: "observed" },
    share_area_lt05: { value: 92.1, numerator: 11578048, denominator: 12566371, status: "observed" },
    share_count_05_1: { value: 0.9, numerator: 42, denominator: 4494, status: "observed" },
    share_area_05_1: { value: 2.3, numerator: 288182, denominator: 12566371, status: "observed" },
    share_count_1_2: { value: 1.2, numerator: 54, denominator: 4494, status: "observed" },
    share_area_1_2: { value: 5.4, numerator: 678405, denominator: 12566371, status: "observed" },
    share_count_2_5: { value: 0, numerator: 2, denominator: 4494, status: "observed" },
    share_area_2_5: { value: 0.2, numerator: 21673, denominator: 12566371, status: "observed" },
    share_count_ge5: { value: 0, numerator: 0, denominator: 4494, status: "observed" },
    share_area_ge5: { value: 0, numerator: 0, denominator: 12566371, status: "observed" },
    share_open_pct: { value: 0, numerator: 62, denominator: 12566371, status: "observed" },
  },
};

// ─── 1. 200×200m 도로 격자 4개는 보행로를 빼면 4개 4ha 블록 ─────────────
{
  const dataDir = mkdtempSync(join(tmpdir(), "v2-d15-"));
  await buildEngineFixture(dataDir, "v1", { roads: true });
  const ctx = new EngineContext(dataDir, readManifest(dataDir), "d15-test", {
    address: "테스트",
    center: [127.1506, 37.6245],
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: null,
  });

  const tile = d15(ctx);
  parseTileResult(tile);
  assert.equal(tile.status, "partial");
  assert.equal(tile.tileType, "diagram");
  assert.equal(metric(tile, "blocks").value, 4);
  assert.equal(metric(tile, "share_count_2_5").value, 100);
  assert.ok(Math.abs(metric(tile, "fill_closed_pct").value - 160000 / (Math.PI * 800 ** 2) * 100) < 0.1);
  assert.equal(metric(tile, "median_block_ha").value, 4);
  assert.ok(tile.presentation.polygons.some((polygon) => polygon.layer === "block_2_5"));
  assert.ok(tile.presentation.polygons.some((polygon) => polygon.layer === "block_open"));
  assert.ok(tile.limitations.some((limitation) => limitation.note.includes("보행로 제외")));
  assert.ok(!/도보|\d\s*분|종합|법적 적합|개발 가능/.test(JSON.stringify(tile)));
  ctx.close();
}

// ─── 2. Q7의 단일 필터를 켜면 보행로가 왼쪽 아래 블록을 둘로 나눈다 ─────
{
  const dataDir = mkdtempSync(join(tmpdir(), "v2-d15-pedestrian-"));
  await buildEngineFixture(dataDir, "v1", { roads: true });
  const ctx = new EngineContext(dataDir, readManifest(dataDir), "d15-pedestrian", {
    address: "테스트",
    center: [127.1506, 37.6245],
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: null,
  });

  const before = d15(ctx);
  assert.equal(metric(before, "blocks").value, 4);
  const previous = BLOCK_ROAD_FILTER.includePedestrian;
  BLOCK_ROAD_FILTER.includePedestrian = true;
  try {
    const after = d15(ctx);
    assert.equal(metric(after, "blocks").value, 5);
  } finally {
    BLOCK_ROAD_FILTER.includePedestrian = previous;
  }
  ctx.close();
}

// ─── 3. OSM 도로 릴리스가 없으면 명시적으로 미제공 ─────────────────────────
{
  const dataDir = mkdtempSync(join(tmpdir(), "v2-d15-missing-"));
  await buildEngineFixture(dataDir, "v1");
  const ctx = new EngineContext(dataDir, readManifest(dataDir), "d15-missing", {
    address: "테스트",
    center: [127.1506, 37.6245],
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: null,
  });
  const tile = d15(ctx);
  assert.equal(tile.status, "not_provided");
  assert.ok(tile.limitations[0].note.includes("도로(OSM) 미적재"));
  ctx.close();
}

// ─── 4. 60m 합성 격자: 기존 결과를 보존하면서 r=2,000m은 15초 안에 끝난다 ─
{
  const center = [127.1506, 37.6245];
  for (const radiusM of [800, 2000]) {
    const dataDir = mkdtempSync(join(tmpdir(), `v2-d15-perf-${radiusM}-`));
    await buildEngineFixture(dataDir, "v1", { roads: true });
    const ctx = new EngineContext(dataDir, readManifest(dataDir), `d15-perf-${radiusM}`, {
      address: "합성 격자",
      center,
      radiusM,
      analysisDate: "2026-09-30",
      pnu: null,
    });
    const hits = syntheticRoadHits(center, radiusM);
    const segments = hits.reduce((sum, hit) => sum + hit.geometry.coordinates.length - 1, 0);
    ctx.hits = () => hits;
    const started = performance.now();
    const tile = d15(ctx);
    const elapsedMs = Math.round(performance.now() - started);
    parseTileResult(tile);
    console.log(`D15 synthetic r=${radiusM}m segments=${segments} elapsed=${elapsedMs}ms blocks=${metric(tile, "blocks").value}`);
    console.log(`D15 synthetic r=${radiusM}m summary=${JSON.stringify(d15Summary(tile))}`);
    assert.deepEqual(d15Summary(tile), SYNTHETIC_EXPECTED[radiusM]);
    assert.ok(elapsedMs < 15_000, `r=${radiusM}m took ${elapsedMs}ms`);
    ctx.close();
  }
}

console.log("✓ v2 D15 blocks");

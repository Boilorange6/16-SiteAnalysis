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

const metric = (tile, id) => tile.metrics.find((item) => item.id === id);

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

console.log("✓ v2 D15 blocks");

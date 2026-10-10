import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildEngineFixture, CENTER } from "./engine-fixture.mjs";

const { readManifest } = await import("../../lib/v2/data/manifest.ts");
const { acquireDataFile, closeDataFilePool, releaseDataFile } = await import("../../lib/v2/data/file-pool.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { buildingRows } = await import("../../lib/v2/engine/tiles/buildings-shared.ts");
const { d16 } = await import("../../lib/v2/tile/d16/engine.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-coldperf-"));
try {
  await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true });
  const manifest = readManifest(dataDir);
  assert.ok(manifest);

  const pooledFirst = acquireDataFile(dataDir, manifest, "buildings");
  const pooledSecond = acquireDataFile(dataDir, manifest, "buildings");
  assert.strictEqual(pooledSecond, pooledFirst, "같은 프로세스의 같은 published DB는 핸들을 재사용해야 한다");
  releaseDataFile(pooledFirst);
  releaseDataFile(pooledSecond);
  closeDataFilePool();

  const input = {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: null,
  };
  const ctx = new EngineContext(dataDir, manifest, "coldperf-cache", input);
  try {
    const rowsFirst = buildingRows(ctx, 800);
    const rowsSecond = buildingRows(ctx, 800);
    assert.ok(rowsFirst);
    assert.strictEqual(rowsSecond, rowsFirst, "같은 분석 안의 buildingRows는 동일 배열을 재사용해야 한다");

    const bufferedFirst = buildingRows(ctx, 1100);
    const bufferedSecond = buildingRows(ctx, 1100);
    assert.ok(bufferedFirst);
    assert.strictEqual(bufferedSecond, bufferedFirst, "버퍼 반경 buildingRows도 동일 배열을 재사용해야 한다");

    const firstTile = d16(ctx);
    const secondTile = d16(ctx);
    assert.deepEqual(secondTile.metrics, firstTile.metrics, "memo 재사용 뒤 D16 지표가 변하지 않아야 한다");
    assert.deepEqual(secondTile.presentation, firstTile.presentation, "memo 재사용 뒤 D16 도형이 변하지 않아야 한다");
  } finally {
    ctx.close();
  }
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

console.log("✓ v2 cold POST shared computation contract");

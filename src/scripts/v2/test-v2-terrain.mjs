/**
 * P3 지형·기상 데이터 계약과 작은 엔진 fixture 테스트.
 * 실제 전국 DEM/ASOS 원천은 읽지 않고 임시 DB와 fixture만 사용한다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { DATA_FILE_KINDS, initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { DemReader, DEM_NODATA, hgtMeta, insertDemTile } = await import("../../lib/v2/data/terrain.ts");
const { buildDemTiles } = await import("../../lib/v2/ingest/sources/dem.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildEngineFixture, CENTER, at } = await import("./engine-fixture.mjs");
const { openDataFile, readManifest } = await import("../../lib/v2/data/manifest.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");

assert.ok(DATA_FILE_KINDS.includes("terrain"));
assert.ok(DATA_FILE_KINDS.includes("weather"));
assert.deepEqual(hgtMeta("N37E127"), {
  tile: "N37E127",
  lat0: 37,
  lon0: 127,
  rows: 3601,
  cols: 3601,
  cellDeg: 1 / 3600,
  nodata: DEM_NODATA,
  vertical: "EGM96",
  resolutionM: 30,
});
assert.deepEqual(hgtMeta("N37E127.hgt.gz"), hgtMeta("N37E127"));

// ─── 1. 3×3 HGT 행 BLOB의 정확값·쌍선형 보간·결측·경계 ────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "terrain");
  const releaseId = insertRelease(db, {
    sourceId: "terrain_tiles",
    provider: "test",
    sourceUrl: "https://example.invalid",
    sourceAsOf: "2026-10-01",
    fetchedAt: "2026-10-01T00:00:00Z",
    checksum: "test",
    licenseCode: "TEST",
  });
  const meta = { tile: "N00E000", lat0: 0, lon0: 0, rows: 3, cols: 3, cellDeg: 1, nodata: DEM_NODATA, vertical: "EGM96", resolutionM: 30 };
  const rows = [0, 1, 2].map((row) => {
    const data = Buffer.alloc(meta.cols * 2);
    for (let col = 0; col < meta.cols; col++) data.writeInt16BE(row * meta.cols + col, col * 2);
    if (row === 0) data.writeInt16BE(DEM_NODATA, 0);
    return { row, data };
  });
  insertDemTile(db, meta, releaseId, rows);
  const reader = new DemReader(db);
  assert.equal(reader.ready(), true);
  assert.equal(reader.elevation(1, 1), 4);
  assert.equal(reader.elevation(1.5, 0.5), 6);
  assert.equal(reader.elevation(0.5, 1.5), null, "nodata 이웃은 0m로 보간하지 않는다");
  assert.equal(reader.elevation(3, 1), null, "타일 밖은 null");
  db.close();
}

// ─── 2. 잘못된 HGT 크기는 조용히 적재하지 않는다 ────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), "v2-terrain-bad-"));
  const path = join(dir, "N37E127.hgt");
  writeFileSync(path, Buffer.alloc(4));
  const db = new Database(":memory:");
  initDataFileSchema(db, "terrain");
  const releaseId = insertRelease(db, {
    sourceId: "terrain_tiles",
    provider: "test",
    sourceUrl: "https://example.invalid",
    sourceAsOf: null,
    fetchedAt: "2026-10-01T00:00:00Z",
    checksum: "test",
    licenseCode: "TEST",
  });
  await assert.rejects(() => buildDemTiles(db, [path], releaseId), /25934402/);
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

// ─── 3. terrain·weather·roads fixture가 manifest와 조회 계약을 채운다 ──
{
  const dir = mkdtempSync(join(tmpdir(), "v2-terrain-fixture-"));
  await buildEngineFixture(dir, "fx", { terrain: true, weather: true, roads: true });
  const manifest = readManifest(dir);
  assert.ok(manifest.files.terrain);
  assert.ok(manifest.files.weather);
  assert.ok(manifest.files.reference);

  const terrain = openDataFile(dir, manifest, "terrain");
  const reader = new DemReader(terrain);
  const centerElevation = reader.elevation(CENTER[0], CENTER[1]);
  const eastElevation = reader.elevation(at(400, 0)[0], at(400, 0)[1]);
  // HGT 원시 표본이 정수 m이므로 bilinear 양자화 오차를 포함한다.
  assert.ok(Math.abs(centerElevation - 50) <= 0.5, `center elevation=${centerElevation}`);
  assert.ok(Math.abs(eastElevation - 70) <= 0.5, `east elevation=${eastElevation}`);
  terrain.close();

  const weather = openDataFile(dir, manifest, "weather");
  assert.equal(weather.prepare("SELECT count(*) AS n FROM weather_station").get().n, 2);
  assert.equal(
    weather.prepare("SELECT COALESCE(SUM(hours), 0) AS n FROM wind_rose").get().n,
    87672 - 8767 - 4384,
  );
  weather.close();

  const reference = openDataFile(dir, manifest, "reference");
  assert.equal(queryFeaturesInRadius(reference, CENTER, 800, ["road"]).length, 7);
  reference.close();
}

console.log("✓ v2 terrain");

/**
 * 개별공시지가(VWorld dsId 6 CSV) 적재 테스트. 픽스처는 실제 세종 파일(AL_D151_36_20260526.csv) 앞 3줄의 EUC-KR 바이트 그대로에 ASCII 행을 덧붙인 것이다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildLandPrice, latestLandPricePerSido, LAND_PRICE_RIGHTS } = await import("../../lib/v2/ingest/sources/land-price.ts");

const REAL =
  "b0edc0afb9f8c8a32cb9fdc1a4b5bfc4dab5e52cb9fdc1a4b5bfb8ed2cc6afbcf6c1f6b1b8bad0c4dab5e52cc6afbcf6c1f6b1b8bad0b8ed2cc1f6b9f82cb1e2c1d8bfacb5b52cb1e2c1d8bff92cb0f8bdc3c1f6b0a12cb0f8bdc3c0cfc0da2cc7a5c1d8c1f6bfa9bace2cb5a5c0ccc5cdb1e2c1d8c0cfc0da2cbff8c3b5bdc3b5b5bdc3b1bab1b8c4dab5e50a" +
  "333631313033393032323130313833303030372c333631313033393032322cbcbcc1bec6afbab0c0dac4a1bdc32020bcd2c1a4b8e920bfeeb4e7b8ae2c312cc0cfb9dd2c3138332d372c323032362c312c34323830302c323032362d30342d33302c4e2c323032362d30352d32312c33363131300a" +
  "333631313033393032323130313833303030362c333631313033393032322cbcbcc1bec6afbab0c0dac4a1bdc32020bcd2c1a4b8e920bfeeb4e7b8ae2c312cc0cfb9dd2c3138332d362c323032362c312c31333930302c323032362d30342d33302c4e2c323032362d30352d32312c33363131300a";
const ASCII_ROWS = [
  "3611039022101830008,3611039022,x,1,g,183-8,2026,1,99000,2026-04-30,Y,2026-05-21,36110", // 표준지
  "3611039022101830007,3611039022,x,1,g,183-7,2026,1,1,2026-04-30,N,2026-05-21,36110", // 중복 PNU
  "3611039022101830009,3611039022,x,1,g,183-9,2026,1,0,2026-04-30,N,2026-05-21,36110", // 가격 0
  "361103902210183-0010,3611039022,x,1,g,183-10,2026,1,5000,2026-04-30,N,2026-05-21,36110", // 깨진 PNU
].join("\n") + "\n";

const dir = mkdtempSync(join(tmpdir(), "land-price-"));
const file = join(dir, "AL_D151_36_20260526.csv");
writeFileSync(file, Buffer.concat([Buffer.from(REAL, "hex"), Buffer.from(ASCII_ROWS)]));

// 파일 고르기: 시도마다 가장 새 날짜
const picked = latestLandPricePerSido([file, join(dir, "AL_D151_36_20250101.csv"), join(dir, "AL_D151_29_20260526.csv"), join(dir, "x.zip")]);
assert.deepEqual([...picked.keys()].sort(), ["29", "36"]);
assert.equal(picked.get("36").date, "20260526");

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const core = new Database(":memory:");
initDataFileSchema(core, "core");
assert.equal(core.prepare("SELECT 1 FROM sqlite_master WHERE name='land_price'").get(), undefined);

const csv = await csvRecords(file);
assert.equal(csv.encoding, "euc-kr");
assert.equal(csv.fieldNames[0], "고유번호");
assert.equal(csv.fieldNames[8], "공시지가");

const releaseId = insertRelease(db, { sourceId: "land_price", provider: "t", sourceUrl: "u", sourceAsOf: "2026-05-26", fetchedAt: "2026-09-30T00:00:00Z", checksum: "c", licenseCode: "UNRESTRICTED", rights: LAND_PRICE_RIGHTS });
const stats = await buildLandPrice(db, csv.records, releaseId, ["36"]);
assert.equal(stats.received, 6);
assert.equal(stats.accepted, 3);
assert.equal(stats.rejected, 3);
assert.equal(stats.received, stats.accepted + stats.rejected + stats.unlocated); // SourceStats 불변식
assert.deepEqual(stats.byRegion, { 36: 3 });
assert.deepEqual(stats.byType, { 2026: 3 });
assert.deepEqual(stats.expectedRegions, ["36"]);
assert.equal(stats.snapshot().fillRates.baseMonth, 1);

assert.deepEqual(db.prepare("SELECT * FROM land_price WHERE pnu = ?").get("3611039022101830007"), { pnu: "3611039022101830007", base_year: 2026, base_month: 1, price_krw_per_m2: 42800, is_standard: 0 }); // 첫 행이 이긴다
assert.equal(db.prepare("SELECT is_standard FROM land_price WHERE pnu = ?").pluck().get("3611039022101830008"), 1);
assert.equal(db.prepare("SELECT count(*) FROM land_price").pluck().get(), 3);
assert.match(JSON.stringify(LAND_PRICE_RIGHTS), /15052266/);
console.log("land-price ok");

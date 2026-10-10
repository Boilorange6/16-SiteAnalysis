import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  formatBytes,
  sourceKindOf,
  rightsFor,
  latestFullRows,
  readDbfFieldNames,
  inspectCadastralFields,
} = await import("./land-area-dryrun.mjs");

assert.equal(formatBytes(null), "미상");
assert.equal(formatBytes(1024), "1.0 KB");
assert.equal(formatBytes(37 * 1024 ** 2), "37.0 MB");
assert.equal(formatBytes(1203 * 1024 ** 2), "1.17 GB");

assert.equal(sourceKindOf({ dsId: "20", title: "토지특성정보" }), "토지특성정보");
assert.equal(sourceKindOf({ dsId: "20", title: "토지대장" }), "토지대장");
assert.equal(sourceKindOf({ dsId: "23", title: "연속지적도형정보" }), "연속지적도");
assert.equal(sourceKindOf({ dsId: "999", title: "알 수 없음" }), "미분류");

assert.equal(rightsFor({ dsId: "23", title: "연속지적도형정보" }).license, "CC-BY");
assert.match(rightsFor({ dsId: "20", title: "토지특성정보" }).wording, /확인 필요/);
assert.match(rightsFor({ dsId: "20", title: "토지대장" }).wording, /확인 필요/);

const files = [
  { dsId: "20", title: "토지특성정보", region: "서울", kind: "전체데이터", baseDate: "2026-09-01", fileSq: "old" },
  { dsId: "20", title: "토지특성정보", region: "서울", kind: "전체데이터", baseDate: "2026-09-20", fileSq: "new" },
  { dsId: "20", title: "토지특성정보", region: "부산", kind: "변동데이터", baseDate: "2026-09-30", fileSq: "delta" },
  { dsId: "20", title: "토지대장", region: "서울", kind: "전체데이터", baseDate: "2026-09-10", fileSq: "ledger" },
];
assert.deepEqual(latestFullRows(files).map((file) => file.fileSq), ["new", "ledger"]);
assert.deepEqual(latestFullRows(files, new Set(["서울"])).map((file) => file.fileSq), ["new", "ledger"]);

const dir = mkdtempSync(join(tmpdir(), "v2-land-area-"));
const dbf = join(dir, "sample.dbf");
const headerBytes = 32 + 32 * 3 + 1;
const header = Buffer.alloc(headerBytes);
header.writeUInt32LE(2, 4);
header.writeUInt16LE(headerBytes, 8);
for (const [index, name] of ["A1", "LNDPCL_AR", "A5"].entries()) {
  Buffer.from(name, "ascii").copy(header, 32 + index * 32);
}
header[headerBytes - 1] = 0x0d;
writeFileSync(dbf, header);

assert.deepEqual(readDbfFieldNames(dbf), ["A1", "LNDPCL_AR", "A5"]);
assert.deepEqual(inspectCadastralFields(dir), {
  directory: dir,
  filesScanned: 1,
  filesWithLandAreaField: [dbf],
  fieldSets: [["A1", "LNDPCL_AR", "A5"]],
});

console.log("✓ v2 land-area dryrun");

/** 시도별 SHP 파트 찾기: (n) 파트 묶기, 시도별 최신 날짜, 릴리스 기준일 */
import assert from "node:assert/strict";

const { latestShpPerSido, partCounts, oldestDate } = await import("../../lib/v2/ingest/shp-parts.ts");

const files = [
  "c/AL_D002_51_20260908.shp", "c/AL_D002_51_20260908(3).shp", "c/AL_D002_51_20260908(2).shp", "c/AL_D002_51_20260908.dbf",
  "c/AL_D002_43_20260908.shp", "c/AL_D002_43_20260908(2).shp",
  "c/AL_D002_36_20260908.shp",
  "old/AL_D002_36_20250908.shp", "old/AL_D002_36_20250908(2).shp", // 같은 시도의 옛 날짜는 버린다
  "old/AL_D002_11_20250908.shp", // 시도마다 날짜가 달라도 모두 남는다
  "c/AL_D010_51_20260908.shp", "notes.txt",
];
const sets = latestShpPerSido(files, "AL_D002");
assert.deepEqual([...sets.keys()], ["11", "36", "43", "51"], "시도마다 하나, 전역 최신 날짜로 잘리지 않음");
assert.deepEqual(sets.get("51"), { date: "20260908", files: ["c/AL_D002_51_20260908.shp", "c/AL_D002_51_20260908(2).shp", "c/AL_D002_51_20260908(3).shp"] });
assert.deepEqual(sets.get("36").files, ["c/AL_D002_36_20260908.shp"]);
assert.equal(sets.get("11").date, "20250908");
assert.equal(partCounts(sets), "11x1 36x1 43x2 51x3");
assert.equal(oldestDate(sets), "20250908");
assert.equal(oldestDate(new Map()), null);
assert.deepEqual([...latestShpPerSido(files, "AL_D010").keys()], ["51"], "태그별로 구분");

console.log("✓ v2 shp-parts");

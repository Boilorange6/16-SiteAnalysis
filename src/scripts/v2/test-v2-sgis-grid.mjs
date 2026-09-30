import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature, queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildPopGrid, sgisRows, sgisDataYear, gridSouthWest, locateSigunguFromCore, AGE_ITEMS } = await import("../../lib/v2/ingest/sources/sgis-grid.ts");
const { toLngLat } = await import("../../lib/v2/crs.ts");

// ─── 격자 코드 → 좌표 (원천 SHP에서 확인한 값) ───
assert.deepEqual(gridSouthWest("가다7667"), [776000, 1567000]);
assert.deepEqual(gridSouthWest("나다1280"), [812000, 1580000]);
assert.deepEqual(gridSouthWest("다다0000"), [900000, 1500000]);
assert.deepEqual(gridSouthWest("라마0001"), [1000000, 1701000]);
assert.deepEqual(gridSouthWest("사사0047"), [1300000, 1947000]);
assert.equal(gridSouthWest("XX1234"), null);
assert.equal(gridSouthWest("다사535"), null);

// ─── CSV 읽기: 비숫자(N/A, *)는 행을 버린다 = 비공개 ───
const dir = mkdtempSync(join(tmpdir(), "v2-sgis-"));
const put = (sub, name, rows) => {
  mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, sub, name), ['"base","grid","item","value"', ...rows.map(([g, i, v]) => `2024,"${g}","${i}",${v}`)].join("\r\n") + "\r\n");
};
put("1. pop", "2024년_인구_다사_1K.csv", [
  ["다사5352", "to_in_001", 1200], ["다사5352", "to_in_007", 600], ["다사5352", "to_in_008", 600],
  ...AGE_ITEMS.map((i) => ["다사5352", i, 50]).filter(([, i]) => i !== "in_age_021"),
  ["다사5353", "to_in_001", "N/A"], ["다사5353", "to_in_007", "*"], ["다사5353", "to_in_008", ""],
  ["다사5353", "in_age_014", 7],
  ["다사5452", "to_in_001", 0], ["다사5452", "in_age_001", 0],
  ["XX1234", "to_in_001", 10],
  ["다사5352", "in_age_031", 9], // 성별 연령 항목: 읽지 않는다
]);
put("2. hh", "2024년_가구_다사_1K.csv", [["다사5352", "to_ga_001", 500], ["다사5352", "ga_sd_005", 150], ["다사5453", "to_ga_001", 20]]);
put("3. biz", "2024년_사업체중분류_다사_1K.csv", [["다사5352", "to_fa_010", 999]]); // 중분류는 읽지 않는다
put("3. biz", "2024년_종사자_다사_1K.csv", [["다사5352", "to_em_020", 3000]]);
put("9. etc", "readme.csv", [["다사5352", "to_in_001", 42]]);

const rows = [...sgisRows(dir)];
assert.equal(sgisDataYear(dir), "2024");
assert.ok(!rows.some((r) => r.item === "in_age_031" || r.value === 999 || r.value === 42));
assert.ok(!rows.some((r) => r.gridId === "다사5353" && ["to_in_001", "to_in_007", "to_in_008"].includes(r.item)), "N/A·*·빈칸은 행이 없다");

// ─── 적재 ───
const core = new Database(":memory:");
initDataFileSchema(core, "core");
const crel = insertRelease(core, { sourceId: "legal_sigungu", provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: null, fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
// 다사5352 셀 중심(953500,1952500) 부근을 덮는 시군구 하나 (서울 11 = 종로구). 5453은 밖.
const [w, s] = toLngLat([953000, 1952000]);
const [e, n] = toLngLat([954000, 1953000]);
insertFeature(core, { stableId: "sig:11110", kind: "legal_sigungu", sourceKey: "11110", releaseId: crel, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, legalCode: "1111000000" });

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const rel = insertRelease(db, { sourceId: "sgis_grid", provider: "SGIS", sourceUrl: "https://x.invalid", sourceAsOf: "2024", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
const stats = await buildPopGrid(db, { rows, releaseId: rel, dataYear: "2024", locate: locateSigunguFromCore(core) });
assert.equal(stats.received, stats.accepted + stats.unlocated + stats.rejected, "SourceStats 불변식");
assert.deepEqual([stats.received, stats.accepted, stats.rejected, stats.unlocated], [5, 4, 1, 0]);
assert.deepEqual(stats.byRegion, { 11: 1, "(미상)": 3 }, "시도는 core 경계로, 경계 밖은 (미상)");
const snap = stats.snapshot();
assert.equal(snap.fillRates.population, 0.5, "인구 총계가 있는 셀: 5352, 5452 (0도 값)");

const cell = (id) => JSON.parse(db.prepare("SELECT properties_json FROM feature WHERE stable_id = ?").pluck().get(`pop_grid:${id}`));
const full = cell("다사5352");
assert.equal(full.cellSizeM, 1000);
assert.deepEqual(full.population.total, { v: 1200, s: "observed" });
assert.deepEqual(full.households, { total: { v: 500, s: "observed" }, single: { v: 150, s: "observed" } });
assert.deepEqual(full.business, { establishments: { v: null, s: "suppressed" }, employees: { v: 3000, s: "observed" } });
assert.equal(full.ageBands.length, 21);
assert.equal(full.ageBands[20], null, "없는 구간은 null(비공개), 0이 아니다");
assert.deepEqual(full.ageGroups.under15, { v: 150, s: "observed" });
assert.deepEqual(full.ageGroups.age65plus, { v: null, s: "suppressed" }, "구간 하나라도 없으면 묶음은 비공개");
// 비공개는 0이 아니다
const sup = cell("다사5353");
assert.deepEqual(sup.population.total, { v: null, s: "suppressed" });
assert.deepEqual(sup.households.total, { v: null, s: "suppressed" });
assert.equal(sup.ageBands[13], 7);
// 실제 0은 0이다
assert.deepEqual(cell("다사5452").population.total, { v: 0, s: "observed" });
assert.equal(cell("다사5452").ageBands[0], 0);
assert.deepEqual(cell("다사5453").households.total, { v: 20, s: "observed" });
assert.deepEqual(cell("다사5453").population.total, { v: null, s: "suppressed" }, "가구 파일에만 있는 셀의 인구는 비공개로 둔다");

// 셀 중심점이 반경 조회에 나온다 (중심 953500,1952500)
const [clng, clat] = toLngLat([953500, 1952500]);
const hits = queryFeaturesInRadius(db, [clng, clat], 100, ["pop_grid"]);
assert.deepEqual(hits.map((h) => h.stableId), ["pop_grid:다사5352"]);
assert.ok(Math.abs(hits[0].geometry.coordinates[0] - 953500) < 0.01 && Math.abs(hits[0].geometry.coordinates[1] - 1952500) < 0.01);
assert.equal(hits[0].legalCode, "1111000000");

// 결정적: 다시 적재하면 같은 id 목록
const db2 = new Database(":memory:");
initDataFileSchema(db2, "reference");
const rel2 = insertRelease(db2, { sourceId: "sgis_grid", provider: "SGIS", sourceUrl: "https://x.invalid", sourceAsOf: "2024", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
await buildPopGrid(db2, { rows: [...sgisRows(dir)].reverse(), releaseId: rel2, dataYear: "2024", locate: () => null });
const ids = (d) => d.prepare("SELECT stable_id FROM feature ORDER BY stable_id").pluck().all();
assert.deepEqual(ids(db2), ids(db));

console.log("sgis-grid ok");

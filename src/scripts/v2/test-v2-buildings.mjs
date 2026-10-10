/**
 * GIS건물통합정보 → building feature/building_fact. 작은 SHP·DBF를 즉석에서 써서 readShp 경로까지 확인한다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import proj4 from "proj4";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { readShp } = await import("../../lib/v2/ingest/shp.ts");
const { insertFeature, queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { buildBuildings, heightOf, validDate, FLOOR_HEIGHT_M } = await import("../../lib/v2/ingest/sources/buildings.ts");
const { ledgerFloorLookup } = await import("../../lib/v2/ingest/sources/ledger.ts");

// ─── 순수 함수 ─────────────────────────────────────────────────────────────
assert.deepEqual(heightOf({ A16: 12.345, A26: 4 }), { heightM: 12.35, method: "source", floorsAbove: 4 });
assert.deepEqual(heightOf({ A16: 0, A26: 5 }), { heightM: 5 * FLOOR_HEIGHT_M, method: "floors_estimate", floorsAbove: 5 });
assert.deepEqual(heightOf({ A16: 0, A26: 0 }), { heightM: null, method: "unknown", floorsAbove: null });
assert.deepEqual(heightOf({ A16: null, A26: null }), { heightM: null, method: "unknown", floorsAbove: null });
assert.equal(heightOf({ A16: 0, A26: 2 }, 3.5).heightM, 7);
assert.deepEqual(heightOf({ A16: 0, A26: 0 }, 3, { ledgerPk: "TITLE-1", floorsAbove: 7, method: "ledger_pk" }), {
  heightM: 21,
  method: "ledger_floors_estimate",
  floorsAbove: 7,
  ledgerMatch: { ledgerPk: "TITLE-1", floorsAbove: 7, method: "ledger_pk" },
});
assert.equal(validDate("1978-02-02", 2026), "1978-02-02");
for (const bad of ["1978-02-30", "0991-04-12", "7982-01-01", "1978-13-01", "19780202", "", null]) assert.equal(validDate(bad, 2026), null, String(bad));

// ─── 즉석 SHP/DBF 쓰기 (EPSG:5186, 사각형 폴리곤) ───────────────────────────
function writeShp(dir, base, rows) {
  const recs = rows.map((r) => {
    const ring = [[r.x, r.y], [r.x, r.y + r.d], [r.x + r.d, r.y + r.d], [r.x + r.d, r.y], [r.x, r.y]]; // 시계 방향(외곽)
    return { ring };
  });
  const contentLen = 48 + 5 * 16; // type 4 + bbox 32 + numParts 4 + numPoints 4 + parts[0] 4 + 5 points
  const total = 100 + recs.length * (8 + contentLen);
  const shp = Buffer.alloc(total);
  shp.writeInt32BE(9994, 0);
  shp.writeInt32BE(total / 2, 24);
  shp.writeInt32LE(1000, 28);
  shp.writeInt32LE(5, 32);
  let o = 100;
  recs.forEach(({ ring }, i) => {
    shp.writeInt32BE(i + 1, o);
    shp.writeInt32BE(contentLen / 2, o + 4);
    o += 8;
    shp.writeInt32LE(5, o);
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, k) => shp.writeDoubleLE(v, o + 4 + k * 8));
    shp.writeInt32LE(1, o + 36); // numParts
    shp.writeInt32LE(5, o + 40); // numPoints
    shp.writeInt32LE(0, o + 44); // parts[0]
    ring.forEach((p, k) => {
      shp.writeDoubleLE(p[0], o + 48 + k * 16);
      shp.writeDoubleLE(p[1], o + 56 + k * 16);
    });
    o += contentLen;
  });
  writeFileSync(join(dir, `${base}.shp`), shp);
  writeFileSync(join(dir, `${base}.prj`), 'PROJCS["Korea_2000_Korea_Central_Belt_2010", GEOGCS["GCS_Korea_2000"]]');
  writeFileSync(join(dir, `${base}.cpg`), "UTF-8");

  const fields = [["A1", "C", 28], ["A2", "C", 19], ["A3", "C", 10], ["A8", "C", 5], ["A12", "N", 12], ["A13", "C", 10], ["A14", "N", 12], ["A16", "N", 12], ["A21", "C", 17], ["A24", "C", 40], ["A26", "N", 9], ["A27", "N", 9]];
  const recLen = 1 + fields.reduce((s, f) => s + f[2], 0);
  const hdrLen = 32 + 32 * fields.length + 1;
  const dbf = Buffer.alloc(hdrLen + rows.length * recLen + 1, 0x20);
  dbf[0] = 3;
  dbf.writeUInt32LE(rows.length, 4);
  dbf.writeUInt16LE(hdrLen, 8);
  dbf.writeUInt16LE(recLen, 10);
  fields.forEach(([name, type, len], i) => {
    const h = 32 + i * 32;
    dbf.fill(0, h, h + 32);
    dbf.write(name, h, "latin1");
    dbf.write(type, h + 11, "latin1");
    dbf[h + 16] = len;
  });
  dbf[32 + 32 * fields.length] = 0x0d;
  rows.forEach((r, ri) => {
    let p = hdrLen + ri * recLen;
    dbf[p++] = 0x20;
    for (const [name, type, len] of fields) {
      const v = r.a[name];
      const s = v === undefined || v === null ? "" : String(v);
      const cell = type === "N" ? s.padStart(len, " ") : s.padEnd(len, " ");
      dbf.write(cell.slice(0, len), p, "utf8");
      p += len;
    }
  });
  dbf[dbf.length - 1] = 0x1a;
  writeFileSync(join(dir, `${base}.dbf`), dbf);
  return join(dir, `${base}.shp`);
}

const pnu = "4113510300100010000";
const base = { A2: pnu, A3: "4113510300" };
const rows = [
  { x: 208000, y: 542000, d: 20, a: { ...base, A1: "U-SRC", A8: "02000", A12: 400, A13: "2004-06-14", A14: 2000, A16: 24.5, A21: "B001", A24: "테스트아파트", A26: 8, A27: 1 } },
  { x: 208100, y: 542000, d: 20, a: { ...base, A1: "U-FLOORS", A8: "01000", A13: "1978-02-02", A16: 0, A26: 3, A27: 0 } },
  { x: 208200, y: 542000, d: 20, a: { ...base, A1: "U-NONE" } }, // 대장 없는 건물
  { x: 208300, y: 542000, d: 20, a: { ...base, A1: "U-BADDATE", A8: "03000", A13: "7982-01-01", A16: 9, A26: 2 } },
  { x: 208400, y: 542000, d: 20, a: { ...base, A1: "U-SRC" } }, // 중복 UFID → 거부
  { x: 208500, y: 542000, d: 20, a: { ...base, A1: "", A2: "abc" } }, // UFID 없음 → 거부
  { x: 208600, y: 542000, d: 20, a: { A1: "U-NOPNU", A2: "", A3: "", A16: 5 } }, // PNU·법정동 없음: 적재하되 지역 (미상)
];
const dir = mkdtempSync(join(tmpdir(), "v2-bld-"));
const shpPath = writeShp(dir, "AL_D010_41_20260909", rows);

const db = new Database(":memory:");
initDataFileSchema(db, "buildings");
const rel = insertRelease(db, { sourceId: "building", provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
const stats = await buildBuildings(db, readShp(shpPath), rel, { maxYear: 2026 });

assert.equal(stats.received, 7);
assert.equal(stats.received, stats.accepted + stats.unlocated + stats.rejected);
assert.deepEqual([stats.accepted, stats.rejected], [5, 2]);
assert.deepEqual(stats.byType, { source: 3, floors_estimate: 1, unknown: 1 });
assert.deepEqual(stats.byRegion, { 41: 4, "(미상)": 1 });
const snap = stats.snapshot();
assert.equal(snap.fillRates.heightM, 4 / 5);
assert.equal(snap.fillRates.approvalDate, 2 / 5); // 7982-01-01은 null

const fact = (id) => db.prepare("SELECT b.*, f.pnu, f.legal_code, f.name FROM building_fact b JOIN feature f USING (feature_id) WHERE f.stable_id = ?").get(`building:${id}`);
const a = fact("U-SRC");
assert.deepEqual([a.height_m, a.height_method, a.floors_above, a.floors_below, a.use_code, a.approval_date, a.gross_floor_area_m2, a.footprint_area_m2, a.ledger_pk, a.pnu, a.legal_code, a.name],
  [24.5, "source", 8, 1, "02000", "2004-06-14", 2000, 400, "B001", pnu, "4113510300", "테스트아파트"]);
const f = fact("U-FLOORS");
assert.deepEqual([f.height_m, f.height_method, f.floors_above, f.use_code], [9, "floors_estimate", 3, "01000"]);
assert.equal(JSON.parse(f.field_provenance_json).height_m.floorHeightM, 3);
const n = fact("U-NONE");
assert.deepEqual([n.height_m, n.height_method, n.floors_above, n.use_code, n.approval_date], [null, "unknown", null, null, null]);
assert.equal(fact("U-BADDATE").approval_date, null);
assert.equal(fact("U-NOPNU").pnu, null);
assert.equal(db.prepare("SELECT COUNT(*) FROM building_fact").pluck().get(), 5);

// ─── A24 이름: W4 유효성만 적용하고 trim된 원문은 그대로 저장·매칭한다 ─────
{
  const nameDb = new Database(":memory:");
  initDataFileSchema(nameDb, "buildings");
  const nameRel = insertRelease(nameDb, { sourceId: "building", provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "names", licenseCode: "TEST" });
  const nameGeometry = { type: "Polygon", coordinates: [[[127, 37], [127.0001, 37], [127.0001, 37.0001], [127, 37.0001], [127, 37]]] };
  const nameRecord = (id, value) => ({ geometry: nameGeometry, properties: { A1: id, A3: "4113510300", A16: 0, A26: 0, A27: 0, A24: value } });
  async function* nameRows() {
    yield nameRecord("NAME-NORMAL", "  고덕아파트  ");
    yield nameRecord("NAME-FULLWIDTH", "  ＡＢＣ１２３  ");
    yield nameRecord("NAME-PLACEHOLDER", "---");
  }
  const ledgerInputs = [];
  const nameStats = await buildBuildings(nameDb, nameRows(), nameRel, { ledger: { match: (input) => { ledgerInputs.push(input); return null; } } });
  assert.equal(nameStats.accepted, 3);
  const storedName = (id) => nameDb.prepare("SELECT name FROM feature WHERE stable_id = ?").pluck().get(`building:${id}`);
  assert.deepEqual([storedName("NAME-NORMAL"), storedName("NAME-FULLWIDTH"), storedName("NAME-PLACEHOLDER")], ["고덕아파트", "ＡＢＣ１２３", null]);
  assert.deepEqual(ledgerInputs.map((input) => input.name), ["고덕아파트", "ＡＢＣ１２３", null], "ledger match와 feature 적재가 같은 정리 값을 사용");
  nameDb.close();
}

// ─── 표제부 층수 보강: 단일 동·다동 이름 매칭·비매칭 ─────────────────────────
{
  const core = new Database(":memory:");
  initDataFileSchema(core, "core");
  const coreRel = insertRelease(core, { sourceId: "ledger_title", provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "core", licenseCode: "TEST" });
  const pnuOne = "4113510300100010000";
  const pnuMany = "4113510300100020000";
  const pnuUnique = "4113510300100030000";
  const pnuAmbiguous = "4113510300100040000";
  const title = (id, pnuValue, name, ledgerPk, floors, footprint) => insertFeature(core, {
    stableId: `title:${id}`,
    kind: "officetel",
    sourceKey: ledgerPk,
    releaseId: coreRel,
    geometry: { type: "Point", coordinates: [127.1, 37.5] },
    name,
    pnu: pnuValue,
    properties: { ledgerPk, floorsAbove: floors, footprintAreaM2: footprint },
  });
  title("one", pnuOne, "1동", "TITLE-1", 6, 100);
  title("many-a", pnuMany, "A동", "TITLE-A", 4, 100);
  title("many-b", pnuMany, "B동", "TITLE-B", 7, 200);
  title("unique", pnuUnique, "단일동", "TITLE-U", 5, 150);
  title("ambiguous", pnuAmbiguous, "한동", "TITLE-D", 9, 300);
  const lookup = ledgerFloorLookup(core);
  assert.ok(lookup);
  const square = (x) => ({ type: "Polygon", coordinates: [[[127 + x, 37], [127.0001 + x, 37], [127.0001 + x, 37.0001], [127 + x, 37.0001], [127 + x, 37]]] });
  const row = (id, pnuValue, extra = {}, x = 0) => ({
    properties: { A1: id, A2: pnuValue, A3: "4113510300", A16: 0, A26: 0, ...extra },
    geometry: square(x),
  });
  async function* supplementRows() {
    yield row("LEDGER-DIRECT", pnuOne, { A21: "TITLE-1", A24: "1동" }, 0);
    yield row("LEDGER-NAME", pnuMany, { A21: "NOT-TITLE", A24: "B동", A12: 200 }, 0.001);
    yield row("LEDGER-AREA", pnuMany, { A21: "NOT-TITLE-AREA", A24: "없는동", A12: 100 }, 0.002);
    yield row("LEDGER-NO-NAME", pnuMany, { A21: "NOT-TITLE-2", A24: "없는동" }, 0.003);
    yield row("LEDGER-UNIQUE", pnuUnique, { A24: "단일동" }, 0.004);
    yield row("LEDGER-DUP-A", pnuAmbiguous, { A24: "알수없음" }, 0.005);
    yield row("LEDGER-DUP-B", pnuAmbiguous, { A24: "알수없음" }, 0.006);
  }
  const buildings = new Database(":memory:");
  initDataFileSchema(buildings, "buildings");
  const buildingRel = insertRelease(buildings, { sourceId: "building", provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "buildings", licenseCode: "TEST" });
  const supplementStats = await buildBuildings(buildings, supplementRows(), buildingRel, { maxYear: 2026, ledger: lookup });
  assert.deepEqual(supplementStats.byType, { ledger_floors_estimate: 4, unknown: 3 });
  assert.equal(supplementStats.snapshot().fillRates.heightM, 4 / 7);
  const supplementFact = (id) => buildings.prepare("SELECT b.height_m, b.height_method, b.floors_above, b.field_provenance_json FROM building_fact b JOIN feature f USING (feature_id) WHERE f.stable_id = ?").get(`building:${id}`);
  const direct = supplementFact("LEDGER-DIRECT");
  assert.deepEqual([direct.height_m, direct.height_method, direct.floors_above], [18, "ledger_floors_estimate", 6]);
  assert.equal(JSON.parse(direct.field_provenance_json).height_m.ledger_pk, "TITLE-1");
  assert.equal(JSON.parse(direct.field_provenance_json).height_m.match, "ledger_pk");
  const named = supplementFact("LEDGER-NAME");
  assert.deepEqual([named.height_m, named.height_method, named.floors_above], [21, "ledger_floors_estimate", 7]);
  assert.equal(JSON.parse(named.field_provenance_json).height_m.match, "pnu_name");
  const area = supplementFact("LEDGER-AREA");
  assert.deepEqual([area.height_m, area.height_method, area.floors_above], [12, "ledger_floors_estimate", 4]);
  assert.equal(JSON.parse(area.field_provenance_json).height_m.match, "pnu_area");
  const unique = supplementFact("LEDGER-UNIQUE");
  assert.deepEqual([unique.height_m, unique.height_method, unique.floors_above], [15, "ledger_floors_estimate", 5]);
  assert.equal(JSON.parse(unique.field_provenance_json).height_m.match, "pnu_unique");
  assert.equal(supplementFact("LEDGER-NO-NAME").height_method, "unknown", "다동에서 동을 특정하지 못하면 미상 유지");
  assert.equal(supplementFact("LEDGER-DUP-A").height_method, "unknown", "한 PNU 복수 건물은 유일 PNU 추정을 금지");
  assert.equal(supplementFact("LEDGER-DUP-B").height_method, "unknown", "한 PNU 복수 건물은 유일 PNU 추정을 금지");
  buildings.close();
  core.close();
}

// 도형: EPSG:5179 미터, 반경 조회로 다시 나오고 좌표는 1 cm 단위다
const hits = queryFeaturesInRadius(db, proj4("EPSG:5186", "EPSG:4326").forward([208300, 542010]), 2000, ["building"]);
assert.equal(hits.length, 5);
const ring = hits[0].geometry.coordinates[0];
assert.equal(ring.length, 5);
assert.ok(ring.flat().every((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6), "좌표는 cm 단위");
const width = Math.hypot(ring[0][0] - ring[3][0], ring[0][1] - ring[3][1]);
assert.ok(Math.abs(width - 20) < 0.05, `5186→5179 재투영 후에도 변 길이 20 m: ${width}`);

// keep 필터: 정리 전 원본 속성으로 거른다
{
  const kept = [];
  for await (const r of readShp(shpPath, { keep: (p) => p.A1 === "U-FLOORS" })) kept.push(r.properties.A1);
  assert.deepEqual(kept, ["U-FLOORS"]);
}
// ─── buildings 파일: core 없이/있이 빌드·게시, 현재 core를 읽기 전용으로 받는다 ─────────────
{
  const M = await import("../../lib/v2/data/manifest.ts");
  const B = await import("../../lib/v2/ingest/build.ts");
  const dataDir = mkdtempSync(join(tmpdir(), "v2-bld-file-"));
  const center = proj4("EPSG:5186", "EPSG:4326").forward([208300, 542010]);
  const coreBuilder = async (cdb) => {
    const r = insertRelease(cdb, { sourceId: "legal_areas", provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: "2026-09-01", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
    const s = new B.SourceStats("legal_areas", r, []);
    s.read();
    s.accept({}, "41", "sigungu");
    return [s];
  };
  const shp = () => readShp(shpPath);
  const buildingsBuilder = (seen) => async (bdb, ctx) => {
    seen.core = ctx.core;
    assert.throws(() => ctx.core.prepare("CREATE TABLE x (a)").run(), /readonly/, "core는 읽기 전용");
    const r = insertRelease(bdb, { sourceId: "building", provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
    return [await buildBuildings(bdb, shp(), r, { maxYear: 2026 })];
  };

  // 옛 매니페스트: buildings 없음 → 그대로 유효
  const a = await B.buildAndPublish({ dataDir, version: "a", builders: { core: coreBuilder } });
  assert.equal(a.published, true, JSON.stringify(a.failures));
  assert.deepEqual(Object.keys(M.readManifest(dataDir).files), ["core"]);

  // --only buildings: 현재 core를 재사용
  const seen = {};
  const b = await B.buildAndPublish({ dataDir, version: "b", builders: { buildings: buildingsBuilder(seen) } });
  assert.equal(b.published, true, JSON.stringify(b.failures));
  assert.ok(seen.core, "현재 core가 ctx.core로 전달됨");
  const m = M.readManifest(dataDir);
  assert.equal(m.files.core.path, "versions/a/core.sqlite");
  assert.equal(m.files.buildings.path, "versions/b/buildings.sqlite");
  assert.equal(m.files.buildings.kind, "buildings");
  const bdb = M.openDataFile(dataDir, m, "buildings");
  assert.equal(queryFeaturesInRadius(bdb, center, 2000, ["building"]).length, 5);
  assert.equal(queryFeaturesInRadius(bdb, center, 30, ["building"]).length, 1, "반경 30 m: U-BADDATE 한 동");
  assert.equal(bdb.prepare("SELECT COUNT(*) FROM building_fact").pluck().get(), 5);
  bdb.close();
  const cdb = M.openDataFile(dataDir, m, "core");
  assert.equal(cdb.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name='building_fact'").pluck().get(), 0, "core에는 building_fact가 없다");
  cdb.close();

  // core만 다시 빌드해도 buildings 항목은 유지된다
  const c = await B.buildAndPublish({ dataDir, version: "c", builders: { core: coreBuilder } });
  assert.equal(c.published, true, JSON.stringify(c.failures));
  assert.equal(M.readManifest(dataDir).files.buildings.path, "versions/b/buildings.sqlite");
}
console.log("buildings ok");

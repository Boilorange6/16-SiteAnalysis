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
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { buildBuildings, heightOf, validDate, FLOOR_HEIGHT_M } = await import("../../lib/v2/ingest/sources/buildings.ts");

// ─── 순수 함수 ─────────────────────────────────────────────────────────────
assert.deepEqual(heightOf({ A16: 12.345, A26: 4 }), { heightM: 12.35, method: "source", floorsAbove: 4 });
assert.deepEqual(heightOf({ A16: 0, A26: 5 }), { heightM: 5 * FLOOR_HEIGHT_M, method: "floors_estimate", floorsAbove: 5 });
assert.deepEqual(heightOf({ A16: 0, A26: 0 }), { heightM: null, method: "unknown", floorsAbove: null });
assert.deepEqual(heightOf({ A16: null, A26: null }), { heightM: null, method: "unknown", floorsAbove: null });
assert.equal(heightOf({ A16: 0, A26: 2 }, 3.5).heightM, 7);
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
initDataFileSchema(db, "core");
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
console.log("buildings ok");

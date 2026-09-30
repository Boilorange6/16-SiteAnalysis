/**
 * 용도지역(VWorld dsId 24) 적재 테스트. 작은 SHP를 여기서 직접 써서 readShp 경로까지 지난다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import proj4 from "proj4";

const { readShp } = await import("../../lib/v2/ingest/shp.ts"); // proj4 정의 등록
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildZoning, zoningClass, zoningLayerFiles, isoDate, ZONING_LAYERS, ZONING_RIGHTS } = await import("../../lib/v2/ingest/sources/zoning.ts");

// ─── SHP/DBF 최소 작성기 (폴리곤, EPSG:5186, .cpg UTF-8) ─────────────────────
const PRJ = 'PROJCS["KGD2002_Central_Belt_2010",GEOGCS["GCS_KGD2002",DATUM["D_Korea_Geodetic_Datum_2002",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",127.0],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]';
const to5186 = (lng, lat) => proj4("EPSG:4326", "EPSG:5186", [lng, lat]);
/** [lng,lat] 중심의 한 변 d(도) 사각형 */
const square = (lng, lat, d) => [[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]].map(([x, y]) => to5186(x, y));

function writeShp(base, rows) {
  const recs = rows.map((r, i) => {
    if (!r.ring) return { i, body: Buffer.alloc(4) }; // null shape
    const n = r.ring.length;
    const b = Buffer.alloc(44 + 4 + 16 * n);
    b.writeInt32LE(5, 0);
    const xs = r.ring.map((p) => p[0]), ys = r.ring.map((p) => p[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, k) => b.writeDoubleLE(v, 4 + 8 * k));
    b.writeInt32LE(1, 36);
    b.writeInt32LE(n, 40);
    b.writeInt32LE(0, 44);
    r.ring.forEach((p, k) => { b.writeDoubleLE(p[0], 48 + 16 * k); b.writeDoubleLE(p[1], 56 + 16 * k); });
    return { i, body: b };
  });
  const len = 100 + recs.reduce((a, r) => a + 8 + r.body.length, 0);
  const shp = Buffer.alloc(len);
  shp.writeInt32BE(9994, 0);
  shp.writeInt32BE(len / 2, 24);
  shp.writeInt32LE(1000, 28);
  shp.writeInt32LE(5, 32);
  let o = 100;
  for (const r of recs) {
    shp.writeInt32BE(r.i + 1, o);
    shp.writeInt32BE(r.body.length / 2, o + 4);
    r.body.copy(shp, o + 8);
    o += 8 + r.body.length;
  }
  writeFileSync(`${base}.shp`, shp);
  const fields = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"];
  const W = 60;
  const head = Buffer.alloc(32 + 32 * fields.length + 1);
  head[0] = 3;
  head.writeUInt32LE(rows.length, 4);
  head.writeUInt16LE(head.length, 8);
  head.writeUInt16LE(1 + W * fields.length, 10);
  fields.forEach((f, k) => { head.write(f, 32 + 32 * k, "ascii"); head[32 + 32 * k + 11] = 0x43; head[32 + 32 * k + 16] = W; });
  head[head.length - 1] = 0x0d;
  const body = Buffer.concat(rows.map((r, i) => {
    const vals = [String(i), r.A1, "레이어", "2026-09-05", r.A4, r.A5, r.A6, r.A7, r.A8, r.A9].map((v) => v ?? "");
    return Buffer.concat([Buffer.from(" "), ...vals.map((v) => { const b = Buffer.alloc(W, 0x20); b.write(v, "utf8"); return b; })]);
  }));
  writeFileSync(`${base}.dbf`, Buffer.concat([head, body]));
  writeFileSync(`${base}.prj`, PRJ);
  writeFileSync(`${base}.cpg`, "UTF-8");
}

const dir = mkdtempSync(join(tmpdir(), "zoning-"));
const G = [127.05, 37.5]; // 강남
const K = [127.15, 37.55]; // 강동
writeShp(join(dir, "AL_D124_00_20260909"), [
  { A1: "ID-1", A4: "11680", A5: "UQA122", A6: "제2종일반주거지역", A7: "20190801", A8: "7층이하", ring: square(...G, 0.01) },
  { A1: "ID-2", A4: "11680", A5: "UQA220", A6: "일반상업지역", A7: "20140100", ring: square(...G, 0.005) }, // 위 폴리곤 안에 겹침 → 그대로 둔다
  { A1: "ID-1", A4: "11740", A5: "UQA122", A6: "제2종일반주거지역", ring: square(...K, 0.01) }, // 같은 지정ID, 다른 도형
  { A1: "ID-3", A4: "11740", A5: "UQA999", A6: "도시지역기타", ring: square(127.3, 37.55, 0.01) },
  { A1: "ID-4", A4: "11740", A5: "UQA430", A6: "자연녹지지역", ring: null }, // 도형 없음 → reject
  { A1: "ID-5", A4: "xx", A5: "UQA430", A6: "자연녹지지역", ring: square(127.4, 37.55, 0.01) }, // 시군구 코드 이상 → reject
]);
writeShp(join(dir, "AL_D125_00_20260909"), [{ A1: "M-1", A4: "41610", A5: "UQB300", A6: "계획관리지역", A7: "20200101", ring: square(127.5, 37.4, 0.01) }]);

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const rel = (l) => insertRelease(db, { sourceId: l.sourceId, provider: "국토교통부(VWorld 일별용도지역지구정보)", sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=24", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED", rights: ZONING_RIGHTS });
const layer = (k) => ZONING_LAYERS.find((l) => l.key === k);
const stats = await buildZoning(db, [
  { layer: "urban", releaseId: rel(layer("urban")), records: readShp(join(dir, "AL_D124_00_20260909.shp")) },
  { layer: "management", releaseId: rel(layer("management")), records: readShp(join(dir, "AL_D125_00_20260909.shp")) },
]);

// ─── 1. SourceStats 불변식·시도별·분류별 ────────────────────────────────────
for (const s of stats) assert.equal(s.received, s.accepted + s.unlocated + s.rejected, s.sourceId);
assert.deepEqual(stats.map((s) => [s.sourceId, s.received, s.accepted, s.rejected]), [["zoning_urban", 6, 4, 2], ["zoning_management", 1, 1, 0]]);
assert.deepEqual(stats[0].byRegion, { 11: 4 });
assert.deepEqual(stats[0].byType, { 주거: 2, 상업: 1, 기타: 1 });
assert.deepEqual(stats[1].byRegion, { 41: 1 });
assert.deepEqual(stats[1].byType, { 관리: 1 });
assert.equal(stats[0].snapshot().fillRates.designatedDate, 0.5);

// ─── 2. 겹침 보존·같은 지정ID·속성 ──────────────────────────────────────────
const ids = db.prepare("SELECT stable_id FROM feature ORDER BY feature_id").pluck().all();
assert.deepEqual(ids, ["zoning:ID-1", "zoning:ID-2", "zoning:ID-1#1", "zoning:ID-3", "zoning:M-1"]);
const hits = queryFeaturesInRadius(db, G, 100, ["zoning_area"]);
assert.deepEqual(hits.map((h) => h.properties.zoningName).sort(), ["일반상업지역", "제2종일반주거지역"], "겹친 두 지정 모두 반환");
const res = hits.find((h) => h.properties.zoningClass === "주거");
assert.equal(res.legalCode, "1168000000");
assert.deepEqual(res.properties.remark, ["7층이하"]);
assert.equal(res.properties.designatedDate, "2019-08-01");
assert.equal(hits.find((h) => h.properties.zoningClass === "상업").properties.designatedDate, "20140100", "월·일 00은 원문 유지");
assert.equal(queryFeaturesInRadius(db, [127.5, 37.4], 100, ["zoning_area"])[0].properties.zoningClass, "관리");

// 좌표는 10 cm로 반올림해 저장한다(파일 크기)
for (const g of db.prepare("SELECT geom_json FROM feature").pluck().all()) assert.ok(!/\.\d{2,}[,\]]/.test(g), g.slice(0, 120));

// ─── 3. 권리 근거 기록 ─────────────────────────────────────────────────────
const rights = JSON.parse(db.prepare("SELECT rights_json FROM source_release WHERE source_id='zoning_urban'").pluck().get());
assert.match(rights.basis, /15045898/);
assert.match(rights.excluded, /15147018/);

// ─── 4. 분류·날짜·파일 고르기 ───────────────────────────────────────────────
const urban = layer("urban");
assert.equal(zoningClass(urban, "준주거지역", "UQA130"), "주거");
assert.equal(zoningClass(urban, "중심상업지역", null), "상업");
assert.equal(zoningClass(urban, "전용공업지역", null), "공업");
assert.equal(zoningClass(urban, "보전녹지지역", null), "녹지");
assert.equal(zoningClass(urban, "도시지역미분류", "UQA000"), "기타");
assert.equal(zoningClass(urban, null, "UQA112"), "주거", "이름이 없으면 코드");
assert.equal(zoningClass(layer("nature"), null, null), "자연환경보전");
assert.equal(zoningClass(layer("agri_forest"), "농림지역", "UQC001"), "농림");
assert.equal(isoDate("20190801"), "2019-08-01");
assert.equal(isoDate(null), null);
const files = zoningLayerFiles(["/r/AL_D124_00_20260101.shp", "/r/AL_D124_00_20260909.shp", "/r/AL_D124_00_20260909(2).shp", "/r/AL_D125_00_20260909.shp", "/r/AL_D001_00_20260909.shp"]);
assert.deepEqual([...files.keys()], ["urban", "management"]);
assert.deepEqual(files.get("urban").files, ["/r/AL_D124_00_20260909.shp", "/r/AL_D124_00_20260909(2).shp"]);
console.log("ok zoning");

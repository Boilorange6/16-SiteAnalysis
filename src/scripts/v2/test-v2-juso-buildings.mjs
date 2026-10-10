/**
 * 행안부 도로명주소 건물 보조 원천: EUC-KR·NUL 디코딩, EPSG:5179 좌표, GIS건물과의 겹침 제거, 높이·이름 보태기, 단계별 재개.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { beginFeatureBulk, insertFeature } = await import("../../lib/v2/data/features.ts");
const { buildAndPublish, buildResumableSteps, insertRelease, SourceStats, ensureBuildProgressSchema } = await import("../../lib/v2/ingest/build.ts");
const { readShp } = await import("../../lib/v2/ingest/shp.ts");
const { FLOOR_HEIGHT_M } = await import("../../lib/v2/ingest/sources/buildings.ts");
const { buildJusoBuildings, gisFeatureIdBound, jusoShpPerSido, shpExtent, overlapArea, planarArea, JUSO_SOURCE_ID, normalizeBuildingName, composeBuildingName } = await import("../../lib/v2/ingest/sources/juso-buildings.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");

// ─── 순수 함수 ─────────────────────────────────────────────────────────────
const sq = (x, y, d = 20) => ({ type: "Polygon", coordinates: [[[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]]] });
assert.equal(planarArea(sq(0, 0)), 400);
assert.equal(planarArea({ type: "Polygon", coordinates: [sq(0, 0).coordinates[0], sq(5, 5, 10).coordinates[0]] }), 300, "구멍은 뺀다");
assert.equal(Math.round(overlapArea(sq(0, 0), sq(12, 0))), 160);
assert.equal(overlapArea(sq(0, 0), sq(100, 0)), 0);
// ─── 건물명 조립: 비교용 normalize와 표시용 compose를 분리한다 ────────────────
assert.equal(composeBuildingName("고덕", "고덕"), "고덕", "같은 건물명은 한 번만 표시");
assert.equal(composeBuildingName("고덕-아파트", "고덕 아파트"), "고덕-아파트", "normalize가 같은 값은 표시용 첫 값을 유지");
assert.equal(composeBuildingName("고덕", "고덕아파트"), "고덕아파트", "상세명이 더 길면 더 정보가 많은 쪽만 표시");
assert.equal(composeBuildingName("고덕아파트", "고덕"), "고덕아파트", "건물명이 더 길면 더 정보가 많은 쪽만 표시");
assert.equal(composeBuildingName(".", null), null, "점만 있는 값은 후보에서 제거");
assert.equal(composeBuildingName(null, "-"), null, "하이픈만 있는 값은 후보에서 제거");
assert.equal(composeBuildingName(null, "ㄱ"), null, "호환 자모만 있는 상세명은 후보에서 제거");
assert.equal(composeBuildingName("고덕", "   "), "고덕", "공백만 있는 상세명은 후보에서 제거");
assert.equal(composeBuildingName("!!!", "101동"), "101동", "문자·숫자 없는 구두점 값은 후보에서 제거");
assert.equal(composeBuildingName("고덕", null), "고덕", "건물명만 있으면 그대로 표시");
assert.equal(composeBuildingName(null, "101동"), "101동", "상세명만 있으면 그대로 표시");
assert.equal(composeBuildingName("고덕 아파트", "101동"), "고덕 아파트 101동", "서로 다른 값은 표시 문자열 사이를 공백으로 잇는다");
assert.equal(normalizeBuildingName("고덕-아파트"), normalizeBuildingName("고덕 아파트"), "normalize는 비교용으로 구두점·공백을 무시한다");
{
  // 볼록 빠른 경로(Sutherland–Hodgman)가 polyclip(turf)과 같은 면적을 낸다: 회전한 사각형·삼각형·오목 L자
  const { intersect, featureCollection, feature } = await import("@turf/turf");
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const shape = () => {
    const [cx, cy, r, rot] = [rnd() * 30, rnd() * 30, 5 + rnd() * 15, rnd() * Math.PI];
    const k = [3, 4, 4, 6, 0, -1, -1][Math.floor(rnd() * 7)];
    const pts = k === -1 ? Array.from({ length: 10 }, (_, i) => [cx + r * (i % 2 ? 0.45 : 1) * Math.cos(rot + (Math.PI * i) / 5), cy + r * (i % 2 ? 0.45 : 1) * Math.sin(rot + (Math.PI * i) / 5)]) : k === 0 ? [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]].map(([x, y]) => [cx + x * r / 2, cy + y * r / 2]) : Array.from({ length: k }, (_, i) => [cx + r * Math.cos(rot + (2 * Math.PI * i) / k), cy + r * Math.sin(rot + (2 * Math.PI * i) / k)]);
    return { type: "Polygon", coordinates: [[...pts, pts[0]]] };
  };
  for (let i = 0; i < 1500; i++) {
    const [a, b] = [shape(), shape()];
    const r = intersect(featureCollection([feature(a), feature(b)]));
    const want = r ? planarArea(r.geometry) : 0;
    assert.ok(Math.abs(overlapArea(a, b) - want) < 1e-6 * Math.max(1, want), `pair ${i}: ${overlapArea(a, b)} vs ${want}`);
  }
}
const picked =jusoShpPerSido(["a/TL_SPBD_BULD_11_202608.shp", "b/TL_SPBD_BULD_11_202609.shp", "b/TL_SPBD_BULD_41_202609.shp", "x/AL_D010_11_20260909.shp", "b/TL_SPBD_BULD_41_202609.dbf"]);
assert.deepEqual([...picked].map(([s, v]) => [s, v.date]), [["11", "202609"], ["41", "202609"]]);

// ─── 즉석 SHP/DBF (EPSG:5179, EUC-KR, NUL 채움) ──────────────────────────────
function writeJusoShp(dir, base, rows) {
  const contentLen = 48 + 5 * 16;
  const total = 100 + rows.length * (8 + contentLen);
  const shp = Buffer.alloc(total);
  shp.writeInt32BE(9994, 0);
  shp.writeInt32BE(total / 2, 24);
  shp.writeInt32LE(1000, 28);
  shp.writeInt32LE(5, 32);
  const all = rows.flatMap((r) => [[r.x, r.y], [r.x + r.d, r.y + r.d]]);
  [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))].forEach((v, k) => shp.writeDoubleLE(v, 36 + k * 8));
  let o = 100;
  rows.forEach((r, i) => {
    const ring = [[r.x, r.y], [r.x, r.y + r.d], [r.x + r.d, r.y + r.d], [r.x + r.d, r.y], [r.x, r.y]];
    shp.writeInt32BE(i + 1, o);
    shp.writeInt32BE(contentLen / 2, o + 4);
    o += 8;
    shp.writeInt32LE(5, o);
    [r.x, r.y, r.x + r.d, r.y + r.d].forEach((v, k) => shp.writeDoubleLE(v, o + 4 + k * 8));
    shp.writeInt32LE(1, o + 36);
    shp.writeInt32LE(5, o + 40);
    shp.writeInt32LE(0, o + 44);
    ring.forEach((p, k) => { shp.writeDoubleLE(p[0], o + 48 + k * 16); shp.writeDoubleLE(p[1], o + 56 + k * 16); });
    o += contentLen;
  });
  writeFileSync(join(dir, `${base}.shp`), shp);
  // 실제 파일과 같은 .prj(Korea 2000 Unified CS = EPSG:5179), .cpg 없음 → EUC-KR로 읽는다
  writeFileSync(join(dir, `${base}.prj`), 'PROJCS["Korea 2000 / Unified CS",GEOGCS["Korea 2000",DATUM["Geocentric_datum_of_Korea",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127.5],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",1000000],PARAMETER["false_northing",2000000],UNIT["metre",1],AXIS["Northing",NORTH],AXIS["Easting",EAST]]');

  const fields = [["BD_MGT_SN", "C", 25], ["BULD_NM", "C", 40], ["GRO_FLO_CO", "N", 9]];
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
    dbf.write(r.id.padEnd(25, " "), p, "latin1");
    p += 25;
    const name = Buffer.alloc(40, 0); // NUL 채움
    Buffer.from(r.nameBytes).copy(name);
    name.copy(dbf, p);
    p += 40;
    dbf.write(String(r.floors).padStart(9, " "), p, "latin1");
  });
  dbf[dbf.length - 1] = 0x1a;
  writeFileSync(join(dir, `${base}.dbf`), dbf);
  return join(dir, `${base}.shp`);
}

const GODEOK = [0xb0, 0xed, 0xb4, 0xf6]; // "고덕" EUC-KR
const shpDir = mkdtempSync(join(tmpdir(), "v2-juso-"));
const shpPath = writeJusoShp(shpDir, "TL_SPBD_BULD_11_202609", [
  { id: "1174010200103130000018118", x: 955220, y: 1954744, d: 20, nameBytes: GODEOK, floors: 3 },
  { id: "1174010200103130000018119", x: 955300, y: 1954744, d: 20, nameBytes: [], floors: 0 },
]);
assert.deepEqual(shpExtent(shpPath), [955220, 1954744, 955320, 1954764]);

const wgs = [];
for await (const r of readShp(shpPath)) wgs.push(r);
assert.equal(wgs[0].properties.BULD_NM, "고덕", "EUC-KR 디코딩 + NUL 채움 제거");
assert.equal(wgs[1].properties.BULD_NM, null, "NUL만 있으면 빈 값");
assert.equal(wgs[0].properties.GRO_FLO_CO, 3);
const [lng, lat] = wgs[0].geometry.coordinates[0][0];
assert.ok(Math.abs(lng - 126.9927) < 0.001 && Math.abs(lat - 37.5909) < 0.001, `5179 → 경위도: ${lng},${lat}`);
const [bx, by] = toUtmk([lng, lat]);
assert.ok(Math.hypot(bx - 955220, by - 1954744) < 0.01, "경위도를 다시 5179로 바꾸면 원래 좌표");
const native = [];
for await (const r of readShp(shpPath, { native: true })) native.push(r);
assert.deepEqual(native[0].geometry.coordinates[0][0], [955220, 1954744], "native는 재투영하지 않는다");

// ─── 겹침 제거 + 속성 보태기 ────────────────────────────────────────────────
const X0 = 955000, Y0 = 1954000;
const gisRel = (db) => insertRelease(db, { sourceId: "building", provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
const jusoRel = (db) => insertRelease(db, { sourceId: JUSO_SOURCE_ID, provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: "2026-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNKNOWN" });
function addGis(db, rel, id, geometry, { height = null, name = null, pnu = null, floors = null, useCode = null, approvalDate = null } = {}) {
  const fid = insertFeature(db, { stableId: `building:${id}`, kind: "building", sourceKey: id, releaseId: rel, geometry, geometryIsUtmk: true, name, pnu });
  db.prepare("INSERT INTO building_fact (feature_id, height_m, height_method, floors_above, use_code, approval_date, field_provenance_json) VALUES (?, ?, ?, ?, ?, ?, '{}')")
    .run(fid, height, height === null ? "unknown" : "source", floors, useCode, approvalDate);
  return fid;
}
async function* iter(list) {
  for (const x of list) yield x;
}
const jrec = (id, geometry, floors, nm = null, dc = null, overrides = {}) => ({ properties: { BD_MGT_SN: id, BULD_NM: nm, BULD_NM_DC: dc, GRO_FLO_CO: floors, UND_FLO_CO: 1, SIG_CD: "11740", EMD_CD: "102", LI_CD: "00", MNTN_YN: "0", LNBR_MNNM: 313, LNBR_SLNO: 2, BDTYP_CD: "02003", ...overrides }, geometry });
const extent = [X0 - 100, Y0 - 100, X0 + 1000, Y0 + 100];

{
  const db = new Database(":memory:");
  initDataFileSchema(db, "buildings");
  ensureBuildProgressSchema(db);
  beginFeatureBulk(db);
  const g = gisRel(db);
  const gA = addGis(db, g, "A", sq(X0, Y0), { height: 24 });
  const gB = addGis(db, g, "B", sq(X0 + 100, Y0));
  const gC = addGis(db, g, "C", sq(X0 + 200, Y0));
  const gD = addGis(db, g, "D", sq(X0 + 300, Y0), { height: 9 });
  const bound = gisFeatureIdBound(db);
  assert.equal(bound, gD);
  assert.equal(gisFeatureIdBound(db), bound, "처음 정한 상한을 유지");
  const j = jusoRel(db);
  const stats = await buildJusoBuildings(db, iter([
    jrec("J1", sq(X0, Y0), 9), // GIS A와 동일 → 겹침 제거, A는 높이가 있어 그대로
    jrec("J2", sq(X0 + 102, Y0), 5, "비동"), // GIS B와 거의 같음 → B에 5층·이름
    jrec("J3", sq(X0 + 500, Y0), 4, "신축", "101동"), // 새 건물
    jrec("J4", sq(X0 + 212, Y0), 6), // GIS C와 40%만 겹침 → 새 건물
    jrec("J5", sq(X0 + 700, Y0), 0), // 층수 0 → 높이 미상 새 건물
    jrec("J3", sq(X0 + 800, Y0), 2), // 같은 건물관리번호 → 거부
    jrec("J7", sq(X0 + 300, Y0), 3, "디동"), // GIS D(높이 있음)와 겹침 → 이름만
    { properties: { BD_MGT_SN: "J8" }, geometry: null }, // 도형 없음 → 거부
  ]), j, { extent, gisMaxFeatureId: bound });

  assert.equal(stats.received, 8);
  assert.deepEqual([stats.accepted, stats.rejected], [3, 5]);
  assert.deepEqual(stats.byType, { floors_estimate: 2, unknown: 1 });
  assert.deepEqual(JSON.parse(db.prepare("SELECT coverage_json FROM source_release WHERE source_id = ?").pluck().get(JUSO_SOURCE_ID)), { added: 3, deduped: 3, retired: 0, attachedHeight: 1, attachedName: 2, intersectErrors: 0, polyclipFallbacks: 0 });

  const fact = (id) => db.prepare("SELECT b.*, f.name, f.pnu, f.legal_code, f.release_id, f.properties_json FROM building_fact b JOIN feature f USING (feature_id) WHERE f.stable_id = ?").get(id);
  const a = fact("building:A");
  assert.deepEqual([a.height_m, a.height_method, a.name, a.field_provenance_json], [24, "source", null, "{}"], "높이 있는 GIS 건물은 그대로");
  const b = fact("building:B");
  assert.deepEqual([b.height_m, b.height_method, b.floors_above, b.name], [5 * FLOOR_HEIGHT_M, "floors_estimate", 5, "비동"]);
  const bp = JSON.parse(b.field_provenance_json);
  assert.equal(bp.height_m.source, "juso:GRO_FLO_CO*floorHeightM");
  assert.equal(bp.height_m.jusoBuildingMgtSn, "J2");
  assert.equal(bp.name.source, "juso:BULD_NM");
  const c = fact("building:C");
  assert.deepEqual([c.height_m, c.height_method, c.name], [null, "unknown", null], "40% 겹침은 같은 건물이 아니다");
  const d = fact("building:D");
  assert.deepEqual([d.height_m, d.height_method, d.name], [9, "source", "디동"], "높이는 두고 이름만");

  const n = fact("juso:J3");
  assert.deepEqual([n.height_m, n.height_method, n.floors_above, n.floors_below, n.name, n.use_code, n.approval_date, n.footprint_area_m2], [4 * FLOOR_HEIGHT_M, "floors_estimate", 4, 1, "신축 101동", null, null, 400], "사용승인일·용도는 만들지 않는다");
  assert.equal(n.release_id, j);
  assert.equal(n.legal_code, "1174010200");
  assert.equal(n.pnu, "1174010200103130002");
  assert.equal(JSON.parse(n.field_provenance_json).origin, "juso-supplement");
  assert.equal(JSON.parse(n.properties_json).bdtypCd, "02003");
  assert.equal(fact("juso:J4").height_m, 6 * FLOOR_HEIGHT_M);
  assert.deepEqual([fact("juso:J5").height_m, fact("juso:J5").height_method], [null, "unknown"]);
  assert.equal(db.prepare("SELECT COUNT(*) FROM feature").pluck().get(), 4 + 3);
  // 저장 좌표는 5179 그대로(1 cm 단위)
  assert.deepEqual(JSON.parse(db.prepare("SELECT geom_json FROM feature WHERE stable_id = 'juso:J3'").pluck().get()).coordinates[0][0], [X0 + 500, Y0]);
  void [gA, gB, gC];
}

// ─── 신축 대체 판정: core PNU 근거가 있을 때만 옛 GIS를 retired로 남긴다 ────────
{
  const core = new Database(":memory:");
  initDataFileSchema(core, "core");
  const coreRel = insertRelease(core, { sourceId: "ledger_recap", provider: "t", sourceUrl: "https://x.invalid/core", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "core", licenseCode: "TEST" });
  insertFeature(core, {
    stableId: "recap:replacement",
    kind: "housing_complex",
    sourceKey: "replacement",
    releaseId: coreRel,
    geometry: { type: "Point", coordinates: [X0, Y0] },
    geometryIsUtmk: true,
    pnu: "1174010200103130002",
    properties: { approvalDate: "2019-09-27" },
  });

  const db = new Database(":memory:");
  initDataFileSchema(db, "buildings");
  ensureBuildProgressSchema(db);
  beginFeatureBulk(db);
  const g = gisRel(db);
  const pnu = "1174010200103130002";
  addGis(db, g, "replacement-old", sq(X0, Y0, 100), { name: "고덕주공아파트", pnu, floors: 5, useCode: "02000", approvalDate: "1983-12-29" });
  addGis(db, g, "same-building", sq(X0 + 200, Y0, 100), { height: 15, name: "같은건물", approvalDate: "2019-09-27" });
  addGis(db, g, "no-evidence", sq(X0 + 400, Y0, 100), { name: "옛이름", approvalDate: "1983-12-29" });
  const bound = gisFeatureIdBound(db);
  const j = jusoRel(db);
  const stats = await buildJusoBuildings(db, iter([
    jrec("J-REPLACE", sq(X0 + 30, Y0, 100), 5, "고덕그라시움", "101동"), // 70% overlap + newer core date + different name
    jrec("J-SAME", sq(X0 + 230, Y0, 100), 5, "같은건물"), // same name and same approval date → GIS remains
    jrec("J-NOEVIDENCE", sq(X0 + 430, Y0, 100), 5, "새이름", null, { SIG_CD: null, EMD_CD: null, LI_CD: null }), // no PNU/core evidence → GIS remains
  ]), j, { extent: [X0 - 100, Y0 - 100, X0 + 1000, Y0 + 200], gisMaxFeatureId: bound, core, coreApprovalMaxDate: "2026-10-06" });

  assert.deepEqual([stats.accepted, stats.rejected], [1, 2], "대체 juso만 새 행으로 승인");
  assert.deepEqual(JSON.parse(db.prepare("SELECT coverage_json FROM source_release WHERE source_id = ?").pluck().get(JUSO_SOURCE_ID)), { added: 1, deduped: 2, retired: 1, attachedHeight: 1, attachedName: 0, intersectErrors: 0, polyclipFallbacks: 0 });
  const replacement = db.prepare("SELECT f.properties_json, b.floors_above, b.use_code, b.approval_date FROM feature f JOIN building_fact b USING (feature_id) WHERE f.stable_id = 'building:replacement-old'").get();
  assert.deepEqual([replacement.floors_above, replacement.use_code, replacement.approval_date], [5, "02000", "1983-12-29"], "옛 GIS 행과 추적 가능한 원천 속성은 삭제하지 않음");
  assert.deepEqual(JSON.parse(replacement.properties_json), { retired: true, retiredReason: "juso-newer-core-approval", replacedBy: "juso:J-REPLACE" });
  assert.equal(db.prepare("SELECT COUNT(*) FROM feature WHERE stable_id = 'juso:J-REPLACE'").pluck().get(), 1);
  assert.equal(db.prepare("SELECT COUNT(*) FROM feature WHERE stable_id IN ('juso:J-SAME', 'juso:J-NOEVIDENCE')").pluck().get(), 0);
  assert.equal(db.prepare("SELECT COUNT(*) FROM feature WHERE stable_id = 'building:same-building' AND properties_json = '{}'").pluck().get(), 1);
  assert.equal(db.prepare("SELECT COUNT(*) FROM feature WHERE stable_id = 'building:no-evidence' AND properties_json = '{}'").pluck().get(), 1);
  assert.deepEqual(db.prepare("SELECT from_stable_id, to_stable_id, relation_type, method FROM feature_link").get(), {
    from_stable_id: "building:replacement-old",
    to_stable_id: "juso:J-REPLACE",
    relation_type: "replaced_by",
    method: "overlap+core_pnu_approval+name",
  });
  core.close();
  db.close();
}

// ─── 단계별 재개: 시도 파일 한 단계, 어느 단계에서 죽어도 결과가 같다 ──────────────────
{
  const sidoRows = {
    "juso/11.shp": [jrec("S1", sq(X0 + 100, Y0), 7, "서울동"), jrec("S2", sq(X0 + 500, Y0), 3)],
    "juso/41.shp": [jrec("G1", sq(X0 + 700, Y0), 12, "경기동"), jrec("G2", sq(X0 + 200, Y0), 0, "씨동")],
  };
  function makePlan(dataDir, version, options = {}) {
    const calls = options.calls ?? [];
    let db_;
    const steps = [{
      file: { path: "gis/11.shp", size: 1, mtimeMs: 1_700_000_000_000, rows: 0 },
      run: async () => {
        calls.push("gis");
        const g = gisRel(db_);
        addGis(db_, g, "B", sq(X0 + 100, Y0));
        addGis(db_, g, "C", sq(X0 + 200, Y0));
        const s = new SourceStats("building", g, ["heightM"]);
        s.read();
        s.accept({}, "11", "unknown");
        return [s];
      },
    }];
    Object.keys(sidoRows).forEach((path, i) => steps.push({
      file: { path, size: 2 + i, mtimeMs: 1_700_000_000_000, rows: 0 },
      run: async () => {
        calls.push(path);
        const s = await buildJusoBuildings(db_, iter(sidoRows[path]), jusoRel(db_), { extent, gisMaxFeatureId: gisFeatureIdBound(db_) });
        if (options.failAfter === path) throw new Error("simulated kill");
        return [s];
      },
    }));
    const spec = { sourceId: "building", parameters: JSON.stringify({ fixture: "juso-v1" }), files: steps.map((s) => s.file) };
    return { dataDir, version, builders: { buildings: async (db) => { db_ = db; return buildResumableSteps(db, spec, steps); } }, progress: { buildings: spec }, resume: options.resume === true };
  }
  const snapshot = (dir, version) => {
    const db = new Database(join(dir, "versions", version, "buildings.sqlite"), { readonly: true });
    try {
      return {
        features: db.prepare("SELECT stable_id, name, pnu FROM feature ORDER BY stable_id").all(),
        facts: db.prepare("SELECT f.stable_id, b.height_m, b.height_method, b.floors_above, b.field_provenance_json FROM building_fact b JOIN feature f USING (feature_id) ORDER BY f.stable_id").all(),
        coverage: db.prepare("SELECT source_id, coverage_json FROM source_release ORDER BY source_id").all(),
      };
    } finally {
      db.close();
    }
  };
  const whole = mkdtempSync(join(tmpdir(), "v2-juso-whole-"));
  const killed = mkdtempSync(join(tmpdir(), "v2-juso-kill-"));
  const ok = await buildAndPublish(makePlan(whole, "v"));
  assert.equal(ok.published, true, JSON.stringify(ok.failures));
  const expected = snapshot(whole, "v");
  assert.deepEqual(expected.features.map((f) => f.stable_id), ["building:B", "building:C", "juso:G1", "juso:S2"], "S1·G2는 GIS B·C와 겹쳐 새 건물이 아니다");
  assert.equal(expected.facts.find((f) => f.stable_id === "building:B").height_m, 7 * FLOOR_HEIGHT_M, "GIS B에 서울동 7층");
  assert.equal(expected.facts.find((f) => f.stable_id === "building:C").height_method, "unknown");
  assert.equal(expected.features.find((f) => f.stable_id === "building:C").name, "씨동", "층수 0이어도 이름은 보탠다");

  const calls = [];
  await assert.rejects(buildAndPublish(makePlan(killed, "v", { calls, failAfter: "juso/41.shp" })), /simulated kill/);
  assert.deepEqual(calls, ["gis", "juso/11.shp", "juso/41.shp"]);
  const resumedCalls = [];
  const resumed = await buildAndPublish(makePlan(killed, "v", { resume: true, calls: resumedCalls }));
  assert.equal(resumed.published, true, JSON.stringify(resumed.failures));
  assert.deepEqual(resumedCalls, ["juso/41.shp"], "끝난 단계는 건너뛴다");
  assert.deepEqual(snapshot(killed, "v"), expected, "재개 결과가 중단 없는 빌드와 같다");
}
console.log("juso buildings ok");

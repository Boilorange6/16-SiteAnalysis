/**
 * 정비구역 경계(VWorld dsId 24 정비 5개 레이어) 적재 + 정비사업 명부 매칭 테스트. 작은 SHP를 여기서 직접 써서 readShp 경로까지 지난다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import proj4 from "proj4";

const { readShp } = await import("../../lib/v2/ingest/shp.ts"); // proj4 정의 등록
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildMaintenanceZones, mzoneLayerFiles, nameKeys, cleanZoneName, validDate, sigunguIndex, scorePair, MZONE_LAYERS, MZONE_RIGHTS, LINK_MIN_CONFIDENCE } = await import("../../lib/v2/ingest/sources/maintenance-zone.ts");

// ─── SHP/DBF 최소 작성기 (폴리곤, EPSG:5186, .cpg UTF-8) ─────────────────────
const PRJ = 'PROJCS["KGD2002_Central_Belt_2010",GEOGCS["GCS_KGD2002",DATUM["D_Korea_Geodetic_Datum_2002",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",127.0],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]';
const to5186 = (lng, lat) => proj4("EPSG:4326", "EPSG:5186", [lng, lat]);
const square = (lng, lat, d) => [[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]].map(([x, y]) => to5186(x, y));

function writeShp(base, rows) {
  const recs = rows.map((r, i) => {
    if (!r.ring) return { i, body: Buffer.alloc(4) };
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
    const vals = [String(i), r.A1, "레이어", "2026-09-05", r.A4, r.A5 ?? "UDT100", r.A6 ?? "정비구역", r.A7, r.A8, r.A9].map((v) => v ?? "");
    return Buffer.concat([Buffer.from(" "), ...vals.map((v) => { const b = Buffer.alloc(W, 0x20); b.write(v, "utf8"); return b; })]);
  }));
  writeFileSync(`${base}.dbf`, Buffer.concat([head, body]));
  writeFileSync(`${base}.prj`, PRJ);
  writeFileSync(`${base}.cpg`, "UTF-8");
}

// ─── 1. 이름 정규화 ──────────────────────────────────────────────────────────
assert.equal(nameKeys("제1구역").main, "1");
assert.equal(nameKeys("1구역").main, "1");
assert.equal(nameKeys("제기제6").main, "제기6", "이름 속 '제'는 남고 숫자 앞 '제'만 뺀다");
assert.equal(nameKeys("제기6구역").main, "제기6");
assert.equal(nameKeys("홍제제3주택재개발정비구역").main, "홍제3");
assert.equal(nameKeys("동삼1 재개발사업 정비구역").main, "동삼1");
assert.equal(nameKeys("범일2재개발구역").main, "범일2");
assert.deepEqual(nameKeys("달자01지구(달서구6)"), { main: "달자1", inner: ["달서구6"] });
assert.equal(nameKeys("산곡3구역<인천광역시 고시 제2020-129호>").main, "산곡3");
assert.deepEqual(nameKeys("정비구역"), { main: "", inner: [] }, "유형 이름뿐이면 비어 있다");
assert.deepEqual(nameKeys("신촌지역(마포)4-12지구").inner, [], "괄호 안 2글자는 키가 아니다");
// 이름 고르기: A8이 유형 이름뿐이면 A9
assert.deepEqual(cleanZoneName("정비구역", "효제1구역"), { name: "효제1구역", altName: null, source: "A9" });
assert.deepEqual(cleanZoneName("금호13구역", "금호제13구역 재개발"), { name: "금호13구역", altName: "금호제13구역 재개발", source: "A8" });
assert.deepEqual(cleanZoneName("금호13구역", "재개발사업"), { name: "금호13구역", altName: null, source: "A8" }, "유형 이름뿐인 A9는 보조 이름이 아니다");
assert.deepEqual(cleanZoneName("\u0000\u0000", null), { name: null, altName: null, source: null });
assert.equal(validDate("20190801"), "2019-08-01");
assert.equal(validDate("20140100"), null);
assert.equal(validDate("20190231"), null);
assert.equal(validDate(null), null);

// ─── 2. 시군구 이름 → 코드 ───────────────────────────────────────────────────
const sigungu = sigunguIndex([
  { code: "11680", name: "서울특별시 강남구" },
  { code: "11710", name: "서울특별시 송파구" },
  { code: "41135", name: "경기도 성남시 분당구" },
  { code: "41271", name: "경기도 안산시 상록구" },
  { code: "12270", name: "전남광주통합특별시 남구" },
]);
assert.equal(sigungu.get("41|성남분당구"), "41135");
assert.equal(sigungu.get("11|강남구"), "11680");

// ─── 3. 적재·매칭 (작은 SHP) ────────────────────────────────────────────────
const P = (id, sido, sg, name, type) => ({ id, sido, sigungu: sg, name, type });
const roster = [
  P("maint:gp5", "11", "강남구", "개포주공5단지", "재건축"),
  P("maint:dc1a", "11", "강남구", "대치1", "재개발"),
  P("maint:dc1b", "11", "강남구", "대치1구역 재개발사업", "미상"), // 같은 이름·같은 유형 후보 둘 → 모호
  P("maint:dg2", "11", "강남구", "도곡2", "재건축"),
  P("maint:jj1", "41", "성남분당구", "정자1", "재개발"),
  P("maint:jk6", "11", "강남구", "제기제6", "재개발"),
  P("maint:nam", "29", "남구", "봉선1", "재개발"), // 옛 광주 코드 29 → 12
  P("maint:sr", "41", "안산시", "군자주공9", "재건축"), // 구 없이 적힌 시 → 상록구 후보
  P("maint:big", "11", "강남구", "속초중앙동", "재개발"),
];
const dir = mkdtempSync(join(tmpdir(), "mzone-"));
const G = [127.05, 37.5];
writeShp(join(dir, "AL_D029_00_20260909"), [
  { A1: "Z1", A4: "11680", A9: "개포주공5단지 재건축 정비구역", A7: "20190801", ring: square(...G, 0.01) }, // 진짜 일치
  { A1: "Z2", A4: "11710", A9: "개포주공5단지 재건축 정비구역", ring: square(127.12, 37.5, 0.01) }, // 이름 같고 시군구 다름 → 잇지 않음
  { A1: "Z3", A4: "11680", A8: "정비구역", ring: square(127.06, 37.5, 0.005) }, // 이름 없음
  { A1: "Z4", A4: "11680", A8: "대치1구역", ring: square(127.07, 37.5, 0.005) }, // 후보 둘 → 모호
  { A1: "Z5", A4: "11680", A8: "도곡2 재개발 정비구역", A7: "20140100", ring: square(127.08, 37.5, 0.005) }, // 유형 충돌(재건축 사업) → 잇지 않음
  { A1: "Z6", A4: "41135", A9: "정자1구역", ring: square(127.11, 37.37, 0.005) }, // 분당 일치
  { A1: "Z7", A4: "11680", A8: "제기6구역", ring: square(127.09, 37.5, 0.005) }, // 제6 ↔ 6
  { A1: "Z8", A4: "12270", A8: "봉선1구역", ring: square(126.9, 35.13, 0.005) }, // 광주(옛 29) 사업
  { A1: "Z9", A4: "41271", A8: "군자주공9 재건축", ring: square(126.85, 37.3, 0.005) }, // 시 단위 명부 ↔ 구 코드
  { A1: "Z10", A4: "11680", A8: "중앙동 재개발", ring: square(127.1, 37.5, 0.005) }, // 사업명이 구역명보다 긴 경우는 잇지 않는다(구역명이 사업명을 품은 경우만)
  { A1: "Z11", A4: "11680", A8: "개포주공5단지", ring: null }, // 도형 없음 → reject
  { A1: "Z12", A4: "xx", A8: "개포주공5단지", ring: square(127.2, 37.5, 0.005) }, // 코드 이상 → reject
]);
writeShp(join(dir, "AL_D027_00_20260909"), [
  { A1: "R1", A4: "11680", A6: "재개발구역", A8: "도곡2", ring: square(127.13, 37.5, 0.005) }, // 재개발 레이어 ↔ 재건축 사업 → 유형 충돌
]);

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const rel = (l) => insertRelease(db, { sourceId: l.sourceId, provider: "국토교통부(VWorld 일별용도지역지구정보)", sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=24", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED", rights: MZONE_RIGHTS });
const layer = (k) => MZONE_LAYERS.find((l) => l.key === k);
const stats = await buildMaintenanceZones(db, [
  { layer: "zone", releaseId: rel(layer("zone")), records: readShp(join(dir, "AL_D029_00_20260909.shp")) },
  { layer: "redevelopment", releaseId: rel(layer("redevelopment")), records: readShp(join(dir, "AL_D027_00_20260909.shp")) },
], { projects: roster, sigungu });

// SourceStats 불변식·시도별
for (const s of stats) assert.equal(s.received, s.accepted + s.unlocated + s.rejected, s.sourceId);
assert.deepEqual(stats.map((s) => [s.sourceId, s.received, s.accepted, s.rejected]), [["mzone_zone", 12, 10, 2], ["mzone_redevelopment", 1, 1, 0]]);
assert.deepEqual(stats[0].byRegion, { 11: 7, 41: 2, 12: 1 });
assert.equal(stats[0].snapshot().fillRates.announcedDate, 0.1, "유효한 고시일만 채움으로 센다 (Z1)");
assert.equal(stats[0].snapshot().fillRates.name, 0.9);

// 속성
const feat = (id) => {
  const r = db.prepare("SELECT kind, name, legal_code, properties_json FROM feature WHERE stable_id = ?").get(id);
  return { ...r, p: JSON.parse(r.properties_json) };
};
const z1 = feat("mzone:zone:Z1");
assert.equal(z1.kind, "maintenance_zone");
assert.equal(z1.legal_code, "1168000000");
assert.equal(z1.p.announcedDate, "2019-08-01");
assert.equal(z1.p.name, "개포주공5단지 재건축 정비구역");
assert.equal(z1.p.nameSource, "A9");
assert.equal(feat("mzone:zone:Z5").p.announcedDate, null);
assert.equal(feat("mzone:zone:Z5").p.announcedRaw, "20140100", "원문은 남긴다");
assert.equal(feat("mzone:zone:Z3").p.name, null, "A8이 '정비구역'뿐이면 이름 없음");
assert.equal(feat("mzone:zone:Z3").p.typeLabel, "정비구역");
assert.equal(feat("mzone:zone:Z3").p.typeCode, "UDT100");

// 링크: 진짜 일치만 남는다
const links = db.prepare("SELECT from_stable_id f, to_stable_id t, relation_type r, method m, confidence c FROM feature_link ORDER BY from_stable_id").all();
const link = Object.fromEntries(links.map((l) => [l.f.replace("mzone:", ""), l]));
assert.deepEqual(Object.keys(link).sort(), ["zone:Z1", "zone:Z6", "zone:Z7", "zone:Z8", "zone:Z9"]);
assert.ok(links.every((l) => l.r === "zone_of_project" && l.m === "name_sgg" && l.c >= LINK_MIN_CONFIDENCE && l.c <= 1));
assert.equal(link["zone:Z1"].t, "maint:gp5");
assert.equal(link["zone:Z1"].c, 0.9, "이름 일치 + 유형(재건축) 일치");
assert.equal(link["zone:Z6"].t, "maint:jj1");
assert.equal(link["zone:Z6"].c, 0.85, "유형 단서 없음: 이름 일치만");
assert.equal(link["zone:Z7"].t, "maint:jk6");
assert.equal(link["zone:Z8"].t, "maint:nam");
assert.equal(link["zone:Z9"].t, "maint:sr");
assert.ok(!link["zone:Z2"], "다른 시군구의 같은 이름");
assert.ok(!link["zone:Z3"], "이름 없음");
assert.ok(!link["zone:Z4"], "후보 둘(동점) → 잇지 않음");
assert.ok(!link["zone:Z5"], "유형 충돌 (재개발 글자 ↔ 재건축 사업)");
assert.ok(!link["zone:Z10"]);
assert.ok(!db.prepare("SELECT 1 FROM feature_link WHERE from_stable_id LIKE 'mzone:redevelopment:%'").get(), "재개발구역 레이어 ↔ 재건축 사업");

// 커버리지에 매칭 요약
const cov = JSON.parse(db.prepare("SELECT coverage_json FROM source_release WHERE source_id='mzone_zone'").pluck().get());
assert.equal(cov.matching.zones, 10);
assert.equal(cov.matching.linked, 5);
assert.deepEqual(cov.byRegion, { 11: 7, 41: 2, 12: 1 });
const rights = JSON.parse(db.prepare("SELECT rights_json FROM source_release WHERE source_id='mzone_zone'").pluck().get());
assert.match(rights.basis, /15045898/);

// 점수 자체
const zn = (name, l = "zone") => ({ layer: l, name, altName: null });
assert.equal(scorePair(zn("도곡2"), { name: "도곡2", type: "재건축" }).score, 0.85);
assert.equal(scorePair(zn("도곡2", "redevelopment"), { name: "도곡2", type: "재건축" }).score, 0.55, "재개발 레이어 ↔ 재건축");
assert.equal(scorePair(zn("신길13"), { name: "신길1", type: "재개발" }), null, "숫자 경계: 신길1은 신길13이 아니다");
assert.equal(scorePair(zn("신길1 재개발 구역 안내문"), { name: "신길1", type: "재개발" }).score, 0.8, "포함은 유형이 맞아야 임계값(0.8)에 닿는다");
assert.equal(scorePair(zn("신길1 안내문"), { name: "신길1", type: "재개발" }).score, 0.75);
assert.equal(scorePair(zn("행위제한 안내"), { name: "행위", type: "재개발" }), null, "3글자 미만 사업명은 포함 매칭 안 함");

// ─── 4. 레이어 파일 고르기 ───────────────────────────────────────────────────
const files = mzoneLayerFiles(["/r/a/AL_D029_00_20260101.shp", "/r/a/AL_D029_00_20260909.shp", "/r/x/AL_D029_00_20260909.shp", "/r/a/AL_D316_00_20260909.shp", "/r/a/AL_D124_00_20260909.shp"]);
assert.deepEqual([...files.keys()], ["zone", "planned"]);
assert.deepEqual(files.get("zone").files, ["/r/x/AL_D029_00_20260909.shp"], "같은 이름의 중복 추출본은 하나만");
console.log("ok mzone");

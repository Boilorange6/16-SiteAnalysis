/**
 * 실제 원천 파일을 읽기만 하는 점검: 행 수·불변식·단지종류 분포·(선택) 게시된 core로 위치 확보율.
 *   npx tsx src/scripts/v2/school-kapt-dryrun.mjs [core.sqlite]
 * 게시 데이터는 읽기 전용으로 열고 인덱스(parcel_point.pnu, feature.pnu)만 쓴다.
 */
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { remapRenumberedPnu } = await import("../../lib/v2/data/jibun.ts");
const { sidoCodeOfName } = await import("../../lib/v2/ingest/sources/school-kapt.ts");

const RAW = process.env.V2_RAW ?? "D:/V-coding/16-SiteAnalysis/.cache/v2/raw";
const CORE = process.argv[2] ?? "D:/V-coding/16-SiteAnalysis/.cache/v2/data/versions/2026-09-30c/core.sqlite";
const bump = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null);

// 학교
const school = { rows: 0, bad: 0, byLevel: {}, byStatus: {}, byRegion: {} };
const schoolIds = new Set();
for await (const { properties: p } of (await csvRecords(`${RAW}/school/school-location-std.csv`)).records) {
  school.rows++;
  const lng = Number(p["경도"]), lat = Number(p["위도"]);
  if (!p["학교ID"] || !(lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39)) { school.bad++; continue; }
  schoolIds.add(p["학교ID"]);
  bump(school.byLevel, p["학교급구분"]); bump(school.byStatus, p["운영상태"]); bump(school.byRegion, sidoCodeOfName(String(p["소재지지번주소"]).split(/\s+/)[0]));
}
console.log("school", school);

// 학구
const zoneIds = new Set(), objIds = new Set();
const elem = { rows: 0, blank: 0 };
for await (const { properties: p } of (await csvRecords(`${RAW}/school_zone/school-zone-elem-std.csv`)).records) {
  elem.rows++;
  if (!p["학구ID"] || !p["공간객체ID"]) elem.blank++;
  zoneIds.add(p["학구ID"]); objIds.add(p["공간객체ID"]);
}
const link = { rows: 0, schoolMissing: 0, zoneWithoutElem: 0, dup: 0, byLevel: {} };
const seenLinks = new Set();
for await (const { properties: p } of (await csvRecords(`${RAW}/school_zone/school-zone-link-std.csv`)).records) {
  link.rows++;
  if (!schoolIds.has(p["학교ID"])) link.schoolMissing++;
  if (!zoneIds.has(p["학구ID"])) link.zoneWithoutElem++;
  const k = `${p["학교ID"]}|${p["학구ID"]}`;
  if (seenLinks.has(k)) link.dup++; else seenLinks.add(k);
  bump(link.byLevel, p["학교급구분"]);
}
console.log("zone elem", elem, { zones: zoneIds.size, objects: objIds.size }, "link", link);

// K-APT
const core = existsSync(CORE) ? new Database(CORE, { readonly: true }) : null;
const hasPoint = core?.prepare("SELECT 1 FROM parcel_point WHERE pnu = ?").pluck();
const housingAt = core?.prepare("SELECT COUNT(*) FROM feature WHERE kind = 'housing_complex' AND pnu = ?").pluck();
const k = { rows: 0, rejected: 0, located: 0, unlocated: 0, linkable: 0, byRegion: {}, byType: {} };
const ids = new Set();
// 법정동 10자리 기준(legal_area 코드: 다산동 41360112·장지동 11710109·창곡동 41131108·학암동 41450116)
const AREA_OF = { "4136011200": "다산동(남양주)", "1171010900": "장지동(송파)", "4113110800": "창곡동(성남, 위례)", "4145011600": "학암동(하남, 위례)" };
const areas = Object.fromEntries(Object.values(AREA_OF).map((n) => [n, { rows: 0, located: 0, byType: {}, apt1: 0, apt1Located: 0, households1: 0 }]));
for await (const { properties: p } of (await csvRecords(`${RAW}/kapt/kapt_complex_20260831.csv`)).records) {
  k.rows++;
  const id = String(p["단지고유번호"]).trim(), srcPnu = String(p["필지고유번호"]).trim();
  const pnu = core && /^\d{19}$/.test(srcPnu) ? remapRenumberedPnu(core, srcPnu, String(p["주소"]).trim()) : srcPnu; // buildKapt와 같은 재번호 처리
  if (!id || ids.has(id) || !/^\d{19}$/.test(pnu)) { k.rejected++; continue; }
  ids.add(id);
  const t = String(p["단지종류"]).trim();
  const r = (k.byRegion[pnu.slice(0, 2)] ??= { received: 0, located: 0 });
  r.received++;
  const ty = (k.byType[t] ??= { n: 0, households: [], buildings: [], apartmentName: 0, blankApproval: 0, blankLedgerName: 0, located: 0 });
  ty.n++; ty.households.push(Number(p["세대수"])); ty.buildings.push(Number(p["동수"]));
  if (/아파트|APT|apt/.test(p["단지명_공시가격"] + p["단지명_건축물대장"] + p["단지명_도로명주소"])) ty.apartmentName++;
  if (!String(p["사용승인일"]).trim()) ty.blankApproval++;
  if (!String(p["단지명_건축물대장"]).trim()) ty.blankLedgerName++;
  const ok = core ? !!hasPoint.get(pnu) : null;
  if (core && srcPnu !== pnu) k.remapped = (k.remapped ?? 0) + 1;
  if (core && srcPnu.slice(0, 2) in { 29: 1, 46: 1 }) { const o = (k.oldSido ??= {}); const s = (o[srcPnu.slice(0, 2)] ??= { rows: 0, locatedWithoutRemap: 0, locatedWithRemap: 0 }); s.rows++; if (hasPoint.get(srcPnu)) s.locatedWithoutRemap++; if (ok) s.locatedWithRemap++; }
  if (core) { if (ok) { k.located++; r.located++; ty.located++; if (housingAt.get(pnu) > 0) k.linkable++; } else k.unlocated++; }
  const area = AREA_OF[pnu.slice(0, 10)];
  if (area) {
    const a = areas[area];
    a.rows++; if (ok) a.located++; bump(a.byType, t);
    if (t === "1") { a.apt1++; if (ok) a.apt1Located++; a.households1 += Number(p["세대수"]) || 0; }
  }
}
console.log("kapt", { rows: k.rows, rejected: k.rejected, located: core ? k.located : "(no core)", unlocated: core ? k.unlocated : "(no core)", linkableToLedgerHousingComplex: core ? k.linkable : "(no core)" });
console.log("kapt byRegion (재번호 후 시도)", k.byRegion, "remapped", k.remapped ?? 0, "옛 시도 29·46", k.oldSido);
for (const [t, v] of Object.entries(k.byType).sort()) {
  const hs = v.households.filter((x) => x > 0);
  console.log(`type ${t}: n=${v.n} households median=${med(hs)} max=${hs.reduce((a, b) => Math.max(a, b), 0)} buildings median=${med(v.buildings)} nameHasApt=${((100 * v.apartmentName) / v.n).toFixed(1)}% blankApproval=${((100 * v.blankApproval) / v.n).toFixed(1)}% blankLedgerName=${((100 * v.blankLedgerName) / v.n).toFixed(1)}%${core ? ` located=${((100 * v.located) / v.n).toFixed(1)}%` : ""}`);
}
console.log("areas", JSON.stringify(areas, null, 1));
if (core) {
  const range = (p) => core.prepare("SELECT kind, COUNT(*) n FROM feature WHERE pnu >= ? AND pnu < ? AND kind IN ('housing_complex','officetel') GROUP BY kind").all(p, p + "\uffff");
  for (const [code, name] of Object.entries(AREA_OF)) console.log(`ledger features in published core, ${name} ${code}:`, range(code), "parcel_point:", core.prepare("SELECT COUNT(*) FROM parcel_point WHERE pnu >= ? AND pnu < ?").pluck().get(code, code + "9"));
}

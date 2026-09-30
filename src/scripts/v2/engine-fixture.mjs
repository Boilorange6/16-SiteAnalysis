/**
 * 엔진 테스트용 작은 데이터 디렉터리(core·reference·market)를 만들고 게시한다. 테스트가 아니다.
 * 중심점 다산(127.1506, 37.6245) 둘레에 거리를 알고 있는 점들을 둔다.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const M = await import("../../lib/v2/data/manifest.ts");

export const CENTER = [127.1506, 37.6245];
const [cx, cy] = toUtmk(CENTER);
export const at = (dx, dy = 0) => [...toLngLat([cx + dx, cy + dy])];
const pt = (dx, dy = 0) => ({ type: "Point", coordinates: at(dx, dy) });
const box = (x0, x1) => ({ type: "Polygon", coordinates: [[at(x0, -4000), at(x1, -4000), at(x1, 4000), at(x0, 4000), at(x0, -4000)]] });

export const PNU_DASAN_100 = "4136011800101000000";

const rel = (db, sourceId, sourceAsOf, extra = {}) =>
  insertRelease(db, { sourceId, provider: "테스트", sourceUrl: "https://example.invalid", sourceAsOf, fetchedAt: "2026-09-29T00:00:00Z", checksum: "x", licenseCode: "TEST", ...extra });

function run(db, sourceId, releaseId, snapshot, rejected = 0) {
  db.prepare(`INSERT INTO ingest_run (run_id, source_id, started_at, finished_at, status, received_count, accepted_count, rejected_count, release_id, snapshot_json)
    VALUES (?, ?, '2026-09-29T00:00:00Z', '2026-09-29T00:01:00Z', 'succeeded', 10, 10, ?, ?, ?)`)
    .run(`${sourceId}:1`, sourceId, rejected, releaseId, JSON.stringify(snapshot));
}

/** options.noMarket: market 파일을 게시하지 않는다. options.extraBus: 버스정류장을 더한다(새 버전 검증용). */
export async function buildEngineFixture(dataDir, version, options = {}) {
  const dir = join(dataDir, "versions", version);
  mkdirSync(dir, { recursive: true });
  const files = {};
  const open = (kind) => {
    const db = new Database(join(dir, `${kind}.sqlite`));
    initDataFileSchema(db, kind);
    return db;
  };

  // ── core
  let db = open("core");
  const legal = rel(db, "legal_areas", "2026-09-09");
  const parcel = rel(db, "parcel", "2026-09-08");
  const recap = rel(db, "ledger_recap", "2026-08");
  const title = rel(db, "ledger_title", "2026-08");
  const la = db.prepare("INSERT INTO legal_area VALUES (?, ?, ?, ?, ?)");
  la.run("41360", "sigungu", "경기도 남양주시", null, legal);
  la.run("41360118", "emd", "다산동", "41360", legal);
  la.run("41360130", "emd", "별내동", "41360", legal);
  la.run("41360131", "emd", "별내동", "41360", legal); // 동명 → 모호
  la.run("11710", "sigungu", "서울특별시 송파구", null, legal);
  db.prepare("INSERT INTO parcel_point VALUES (?, ?, ?, ?, ?)").run(PNU_DASAN_100, CENTER[0], CENTER[1], "대", parcel);
  insertFeature(db, { stableId: "sig:41360", kind: "legal_sigungu", sourceKey: "41360", releaseId: legal, geometry: box(-5000, 5000), name: "경기도 남양주시", legalCode: "4136000000" });
  insertFeature(db, { stableId: "sig:11710", kind: "legal_sigungu", sourceKey: "11710", releaseId: legal, geometry: box(600, 5000), name: "서울특별시 송파구", legalCode: "1171000000" });
  const hc = (id, dx, releaseId, props, name = id) =>
    insertFeature(db, { stableId: id, kind: "housing_complex", sourceKey: id, releaseId, geometry: pt(dx, 100), name, properties: props });
  // 실제 대장 행 모양(고덕역 1km): 총괄표제부 "아파트, 상가", 표제부 "공동주택" 300세대, 총괄표제부 "아파트" 세대 미상
  hc("recap:apt1", 100, recap, { source: "recap", mainUse: "공동주택", otherUse: "아파트, 상가", units: 480, households: 500, parking: 600, approvalDate: "1996-09-30" });
  hc("title-housing:apt2", 200, title, { source: "title", mainUse: "공동주택", otherUse: "공동주택", units: 300, households: null, parking: null, approvalDate: "2010-05-01" });
  hc("recap:apt3", 300, recap, { source: "recap", mainUse: "공동주택", otherUse: "아파트", units: null, households: null, parking: null, approvalDate: null });
  // 연립·다세대: mainUse는 똑같이 "공동주택"이지만 아파트가 아니다
  hc("recap:villa1", 410, recap, { source: "recap", mainUse: "공동주택", otherUse: "공동주택(도시형생활주택 단지형 다세대주택) 및 근린생활시설", units: 40, households: null, parking: 34, approvalDate: "2022-01-01" });
  hc("title-housing:villa2", 420, title, { source: "title", mainUse: "공동주택", otherUse: "다세대주택,제2종근린생활시설", units: 6, households: null, parking: null, approvalDate: "1987-11-21" });
  hc("title-housing:villa3", 430, title, { source: "title", mainUse: "공동주택", otherUse: "공동주택", units: 12, households: null, parking: null, approvalDate: "2002-07-26" });
  hc("recap:villa4", 440, recap, { source: "recap", mainUse: "공동주택", otherUse: "공동주택(연립주택), 관리실, 노인정", units: 156, households: null, parking: null, approvalDate: "1991-01-01" });
  hc("recap:house", 400, recap, { source: "recap", mainUse: "단독주택", units: 4, households: null, parking: null, approvalDate: "1996-10-01" });
  hc("recap:far", 4000, recap, { source: "recap", mainUse: "공동주택", units: 999, households: 999, parking: 1, approvalDate: "2000-01-01" }); // 반경 밖
  const of = (id, dx, props) => insertFeature(db, { stableId: id, kind: "officetel", sourceKey: id, releaseId: title, geometry: pt(dx, -100), name: id, properties: props });
  of("title:off1", 150, { units: 100, approvalDate: "2015-01-01" });
  of("title:off2", 250, { units: null, approvalDate: null });
  run(db, "ledger_recap_housing", recap, { byRegion: { 41: 10 }, byType: {}, fillRates: {}, unlocated: 2 }, 3);
  run(db, "ledger_title_housing", title, { byRegion: { 41: 10 }, byType: {}, fillRates: {}, unlocated: 1 }, 1);
  db.close();
  files.core = "core";

  // ── reference
  db = open("reference");
  const store = rel(db, "store", "2026-06");
  const bus = rel(db, "bus_stop", "2025-12-09");
  const park = rel(db, "park", null);
  const sp = (id, dx, code, major, mid) =>
    insertFeature(db, { stableId: `store:${id}`, kind: "store", sourceKey: id, releaseId: store, geometry: pt(dx, 0), name: id, properties: { majorCategory: major, midCategory: mid, minorCategory: "x", categoryCode: code, floor: null, address: null } });
  sp("cvs", 100, "G20405", "소매", "종합 소매");
  sp("pharm-far", 900, "G21501", "소매", "의약·화장품 소매"); // 반경 800에서는 밖, 1000에서는 안
  sp("clinic", 300, "Q10210", "보건의료", "의원");
  sp("cafe", 400, "I21201", "음식", "비알코올");
  sp("hair", 50, "S20701", "수리·개인", "이용·미용");
  sp("shoes", 60, "G20910", "소매", "섬유·의복·신발 소매");
  const bp = (id, dx) => insertFeature(db, { stableId: `bus_stop:${id}`, kind: "bus_stop", sourceKey: id, releaseId: bus, geometry: pt(dx, 0), name: id, properties: { cityCode: "31", cityName: "남양주시", stopNo: id, collectedAt: "2025-12-09" } });
  bp("b1", 250);
  bp("b2", 700);
  bp("b3", 1500);
  if (options.extraBus) bp("b4", 100);
  const pk = (id, dx, areaM2) => insertFeature(db, { stableId: `park:${id}`, kind: "park", sourceKey: id, releaseId: park, geometry: pt(dx, 0), name: id, properties: { parkType: "근린공원", areaM2, designatedAt: null, jibunAddress: null } });
  pk("p1", 300, 10000);
  pk("p2", 600, 5000);
  pk("p3", 700, null);
  run(db, "store", store, { byRegion: { 41: 6 }, byType: {}, fillRates: {}, unlocated: 0 });
  run(db, "bus_stop", bus, { byRegion: { "경기도 남양주시": 4 }, byType: {}, fillRates: {}, unlocated: 0 });
  run(db, "park", park, { byRegion: { 경기도: 3 }, byType: {}, fillRates: {}, unlocated: 0 });
  db.close();
  files.reference = "reference";

  // ── market
  if (!options.noMarket) {
    db = open("market");
    const ah = rel(db, "applyhome", null);
    const mi = rel(db, "move_in", "2026-06-30");
    const ps = (id, dx, releaseId, props) =>
      insertFeature(db, { stableId: id, kind: "planned_supply", sourceKey: id, releaseId, geometry: pt(dx, 0), name: id, properties: { kind: "apartment", address: null, ...props } });
    ps("applyhome:1", 100, ah, { source: "applyhome", units: 800, plannedMonth: "2026-12" });
    ps("applyhome:2", 200, ah, { source: "applyhome", units: 300, plannedMonth: "2026-01" });
    ps("applyhome:3", 300, ah, { source: "applyhome", units: 100, plannedMonth: "2030-01" });
    ps("applyhome:4", 400, ah, { source: "applyhome", units: null, plannedMonth: "2026-10" });
    ps("movein:1", 150, mi, { source: "move_in", units: 500, plannedMonth: "2028-05" });
    ps("movein:2", 250, mi, { source: "move_in", units: 200, plannedMonth: null });
    ps("movein:far", 4000, mi, { source: "move_in", units: 9999, plannedMonth: "2027-01" });
    const ev = db.prepare(`INSERT INTO development_event (event_id, project_id, event_type, stage, planned_date_precision, units, geometry_id, evidence_url, release_id)
      VALUES (?, ?, 'x', 'x', 'month', 1, ?, 'https://example.invalid', ?)`);
    ev.run("e1", "e1", "applyhome:1", ah);
    ev.run("e2", "e2", "movein:1", mi);
    run(db, "applyhome", ah, { byRegion: { 경기: 4 }, byType: {}, fillRates: {}, unlocated: 5 }, 5);
    run(db, "move_in", mi, { byRegion: { 경기: 3 }, byType: {}, fillRates: {}, unlocated: 0 });
    db.close();
    files.market = "market";
  }

  const manifest = { version, createdAt: "2026-09-30T00:00:00Z", files: {} };
  for (const kind of Object.values(files)) {
    const path = `versions/${version}/${kind}.sqlite`;
    manifest.files[kind] = { path, sha256: await M.sha256File(join(dataDir, path)), kind, schemaVersion: 2 };
  }
  const r = await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }));
  if (!r.published) throw new Error("fixture publish failed");
  return r.hash;
}

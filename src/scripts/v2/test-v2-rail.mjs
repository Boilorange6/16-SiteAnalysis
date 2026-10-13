import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature, queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildOsmSubway, buildPlannedRail, legalCodeFromCore } = await import("../../lib/v2/ingest/sources/rail.ts");

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const mk = () => {
  const db = new Database(":memory:");
  initDataFileSchema(db, "reference");
  const rel = insertRelease(db, { sourceId: "osm_subway", provider: "OSM", sourceUrl: "https://overpass-api.de/", sourceAsOf: "2026-05-26", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "ODbL-1.0" });
  return { db, rel };
};
const invariant = (s) => assert.equal(s.received, s.accepted + s.unlocated + s.rejected, s.sourceId);

// core: 서울(11)·부산(26) 시군구 사각형
const core = new Database(":memory:");
initDataFileSchema(core, "core");
const crel = insertRelease(core, { sourceId: "legal_sigungu", provider: "t", sourceUrl: "https://x.invalid", sourceAsOf: null, fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
const box = (x, y, d = 0.05) => ({ type: "Polygon", coordinates: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]] });
insertFeature(core, { stableId: "sig:11290", kind: "legal_sigungu", sourceKey: "11290", releaseId: crel, geometry: box(127.0059, 37.5885), legalCode: "1129000000" });
insertFeature(core, { stableId: "sig:26000", kind: "legal_sigungu", sourceKey: "26000", releaseId: crel, geometry: box(129.0784, 35.2056), legalCode: "2626000000" });
const legalCodeOf = legalCodeFromCore(core);

// ─── 1. OSM 지하철 픽스처 ────────────────────────────────────────────────
{
  const { db, rel } = mk();
  const snap = fx("osm-subway.sample.json");
  snap.stations.push({ osm_id: snap.stations[0].osm_id, station_name: "중복", lat: 37.5, lng: 127 }, { osm_id: "node/bad", station_name: "좌표밖", lat: 200, lng: 10 }, { station_name: "번호없음", lat: 37.5, lng: 127 });
  snap.entrances.push({ station_name: "키없는역", entrance_ref: "2", lat: 37.5, lng: 127.1 }); // osm_id 없음 → 결정적 키
  const run = async () => {
    const c = mk();
    return { c, stats: await buildOsmSubway(c.db, structuredClone(snap), c.rel, legalCodeOf) };
  };
  const [st, en, ln] = await buildOsmSubway(db, snap, rel, legalCodeOf);
  [st, en, ln].forEach(invariant);
  assert.deepEqual([st.received, st.accepted, st.rejected], [5, 2, 3]);
  assert.deepEqual(st.byRegion, { 11: 1, 26: 1 }); // 2자리 시도 코드
  assert.deepEqual([en.accepted, en.rejected, ln.accepted], [4, 0, 1]);
  assert.equal(en.byRegion["(미상)"], 1);
  const row = db.prepare("SELECT name, legal_code, properties_json FROM feature WHERE stable_id = 'rail_station:node/287600947'").get();
  assert.equal(row.name, "한성대입구");
  assert.equal(row.legal_code, "1129000000");
  const sp = JSON.parse(row.properties_json);
  assert.ok(sp.lineNames.length > 0 && sp.lineRefs.length === sp.lineNames.length && sp.operator === null);
  assert.equal(sp.stationAxes.length, 1, "역축 끝점은 역사 막대 런타임 표현을 위해 역 feature에 보존한다");
  assert.deepEqual(sp.stationAxes[0].endpoints, [[127.0067881, 37.5888533], [127.0051653, 37.5881344]]);
  assert.ok(db.prepare("SELECT 1 FROM feature WHERE stable_id LIKE 'rail_entrance:키없는역|2|%'").get());
  // 결정적: 두 번 적재하면 id 목록이 같다
  const ids = (d) => d.prepare("SELECT stable_id FROM feature ORDER BY stable_id").pluck().all();
  const again = await run();
  assert.deepEqual(ids(again.c.db), ids(db));
  // 역은 반경 조회로 나온다
  const hits = queryFeaturesInRadius(db, [127.0059624, 37.5885141], 300, ["rail_station"]);
  assert.deepEqual(hits.map((h) => h.name), ["한성대입구"]);
}

// ─── 2. 계획 철도: 날짜는 원천 그대로 ─────────────────────────────────────
{
  const { db, rel } = mk();
  const projects = fx("planned-rail.sample.json");
  projects[0].lastVerifiedAt = "2026-07"; // 일 없는 정밀도
  projects.push(
    { ...projects[0], projectId: "with-stations", lifecycleStatus: "approved", stations: [{ name: "가상역", lat: 35.2056, lng: 129.0784 }, { name: "", lat: 35, lng: 129 }] },
    { ...projects[0], projectId: "no-geom", geometry: null },
    { ...projects[0] }, // 같은 projectId 중복
  );
  const [ln, st] = await buildPlannedRail(db, projects, rel, legalCodeOf);
  [ln, st].forEach(invariant);
  assert.deepEqual([ln.received, ln.accepted, ln.rejected], [4, 2, 2]);
  assert.deepEqual([st.received, st.accepted, st.rejected], [2, 1, 1]);
  assert.deepEqual(ln.byType, { under_construction: 1, approved: 1 });
  const p = JSON.parse(db.prepare("SELECT properties_json FROM feature WHERE stable_id = 'planned_rail_line:seoul-line-9-phase-4'").pluck().get());
  assert.equal(p.lastVerifiedAt, "2026-07");
  assert.equal(p.statusEvidence[0].retrievedAt, "2026-07-17");
  assert.equal(p.sourceType, "approximation");
  assert.equal(db.prepare("SELECT kind FROM feature WHERE stable_id = 'planned_rail_station:with-stations:가상역'").pluck().get(), "planned_rail_station");
  assert.deepEqual(st.byRegion, { 26: 1 });
}

// ─── 3. 실제 파일 건수(읽기만, 메모리 DB) ─────────────────────────────────
if (existsSync("public/data/osm-subway.json") && existsSync("public/data/rail/planned.json")) {
  const { db, rel } = mk();
  const none = () => null;
  const stats = [
    ...(await buildOsmSubway(db, JSON.parse(readFileSync("public/data/osm-subway.json", "utf8")), rel, none)),
    ...(await buildPlannedRail(db, JSON.parse(readFileSync("public/data/rail/planned.json", "utf8")), rel, none)),
  ];
  stats.forEach(invariant);
  console.log("real files:", stats.map((s) => `${s.sourceId} read ${s.received} ok ${s.accepted} rej ${s.rejected}`).join(" · "));
  assert.ok(stats[0].accepted > 600 && stats[2].accepted > 100);
}

console.log("✓ v2 rail");

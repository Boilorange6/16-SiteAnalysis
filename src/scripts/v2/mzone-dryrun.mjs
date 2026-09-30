/**
 * 정비구역 경계 + 명부 매칭을 임시 sqlite에 적재해 보고서를 낸다. 게시 데이터 폴더는 건드리지 않는다(core는 읽기 전용).
 *   npx tsx src/scripts/v2/mzone-dryrun.mjs --db <temp.sqlite> [--core core.sqlite] [--seed 7]
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const { readShp } = await import("../../lib/v2/ingest/shp.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { buildMaintenance } = await import("../../lib/v2/ingest/sources/maintenance.ts");
const { buildMaintenanceZones, mzoneLayerFiles, sigunguIndexFromCore, matchZones, zonesFromDb, MZONE_LAYERS, MZONE_RIGHTS } = await import("../../lib/v2/ingest/sources/maintenance-zone.ts");
const { REVIEW_SITES } = await import("../../lib/v2/a0/review-sites.ts");

const args = process.argv.slice(2);
const opt = (n, d) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d);
const dbPath = opt("db");
if (!dbPath) { console.error("usage: --db <temp.sqlite> [--core core.sqlite]"); process.exit(2); }
const RAW = process.env.V2_RAW ?? "D:/V-coding/16-SiteAnalysis/.cache/v2/raw";
const corePath = opt("core", "D:/V-coding/16-SiteAnalysis/.cache/v2/data/versions/2026-09-30f/core.sqlite");
const files = [];
(function collect(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? collect(join(d, e.name)) : files.push(join(d, e.name));
})(join(RAW, "maintenance_zone"));

for (const ext of ["", "-journal"]) if (existsSync(dbPath + ext)) rmSync(dbPath + ext);
const db = new Database(dbPath);
db.pragma("journal_mode = DELETE");
initDataFileSchema(db, "reference");
const core = new Database(corePath, { readonly: true });

// 명부: 임시 메모리 market DB에서 얻는다
const scratch = new Database(":memory:");
initDataFileSchema(scratch, "market");
const rel = (d, id) => insertRelease(d, { sourceId: id, provider: "x", sourceUrl: "x", sourceAsOf: "2026-09-01", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
const dir = join(RAW, "maintenance");
await buildMaintenance(scratch, {
  integrated: (await csvRecords(join(dir, "maintenance-integrated-15160169.csv"))).records,
  integratedReleaseId: rel(scratch, "maintenance_integrated"),
  std: (await csvRecords(join(dir, "maintenance-std-15155703.csv"))).records,
  stdReleaseId: rel(scratch, "maintenance_std"),
});
const projects = scratch.prepare("SELECT coverage_json FROM source_release").pluck().all().flatMap((c) => JSON.parse(c).projects ?? []);
const sigungu = sigunguIndexFromCore(core);

const found = mzoneLayerFiles(files);
const layers = MZONE_LAYERS.map((l) => {
  const set = found.get(l.key);
  if (!set) throw new Error(`layer ${l.key} not found`);
  const d = set.date;
  const releaseId = insertRelease(db, { sourceId: l.sourceId, provider: "VWorld dsId 24", sourceUrl: "https://www.vworld.kr", sourceAsOf: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, fetchedAt: new Date().toISOString(), checksum: "dryrun", licenseCode: "UNRESTRICTED", rights: MZONE_RIGHTS });
  async function* recs() { for (const f of set.files) yield* readShp(f); }
  return { layer: l.key, releaseId, records: recs() };
});
const stats = await buildMaintenanceZones(db, layers, { projects, sigungu });

console.log("== layers ==");
for (const st of stats) {
  const snap = st.snapshot();
  console.log(`${st.sourceId}: read ${st.received} ok ${st.accepted} rejected ${st.rejected}; fill name ${(100 * snap.fillRates.name).toFixed(0)}% date ${(100 * snap.fillRates.announcedDate).toFixed(0)}%`);
  console.log("  byRegion", JSON.stringify(st.byRegion));
  console.log("  byType", JSON.stringify(st.byType));
}

// 매칭 결과는 DB의 링크에서 읽고, 거절 사유는 같은 함수를 다시 돌려 얻는다(결정적)
const zones = zonesFromDb(db);
const { matches, rejects, unresolvedSigungu } = matchZones(zones, projects, sigungu);
const linkRows = db.prepare("SELECT count(*) FROM feature_link").pluck().get();
console.log("\n== matching ==");
console.log(`roster projects ${projects.length} (sigungu unresolved ${unresolvedSigungu}); zones ${zones.length}; links in db ${linkRows}`);
const zoneNamed = zones.filter((z) => z.name).length;
console.log(`zones with name ${zoneNamed} (${((100 * zoneNamed) / zones.length).toFixed(1)}%)`);
const projWith = new Set(matches.map((m) => m.projectId));
console.log(`zones linked ${matches.length} (${((100 * matches.length) / zones.length).toFixed(1)}% of all, ${((100 * matches.length) / zoneNamed).toFixed(1)}% of named); projects with >=1 zone ${projWith.size} (${((100 * projWith.size) / projects.length).toFixed(1)}%)`);
const hist = {};
for (const m of matches) hist[m.confidence] = (hist[m.confidence] ?? 0) + 1;
console.log("confidence histogram", JSON.stringify(hist));
const byWhy = {};
for (const m of matches) byWhy[m.why] = (byWhy[m.why] ?? 0) + 1;
console.log("by rule", JSON.stringify(byWhy));
const byReason = {};
for (const r of rejects) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
console.log("rejects", JSON.stringify(byReason));
const byLayer = {};
for (const z of zones) (byLayer[z.layer] ??= { zones: 0, linked: 0 }).zones++;
for (const m of matches) byLayer[m.zone.layer].linked++;
console.log("by layer", JSON.stringify(byLayer));
const pById = new Map(projects.map((p) => [p.id, p]));
const perProject = new Map();
for (const m of matches) perProject.set(m.projectId, (perProject.get(m.projectId) ?? 0) + 1);
console.log("zones per linked project", JSON.stringify(Object.fromEntries([...perProject.values()].reduce((a, n) => a.set(n, (a.get(n) ?? 0) + 1), new Map()))));

// 결정적 표본: 등간격
const pick = (arr, n) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n);
const nm = (z) => `${z.name ?? "(이름없음)"}${z.altName ? ` / ${z.altName}` : ""}`;
console.log("\n== 20 sample matches ==");
for (const m of pick(matches, 20)) {
  const p = pById.get(m.projectId);
  console.log(`${m.confidence} ${m.why.padEnd(16)} [${m.zone.layer} ${m.zone.sigungu}] ${nm(m.zone)}  ==>  ${p.sido} ${p.sigungu} ${p.name} (${p.type})`);
}
console.log("\n== 10 sample rejects (name present) ==");
for (const r of pick(rejects.filter((x) => x.reason === "ambiguous" || x.reason === "low_score"), 10)) {
  console.log(`${r.reason} [${r.zone.layer} ${r.zone.sigungu}] ${nm(r.zone)}  best: ${r.best.map((b) => `${b.score} ${b.why} ${pById.get(b.projectId).sigungu} ${pById.get(b.projectId).name}(${pById.get(b.projectId).type})`).join(" | ")}`);
}
console.log("\n== 10 sample no-candidate (name present) ==");
for (const r of pick(rejects.filter((x) => x.reason === "no_candidate" && x.zone.name), 10)) console.log(`[${r.zone.layer} ${r.zone.sigungu}] ${nm(r.zone)}`);

console.log("\n== review sites: zones within 1 km ==");
for (const site of REVIEW_SITES.filter((x) => ["guryong", "jeongja"].includes(x.id))) {
  console.log(`${site.name} ${site.center}`);
  for (const h of queryFeaturesInRadius(db, site.center, 1000, ["maintenance_zone"])) {
    const link = db.prepare("SELECT to_stable_id, confidence FROM feature_link WHERE from_stable_id = ?").get(h.stableId);
    const p = link && pById.get(link.to_stable_id);
    console.log(`  ${h.stableId.split(":")[1]} ${h.properties.sigungu} ${h.properties.typeLabel} name=${h.properties.name ?? "-"} date=${h.properties.announcedDate ?? h.properties.announcedRaw ?? "-"} ${p ? `-> ${p.sigungu} ${p.name}(${p.type}) ${link.confidence}` : "(no link)"}`);
  }
}
console.log("roster 강남 개포/구룡/대치/도곡/일원:", projects.filter((p) => p.sido === "11" && p.sigungu === "강남구" && /개포|구룡|대치|도곡|일원|수서/.test(p.name)).map((p) => `${p.name}(${p.type})`).join(", "));
console.log("roster 분당:", projects.filter((p) => p.sigungu.includes("분당")).map((p) => `${p.name}(${p.type})`).join(", ") || "(없음)");
for (const site of REVIEW_SITES.filter((x) => ["guryong", "jeongja"].includes(x.id))) {
  const hs = queryFeaturesInRadius(db, site.center, 3000, ["maintenance_zone"]);
  console.log(`${site.name} 3km 내 구역 ${hs.length}건, 시군구 ${JSON.stringify(hs.reduce((a, h) => ({ ...a, [h.properties.sigungu]: (a[h.properties.sigungu] ?? 0) + 1 }), {}))}, 이름 있음 ${hs.filter((h) => h.properties.name).length}`);
}
console.log("\nsqlite", dbPath);

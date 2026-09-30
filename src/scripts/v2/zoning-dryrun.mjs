/**
 * 용도지역을 임시 sqlite에 적재해 보고 표본 지점을 조회한다. 게시 데이터 폴더는 건드리지 않는다(core는 읽기 전용).
 *   npx tsx src/scripts/v2/zoning-dryrun.mjs --db <temp.sqlite> --layers urban,nature,other   (레이어별로 나눠 실행 가능, 이어서 적재)
 *   npx tsx src/scripts/v2/zoning-dryrun.mjs --db <temp.sqlite> --lookup [--core core.sqlite]
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { featureCollection, intersect } from "@turf/turf";

const { readShp } = await import("../../lib/v2/ingest/shp.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { buildZoning, zoningLayerFiles, ZONING_LAYERS, ZONING_RIGHTS } = await import("../../lib/v2/ingest/sources/zoning.ts");

const args = process.argv.slice(2);
const opt = (n, d) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d);
const dbPath = opt("db");
if (!dbPath) {
  console.error("usage: --db <temp.sqlite> [--layers a,b] [--lookup] [--core core.sqlite]");
  process.exit(2);
}
const RAW = process.env.V2_RAW ?? "D:/V-coding/16-SiteAnalysis/.cache/v2/raw";
const files = [];
(function collect(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? collect(join(d, e.name)) : files.push(join(d, e.name));
})(join(RAW, "zoning"));

const db = new Database(dbPath);
db.pragma("journal_mode = DELETE");
if (!db.prepare("SELECT name FROM sqlite_master WHERE name='feature'").get()) initDataFileSchema(db, "reference");

const want = opt("layers") ? opt("layers").split(",") : [];
if (want.length > 0) {
  const found = zoningLayerFiles(files);
  for (const key of want) {
    const l = ZONING_LAYERS.find((x) => x.key === key);
    const set = found.get(key);
    if (!l || !set) throw new Error(`layer ${key} not found`);
    const t0 = Date.now();
    const releaseId = insertRelease(db, { sourceId: l.sourceId, provider: "VWorld dsId 24", sourceUrl: "https://www.vworld.kr", sourceAsOf: `${set.date.slice(0, 4)}-${set.date.slice(4, 6)}-${set.date.slice(6, 8)}`, fetchedAt: new Date().toISOString(), checksum: "dryrun", licenseCode: "UNRESTRICTED", rights: ZONING_RIGHTS });
    async function* recs() {
      let n = 0;
      for (const f of set.files) for await (const r of readShp(f)) {
        if (++n % 50000 === 0) console.error(`  ${key} ${n} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
        yield r;
      }
    }
    const [s] = await buildZoning(db, [{ layer: key, releaseId, records: recs() }]);
    console.log(`${key}: read ${s.received} ok ${s.accepted} rejected ${s.rejected} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    console.log("  byType", JSON.stringify(s.byType));
    console.log("  byRegion", JSON.stringify(s.byRegion));
  }
  const size = statSync(dbPath).size;
  console.log(`sqlite size ${(size / 1024 ** 2).toFixed(0)} MB`);
}

if (args.includes("--lookup")) {
  const corePath = opt("core", "D:/V-coding/16-SiteAnalysis/.cache/v2/data/versions/2026-09-30d/core.sqlite");
  const core = new Database(corePath, { readonly: true });
  const legal = (name, sig) => core.prepare("SELECT code || '00' FROM legal_area WHERE level='emd' AND name=? AND code LIKE ?").pluck().all(name, `${sig}%`); // 법정동 10자리
  const sites = [
    { label: "강남구 개포동 12", emd: legal("개포동", "11680")[0], bun: 12 },
    { label: "강동구 고덕동 123", emd: legal("고덕동", "11740")[0], bun: 123 },
  ];
  const shoelace = (ring) => Math.abs(ring.reduce((a, p, i) => a + (ring[i - 1] ?? ring.at(-1))[0] * p[1] - p[0] * (ring[i - 1] ?? ring.at(-1))[1], 0)) / 2;
  const area = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []).reduce((a, poly) => a + shoelace(poly[0]) - poly.slice(1).reduce((h, r) => h + shoelace(r), 0), 0);
  for (const site of sites) {
    let pnu = site.bun ? `${site.emd}1${String(site.bun).padStart(4, "0")}0000` : null;
    let row = pnu && core.prepare("SELECT pnu,lng,lat,jimok FROM parcel_point WHERE pnu=?").get(pnu);
    if (!row) row = core.prepare("SELECT pnu,lng,lat,jimok FROM parcel_point WHERE pnu LIKE ? ORDER BY pnu LIMIT 1 OFFSET 200").get(`${site.emd}1%`);
    if (!row) { console.log(site.label, "core에서 필지 점을 찾지 못함", site.emd); continue; }
    const c = [row.lng, row.lat];
    const at = queryFeaturesInRadius(db, c, 1, ["zoning_area"]);
    console.log(`\n${site.label}: pnu ${row.pnu} (${c.map((v) => v.toFixed(5))}) jimok ${row.jimok}`);
    console.log("  점 위 용도지역:", at.map((h) => `${h.properties.zoningName}[${h.properties.umbrella ? "우산" : h.properties.zoningClass}${h.properties.remark.length ? " " + h.properties.remark.join("/") : ""}]`).join(" + ") || "(없음)");
    const [cx, cy] = toUtmk(c);
    const circle = { type: "Polygon", coordinates: [Array.from({ length: 129 }, (_, i) => [cx + 1000 * Math.cos((2 * Math.PI * (i % 128)) / 128), cy + 1000 * Math.sin((2 * Math.PI * (i % 128)) / 128)])] };
    const total = area(circle);
    const byClass = {}, byName = {};
    let sum = 0;
    for (const h of queryFeaturesInRadius(db, c, 1000, ["zoning_area"])) {
      if (h.properties.umbrella) continue; // 세분 없는 "도시지역" 우산 폴리곤은 구성비에서 뺀다
      const x = intersect(featureCollection([{ type: "Feature", properties: {}, geometry: circle }, { type: "Feature", properties: {}, geometry: h.geometry }]));
      const a = x ? area(x.geometry) : 0;
      sum += a;
      byClass[h.properties.zoningClass] = (byClass[h.properties.zoningClass] ?? 0) + a;
      byName[h.properties.zoningName] = (byName[h.properties.zoningName] ?? 0) + a;
    }
    const pct = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${((100 * v) / total).toFixed(1)}%`]));
    console.log("  1km 구성비(원 면적 대비, 겹침은 각각 합산):", JSON.stringify(pct(byClass)), "합", `${((100 * sum) / total).toFixed(1)}%`);
    console.log("  세분:", JSON.stringify(pct(byName)));
  }
}

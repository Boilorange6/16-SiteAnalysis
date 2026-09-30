/**
 * 건물 적재 시험: 한 시군구(PNU 앞 5자리)만 임시 sqlite에 적재하고 S02 일조 엔진을 돌려 본다. 게시 디렉터리는 건드리지 않는다.
 *   npx tsx src/scripts/v2/buildings-dryrun.mjs --sigungu 41135 [--raw .cache/v2/raw/gis_building] [--out <tmp.sqlite>]
 */
import { statSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { readShp } = await import("../../lib/v2/ingest/shp.ts");
const { latestShpPerSido } = await import("../../lib/v2/ingest/shp-parts.ts");
const { buildBuildings } = await import("../../lib/v2/ingest/sources/buildings.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { computeSunlight } = await import("../../lib/v2/sim/sunlight.ts");
const { buildS02TileResult } = await import("../../lib/v2/sim/s02-tile.ts");

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const sigungu = opt("sigungu");
if (!/^\d{5}$/.test(sigungu ?? "")) throw new Error("--sigungu <5자리> 필요");
const rawDir = opt("raw", ".cache/v2/raw/gis_building");
const out = opt("out", join(tmpdir(), `v2-buildings-${sigungu}.sqlite`));
rmSync(out, { force: true });
mkdirSync(join(out, ".."), { recursive: true });

function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const sets = latestShpPerSido([...walk(rawDir)], "AL_D010");
const set = sets.get(sigungu.slice(0, 2));
if (!set) throw new Error(`시도 ${sigungu.slice(0, 2)} 파일이 없습니다`);

const db = new Database(out);
db.pragma("journal_mode = OFF");
db.pragma("synchronous = OFF");
initDataFileSchema(db, "core");
const rel = insertRelease(db, { sourceId: "building", provider: "dryrun", sourceUrl: "https://www.vworld.kr/", sourceAsOf: set.date, fetchedAt: new Date().toISOString(), checksum: "dryrun", licenseCode: "CC-BY" });

async function* chain() {
  for (const f of set.files) yield* readShp(f, { keep: (p) => typeof p.A2 === "string" && p.A2.startsWith(sigungu) });
}
const t0 = Date.now();
const stats = await buildBuildings(db, chain(), rel, { maxYear: 2026 });
const secs = (Date.now() - t0) / 1000;
console.log(`parts ${set.files.map((f) => basename(f)).join(", ")}`);
console.log(`stream+insert ${secs.toFixed(1)}s · read ${stats.received} · ok ${stats.accepted} · rejected ${stats.rejected} · peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
console.log("height method", Object.fromEntries(Object.entries(stats.byType).map(([k, v]) => [k, `${v} (${((100 * v) / stats.accepted).toFixed(1)}%)`])));
console.log("fill", Object.fromEntries(Object.entries(stats.snapshot().fillRates).map(([k, v]) => [k, `${(100 * v).toFixed(1)}%`])));
const size = () => statSync(out).size;
console.log(`sqlite ${(size() / 1e6).toFixed(1)} MB (${(size() / Math.max(1, stats.accepted)).toFixed(0)} B/building) · vertices avg ${(db.prepare("SELECT AVG(LENGTH(geom_json)) FROM feature").pluck().get()).toFixed(0)} B geom_json/feature`);
if (stats.accepted === 0) process.exit(0);

// ─── S02 데모: 높이 있는 건물 하나를 골라 그 중심에서 60 m 대지 ───
const pick = db.prepare(`SELECT f.feature_id, f.geom_json FROM feature f JOIN building_fact b USING (feature_id) WHERE b.height_method='source' AND b.height_m BETWEEN 30 AND 60 ORDER BY f.feature_id LIMIT 1 OFFSET 3`).get()
  ?? db.prepare("SELECT feature_id, geom_json FROM feature LIMIT 1").get();
const ring0 = JSON.parse(pick.geom_json).coordinates.flat(JSON.parse(pick.geom_json).type === "MultiPolygon" ? 1 : 0)[0];
const cx = ring0.reduce((s, p) => s + p[0], 0) / ring0.length, cy = ring0.reduce((s, p) => s + p[1], 0) / ring0.length;
const invUtmk = (await import("proj4")).default;
const [lng, lat] = invUtmk("EPSG:5179", "EPSG:4326").forward([cx, cy]);
const t1 = Date.now();
const hits = queryFeaturesInRadius(db, [lng, lat], 400, ["building"]);
const heightOf = db.prepare("SELECT height_m FROM building_fact WHERE feature_id = ?").pluck();
const ringsOf = (g) => (g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]));
const buildings = hits.flatMap((h) => ringsOf(h.geometry).map((ring, i) => ({ id: `${h.stableId}#${i}`, ring: ring.map((p) => [p[0], p[1]]), heightM: heightOf.get(h.featureId) })));
const queryMs = Date.now() - t1;
const site = [[cx - 30, cy - 30], [cx + 30, cy - 30], [cx + 30, cy + 30], [cx - 30, cy + 30]];
const t2 = Date.now();
const input = { site, buildings, latDeg: lat, lonDeg: lng, date: { year: 2026, month: 12, day: 22 }, removeBuildingsInSite: true };
const r = computeSunlight(input);
const calcMs = Date.now() - t2;
const tile = buildS02TileResult({ ...input, analysisId: "dryrun", address: `dryrun ${sigungu}`, center: [lng, lat], radiusM: 30, manifestHash: "0".repeat(64), sources: [{ sourceId: "building", releaseId: rel, sourceAsOf: set.date, fetchedAt: new Date().toISOString() }] }, r);
console.log(`S02 center ${lng.toFixed(5)},${lat.toFixed(5)} · buildings within 400m ${buildings.length} (height known ${buildings.filter((b) => b.heightM !== null).length}) · query ${queryMs} ms · compute ${calcMs} ms`);
console.log("counts", JSON.stringify(r.counts), "buildings", JSON.stringify(r.buildings), "median h", r.medianHours, "share>=2h", r.shareAtLeastN, "uncalculated", r.uncalculatedRatio);
console.log("tile status", tile.status, "limitations", tile.limitations.map((l) => l.kind).join(","));
db.close();

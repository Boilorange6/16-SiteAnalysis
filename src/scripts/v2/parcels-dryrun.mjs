/** 연속지적도 한 시도만 임시 sqlite에 적재해 행당 저장 크기를 측정한다. 게시본·데이터 캐시는 건드리지 않는다.
 *   npx tsx src/scripts/v2/parcels-dryrun.mjs --sido 36 [--raw .cache/v2/raw/cadastral] [--out <tmp.sqlite>]
 */
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { readShp } = await import("../../lib/v2/ingest/shp.ts");
const { latestShpPerSido } = await import("../../lib/v2/ingest/shp-parts.ts");
const { buildParcelPolygons } = await import("../../lib/v2/ingest/sources/parcel-polygons.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const sido = opt("sido");
if (!/^\d{2}$/.test(sido ?? "")) throw new Error("--sido <2자리 시도 코드> 필요");
const rawDir = opt("raw", ".cache/v2/raw/cadastral");
const out = opt("out", join(tmpdir(), `v2-parcels-${sido}.sqlite`));
rmSync(out, { force: true });
mkdirSync(join(out, ".."), { recursive: true });

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const sets = latestShpPerSido([...walk(rawDir)], "AL_D002");
const set = sets.get(sido);
if (!set) throw new Error(`시도 ${sido} 파일이 없습니다: ${rawDir}`);

const db = new Database(out);
db.pragma("journal_mode = OFF");
db.pragma("synchronous = OFF");
initDataFileSchema(db, "parcels");
const rel = insertRelease(db, {
  sourceId: "parcel_polygon",
  provider: "dryrun",
  sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=23",
  sourceAsOf: set.date,
  fetchedAt: new Date().toISOString(),
  checksum: "dryrun",
  licenseCode: "CC-BY",
});

async function* records() {
  for (const file of set.files) yield* readShp(file);
}

const started = Date.now();
const stats = await buildParcelPolygons(db, records(), rel);
const elapsed = (Date.now() - started) / 1000;
const sqliteBytes = statSync(out).size;
const geometryBytes = db.prepare("SELECT AVG(LENGTH(geom_json)) FROM feature").pluck().get() ?? 0;
console.log(`parts ${set.files.map((file) => basename(file)).join(", ")}`);
console.log(`stream+insert ${elapsed.toFixed(1)}s · read ${stats.received} · ok ${stats.accepted} · rejected ${stats.rejected} · peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`);
console.log(`sqlite ${(sqliteBytes / 1e6).toFixed(1)} MB (${(sqliteBytes / Math.max(1, stats.accepted)).toFixed(0)} B/parcel) · vertices avg ${Number(geometryBytes).toFixed(0)} B geom_json/feature`);
db.close();

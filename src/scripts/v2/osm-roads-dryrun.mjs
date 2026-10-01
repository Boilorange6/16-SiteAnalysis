/** OSM 도로 SHP를 게시 데이터 디렉터리 밖 임시 sqlite에 적재해 규모·분류를 확인한다.
 *   npx tsx src/scripts/v2/osm-roads-dryrun.mjs [--raw .cache/v2/raw/osm] [--out <tmp.sqlite>]
 */
import { basename, dirname, join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { extractSelected } = await import("../../lib/v2/ingest/unzip.ts");
const { readShp } = await import("../../lib/v2/ingest/shp.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildOsmRoads, OSM_ROADS_LAYER, OSM_ROADS_RIGHTS, ROAD_HIERARCHIES } = await import("../../lib/v2/ingest/sources/osm-roads.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const rawDir = opt("raw", ".cache/v2/raw/osm");
const defaultDir = mkdtempSync(join(tmpdir(), "v2-osm-roads-"));
const out = opt("out", join(defaultDir, "reference.sqlite"));
rmSync(out, { force: true });
mkdirSync(dirname(out), { recursive: true });

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const findRoadShp = () => [...walk(rawDir)].find((file) => basename(file).toLowerCase() === `${OSM_ROADS_LAYER}.shp`.toLowerCase()) ?? null;
let roadsFile = findRoadShp();
if (!roadsFile && !existsSync(join(rawDir, "dl.done"))) throw new Error(`dl.done 없음 — 다운로드 완료 후 실행하세요: ${join(rawDir, "dl.done")}`);
if (!roadsFile) {
  extractSelected(rawDir, (entry) => new RegExp(`(?:^|/)${OSM_ROADS_LAYER}\\.(?:shp|dbf|prj|cpg)$`, "i").test(entry.replace(/\\/g, "/")));
  roadsFile = findRoadShp();
}
if (!roadsFile) throw new Error(`${OSM_ROADS_LAYER}.shp 없음: ${rawDir}`);

const archive = [...walk(rawDir)].filter((file) => /\.zip$/i.test(file)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? roadsFile;
const dateMatch = basename(archive).match(/(?:^|-)(20\d{2})-?(\d{2})-?(\d{2})(?:-|\.)/) ?? basename(archive).match(/(?:^|-)(\d{2})(\d{2})(\d{2})(?:-|\.)/);
const sourceAsOf = dateMatch ? (dateMatch[1].length === 4 ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : `20${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`) : null;
const db = new Database(out);
db.pragma("journal_mode = OFF");
db.pragma("synchronous = OFF");
initDataFileSchema(db, "reference");
const st = statSync(archive);
const releaseId = insertRelease(db, {
  sourceId: "osm_roads",
  provider: "OpenStreetMap (Geofabrik free shapefile extract)",
  sourceUrl: "https://download.geofabrik.de/asia/south-korea.html",
  sourceAsOf,
  fetchedAt: st.mtime.toISOString(),
  checksum: `size-mtime:${st.size}-${Math.round(st.mtimeMs)}`,
  licenseCode: "ODbL-1.0",
  rights: OSM_ROADS_RIGHTS,
});

const started = Date.now();
const stats = await buildOsmRoads(db, readShp(roadsFile), releaseId);
const seconds = (Date.now() - started) / 1000;
const sqliteMb = statSync(out).size / 1e6;
const byHierarchy = Object.fromEntries(ROAD_HIERARCHIES.map((hierarchy) => [hierarchy, stats.byType[hierarchy] ?? 0]));
console.log(`rows ${stats.accepted} · received ${stats.received} · rejected ${stats.rejected}`);
console.log(`by-hierarchy ${JSON.stringify(byHierarchy)}`);
console.log(`sqlite MB ${sqliteMb.toFixed(1)} · seconds ${seconds.toFixed(1)} · out ${out}`);
db.close();

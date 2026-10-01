/**
 * VWorld dsId 24 D11/D12 한 레이어를 raw zip의 임시 복사본에서 읽어 임시 sqlite에 적재한다.
 * 원본 raw zip과 게시 data 디렉터리는 쓰지 않는다.
 *
 *   npx tsx src/scripts/v2/districts-dryrun.mjs --layer other_infrastructure --db <temp.sqlite>
 *   npx tsx src/scripts/v2/districts-dryrun.mjs --layer health_hygiene --raw <districts/2026-09-09> --db <temp.sqlite>
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { extractAll } = await import("../../lib/v2/ingest/unzip.ts");
const { readShp } = await import("../../lib/v2/ingest/shp.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildDistricts, districtLayerFiles, DISTRICT_LAYERS, DISTRICT_RIGHTS } = await import("../../lib/v2/ingest/sources/districts.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const layerKey = opt("layer", "other_infrastructure");
const layer = DISTRICT_LAYERS.find((candidate) => candidate.key === layerKey);
if (!layer) throw new Error(`unknown layer ${layerKey}; choose one of ${DISTRICT_LAYERS.map((candidate) => candidate.key).join(", ")}`);

const rawDir = resolve(opt("raw", process.env.V2_RAW ?? "D:/V-coding/16-SiteAnalysis/.cache/v2/raw/districts/2026-09-09"));
const zipPath = join(rawDir, `${layer.title.replaceAll("/", "_")}.zip`);
if (!existsSync(zipPath)) throw new Error(`raw zip not found: ${zipPath}`);

const stageDir = mkdtempSync(join(tmpdir(), "v2-district-dryrun-"));
const stagedZip = join(stageDir, basename(zipPath));
cpSync(zipPath, stagedZip);
extractAll(stageDir);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const files = [...walk(stageDir)];
const found = districtLayerFiles(files, [{ key: layer.key, fileTag: layer.fileTag }]);
const set = found.get(layer.key);
if (!set) throw new Error(`${layer.fileTag} SHP not found after extracting ${stagedZip}`);

const requestedDb = opt("db", join(stageDir, `${layer.key}.sqlite`));
const dbPath = resolve(requestedDb);
if (/[\\/]\.cache[\\/]v2[\\/]data(?:[\\/]|$)/i.test(dbPath)) {
  throw new Error(`refusing to write under v2 data directory: ${dbPath}`);
}
if (existsSync(dbPath)) throw new Error(`refusing to overwrite existing sqlite: ${dbPath}`);
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = DELETE");
initDataFileSchema(db, "reference");
const fileStat = statSync(set.files[0]);
const releaseId = insertRelease(db, {
  sourceId: layer.sourceId,
  provider: "국토교통부(VWorld 일별용도지역지구정보)",
  sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=24",
  sourceAsOf: `${set.date.slice(0, 4)}-${set.date.slice(4, 6)}-${set.date.slice(6, 8)}`,
  fetchedAt: fileStat.mtime.toISOString(),
  checksum: `size-mtime:${fileStat.size}-${Math.round(fileStat.mtimeMs)}`,
  licenseCode: "UNRESTRICTED",
  rights: { ...DISTRICT_RIGHTS, layer: layer.title, cls: layer.cls, kind: layer.kind },
});

async function* records() {
  for (const file of set.files) for await (const record of readShp(file)) yield record;
}

const [stats] = await buildDistricts(db, [{ layer, releaseId, records: records() }]);
const stored = db.prepare("SELECT COUNT(*) AS count FROM feature WHERE kind = ?").get(layer.kind).count;
console.log(JSON.stringify({
  layer: { key: layer.key, sourceId: layer.sourceId, fileTag: layer.fileTag, date: set.date, files: set.files },
  sqlite: dbPath,
  rows: { read: stats.received, accepted: stats.accepted, rejected: stats.rejected, unlocated: stats.unlocated, stored },
  byType: stats.byType,
}, null, 2));
db.close();

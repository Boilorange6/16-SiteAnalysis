/**
 * Read-only school-zone dry load. It builds a temporary reference SQLite in
 * the OS temp directory and never touches .cache/v2/data or the raw files.
 *
 *   node src/scripts/v2/schoolzone-dryrun.mjs [--raw D:/.../.cache/v2/raw]
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const raw = resolve(String(opt("raw", "D:/V-coding/16-SiteAnalysis/.cache/v2/raw")));
const started = Date.now();
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildPointSource } = await import("../../lib/v2/ingest/sources/points.ts");
const { buildSchoolZoneLinks, SCHOOL_SPEC } = await import("../../lib/v2/ingest/sources/school-kapt.ts");
const { buildSchoolZones, readSchoolZoneGeoJson, SCHOOL_ZONE_LAYERS, SCHOOL_ZONE_RIGHTS, SCHOOL_ZONE_SOURCE_ID } = await import("../../lib/v2/ingest/sources/school-zones.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");

const vworldDir = join(raw, "school_zone", "vworld");
const files = SCHOOL_ZONE_LAYERS.map((layer) => ({ layer, file: join(vworldDir, `${layer.apiLayer}.geojson`) }));
for (const { file } of files) if (!existsSync(file)) throw new Error(`missing VWorld school-zone file: ${file}`);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const newest = (dir, re) => walk(dir).filter((file) => re.test(file.split(/[\\/]/).at(-1))).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
const done = files.map(({ file }) => JSON.parse(readFileSync(`${file}.done.json`, "utf8")));
const dates = done.flatMap((d) => Array.isArray(d.base_dates) ? d.base_dates : typeof d.base_dt === "string" ? [d.base_dt] : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const sourceAsOf = dates.at(-1) ?? null;
const tempDir = mkdtempSync(join(tmpdir(), "v2-schoolzone-dry-"));
const dbPath = join(tempDir, "reference.sqlite");
const db = new Database(dbPath);
initDataFileSchema(db, "reference");
const releaseId = insertRelease(db, {
  sourceId: SCHOOL_ZONE_SOURCE_ID,
  provider: "국토교통부(VWorld Data API 학교 학구도·학교군)",
  sourceUrl: "https://api.vworld.kr/req/data",
  sourceAsOf,
  fetchedAt: new Date().toISOString(),
  checksum: files.map(({ file }) => `${file}:${statSync(file).size}`).join("|"),
  licenseCode: "UNRESTRICTED",
  rights: SCHOOL_ZONE_RIGHTS,
});

const stats = await buildSchoolZones(db, files.map(({ layer, file }) => ({
  layer: layer.key,
  releaseId,
  records: readSchoolZoneGeoJson(file),
})));
const zoneIds = new Set(db.prepare("SELECT stable_id FROM feature WHERE kind IN ('school_zone_elem', 'school_zone_middle', 'school_zone_high')").pluck().all());

let schoolStats = null;
let linkStats = null;
let attrStats = null;
const linkFile = join(raw, "school_zone", "school-zone-link-std.csv");
const attrFile = join(raw, "school_zone", "school-zone-elem-std.csv");
if (existsSync(linkFile) && existsSync(attrFile)) {
  const schoolFile = newest(join(raw, "school"), /^school-location.*\.csv$/i);
  if (schoolFile) {
    const schoolRelease = insertRelease(db, { sourceId: "school", provider: "한국교육시설안전원", sourceUrl: "https://www.data.go.kr/data/15021148/standard.do", sourceAsOf, fetchedAt: new Date().toISOString(), checksum: String(statSync(schoolFile).size), licenseCode: "UNRESTRICTED" });
    schoolStats = await buildPointSource(db, SCHOOL_SPEC, (await csvRecords(schoolFile)).records, schoolRelease);
  }
  const linkRelease = insertRelease(db, { sourceId: "school_zone_link", provider: "한국교육시설안전원", sourceUrl: "https://www.data.go.kr/data/15021158/standard.do", sourceAsOf, fetchedAt: new Date().toISOString(), checksum: String(statSync(linkFile).size), licenseCode: "UNRESTRICTED" });
  const attrRelease = insertRelease(db, { sourceId: "school_zone_elem", provider: "한국교육시설안전원", sourceUrl: "https://www.data.go.kr/data/15021149/standard.do", sourceAsOf, fetchedAt: new Date().toISOString(), checksum: String(statSync(attrFile).size), licenseCode: "UNRESTRICTED" });
  [linkStats, attrStats] = await buildSchoolZoneLinks(db, {
    link: (await csvRecords(linkFile)).records,
    elem: (await csvRecords(attrFile)).records,
    linkReleaseId: linkRelease,
    elemReleaseId: attrRelease,
    zoneIds,
  });
}

const summary = (s) => s ? { sourceId: s.sourceId, received: s.received, accepted: s.accepted, unlocated: s.unlocated, rejected: s.rejected, byRegion: s.byRegion } : null;
console.log(JSON.stringify({
  raw,
  tempDb: dbPath,
  sourceAsOf,
  layers: stats.map(summary),
  totals: {
    received: stats.reduce((n, s) => n + s.received, 0),
    accepted: stats.reduce((n, s) => n + s.accepted, 0),
    unlocated: stats.reduce((n, s) => n + s.unlocated, 0),
    rejected: stats.reduce((n, s) => n + s.rejected, 0),
    features: db.prepare("SELECT COUNT(*) FROM feature WHERE kind LIKE 'school_zone_%'").pluck().get(),
    links: db.prepare("SELECT COUNT(*) FROM feature_link WHERE relation_type = 'serves_zone'").pluck().get(),
  },
  school: summary(schoolStats),
  schoolZoneLink: summary(linkStats),
  schoolZoneAttr: summary(attrStats),
  seconds: Math.round((Date.now() - started) / 10) / 100,
}, null, 2));
db.close();

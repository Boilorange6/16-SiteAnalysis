/**
 * A0 측정 CLI.
 *   npm run a0:measure -- <file.csv|file.shp> [--region-field CODE] [--region-digits 2]
 *                         [--lng-field X --lat-field Y] [--encoding cp949] [--crs EPSG:5186]
 *                         [--site-radius 1000] [--out report.json]
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import proj4 from "proj4";

const { measureRecords, csvRecords, shpRecords } = await import("../../lib/v2/a0/measure.ts");
const { REVIEW_SITES } = await import("../../lib/v2/a0/review-sites.ts");
const { PROJ4_DEFINITIONS } = await import("../../lib/server/maintenance/boundary-crs.ts");
for (const [name, def] of Object.entries(PROJ4_DEFINITIONS)) proj4.defs(name, def);
await import("../../lib/v2/crs.ts"); // EPSG:5179 정의

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error("usage: a0-measure <file.csv|file.shp> [options]");
  process.exit(2);
}
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};

const ext = extname(file).toLowerCase();
let fieldNames;
let records;
let encoding;
if (ext === ".csv") {
  ({ fieldNames, records, encoding } = csvRecords(readFileSync(file), { lngField: opt("lng-field"), latField: opt("lat-field") }));
} else if (ext === ".shp") {
  encoding = opt("encoding", "cp949");
  ({ fieldNames, records } = await shpRecords(file, { encoding, crs: opt("crs", "EPSG:5186") }));
} else {
  console.error(`unsupported file type ${ext}`);
  process.exit(2);
}

const report = await measureRecords(records, fieldNames, {
  regionField: opt("region-field"),
  regionDigits: Number(opt("region-digits", "2")),
  sites: REVIEW_SITES,
  siteRadiusM: Number(opt("site-radius", "1000")),
});
const out = { file, bytes: statSync(file).size, encoding, measuredAt: new Date().toISOString(), ...report };
const json = JSON.stringify(out, null, 2);
const outPath = opt("out");
if (outPath) writeFileSync(outPath, json);
console.log(json);

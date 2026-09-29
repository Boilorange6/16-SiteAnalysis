/**
 * A0 측정 CLI.
 *   npm run a0:measure -- <file.csv|file.shp> [--region-field CODE] [--region-digits 2]
 *                         [--lng-field X --lat-field Y] [--encoding cp949] [--crs EPSG:5186]
 *                         [--site-radius 1000] [--out report.json]
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import proj4 from "proj4";

const { measureRecords, csvRecords, shpRecords, normalizeEncoding } = await import("../../lib/v2/a0/measure.ts");
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

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const regionDigits = Number(opt("region-digits", "2"));
if (!Number.isInteger(regionDigits) || regionDigits < 1) fail("--region-digits must be a positive integer");

const ext = extname(file).toLowerCase();
const encodingArg = opt("encoding");
let fieldNames;
let records;
let encoding;
let pointBasis = "none";
if (ext === ".csv") {
  const csvEncoding = encodingArg === undefined ? undefined : normalizeEncoding(encodingArg);
  if (csvEncoding !== undefined && csvEncoding !== "utf-8" && csvEncoding !== "euc-kr") fail(`unsupported --encoding ${encodingArg} for CSV (use utf-8 or cp949)`);
  const lngField = opt("lng-field");
  const latField = opt("lat-field");
  ({ fieldNames, records, encoding } = await csvRecords(file, { lngField, latField, encoding: csvEncoding }));
  if (lngField && latField) pointBasis = "lnglat-columns";
} else if (ext === ".shp") {
  encoding = normalizeEncoding(encodingArg ?? "euc-kr");
  const prj = file.replace(/\.shp$/i, ".prj");
  if (opt("crs") === undefined && existsSync(prj)) {
    console.error(`warning: --crs not given (assuming EPSG:5186) but ${prj} exists: ${readFileSync(prj, "utf8").slice(0, 120)}`);
  }
  ({ fieldNames, records } = await shpRecords(file, { encoding, crs: opt("crs", "EPSG:5186") }));
  pointBasis = "bbox-center";
} else {
  fail(`unsupported file type ${ext}`);
}

const regionField = opt("region-field");
if (regionField && !fieldNames.includes(regionField)) fail(`--region-field "${regionField}" not in fields: ${fieldNames.join(", ")}`);

const report = await measureRecords(records, fieldNames, {
  regionField,
  regionDigits,
  sites: REVIEW_SITES,
  siteRadiusM: Number(opt("site-radius", "1000")),
  pointBasis,
});
const out = { file, bytes: statSync(file).size, encoding, measuredAt: new Date().toISOString(), ...report };
const json = JSON.stringify(out, null, 2);
const outPath = opt("out");
if (outPath) writeFileSync(outPath, json);
console.log(json);

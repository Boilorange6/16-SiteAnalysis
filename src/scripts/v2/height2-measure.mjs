/**
 * 높이 보강 2단계의 재현 가능한 원천 측정.
 * --out은 저장소 밖 scratchpad를 지정한다. 모든 원천은 스트리밍으로만 읽는다.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { openDbf } from "shapefile";

const { csvRecords, isFilled, normalizeEncoding } = await import("../../lib/v2/a0/measure.ts");
const { latestShpPerSido } = await import("../../lib/v2/ingest/shp-parts.ts");
const { cleanProps } = await import("../../lib/v2/ingest/shp.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const raw = opt("raw", "C:\\SiteAnalysisData\\v2\\raw");
const out = opt("out");
if (!out) throw new Error("--out scratchpad\\height2\\measure.json is required");

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

// GIS 측정에는 도형이 필요 없다. .shp 전체를 재투영하는 대신 같은
// basename의 DBF만 스트리밍해 1,700만 건의 속성 채움률을 계산한다.
async function* readDbfProperties(shpPath) {
  const dbfPath = shpPath.replace(/\.shp$/i, ".dbf");
  const cpgPath = shpPath.replace(/\.shp$/i, ".cpg");
  const encoding = existsSync(cpgPath) ? normalizeEncoding(readFileSync(cpgPath, "utf8").trim()) : "euc-kr";
  const source = await openDbf(dbfPath, { encoding });
  for (let row = await source.read(); !row.done; row = await source.read()) yield cleanProps((row.value ?? {}));
}

const positive = (value) => {
  const n = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(n) && n > 0;
};
const validPnu = (value) => /^\d{19}$/.test(String(value ?? "").trim());
const validDate = (value) => /^\d{8}$/.test(String(value ?? "").trim()) && !/^0{8}$/.test(String(value ?? "").trim());
const regionOf = (p, fallback = "(미상)") => {
  for (const value of [p.A23, p.A2, p.A3, p["시군구_코드"]]) {
    const s = String(value ?? "").trim();
    if (/^\d{2}/.test(s)) return s.slice(0, 2);
  }
  return fallback;
};

function emptyTally() {
  return { rows: 0, fields: {}, unknownHeight: 0, invalidPnu: 0 };
}
function add(tally, name, present) {
  if (present) tally.fields[name] = (tally.fields[name] ?? 0) + 1;
}
function addBuilding(tally, p) {
  tally.rows += 1;
  const pnu = validPnu(p.A2);
  add(tally, "A2_nonblank", isFilled(p.A2));
  add(tally, "A2_valid_pnu", pnu);
  add(tally, "A3_valid_legal_code", /^\d{10}$/.test(String(p.A3 ?? "").trim()));
  add(tally, "A21_ledger_pk", isFilled(p.A21));
  add(tally, "A8_use_code", isFilled(p.A8));
  add(tally, "A24_building_name", isFilled(p.A24));
  add(tally, "A12_footprint_positive", positive(p.A12));
  add(tally, "A14_gross_positive", positive(p.A14));
  add(tally, "A16_height_positive", positive(p.A16));
  add(tally, "A26_floors_positive", positive(p.A26));
  add(tally, "A13_approval_valid", validDate(p.A13));
  if (!positive(p.A16) && !positive(p.A26)) tally.unknownHeight += 1;
  if (!pnu) tally.invalidPnu += 1;
}
function addTitle(tally, p) {
  tally.rows += 1;
  const gb = String(p["대지_구분_코드"] ?? "").trim();
  const pnu = validPnu(`${String(p["시군구_코드"] ?? "").trim()}${String(p["법정동_코드"] ?? "").trim()}${gb === "1" ? "2" : gb === "0" ? "1" : ""}${String(p.번 ?? "").trim().padStart(4, "0")}${String(p.지 ?? "").trim().padStart(4, "0")}`);
  const main = !String(p["주_부속_구분_코드_명"] ?? "").includes("부속") && String(p["주_부속_구분_코드"] ?? "") !== "1";
  add(tally, "관리_건축물대장_PK", isFilled(p["관리_건축물대장_PK"]));
  add(tally, "PNU_derivable", pnu);
  add(tally, "동_명", isFilled(p["동_명"]));
  add(tally, "주건축물", main);
  add(tally, "건축_면적_positive", positive(p["건축_면적(㎡)"]));
  add(tally, "연면적_positive", positive(p["연면적(㎡)"]));
  add(tally, "높이_positive", positive(p["높이(m)"]));
  add(tally, "지상_층_수_positive", positive(p["지상_층_수"]));
  add(tally, "사용승인_일_valid", validDate(p["사용승인_일"]));
  if (!positive(p["높이(m)"]) && !positive(p["지상_층_수"])) tally.unknownHeight += 1;
  if (!pnu) tally.invalidPnu += 1;
}
function rates(tally) {
  return Object.fromEntries(Object.entries(tally.fields).map(([field, value]) => [field, { filled: value, total: tally.rows, fillRate: tally.rows ? value / tally.rows : null }]));
}

const started = Date.now();
const gis = { files: [], total: emptyTally(), bySido: {} };
const allGis = latestShpPerSido([...walk(join(raw, "gis_building"))], "AL_D010");
for (const [sido, value] of allGis) {
  const tally = emptyTally();
  for (const file of value.files) {
    const fileTally = emptyTally();
    for await (const properties of readDbfProperties(file)) {
      addBuilding(fileTally, properties);
      addBuilding(gis.total, properties);
      addBuilding(tally, properties);
    }
    gis.files.push({ path: file, rows: fileTally.rows, bytes: statSync(file).size });
  }
  gis.bySido[sido] = { ...tally, rates: rates(tally) };
}
gis.total.rates = rates(gis.total);

const titleFile = [...walk(join(raw, "ledger_title"))].filter((file) => /^title_\d{6}\.csv$/i.test(basename(file))).sort((a, b) => basename(b).localeCompare(basename(a)))[0];
const title = { file: titleFile, bytes: statSync(titleFile).size, encoding: null, total: emptyTally(), bySido: {} };
const titleInput = await csvRecords(titleFile);
title.encoding = titleInput.encoding;
for await (const record of titleInput.records) {
  const region = String(record.properties["시군구_코드"] ?? "").slice(0, 2) || "(미상)";
  addTitle(title.total, record.properties);
  const tally = title.bySido[region] ?? (title.bySido[region] = emptyTally());
  addTitle(tally, record.properties);
}
title.total.rates = rates(title.total);
for (const tally of Object.values(title.bySido)) tally.rates = rates(tally);

const result = { measuredAt: new Date().toISOString(), elapsedSeconds: (Date.now() - started) / 1000, raw, gis, title };
writeFileSync(out, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ out, elapsedSeconds: result.elapsedSeconds, gisRows: gis.total.rows, titleRows: title.total.rows, titleEncoding: title.encoding }));

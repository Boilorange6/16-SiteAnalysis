/** 표제부 매칭 정확도 검증: A16/A13 원천값이 이미 있는 건물만 비교한다. */
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";

const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { latestShpPerSido } = await import("../../lib/v2/ingest/shp-parts.ts");
const { readShp } = await import("../../lib/v2/ingest/shp.ts");
const { buildLedgerTitleIndex, ledgerTitleLookup } = await import("../../lib/v2/ingest/sources/ledger.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const raw = opt("raw", "C:\\SiteAnalysisData\\v2\\raw");
const sido = String(opt("sido", "11"));
const out = opt("out");
if (!out) throw new Error("--out scratchpad\\height2\\validation.json is required");

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}
const positive = (v) => { const n = Number(String(v ?? "").replaceAll(",", "").trim()); return Number.isFinite(n) && n > 0 ? n : null; };
const validPnu = (v) => /^\d{19}$/.test(String(v ?? "").trim());
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim()) ? String(v).trim() : null;
const quantile = (values, q) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))]; };

const titleFiles = [...walk(join(raw, "ledger_title"))].filter((file) => /^title_\d{6}\.csv$/i.test(basename(file))).sort((a, b) => basename(b).localeCompare(basename(a)));
const titleFile = titleFiles[0] ?? [...walk(join(raw, "ledger_title"))].find((file) => /^title_5sido\.csv$/i.test(basename(file)));
if (!titleFile) throw new Error("ledger title CSV not found");
const titleDb = new Database(":memory:");
const titleInput = await csvRecords(titleFile);
const indexedRows = await buildLedgerTitleIndex(titleDb, titleInput.records, { temporary: true, pnuPrefixes: new Set([sido]) });
const lookup = ledgerTitleLookup(titleDb);
if (!lookup) throw new Error("title index unavailable");

const all = latestShpPerSido([...walk(join(raw, "gis_building"))], "AL_D010");
const files = all.get(sido)?.files ?? [];
if (files.length === 0) throw new Error(`GIS building files not found for sido ${sido}`);
const matchedRows = [];
const byMethod = new Map();
let sourceHeightRows = 0;
let sourceFloorsRows = 0;
let sourceApprovalRows = 0;
let matched = 0;
let sourceHeightMatched = 0;
let sourceApprovalMatched = 0;
for (const file of files) {
  for await (const record of readShp(file, { native: true })) {
    const p = record.properties;
    const pnu = validPnu(p.A2) ? String(p.A2).trim() : null;
    const sourceHeight = positive(p.A16);
    const sourceFloors = positive(p.A26);
    const sourceApproval = validDate(p.A13);
    if (sourceHeight !== null) sourceHeightRows += 1;
    if (sourceFloors !== null) sourceFloorsRows += 1;
    if (sourceApproval !== null) sourceApprovalRows += 1;
    if (!pnu) continue;
    const match = lookup.match({ pnu, ledgerPk: String(p.A21 ?? "").trim() || null, name: String(p.A24 ?? "").trim() || null, grossFloorAreaM2: positive(p.A14), footprintAreaM2: positive(p.A12) });
    if (!match) continue;
    matched += 1;
    const method = match.method;
    const entry = byMethod.get(method) ?? { matched: 0, sourceHeightCompared: 0, sourceFloorsCompared: 0, sourceApprovalCompared: 0, heightAbsM: [], floorAbs: [], approvalYearEqual: 0 };
    entry.matched += 1;
    if (sourceHeight !== null && match.heightM !== null && match.heightM !== undefined) {
      entry.sourceHeightCompared += 1;
      entry.heightAbsM.push(Math.abs(sourceHeight - match.heightM));
    }
    if (sourceFloors !== null && match.floorsAbove !== null && match.floorsAbove !== undefined) {
      entry.sourceFloorsCompared += 1;
      entry.floorAbs.push(Math.abs(sourceFloors - match.floorsAbove));
    }
    if (sourceApproval && match.approvalDate) {
      entry.sourceApprovalCompared += 1;
      if (sourceApproval.slice(0, 4) === match.approvalDate.slice(0, 4)) entry.approvalYearEqual += 1;
    }
    byMethod.set(method, entry);
    matchedRows.push({ ledgerPk: match.ledgerPk, method, sourceHeight, sourceFloors, sourceApproval, match });
  }
}
const pkCounts = new Map();
for (const row of matchedRows) pkCounts.set(row.ledgerPk, (pkCounts.get(row.ledgerPk) ?? 0) + 1);
const uniqueRows = matchedRows.filter((row) => pkCounts.get(row.ledgerPk) === 1);
const acceptedByMethod = new Map();
for (const row of uniqueRows) {
  const entry = acceptedByMethod.get(row.method) ?? { matched: 0, sourceHeightCompared: 0, sourceFloorsCompared: 0, sourceApprovalCompared: 0, heightAbsM: [], floorAbs: [], approvalYearEqual: 0 };
  entry.matched += 1;
  if (row.sourceHeight !== null && row.match.heightM !== null && row.match.heightM !== undefined) {
    entry.sourceHeightCompared += 1;
    entry.heightAbsM.push(Math.abs(row.sourceHeight - row.match.heightM));
  }
  if (row.sourceFloors !== null && row.match.floorsAbove !== null && row.match.floorsAbove !== undefined) {
    entry.sourceFloorsCompared += 1;
    entry.floorAbs.push(Math.abs(row.sourceFloors - row.match.floorsAbove));
  }
  if (row.sourceApproval && row.match.approvalDate) {
    entry.sourceApprovalCompared += 1;
    if (row.sourceApproval.slice(0, 4) === row.match.approvalDate.slice(0, 4)) entry.approvalYearEqual += 1;
  }
  acceptedByMethod.set(row.method, entry);
  if (row.sourceHeight !== null && row.match.heightM !== null && row.match.heightM !== undefined) sourceHeightMatched += 1;
  if (row.sourceApproval && row.match.approvalDate) sourceApprovalMatched += 1;
}
const summarize = (source) => [...source.entries()].map(([method, value]) => ({
  method,
  matched: value.matched,
  sourceHeightCompared: value.sourceHeightCompared,
  heightMedianAbsM: quantile(value.heightAbsM, 0.5),
  heightP90AbsM: quantile(value.heightAbsM, 0.9),
  sourceFloorsCompared: value.sourceFloorsCompared,
  floorsWithin1Rate: value.floorAbs.length ? value.floorAbs.filter((v) => v <= 1).length / value.floorAbs.length : null,
  sourceApprovalCompared: value.sourceApprovalCompared,
  approvalYearMatchRate: value.sourceApprovalCompared ? value.approvalYearEqual / value.sourceApprovalCompared : null,
}));
const result = {
  measuredAt: new Date().toISOString(), raw, sido, titleFile, titleEncoding: titleInput.encoding, indexedRows,
  gisFiles: files.map((file) => ({ file, bytes: statSync(file).size })),
  sourceHeightRows, sourceFloorsRows, sourceApprovalRows, matched, uniqueAccepted: uniqueRows.length,
  matchRateAmongSourceHeight: sourceHeightRows ? sourceHeightMatched / sourceHeightRows : null,
  approvalMatchRateAmongSource: sourceApprovalRows ? sourceApprovalMatched / sourceApprovalRows : null,
  oneToManyRejected: matchedRows.length - uniqueRows.length,
  byMethod: summarize(byMethod),
  acceptedByMethod: summarize(acceptedByMethod),
};
writeFileSync(out, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ out, sido, indexedRows, sourceHeightRows, matched, uniqueAccepted: uniqueRows.length, oneToManyRejected: result.oneToManyRejected }));
titleDb.close();

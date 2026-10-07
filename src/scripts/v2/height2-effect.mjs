/** scratch partial buildings.sqlite의 전후 효과와 고덕 800m를 읽기 전용 측정한다. */
import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const dbPath = opt("db");
const out = opt("out");
if (!dbPath || !out) throw new Error("--db and --out are required");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const rows = db.prepare(`SELECT b.height_method AS heightMethod, b.approval_date AS approvalDate, b.pnu_method AS pnuMethod,
  json_extract(b.field_provenance_json, '$.ledger.match') AS ledgerMatch
  FROM building_fact b JOIN feature f USING (feature_id) WHERE f.kind = 'building'`).all();
const summary = (list) => ({
  total: list.length,
  unknownHeight: list.filter((row) => row.heightMethod === "unknown").length,
  unknownApproval: list.filter((row) => row.approvalDate === null).length,
  heightMethods: Object.fromEntries([...new Set(list.map((row) => row.heightMethod))].sort().map((method) => [method, list.filter((row) => row.heightMethod === method).length])),
  pnuMethods: Object.fromEntries([...new Set(list.map((row) => row.pnuMethod))].sort().map((method) => [method, list.filter((row) => row.pnuMethod === method).length])),
  ledgerMatches: Object.fromEntries([...new Set(list.map((row) => row.ledgerMatch).filter(Boolean))].sort().map((method) => [method, list.filter((row) => row.ledgerMatch === method).length])),
});
const center = [127.15592, 37.56253];
const hits = queryFeaturesInRadius(db, center, 800, ["building"]);
const byId = new Map(db.prepare("SELECT feature_id, height_method AS heightMethod, approval_date AS approvalDate, pnu_method AS pnuMethod FROM building_fact").all().map((row) => [row.feature_id, row]));
const godeok = hits.map((hit) => ({ ...hit, ...byId.get(hit.featureId) })).filter((row) => row.heightMethod);
const result = { dbPath, all: summary(rows), godeok800m: summary(godeok), godeokCenter: center, radiusM: 800 };
writeFileSync(out, JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify({ out, all: result.all, godeok800m: result.godeok800m }));
db.close();

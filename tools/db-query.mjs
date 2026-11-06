import { readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import Database from "better-sqlite3";

// Paths follow src/lib/server/database.ts and src/lib/v2/{paths,data/manifest}.ts.
const legacy = process.env.DB_PATH || resolve(process.cwd(), ".cache/site-analysis.db");
const app = process.env.V2_APP_DB_PATH || resolve(process.cwd(), ".cache/v2/app.sqlite");
const dataDir = resolve(process.env.V2_DATA_DIR || resolve(process.cwd(), ".cache/v2/data"));
const datasets = new Set(["core", "parcels", "buildings", "reference", "market", "osm", "weather", "terrain"]);

function dataPath(name) {
  const manifest = JSON.parse(readFileSync(resolve(dataDir, "manifest.json"), "utf8"));
  const path = manifest.files?.[name]?.path;
  if (typeof path !== "string") throw new Error("Dataset is not present in the current manifest");
  const absolute = resolve(dataDir, path);
  if (!path.startsWith("versions/") || !absolute.startsWith(dataDir + sep + "versions" + sep) ||
      path !== relative(dataDir, absolute).split(sep).join("/")) throw new Error("Invalid dataset path in manifest");
  return absolute;
}

function safeValue(value, key = "") {
  if (/(?:password|passwd|secret|token|api.?key|credential|path)/i.test(key)) return "[redacted]";
  if (Buffer.isBuffer(value)) return "[blob]";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    if (/(?:[a-z]:[\\/]|\\\\|(?:^|\s)\/(?:[^\s/]+\/)+)/i.test(value)) return "[redacted]";
  }
  return value;
}

function main(args) {
  let dbName = "app", sql, columns, tables = false, table = false, limit = 50;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--db", "--columns", "--limit"].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Missing option value");
      const value = args[++i];
      if (arg === "--db") dbName = value;
      if (arg === "--columns") columns = value;
      if (arg === "--limit") {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error("Limit must be a positive integer");
        limit = Number(value);
      }
    } else if (arg === "--tables") tables = true;
    else if (arg === "--table") table = true;
    else if (arg.startsWith("--") || sql !== undefined) throw new Error("Invalid arguments");
    else sql = arg;
  }
  if (Number(tables) + Number(columns !== undefined) + Number(sql !== undefined) !== 1) throw new Error("Choose SQL, --tables, or --columns");
  const path = dbName === "app" || dbName === "legacy" ? legacy : dbName === "v2-app" ? app : datasets.has(dbName) ? dataPath(dbName) : dbName;
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    let stmt, bindings = [];
    if (tables) stmt = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    else if (columns !== undefined) {
      stmt = db.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid");
      bindings = [columns];
    } else stmt = db.prepare(sql);
    if (!stmt.readonly) throw new Error("Write SQL is not allowed");
    if (!stmt.reader) throw new Error("SQL must return rows");
    const rows = [];
    for (const row of stmt.iterate(...bindings)) {
      rows.push(Object.fromEntries(Object.entries(row).map(([key, value]) => [safeValue(key), safeValue(value, key)])));
      if (rows.length >= limit) break;
    }
    const result = tables || columns !== undefined ? rows.map((row) => row.name) : rows;
    if (table) console.table(result); else console.log(JSON.stringify(result, null, 2));
  } finally { db.close(); }
}

try { main(process.argv.slice(2)); }
catch (error) {
  // SQLite and filesystem messages can contain paths, SQL literals, or secrets.
  const safeErrors = new Set(["Missing option value", "Limit must be a positive integer", "Invalid arguments", "Choose SQL, --tables, or --columns", "Dataset is not present in the current manifest", "Invalid dataset path in manifest", "Write SQL is not allowed", "SQL must return rows"]);
  console.error(safeErrors.has(error.message) ? error.message : "Database query failed (check DB selection and SQL)");
  process.exitCode = 1;
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "db-query-"));
const path = join(dir, "fixture.sqlite");
try {
  const db = new Database(path);
  db.exec("CREATE TABLE sample (id INTEGER, name TEXT, api_key TEXT, file_path TEXT); INSERT INTO sample VALUES (1, 'one', 'secret', 'C:/private/file'), (2, 'two', 'secret', 'C:/private/file')");
  db.close();
  const run = (...args) => spawnSync(process.execPath, ["tools/db-query.mjs", "--db", path, ...args], { encoding: "utf8" });
  const check = (...args) => { const result = run(...args); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
  assert.deepEqual(check("--tables"), ["sample"]);
  assert.deepEqual(check("--columns", "sample"), ["id", "name", "api_key", "file_path"]);
  assert.deepEqual(check("--limit", "1", "SELECT * FROM sample"), [{ id: 1, name: "one", api_key: "[redacted]", file_path: "[redacted]" }]);
  const write = run("DELETE FROM sample");
  assert.notEqual(write.status, 0);
  assert.match(write.stderr, /Write SQL is not allowed/);
  assert.equal(check("SELECT count(*) AS n FROM sample")[0].n, 2);
  console.log("PASS: tables, columns, SELECT, limit, redaction, write rejection");
} finally { rmSync(dir, { recursive: true, force: true }); }

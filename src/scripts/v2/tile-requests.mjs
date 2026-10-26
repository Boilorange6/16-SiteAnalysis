import { openV2AppDb } from "../../lib/v2/app-db.ts";
import { runTileRequestsCli } from "../../lib/v2/admin/requests-cli.ts";
import { v2AppDbPath } from "../../lib/v2/paths.ts";

const db = openV2AppDb(v2AppDbPath());
try {
  const result = runTileRequestsCli(process.argv.slice(2), db);
  if (result.code === 0) console.log(result.out);
  else console.error(result.out);
  process.exitCode = result.code;
} finally {
  db.close();
}

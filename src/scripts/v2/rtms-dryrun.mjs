/**
 * 실거래 원본 → 임시 market sqlite(게시 디렉터리 밖)로 적재해 보고 통계만 출력한다.
 *   npx tsx src/scripts/v2/rtms-dryrun.mjs [--raw dir] [--out file.sqlite] [--dong 개포동:11680,정자동:41135]
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const { readManifest, openDataFile } = await import("../../lib/v2/data/manifest.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { buildRtms } = await import("../../lib/v2/ingest/sources/rtms.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const MAIN = process.env.V2_MAIN_ROOT ?? "D:/V-coding/16-SiteAnalysis";
const rawDir = opt("raw", join(MAIN, ".cache/v2/raw"));
const dataDir = process.env.V2_DATA_DIR ?? join(MAIN, ".cache/v2/data");
const tmp = mkdtempSync(join(tmpdir(), "rtms-dry-"));
const outFile = opt("out", join(tmp, "market.sqlite"));

const core = openDataFile(dataDir, readManifest(dataDir), "core");
const db = new Database(outFile);
initDataFileSchema(db, "market");
const t0 = Date.now();
const stats = await buildRtms(db, { core, rawDir });
console.log(`built in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${outFile}`);
for (const s of stats) {
  console.log(`${s.sourceId}: read ${s.received} · located ${s.accepted} · unlocated ${s.unlocated} · rejected ${s.rejected} · located ${((100 * s.accepted) / Math.max(1, s.accepted + s.unlocated)).toFixed(1)}%`);
  const cov = JSON.parse(db.prepare("SELECT coverage_json FROM source_release WHERE source_id = ?").pluck().get(s.sourceId));
  console.log(`  files ${cov.files} · cancelled ${cov.cancelled}`);
  for (const [sido, t] of Object.entries(cov.byRegion).sort()) {
    console.log(`  시도 ${sido}: read ${t.received} · located ${t.accepted} (${((100 * t.accepted) / Math.max(1, t.accepted + t.unlocated)).toFixed(1)}%) · unlocated ${t.unlocated} · rejected ${t.rejected}`);
  }
}
const cutoff = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
for (const spec of String(opt("dong", "개포동:11680,정자동:41135")).split(",")) {
  const [dong, lawd] = spec.split(":");
  const legal = core.prepare("SELECT code FROM legal_area WHERE level = 'emd' AND parent_code = ? AND name = ?").pluck().get(lawd, dong);
  // location_id = PNU, 앞 10자리 = 법정동 코드
  const r = db.prepare("SELECT COUNT(*) n, SUM(cancelled_at IS NOT NULL) c FROM property_transaction WHERE lawd_cd = ? AND deal_date >= ? AND location_id LIKE ?").get(lawd, cutoff, `${legal}00%`);
  const all = db.prepare("SELECT COUNT(*) n FROM property_transaction WHERE lawd_cd = ? AND deal_date >= ?").pluck().get(lawd, cutoff);
  console.log(`${dong}(${lawd}, 법정동 ${legal}00) 최근 12개월(>=${cutoff}): 동 위치확정 ${r.n}건(취소 ${r.c ?? 0}) · 시군구 전체 ${all}건`);
}
db.close();
core.close();
if (!args.includes("--out")) rmSync(tmp, { recursive: true, force: true });

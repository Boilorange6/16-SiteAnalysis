/**
 * SGIS 격자 드라이런: pop_grid를 임시 reference sqlite에 적재하고 검수지 8곳(r=1 km)의 A11을 계산한다. 게시하지 않는다.
 *   npx tsx src/scripts/v2/sgis-dryrun.mjs [--raw .cache/v2/raw/sgis_grid] [--data <게시된 데이터 디렉터리(core 읽기 전용)>] [--radius 1000]
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildPopGrid, sgisRows, sgisDataYear, locateSigunguFromCore } = await import("../../lib/v2/ingest/sources/sgis-grid.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a11 } = await import("../../lib/v2/engine/tiles/a11.ts");
const { REVIEW_SITES } = await import("../../lib/v2/a0/review-sites.ts");
const { v2DataDir } = await import("../../lib/v2/paths.ts");

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const raw = resolve(opt("raw", ".cache/v2/raw/sgis_grid"));
const radiusM = Number(opt("radius", 1000));
const dataDir = resolve(opt("data", v2DataDir()));

const t0 = Date.now();
const published = M.readManifest(dataDir);
const core = published?.files.core ? M.openDataFile(dataDir, published, "core") : null;
console.log(core ? `core: ${published.version}` : "core 없음 — 시도는 (미상)");
const tmp = mkdtempSync(join(tmpdir(), "v2-sgis-"));
mkdirSync(join(tmp, "versions", "v1"), { recursive: true });
const refPath = join(tmp, "versions", "v1", "reference.sqlite");
const db = new Database(refPath);
initDataFileSchema(db, "reference");
const year = sgisDataYear(raw);
const rel = insertRelease(db, { sourceId: "sgis_grid", provider: "SGIS", sourceUrl: "https://www.data.go.kr/data/15141768/fileData.do", sourceAsOf: year, fetchedAt: new Date().toISOString(), checksum: "dryrun", licenseCode: "UNRESTRICTED" });
const stats = await buildPopGrid(db, { rows: sgisRows(raw), releaseId: rel, dataYear: year, locate: locateSigunguFromCore(core) });
db.prepare(`INSERT INTO ingest_run (run_id, source_id, started_at, finished_at, status, received_count, accepted_count, rejected_count, release_id, snapshot_json)
  VALUES ('sgis:1', 'sgis_grid', 'a', 'b', 'succeeded', ?, ?, ?, ?, ?)`).run(stats.received, stats.accepted, stats.rejected, rel, JSON.stringify({ ...stats.snapshot(), unlocated: 0 }));
core?.close();
const ingestSec = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`ingest ${ingestSec}s · read ${stats.received} · ok ${stats.accepted} · rejected ${stats.rejected} · fill ${JSON.stringify(stats.snapshot().fillRates)}`);
console.log("byRegion", JSON.stringify(stats.byRegion));

// 항목별 비공개(행 없음) 비율
const paths = { "population.total": (p) => p.population.total, "population.male": (p) => p.population.male, "households.total": (p) => p.households.total, "households.single": (p) => p.households.single, "housing.total": (p) => p.housing.total, "business.establishments": (p) => p.business.establishments, "business.employees": (p) => p.business.employees, "ageGroups.under15": (p) => p.ageGroups.under15, "ageGroups.age15to64": (p) => p.ageGroups.age15to64, "ageGroups.age65plus": (p) => p.ageGroups.age65plus };
const sup = Object.fromEntries(Object.keys(paths).map((k) => [k, 0]));
let zeros = 0, n = 0;
for (const row of db.prepare("SELECT properties_json FROM feature WHERE kind='pop_grid'").pluck().iterate()) {
  const p = JSON.parse(row);
  n++;
  for (const [k, f] of Object.entries(paths)) if (f(p).s === "suppressed") sup[k]++;
  if (p.population.total.v === 0) zeros++;
}
console.log(`cells ${n}; total-population value 0: ${zeros}`);
for (const [k, c] of Object.entries(sup)) console.log(`  suppressed ${k.padEnd(26)} ${c} (${((100 * c) / n).toFixed(1)}%)`);
db.close();

const manifest = { version: "v1", createdAt: new Date().toISOString(), files: { reference: { path: "versions/v1/reference.sqlite", sha256: await M.sha256File(refPath), kind: "reference", schemaVersion: 2 } } };
await M.publishManifest(tmp, manifest, () => ({ ok: true, failures: [] }));
const m = M.readManifest(tmp);
console.log(`\nA11 r=${radiusM}m`);
console.log("site         cells sup  pop_est  hh_est  dens/km2  hh_size single% 65+%  15-%   ms");
for (const s of REVIEW_SITES) {
  const t1 = performance.now();
  const ctx = new EngineContext(tmp, m, "dry", { address: s.name, center: s.center, radiusM, analysisDate: "2026-09-30" });
  const t = a11(ctx);
  const ms = (performance.now() - t1).toFixed(0);
  const v = (id) => t.metrics.find((x) => x.id === id)?.value ?? "-";
  console.log(`${s.id.padEnd(12)} ${String(v("cells_in_circle")).padStart(5)} ${String(v("cells_suppressed")).padStart(3)} ${String(v("pop_est")).padStart(8)} ${String(v("hh_est")).padStart(7)} ${String(v("density_per_km2")).padStart(9)} ${String(v("avg_hh_size")).padStart(8)} ${String(v("single_hh_pct")).padStart(7)} ${String(v("elder_pct")).padStart(5)} ${String(v("youth_pct")).padStart(5)} ${ms.padStart(5)}  ${t.status}`);
  if (process.env.SGIS_VERBOSE) console.log("   ", t.judgment.sentence, "\n   ", t.limitations.map((l) => `[${l.kind}] ${l.note}`).join("\n    "));
  ctx.close();
}
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);

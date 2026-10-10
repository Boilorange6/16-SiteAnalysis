/**
 * 개별공시지가를 임시 sqlite에 적재해 보고 표본 필지를 조회한다. 게시 데이터 폴더는 건드리지 않는다.
 *   npx tsx src/scripts/v2/land-price-dryrun.mjs --db <temp.sqlite> [--sido 11,26]   (시도 코드별로 나눠 실행 가능, 이어서 적재)
 *   npx tsx src/scripts/v2/land-price-dryrun.mjs --db <temp.sqlite> --lookup
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const { extractAll } = await import("../../lib/v2/ingest/unzip.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildLandPrice, latestLandPricePerSido, LAND_PRICE_RIGHTS } = await import("../../lib/v2/ingest/sources/land-price.ts");

const args = process.argv.slice(2);
const opt = (n, d) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d);
const dbPath = opt("db");
if (!dbPath) {
  console.error("usage: --db <temp.sqlite> [--sido 11,26] [--lookup]");
  process.exit(2);
}
const dir = join(process.env.V2_RAW ?? "D:/V-coding/16-SiteAnalysis/.cache/v2/raw", "land_price");
const db = new Database(dbPath);
db.pragma("journal_mode = DELETE");
if (!db.prepare("SELECT name FROM sqlite_master WHERE name='land_price'").get()) initDataFileSchema(db, "reference");

const want = opt("sido") ? opt("sido").split(",") : [];
if (want.length > 0) {
  extractAll(dir);
  const files = [];
  (function collect(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? collect(join(d, e.name)) : files.push(join(d, e.name));
  })(dir);
  const found = latestLandPricePerSido(files);
  for (const sido of want) {
    const f = found.get(sido);
    if (!f) throw new Error(`sido ${sido} csv not found`);
    const t0 = Date.now();
    const asOf = `${f.date.slice(0, 4)}-${f.date.slice(4, 6)}-${f.date.slice(6, 8)}`;
    const releaseId = `land_price@${asOf}`;
    if (!db.prepare("SELECT 1 FROM source_release WHERE release_id=?").get(releaseId)) {
      insertRelease(db, { sourceId: "land_price", provider: "국토교통부(VWorld 개별공시지가정보)", sourceUrl: "https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=NA&dsId=6", sourceAsOf: asOf, fetchedAt: new Date().toISOString(), checksum: "dryrun", licenseCode: "UNRESTRICTED", rights: LAND_PRICE_RIGHTS });
    }
    const s = await buildLandPrice(db, (await csvRecords(f.file)).records, releaseId, [sido]);
    console.log(`file ${sido}: read ${s.received} ok ${s.accepted} rejected ${s.rejected} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    console.log("  byType(year)", JSON.stringify(s.byType), "byRegion(pnu prefix)", JSON.stringify(s.byRegion), "fill", JSON.stringify(s.snapshot().fillRates));
  }
}

if (args.includes("--lookup")) {
  console.log("rows by pnu prefix:", JSON.stringify(Object.fromEntries(db.prepare("SELECT substr(pnu,1,2) p, count(*) n FROM land_price GROUP BY p").all().map((r) => [r.p, r.n]))));
  console.log("rows by year:", JSON.stringify(db.prepare("SELECT base_year y, base_month m, count(*) n FROM land_price GROUP BY y, m").all()));
  for (const pnu of ["1168010300100120000", "1174010200100690006"]) console.log(pnu, JSON.stringify(db.prepare("SELECT * FROM land_price WHERE pnu=?").get(pnu) ?? null));
}
console.log(`rows ${db.prepare("SELECT count(*) FROM land_price").pluck().get()} · sqlite size ${(statSync(dbPath).size / 1024 ** 2).toFixed(0)} MB`);

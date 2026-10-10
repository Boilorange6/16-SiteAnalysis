/**
 * 국토부 실거래(RTMS) 원본 받기.
 *   npm run rtms:fetch -- --types apt-trade[,apt-rent,offi-trade,offi-rent] --from 2025-10 --to 2026-09 [--lawd 11680,...] [--minutes 8] [--refetch]
 * 서비스키는 .env.local의 DATA_GO_KR_API_KEY. 값을 출력하지 않는다.
 * 시군구 목록은 게시된 core의 legal_area(sigungu). 이어받기 가능 — --minutes로 한 번에 도는 시간을 제한한다.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const { fetchRtms, monthsBetween, RTMS_TYPES } = await import("../../lib/v2/ingest/rtms-fetch.ts");
const { readManifest, openDataFile } = await import("../../lib/v2/data/manifest.ts");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
// ponytail: 워크트리에서도 메인 저장소의 캐시·.env.local을 쓴다. 위치가 바뀌면 V2_MAIN_ROOT로 지정.
const MAIN = process.env.V2_MAIN_ROOT ?? "D:/V-coding/16-SiteAnalysis";
const rawDir = opt("raw", join(MAIN, ".cache/v2/raw"));
const dataDir = process.env.V2_DATA_DIR ?? join(MAIN, ".cache/v2/data");
const envFile = existsSync(".env.local") ? ".env.local" : join(MAIN, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const serviceKey = process.env.DATA_GO_KR_API_KEY;
if (!serviceKey) {
  console.error("DATA_GO_KR_API_KEY가 .env.local에 없습니다.");
  process.exit(2);
}

const types = String(opt("types", "apt-trade")).split(",").filter(Boolean);
for (const t of types) if (!(t in RTMS_TYPES)) { console.error(`unknown type ${t} (${Object.keys(RTMS_TYPES).join(",")})`); process.exit(2); }
const months = monthsBetween(opt("from"), opt("to"));

let lawds;
if (opt("lawd")) lawds = opt("lawd").split(",");
else {
  const m = readManifest(dataDir);
  if (!m?.files.core) { console.error("게시된 core가 없습니다 — --lawd로 직접 지정하세요"); process.exit(2); }
  const core = openDataFile(dataDir, m, "core");
  lawds = core.prepare("SELECT code FROM legal_area WHERE level = 'sigungu' ORDER BY code").pluck().all();
  core.close();
}
console.log(`types ${types} · months ${months[0]}..${months.at(-1)} (${months.length}) · lawd ${lawds.length} · cells ${types.length * months.length * lawds.length}`);

const minutes = Number(opt("minutes", 0));
const sum = await fetchRtms({
  serviceKey, rawDir, types, months, lawds,
  refetch: args.includes("--refetch"),
  deadline: minutes > 0 ? Date.now() + minutes * 60_000 : undefined,
  log: console.log,
});
console.log(JSON.stringify({ done: sum.done, skipped: sum.skipped, rows: sum.rows, calls: sum.calls, failed: sum.failed.length, budgetStopped: sum.budgetStopped, deadlineHit: sum.deadlineHit, fatal: sum.fatal }));
for (const f of sum.failed.slice(0, 20)) console.log(`FAIL ${f.cell}: ${f.error}`);
process.exitCode = sum.fatal ? 1 : 0;

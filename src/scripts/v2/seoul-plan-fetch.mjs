/** 사용법: npx --no-install tsx src/scripts/v2/seoul-plan-fetch.mjs [--refetch] */
import { join } from "node:path";
const { fetchSeoulPlan } = await import("../../lib/v2/ingest/seoul-plan-fetch.ts");
const { maskKey } = await import("../../lib/v2/ingest/rtms-fetch.ts");
process.loadEnvFile(".env.local");
const key = process.env.SEOUL_OPEN_API_KEY;
if (!key) { console.error("SEOUL_OPEN_API_KEY가 .env.local에 없습니다."); process.exit(2); }
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
try {
  const counts = await fetchSeoulPlan({ key, rawDir: join(".cache", "v2", "raw"), date, refetch: process.argv.includes("--refetch") });
  console.log(JSON.stringify({ date, counts }));
} catch (error) {
  console.error(maskKey(error instanceof Error ? error.message : String(error), key));
  process.exitCode = 1;
}

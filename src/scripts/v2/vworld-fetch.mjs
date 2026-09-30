/**
 * VWorld 파일 받기.
 *   npm run vworld:fetch -- --ds 21,23 [--region 세종특별자치시,서울특별시] [--out .cache/v2/raw]
 * 자격 증명은 .env.local의 VWORLD_ID / VWORLD_PW. 값을 출력하지 않는다.
 */
import { existsSync } from "node:fs";

const { VworldSession, fetchDatasets } = await import("../../lib/v2/ingest/vworld.ts");
const FOLDERS = { 21: "legal_dong", 23: "cadastral", 18: "gis_building" };

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dsIds = String(opt("ds", "21,23")).split(",").filter(Boolean);
const regions = opt("region") ? new Set(String(opt("region")).split(",")) : null;
const outDir = opt("out", ".cache/v2/raw");
for (const ds of dsIds) {
  if (!FOLDERS[ds]) {
    console.error(`unsupported dsId ${ds} (supported: ${Object.keys(FOLDERS).join(",")})`);
    process.exit(2);
  }
}

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const id = process.env.VWORLD_ID;
const pw = process.env.VWORLD_PW;
if (!id || !pw) {
  console.error("VWORLD_ID / VWORLD_PW가 .env.local에 없습니다.");
  process.exit(2);
}

const session = new VworldSession();
const login = await session.login(id, pw);
if (login === "expirePw") console.warn("⚠ VWorld 비밀번호 사용기간이 지났습니다(로그인은 됨). 다운로드를 계속합니다.");

const { failures } = await fetchDatasets(session, { dsIds, regions, outDir, folders: FOLDERS, log: console.log });
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`${failures.length} failure(s)`);
  process.exit(1);
}

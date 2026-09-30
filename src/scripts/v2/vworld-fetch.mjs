/**
 * VWorld 파일 받기.
 *   npm run vworld:fetch -- --ds 21,23 [--region 세종특별자치시,서울특별시] [--out .cache/v2/raw]
 * 자격 증명은 .env.local의 VWORLD_ID / VWORLD_PW. 값을 출력하지 않는다.
 */
import { existsSync } from "node:fs";

const { VworldSession, fetchDatasets } = await import("../../lib/v2/ingest/vworld.ts");
const FOLDERS = { 21: "legal_dong", 23: "cadastral", 18: "gis_building", 24: "zoning" };
// dsId 24(일별용도지역지구정보)는 레이어별 전국 파일이라 --layers로 고른다: 용도지역 5종이 기본
const ZONING_LAYERS = ["도시지역", "관리지역", "농림지역", "자연환경보전지역", "기타용도지역"].map((n) => `국토계획/${n}`);

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

const layers = dsIds.includes("24") ? { since: opt("since", "2026-08-01"), titles: new Set(opt("layers") ? String(opt("layers")).split(",").map((n) => `국토계획/${n}`) : ZONING_LAYERS) } : undefined;
if (layers && dsIds.length > 1) {
  console.error("dsId 24는 다른 데이터셋과 함께 받지 않습니다(--ds 24만).");
  process.exit(2);
}
const { failures } = await fetchDatasets(session, { dsIds, regions, outDir, folders: FOLDERS, layers, log: console.log });
if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`${failures.length} failure(s)`);
  process.exit(1);
}

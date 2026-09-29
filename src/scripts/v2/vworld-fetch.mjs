/**
 * VWorld 파일 받기.
 *   npm run vworld:fetch -- --ds 21,23 [--region 세종특별자치시,서울특별시] [--out .cache/v2/raw]
 * 자격 증명은 .env.local의 VWORLD_ID / VWORLD_PW. 값을 출력하지 않는다.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const { VworldSession, VworldError, latestFull } = await import("../../lib/v2/ingest/vworld.ts");
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

const failures = [];
for (const ds of dsIds) {
  const files = latestFull(await session.listFiles(ds)).filter((f) => !regions || regions.has(f.region));
  console.log(`ds ${ds}: ${files.length} files (기준일 ${files[0]?.baseDate ?? "-"})`);
  for (const f of files) {
    const out = join(outDir, FOLDERS[ds], f.baseDate, `${f.region}.zip`);
    try {
      const r = await session.download(f, out);
      console.log(`  ${r.skipped ? "skip" : "got "} ${f.region} ${(r.bytes / 1024 ** 2).toFixed(1)} MB`);
    } catch (e) {
      if (!(e instanceof VworldError)) throw e;
      failures.push(`${ds} ${f.region}: ${e.message}`);
      console.error(`  FAIL ${f.region}: ${e.message}`);
    }
  }
}
if (failures.length > 0) {
  console.error(`${failures.length} file(s) failed`);
  process.exit(1);
}

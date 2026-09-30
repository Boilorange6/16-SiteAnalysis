/**
 * VWorld 대용량 파일 받기 (RaonK html5 경로). 일반 다운로더가 못 받는 큰 파일용.
 *   npm run vworld:fetch-large -- --ds 23 --region 경기도,경상북도 [--all] [--out .cache/v2/raw]
 * 자격 증명은 .env.local의 VWORLD_ID / VWORLD_PW. 모든 오류·콘솔 출력은 값을 ***로 가리고 첫 줄만 찍는다.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const { VworldSession, latestFull } = await import("../../lib/v2/ingest/vworld.ts");
const { chromium } = await import("playwright");
const FOLDERS = { 21: "legal_dong", 23: "cadastral", 18: "gis_building" };
const LARGE_BYTES = 500 * 1024 ** 2;
const BASE = "https://www.vworld.kr";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ds = String(opt("ds", "23"));
const regions = opt("region") ? new Set(String(opt("region")).split(",")) : null;
const all = args.includes("--all");
const outDir = opt("out", ".cache/v2/raw");
if (!FOLDERS[ds]) {
  console.error(`unsupported dsId ${ds} (supported: ${Object.keys(FOLDERS).join(",")})`);
  process.exit(2);
}

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const ID = process.env.VWORLD_ID;
const PW = process.env.VWORLD_PW;
if (!ID || !PW) {
  console.error("VWORLD_ID / VWORLD_PW가 .env.local에 없습니다.");
  process.exit(2);
}
const clean = (s) => String(s).split("\n")[0].split(ID).join("***").split(PW).join("***").slice(0, 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");

// 목록: 일반 세션으로 (fileSq·baseDate 등은 목록에서만 가져온다)
const session = new VworldSession();
await session.login(ID, PW);
const files = latestFull(await session.listFiles(ds)).filter(
  (f) => (!regions || regions.has(f.region)) && (all || (f.approxBytes ?? 0) > LARGE_BYTES),
);
if (files.length === 0) {
  console.error("받을 파일이 없습니다 (region/크기 조건 확인).");
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ acceptDownloads: true });
await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "platform", { get: () => "Linux x86_64" }));
await ctx.request.get(`${BASE}/v4po_usrlogin_a001.do`);
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const lr = await ctx.request.post(`${BASE}/v4po_usrlogin_a004.do`, {
  headers: { "x-requested-with": "XMLHttpRequest", referer: `${BASE}/v4po_usrlogin_a001.do`, origin: BASE },
  form: { usrIdeE: b64(ID), usrPwdE: b64(PW), nextUrl: "" },
});
const loginResult = (await lr.json().catch(() => ({}))).resultMap?.result;
if (loginResult !== "success" && loginResult !== "expirePw") {
  console.error(`login failed: ${clean(loginResult)}`);
  await browser.close();
  process.exit(1);
}

async function fetchOne(f, out) {
  const part = `${out}.part`;
  mkdirSync(dirname(out), { recursive: true });
  const page = await ctx.newPage();
  try {
    page.on("console", () => {}); // 콘솔은 자격 증명이 섞일 수 있어 버린다
    await page.route(/downloadDtnaResourceFile\.do/, async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace(/Runtimes:\s*'agent'/, "Runtimes: 'html5'");
      await route.fulfill({ response: res, body });
    });
    const dlPromise = page.waitForEvent("download", { timeout: 180000 });
    await page.goto(`${BASE}/dtmk/downloadDtnaResourceFile.do?ds_file_sq=${f.dsFileId}${f.fileSq}`, { waitUntil: "domcontentloaded" });
    await (await dlPromise).saveAs(part);
    if (spawnSync(tar, ["-tf", part], { stdio: "ignore" }).status !== 0) throw new Error("corrupt zip");
    const bytes = statSync(part).size;
    renameSync(part, out);
    writeFileSync(`${out}.done.json`, JSON.stringify({ fileSq: f.fileSq, baseDate: f.baseDate, bytes, region: f.region, title: f.title, downloadedAt: new Date().toISOString() }, null, 2));
    return bytes;
  } finally {
    rmSync(part, { force: true });
    await page.close().catch(() => {});
  }
}

let failed = 0;
for (const f of files) {
  const out = join(outDir, FOLDERS[ds], f.baseDate, `${f.region}.zip`);
  let done = false;
  try {
    const d = JSON.parse(readFileSync(`${out}.done.json`, "utf8"));
    done = existsSync(out) && d.fileSq === f.fileSq && d.baseDate === f.baseDate;
  } catch {}
  if (done) {
    console.log(`skip ${f.region}`);
    continue;
  }
  let ok = false;
  for (let i = 1; i <= 3 && !ok; i++) {
    try {
      const bytes = await fetchOne(f, out);
      console.log(`got  ${f.region} ${(bytes / 1024 ** 2).toFixed(1)} MB`);
      ok = true;
    } catch (e) {
      console.error(`try ${i} ${f.region}: ${clean(e.message)}`);
      await sleep(10000);
    }
  }
  if (!ok) failed++;
  await sleep(2000);
}
await browser.close();
if (failed > 0) {
  console.error(`${failed} failure(s)`);
  process.exit(1);
}

// 보고서 PDF·PNG 실제 내보내기(전체 쪽). 사용(프로젝트 루트에서): node tools/qa/export-pdf-png.mjs <analysisId> <outDir> [pdf|png]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { BASE, qaContext } from "./auth.mjs";

const [id, out, kind = "pdf"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await qaContext(browser, { width: 1440, height: 900, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
await page.goto(`${BASE}/v2?analysis=${id}&mode=report`, { waitUntil: "domcontentloaded", timeout: 300000 });
await page.getByRole("button", { name: "내보내기", exact: true }).waitFor({ timeout: 240000 });
await page.waitForTimeout(6000);
const start = page.getByRole("button", { name: "추천 구성으로 시작", exact: true });
if (await start.count()) { await start.first().click(); await page.waitForTimeout(3000); }
await page.getByRole("button", { name: "내보내기", exact: true }).and(page.locator(":enabled")).waitFor({ timeout: 120000 });
await page.waitForTimeout(8000);
await page.getByRole("button", { name: "내보내기", exact: true }).click();
await page.getByRole("radio", { name: kind === "pdf" ? /인쇄/ : /메신저/ }).click();
await page.waitForTimeout(1500);
const t0 = Date.now();
const [dl] = await Promise.all([
  page.waitForEvent("download", { timeout: 600000 }),
  page.getByRole("button", { name: kind === "pdf" ? /PDF 내려받기/ : /이미지 내려받기/ }).click(),
]);
const file = `${out}/${dl.suggestedFilename()}`;
await dl.saveAs(file);
console.log(JSON.stringify({ file, exportMs: Date.now() - t0, errors: errors.slice(0, 8) }));
await browser.close();

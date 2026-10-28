// 보고서 모드 미리보기 캡처 + PPT 실제 내보내기. 사용(프로젝트 루트에서): node tools/qa/export-pptx.mjs <analysisId> <outDir> [width] [drawing=editable|image]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { BASE as base, qaContext } from "./auth.mjs";
const [id, out, w = "1440", drawing = "editable"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await qaContext(browser, { width: +w, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`${base}/v2?analysis=${id}&mode=report`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "내보내기", exact: true }).waitFor({ timeout: 120000 });
await page.waitForTimeout(6000);
const start = page.getByRole("button", { name: "추천 구성으로 시작", exact: true });
if (await start.count()) { await start.first().click(); await page.waitForTimeout(3000); }
await page.getByRole("button", { name: "내보내기", exact: true }).and(page.locator(":enabled")).waitFor({ timeout: 60000 });
await page.waitForTimeout(10000);
await page.screenshot({ path: `${out}/report-${w}.png` });
await page.getByRole("button", { name: "내보내기", exact: true }).click();
await page.getByRole("radio", { name: /발표/ }).click();
await page.getByRole("radio", { name: drawing === "image" ? "이미지 한 장" : "편집 가능한 도형" }).click();
await page.waitForTimeout(1500);
const t0 = Date.now();
const [dl] = await Promise.all([
  page.waitForEvent("download", { timeout: 300000 }),
  page.getByRole("button", { name: /PPT 내려받기/ }).click(),
]);
const file = `${out}/export-${drawing}.pptx`;
await dl.saveAs(file);
console.log(JSON.stringify({ file, exportMs: Date.now() - t0, errors: errors.slice(0, 8) }));
await browser.close();

// 보드에서 다이어그램 색을 연달아 바꿀 때 걸리는 시간. 사용(프로젝트 루트에서): node tools/qa/perf-map-colors.mjs <analysisId> [횟수]
// paint = 클릭 → 다음 그리기(누른 반응이 보이기까지), settle = 클릭 → 브라우저가 한가해질 때(지도 색이 다 바뀌기까지).
import { chromium } from "playwright";
import { BASE, qaContext } from "./auth.mjs";

const [id, n = "15"] = process.argv.slice(2);
if (!id) {
  console.log("사용: node tools/qa/perf-map-colors.mjs <analysisId> [횟수]");
  process.exit(1);
}
const browser = await chromium.launch();
const ctx = await qaContext(browser);
const page = await ctx.newPage();
await page.goto(`${BASE}/v2?analysis=${id}`, { waitUntil: "domcontentloaded" });
const trigger = page.locator('[role="group"][aria-label="배경지도"] button:has-text("기본 지도 ▾")').first();
await trigger.waitFor({ timeout: 240000 });
await page.getByRole("button", { name: "지도", exact: true }).first().click();
await page.waitForSelector("svg [data-map-base]", { state: "attached", timeout: 60000 });
await page.waitForTimeout(3000);
await trigger.click();
await page.waitForSelector("[data-map-color-popover]");
await page.locator('[data-map-color-popover] [data-tab="palette"]').click();
await page.getByRole("button", { name: /색 만들기/ }).first().click();
await page.waitForTimeout(800);
const paint = [];
const settle = [];
for (let i = 0; i < +n; i++) {
  const t = await page.evaluate(() => new Promise((resolve) => {
    const btn = [...document.querySelectorAll("button")].find((b) => /밝게$/.test(b.getAttribute("aria-label") || ""));
    const t0 = performance.now();
    let painted = 0;
    btn.click();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      painted = Math.round(performance.now() - t0);
    }));
    const idle = () => requestIdleCallback(() => (painted ? resolve([painted, Math.round(performance.now() - t0)]) : idle()), { timeout: 10000 });
    idle();
  }));
  paint.push(t[0]);
  settle.push(t[1]);
  await page.waitForTimeout(50);
}
const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s.at(-1) };
};
console.log(JSON.stringify({ n: paint.length, paint: stat(paint), settle: stat(settle), paintTimes: paint }));
await browser.close();

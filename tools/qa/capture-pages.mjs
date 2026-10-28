// 「지도 + 그래프」 장 실화면 QA. 보고서 모드에서 지정한 쪽을 폭별로 캡처한다.
// --layout keep(기본)은 있는 그대로 캡처하고, charts는 「지도 + 그래프」가 제안되면 그 레이아웃으로 바꾼 뒤 캡처한다.
// 잰다: 본 장이 그래프 레이아웃인가(charts), 그래프 SVG와 지도 SVG 겹침 면적, 오른쪽 열 글자가 열 밖으로 나간 수, 그래프 안 글자끼리 겹침, 주석 칩 hover 팝오버, 페이지 오류.
// 사용(프로젝트 루트에서): node tools/qa/capture-pages.mjs <analysisId> <outDir> [--widths 1440,1280,1024] [--pages 10,19,20] [--layout keep|charts]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { BASE as base, qaContext } from "./auth.mjs";
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); if (i < 0) return dflt; const [v] = args.splice(i, 2).slice(1); return v ?? dflt; };
const widths = opt("widths", "1440,1280,1024");
const pages = opt("pages", "10,19,20");
const layout = opt("layout", "keep");
const [id, out] = args;
if (!id || !out || !["keep", "charts"].includes(layout)) {
  console.log("사용: node tools/qa/capture-pages.mjs <analysisId> <outDir> [--widths 1440,1280,1024] [--pages 10,19,20] [--layout keep|charts]");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await qaContext(browser);
const report = [];
for (const w of widths.split(",").map(Number)) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}/v2?analysis=${id}&mode=report`, { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.getByRole("button", { name: "내보내기", exact: true }).waitFor({ timeout: 240000 });
  await page.waitForTimeout(4000);
  const start = page.getByRole("button", { name: "추천 구성으로 시작", exact: true });
  if (await start.count()) { await start.first().click(); await page.waitForTimeout(8000); }
  // 쪽 목록 썸네일에도 [data-analysis-column]이 있으므로, 본 장은 가장 넓은 열(300px 초과)로만 판정한다.
  const mainCol = () => page.evaluate(() => {
    const col = [...document.querySelectorAll("[data-analysis-column]")].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    return !!col && col.getBoundingClientRect().width > 300;
  });
  for (const n of pages.split(",")) {
    const pageErrors = [];
    await page.locator(`[aria-label^="${n}쪽 "]:not([aria-label$="내보내기 포함"]):not([aria-label$="메뉴"])`).first().click().catch((e) => pageErrors.push(`쪽 ${n}: ${e.message.split("\n")[0]}`));
    await page.waitForTimeout(3000);
    let switched = "kept";
    if (layout === "charts") {
      switched = "already";
      if (!(await mainCol())) {
        await page.getByRole("button", { name: "페이지 레이아웃 메뉴" }).click().catch((e) => pageErrors.push("레이아웃 메뉴: " + e.message.split("\n")[0]));
        const o = page.locator("#report-layout-menu button", { hasText: "지도 + 그래프" });
        if (await o.count()) { await o.first().click(); switched = "switched"; } else switched = "no-option";
        await page.keyboard.press("Escape");
        await page.waitForTimeout(4000);
      }
    }
    const charts = await mainCol();
    await page.screenshot({ path: `${out}/p${n}-${w}.png` });
    const stats = await page.evaluate(() => {
      const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const col = [...document.querySelectorAll("[data-analysis-column]")].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      if (!col || col.getBoundingClientRect().width <= 300) return {};
      const charts = [...col.querySelectorAll("svg[data-chart]")];
      const maps = [...document.querySelectorAll("svg")].filter((s) => (s.querySelector("[data-map-base]") || s.querySelector("image")) && s.getBoundingClientRect().width > 300);
      let mapOverlap = 0;
      for (const c of charts) for (const m of maps) if (!m.closest("[data-analysis-column]")) mapOverlap += area(c.getBoundingClientRect(), m.getBoundingClientRect());
      const colR = col.getBoundingClientRect();
      const colKids = [...col.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.textContent.trim() && getComputedStyle(el).visibility !== "hidden");
      const outside = colKids.map((el) => ({ t: el.textContent.trim().slice(0, 24), r: el.getBoundingClientRect() })).filter((o) => o.r.width > 0 && (o.r.right > colR.right + 2 || o.r.bottom > colR.bottom + 2 || o.r.left < colR.left - 2)).map((o) => o.t);
      const clipped = colKids.filter((el) => el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).webkitLineClamp === "none").map((el) => el.textContent.trim().slice(0, 24));
      const chartTextOverlap = [];
      for (const c of charts) {
        const ts = [...c.querySelectorAll("text")].map((t) => ({ t: t.textContent, r: t.getBoundingClientRect() }));
        for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) { const a = area(ts[i].r, ts[j].r); if (a > 2) chartTextOverlap.push(`${ts[i].t}|${ts[j].t}|${Math.round(a)}`); }
      }
      const fonts = [...col.querySelectorAll("text, div")].filter((el) => el.textContent.trim() && el.children.length === 0).map((el) => parseFloat(getComputedStyle(el).fontSize));
      return { charts: charts.map((c) => c.dataset.chart), mapOverlap: Math.round(mapOverlap), outside, clipped, chartTextOverlap: chartTextOverlap.slice(0, 6), chartTextOverlapCount: chartTextOverlap.length, minFontPx: Math.min(...fonts), chip: !!col.querySelector("button[aria-expanded]"), text: col.innerText.replace(/\s+/g, " ").slice(0, 200) };
    });
    let chipPopover = null;
    const chip = page.locator("[data-analysis-column] button[aria-expanded]").first();
    if (charts && (await chip.count())) {
      await chip.hover();
      await page.waitForTimeout(400);
      chipPopover = await page.locator("[data-analysis-column] [role=tooltip]").first().isVisible().catch(() => false);
      await page.screenshot({ path: `${out}/p${n}-${w}-chip.png` });
      await page.mouse.move(5, 5);
    }
    report.push({ w, page: n, layout, switched, verdict: charts ? "charts" : "not charts", ...stats, chipPopover, errors: [...pageErrors, ...errors.splice(0)].slice(0, 5) });
    console.log(JSON.stringify(report.at(-1)));
  }
  await page.close();
}
writeFileSync(`${out}/analysis-page.json`, JSON.stringify(report, null, 2));
await browser.close();

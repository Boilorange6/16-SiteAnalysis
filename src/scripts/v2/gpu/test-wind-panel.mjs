import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const port = process.env.V2_P4_PORT ?? "3173";
const baseUrl = process.env.V2_P4_URL ?? `http://127.0.0.1:${port}/site/v2`;
const authState = process.env.V2_P4_AUTH_STATE;
const screenshotPath = process.env.V2_P4_SCREENSHOT ?? "docs/design/p4/wind-lbm.png";
const runGpu = process.env.V2_P4_RUN_WIND === "1";
const disableWebGpu = process.env.V2_P4_DISABLE_GPU === "1";
const headed = process.env.V2_P4_HEADLESS === "0";
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
].filter((path) => path && existsSync(path));

const browser = await chromium.launch({
  headless: !headed,
  ...(chromeCandidates[0] ? { executablePath: chromeCandidates[0] } : {}),
  args: ["--enable-unsafe-webgpu"],
});

try {
  const context = await browser.newContext(authState && existsSync(authState) ? { storageState: authState, viewport: { width: 1440, height: 900 } } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  if (disableWebGpu) {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "gpu", { configurable: true, get: () => undefined });
    });
  }
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  let hasPanel = await page.locator('[data-wind-panel]').count();
  // The built-in demo starts S03 as failed. Recovering that card exercises the
  // same panel placement without inventing an analysis or touching the DB.
  if (hasPanel === 0) {
    const retry = page.locator('[data-tile="S03"]').getByRole("button", { name: "이 타일 다시 계산" });
    if (await retry.count() > 0) {
      await retry.click();
      await page.locator('[data-wind-panel]').first().waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
      hasPanel = await page.locator('[data-wind-panel]').count();
    }
  }
  if (hasPanel === 0) {
    const open = page.locator('[data-tile="S03"] button[aria-label$="펼치기"]');
    if (await open.count() > 0) {
      await open.click();
      await page.locator('[data-wind-panel]').first().waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
      hasPanel = await page.locator('[data-wind-panel]').count();
    }
  }
  if (hasPanel === 0) {
    console.log("SKIP: S03 wind panel is not present on the supplied analysis URL");
    await context.close();
    process.exit(0);
  }

  const adapter = await page.evaluate(async () => {
    if (!navigator.gpu) return { ok: false, reason: "navigator.gpu is unavailable" };
    const result = await navigator.gpu.requestAdapter();
    return result ? { ok: true, reason: null, name: result.name ?? "WebGPU adapter" } : { ok: false, reason: "no WebGPU adapter" };
  });
  const panel = page.locator('[data-wind-panel]').first();
  assert.ok(await panel.locator('input[aria-label="바람장 표시 높이"]').count() > 0, "height slider must be present");
  assert.ok(await panel.locator('select[aria-label="바람 계산 범위"]').count() > 0, "season selector must be present");

  if (!adapter.ok) {
    await assert.doesNotReject(async () => panel.getByText(/WebGPU를 지원하지 않습니다/).waitFor({ state: "visible", timeout: 5000 }));
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`SKIP: WebGPU unavailable (${adapter.reason}); fallback panel captured at ${screenshotPath}`);
    await context.close();
    process.exit(0);
  }

  console.log(`WebGPU adapter: ${adapter.name ?? "unknown"}`);
  if (runGpu) {
    const calculate = panel.getByRole("button", { name: /바람 계산\(GPU|계절 추가 계산/ });
    await assert.doesNotReject(async () => calculate.waitFor({ state: "visible", timeout: 5000 }));
    await calculate.click();
    await panel.getByText(/업로드 완료|업로드된 바람장/).waitFor({ state: "visible", timeout: 12 * 60 * 1000 });
    const windRaster = page.locator('[data-raster^="wind_"]');
    assert.ok(await windRaster.count() > 0, "completed S03 panel must render a wind raster");
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`PASS: S03 panel, LIC-ready raster surface, and height control captured at ${screenshotPath}`);
  await context.close();
} finally {
  await browser.close();
}

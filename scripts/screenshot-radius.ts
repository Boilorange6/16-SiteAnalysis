import { chromium } from "playwright";
import { resolve } from "path";

const BASE_URL = "http://43.200.41.165/site";
const OUTPUT_DIR = resolve(process.cwd(), "output");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Login
  console.log("Logging in...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill("#username", "impjy613");
  await page.fill("#password", "1234");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(8000);

  // Screenshot with default 3km radius
  console.log("1. Default view (3km)...");
  await page.screenshot({ path: resolve(OUTPUT_DIR, "radius-01-3km.png") });

  // Change radius to 1km and click update
  console.log("2. Changing to 1km...");
  const btn1km = page.locator('[data-testid="radius-option-1"]');
  if (await btn1km.isVisible()) {
    await btn1km.click();
    await page.waitForTimeout(1000);
    // Click "설정 업데이트" button
    const updateBtn = page.locator('[data-testid="config-apply-button"]');
    if (await updateBtn.isVisible()) {
      await updateBtn.click();
      await page.waitForTimeout(5000);
    }
  }
  await page.screenshot({ path: resolve(OUTPUT_DIR, "radius-02-1km.png") });

  // Change radius to 2km
  console.log("3. Changing to 2km...");
  const btn2km = page.locator('[data-testid="radius-option-2"]');
  if (await btn2km.isVisible()) {
    await btn2km.click();
    await page.waitForTimeout(1000);
    const updateBtn = page.locator('[data-testid="config-apply-button"]');
    if (await updateBtn.isVisible()) {
      await updateBtn.click();
      await page.waitForTimeout(5000);
    }
  }
  await page.screenshot({ path: resolve(OUTPUT_DIR, "radius-03-2km.png") });

  await browser.close();
  console.log("Done!");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

import { chromium } from "playwright";
import { resolve } from "path";

const BASE_URL = "http://43.200.41.165/site";
const OUTPUT_DIR = resolve(process.cwd(), "output");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // Login
  console.log("1. Login...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill("#username", "impjy613");
  await page.fill("#password", "1234");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);

  // Initial state
  console.log("2. Initial state...");
  await page.screenshot({ path: resolve(OUTPUT_DIR, "dynamic-01-initial.png") });

  // Search "판교역" - type and wait for suggestions
  console.log("3. Searching 판교역...");
  const input = page.locator('[data-testid="center-name-input"]');
  await input.click();
  await input.fill("판교역");
  await page.waitForTimeout(2000);

  // Click first suggestion
  const option = page.locator('[data-testid="address-search-option-0"]');
  if (await option.isVisible({ timeout: 5000 })) {
    console.log("   Found suggestion, clicking...");
    await option.click({ force: true });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "dynamic-02-pangyo.png") });
  } else {
    console.log("   No suggestions found");
    await page.screenshot({ path: resolve(OUTPUT_DIR, "dynamic-02-no-suggest.png") });
  }

  // Search "강남역"
  console.log("4. Searching 강남역...");
  await input.click();
  await input.fill("강남역");
  await page.waitForTimeout(2000);

  const option2 = page.locator('[data-testid="address-search-option-0"]');
  if (await option2.isVisible({ timeout: 5000 })) {
    console.log("   Found suggestion, clicking...");
    await option2.click({ force: true });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: resolve(OUTPUT_DIR, "dynamic-03-gangnam.png") });
  }

  await browser.close();
  console.log("Done!");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

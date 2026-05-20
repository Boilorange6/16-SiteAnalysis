import { chromium } from "playwright";
import { resolve } from "path";

const BASE_URL = "http://43.200.41.165/site";
const OUTPUT_DIR = resolve(process.cwd(), "output");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  // 1. Login page
  console.log("1. Login page...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.screenshot({ path: resolve(OUTPUT_DIR, "final-01-login.png"), fullPage: false });

  // 2. Login and wait for map
  console.log("2. Logging in...");
  await page.fill("#username", "impjy613");
  await page.fill("#password", "1234");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "final-02-main-map.png"), fullPage: false });

  // 3. Mypage
  console.log("3. Mypage...");
  await page.goto(`${BASE_URL}/mypage`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "final-03-mypage.png"), fullPage: false });

  // 4. Back to main - try address search (강남역)
  console.log("4. Address search...");
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);

  // Click address search input and type
  const addressInput = page.locator('[data-testid="center-name-input"]');
  if (await addressInput.isVisible()) {
    await addressInput.fill("강남역");
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: resolve(OUTPUT_DIR, "final-04-search.png"), fullPage: false });

  await browser.close();
  console.log("\nDone!");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

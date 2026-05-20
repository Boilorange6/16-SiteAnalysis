import { chromium } from "playwright";
import { resolve } from "path";

const BASE_URL = "http://43.200.41.165/site";
const OUTPUT_DIR = resolve(process.cwd(), "output");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 1. Login page
  console.log("1. Navigating to login page...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.screenshot({ path: resolve(OUTPUT_DIR, "01-login-page.png") });
  console.log("   Screenshot: 01-login-page.png");

  // 2. Login
  console.log("2. Logging in as impjy613...");
  await page.fill("#username", "impjy613");
  await page.fill("#password", "1234");
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/**`, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "02-after-login.png") });
  console.log("   Screenshot: 02-after-login.png");

  // 3. Mypage - check API keys
  console.log("3. Navigating to mypage...");
  await page.goto(`${BASE_URL}/mypage`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "03-mypage.png") });
  console.log("   Screenshot: 03-mypage.png");

  // 4. Go back to main and check map
  console.log("4. Back to main app...");
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "04-main-app.png") });
  console.log("   Screenshot: 04-main-app.png");

  await browser.close();
  console.log("\nDone! Screenshots saved to output/");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

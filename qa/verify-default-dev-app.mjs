import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.DEFAULT_DEV_QA_URL ?? "http://127.0.0.1:3000/site/";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route("**/site/api/auth/me", (route) => route.fulfill({ json: { id: 1, username: "qa", role: "user" } }));
  await page.route("**/site/api/user/api-key-status", (route) => route.fulfill({ json: { ready: true, configuredCount: 0, totalCount: 0, items: [] } }));
  await page.route("**/site/api/projects", (route) => route.fulfill({ json: { projects: [] } }));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  const csp = response?.headers()["content-security-policy"] ?? "";
  assert.equal(/unpkg\.com|react-grab|fonts\.googleapis|fonts\.gstatic/.test(csp), false, "default dev CSP exposes inspection origins");
  assert.equal(await page.locator("#react-scan-root, #react-grab-root").count(), 0, "default dev mounted an inspection overlay");
  assert.equal(await page.locator('script[src*="react-scan"], script[src*="react-grab"]').count(), 0, "default dev loaded inspection scripts");
  await page.getByRole("button", { name: "보정" }).click();
  const addButton = page.getByRole("button", { name: "수동 POI 추가" });
  await addButton.focus();
  assert.equal(await addButton.evaluate((element) => element === document.activeElement), true);
  console.log("default next dev app interaction QA passed");
} finally {
  await browser.close();
}

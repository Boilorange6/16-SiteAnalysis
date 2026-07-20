import assert from "node:assert/strict";
import { chromium } from "playwright";

const url = process.env.REACT_DEV_TOOLS_QA_URL ?? "http://127.0.0.1:3000/site/";
const expectedScripts = [
  "https://unpkg.com/react-grab@0.1.48/dist/index.global.js",
  "https://unpkg.com/react-scan@0.5.7/dist/auto.global.js",
];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const cspErrors = [];
  const toolFailures = [];
  page.on("console", (message) => {
    if (/content security policy|refused to load/i.test(message.text())) cspErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    if (/react-grab|react-scan/.test(request.url())) toolFailures.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  await page.route("**/site/api/auth/me", (route) => route.fulfill({ json: { id: 1, username: "qa", role: "user" } }));
  await page.route("**/site/api/user/api-key-status", (route) => route.fulfill({ json: { ready: true, configuredCount: 0, totalCount: 0, items: [] } }));
  await page.route("**/site/api/projects", (route) => route.fulfill({ json: { projects: [] } }));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  assert.ok(response?.headers()["content-security-policy"]?.includes("https://unpkg.com"));
  const scripts = await page.locator("script[src]").evaluateAll((elements) => elements.map((element) => element.src));
  assert.deepEqual(expectedScripts.every((script) => scripts.includes(script)), true);
  assert.deepEqual(cspErrors, []);
  assert.deepEqual(toolFailures, []);
  console.log("opt-in next dev React tooling QA passed");
} finally {
  await browser.close();
}

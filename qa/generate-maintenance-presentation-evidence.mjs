import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { presentationFixture } from "./maintenance-presentation-fixture.mjs";

const port = Number(process.env.MAINTENANCE_PRESENTATION_PORT ?? 3218);
const externalUrl = process.env.MAINTENANCE_PRESENTATION_URL;
const baseUrl = externalUrl ?? `http://127.0.0.1:${port}/site/`;
const artifactDir = path.resolve("qa/artifacts/maintenance");
const pptxPath = path.join(artifactDir, "task8-maintenance-report.pptx");
const evidenceSlides = new Map([
  [5, "task8-canvas-natural-failure.png"],
  [7, "task8-canvas-radius-failure.png"],
  [8, "task8-canvas-park-failure.png"],
  [9, "task8-canvas-maintenance-map.png"],
  [10, "task8-canvas-maintenance-table.png"],
  [13, "task8-canvas-summary-failure.png"],
  [14, "task8-canvas-general-sources.png"],
  [15, "task8-canvas-maintenance-sources.png"],
]);

async function waitForServer(url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The spawned Next process has not bound the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Next server did not become ready: ${url}`);
}

function startServer() {
  if (externalUrl) return null;
  return spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: process.cwd(), stdio: "inherit", windowsHide: true },
  );
}

async function installRoutes(page) {
  const now = Date.UTC(2026, 6, 22, 3, 0, 0);
  await page.route("**/site/api/auth/me", (route) => route.fulfill({ json: { id: 1, username: "presentation-qa", role: "user" } }));
  await page.route("**/site/api/user/api-key-status", (route) => route.fulfill({ json: { ready: true, configuredCount: 4, totalCount: 4, items: [] } }));
  await page.route("**/site/api/projects", (route) => route.fulfill({ json: { projects: [] } }));
  await page.route("**/site/api/address-search**", (route) => route.fulfill({ json: { results: [] } }));
  await page.route("**/site/api/reverse-geocode**", (route) => route.fulfill({ json: { name: presentationFixture.centerName } }));
  await page.route("**/site/api/subway-routes**", (route) => route.fulfill({ json: { routes: [], source: { source: "subway-routes", status: "cached", fetchedAt: now } } }));
  await page.route("**/site/api/poi-search**", (route) => route.fulfill({ json: presentationFixture.response }));
}

async function saveDataUrl(dataUrl, outputPath) {
  const match = /^data:image\/png;base64,(.+)$/s.exec(dataUrl);
  assert.ok(match, `unexpected preview image URL for ${outputPath}`);
  await writeFile(outputPath, Buffer.from(match[1], "base64"));
}

async function waitForSlideCount(thumbnails, expected) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await thumbnails.count() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(await thumbnails.count(), expected, "preview slide count");
}

async function generate(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installRoutes(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "샘플 실행" }).click();
  await page.getByText("데이터 로딩 중").waitFor({ state: "hidden" });
  await page.getByLabel("분석 중심 주소").fill(presentationFixture.centerName);
  await page.getByTestId("center-latitude-input").fill(String(presentationFixture.center.lat));
  await page.getByTestId("center-longitude-input").fill(String(presentationFixture.center.lng));
  await page.getByTestId("config-apply-button").click();
  await page.getByText("데이터 로딩 중").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "PPT 미리보기" }).click();
  const dialog = page.getByRole("dialog", { name: "PPT 미리보기" });
  await dialog.waitFor();
  const thumbnails = dialog.locator('button[aria-label^="슬라이드 "] img');
  await waitForSlideCount(thumbnails, 16);
  for (const [index, fileName] of evidenceSlides) {
    const src = await thumbnails.nth(index).getAttribute("src");
    assert.ok(src);
    await saveDataUrl(src, path.join(artifactDir, fileName));
  }
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await dialog.getByRole("button", { name: "PPT 다운로드" }).click();
  const download = await downloadPromise;
  await download.saveAs(pptxPath);
  assert.deepEqual(pageErrors, []);
  await context.close();
}

await mkdir(artifactDir, { recursive: true });
const server = startServer();
try {
  await waitForServer(baseUrl);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await generate(browser);
  } finally {
    await browser.close();
  }
} finally {
  server?.kill();
}
console.log(`maintenance presentation evidence generated: ${pptxPath}`);

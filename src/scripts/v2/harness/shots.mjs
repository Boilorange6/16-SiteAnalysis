import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../../lib/v2/ui/fixtures/godeok.ts");
const { TILE_CODES, TILE_CATALOG } = await import("../../../lib/v2/ui/tile-catalog.ts");
const require = createRequire(import.meta.url);
const NEXT_BIN = require.resolve("next/dist/bin/next");

const PORT = 3175;
const BASE_URL = "http://127.0.0.1:" + PORT + "/site/v2";
const FIXED_NOW = Date.parse("2026-10-08T12:00:00+09:00");
const MANUAL_REVIEW = {
  "cut-s01-mass.png": "S01 WebGL canvas is intentionally excluded from byte comparison.",
  "cut-s01-exploded.png": "S01 WebGL canvas is intentionally excluded from byte comparison.",
};
const BROWSER_EXECUTABLE = process.env.V2_SHOTS_BROWSER ?? [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((path) => existsSync(path));

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function usage() {
  console.error("usage: npx tsx src/scripts/v2/harness/shots.mjs --out <folder> [--compare <folder>]");
}

function raster(name, palette) {
  return {
    name,
    kind: palette === "wind_ratio" ? "vector2" : "scalar",
    crs: "EPSG:5179",
    x0: 0,
    y0: 0,
    cellM: 2,
    cols: 2,
    rows: 2,
    dtype: "u8",
    bands: 1,
    scale: 1,
    offset: 0,
    nodata: 255,
    palette,
    label: name,
    bytes: 4,
    sha256: "a".repeat(64),
  };
}

function rose() {
  return {
    station: "near",
    dirs: Array.from({ length: 16 }, () => [1, 0, 0, 0, 0]),
    calmHours: 0,
    missingHours: 0,
    totalHours: 100,
  };
}

function resultForShot(code, source) {
  const base = structuredClone(source);
  return {
    ...base,
    tileId: "shot-" + code,
    analysisId: "shot-fixture",
    tileCode: code,
    tileType: TILE_CATALOG[code].kind,
    status: "partial",
    metrics: [],
    judgment: null,
    limitations: [{ kind: "estimated", note: "고정 시각 회귀 fixture" }],
    presentation: { legend: [], camera: null, layers: [], outputFace: "front" },
  };
}

function shotResults() {
  const originals = new Map(GODEOK_RESULTS.map((result) => [result.tileCode, structuredClone(result)]));
  const results = TILE_CODES.map((code) => resultForShot(code, originals.get(code) ?? GODEOK_RESULTS[0]));
  const byCode = new Map(results.map((result) => [result.tileCode, result]));
  for (const code of ["A05", "A06", "A01", "A03", "A04", "A07", "A09", "A12"]) {
    const existing = originals.get(code);
    if (existing) byCode.set(code, { ...structuredClone(existing), tileId: "shot-" + code, analysisId: "shot-fixture" });
  }
  const s01 = byCode.get("S01");
  s01.presentation = { ...s01.presentation, camera: { kind: "axonometric", azimuthDeg: 225, elevationDeg: 35, radiusM: 1000 } };
  const s02 = byCode.get("S02");
  s02.presentation = {
    ...s02.presentation,
    rasters: ["spring", "summer", "autumn", "winter"].flatMap((season) => [
      raster("sun_hours_" + season, "sun_hours"),
      raster("shade_" + season + "_flow", "shade_flow"),
    ]).concat(["summer", "winter"].flatMap((season) => ["09", "13", "15"].map((hour) => raster("shade_" + season + "_h" + hour, "shade_mask")))),
  };
  const s03 = byCode.get("S03");
  s03.presentation = {
    ...s03.presentation,
    rasters: ["annual", "spring", "summer", "autumn", "winter"].map((season) => raster("wind_" + season + "_z06", "wind_ratio")),
  };
  const s04 = byCode.get("S04");
  s04.presentation = {
    ...s04.presentation,
    rasters: ["spring", "summer", "autumn", "winter"].flatMap((season) => [10, 14, 18].map((hour) => raster("utci_" + season + "_h" + hour, "utci"))),
  };
  const d22 = byCode.get("D22");
  const windRose = rose();
  d22.presentation = { ...d22.presentation, rose: windRose, roses: { annual: windRose, spring: windRose, summer: windRose, autumn: windRose, winter: windRose } };
  return TILE_CODES.map((code) => byCode.get(code));
}

function responseBody() {
  const results = shotResults();
  return {
    analysisId: "shot-fixture",
    summary: GODEOK_SUMMARY,
    results,
    jobs: [],
    tiles: results.map((result) => ({ code: result.tileCode, status: "done", revision: "shot-fixture" })),
    revision: "shot-fixture",
  };
}

async function waitForServer() {
  const url = "http://127.0.0.1:" + PORT + "/site/v2";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      // Next is still compiling.
    }
    await delay(500);
  }
  throw new Error("dev server did not become ready on port " + PORT);
}

function startServer(repoRoot) {
  const child = spawn(process.execPath, [NEXT_BIN, "dev", "--port", String(PORT)], {
    cwd: repoRoot,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);
  return child;
}

async function stopServer(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise((resolveExit) => killer.once("exit", resolveExit));
  } else {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), delay(3000)]);
    if (!child.killed) child.kill("SIGKILL");
  }
}

async function openShotPage() {
  if (!BROWSER_EXECUTABLE) throw new Error("Playwright browser executable is unavailable; set V2_SHOTS_BROWSER or install is not permitted");
  const browser = await chromium.launch({ headless: true, executablePath: BROWSER_EXECUTABLE });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: "light",
  });
  await context.addInitScript(({ fixedNow }) => {
    const OriginalDate = Date;
    class FixedDate extends OriginalDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fixedNow] : args));
      }
      static now() { return fixedNow; }
    }
    Object.defineProperty(globalThis, "Date", { configurable: true, value: FixedDate });
    let seed = 0x12345678;
    Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  }, { fixedNow: FIXED_NOW });
  const page = await context.newPage();
  const body = responseBody();
  await page.route("**/site/api/v2/analyses/shot-fixture**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/scene")) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "fixture scene omitted" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/site/api/v2/analyses/shot-fixture/tiles/**/rasters/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/site/api/v2/tiles/**", (route) => route.abort());
  await page.goto(BASE_URL + "?analysis=shot-fixture", { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }" });
  await page.locator("[data-tile-id]").first().waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll("[data-tile-id]").length === 33);
  return { browser, page };
}

async function screenshot(page, path, fullPage = false) {
  await page.screenshot({ path, fullPage, animations: "disabled" });
}

async function openDialog(page, code) {
  const result = page.locator("[data-tile-id=\"shot-" + code + "\"]");
  await result.locator("button[aria-label$=\" 펼치기\"]").click();
  await page.locator("[role=\"dialog\"][aria-modal=\"true\"]").waitFor({ state: "visible" });
}

async function closeDialog(page) {
  await page.locator("[role=\"dialog\"] button[aria-label=\"닫기\"]").click();
  await page.locator("[role=\"dialog\"]").waitFor({ state: "hidden" });
}

async function selectCutByText(page, code, text) {
  const title = TILE_CATALOG[code].title;
  const select = page.locator("[role=\"dialog\"] select[aria-label=\"" + title + " 컷 선택\"]");
  const value = await select.locator("option").evaluateAll((options, prefix) => {
    const found = options.find((item) => !item.disabled && item.textContent?.startsWith(prefix));
    return found?.value ?? null;
  }, text);
  assert.ok(value, "cut option not found: " + code + " / " + text);
  await select.selectOption(value);
}

async function captureOnce(repoRoot, dir) {
  mkdirSync(dir, { recursive: true });
  const server = startServer(repoRoot);
  let shot = null;
  try {
    await waitForServer();
    shot = await openShotPage();
    await screenshot(shot.page, join(dir, "board.png"));
    await screenshot(shot.page, join(dir, "all-tiles.png"), true);

    const modes = [
      ["S01", "기본 매스", "cut-s01-mass.png"],
      ["S01", "분해 매스", "cut-s01-exploded.png"],
      ["S02", "단일 · 동지", "cut-s02-single.png"],
      ["S02", "계절 4컷", "cut-s02-seasons4.png"],
      ["S02", "정시 3컷 · 동지", "cut-s02-hours3.png"],
      ["S02", "그림자 흐름 · 동지", "cut-s02-flow.png"],
      ["S03", "단일 · 연간", "cut-s03-single.png"],
      ["S03", "계절 4컷", "cut-s03-seasons4.png"],
      ["S04", "단일 · 여름 14시", "cut-s04-single.png"],
      ["S04", "정시 3컷 · 여름", "cut-s04-hours3.png"],
      ["S04", "계절 4컷", "cut-s04-seasons4.png"],
      ["D22", "연간", "cut-d22-annual.png"],
      ["D22", "계절 4컷", "cut-d22-seasons4.png"],
    ];
    for (const [code, label, file] of modes) {
      await openDialog(shot.page, code);
      await selectCutByText(shot.page, code, label);
      await screenshot(shot.page, join(dir, file));
      await closeDialog(shot.page);
    }

    await openDialog(shot.page, "A05");
    await shot.page.getByRole("button", { name: "아파트", exact: true }).click();
    await screenshot(shot.page, join(dir, "a05-filter.png"));
    await closeDialog(shot.page);
    writeFileSync(join(dir, "manual-review.json"), JSON.stringify(MANUAL_REVIEW, null, 2) + "\n", "utf8");
  } finally {
    await shot?.browser.close();
    await stopServer(server);
  }
}

function pngFiles(dir) {
  return readdirSync(dir).filter((name) => name.endsWith(".png")).sort();
}

function compareDirs(before, after) {
  const manual = new Set(Object.keys(MANUAL_REVIEW));
  const names = [...new Set([...pngFiles(before), ...pngFiles(after)])].sort();
  const differences = [];
  for (const name of names) {
    if (manual.has(name)) continue;
    const leftPath = join(before, name);
    const rightPath = join(after, name);
    let same = false;
    try {
      same = readFileSync(leftPath).equals(readFileSync(rightPath));
    } catch {
      same = false;
    }
    if (!same) differences.push(name);
  }
  return differences;
}

const outPath = option("--out");
const comparePath = option("--compare");
if (!outPath) {
  usage();
  process.exit(2);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const firstDir = mkdtempSync(join(tmpdir(), "v2-refactor-shots-a-"));
const secondDir = mkdtempSync(join(tmpdir(), "v2-refactor-shots-b-"));
try {
  await captureOnce(repoRoot, firstDir);
  await captureOnce(repoRoot, secondDir);
  const deterministicDifferences = compareDirs(firstDir, secondDir);
  if (deterministicDifferences.length > 0) {
    throw new Error("shots determinism: FAIL (" + deterministicDifferences.join(", ") + ")");
  }
  console.log("shots determinism: PASS (" + (pngFiles(firstDir).length - Object.keys(MANUAL_REVIEW).length) + " compared PNGs; " + Object.keys(MANUAL_REVIEW).length + " manual)");
  mkdirSync(outPath, { recursive: true });
  for (const name of [...pngFiles(firstDir), "manual-review.json"]) copyFileSync(join(firstDir, name), join(outPath, name));
  if (comparePath) {
    const differences = compareDirs(comparePath, outPath);
    if (differences.length > 0) throw new Error("shots compare: FAIL (" + differences.join(", ") + ")");
    console.log("shots compare: PASS (0 differences vs " + comparePath + ")");
  }
} finally {
  rmSync(firstDir, { recursive: true, force: true });
  rmSync(secondDir, { recursive: true, force: true });
}

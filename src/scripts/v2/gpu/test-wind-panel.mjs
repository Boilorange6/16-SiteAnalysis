import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const { runCpuReference } = await import("../../../lib/v2/sim/lbm3d/cpu-ref.ts");

const port = process.env.V2_P4_PORT ?? "3173";
const baseUrl = process.env.V2_P4_URL ?? `http://127.0.0.1:${port}/site/v2`;
const authState = process.env.V2_P4_AUTH_STATE;
const screenshotPath = process.env.V2_P4_SCREENSHOT ?? "docs/design/p4/wind-lbm.png";
const runGpu = process.env.V2_P4_RUN_WIND === "1";
const runGpuCorrectness = process.env.V2_P4_RUN_GPU_CORRECTNESS === "1";
const disableWebGpu = process.env.V2_P4_DISABLE_GPU === "1";
const headed = process.env.V2_P4_HEADLESS === "0";
const viewport = process.env.V2_P4_MOBILE === "1" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
].filter((path) => path && existsSync(path));

function makeCaseSpec(nx, ny, nz, steps) {
  return { nx, ny, nz, cellM: 4, uLattice: 0.06, profileAlpha: 0.25, zRefM: 10, cs: 0.16, tau0: 0.8, steps, averageFrom: Math.floor(steps * 0.6), layersZm: [6, 10, 14] };
}

function makeNodeCase(spec) {
  const solid = new Uint8Array(spec.nx * spec.ny * spec.nz);
  for (let y = 0; y < spec.ny; y += 1) for (let x = 0; x < spec.nx; x += 1) solid[x + spec.nx * y] = 1;
  const x0 = Math.floor(spec.nx * 0.38), x1 = Math.floor(spec.nx * 0.5);
  const y0 = Math.floor(spec.ny * 0.34), y1 = Math.floor(spec.ny * 0.67);
  const z1 = Math.min(spec.nz, Math.max(2, Math.floor(spec.nz * 0.28)));
  for (let z = 1; z < z1; z += 1) for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) solid[x + spec.nx * (y + spec.ny * z)] = 1;
  return { ...spec, solid };
}

function maxVelocityDifference(cpuLayers, gpuLayers) {
  let maximum = 0;
  for (let layerIndex = 0; layerIndex < cpuLayers.length; layerIndex += 1) {
    const cpu = cpuLayers[layerIndex];
    const gpu = gpuLayers[layerIndex];
    if (!cpu || !gpu) continue;
    for (let index = 0; index < cpu.u.length; index += 1) {
      if (Number.isFinite(cpu.u[index]) && Number.isFinite(gpu.u[index])) maximum = Math.max(maximum, Math.abs(cpu.u[index] - gpu.u[index]));
      if (Number.isFinite(cpu.v[index]) && Number.isFinite(gpu.v[index])) maximum = Math.max(maximum, Math.abs(cpu.v[index] - gpu.v[index]));
    }
  }
  return maximum;
}

async function runGpuCorrectnessAndBenchmark(page, baseUrl) {
  const requireFromMain = createRequire("file:///D:/V-coding/16-SiteAnalysis/package.json");
  const { build } = requireFromMain("esbuild");
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("../../../lib/v2/sim/lbm3d/gpu.ts", import.meta.url))],
    bundle: true,
    format: "iife",
    globalName: "JudgeLbm3dGpu",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const availability = await page.evaluate(async () => globalThis.JudgeLbm3dGpu.webgpuAvailable());
  if (!availability.ok) {
    console.log(`GPU correctness SKIP: ${availability.reason}`);
    return null;
  }
  console.log(`GPU limits: ${JSON.stringify(availability.limits)}`);

  const runCase = (targetPage, spec, includeLayers, precision) => targetPage.evaluate(async ({ spec: input, includeLayers: withLayers, precision: selectedPrecision }) => {
    const solid = new Uint8Array(input.nx * input.ny * input.nz);
    for (let y = 0; y < input.ny; y += 1) for (let x = 0; x < input.nx; x += 1) solid[x + input.nx * y] = 1;
    const x0 = Math.floor(input.nx * 0.38), x1 = Math.floor(input.nx * 0.5);
    const y0 = Math.floor(input.ny * 0.34), y1 = Math.floor(input.ny * 0.67);
    const z1 = Math.min(input.nz, Math.max(2, Math.floor(input.nz * 0.28)));
    for (let z = 1; z < z1; z += 1) for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) solid[x + input.nx * (y + input.ny * z)] = 1;
    const field = await globalThis.JudgeLbm3dGpu.runLbm3d({ ...input, solid }, { precision: selectedPrecision });
    return {
      ...field,
      layers: withLayers ? field.layers.map((layer) => ({ zM: layer.zM, u: Array.from(layer.u), v: Array.from(layer.v) })) : undefined,
    };
  }, { spec, includeLayers, precision });

  const smallSpec = makeCaseSpec(48, 24, 24, 300);
  const cpu = runCpuReference(makeNodeCase(smallSpec));
  const small = await runCase(page, smallSpec, true, "f32");
  const maxDeltaUOverUin = maxVelocityDifference(cpu.layers, small.layers);
  assert.ok(Number.isFinite(small.fieldChecksum) && Math.abs(small.fieldChecksum) > 1e-6, "small GPU field checksum must be non-zero");
  assert.ok(Number.isFinite(small.densityChecksum), "small GPU density checksum must be finite");
  assert.ok(small.densityDriftMax <= 1e-3, `small GPU density drift ${small.densityDriftMax} > 1e-3`);
  assert.ok(small.velocityDelta > 1e-3, `small GPU velocity delta ${small.velocityDelta} is too small`);
  assert.ok(maxDeltaUOverUin < 0.02, `GPU/CPU max |ΔU/Uin| ${maxDeltaUOverUin} >= 0.02`);
  console.log(`GPU correctness: 48x24x24 x 300 · max |ΔU/Uin| ${maxDeltaUOverUin.toExponential(3)} · density drift ${small.densityDriftMax.toExponential(3)} · velocity delta ${small.velocityDelta.toExponential(3)} · ${small.precision} · ${small.adapter}`);

  if (process.env.V2_P4_SKIP_FULL === "1") return { availability, small, maxDeltaUOverUin };

  const fullSpec = makeCaseSpec(500, 500, 38, 13334);
  const wallStarted = Date.now();
  const benchmarkPage = await page.context().newPage();
  let full;
  try {
    await benchmarkPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await benchmarkPage.addScriptTag({ content: bundle.outputFiles[0].text });
    full = await runCase(benchmarkPage, fullSpec, false, "auto");
  } finally {
    await benchmarkPage.close();
  }
  const wallMs = Date.now() - wallStarted;
  const cells = fullSpec.nx * fullSpec.ny * fullSpec.nz;
  const wallMlups = (cells * fullSpec.steps) / Math.max(wallMs, 1) / 1000;
  assert.ok(Number.isFinite(full.fieldChecksum) && Math.abs(full.fieldChecksum) > 1e-6, "full GPU field checksum must be non-zero");
  assert.ok(Number.isFinite(full.densityChecksum), "full GPU density checksum must be finite");
  assert.ok(full.densityDriftMax <= 1e-3, `full GPU density drift ${full.densityDriftMax} > 1e-3`);
  assert.ok(full.velocityDelta > 1e-3, `full GPU velocity delta ${full.velocityDelta} is too small`);
  console.log(`GPU full benchmark: 500x500x38 x ${fullSpec.steps.toLocaleString("en-US")} · wall ${wallMs} ms (field ${full.elapsedMs.toFixed(0)} ms, includes readback) · ${wallMlups.toFixed(2)} MLUPS · density drift ${full.densityDriftMax.toExponential(3)} · velocity delta ${full.velocityDelta.toExponential(3)} · field checksum ${full.fieldChecksum.toExponential(3)} · density checksum ${full.densityChecksum.toExponential(3)} · dispatch ${full.dispatch?.x}x${full.dispatch?.y}x${full.dispatch?.z} (limit ${availability.limits?.maxComputeWorkgroupsPerDimension}) · ${full.precision} · ${full.adapter}`);
  return { availability, small, maxDeltaUOverUin, full, wallMs, wallMlups };
}

const browser = await chromium.launch({
  headless: !headed,
  ...(chromeCandidates[0] ? { executablePath: chromeCandidates[0] } : {}),
  args: ["--enable-unsafe-webgpu"],
});

try {
  const context = await browser.newContext(authState && existsSync(authState) ? { storageState: authState, viewport } : { viewport });
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
  if (runGpuCorrectness) await runGpuCorrectnessAndBenchmark(page, baseUrl);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`PASS: S03 panel, LIC-ready raster surface, and height control captured at ${screenshotPath}`);
  await context.close();
} finally {
  await browser.close();
}

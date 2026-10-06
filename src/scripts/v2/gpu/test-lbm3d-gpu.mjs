/**
 * Real-GPU regression for the D3Q19 WebGPU kernel (not part of `npm run test:v2`; needs Chrome + WebGPU).
 * - small-case parity against the CPU reference (f32 and f16)
 * - cancellation raises AbortError
 * - convergence early stop agrees with the full-length run and mass bookkeeping stays tight
 * Skips (exit 0) when no WebGPU adapter is available.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireFromMain = createRequire("file:///D:/V-coding/16-SiteAnalysis/package.json");
const { chromium } = requireFromMain("playwright");
const { build } = requireFromMain("esbuild");
const { runCpuReference } = await import("../../../lib/v2/sim/lbm3d/cpu-ref.ts");

function makeCase({ nx, ny, nz, steps }) {
  const solid = new Uint8Array(nx * ny * nz);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) solid[x + nx * y] = 1;
  for (let z = 1; z < Math.min(nz, 5); z++) {
    for (let y = Math.floor(ny / 2) - 2; y < Math.floor(ny / 2) + 2; y++) {
      for (let x = Math.floor(nx / 2) - 2; x < Math.floor(nx / 2) + 1; x++) solid[x + nx * (y + ny * z)] = 1;
    }
  }
  return { nx, ny, nz, cellM: 4, solid, uLattice: 0.06, profileAlpha: 0.25, zRefM: 10, cs: 0.16, tau0: 0.8, steps, averageFrom: Math.floor(steps * 0.6), layersZm: [6, 10, 14] };
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
].filter((path) => path && existsSync(path));

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../../../lib/v2/sim/lbm3d/gpu.ts", import.meta.url))],
  bundle: true,
  format: "iife",
  globalName: "Lbm3dGpu",
  platform: "browser",
  target: "es2022",
  write: false,
});
const browser = await chromium.launch({
  headless: true,
  ...(chromeCandidates[0] ? { executablePath: chromeCandidates[0] } : {}),
  args: ["--enable-unsafe-webgpu"],
});
try {
  const page = await browser.newPage();
  // WebGPU needs a secure origin; a file:// page qualifies, about:blank may not.
  await page.goto(new URL("./blank.html", import.meta.url).href);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const available = await page.evaluate(() => globalThis.Lbm3dGpu.webgpuAvailable());
  if (!available.ok) {
    console.log(`SKIP: WebGPU unavailable (${available.reason})`);
  } else {
    const run = (spec, options) => page.evaluate(async ({ spec: s, options: o }) => {
      const field = await globalThis.Lbm3dGpu.runLbm3d({ ...s, solid: Uint8Array.from(s.solid) }, o);
      return { ...field, layers: field.layers.map((l) => ({ zM: l.zM, u: Array.from(l.u), v: Array.from(l.v) })) };
    }, { spec: { ...spec, solid: Array.from(spec.solid) }, options });
    const maxDiff = (a, b) => {
      let m = 0;
      for (let l = 0; l < a.layers.length; l++) {
        for (let i = 0; i < a.layers[l].u.length; i++) {
          const x = a.layers[l].u[i], y = b.layers[l].u[i];
          if (Number.isFinite(x) && Number.isFinite(y)) m = Math.max(m, Math.abs(x - y));
        }
      }
      return m;
    };

    // 1) parity with the CPU reference
    const small = makeCase({ nx: 24, ny: 12, nz: 12, steps: 300 });
    const cpu = runCpuReference(small);
    const f32 = await run(small, { precision: "f32" });
    const f16 = await run(small, { precision: "f16" });
    const d32 = maxDiff({ layers: cpu.layers.map((l) => ({ u: Array.from(l.u) })) }, f32);
    const d16 = maxDiff({ layers: cpu.layers.map((l) => ({ u: Array.from(l.u) })) }, f16);
    assert.ok(d32 < 2e-3, `GPU f32 / CPU max |dU/Uin| ${d32} >= 2e-3`);
    assert.ok(d16 < 1e-2, `GPU f16 / CPU max |dU/Uin| ${d16} >= 1e-2`);
    assert.ok(f32.densityDriftMax <= 5e-3 && f32.massFactorMax <= 5e-3, "mass bookkeeping drifted");
    console.log(`GPU parity: f32 ${d32.toExponential(2)}, f16 ${d16.toExponential(2)}, mass raw drift ${f32.massRawDriftMax.toExponential(2)} · ${f32.adapter}`);

    // 2) cancellation
    const aborted = await page.evaluate(async (spec) => {
      const controller = new AbortController();
      try {
        await globalThis.Lbm3dGpu.runLbm3d({ ...spec, solid: Uint8Array.from(spec.solid), steps: 4000, averageFrom: 2400 }, {
          signal: controller.signal,
          onProgress: () => controller.abort(),
        });
      } catch (error) {
        return error?.name;
      }
      return null;
    }, { ...small, solid: Array.from(small.solid) });
    assert.equal(aborted, "AbortError", "GPU cancellation must use AbortError");

    // 3) early stop vs the full-length run
    const medium = makeCase({ nx: 64, ny: 64, nz: 24, steps: 9000 });
    const full = await run(medium, { precision: "f32" });
    const early = await run(medium, { precision: "f32", convergence: { epsilon: 1e-3 } });
    assert.ok(early.steps <= medium.steps, "early stop must not exceed the planned steps");
    assert.ok(early.convergence && early.convergence.blocks >= 4, "convergence report must list the averaged blocks");
    const dEarly = maxDiff(full, early);
    assert.ok(dEarly < 5e-3, `early-stop field differs by ${dEarly}`);
    assert.ok(early.massRawDriftMax <= 5e-3, `mass drift ${early.massRawDriftMax}`);
    console.log(`early stop: ${early.steps}/${medium.steps} steps, max |dU/Uin| vs full ${dEarly.toExponential(2)}, window from block ${early.convergence.windowStartBlock}`);
  }
} finally {
  await browser.close();
}

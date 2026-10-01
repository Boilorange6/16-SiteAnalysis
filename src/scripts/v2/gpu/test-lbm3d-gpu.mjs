import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

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
const browser = await chromium.launch({
  headless: true,
  ...(chromeCandidates[0] ? { executablePath: chromeCandidates[0] } : {}),
  args: ["--enable-unsafe-webgpu"],
});
try {
  const page = await browser.newPage();
  // WebGPU needs a real file/secure origin; about:blank from setContent can
  // report navigator.gpu as unavailable even when Chrome supports it. The
  // standalone harness is the same browser-facing bundle the Judge opens.
  await page.goto("file:///D:/V-coding/16-SiteAnalysis/.worktrees/v2-p4-t14/src/scripts/v2/lbm3d-harness.html");
  await page.waitForFunction(() => globalThis.__lbm3dResult !== undefined, null, { timeout: 120000 });
  const gpuResult = await page.evaluate(async (rawCase) => {
    const c = { ...rawCase, solid: Uint8Array.from(rawCase.solid) };
    const available = await globalThis.Lbm3dGpu.webgpuAvailable();
    if (!available.ok) return { skip: available.reason };
    const field = await globalThis.Lbm3dGpu.runLbm3d(c);
    const f32Field = await globalThis.Lbm3dGpu.runLbm3d(c, { precision: "f32" });
    const controller = new AbortController();
    let cancelled = null;
    try {
      await globalThis.Lbm3dGpu.runLbm3d({ ...c, steps: 300, averageFrom: 180 }, {
        signal: controller.signal,
        onProgress: (progress) => { if (progress.step >= 256) controller.abort(); },
      });
    } catch (error) {
      cancelled = { name: error?.name, message: error?.message };
    }
    return {
      available,
      field: { ...field, layers: field.layers.map((layer) => ({ zM: layer.zM, u: Array.from(layer.u), v: Array.from(layer.v) })) },
      f32Field: { ...f32Field, layers: f32Field.layers.map((layer) => ({ zM: layer.zM, u: Array.from(layer.u), v: Array.from(layer.v) })) },
      cancelled,
    };
  }, { ...makeCase({ nx: 24, ny: 12, nz: 12, steps: 300 }), solid: Array.from(makeCase({ nx: 24, ny: 12, nz: 12, steps: 300 }).solid) });

  if (gpuResult.skip) {
    console.log(`SKIP: WebGPU unavailable (${gpuResult.skip})`);
  } else {
    const c = makeCase({ nx: 24, ny: 12, nz: 12, steps: 300 });
    const cpu = runCpuReference(c);
    const gpuLayer = gpuResult.field.layers[1].u;
    const cpuLayer = Array.from(cpu.layers[1].u);
    let maxDifference = 0;
    for (let i = 0; i < cpuLayer.length; i++) {
      if (Number.isFinite(cpuLayer[i]) && Number.isFinite(gpuLayer[i])) maxDifference = Math.max(maxDifference, Math.abs(cpuLayer[i] - gpuLayer[i]));
    }
    const tolerance = gpuResult.field.precision === "f16" ? 1e-2 : 2e-3;
    assert.ok(maxDifference < tolerance, `GPU/CPU max difference ${maxDifference} >= ${tolerance}`);
    let f32Difference = 0;
    const f32Layer = gpuResult.f32Field.layers[1].u;
    for (let i = 0; i < cpuLayer.length; i++) {
      if (Number.isFinite(cpuLayer[i]) && Number.isFinite(f32Layer[i])) f32Difference = Math.max(f32Difference, Math.abs(cpuLayer[i] - f32Layer[i]));
    }
    assert.ok(f32Difference < 2e-3, `GPU f32/CPU max difference ${f32Difference} >= 0.002`);
    assert.equal(gpuResult.cancelled?.name, "AbortError", "GPU cancellation must use AbortError");
    console.log(`GPU parity: f16 ${maxDifference.toExponential(3)} (< ${tolerance}), f32 ${f32Difference.toExponential(3)} (< 2e-3), adapter ${gpuResult.field.adapter}`);

    const timingCase = makeCase({ nx: 64, ny: 64, nz: 32, steps: 1000 });
    const timing = await page.evaluate(async (raw) => {
      const c = { ...raw, solid: Uint8Array.from(raw.solid) };
      const field = await globalThis.Lbm3dGpu.runLbm3d(c);
      return { elapsedMs: field.elapsedMs, mlups: field.mlups, precision: field.precision, adapter: field.adapter };
    }, { ...timingCase, solid: Array.from(timingCase.solid) });
    console.log(`GPU timing: 64x64x32 x 1,000 -> ${timing.elapsedMs.toFixed(0)} ms, ${timing.mlups.toFixed(2)} MLUPS, ${timing.precision}, ${timing.adapter}`);

    await page.screenshot({ path: "C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/afa71a56-ea0e-4d38-b7d3-3843d21b9e14/scratchpad/p4-t14/lbm3d-gpu-field.png" });
  }
} finally {
  await browser.close();
}

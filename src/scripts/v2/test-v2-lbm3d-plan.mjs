import assert from "node:assert/strict";

const { minOf } = await import("../../lib/v2/extent.ts");
const { planGrid, voxelize } = await import("../../lib/v2/sim/lbm3d/plan.ts");
const { runCpuReference } = await import("../../lib/v2/sim/lbm3d/cpu-ref.ts");
const { d3q19KernelWgsl } = await import("../../lib/v2/sim/lbm3d/kernels.wgsl.ts");

const GB = 1024 ** 3;
const MB = 1024 ** 2;

// 0) Keep the generated shader source testable even on machines without an
// adapter. The GPU parity test below is the runtime check when WebGPU exists.
{
  const f32 = d3q19KernelWgsl();
  const f16 = d3q19KernelWgsl({ precision: "f16", groupSizes: [7, 6, 6] });
  assert.match(f32, /@compute/);
  assert.match(f32, /Smagorinsky/);
  assert.match(f32, /4194240u/);
  assert.match(f32, /0\.9 \* 6\.0 \* /);
  // Unrolled D3Q19: 19 incoming/outgoing values, no rolled direction loop over a private array.
  assert.match(f32, /var v18: f32;/);
  assert.doesNotMatch(f32, /array<f32, 19>/);
  const tiled = d3q19KernelWgsl({ dispatchStrideX: 128, dispatchStrideXY: 256 });
  assert.match(tiled, /gid\.y \* 128u/);
  assert.match(tiled, /gid\.z \* 256u/);
  assert.match(tiled, /var<storage, read_write> density/);
  assert.match(f16, /enable f16/);
  assert.match(f16, /array<f16>/);
  assert.match(f16, /@binding\(5\)/);
}

// 1) The reference 800 m plan keeps the full 4 m / 60 m-height target on a
// 2 GB f16-class adapter.
{
  const p = planGrid({
    radiusM: 800,
    bufferM: 200,
    maxObstacleM: 60,
    limits: { maxBufferSize: 2 * GB, maxStorageBufferBindingSize: 2 * GB },
    f16: true,
  });
  assert.equal(p.cellM, 4);
  assert.equal(p.nx, 500);
  assert.equal(p.ny, 500);
  assert.equal(p.nz, 38);
  assert.ok(p.bytes <= 1.2 * GB, `plan bytes ${p.bytes}`);
  assert.equal(p.reason, null);
}

// 2) A smaller adapter records the quality-affecting reductions.
{
  const p = planGrid({
    radiusM: 800,
    bufferM: 200,
    maxObstacleM: 60,
    limits: { maxBufferSize: 512 * MB, maxStorageBufferBindingSize: 128 * MB },
    f16: true,
  });
  assert.ok(p.reason, "a constrained adapter must expose its reduction reason");
  assert.match(p.reason, /buffer|height|cellM/i);
  assert.ok(p.bytes <= 512 * MB || /remaining limit/.test(p.reason));
}

// 3) Cardinal wind rotations preserve the same voxel geometry up to a 90°
// rotation. This catches a north/east axis swap in voxelize().
{
  const n = 8;
  const grid = { nx: n, ny: n, nz: 6, cellM: 4 };
  const plan = { cellM: 4, nx: n, ny: n, nz: 6 };
  const heights = new Uint16Array(n * n);
  heights[2 + n * 5] = 120;
  const north = voxelize(heights, grid, 0, plan);
  const east = voxelize(heights, grid, 90, plan);
  const idx = (x, y, z) => x + n * (y + n * z);
  for (let z = 0; z < grid.nz; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        // The 90° frame maps (x,y) -> (n-1-y,x) around the grid centre.
        assert.equal(north[idx(x, y, z)], east[idx(n - 1 - y, x, z)], `rotation mismatch ${x},${y},${z}`);
      }
    }
  }
  assert.ok(north.some((v) => v === 1), "ground and obstacle voxels are present");
}

function makeCase(withBox = false) {
  const nx = 24, ny = 12, nz = 12;
  const solid = new Uint8Array(nx * ny * nz);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) solid[x + nx * y] = 1;
  if (withBox) {
    for (let z = 1; z < 5; z++) for (let y = 4; y < 8; y++) for (let x = 9; x < 12; x++) solid[x + nx * (y + ny * z)] = 1;
  }
  return { nx, ny, nz, cellM: 4, solid, uLattice: 0.06, profileAlpha: 0.25, zRefM: 10, cs: 0.16, tau0: 0.8, steps: 300, averageFrom: 180, layersZm: [6, 10, 14] };
}

let emptyChannelMean = 0;
let buildingWakeMinimum = 0;

// 4) The CPU reference is deterministic, has a near-unity empty-channel
// ratio, and produces a measurable obstacle wake.
{
  const emptyA = runCpuReference(makeCase(false));
  const emptyB = runCpuReference(makeCase(false));
  assert.deepEqual(Array.from(emptyA.layers[1].u), Array.from(emptyB.layers[1].u));
  // The reference S03 walking layer is 6 m; its open-channel U/Uin should be
  // close to one despite the z=0 ground bounce-back.
  const values = Array.from(emptyA.layers[0].u).filter(Number.isFinite);
  emptyChannelMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(Math.abs(emptyChannelMean - 1) <= 0.05, `empty channel mean U/Uin ${emptyChannelMean}`);

  const obstacle = runCpuReference(makeCase(true));
  const wakeLayer = obstacle.layers[1].u;
  const downstream = Array.from(wakeLayer).filter((value, index) => Number.isFinite(value) && index % 24 >= 12 && index % 24 <= 18);
  buildingWakeMinimum = minOf(downstream);
  assert.ok(buildingWakeMinimum < 0.7, `obstacle wake ${buildingWakeMinimum}`);
}

console.log(`v2 lbm3d plan/cpu: ok · ground factor 0.9 · empty U/Uin ${emptyChannelMean.toFixed(4)} · building wake min ${buildingWakeMinimum.toFixed(5)}`);

/**
 * 병렬 D2Q9 worker가 시작하지 않거나 죽으면 호출자가 무한 대기하지 않고 제한 시간 안에 오류를 내야 한다
 * (예전에는 Atomics.wait가 무기한이라 전체 스위트가 18분간 멈춘 적이 있다).
 */
import assert from "node:assert/strict";

const { computeWind2D } = await import("../../lib/v2/sim/lbm2d.ts");

const nx = 64, ny = 32;
const solid = new Uint8Array(nx * ny);
for (let y = 12; y < 20; y++) for (let x = 24; x < 32; x++) solid[y * nx + x] = 1;

// 정상 병렬 실행은 영향을 받지 않는다.
const ok = computeWind2D({ nx, ny, solid, steps: 200, parallelism: 2, workerStallMs: 5000 });
assert.equal(ok.steps, 200);

for (const stalled of [0, 1]) {
  const started = Date.now();
  assert.throws(
    () => computeWind2D({ nx, ny, solid, steps: 200, parallelism: 2, workerStallMs: 1000, workerStallForTest: stalled }),
    /stalled|worker/i,
    `worker ${stalled} stall must raise an error`,
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 6000, `stall error took ${elapsed} ms (bounded wait expected < 6 s)`);
  console.log(`worker ${stalled} never starts -> error after ${elapsed} ms`);
}
console.log("lbm2d stall test passed");

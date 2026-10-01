/**
 * D2Q9 2D 대체 바람 엔진 테스트.
 *
 * 이 테스트는 3D 풍동/CFD 검증이 아니라, WebGPU를 사용할 수 없는 경우에도
 * 건물 뒤 정체와 건물 옆 가속이라는 상대 패턴을 보존하는지를 확인한다.
 */
import assert from "node:assert/strict";

const { computeWind2D, rotateFromWindFrame, rotateToWindFrame } = await import("../../lib/v2/sim/lbm2d.ts");

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const finiteValues = (values) => Array.from(values).filter(Number.isFinite);
const index = (x, y, nx) => y * nx + x;

// 1) 빈 영역: 균일 유입은 정상상태에서 U/U유입=1, 횡류=0을 유지한다.
{
  const nx = 64, ny = 48;
  const progress = [];
  const result = computeWind2D({ nx, ny, solid: new Uint8Array(nx * ny), steps: 360 }, (step) => progress.push(step));
  const u = finiteValues(result.u);
  const v = finiteValues(result.v);
  assert.equal(result.steps, 360);
  assert.ok(Number.isFinite(result.residual) && result.residual >= 0, `residual=${result.residual}`);
  assert.ok(Math.abs(mean(u) - 1) <= 0.03, `빈 영역 평균 U/U유입=${mean(u)}`);
  assert.ok(Math.abs(mean(v)) <= 0.03, `빈 영역 평균 횡류=${mean(v)}`);
  assert.ok(progress.length > 0 && progress.at(-1) === 360, `progress=${progress}`);
  assert.ok(u.every((value) => Math.abs(value - 1) <= 0.03), "빈 영역의 공간 편차가 과도함");
  assert.ok(v.every((value) => Math.abs(value) <= 0.03), "빈 영역에 횡류가 남음");
}

// 2) 정사각 장애물: 후류 정체와 측면 가속이 모두 나타난다.
{
  const nx = 120, ny = 72;
  const solid = new Uint8Array(nx * ny);
  const x0 = 48, x1 = 59, y0 = 30, y1 = 41;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) solid[index(x, y, nx)] = 1;
  const result = computeWind2D({ nx, ny, solid, steps: 1_800, averageFrom: 1_080 });
  for (const y of [y0, y0 + 3, y1 - 3, y1]) for (let x = x0; x <= x1; x++) assert.ok(Number.isNaN(result.u[index(x, y, nx)]), "solid 셀 u는 NaN");

  const wake = [];
  for (let x = x1 + 1; x <= x1 + 2 * (x1 - x0 + 1); x++) for (let y = y0 + 2; y <= y1 - 2; y++) {
    if (!solid[index(x, y, nx)]) wake.push(result.u[index(x, y, nx)]);
  }
  const side = [];
  for (let x = x0 + 2; x <= x1 - 2; x++) for (const y of [y0 - 3, y1 + 3]) side.push(result.u[index(x, y, nx)]);
  assert.ok(mean(wake) < 0.6, `장애물 후류 평균=${mean(wake)}`);
  assert.ok(Math.max(...side) > 1.05, `장애물 측면 최대 가속=${Math.max(...side)}`);
}

// 3) 결정성: 같은 입력은 모든 출력과 잔차가 같다.
{
  const nx = 44, ny = 32;
  const solid = new Uint8Array(nx * ny);
  for (let y = 11; y < 21; y++) for (let x = 18; x < 24; x++) solid[index(x, y, nx)] = 1;
  const a = computeWind2D({ nx, ny, solid, steps: 480 });
  const b = computeWind2D({ nx, ny, solid, steps: 480 });
  assert.deepEqual(Array.from(a.u), Array.from(b.u));
  assert.deepEqual(Array.from(a.v), Array.from(b.v));
  assert.equal(a.residual, b.residual);
}

// 4) 북쪽 정렬 벡터장을 바람 정렬 격자로 보냈다가 되돌리면 왕복 오차가 1e-3 이내다.
{
  const nx = 40, ny = 36;
  const u = new Float32Array(nx * ny), v = new Float32Array(nx * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const at = index(x, y, nx);
    u[at] = 0.72;
    v[at] = -0.31;
  }
  const north = { nx, ny, u, v };
  const wind = rotateToWindFrame(north, 137);
  const roundTrip = rotateFromWindFrame(wind, 137);
  const error = Math.max(...u.map((value, at) => Math.abs(value - roundTrip.u[at])), ...v.map((value, at) => Math.abs(value - roundTrip.v[at])));
  assert.ok(error < 1e-3, `회전 왕복 최대 오차=${error}`);
}

// 5) 계획 성능 예산: 대표 CPU에서 빈 500×500 영역 6,000 스텝은 20초 이내를 목표로 하고,
//    CI 변동을 고려한 실패 상한은 40초로 둔다.
{
  const nx = 500, ny = 500, steps = 6_000;
  const t0 = performance.now();
  const result = computeWind2D({ nx, ny, solid: new Uint8Array(nx * ny), steps });
  const elapsedMs = performance.now() - t0;
  console.log(`D2Q9 perf: ${nx}x${ny} x ${steps} -> ${elapsedMs.toFixed(0)} ms (budget 20,000 ms; assert 40,000 ms)`);
  assert.equal(result.steps, steps);
  assert.ok(elapsedMs < 40_000, `D2Q9 성능 실패: ${elapsedMs.toFixed(0)} ms`);
}

console.log("v2 sim-wind2d: ok");

import assert from "node:assert/strict";

const { skyViewFactor, terrainHorizon, horizonAt } = await import("../../lib/v2/sim/horizon.ts");

const near = (actual, expected, tolerance, message) => {
  assert.ok(Number.isFinite(actual), `${message}: expected a finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected} (±${tolerance})`);
};

function centerGrid(spanM, cellM) {
  const cells = Math.round(spanM / cellM);
  assert.equal(cells % 2, 0, "test grids need a cell at the origin");
  return { x0: -spanM / 2, y0: -spanM / 2, cellM, cols: cells, rows: cells };
}

function centerIndex(grid) {
  return (grid.rows / 2) * grid.cols + grid.cols / 2;
}

function wallDsm(grid, height, predicate) {
  const dsm = new Float32Array(grid.cols * grid.rows);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const x = grid.x0 + (col + 0.5) * grid.cellM;
      const y = grid.y0 + (row + 0.5) * grid.cellM;
      if (predicate(x, y)) dsm[row * grid.cols + col] = height;
    }
  }
  return dsm;
}

// 1) An unobstructed horizontal plane has a full sky view.
{
  const grid = centerGrid(80, 2);
  const dsm = new Float32Array(grid.cols * grid.rows);
  const receiver = new Uint8Array(dsm.length).fill(1);
  const values = skyViewFactor(dsm, grid, receiver, { dirs: 32, maxDistM: 300 });
  assert.equal(values.length, dsm.length);
  for (const value of values) near(value, 1, 0.01, "평지 SVF");
}

// 2) Two continuous walls form an infinite canyon.
{
  const grid = centerGrid(128, 1);
  const width = 20;
  const height = 20;
  const dsm = wallDsm(grid, height, (x) => Math.abs(Math.abs(x) - width / 2) <= 1);
  const receiver = new Uint8Array(dsm.length);
  const center = centerIndex(grid);
  receiver[center] = 1;
  const values = skyViewFactor(dsm, grid, receiver, { dirs: 32, maxDistM: 60, eyeM: 0 });
  const expected = Math.cos(Math.atan((2 * height) / width));
  near(values[center], expected, 0.03, "무한 협곡 중앙 SVF");
}

// 3) A circular well has the same elevation angle in every direction.
{
  const grid = centerGrid(96, 1);
  const radius = 18;
  const height = 15;
  const dsm = wallDsm(grid, height, (x, y) => {
    const distance = Math.hypot(x, y);
    return distance >= radius - 1 && distance <= radius + 1;
  });
  const receiver = new Uint8Array(dsm.length);
  const center = centerIndex(grid);
  receiver[center] = 1;
  const values = skyViewFactor(dsm, grid, receiver, { dirs: 32, maxDistM: 48, eyeM: 0 });
  const expected = Math.cos(Math.atan(height / radius)) ** 2;
  near(values[center], expected, 0.03, "원통 우물 바닥 SVF");
}

// 4) A 30 degree plane has a 30 degree uphill horizon at compass north.
{
  const slope = Math.tan((30 * Math.PI) / 180);
  const bbox = { minX: -120, minY: -120, maxX: 120, maxY: 120 };
  const z = (x, y) => y * slope;
  const first = terrainHorizon(z, bbox, { cellM: 10, azimuths: 72, searchM: 120 });
  const second = terrainHorizon(z, bbox, { cellM: 10, azimuths: 72, searchM: 120 });
  near(horizonAt(first, 0, 0, 0), 30, 1, "오르막 지평선");
  near(horizonAt(first, 0, 0, 180), 0, 0.01, "내리막 지평선");
  near(horizonAt(first, 0, 0, 360), horizonAt(first, 0, 0, 0), 1e-6, "방위각 wrap");
  assert.deepEqual(Array.from(first.angleDeg), Array.from(second.angleDeg), "지평선은 결정적이어야 한다");
  assert.equal(first.angleDeg.length, first.cols * first.rows * first.azimuths);
}

// 5) A terrain horizon also contributes to SVF when no DSM wall is present.
{
  const grid = centerGrid(80, 2);
  const dsm = new Float32Array(grid.cols * grid.rows);
  const receiver = new Uint8Array(dsm.length);
  const center = centerIndex(grid);
  receiver[center] = 1;
  const horizon = terrainHorizon((x, y) => Math.tan((30 * Math.PI) / 180) * y, {
    minX: -100,
    minY: -100,
    maxX: 100,
    maxY: 100,
  }, { cellM: 10, azimuths: 72, searchM: 100 });
  const values = skyViewFactor(dsm, grid, receiver, { dirs: 32, maxDistM: 50, horizon, eyeM: 0 });
  assert.ok(values[center] < 0.99, "지형 지평선은 하늘열림을 낮춰야 한다");
}

// 6) Performance: 800m x 800m at 2m cells and 3,000 deterministic building footprints.
{
  const grid = centerGrid(800, 2);
  const dsm = new Float32Array(grid.cols * grid.rows);
  let seed = 17;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let building = 0; building < 3000; building += 1) {
    const cx = Math.floor(random() * (grid.cols - 8)) + 4;
    const cy = Math.floor(random() * (grid.rows - 8)) + 4;
    const halfW = 1 + Math.floor(random() * 5);
    const halfH = 1 + Math.floor(random() * 5);
    const height = 4 + random() * 56;
    for (let row = Math.max(0, cy - halfH); row <= Math.min(grid.rows - 1, cy + halfH); row += 1) {
      for (let col = Math.max(0, cx - halfW); col <= Math.min(grid.cols - 1, cx + halfW); col += 1) {
        const index = row * grid.cols + col;
        if (height > dsm[index]) dsm[index] = height;
      }
    }
  }
  const receiver = new Uint8Array(dsm.length).fill(1);
  const started = performance.now();
  const values = skyViewFactor(dsm, grid, receiver, { dirs: 32, maxDistM: 300 });
  const elapsed = performance.now() - started;
  console.log(`SVF perf: ${grid.cols}x${grid.rows}, 3,000 buildings -> ${elapsed.toFixed(0)} ms`);
  assert.equal(values.length, dsm.length);
  assert.ok(elapsed <= 8000, `SVF 성능 예산 초과: ${elapsed} ms (assert budget 8s, target 4s)`);
}

{
  const grid = { x0: -400, y0: -400, cellM: 30, cols: 27, rows: 27 };
  const started = performance.now();
  const map = terrainHorizon((x, y) => 0.002 * x + 0.001 * y, {
    minX: grid.x0,
    minY: grid.y0,
    maxX: grid.x0 + grid.cols * grid.cellM,
    maxY: grid.y0 + grid.rows * grid.cellM,
  }, { cellM: 30, azimuths: 72, searchM: 5000 });
  const elapsed = performance.now() - started;
  console.log(`terrain horizon perf: ${map.cols}x${map.rows}x${map.azimuths} -> ${elapsed.toFixed(0)} ms`);
  assert.ok(elapsed <= 1000, `지평선 성능 예산 초과: ${elapsed} ms (target 1s)`);
}

console.log("v2 horizon: ok");

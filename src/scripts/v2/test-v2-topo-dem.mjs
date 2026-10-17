import assert from "node:assert/strict";

const { interpolateTopoDem, TopoDemReader } = await import("../../lib/v2/topo/dem.ts");

// 원뿔 z = 100 - dist / 10. 반지름 500 m까지 2 m 간격의 등고선과 중심 표고점.
const points = [];
const cx = 1000;
const cy = 1000;
for (let radius = 2; radius <= 500; radius += 2) {
  const vertices = Math.max(16, Math.ceil((2 * Math.PI * radius) / 24));
  for (let i = 0; i < vertices; i += 1) {
    const angle = (2 * Math.PI * i) / vertices;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    points.push(x, y, 100 - radius / 10);
  }
}
points.push(cx, cy, 100);

const grid = interpolateTopoDem(new Float64Array(points), [500, 500, 1500, 1500], 5);
const reader = new TopoDemReader(grid);

const atCenter = reader.elevationUtmk(1000, 1000);
assert.notEqual(atCenter, null);
assert.ok(Math.abs(atCenter - 100) <= 1, `center elevation=${atCenter}`);

const at250 = reader.elevationUtmk(1250, 1000);
assert.notEqual(at250, null);
assert.ok(Math.abs(at250 - 75) <= 1, `250m elevation=${at250}`);

const outsideIndex = grid.values.length - 1;
assert.ok(Number.isNaN(grid.values[outsideIndex]), "an empty outer cell must remain NaN");
assert.equal(reader.elevationUtmk(2000, 2000), null);

console.log("✓ v2 topo dem");

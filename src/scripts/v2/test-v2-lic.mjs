import assert from "node:assert/strict";

const { lic } = await import("../../lib/v2/ui/lic.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { windDirectionFromView, windDirectionLabel } = await import("../../lib/v2/ui/wind-upload.ts");
const { RECOVERED } = await import("../../lib/v2/ui/fixtures/godeok.ts");

function correlation(values, width, height, dx, dy) {
  let sum = 0;
  let count = 0;
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  for (let y = 0; y + dy < height; y += 1) {
    for (let x = 0; x + dx < width; x += 1) {
      const a = values[y * width + x] - mean;
      const b = values[(y + dy) * width + x + dx] - mean;
      sum += a * b;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

const cols = 48;
const rows = 24;
const u = new Float32Array(cols * rows).fill(1);
const v = new Float32Array(cols * rows);
const first = lic(u, v, cols, rows, 96, 48, { lengthPx: 20, seed: 17 });
const second = lic(u, v, cols, rows, 96, 48, { lengthPx: 20, seed: 17 });

assert.equal(first.length, 96 * 48);
assert.deepEqual(Array.from(first), Array.from(second), "same seed must produce the same LIC texture");
assert.ok(Array.from(first).every((value) => Number.isFinite(value) && value >= 0 && value <= 1), "LIC output must be normalized");

const alongStream = correlation(first, 96, 48, 1, 0);
const acrossStream = correlation(first, 96, 48, 0, 1);
assert.ok(alongStream > acrossStream, `stream direction correlation ${alongStream} must exceed cross-stream ${acrossStream}`);

const zeroField = lic(new Float32Array(cols * rows), new Float32Array(cols * rows), cols, rows, 24, 12, { lengthPx: 20, seed: 17 });
assert.ok(Array.from(zeroField).every((value) => Number.isFinite(value)), "zero field must still render finite texture values");

const s03 = {
  ...RECOVERED.S03,
  conditions: {
    ...RECOVERED.S03.conditions,
    simulation: {
      case: {
        inflow: {
          annual: { deg: 45 },
          winter: { deg: 225 },
        },
      },
    },
  },
};
const s03View = toTileView(s03);
assert.equal(s03View.windDirections?.annual, 45);
assert.equal(windDirectionFromView(s03View, "annual"), 45);
assert.equal(windDirectionFromView(s03View, "winter"), 225);
assert.equal(windDirectionLabel(windDirectionFromView(s03View, "annual")), "북동(NE)");
assert.equal(windDirectionFromView(toTileView(RECOVERED.S03), "annual"), null, "missing S03 direction must not default to south");

console.log(`✓ v2 LIC deterministic directional texture (${alongStream.toFixed(4)} > ${acrossStream.toFixed(4)})`);

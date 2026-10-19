import assert from "node:assert/strict";
import { defaultFrame } from "../../lib/v2/report/report-doc.ts";
import {
  SCALE_PRESETS,
  parseScaleInput,
  scaleForFrame,
  zoomForScale,
} from "../../lib/v2/ui/report-scale.ts";

assert.deepEqual(SCALE_PRESETS, [1000, 2500, 5000, 10000]);
assert.equal(parseScaleInput("1:2,500"), 2500);
assert.equal(parseScaleInput("2500"), 2500);
assert.equal(parseScaleInput("1/2500"), 2500);
assert.equal(parseScaleInput("499"), null);
assert.equal(parseScaleInput("1:50,001"), null);
assert.equal(parseScaleInput("1:abc"), null);

const frame = { ...defaultFrame(), zoomDelta: 1.25 };
const denominator = scaleForFrame(frame, 180, 1000);
assert.equal(denominator % 10, 0);
assert.ok(Math.abs(zoomForScale(denominator, 180, 1000) - frame.zoomDelta) < 0.02);
assert.equal(scaleForFrame({ ...frame, scaleDenominator: 5000, locked: true }, 180, 1000), 5000);

console.log("report scale: PASS");

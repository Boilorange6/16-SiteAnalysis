import assert from "node:assert/strict";
import { defaultFrame } from "../../lib/v2/report/report-doc.ts";
import {
  SCALE_PRESETS,
  mapFrameScaleOptions,
  mapFrameWidthMm,
  parseScaleInput,
  scaleForFrame,
  visibleGroundWidthM,
  zoomForScale,
} from "../../lib/v2/ui/report-scale.ts";
import { layoutRects, slideSize } from "../../lib/v2/ui/overlay-layout.ts";

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

for (const format of ["wide", "a3"]) {
  for (const layout of ["map-summary", "numbers-first", "side-by-side"]) {
    const frameWidthMm = mapFrameWidthMm(format, layout);
    const expectedGroundWidthM = frameWidthMm * 2500 / 1000;
    const groundWidthM = visibleGroundWidthM(frameWidthMm, 2500);
    assert.ok(Math.abs(groundWidthM - expectedGroundWidthM) / expectedGroundWidthM < 0.02, `${format}/${layout} 지상 폭`);
    const map = layoutRects(layout, format).map;
    if (layout !== "map-summary") {
      assert.ok(map, `${format}/${layout} 지도 프레임`);
      assert.ok(Math.abs(frameWidthMm - slideSize(format).w * 25.4 * map.w) < 0.01, `${format}/${layout} 프레임 폭`);
    }
    const options = mapFrameScaleOptions(format, layout);
    const zoomDelta = zoomForScale(2500, frameWidthMm, 1000, options);
    assert.ok(Math.abs(scaleForFrame({ zoomDelta, scaleDenominator: null }, frameWidthMm, 1000, options) - 2500) < 10, `${format}/${layout} 축척 왕복`);
  }
}

console.log("report scale: PASS");

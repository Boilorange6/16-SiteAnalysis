import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const { canopyToGrid, detectCanopy } = await import("../../lib/v2/sim/canopy.ts");
const { MAX_Z } = await import("../../lib/v2/tiles.ts");

const CENTER = [127.15592, 37.56253];
const TILE_SIZE = 256;

function worldPixel([lng, lat], z) {
  const size = TILE_SIZE * 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * size,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  ];
}

function groundResolution(lat, z) {
  return (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * 6378137) / (TILE_SIZE * 2 ** z);
}

function syntheticMosaic(width = 256, height = 256) {
  const rgb = new Uint8Array(width * height * 3);
  const truth = new Uint8Array(width * height);
  const roof = { left: 20, top: 20, right: 78, bottom: 74 };
  const water = { left: 172, top: 24, right: 232, bottom: 86 };
  const shadow = { left: 25, top: 168, right: 102, bottom: 202 };
  const cx = 128;
  const cy = 130;
  const canopyRadius = 47;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 3;
      const noise = ((x * 17 + y * 31) % 11) - 5;
      let r = 132 + noise;
      let g = 119 + noise;
      let b = 78 + noise;
      const inCanopy = Math.hypot(x - cx, y - cy) <= canopyRadius;
      if (inCanopy) {
        truth[y * width + x] = 1;
        r = 42 + ((x + y) % 9);
        g = 145 + ((x * 3 + y) % 17);
        b = 39 + ((x * 5 + y * 2) % 8);
      }
      if (x >= roof.left && x < roof.right && y >= roof.top && y < roof.bottom) {
        r = 144;
        g = 144;
        b = 144;
        truth[y * width + x] = 0;
      }
      if (x >= water.left && x < water.right && y >= water.top && y < water.bottom) {
        r = 25;
        g = 76;
        b = 185;
        truth[y * width + x] = 0;
      }
      if (x >= shadow.left && x < shadow.right && y >= shadow.top && y < shadow.bottom) {
        r = 8;
        g = 9;
        b = 10;
        truth[y * width + x] = 0;
      }
      // A 2 m² green speck: it must disappear under minAreaM2=4.
      if (x >= 232 && x < 234 && y >= 208 && y < 209) {
        r = 45;
        g = 150;
        b = 40;
        truth[y * width + x] = 0;
      }
      rgb[index] = r;
      rgb[index + 1] = g;
      rgb[index + 2] = b;
    }
  }
  return {
    mosaic: {
      z: 18,
      x0Px: 0,
      y0Px: 0,
      width,
      height,
      rgb,
      mPerPx: 1,
      missingTiles: 0,
      totalTiles: 1,
      valid: new Uint8Array(width * height).fill(1),
    },
    truth,
    roof,
    water,
  };
}

assert.equal(MAX_Z, 19, "the existing tile proxy still accepts z19");

  const { mosaic: synthetic, truth, roof, water } = syntheticMosaic();
  const detected = detectCanopy(synthetic, { minAreaM2: 4, openM: 0.5, closeM: 1 });
  let truePositive = 0;
  let falsePositive = 0;
  let actualCanopy = 0;
  let predictedCanopy = 0;
  for (let index = 0; index < truth.length; index++) {
    actualCanopy += truth[index];
    predictedCanopy += detected.mask[index];
    if (truth[index] && detected.mask[index]) truePositive += 1;
    if (!truth[index] && detected.mask[index]) falsePositive += 1;
  }
  assert.ok(truePositive / actualCanopy >= 0.9, `recall ${truePositive / actualCanopy}`);
  assert.ok(truePositive / predictedCanopy >= 0.9, `precision ${truePositive / predictedCanopy}`);
  for (let y = roof.top; y < roof.bottom; y++) {
    for (let x = roof.left; x < roof.right; x++) assert.equal(detected.mask[y * synthetic.width + x], 0, "gray roof false positive");
  }
  for (let y = water.top; y < water.bottom; y++) {
    for (let x = water.left; x < water.right; x++) assert.equal(detected.mask[y * synthetic.width + x], 0, "blue water false positive");
  }
  assert.equal(detected.mask[208 * synthetic.width + 232], 0, "2 m² green speck removed");
  assert.ok(detected.threshold >= 0.04 && detected.threshold <= 0.20);
  assert.ok(detected.coveragePct > 0 && detected.coveragePct < 30);
  assert.equal(falsePositive, predictedCanopy - truePositive);

  const z = 18;
  const [centerPxX, centerPxY] = worldPixel(CENTER, z);
  const radiusM = 20;
  const mPerPx = groundResolution(CENTER[1], z);
  const radiusPx = radiusM / mPerPx;
  const width = Math.ceil(radiusPx * 2) + 8;
  const height = width;
  const x0Px = Math.floor(centerPxX - width / 2);
  const y0Px = Math.floor(centerPxY - height / 2);
  const rgb = new Uint8Array(width * height * 3);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = Math.hypot(x0Px + x + 0.5 - centerPxX, y0Px + y + 0.5 - centerPxY) <= radiusPx;
      mask[y * width + x] = inside ? 1 : 0;
      rgb[(y * width + x) * 3] = inside ? 40 : 140;
      rgb[(y * width + x) * 3 + 1] = inside ? 145 : 120;
      rgb[(y * width + x) * 3 + 2] = inside ? 40 : 80;
    }
  }
  const geospatialMosaic = { z, x0Px, y0Px, width, height, rgb, mPerPx, missingTiles: 0, totalTiles: 1, valid: new Uint8Array(width * height).fill(1) };
  const grid = canopyToGrid(geospatialMosaic, mask, CENTER, radiusM, 1);
  let gridArea = 0;
  let finiteInside = 0;
  const [gridCx, gridCy] = [grid.cx, grid.cy];
  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.cols; column++) {
      const distance = Math.hypot(grid.x0 + column * grid.cellM - gridCx, grid.y0 + row * grid.cellM - gridCy);
      if (distance > radiusM) continue;
      const value = grid.values[row * grid.cols + column];
      assert.ok(Number.isFinite(value), "complete imagery has no NaN cells inside the requested radius");
      finiteInside += 1;
      if (value === 1) gridArea += 1;
    }
  }
  assert.ok(finiteInside > 0);
  const expectedArea = Math.PI * radiusM ** 2;
  assert.ok(Math.abs(gridArea - expectedArea) / expectedArea <= 0.02, `grid area ${gridArea}, expected ${expectedArea}`);

  const benchmarkWidth = 3_400;
  const benchmarkHeight = 3_400;
  const benchmarkRgb = new Uint8Array(benchmarkWidth * benchmarkHeight * 3);
  for (let pixel = 0, offset = 0; pixel < benchmarkWidth * benchmarkHeight; pixel++, offset += 3) {
    benchmarkRgb[offset] = 42;
    benchmarkRgb[offset + 1] = 145;
    benchmarkRgb[offset + 2] = 40;
  }
  const started = performance.now();
  detectCanopy({ z: 18, x0Px: 0, y0Px: 0, width: benchmarkWidth, height: benchmarkHeight, rgb: benchmarkRgb, mPerPx, missingTiles: 0, totalTiles: 1 });
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs <= 2_000, `3,400x3,400 detection took ${elapsedMs.toFixed(1)} ms`);
  console.log(`canopy benchmark: ${elapsedMs.toFixed(1)} ms`);

  console.log("✓ v2 canopy imagery, detection, and grid");

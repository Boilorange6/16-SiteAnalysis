import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { readdirSync } from "node:fs";
import * as React from "react";

globalThis.React = React;

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { readManifest } = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d10 } = await import("../../lib/v2/tile/d10/engine.ts");
const { canopyFor } = await import("../../lib/v2/engine/tiles/canopy-shared.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { inflateRawSync } = await import("node:zlib");

const CENTER = [127.1506, 37.6245];
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

function syntheticMosaic(center = CENTER, radiusM = 80, missingFraction = 0) {
  const z = 18;
  const mPerPx = 0.6;
  const [centerPxX, centerPxY] = worldPixel(center, z);
  const width = Math.ceil((radiusM * 2) / mPerPx) + 8;
  const height = width;
  const x0Px = Math.floor(centerPxX - width / 2);
  const y0Px = Math.floor(centerPxY - height / 2);
  const rgb = new Uint8Array(width * height * 3);
  const valid = new Uint8Array(width * height).fill(1);
  const truth = new Uint8Array(width * height);
  const canopyRadiusPx = Math.max(2, radiusM * 0.28 / mPerPx);
  const missingColumns = Math.floor(width * missingFraction);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const offset = index * 3;
      const dx = x0Px + x + 0.5 - centerPxX;
      const dy = y0Px + y + 0.5 - centerPxY;
      const canopy = Math.hypot(dx, dy) <= canopyRadiusPx;
      truth[index] = canopy ? 1 : 0;
      rgb[offset] = canopy ? 42 : 132;
      rgb[offset + 1] = canopy ? 145 : 119;
      rgb[offset + 2] = canopy ? 40 : 78;
      if (x < missingColumns) {
        valid[index] = 0;
        rgb[offset] = 0;
        rgb[offset + 1] = 0;
        rgb[offset + 2] = 0;
      }
    }
  }
  return {
    z,
    year: 2025,
    x0Px,
    y0Px,
    width,
    height,
    rgb,
    mPerPx,
    missingTiles: missingFraction > 0 ? 1 : 0,
    totalTiles: missingFraction > 0 ? 2 : 1,
    valid,
    truth,
  };
}

function input(address = "테스트 대지", radiusM = 800) {
  return { address, center: CENTER, radiusM, analysisDate: "2026-10-01", pnu: null };
}

function attachRasters(tile, rasters) {
  return parseTileResult({
    ...tile,
    presentation: { ...tile.presentation, rasters: rasters.map(({ ref }) => ref) },
  });
}

const dataDir = await mkdtemp(join(tmpdir(), "v2-d10-data-"));
const cleanup = async (path) => {
  try { await rm(path, { recursive: true, force: true }); } catch (error) { console.warn(`cleanup deferred for ${path}: ${String(error)}`); }
};
try {
  await buildEngineFixture(dataDir, "v1", { landuse: true });
  const manifest = readManifest(dataDir);
  assert.ok(manifest);

  const noMosaicContext = new EngineContext(dataDir, manifest, "d10-no-mosaic", input(), {}, {});
  const noMosaicTile = d10(noMosaicContext);
  assert.equal(canopyFor(noMosaicContext), null);
  assert.ok(noMosaicTile.presentation.polygons?.some((polygon) => polygon.layer === "osm_green"));
  assert.ok(noMosaicTile.presentation.layers?.includes("osm_green"));
  assert.ok(noMosaicTile.metrics.some((metric) => metric.id === "osm_green_pct"));
  assert.ok(noMosaicTile.metrics.some((metric) => metric.id === "share_osm_green_pct"));
  assert.ok(noMosaicTile.provenance.sources.some((source) => source.sourceId === "osm_landuse"));
  assert.ok(noMosaicTile.limitations.some(({ note }) => note === "영상지도를 받지 못해 수관 면적률·수관 면을 계산하지 않고 OSM 녹지·수계만 표시합니다."));
  assert.ok(!noMosaicTile.limitations.some(({ note }) => /ExG|수관 높이|촬영시기/.test(note)));
  noMosaicContext.close();

  const mosaic = syntheticMosaic(CENTER, 800);
  const firstContext = new EngineContext(dataDir, manifest, "d10-complete", input(), {}, {});
  const firstStarted = performance.now();
  const firstTile = d10(firstContext, { mosaic });
  assert.ok(firstTile.provenance.sources.some((s) => s.sourceId === "ngii_air" && s.releaseId === "ngii_air@2025" && s.sourceAsOf === "2025"));
  assert.ok(firstTile.limitations.some((l) => l.note === "영상: 국토지리정보원 영상지도 2025년 촬영(국토정보플랫폼 오픈API)"));
  const firstElapsedMs = performance.now() - firstStarted;
  const firstRasters = firstContext.takeRasters("D10");
  const canopyGrid = canopyFor(firstContext)?.grid;
  const canopyRef = firstRasters.find(({ ref }) => ref.name === "canopy")?.ref;
  assert.ok(canopyGrid && canopyRef, "D10 canopy grid and raster are emitted");
  assert.equal(canopyRef.x0, canopyGrid.x0 - canopyGrid.cellM / 2, "canopy raster x0 is the first-cell outer edge");
  assert.equal(canopyRef.y0, canopyGrid.y0 - canopyGrid.cellM / 2, "canopy raster y0 is the first-cell outer edge");
  const parsed = attachRasters(firstTile, firstRasters);
  assert.equal(parsed.tileCode, "D10");
  assert.equal(parsed.status, "complete");
  assert.equal(parsed.presentation.basemap, "Satellite");
  assert.ok(parsed.presentation.rasters?.some((ref) => ref.name === "canopy"));
  assert.ok(!parsed.presentation.polygons?.some((polygon) => polygon.layer === "canopy"), "D10 canopy is raster-only");
  assert.ok(!parsed.presentation.polygons?.some((polygon) => polygon.layer === "osm_green"));
  assert.ok(!parsed.presentation.layers?.includes("osm_green"));
  assert.ok(!parsed.metrics.some((metric) => ["osm_green_pct", "share_osm_green_pct"].includes(metric.id)));
  assert.ok(!parsed.provenance.sources.some((source) => source.sourceId === "osm_landuse"));
  assert.equal(parsed.metrics.find((metric) => metric.id === "osm_water_pct")?.label, "하천·수면 면적률");
  assert.ok(!parsed.limitations.some(({ note }) => note.startsWith("OSM 녹지 면 자료를 확인하지 못해")));
  assert.ok(parsed.presentation.polygons?.some((polygon) => polygon.layer === "osm_water"));
  const canopyPct = parsed.metrics.find((metric) => metric.id === "canopy_pct");
  assert.ok(canopyPct && canopyPct.status === "estimated" && canopyPct.value !== null);
  assert.ok(Math.abs(canopyPct.value - 7.8) < 2, `canopy_pct ${canopyPct.value}`);
  const layerShares = parsed.metrics.filter((metric) => metric.id.startsWith("share_"));
  assert.deepEqual(layerShares.map((metric) => metric.id), ["share_canopy_pct", "share_osm_water_pct"], "D10 구성비 순서는 레이어 범례와 같다");
  assert.deepEqual(layerShares.map((metric) => metric.label), ["구성비: 수관", "구성비: 하천·수면"]);
  assert.ok(layerShares.every((metric) => metric.unit === "%" && metric.numerator !== null && metric.denominator !== null));
  assert.ok(parsed.limitations.some((limitation) => limitation.note.includes("구성비 합이 100%가 아닐 수")));
  const fill = parsed.metrics.find((metric) => metric.id === "fill_imagery_pct");
  assert.deepEqual({ value: fill?.value, status: fill?.status }, { value: 100, status: "observed" });
  assert.ok(firstElapsedMs <= 22_000, `D10 fixture first execution ${firstElapsedMs.toFixed(1)} ms > 22000 ms`);
  console.log(`D10 fixture perf: ${firstElapsedMs.toFixed(1)} ms (first-run budget 22000 ms)`);

  const secondContext = new EngineContext(dataDir, manifest, "d10-deterministic", input(), {}, {});
  const secondTile = d10(secondContext, { mosaic: syntheticMosaic(CENTER, 800) });
  const secondRasters = secondContext.takeRasters("D10");
  assert.equal(firstRasters[0]?.ref.sha256, secondRasters[0]?.ref.sha256, "동일 입력 래스터 sha 결정성");
  assert.deepEqual(firstTile.presentation.polygons, secondTile.presentation.polygons, "동일 입력 벡터 결정성");
  firstContext.close();
  secondContext.close();

  // Cross-analysis canopy cache: a cache hit must be indistinguishable from a fresh detection.
  const resultCacheDir = await mkdtemp(join(tmpdir(), "v2-canopy-result-"));
  try {
    const run = (id, options) => {
      const context = new EngineContext(dataDir, manifest, id, input(), {}, {});
      const result = canopyFor(context, options);
      context.close();
      return result;
    };
    const fresh = run("canopy-cache-off", { mosaic: syntheticMosaic(CENTER, 800), resultCacheDir: "off" });
    const stored = run("canopy-cache-write", { mosaic: syntheticMosaic(CENTER, 800), resultCacheDir });
    const hit = run("canopy-cache-hit", { mosaic: syntheticMosaic(CENTER, 800), resultCacheDir });
    assert.ok(readdirSync(resultCacheDir).some((name) => name.endsWith(".bin")), "result file written");
    for (const candidate of [stored, hit]) {
      assert.deepEqual(candidate.polygons, fresh.polygons, "cached polygons identical");
      assert.deepEqual(candidate.grid, fresh.grid, "cached grid identical (including NaN cells)");
      assert.equal(candidate.threshold, fresh.threshold);
      assert.equal(candidate.coveragePct, fresh.coveragePct);
      assert.equal(candidate.totalTiles, fresh.totalTiles);
    }
    const different = run("canopy-cache-other", { mosaic: syntheticMosaic(CENTER, 800, 0.5), resultCacheDir });
    assert.notDeepEqual(different.polygons, fresh.polygons, "a different image never reuses the cached result");
  } finally {
    await rm(resultCacheDir, { recursive: true, force: true });
  }

  const partialContext = new EngineContext(dataDir, manifest, "d10-partial", input(), {}, {});
  const partialTile = d10(partialContext, { mosaic: syntheticMosaic(CENTER, 800, 0.5) });
  assert.ok(partialTile.limitations.some((l) => l.note === "영상지도 1/2개 타일을 받지 못해 유효 영역만 표시했습니다."));
  const partialParsed = attachRasters(partialTile, partialContext.takeRasters("D10"));
  assert.equal(partialParsed.status, "partial");
  assert.equal(partialParsed.metrics.find((metric) => metric.id === "fill_imagery_pct")?.value, 50);
  assert.match(partialParsed.limitations.map((item) => item.note).join(" "), /일부|누락|채움|받지 못|표시/);
  partialContext.close();

  const missingDataDir = await mkdtemp(join(tmpdir(), "v2-d10-no-osm-"));
  try {
    await buildEngineFixture(missingDataDir, "v1", {});
    const missingManifest = readManifest(missingDataDir);
    assert.ok(missingManifest);
    const separationContext = new EngineContext(missingDataDir, missingManifest, "d10-osm-separation", input(), {}, {});
    const separationTile = d10(separationContext, { mosaic });
    const separationRasters = separationContext.takeRasters("D10");
    const separationCanopyPct = separationTile.metrics.find((metric) => metric.id === "canopy_pct")?.value;
    assert.equal(separationCanopyPct, canopyPct.value, "OSM 보조층은 canopy_pct에 영향을 주지 않음");
    assert.equal(separationRasters[0]?.ref.sha256, firstRasters[0]?.ref.sha256, "OSM 보조층은 canopy mask에 union/dilate되지 않음");
    assert.ok(!separationTile.presentation.polygons?.some((polygon) => polygon.layer === "osm_green" || polygon.layer === "osm_water"));
    separationContext.close();
    const missingContext = new EngineContext(missingDataDir, missingManifest, "d10-missing", input(), {}, {});
    const missingTile = d10(missingContext, { mosaic: { ...mosaic, missingTiles: 1, totalTiles: 1, valid: new Uint8Array(mosaic.width * mosaic.height) } });
    assert.equal(missingTile.status, "not_provided");
    assert.match(missingTile.limitations[0].note, /영상지도/);
    assert.equal(missingContext.takeRasters("D10").length, 0);
    missingContext.close();
  } finally {
    await rm(missingDataDir, { recursive: true, force: true });
  }

  assert.doesNotMatch(JSON.stringify(parsed), /수목 수|종합|법적 적합|개발 가능|건강 위험 예측/);
  // The compressed raster must decode to the advertised 1/0/255 mask values.
  const raw = inflateRawSync(firstRasters[0].blob);
  assert.ok(raw.includes(1));
  assert.ok(raw.includes(255));
  // 3 km(1 m 격자 6,003칸)는 래스터 한 변 상한 4,096을 넘으므로 표시용으로만 2×2 다수결로 묶는다.
  const { downsampleMask } = await import("../../lib/v2/tile/d10/engine.ts");
  const same = new Uint8Array([1, 0, 255]);
  assert.equal(downsampleMask(same, 3, 1, 1).values, same, "step 1은 그대로");
  const down = downsampleMask(new Uint8Array([
    1, 0, 0, 0, 1,
    1, 255, 0, 0, 255,
    255, 255, 1, 0, 0,
  ]), 5, 3, 2);
  assert.deepEqual([down.cols, down.rows, [...down.values]], [3, 2, [1, 0, 1, 255, 1, 0]], "다수결(동률=수관)·전부 결측=255·가장자리 부분 칸");
  console.log("✓ v2 D10 canopy and green-space tile");
} finally {
  await cleanup(dataDir);
}

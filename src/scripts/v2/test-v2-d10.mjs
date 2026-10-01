import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { mkdirSync, readFileSync } from "node:fs";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

globalThis.React = React;

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { readManifest } = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d10 } = await import("../../lib/v2/engine/tiles/d10.ts");
const { satelliteMosaic } = await import("../../lib/v2/engine/imagery.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { inflateRawSync } = await import("node:zlib");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { paintRgba } = await import("../../lib/v2/ui/raster-image.ts");
const { RASTER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
const { framedViewport, tilesFor, tileUrl } = await import("../../lib/v2/ui/map-projection.ts");

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

async function cachedMapTiles(center, radiusM, width, height, cacheRoot) {
  const viewport = framedViewport(center, radiusM, width, height);
  const tiles = tilesFor(viewport);
  const output = new Map();
  for (const tile of tiles) {
    const factor = 2 ** Math.max(0, 18 - tile.z);
    const layers = [];
    for (let dy = 0; dy < factor; dy++) {
      for (let dx = 0; dx < factor; dx++) {
        const source = join(cacheRoot, "Satellite", "18", String(tile.y * factor + dy), `${tile.x * factor + dx}.jpeg`);
        if (readFileSyncSafe(source)) layers.push({ input: readFileSync(source), left: dx * TILE_SIZE, top: dy * TILE_SIZE });
      }
    }
    if (layers.length === 0) continue;
    const jpeg = await sharp({ create: { width: TILE_SIZE * factor, height: TILE_SIZE * factor, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(layers)
      .resize(TILE_SIZE, TILE_SIZE)
      .png()
      .toBuffer();
    output.set(tileUrl("Satellite", tile.z, tile.x, tile.y), `data:image/png;base64,${jpeg.toString("base64")}`);
  }
  return output;
}

function readFileSyncSafe(path) {
  try { readFileSync(path); return true; } catch { return false; }
}

async function renderRealSiteVisual(outputDir) {
  const dataPath = process.env.V2_DATA_DIR;
  assert.ok(dataPath, "P4_VISUAL=1 requires V2_DATA_DIR for the published real-site evidence");
  const realManifest = readManifest(dataPath);
  assert.ok(realManifest, `published manifest missing: ${dataPath}`);
  const realCenter = [127.15592, 37.56253];
  const realCtx = new EngineContext(dataPath, realManifest, "d10-godeok-visual", {
    address: "서울 강동구 아리수로 250 (고덕동 558)",
    center: realCenter,
    radiusM: 800,
    analysisDate: "2026-10-01",
    pnu: null,
  });
  try {
    const started = performance.now();
    const realTile = d10(realCtx);
    const elapsedMs = performance.now() - started;
    const realRasters = realCtx.takeRasters("D10");
    const parsedReal = attachRasters(realTile, realRasters);
    assert.ok(["complete", "partial"].includes(parsedReal.status));
    assert.ok(realRasters.some(({ ref }) => ref.name === "canopy"), `real-site D10 has no canopy raster: ${parsedReal.status}`);
    assert.ok(realRasters[0].ref.cols >= 1500 && realRasters[0].ref.rows >= 1500, "real-site raster must cover the 800m radius at 1m");
    assert.ok(elapsedMs <= 22_000, `real-site D10 ${elapsedMs.toFixed(1)} ms > 22000 ms`);
    console.log(`D10 real-site perf: ${elapsedMs.toFixed(1)} ms (first-run budget 22000 ms)`);

    mkdirSync(outputDir, { recursive: true });
    const view = toTileView(parsedReal);
    assert.ok(view.map, "real-site D10 map model");
    const raster = realRasters.find(({ ref }) => ref.name === "canopy");
    const raw = inflateRawSync(raster.blob);
    const style = RASTER_STYLES[raster.ref.palette];
    assert.ok(style);
    const rgba = paintRgba(raster.ref, new Uint8Array(raw), style, raster.ref.cols, raster.ref.rows);
    const rasterPng = await sharp(Buffer.from(rgba), { raw: { width: raster.ref.cols, height: raster.ref.rows, channels: 4 } }).png().toBuffer();
    const tileCache = await cachedMapTiles(realCenter, 800, 1200, 1000, process.env.V2_AERIAL_CACHE_DIR ?? "D:/V-coding/16-SiteAnalysis/.cache/v2/raw/aerial");
    const svg = renderToStaticMarkup(createElement(MapFigure, {
      model: view.map,
      width: 1200,
      height: 1000,
      fixed: true,
      basemap: "tiles",
      layer: "Satellite",
      tileHref: (url) => tileCache.get(url),
      rasterHref: (ref) => ref.name === "canopy" ? `data:image/png;base64,${rasterPng.toString("base64")}` : null,
      label: "D10 수관·녹지 · 서울 강동구 아리수로 250 · 반경 800m",
    }));
    const oursPath = join(outputDir, "d10-godeok-ours-1200.png");
    await sharp(Buffer.from(svg)).png().toFile(oursPath);

    const referencePath = "D:/V-coding/16-SiteAnalysis/.worktrees/v2-int/docs/design/sitedia-2026-10-01/panels-1-12.png";
    assert.ok(readFileSyncSafe(referencePath), `sitedia reference missing: ${referencePath}`);
    const referenceCrop = await sharp(referencePath).extract({ left: 345, top: 827, width: 205, height: 277 }).png().toBuffer();
    const referenceOut = join(outputDir, "d10-sitedia-panel10.png");
    await sharp(referenceCrop).toFile(referenceOut);
    const compare = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 245, g: 246, b: 248 } } })
      .composite([
        { input: await sharp(oursPath).resize(1200, 1200, { fit: "contain", background: { r: 245, g: 246, b: 248 } }).png().toBuffer(), left: 0, top: 0 },
        { input: await sharp(referenceCrop).resize(1200, 1200, { fit: "contain", background: { r: 245, g: 246, b: 248 } }).png().toBuffer(), left: 1200, top: 0 },
      ])
      .png()
      .toBuffer();
    const comparePath = join(outputDir, "d10-godeok-compare.png");
    await sharp(compare).toFile(comparePath);
    console.log(`D10 visual ours: ${oursPath}`);
    console.log(`D10 visual reference: ${referenceOut}`);
    console.log(`D10 visual side-by-side: ${comparePath}`);
  } finally {
    realCtx.close();
  }
}

async function jpegTile(rgb) {
  return sharp({
    create: { width: TILE_SIZE, height: TILE_SIZE, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  }).jpeg({ quality: 95 }).toBuffer();
}

const dataDir = await mkdtemp(join(tmpdir(), "v2-d10-data-"));
const cacheRoot = await mkdtemp(join(tmpdir(), "v2-d10-tiles-"));
const cleanup = async (path) => {
  try { await rm(path, { recursive: true, force: true }); } catch (error) { console.warn(`cleanup deferred for ${path}: ${String(error)}`); }
};
try {
  await buildEngineFixture(dataDir, "v1", { landuse: true });
  const manifest = readManifest(dataDir);
  assert.ok(manifest);

  // T15 WMTS stitch contract is exercised with a fake fetch; D10 itself receives
  // the deterministic mosaic below so the tile engine remains synchronous under T3.
  let fetchCount = 0;
  const stitched = await satelliteMosaic(CENTER, 80, {
    key: "fixture-key",
    cacheRoot,
    fetch: async (url) => {
      fetchCount += 1;
      const match = new URL(url).pathname.match(/\/Satellite\/(\d+)\/(\d+)\/(\d+)\.jpeg$/);
      assert.ok(match, `unexpected WMTS URL: ${url}`);
      return new Response(await jpegTile([Number(match[3]) % 251, Number(match[2]) % 251, 33]), { status: 200, headers: { "content-type": "image/jpeg" } });
    },
  });
  assert.ok(stitched.totalTiles >= 4);
  assert.equal(fetchCount, stitched.totalTiles);

  const mosaic = syntheticMosaic(CENTER, 800);
  const firstContext = new EngineContext(dataDir, manifest, "d10-complete", input(), {}, {});
  const firstStarted = performance.now();
  const firstTile = d10(firstContext, { mosaic });
  const firstElapsedMs = performance.now() - firstStarted;
  const firstRasters = firstContext.takeRasters("D10");
  const parsed = attachRasters(firstTile, firstRasters);
  assert.equal(parsed.tileCode, "D10");
  assert.equal(parsed.status, "complete");
  assert.ok(parsed.presentation.rasters?.some((ref) => ref.name === "canopy"));
  assert.ok(parsed.presentation.polygons?.some((polygon) => polygon.layer === "canopy"));
  assert.ok(parsed.presentation.polygons?.some((polygon) => polygon.layer === "osm_green"));
  assert.ok(parsed.presentation.polygons?.some((polygon) => polygon.layer === "osm_water"));
  const canopyPct = parsed.metrics.find((metric) => metric.id === "canopy_pct");
  assert.ok(canopyPct && canopyPct.status === "estimated" && canopyPct.value !== null);
  assert.ok(Math.abs(canopyPct.value - 7.8) < 2, `canopy_pct ${canopyPct.value}`);
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

  const partialContext = new EngineContext(dataDir, manifest, "d10-partial", input(), {}, {});
  const partialTile = d10(partialContext, { mosaic: syntheticMosaic(CENTER, 800, 0.5) });
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
    const missingContext = new EngineContext(missingDataDir, missingManifest, "d10-missing", input(), {}, {});
    const missingTile = d10(missingContext, { mosaic: { ...mosaic, missingTiles: 1, totalTiles: 1, valid: new Uint8Array(mosaic.width * mosaic.height) } });
    assert.equal(missingTile.status, "not_provided");
    assert.match(missingTile.limitations[0].note, /VWorld/);
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
  if (process.env.P4_VISUAL === "1") await renderRealSiteVisual(process.env.P4_VISUAL_DIR ?? join(tmpdir(), "site-analysis-p4-t19"));
  console.log("✓ v2 D10 canopy and green-space tile");
} finally {
  await cleanup(cacheRoot);
  await cleanup(dataDir);
}

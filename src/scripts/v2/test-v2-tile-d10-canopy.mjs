import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import * as React from "react";
import sharp from "sharp";

globalThis.React = React;

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { readManifest } = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d10 } = await import("../../lib/v2/tile/d10/engine.ts");
const { canopyFor } = await import("../../lib/v2/engine/tiles/canopy-shared.ts");
const { satelliteMosaic } = await import("../../lib/v2/engine/imagery.ts");
const { detectCanopy } = await import("../../lib/v2/sim/canopy.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { inflateRawSync } = await import("node:zlib");
const { buffer: bufferLine } = await import("@turf/turf");

const CENTER = [127.1506, 37.6245];
const REAL_CENTER = [127.15592, 37.56253];
const REAL_RADIUS_M = 800;
const AERIAL_ZOOM = 18;
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

function readFileSyncSafe(path) {
  try { readFileSync(path); return true; } catch { return false; }
}

function tileCachePath(cacheRoot, z, x, y) {
  return join(cacheRoot, "Satellite", String(z), String(y), `${x}.jpeg`);
}

function inverseWorldPixel([x, y], z) {
  const size = TILE_SIZE * 2 ** z;
  return [
    (x / size) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI,
  ];
}

function assertTileCenterRoundTrip() {
  const knownTiles = [
    { x: 223663, y: 101518 },
    { x: 223664, y: 101519 },
    { x: 223665, y: 101520 },
  ];
  for (const tile of knownTiles) {
    const center = inverseWorldPixel([(tile.x + 0.5) * TILE_SIZE, (tile.y + 0.5) * TILE_SIZE], AERIAL_ZOOM);
    const roundTrip = worldPixel(center, AERIAL_ZOOM);
    assert.ok(Math.abs(roundTrip[0] - (tile.x + 0.5) * TILE_SIZE) < 1, `tile x round-trip > 1 px: ${JSON.stringify(tile)}`);
    assert.ok(Math.abs(roundTrip[1] - (tile.y + 0.5) * TILE_SIZE) < 1, `tile y round-trip > 1 px: ${JSON.stringify(tile)}`);
  }
  const north = inverseWorldPixel([(knownTiles[1].x + 0.5) * TILE_SIZE, (knownTiles[1].y - 0.5) * TILE_SIZE], AERIAL_ZOOM)[1];
  const south = inverseWorldPixel([(knownTiles[1].x + 0.5) * TILE_SIZE, (knownTiles[1].y + 1.5) * TILE_SIZE], AERIAL_ZOOM)[1];
  assert.ok(north > south, "WMTS row direction must increase toward south");
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 1, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function pointInPolygon([x, y], rings) {
  return pointInRing([x, y], rings[0]) && !rings.slice(1).some((ring) => pointInRing([x, y], ring));
}

function polygonRingsInUtm(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates.map((ring) => ring.map(([lng, lat]) => toUtmk([lng, lat])))];
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => toUtmk([lng, lat]))));
  return [];
}

function roadRect(cx, cy, x0, x1, y0, y1) {
  return [[[cx + x0, cy + y0], [cx + x1, cy + y0], [cx + x1, cy + y1], [cx + x0, cy + y1], [cx + x0, cy + y0]]];
}

function roadPolygonsFor(ctx) {
  const hits = ctx.hits("reference", ["road"]);
  if (hits.length > 0) {
    const polygons = [];
    for (const hit of hits) {
      const buffered = bufferLine({ type: "Feature", properties: {}, geometry: hit.geometry }, 8, { units: "meters" });
      if (buffered?.geometry) polygons.push(...polygonRingsInUtm(buffered.geometry));
    }
    if (polygons.length > 0) return { source: "published OSM road centerlines buffered 8m", polygons };
  }
  const [cx, cy] = toUtmk(ctx.input.center);
  return {
    source: "deterministic OSM road-polygon regression fixture (published reference has no osm_roads release)",
    polygons: [
      roadRect(cx, cy, 70, 86, -740, 740),
      roadRect(cx, cy, -740, 740, 392, 408),
    ],
  };
}

function canopyOverRoadPct(grid, radiusM, polygons) {
  let roadArea = 0;
  let canopyArea = 0;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const index = row * grid.cols + col;
      const value = grid.values[index];
      const x = grid.x0 + col * grid.cellM;
      const y = grid.y0 + row * grid.cellM;
      if (!Number.isFinite(value) || Math.hypot(x - grid.cx, y - grid.cy) > radiusM) continue;
      if (!polygons.some((rings) => pointInPolygon([x, y], rings))) continue;
      roadArea += grid.cellM ** 2;
      if (value >= 0.5) canopyArea += grid.cellM ** 2;
    }
  }
  return { roadArea, canopyArea, pct: roadArea > 0 ? (canopyArea / roadArea) * 100 : 0 };
}

function canopyGridAgreement(grid, mosaic, mask, center, radiusM) {
  const [centerPxX, centerPxY] = worldPixel(center, mosaic.z);
  let cells = 0;
  let matches = 0;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const value = grid.values[row * grid.cols + col];
      const x = grid.x0 + col * grid.cellM;
      const y = grid.y0 + row * grid.cellM;
      if (!Number.isFinite(value) || Math.hypot(x - grid.cx, y - grid.cy) > radiusM) continue;
      const pixelX = Math.max(0, Math.min(mosaic.width - 1, Math.floor(centerPxX + (x - grid.cx) / mosaic.mPerPx - mosaic.x0Px)));
      const pixelY = Math.max(0, Math.min(mosaic.height - 1, Math.floor(centerPxY - (y - grid.cy) / mosaic.mPerPx - mosaic.y0Px)));
      cells += 1;
      if ((value >= 0.5 ? 1 : 0) === mask[pixelY * mosaic.width + pixelX]) matches += 1;
    }
  }
  return { cells, matches, pct: cells > 0 ? (matches / cells) * 100 : 0 };
}

async function runRealSiteRegression() {
  const dataPath = process.env.V2_DATA_DIR;
  const cacheRoot = process.env.V2_AERIAL_CACHE_DIR ?? "D:/V-coding/16-SiteAnalysis/.cache/v2/raw/aerial";
  const centerTile = (() => {
    const [x, y] = worldPixel(REAL_CENTER, AERIAL_ZOOM);
    return { x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) };
  })();
  if (!dataPath || !existsSync(tileCachePath(cacheRoot, AERIAL_ZOOM, centerTile.x, centerTile.y))) {
    console.log("D10 real-site regression: skipped (set V2_DATA_DIR and V2_AERIAL_CACHE_DIR with the published Godeok cache)");
    return null;
  }
  const realManifest = readManifest(dataPath);
  assert.ok(realManifest, `published manifest missing: ${dataPath}`);
  const realCtx = new EngineContext(dataPath, realManifest, "d10-godeok-regression", {
    address: "서울 강동구 아리수로 250 (고덕동 558)",
    center: REAL_CENTER,
    radiusM: REAL_RADIUS_M,
    analysisDate: "2026-10-01",
    pnu: null,
  });
  try {
    assertTileCenterRoundTrip();
    const knownTiles = [
      { x: 223663, y: 101518 },
      { x: 223664, y: 101519 },
      { x: 223665, y: 101520 },
    ];
    for (const tile of knownTiles) assert.ok(existsSync(tileCachePath(cacheRoot, AERIAL_ZOOM, tile.x, tile.y)), `real cache tile key missing: ${JSON.stringify(tile)}`);

    const started = performance.now();
    const realTile = d10(realCtx);
    const elapsedMs = performance.now() - started;
    const realRasters = realCtx.takeRasters("D10");
    const parsedReal = attachRasters(realTile, realRasters);
    assert.ok(["complete", "partial"].includes(parsedReal.status));
    assert.ok(realRasters.some(({ ref }) => ref.name === "canopy"), `real-site D10 has no canopy raster: ${parsedReal.status}`);
    assert.ok(realRasters[0].ref.cols >= 1500 && realRasters[0].ref.rows >= 1500, "real-site raster must cover the 800m radius at 1m");
    assert.ok(elapsedMs <= 22_000, `real-site D10 ${elapsedMs.toFixed(1)} ms > 22000 ms`);

    const t15Mosaic = await satelliteMosaic(REAL_CENTER, REAL_RADIUS_M, { cacheRoot });
    const t15Detection = detectCanopy(t15Mosaic);
    const t15ReferencePct = 34.66;
    const d10Metric = realTile.metrics.find((metric) => metric.id === "canopy_pct");
    assert.equal(t15Mosaic.z, AERIAL_ZOOM, "real Godeok mosaic must stay at the chosen z18");
    assert.equal(t15Mosaic.missingTiles, 0, `real Godeok cache unexpectedly missing ${t15Mosaic.missingTiles}/${t15Mosaic.totalTiles} tiles`);
    assert.ok(Math.abs(t15Detection.coveragePct - t15ReferencePct) <= 0.25, `T15 baseline changed: ${t15Detection.coveragePct.toFixed(2)}%`);
    assert.ok(d10Metric?.value !== null && d10Metric?.value !== undefined, "real D10 canopy_pct missing");
    assert.ok(Math.abs(d10Metric.value - t15Detection.coveragePct) <= 3, `D10 canopy_pct ${d10Metric.value} vs T15 ${t15Detection.coveragePct.toFixed(2)} exceeds ±3 pp`);

    const canopy = canopyFor(realCtx);
    assert.ok(canopy, "real D10 canopy memo missing");
    assert.equal(parsedReal.presentation.basemap, "Satellite");
    const spatial = canopyGridAgreement(canopy.grid, t15Mosaic, t15Detection.mask, REAL_CENTER, REAL_RADIUS_M);
    assert.ok(spatial.pct >= 90, `D10 grid vs T15 pixel alignment ${spatial.pct.toFixed(2)}% < 90%`);
    const roads = roadPolygonsFor(realCtx);
    const roadOverlap = canopyOverRoadPct(canopy.grid, REAL_RADIUS_M, roads.polygons);
    assert.ok(roadOverlap.roadArea > 0, "OSM road regression polygons have no in-radius cells");
    assert.ok(roadOverlap.pct < 5, `detected canopy over ${roads.source}: ${roadOverlap.pct.toFixed(2)}%`);
    console.log(`D10 real-site perf: ${elapsedMs.toFixed(1)} ms (first-run budget 22000 ms)`);
    console.log(`D10 real-site regression: z=${t15Mosaic.z}, tiles=${t15Mosaic.totalTiles}, missing=${t15Mosaic.missingTiles}, T15=${t15Detection.coveragePct.toFixed(2)}%, D10=${d10Metric.value.toFixed(2)}%, grid-match=${spatial.pct.toFixed(2)}%, road-overlap=${roadOverlap.pct.toFixed(2)}% (${roads.source})`);
    return { realCtx, realTile, parsedReal, realRasters, canopy, t15Mosaic, t15Detection, elapsedMs, spatial, roadOverlap, roadSource: roads.source };
  } catch (error) {
    realCtx.close();
    throw error;
  }
}

function circleOverlayRgba(mosaic, mask, center, radiusM) {
  const [centerPxX, centerPxY] = worldPixel(center, mosaic.z);
  const radiusPx = radiusM / mosaic.mPerPx;
  const rgba = Buffer.alloc(mosaic.width * mosaic.height * 4);
  const canopyColor = [86, 210, 68];
  const canopyAlpha = 0.52;
  for (let y = 0; y < mosaic.height; y++) {
    for (let x = 0; x < mosaic.width; x++) {
      const output = (y * mosaic.width + x) * 4;
      const distance = Math.hypot(mosaic.x0Px + x + 0.5 - centerPxX, mosaic.y0Px + y + 0.5 - centerPxY);
      if (distance > radiusPx || (mosaic.valid && mosaic.valid[y * mosaic.width + x] !== 1)) continue;
      const pixel = (y * mosaic.width + x) * 3;
      const isCanopy = mask[y * mosaic.width + x] === 1;
      rgba[output] = isCanopy ? Math.round(mosaic.rgb[pixel] * (1 - canopyAlpha) + canopyColor[0] * canopyAlpha) : mosaic.rgb[pixel];
      rgba[output + 1] = isCanopy ? Math.round(mosaic.rgb[pixel + 1] * (1 - canopyAlpha) + canopyColor[1] * canopyAlpha) : mosaic.rgb[pixel + 1];
      rgba[output + 2] = isCanopy ? Math.round(mosaic.rgb[pixel + 2] * (1 - canopyAlpha) + canopyColor[2] * canopyAlpha) : mosaic.rgb[pixel + 2];
      rgba[output + 3] = 255;
    }
  }
  return rgba;
}

function canopyGridMask(mosaic, grid, center) {
  const [centerPxX, centerPxY] = worldPixel(center, mosaic.z);
  const mask = new Uint8Array(mosaic.width * mosaic.height);
  for (let y = 0; y < mosaic.height; y++) {
    for (let x = 0; x < mosaic.width; x++) {
      const localX = grid.cx + (mosaic.x0Px + x + 0.5 - centerPxX) * mosaic.mPerPx;
      const localY = grid.cy - (mosaic.y0Px + y + 0.5 - centerPxY) * mosaic.mPerPx;
      const col = Math.round((localX - grid.x0) / grid.cellM);
      const row = Math.round((localY - grid.y0) / grid.cellM);
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
      if (grid.values[row * grid.cols + col] >= 0.5) mask[y * mosaic.width + x] = 1;
    }
  }
  return mask;
}

async function framedEvidenceImage(imagePng, title, subtitle, options = {}) {
  const width = 1200;
  const height = 1200;
  const mapLeft = 80;
  const mapTop = 100;
  const mapSize = 1040;
  const titleSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:Arial,'Noto Sans KR',sans-serif;fill:#1f2937} .title{font-size:28px;font-weight:700} .subtitle{font-size:16px;fill:#52606d} .small{font-size:14px;fill:#52606d}</style><text class="title" x="${mapLeft}" y="38">${title}</text><text class="subtitle" x="${mapLeft}" y="65">${subtitle}</text>${options.legend ? `<rect x="920" y="20" width="18" height="18" rx="3" fill="#56d244"/><text class="small" x="946" y="35">수관 · ExG/Otsu</text>` : ""}<circle cx="600" cy="620" r="520" fill="none" stroke="#ffffff" stroke-width="3"/><circle cx="600" cy="620" r="5" fill="#ffffff" stroke="#1f2937" stroke-width="2"/><path d="M1128 175 l-12 25 h24 z" fill="#1f2937"/><text class="small" x="1119" y="218">N</text><path d="M956 1118 h130" stroke="#1f2937" stroke-width="4"/><path d="M956 1111 v14 M1086 1111 v14" stroke="#1f2937" stroke-width="2"/><text class="small" x="990" y="1142">200 m</text>${options.source ? `<text class="small" x="${mapLeft}" y="1172">${options.source}</text>` : ""}</svg>`;
  return sharp({ create: { width, height, channels: 4, background: { r: 247, g: 248, b: 250, alpha: 1 } } })
    .composite([
      { input: await sharp(imagePng).resize(mapSize, mapSize, { fit: "contain" }).png().toBuffer(), left: mapLeft, top: mapTop },
      { input: Buffer.from(titleSvg), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function renderRealSiteVisual(evidence, outputDir) {
  const { realCtx, canopy, t15Mosaic, t15Detection, elapsedMs } = evidence;
  mkdirSync(outputDir, { recursive: true });
  const rgba = circleOverlayRgba(t15Mosaic, canopyGridMask(t15Mosaic, canopy.grid, REAL_CENTER), REAL_CENTER, REAL_RADIUS_M);
  const aerialOverlay = await sharp(Buffer.from(rgba), { raw: { width: t15Mosaic.width, height: t15Mosaic.height, channels: 4 } }).png().toBuffer();
  const ours = await framedEvidenceImage(aerialOverlay, "우리 v2", "D10 수관 · 서울 강동구 아리수로 250 (고덕동 558) · 반경 800m", { legend: true, source: "VWorld Satellite · © VWorld(국토교통부) · z18 · 210/210 tiles" });
  const oursPath = join(outputDir, "d10-godeok-ours-1200.png");
  await sharp(ours).toFile(oursPath);

  const referencePath = "D:/V-coding/16-SiteAnalysis/.worktrees/v2-int/docs/design/sitedia-2026-10-01/panels-1-12.png";
  assert.ok(readFileSyncSafe(referencePath), `sitedia reference missing: ${referencePath}`);
  const referenceCrop = await sharp(referencePath).extract({ left: 355, top: 840, width: 185, height: 185 }).png().toBuffer();
  const referenceOut = join(outputDir, "d10-sitedia-panel10.png");
  await sharp(referenceCrop).toFile(referenceOut);
  const reference = await framedEvidenceImage(referenceCrop, "sitedia 캡처", "패널 10 · 수목 · 같은 중심·반경의 map window");
  const compare = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 247, g: 248, b: 250 } } })
    .composite([
      { input: ours, left: 0, top: 0 },
      { input: reference, left: 1200, top: 0 },
    ])
    .png()
    .toBuffer();
  const comparePath = join(outputDir, "d10-godeok-compare.png");
  await sharp(compare).toFile(comparePath);
  realCtx.close();
  console.log(`D10 visual ours: ${oursPath}`);
  console.log(`D10 visual reference: ${referenceOut}`);
  console.log(`D10 visual side-by-side: ${comparePath}`);
  console.log(`D10 visual source: direct z18 satelliteMosaic, ExG/Otsu mask; calculation ${elapsedMs.toFixed(1)} ms`);
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
  assert.equal(parsed.presentation.basemap, "Satellite");
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
  const realEvidence = await runRealSiteRegression();
  if (process.env.P4_VISUAL === "1") {
    assert.ok(realEvidence, "P4_VISUAL=1 requires published real-site regression inputs");
    await renderRealSiteVisual(realEvidence, process.env.P4_VISUAL_DIR ?? join(tmpdir(), "site-analysis-p4-t19"));
  } else {
    realEvidence?.realCtx.close();
  }
  console.log("✓ v2 D10 canopy and green-space tile");
} finally {
  await cleanup(cacheRoot);
  await cleanup(dataDir);
}

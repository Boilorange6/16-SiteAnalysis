import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { inflateRawSync } from "node:zlib";

import { buildEngineFixture, CENTER } from "./engine-fixture.mjs";
import { EngineContext } from "../../lib/v2/engine/context.ts";
import { RASTER_OFFSET, RASTER_SCALE, rawUtci, s04, UTCI_HOURS } from "../../lib/v2/tile/s04/engine.ts";
import { cacheEngineVersion, ENGINE_VERSION } from "../../lib/v2/engine/tiles/common.ts";
import { toTileView } from "../../lib/v2/ui/tile-view.ts";
import { encodeRaster } from "../../lib/v2/raster-store.ts";
import { toUtmk } from "../../lib/v2/crs.ts";
import { paintRgba } from "../../lib/v2/ui/raster-image.ts";
import { RASTER_STYLES } from "../../lib/v2/ui/map-layers.ts";

const SEASONS = ["spring", "summer", "autumn", "winter"];
const RADIUS_M = 800;
const ANALYSIS_ID = "fixture-s04";

function metric(tile, id) {
  return tile.metrics.find((item) => item.id === id);
}

function metricValue(tile, id) {
  const item = metric(tile, id);
  assert.ok(item, `metric ${id} is present`);
  return item.value;
}

function makeCanopy() {
  const [x, y] = toUtmk(CENTER);
  const ring = [
    [x - 28, y - 18],
    [x + 28, y - 18],
    [x + 28, y + 18],
    [x - 28, y + 18],
    [x - 28, y - 18],
  ];
  return {
    grid: { cx: x, cy: y, x0: x - RADIUS_M, y0: y - RADIUS_M, cellM: 2, cols: 801, rows: 801, values: new Float64Array(801 * 801) },
    polygons: [[ring]],
    coveragePct: 100,
    missingTiles: 0,
    totalTiles: 1,
  };
}

function makeWindReader(seasons = SEASONS, ratio = 1, partial = false, solidBlock = false) {
  const [x, y] = toUtmk(CENTER);
  const cols = partial ? 100 : 404;
  const rows = partial ? 100 : 404;
  const cellM = 4;
  const values = new Int16Array(cols * rows * 2);
  values[0] = Math.round(ratio * 1000);
  for (let index = 0; index < values.length; index += 2) {
    values[index] = Math.round(ratio * 1000);
    values[index + 1] = 0;
  }
  // solidBlock: a 6x6-cell (24 m) block that S03 marks solid (ratio exactly 0 + obstacle_height > 0), like its footprint halo.
  const obstacle = new Uint16Array(cols * rows);
  if (solidBlock) {
    for (let row = 190; row < 196; row += 1) {
      for (let col = 190; col < 196; col += 1) {
        values[(row * cols + col) * 2] = 0;
        obstacle[row * cols + col] = 300;
      }
    }
  }
  const encoded = encodeRaster({
    ref: {
      name: "fixture_wind",
      kind: "vector2",
      crs: "EPSG:5179",
      x0: x - (partial ? 200 : 808),
      y0: y - (partial ? 200 : 808),
      cellM,
      cols,
      rows,
      dtype: "i16",
      bands: 2,
      scale: 0.001,
      offset: 0,
      nodata: null,
      palette: "wind_ratio",
    },
    values,
  });
  const entries = new Map(
    seasons.map((season) => [
      `S03/wind_${season}_z06`,
      { ref: { ...encoded.ref, name: `wind_${season}_z06` }, values },
    ]),
  );
  if (solidBlock) entries.set("S03/obstacle_height", { ref: { ...encoded.ref, name: "obstacle_height", kind: "scalar", bands: 1, dtype: "u16", scale: 0.1, nodata: 0 }, values: obstacle });
  return (code, name) => entries.get(`${code}/${name}`) ?? null;
}

function makeContext(dataDir, reader, canopy = true) {
  const manifest = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8"));
  const context = new EngineContext(
    dataDir,
    manifest,
    ANALYSIS_ID,
    { address: "테스트 열쾌적", center: CENTER, radiusM: RADIUS_M, analysisDate: "2025-06-21", pnu: null },
    {},
    { rasterReader: reader },
  );
  if (canopy) {
    const value = makeCanopy();
    context.memo("canopy:polygons", () => value);
  }
  return context;
}

async function fixture(options) {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-s04-"));
  await buildEngineFixture(dataDir, "fixture-v1", {
    buildings: true,
    parcels: true,
    weather: true,
    ...options,
  });
  return dataDir;
}

function assertCategoryShare(tile, suffix) {
  const shares = tile.metrics
    .filter((item) => item.id.startsWith("share_utci_") && item.id.endsWith(suffix))
    .map((item) => item.value)
    .filter((value) => value !== null);
  assert.equal(shares.length, 11, "ten UTCI class shares plus out-of-range are present");
  const total = shares.reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 100) <= 1, `category shares sum to 100 (got ${total})`);
}

async function renderVisual(outDir, raster, raw, tile) {
  const sharp = (await import("sharp")).default;
  const width = 800;
  const map = paintRgba(raster.ref, new Uint8Array(raw), RASTER_STYLES.utci, width, width);
  const mapPng = await sharp(Buffer.from(map), { raw: { width, height: width, channels: 4 } }).png().toBuffer();
  const median = metricValue(tile, "utci_median_summer_h14");
  const shade = metricValue(tile, "shade_pct_summer_h14");
  const treeShade = metricValue(tile, "tree_shade_pct_summer_h14");
  const diff = metricValue(tile, "sun_shade_diff_c_summer_h14");
  const header = Buffer.from(`<svg width="${width}" height="190" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#101827"/><text x="34" y="48" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#F8FAFC">UTCI — 여름 14시 · 기온 · 습도 · 태양고도</text><text x="34" y="88" font-family="Arial,sans-serif" font-size="18" fill="#CBD5E1">UTCI 중앙값 ${median}°C  ·  그늘 ${shade}%  ·  수관 그늘 ${treeShade}%  ·  양지−그늘 ${diff}°C</text><text x="34" y="132" font-family="Arial,sans-serif" font-size="15" fill="#94A3B8">대표 기상 10년 중앙값 · S03 보행층 상대풍속 × 관측소 10 m · 수목 높이 8 m 가정</text><text x="34" y="164" font-family="Arial,sans-serif" font-size="13" fill="#CBD5E1">숫자는 자리끼리 비교 · 현장 측정이나 개인별 건강 위험 예측이 아님</text></svg>`);
  const panel = await sharp({ create: { width, height: width + 190, channels: 4, background: "#101827" } })
    .composite([{ input: header, top: 0, left: 0 }, { input: mapPng, top: 190, left: 0 }])
    .png()
    .toBuffer();
  const outPath = join(outDir, "s04-utci-summer14-synthetic.png");
  await sharp(panel).toFile(outPath);
  const benchmarkPath = join(process.cwd(), "docs", "design", "sitedia-2026-10-01", "utci-summer14.png");
  let comparisonPath = null;
  if (existsSync(benchmarkPath)) {
    const left = await sharp(panel).resize(800, 1000, { fit: "contain", background: "#FFFFFF" }).png().toBuffer();
    const right = await sharp(benchmarkPath).resize(800, 1000, { fit: "contain", background: "#FFFFFF" }).png().toBuffer();
    const labels = Buffer.from(`<svg width="1600" height="56" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#FFFFFF"/><text x="24" y="36" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#101827">우리 v2</text><text x="824" y="36" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#101827">sitedia 캡처</text></svg>`);
    comparisonPath = join(outDir, "s04-utci-summer14-compare.png");
    await sharp({ create: { width: 1600, height: 1056, channels: 4, background: "#FFFFFF" } }).composite([{ input: labels, top: 0, left: 0 }, { input: left, top: 56, left: 0 }, { input: right, top: 56, left: 800 }]).png().toFile(comparisonPath);
  }
  return { outPath, comparisonPath };
}

async function main() {
  let dataDir;
  try {
    dataDir = await fixture({});
    const normalContext = makeContext(dataDir, makeWindReader());
    const normalStarted = performance.now();
    const normal = s04(normalContext);
    const normalElapsedMs = performance.now() - normalStarted;
    console.log("S04 perf: radius " + RADIUS_M + "m / " + UTCI_HOURS.length + " hours x " + SEASONS.length + " seasons -> " + normalElapsedMs.toFixed(0) + " ms");
    const normalRasters = normalContext.takeRasters("S04");
    assert.equal(normalRasters.length, 12);
    const compressedBytes = normalRasters.reduce((sum, item) => sum + item.blob.length, 0);
    console.log("S04 raster compressed: " + compressedBytes + " bytes / 4194304 bytes");
    assert.ok(compressedBytes <= 4 * 1024 * 1024, "compressed rasters stay within 4MB");
    const normalSummerRaster = normalRasters.find((item) => item.ref.name === "utci_summer_h14");
    assert.ok(normalSummerRaster);
    const normalRaw = inflateRawSync(normalSummerRaster.blob);
    assert.ok(normalRaw.includes(254) && normalRaw.includes(255), "building and outside sentinels are retained");
    normalContext.close();
    assert.ok(normalElapsedMs <= 8000, "full synthetic run is within 8 seconds (" + normalElapsedMs.toFixed(1) + " ms)");
    assert.equal(normal.status, "complete");
    assert.equal(normal.conditions.simulation.model, "utci-bröde2012+tmrt-6dir@1");
    assert.deepEqual(normal.conditions.simulation.seasons, SEASONS);
    assert.equal(normal.conditions.simulation.hours.join(","), UTCI_HOURS.join(","));
    assert.equal(normal.conditions.simulation.treeHeightM, 8);
    assert.match(normal.limitations.map((item) => item.note).join(" "), /대표 기상|수목 높이/);
    assert.doesNotMatch(normal.judgment.sentence, /건강|위험|안전/);

    const summer14 = "_summer_h14";
    assert.ok(metricValue(normal, `utci_median${summer14}`) !== null);
    assert.ok(metricValue(normal, `utci_p90${summer14}`) !== null);
    assert.ok(metricValue(normal, `tree_shade_pct${summer14}`) > 0);
    assert.ok(metricValue(normal, `sun_shade_diff_c${summer14}`) >= 3);
    assert.equal(metricValue(normal, `input_ws10_ms${summer14}`), 2.2);
    assertCategoryShare(normal, summer14);

    assert.equal(normal.presentation.rasters.length, 12);
    assert.ok(normal.presentation.rasters.every((raster) => raster.cellM === 2));
    assert.ok(normal.presentation.rasters.every((raster) => raster.scale === 0.5 && raster.offset === -50 && raster.palette === "utci"));

    // Encoding: hot cells must not saturate; 253/254/255 never collide with data.
    assert.ok(Math.abs(rawUtci(40) * RASTER_SCALE + RASTER_OFFSET - 40) <= 0.5, "40 °C round-trips within 0.5 °C");
    for (const celsius of [-39.8, -13, 9, 26.3, 38.6, 46, 52.2]) assert.ok(Math.abs(rawUtci(celsius) * RASTER_SCALE + RASTER_OFFSET - celsius) <= 0.25 + 1e-9, `${celsius} °C round-trips`);
    assert.equal(rawUtci(500), 252, "values above the range clamp below the sentinels");
    assert.equal(rawUtci(-500), 0);
    for (let celsius = -60; celsius <= 90; celsius += 0.1) assert.ok(rawUtci(celsius) < 253, "data never reaches a sentinel byte");
    const decoded = [...normalRaw].filter((raw) => raw < 253).map((raw) => raw * RASTER_SCALE + RASTER_OFFSET).sort((a, b) => a - b);
    assert.ok(decoded[decoded.length - 1] > 30, "summer afternoon raster keeps hot values above the old 23 °C ceiling");
    const medianDecoded = decoded[Math.floor((decoded.length - 1) / 2)];
    assert.ok(Math.abs(medianDecoded - metricValue(normal, `utci_median${summer14}`)) <= 0.5, "raster median agrees with the reported median");

    // Cache: height-assumption consumers get a new per-tile key; the shared ENGINE_VERSION stays stable.
    assert.notEqual(cacheEngineVersion("S03"), ENGINE_VERSION);
    assert.ok(cacheEngineVersion("S03").startsWith(ENGINE_VERSION));
    assert.notEqual(cacheEngineVersion("S04"), ENGINE_VERSION);
    assert.ok(cacheEngineVersion("S04").startsWith(ENGINE_VERSION));

    // Palette: the standard ten classes are visibly separated in the hot range.
    const style = RASTER_STYLES.utci;
    for (const classBreak of [-40, -27, -13, 0, 9, 26, 32, 38, 46]) assert.ok(style.breaks.includes(classBreak), `standard class boundary ${classBreak} is a palette break`);
    assert.equal(style.colors.length, style.breaks.length + 1);
    assert.equal(style.legendLabels.length, 10, "ten Korean class names");
    assert.equal(new Set(style.colors).size, style.colors.length, "every step has its own color");
    const swatch = (celsius) => {
      const rawOne = new Uint8Array([rawUtci(celsius)]);
      return [...paintRgba({ ...normal.presentation.rasters[0], cols: 1, rows: 1 }, rawOne, style)].join(",");
    };
    assert.equal(new Set([27, 33, 40, 48].map(swatch)).size, 4, "26/32/38/46 classes paint four distinct colors");
    assert.notEqual(swatch(33.2), swatch(35.1), "shaded (33.2) and sunlit (35.1) cells of the same class are visibly different");
    assert.notEqual(swatch(31), swatch(33), "adjacent classes differ");
    const sentinel = (raw) => [...paintRgba({ ...normal.presentation.rasters[0], cols: 1, rows: 1 }, new Uint8Array([raw]), style)].join(",");
    assert.equal(sentinel(255).split(",")[3], "0", "outside is transparent");
    assert.notEqual(sentinel(253), sentinel(rawUtci(48)), "out-of-range wind is not painted as extreme heat");
    const block = paintRgba({ ...normal.presentation.rasters[0], cols: 3, rows: 3 }, new Uint8Array(9).fill(254), style);
    assert.equal([...block.slice(16, 20)].join(","), "248,250,252,255", "building interior is a white footprint (edge cells are outlined)");

    // Display: representative cut drives the headline and default raster, numbers are rounded.
    const view = toTileView(normal);
    assert.equal(view.headline.label, "UTCI 중앙값 · 여름 14시");
    assert.match(view.headline.value, /^-?\d+\.\d°C$/);
    assert.equal(view.headline.value, `${metricValue(normal, `utci_median${summer14}`).toFixed(1)}°C`);
    assert.equal(view.map.rasters[0].name, "utci_summer_h14");
    assert.equal(view.map.rasterOptions.length, 12, "the other eleven cuts stay selectable");
    assert.ok(!view.map.notes.includes("반경 안 표시할 지물 없음"));
    assert.ok(view.rows.every((row) => !/\d\.\d{2,}/.test(row.value)), "no long decimals in rows");
    assert.ok(view.rows.some((row) => row.label === "봄 10시 대표 기상 운량" && row.value === "5/10") || view.rows.some((row) => /대표 기상 운량$/.test(row.label) && /\/10$/.test(row.value)));
    assert.ok(view.rows.every((row) => !/대표 기상 \d+시간 중앙값|10분위/.test(row.label + row.value)));

    const partialDir = await fixture({});
    try {
      const partialContext = makeContext(partialDir, makeWindReader(["summer"]));
      const partial = s04(partialContext);
      partialContext.close();
      assert.equal(partial.status, "partial");
      assert.deepEqual(partial.conditions.simulation.seasons, ["summer"]);
      assert.equal(partial.presentation.rasters.length, 3);
      assert.match(partial.limitations.map((item) => item.note).join(" "), /spring|autumn|winter/);
    } finally {
      rmSync(partialDir, { recursive: true, force: true });
    }

    const pendingDir = await fixture({});
    try {
      const pendingContext = makeContext(pendingDir, makeWindReader([]));
      const pending = s04(pendingContext);
      pendingContext.close();
      assert.equal(pending.status, "pending");
      assert.equal(pending.presentation.rasters.length, 0);
    } finally {
      rmSync(pendingDir, { recursive: true, force: true });
    }

    const calmDir = await fixture({ weather: "calm" });
    try {
      const calmContext = makeContext(calmDir, makeWindReader());
      const calm = s04(calmContext);
      const calmRasters = calmContext.takeRasters("S04");
      const calmSummer = inflateRawSync(calmRasters.find((item) => item.ref.name === "utci_summer_h14").blob);
      assert.ok(!calmSummer.includes(253), "calm cells are computed at the 0.5 m/s floor, not dropped");
      calmContext.close();
      assert.equal(calm.status, "complete");
      assert.equal(metricValue(calm, "share_wind_clamped_low_pct"), 100, "all cells were clamped up to 0.5 m/s");
      assert.equal(metricValue(calm, "share_wind_clamped_high_pct"), 0);
      assert.equal(metricValue(calm, "share_out_of_range_pct"), 0);
      assert.ok(metric(calm, "utci_median_summer_h14").value !== null && metric(calm, "utci_p90_summer_h14").value !== null);
      assert.ok(calm.limitations.some((item) => item.note.includes("바람 0.5 m/s 미만 100%는 0.5 m/s로 계산")), "clamp limitation note");
      // UTCI at the floor equals UTCI at exactly 0.5 m/s.
      const floorRef = s04(makeContext(calmDir, makeWindReader(SEASONS, 0.5 / metricValue(calm, "input_ws10_ms_summer_h14"))));
      assert.equal(metricValue(floorRef, "utci_median_summer_h14"), metricValue(calm, "utci_median_summer_h14"));
      // Genuinely missing wind input (no S03 layer for the cell grid) keeps the grey sentinel.
      const partialContext = makeContext(calmDir, makeWindReader(SEASONS, 1, true));
      const partialWind = s04(partialContext);
      const partialSummer = inflateRawSync(partialContext.takeRasters("S04").find((item) => item.ref.name === "utci_summer_h14").blob);
      partialContext.close();
      assert.ok(partialSummer.includes(253), "cells outside the S03 wind grid keep the missing-input sentinel");
      const missingShare = metricValue(partialWind, "share_out_of_range_pct");
      assert.ok(missingShare > 0 && missingShare < 100, `partial wind coverage (${missingShare}%)`);
      assert.ok(metricValue(partialWind, "utci_median_summer_h14") !== null);
    } finally {
      rmSync(calmDir, { recursive: true, force: true });
    }

    // S03 solid cells that S04 does not draw as buildings (4 m footprint halo) take the nearest open-ground wind.
    const haloDir = await fixture({});
    try {
      const haloContext = makeContext(haloDir, makeWindReader(SEASONS, 1, false, true));
      const halo = s04(haloContext);
      haloContext.close();
      assert.equal(metricValue(halo, "share_wind_clamped_low_pct"), 0, "solid-halo cells are not read as calm");
      assert.equal(metricValue(halo, "share_out_of_range_pct"), 0);
    } finally {
      rmSync(haloDir, { recursive: true, force: true });
    }

    const legacyDir = await fixture({ weather: "legacy" });
    try {
      const legacyContext = makeContext(legacyDir, makeWindReader());
      const legacy = s04(legacyContext);
      legacyContext.close();
      assert.equal(legacy.status, "not_provided");
      assert.ok(legacy.limitations.some((item) => item.note === "계절·시각별 대표 기상 자료를 확인하지 못했습니다."));
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }

    assert.ok(normal.presentation.rasters.length > 0);
    if (process.env.S04_VISUAL_OUT) {
      const visual = await renderVisual(process.env.S04_VISUAL_OUT, normalSummerRaster, normalRaw, normal);
      console.log(`S04 visual: ${visual.outPath}${visual.comparisonPath ? `; compare: ${visual.comparisonPath}` : ""}`);
    }
    console.log("✓ v2 S04 UTCI tile");
  } finally {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  }
}

await main();

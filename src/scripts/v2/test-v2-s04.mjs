import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { inflateRawSync } from "node:zlib";

import { buildEngineFixture, CENTER } from "./engine-fixture.mjs";
import { EngineContext } from "../../lib/v2/engine/context.ts";
import { s04, UTCI_HOURS } from "../../lib/v2/engine/tiles/s04.ts";
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

function makeWindReader(seasons = SEASONS, ratio = 1) {
  const [x, y] = toUtmk(CENTER);
  const cols = 404;
  const rows = 404;
  const cellM = 4;
  const values = new Int16Array(cols * rows * 2);
  values[0] = Math.round(ratio * 1000);
  for (let index = 0; index < values.length; index += 2) {
    values[index] = Math.round(ratio * 1000);
    values[index + 1] = 0;
  }
  const encoded = encodeRaster({
    ref: {
      name: "fixture_wind",
      kind: "vector2",
      crs: "EPSG:5179",
      x0: x - 808,
      y0: y - 808,
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
  assert.equal(shares.length, 10, "ten UTCI category shares are present");
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
    assert.ok(normal.presentation.rasters.every((raster) => raster.scale === 0.25 && raster.offset === -40));

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
      assert.ok(calmRasters.some((item) => inflateRawSync(item.blob).includes(253)), "calm wind cells use the out-of-range sentinel");
      calmContext.close();
      assert.equal(calm.status, "partial");
      assert.equal(metricValue(calm, "share_out_of_range_pct"), 100);
      assert.equal(metric(calm, "utci_median_summer_h14").value, null);
      assert.equal(metric(calm, "utci_p90_summer_h14").value, null);
      assert.doesNotMatch(readFileSync(new URL("../../lib/v2/engine/tiles/s04.ts", import.meta.url), "utf8"), /Math\.(?:min|max)\([^)]*(?:0\.5|17)/);
    } finally {
      rmSync(calmDir, { recursive: true, force: true });
    }

    const legacyDir = await fixture({ weather: "legacy" });
    try {
      const legacyContext = makeContext(legacyDir, makeWindReader());
      const legacy = s04(legacyContext);
      legacyContext.close();
      assert.equal(legacy.status, "not_provided");
      assert.ok(legacy.limitations.some((item) => item.note === "계절×시각 대표 기상 미적재 — weather 재빌드 필요"));
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

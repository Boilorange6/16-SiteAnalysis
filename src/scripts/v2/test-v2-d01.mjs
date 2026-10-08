/** P4 T20 D01 항공사진 결과 계약·고정 배경·화면 렌더 회귀. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;

const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d01, VWORLD_WMTS_SOURCE } = await import("../../lib/v2/tile/d01/engine.ts");
const { MAX_Z } = await import("../../lib/v2/tiles.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView, sourceLineOf } = await import("../../lib/v2/ui/tile-view.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");

const manifest = { version: "v1", createdAt: "2026-10-01T00:00:00Z", files: {} };
const ctx = new EngineContext(".", manifest, "d01-test", {
  address: "서울특별시 강동구 고덕동 250",
  center: [127.15, 37.55],
  radiusM: 800,
  analysisDate: "2026-10-01",
  pnu: null,
});

try {
  const started = performance.now();
  const tile = parseTileResult(d01(ctx));
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 1_500, `D01 경량 타일 ${elapsedMs.toFixed(1)} ms`);
  console.log(`D01 perf: ${elapsedMs.toFixed(1)} ms (POST 경량 타일 예산 1500 ms)`);
  assert.equal(tile.tileCode, "D01");
  assert.equal(tile.tileType, "diagram");
  assert.equal(tile.status, "complete");
  assert.equal(tile.presentation.basemap, "Satellite", "D01은 보드 배경 선택과 관계없이 항공사진을 고정");

  const zoom = tile.metrics.find((metric) => metric.id === "imagery_zoom_max");
  assert.ok(zoom, "최대 WMTS 줌 지표");
  assert.deepEqual({ value: zoom.value, unit: zoom.unit, status: zoom.status }, { value: MAX_Z, unit: "z", status: "observed" });

  const captureDate = tile.metrics.find((metric) => metric.id === "imagery_capture_date");
  assert.ok(captureDate, "촬영시기 지표를 생략하지 않고 미확인으로 보존");
  assert.deepEqual({ value: captureDate.value, status: captureDate.status }, { value: null, status: "missing" });

  assert.deepEqual(tile.provenance.sources, [VWORLD_WMTS_SOURCE]);
  assert.match(tile.limitations.map((item) => item.note).join(" "), /촬영시기 미확인/);
  assert.match(tile.judgment?.sentence ?? "", /VWorld/);
  assert.doesNotMatch(JSON.stringify(tile), /종합|법적 적합|개발 가능|건강 위험 예측/);

  const view = toTileView(tile);
  assert.ok(view.map, "고정 배경만 있는 D01도 지도 모델을 만든다");
  assert.equal(view.map.basemap, "Satellite");
  assert.match(sourceLineOf(tile.provenance.sources), /VWorld 항공영상\(WMTS\).*기준일 미확인/);

  const svg = renderToStaticMarkup(createElement(MapFigure, {
    model: view.map,
    width: 1200,
    height: 800,
    fixed: true,
    layer: "white",
  }));
  assert.ok((svg.match(/tiles\/Satellite\//g) ?? []).length > 0, "D01 SVG는 Satellite WMTS 타일을 요청한다");
  assert.ok((svg.match(/tiles\/Hybrid\//g) ?? []).length > 0, "항공 배경의 Hybrid 라벨 레이어");
  assert.match(svg, /© VWorld\(국토교통부\)/);

  if (process.env.P4_VISUAL === "1") {
    const mainRoot = "D:/V-coding/16-SiteAnalysis";
    const requireMain = createRequire(`${mainRoot}/package.json`);
    const sharp = requireMain(`${mainRoot}/node_modules/sharp`);
    const visualDir = process.env.P4_VISUAL_DIR ?? join(tmpdir(), "site-analysis-p4-t20");
    mkdirSync(visualDir, { recursive: true });
    const tileRgb = Buffer.alloc(256 * 256 * 3);
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 256; x += 1) {
        const index = (y * 256 + x) * 3;
        const block = ((Math.floor(x / 32) + Math.floor(y / 32)) % 2) === 0;
        tileRgb[index] = block ? 104 : 125;
        tileRgb[index + 1] = block ? 132 : 146;
        tileRgb[index + 2] = block ? 103 : 118;
        if (Math.abs(x - 128) < 3 || Math.abs(y - 128) < 3) {
          tileRgb[index] = 176;
          tileRgb[index + 1] = 163;
          tileRgb[index + 2] = 128;
        }
      }
    }
    const tilePng = await sharp(tileRgb, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
    const imageHref = `data:image/png;base64,${tilePng.toString("base64")}`;
    const visualSvg = renderToStaticMarkup(createElement(MapFigure, {
      model: view.map,
      width: 1200,
      height: 800,
      fixed: true,
      layer: "white",
      tileHref: () => imageHref,
      label: "D01 항공사진 합성 WMTS 시각 인수",
    }));
    const visualPath = join(visualDir, "d01-compare.png");
    await sharp(Buffer.from(visualSvg)).png().toFile(visualPath);
    console.log(`D01 visual: ${visualPath}`);
  }

  console.log("✓ v2 D01 aerial-photo tile");
} finally {
  ctx.close();
}

/** 지도 중심 타일: 투영·타일 목록·축척, features 상한·결정성·highlight, 레이어·범례 매핑, 기존 결과 호환, SVG 렌더. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

globalThis.React = React; // tsx는 tsconfig(jsx: preserve) 때문에 클래식 JSX 변환을 쓴다

const P = await import("../../lib/v2/ui/map-projection.ts");
const { layerStyle, LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
const { capFeatures } = await import("../../lib/v2/engine/tiles/common.ts");
const { MAX_MAP_FEATURES, parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView, toSummaryView } = await import("../../lib/v2/ui/tile-view.ts");
const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a01 } = await import("../../lib/v2/engine/tiles/a01.ts");
const { a03 } = await import("../../lib/v2/engine/tiles/a03.ts");
const { a04 } = await import("../../lib/v2/engine/tiles/a04.ts");
const { a05 } = await import("../../lib/v2/engine/tiles/a05.ts");
const { a06 } = await import("../../lib/v2/engine/tiles/a06.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ── 투영: 반경 원 지름 = 그림 높이의 80% ──
{
  const H = 500;
  for (const [lat, radiusM] of [[37.55, 500], [37.55, 3000], [35.1, 1000]]) {
    const vp = P.viewportFor([127.1, lat], radiusM, 800, H);
    const px = radiusM / P.metersPerPixel(lat, vp.zoom);
    near(px * 2, H * 0.8, 1e-6);
  }
  const vp = P.viewportFor([127.1546, 37.5556], 1000, 800, 500);
  const [x, y] = P.makeProjector(vp)(127.1546, 37.5556);
  near(x, 400, 1e-6);
  near(y, 250, 1e-6);
  // 동쪽 1000m 지점은 원 반지름만큼 오른쪽
  const dLng = 1000 / (111320 * Math.cos((37.5556 * Math.PI) / 180));
  const [ex] = P.makeProjector(vp)(127.1546 + dLng, 37.5556);
  near(ex - 400, 1000 / P.metersPerPixel(37.5556, vp.zoom), 0.5);
  assert.ok(P.zoomForRadius(37.5, 500, 500) > P.zoomForRadius(37.5, 3000, 500), "반경이 작을수록 더 확대");
}

// ── 타일 목록: 그림을 빈틈없이 덮고 개수가 작다 ──
{
  const vp = P.viewportFor([127.1546, 37.5556], 1000, 800, 500);
  const tiles = P.tilesFor(vp);
  assert.ok(tiles.length >= 4 && tiles.length <= 30, `tiles ${tiles.length}`);
  const minL = Math.min(...tiles.map((t) => t.left));
  const minT = Math.min(...tiles.map((t) => t.top));
  const maxR = Math.max(...tiles.map((t) => t.left + t.size));
  const maxB = Math.max(...tiles.map((t) => t.top + t.size));
  assert.ok(minL <= 0 && minT <= 0 && maxR >= 800 && maxB >= 500, "덮음");
  assert.equal(new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size, tiles.length, "중복 없음");
  assert.match(P.tileUrl(tiles[0]), /^https:\/\/[abc]\.tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
}

// ── 축척 막대: 1·2·5×10ⁿ m ──
{
  for (const [mpp, maxPx] of [[1, 100], [2.3, 90], [7, 88], [0.4, 120], [30, 100]]) {
    const b = P.scaleBar(mpp, maxPx);
    assert.match(String(b.meters), /^[125]0*$/, `${b.meters}`);
    assert.ok(b.px <= maxPx && b.px > maxPx / 5, `${b.px}`);
  }
  assert.equal(P.scaleBar(1, 100).label, "100m");
  assert.equal(P.scaleBar(20, 100).label, "2km");
}

// ── features 상한: 결정적 · highlight 포함 · 전체 개수 ──
{
  const items = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, f: { layer: "store:other", lng: 127 + i / 1e5, lat: 37.5, weight: null } }));
  items[1234].f.highlight = true;
  items[4321].f.highlight = true;
  const a = capFeatures(items);
  assert.equal(a.features.length, MAX_MAP_FEATURES);
  assert.equal(a.total, 5000);
  assert.equal(a.features.filter((f) => f.highlight).length, 2);
  const b = capFeatures([...items].reverse());
  assert.deepEqual(b.features, a.features, "입력 순서와 무관");
  const small = capFeatures(items.slice(0, 10));
  assert.equal(small.features.length, 10);
  assert.equal(small.total, 10);
  // 등간격: 고른 id가 전 구간에 퍼져 있다
  const ids = a.features.filter((f) => !f.highlight).map((f) => Math.round((f.lng - 127) * 1e5) + 1);
  assert.ok(ids[0] <= 3 && ids.at(-1) >= 4990);
}

// ── 레이어·범례 매핑 ──
{
  for (const k of Object.keys(LAYER_STYLES)) assert.match(layerStyle(k).color, /^#[0-9A-Fa-f]{6}$/);
  assert.equal(layerStyle("nope").label, "기타");
  assert.equal(layerStyle("bus_stop").label, "버스정류장");
}

// ── 엔진 타일: features 계약 ──
{
  const dataDir = mkdtempSync(join(tmpdir(), "v2-map-"));
  await buildEngineFixture(dataDir, "v1");
  const manifest = M.readManifest(dataDir);
  const ctx = new EngineContext(dataDir, manifest, "an-1", { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
  const inRing = (f) => {
    const dx = (f.lng - CENTER[0]) * 111320 * Math.cos((CENTER[1] * Math.PI) / 180);
    const dy = (f.lat - CENTER[1]) * 111320;
    return Math.hypot(dx, dy);
  };
  for (const [name, fn] of [["A01", a01], ["A03", a03], ["A04", a04], ["A05", a05], ["A06", a06]]) {
    const t = parseTileResult(fn(ctx));
    const feats = t.presentation.features;
    assert.ok(Array.isArray(feats), `${name} features`);
    assert.equal(t.presentation.featuresTotal, feats.length, `${name} total`);
    assert.ok(feats.length <= MAX_MAP_FEATURES);
    for (const f of feats) assert.ok(inRing(f) <= 800 * 1.02, `${name}: 반경 안 WGS84 좌표 (${inRing(f)}m)`);
    // 범례는 그림에 실제로 있는 레이어의 라벨
    const layers = [...new Set(feats.map((f) => f.layer))];
    assert.deepEqual(t.presentation.legend.map((l) => l.label), layers.map((l) => layerStyle(l).label), `${name} legend`);
    for (const l of layers) assert.notEqual(layerStyle(l).label, "기타", `${name}: 스타일 없는 레이어 ${l}`);
    // 화면 모델
    const v = toTileView(t);
    assert.ok(v.map, `${name} map model`);
    assert.equal(v.map.features.length, feats.length);
  }
  const t01 = a01(ctx);
  const nb = t01.presentation.features.filter((f) => f.layer === "bus_nearest");
  assert.equal(nb.length, 1);
  assert.equal(nb[0].highlight, true);
  assert.equal(nb[0].label, `직선 ${t01.metrics.find((m) => m.id === "nearest_bus_m").value}m`);
  assert.equal(t01.presentation.features.filter((f) => f.layer === "bus_stop").length, t01.metrics.find((m) => m.id === "bus_stops").value - 1);
  assert.ok(toTileView(t01).map.notes.some((n) => n.includes("철도")));
  const t03 = a03(ctx);
  for (const f of t03.presentation.features) assert.match(f.layer, /^store:/);
  assert.equal(t03.presentation.featuresTotal, t03.metrics.find((m) => m.id === "stores").value);
  assert.ok(toTileView(a04(ctx)).map.notes.some((n) => n.includes("경계 아님")));
  assert.ok(toTileView(a06(ctx)).map.notes.some((n) => n.includes("중복 가능")));
  // 결정성: 두 번 계산해도 같은 features
  assert.deepEqual(a03(ctx).presentation.features, t03.presentation.features);
  ctx.close();
}

// ── 기존 결과(features 없음)와 호환 ──
{
  const old = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "A05"));
  delete old.presentation.features;
  delete old.presentation.featuresTotal;
  parseTileResult(old);
  const v = toTileView(old);
  assert.deepEqual(v.map.features, []);
  assert.ok(v.map.notes.some((n) => n.includes("표시할 지물 없음")));
  // 지도 타일이 아니거나 결과가 없으면 지도 없음
  assert.equal(toTileView(GODEOK_RESULTS.find((r) => r.tileCode === "A07")).map, null);
  assert.equal(toTileView(GODEOK_RESULTS.find((r) => r.tileCode === "S02")).map, null);
}

// ── 예시(고덕동) 보드는 지도 타일이 그림을 갖는다 ──
{
  for (const code of ["A01", "A03", "A04", "A05", "A06"]) {
    const r = GODEOK_RESULTS.find((x) => x.tileCode === code);
    parseTileResult(r);
    assert.ok(r.presentation.features.length > 0, code);
    assert.ok(toTileView(r).map.features.length > 0);
  }
  assert.ok(toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS).map);
}

// ── SVG 렌더: 배경 타일·반경 원·대지·범례·축척·북쪽·저작권 ──
{
  const r = GODEOK_RESULTS.find((x) => x.tileCode === "A01");
  const model = toTileView(r).map;
  const html = renderToStaticMarkup(createElement(MapFigure, { model, width: 640, height: 360, fixed: true }));
  assert.match(html, /^<svg /);
  assert.ok((html.match(/<image /g) ?? []).length >= 4, "배경 타일");
  assert.match(html, /\.tile\.openstreetmap\.org/);
  assert.match(html, /© OpenStreetMap contributors/);
  assert.match(html, /직선 210m/);
  assert.match(html, /버스정류장/);
  assert.match(html, />N</);
  assert.match(html, /500m|1km|2km|200m|100m/);
  const none = renderToStaticMarkup(createElement(MapFigure, { model, width: 640, height: 360, basemap: "none" }));
  assert.ok(!/<image /.test(none) && /<line /.test(none), "배경 없이 격자");
  const inlined = renderToStaticMarkup(createElement(MapFigure, { model, width: 640, height: 360, tileHref: () => "data:image/png;base64,AAAA" }));
  assert.ok(!inlined.includes("tile.openstreetmap.org/") && inlined.includes("data:image/png"));
  const bare = renderToStaticMarkup(createElement(MapFigure, { model: toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS).map, width: 640, height: 360, bare: true }));
  assert.ok(!bare.includes("버스정류장"));
}

// ── PPT: 지도 이미지 자리 ──
{
  const JSZip = (await import("jszip")).default;
  const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
  const { buildReportPlan, mapKeyOf } = await import("../../lib/v2/report/report-plan.ts");
  const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
  const plan = buildReportPlan({
    summary: toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS),
    views: new Map(GODEOK_RESULTS.map((r) => [r.tileId, toTileView(r)])),
    board: initBoard(GODEOK_RESULTS),
    analysisDate: "2026-09-30",
  });
  const keys = plan.map(mapKeyOf).filter(Boolean);
  assert.deepEqual(keys, ["cover", "t-A01", "t-A03", "t-A04", "t-A05", "t-A06"], "지도 자리: 표지 + 지도 타일 5장");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const withImg = await JSZip.loadAsync(await renderReportPptx(plan, Object.fromEntries(keys.map((k) => [k, png]))));
  assert.equal(Object.keys(withImg.files).filter((n) => /^ppt\/media\/.+/.test(n)).length, keys.length, "지도 이미지가 슬라이드마다 들어감");
  const noImg = await JSZip.loadAsync(await renderReportPptx(plan)); // 이미지 없음: 자리표시 사각형 + 문구
  assert.equal(Object.keys(noImg.files).filter((n) => /^ppt\/media\/.+/.test(n)).length, 0);
  const slide2 = await noImg.file("ppt/slides/slide2.xml").async("string");
  assert.match(slide2, /지도 이미지를 만들지 못했습니다/);
}

console.log("v2 map tests passed");

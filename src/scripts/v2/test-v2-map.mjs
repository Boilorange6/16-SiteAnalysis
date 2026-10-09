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
const { a01 } = await import("../../lib/v2/tile/a01/engine.ts");
const { a03 } = await import("../../lib/v2/tile/a03/engine.ts");
const { a04 } = await import("../../lib/v2/tile/a04/engine.ts");
const { a05 } = await import("../../lib/v2/tile/a05/engine.ts");
const { a06 } = await import("../../lib/v2/tile/a06/engine.ts");
const { default: MapFigure, mapFeatureKey, mapLabelEntries, mapLabelText } = await import("../../components/v2/map-figure.tsx");

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
  const oneCell = P.viewportFor([127.1, 37.55], 800, 336, 196);
  const fourCell = P.viewportFor([127.1, 37.55], 800, 672, 492);
  assert.ok(fourCell.zoom > oneCell.zoom, "4칸 지도는 실측 높이에 맞춰 더 확대");
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
  assert.match(P.tileUrl("white", tiles[0].z, tiles[0].x, tiles[0].y), /^\/site\/api\/v2\/tiles\/white\/\d+\/\d+\/\d+$/);
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

// ── 요소 라벨 문구: 사용자 의미만 표시하고 도형 종류를 노출하지 않는다 ──
{
  const namedBuilding = mapLabelText("bldg_1980s", "polygon", { layer: "bldg_1980s", rings: [], label: "고덕 그라시움 104동" });
   assert.equal(namedBuilding, "고덕 그라시움 104동");
   assert.equal(mapLabelText("bldg_unknown", "polygon", { layer: "bldg_unknown", rings: [], label: null }), "미상");
   assert.equal(mapLabelText("bldg_unknown", "polygon", { layer: "bldg_unknown", rings: [], label: "미상" }), "미상");
  assert.equal(mapLabelText("bus_stop", "feature", { layer: "bus_stop", lng: 127, lat: 37, name: null }), "버스정류장");
  assert.equal(mapLabelText("bus_nearest", "feature", { layer: "bus_nearest", lng: 127, lat: 37, name: "고덕역 정류장", distanceM: 480 }), "고덕역 정류장 · 직선 480m");
  assert.equal(mapLabelText("contour", "line", { layer: "contour", points: [], label: null }), "등고선");
   for (const text of [namedBuilding, "미상", "버스정류장", "고덕역 정류장 · 직선 480m", "등고선"]) {
    assert.doesNotMatch(text, / · (점|면|선)$/);
  }
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
  assert.equal(nb[0].sublabel, `직선 ${t01.metrics.find((m) => m.id === "nearest_bus_m").value}m`);
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

// ── 기존 결과(features 없음)는 지도 없이 안전하게 표시 ──
{
  const old = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "A05"));
  delete old.presentation.features;
  delete old.presentation.featuresTotal;
  parseTileResult(old);
  const v = toTileView(old);
  assert.equal(v.map, null);
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
  const model = {
    ...toTileView(r).map,
    features: [...toTileView(r).map.features, { layer: "bus_nearest", lng: toTileView(r).map.center[0] + 0.003, lat: toTileView(r).map.center[1] + 0.002, name: "최근접 정류장", sublabel: "직선 340m", labelPriority: 2, highlight: true, distanceM: 340 }],
  };
  const html = renderToStaticMarkup(createElement(MapFigure, { model, width: 640, height: 360, fixed: true, pinnedKeys: [mapFeatureKey("bus_nearest", undefined, model.features.length - 1)], onFeaturePin: () => {} }));
  assert.match(html, /^<svg /);
  assert.ok((html.match(/<image /g) ?? []).length >= 4, "배경 타일");
  assert.match(html, /\/site\/api\/v2\/tiles\/white\//);
  assert.ok(!/openstreetmap|api\.vworld\.kr/.test(html), "바깥 주소 없음");
  assert.match(html, /© VWorld\(국토교통부\)/);
  const sat = renderToStaticMarkup(createElement(MapFigure, { model, width: 640, height: 360, layer: "Satellite" }));
  assert.ok(/tiles\/Satellite\//.test(sat) && /tiles\/Hybrid\//.test(sat), "항공 = 위성 + 글자");
  assert.match(html, /직선 340m/);
  assert.match(html, /버스정류장/);
  assert.match(html, />N</);
  assert.match(html, /500m|1km|2km|200m|100m/);
  const none = renderToStaticMarkup(createElement(MapFigure, { model, width: 640, height: 360, basemap: "none" }));
  assert.ok(!/<image /.test(none) && /<line /.test(none), "배경 없이 격자");
  const inlined = renderToStaticMarkup(createElement(MapFigure, { model, width: 640, height: 360, tileHref: () => "data:image/png;base64,AAAA" }));
  assert.ok(!inlined.includes("/api/v2/tiles/") && inlined.includes("data:image/png"));
  const bare = renderToStaticMarkup(createElement(MapFigure, { model: toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS).map, width: 640, height: 360, bare: true }));
  assert.ok(!bare.includes("버스정류장"));

  // W2a: 범례 라벨 기준 강조는 같은 라벨의 여러 레이어를 함께 남기고, 나머지를 20%로 흐린다.
  const highlightModel = {
    ...model,
    features: [
      { layer: "maint_zone", lng: model.center[0], lat: model.center[1], name: "정비구역 A" },
      { layer: "maint_zone_center", lng: model.center[0] + 0.002, lat: model.center[1], name: "정비구역 B" },
      { layer: "bus_stop", lng: model.center[0] - 0.002, lat: model.center[1], name: "버스정류장" },
    ],
    total: 3,
  };
  const highlighted = renderToStaticMarkup(createElement(MapFigure, { model: highlightModel, width: 640, height: 360, basemap: "none", highlightLabel: "정비구역" }));
  assert.equal((highlighted.match(/stroke="#16181d"/g) ?? []).length >= 2, true, "같은 범례 라벨의 두 레이어 강조");
  assert.ok((highlighted.match(/opacity="0\.2"/g) ?? []).length >= 1, "나머지 요소 20% 흐림");

  // W2a: fid 없는 요소는 원본 배열 index 키를 쓰고, 고정 라벨은 겹침 검사 뒤 자리를 바꾼다.
  const collisionModel = {
    ...model,
    features: [
      { layer: "bus_stop", lng: model.center[0], lat: model.center[1], name: "정류장 A" },
      { layer: "bus_stop", lng: model.center[0], lat: model.center[1], name: "정류장 B" },
    ],
    total: 2,
  };
  const entries = mapLabelEntries(collisionModel);
  assert.deepEqual(entries.slice(0, 2).map((entry) => entry.key), [mapFeatureKey("bus_stop", undefined, 0), mapFeatureKey("bus_stop", undefined, 1)]);
  const pinned = renderToStaticMarkup(createElement(MapFigure, { model: collisionModel, width: 640, height: 360, basemap: "none", pinnedKeys: entries.slice(0, 2).map((entry) => entry.key), onFeaturePin: () => {} }));
  assert.match(pinned, /data-map-feature="bus_stop\|0"/);
  assert.match(pinned, /data-map-feature="bus_stop\|1"/);
  const fixedXs = [...pinned.matchAll(/<rect x="([^"]+)" y="[^"]+" width="[^"]+" height="[^"]+" rx="[^"]+" fill="#fff" stroke="#111"/g)].map((match) => match[1]);
  assert.ok(fixedXs.length >= 2 && fixedXs[0] !== fixedXs[1], "겹친 고정 라벨을 다른 후보 위치에 배치");

  // 대표 점과 폴리곤이 같은 fid를 받아도 목록의 고정 대상은 서로 달라야 한다.
  const sameFidModel = {
    ...model,
    features: [{ layer: "bldg_1990s", fid: "same-building", lng: model.center[0], lat: model.center[1], name: null }],
    polygons: [{ layer: "bldg_1990s", fid: "same-building", rings: [[[model.center[0], model.center[1]], [model.center[0] + 0.001, model.center[1]], [model.center[0], model.center[1] + 0.001]]] }],
    total: 2,
  };
  const sameFidEntries = mapLabelEntries(sameFidModel);
  assert.equal(new Set(sameFidEntries.map((entry) => entry.key)).size, sameFidEntries.length, "대표 점·폴리곤 키 충돌 없음");
  assert.match(sameFidEntries[0].key, /^bldg_1990s\\|same-building$/);
  assert.match(sameFidEntries[1].key, /^polygon\\|bldg_1990s\\|same-building$/);
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
  // 몰입형: 모든 장이 전면 지도 (표지·타일 전부·출처 장은 표지 지도를 흐리게 다시 쓴다)
  assert.deepEqual(keys, ["cover", "t-A01", "t-A02", "t-A03", "t-A04", "t-A05", "t-A05:cp", "t-A06", "t-A06:cp", "t-A07", "t-A09", "t-A12", "t-D04", "cover"], "지도 자리: 표지 + 타일 전부 + 출처 장");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const withImg = await JSZip.loadAsync(await renderReportPptx(plan, Object.fromEntries(keys.map((k) => [k, png]))));
  assert.equal(Object.keys(withImg.files).filter((n) => /^ppt\/media\/.+/.test(n)).length, keys.length, "지도 이미지가 슬라이드마다 들어감");
  const noImg = await JSZip.loadAsync(await renderReportPptx(plan)); // 이미지 없음: 자리표시 사각형 + 문구
  assert.equal(Object.keys(noImg.files).filter((n) => /^ppt\/media\/.+/.test(n)).length, 0);
  const slide2 = await noImg.file("ppt/slides/slide2.xml").async("string");
  assert.match(slide2, /지도 이미지를 만들지 못했습니다/);

  const siteRing = [[127.1502, 37.6202], [127.151, 37.6202], [127.151, 37.621], [127.1502, 37.6202]];
  const siteSummary = toSummaryView({ ...GODEOK_SUMMARY, siteParcel: [{ layer: "parcel_site", rings: [siteRing] }] }, GODEOK_RESULTS);
  const siteViews = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result, null, siteSummary.map.siteParcel)]));
  const sitePlan = buildReportPlan({ summary: siteSummary, views: siteViews, board: initBoard(GODEOK_RESULTS), analysisDate: "2026-09-30" });
  assert.ok(sitePlan.find((slide) => slide.kind === "cover").map.siteParcel?.length === 1, "보고서 표지 지도에 분석 필지 전달");
  assert.ok(sitePlan.find((slide) => slide.kind === "tile" && slide.view.code === "A01").map.siteParcel?.length === 1, "보고서 타일 지도에 분석 필지 전달");
  for (const code of ["A01", "D04"]) {
    assert.deepEqual(siteViews.get(`t-${code}`).map.siteParcel, siteSummary.map.siteParcel, `${code} 카드 지도에 같은 분석 필지 전달`);
  }
  // S02·S04는 실제 결과가 없는 fixture에서도 래스터 지도 계약만 채워 카드 전달 경로를 검증한다.
  const rasterBase = structuredClone(GODEOK_RESULTS.find((result) => result.tileCode === "D04"));
  for (const code of ["S02", "S04"]) {
    const rasterResult = {
      ...rasterBase,
      tileId: `t-${code}-parcel-test`,
      tileCode: code,
      tileType: "simulation",
      presentation: {
        ...rasterBase.presentation,
        rasters: [{ name: `${code.toLowerCase()}_cut`, kind: "scalar", crs: "EPSG:5179", x0: 0, y0: 0, cellM: 1, cols: 1, rows: 1, dtype: "u8", bands: 1, scale: 1, offset: 0, nodata: 255, palette: "utci", label: "test" }],
      },
    };
    assert.deepEqual(toTileView(rasterResult, null, siteSummary.map.siteParcel).map.siteParcel, siteSummary.map.siteParcel, `${code} 래스터 지도에 같은 분석 필지 전달`);
  }
}

console.log("v2 map tests passed");

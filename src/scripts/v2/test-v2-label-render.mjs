/** 설명선 렌더: 같은 등급은 대지에서 가까운 순, 칸별 위 끝, 금액 줄바꿈, 넘치는 낱말만 카드 폭 넓힘. */
import assert from "node:assert/strict";

const { buildMapScene, wrapMapText, northArrowBox } = await import("../../lib/v2/ui/map-scene.ts");

const CENTER = [127.0, 37.5];
const point = (k, extra = {}) => ({
  layer: "bldg_point",
  lng: CENTER[0] + 0.00025 * k * (k % 2 ? 1 : -1),
  lat: CENTER[1] + 0.0001 *((k * 3) % 5 - 2),
  name: `점${k}`,
  labelPriority: 2,
  ...extra,
});
const modelOf = (features) => ({ center: CENTER, radiusM: 1000, features, total: features.length, notes: [], polygons: [], polygonsTotal: 0 });
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const W = 960;

// 엔진 순서는 「먼 것부터」다.
const farFirst = (n, extra) => Array.from({ length: n }, (_, i) => point(n - i, extra));

// ① H 519: 숫자 카드(왼쪽) + 방위표(오른쪽 위)
{
  const H = 519;
  const keyCard = { x0: 24, y0: 84, x1: 324, y1: 330 };
  const scene = buildMapScene({ model: modelOf(farFirst(40)), width: W, height: H, activeLayer: "white", scale: true, north: 30, avoid: [keyCard] });
  const u = Math.min(1.5, Math.max(1, H / 360));
  const placed = new Set(scene.labelPlacements.map((p) => p.entry.key));
  assert.ok(placed.size > 0 && placed.size < 40, `일부만 놓인다(${placed.size})`);
  const placedD = scene.labelPlacements.map((p) => p.entry.siteDistance);
  const hiddenD = scene.labels.filter((l) => l.autoText && !placed.has(l.key)).map((l) => l.siteDistance);
  assert.ok(hiddenD.length > 0);
  assert.ok(Math.max(...placedD) < Math.min(...hiddenD), `① 놓인 최대 ${Math.max(...placedD)} < 숨긴 최소 ${Math.min(...hiddenD)}`);

  // ③ 칸별 위 끝
  const north = northArrowBox(W, H, 0, 30, scene.northUnit, scene.north.x);
  const f = scene.calloutFrame;
  assert.ok(Math.abs(f.right.top - (north.y1 + 6 * u)) < 0.5, `right.top ${f.right.top}`);
  assert.ok(Math.abs(f.left.top - (keyCard.y1 + 6 * u)) < 0.5, `left.top ${f.left.top}`);
  assert.ok(f.right.top < f.left.top);

  // ⑤ 겹침 0
  const boxes = scene.labelPlacements.map((p) => p.box);
  const fixedBoxes = [keyCard, north, scene.scaleBox];
  boxes.forEach((a, i) => {
    boxes.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b), "① 카드끼리 겹침"));
    fixedBoxes.forEach((b) => assert.ok(!overlap(a, b), "① 카드가 숫자 카드·방위표·축척을 덮음"));
  });
}

// ② H 763: 왼쪽 아래 범례 판, 후보 12개, 같은 문구 중 가까운 쪽
{
  const H = 763;
  const legendBox = { x0: 24, y0: H - 24 - 220, x1: 24 + 300, y1: H - 24 };
  const twins = [point(9, { name: "같은이름", labelPriority: 1 }), point(1, { name: "같은이름", labelPriority: 1 })];
  const scene = buildMapScene({ model: modelOf([...farFirst(12), ...twins]), width: W, height: H, activeLayer: "white", scale: true, north: 30, legendBox });
  const placed = new Set(scene.labelPlacements.map((p) => p.entry.key));
  const hiddenD = scene.labels.filter((l) => l.autoText && !placed.has(l.key) && l.labelPriority === 2).map((l) => l.siteDistance);
  const placedD = scene.labelPlacements.filter((p) => p.entry.labelPriority === 2).map((p) => p.entry.siteDistance);
  if (hiddenD.length > 0) assert.ok(Math.max(...placedD) < Math.min(...hiddenD), "② 놓인 것이 숨긴 것보다 가깝다");
  // ② 같은 문구는 가까운 쪽 하나만 후보
  const twinLabels = scene.labels.filter((l) => l.autoText === "같은이름");
  assert.equal(twinLabels.length, 2);
  const kept = scene.labelPlacements.filter((p) => p.entry.autoText === "같은이름");
  assert.ok(kept.length <= 1, "같은 문구는 한 번만");
  if (kept.length === 1) assert.equal(kept[0].entry.siteDistance, Math.min(...twinLabels.map((l) => l.siteDistance)));
  // ④ 범례 판을 덮지 않는다 ⑤ 겹침 0
  const north = northArrowBox(W, H, 0, 30, scene.northUnit, scene.north.x);
  const boxes = scene.labelPlacements.flatMap((p) => [p.box, p.leader]);
  boxes.forEach((b) => assert.ok(!overlap(b, legendBox), "② 범례 판을 덮음"));
  const cards = scene.labelPlacements.map((p) => p.box);
  cards.forEach((a, i) => {
    cards.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b), "② 카드끼리 겹침"));
    [north, scene.scaleBox].forEach((b) => assert.ok(!overlap(a, b), "② 카드가 방위표·축척을 덮음"));
  });
}

// ⑥ 금액은 줄 끝에서 끊기지 않는다
{
  const lines = wrapMapText("최근 전세 18억 9,000만원", 12.6, 120);
  assert.ok(lines.every((l) => !l.endsWith("억")), JSON.stringify(lines));
  assert.ok(lines.some((l) => l.includes("18억 9,000만원")), JSON.stringify(lines));
}

// ⑦ 카드 폭: 끊을 수 없는 낱말이 넓을 때만 compact(136u)보다 넓히고 176u를 넘기지 않는다
{
  const H = 519;
  const u = Math.min(1.5, Math.max(1, H / 360));
  const widthOf = (sublabel) => {
    const scene = buildMapScene({ model: modelOf([point(1, { sublabel })]), width: W, height: H, activeLayer: "white", scale: true, north: 30 });
    assert.equal(scene.labelPlacements.length, 1);
    const box = scene.labelPlacements[0].box;
    return box.x1 - box.x0;
  };
  const wide = widthOf("2027년3월15일입주예정512세대분양");
  assert.ok(wide > 136 * u + 0.5 && wide <= 176 * u + 0.5, `넓은 낱말 ${wide / u}u`);
  const plain = widthOf("가까운 학교 근처 공원");
  assert.ok(plain <= 136 * u + 0.5, `일반 ${plain / u}u`);
}

console.log("test-v2-label-render: ok");

// ── Task 4: 이름 없는 대상의 제목·top 모드·제목 굵기 ──
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";

globalThis.React = React;
{
  const { automaticLabelText, mapLabelContent, selectAutomaticLabels } = await import("../../lib/v2/ui/map-labels.ts");
  const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");
  const { tileClientModuleFor } = await import("../../lib/v2/tile/client.ts");
  const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
  const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
  const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
  const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");

  const ring = (cx, cy, d = 0.0002) => [[[cx - d, cy - d], [cx + d, cy - d], [cx + d, cy + d], [cx - d, cy + d], [cx - d, cy - d]]];
  const item = (extra) => ({ layer: "bldg_footprint", rings: ring(127.0003, 37.5003), labelPriority: 2, ...extra });

  // ① 이름 없음 + 우선순위 2 + unnamedTitle
  const titled = item({ name: null, unnamedTitle: "제2종근린생활시설", sublabel: "1994년 · 직선 269m" });
  assert.notEqual(automaticLabelText("bldg_footprint", "polygon", titled), null);
  assert.equal(mapLabelContent("bldg_footprint", "polygon", titled).title, "제2종근린생활시설");
  assert.equal(mapLabelContent("bldg_footprint", "polygon", titled).titleIsName, false);
  // ② unnamedTitle 없음 ③ 우선순위 1 + unnamedTitle
  assert.equal(automaticLabelText("bldg_footprint", "polygon", item({ name: null, sublabel: "1994년" })), null);
  assert.equal(automaticLabelText("bldg_footprint", "polygon", item({ name: null, unnamedTitle: "공동주택", labelPriority: 1 })), null);
  // ④ 같은 제목이어도 상세가 다르면 둘 다, 같으면 하나
  const apt = (key, sublabel) => ({ key, labelPriority: 2, order: 0, siteDistance: 1, autoText: automaticLabelText("bldg_footprint", "polygon", item({ name: null, unnamedTitle: "공동주택", sublabel })) });
  assert.equal(selectAutomaticLabels([apt("a", "1983년 · 직선 25m"), apt("b", "1994년 · 직선 269m")]).length, 2);
  assert.equal(selectAutomaticLabels([apt("a", "1983년 · 직선 25m"), apt("b", "1983년 · 직선 25m")]).length, 1);
  // ⑤ 호버 제목
  const bare = mapLabelContent("bldg_footprint", "polygon", item({ name: null, labelPriority: 0 }));
  assert.equal(bare.title, layerStyle("bldg_footprint").label);
  assert.equal(bare.titleIsName, false);
  assert.equal(mapLabelContent("bldg_footprint", "polygon", item({ name: "고덕 센트럴", labelPriority: 0 })).titleIsName, true);

  // ⑥ 옛 결과(unnamedTitle 없음)·top 모드
  const sceneOf = (tileCode, polygons) => buildMapScene({ model: { center: CENTER, radiusM: 1000, features: [], total: polygons.length, notes: [], polygons, polygonsTotal: polygons.length, tileCode }, width: W, height: 519, activeLayer: "white", scale: true, north: 30 });
  const old = [item({ name: null, labelPriority: 0 }), item({ name: "이름만 있음", labelPriority: 1, rings: ring(127.0006, 37.5003) })];
  assert.equal(sceneOf("D03", old).labelPlacements.length, 0, "D03 옛 결과는 top 모드에서 자동 라벨 0");
  // D05 top 모드는 floors_* 레이어의 우선순위 2만 자동 후보다(옛 저장 결과의 tall_ge35* 우선순위 2는 35m 보기에서 지도를 덮지 않는다).
  const d05 = sceneOf("D05", [item({ layer: "floors_15_25", name: "고덕 센트럴", sublabel: "20층 · 직선 25m" }), item({ layer: "floors_15_25", name: "이름만 1순위", labelPriority: 1, rings: ring(127.0006, 37.5003) }), item({ layer: "tall_ge35", name: "옛 35m 면", sublabel: "36층", rings: ring(127.0009, 37.5003) })]);
  assert.deepEqual(d05.labelPlacements.map((p) => p.entry.title), ["고덕 센트럴"]);
  const oldD05 = sceneOf("D05", [item({ layer: "tall_ge35", name: "옛 35m 면", sublabel: "36층" }), item({ layer: "tall_ge35_est", name: "옛 추정 면", sublabel: "36층", rings: ring(127.0006, 37.5003) })]);
  assert.equal(oldD05.labelPlacements.length, 0, "옛 모양 결과의 35m 보기 자동 라벨 0");
  // ⑦ 모드 값
  for (const code of ["D03", "D04", "D05", "D12"]) assert.equal(tileClientModuleFor(code)?.autoLabels, "top");

  // ⑧ 화면: 이름 제목 700, 이름 없는 제목 500
  const mixed = [
    item({ name: "고덕 센트럴", sublabel: "36층" }),
    item({ name: null, unnamedTitle: "제2종근린생활시설", sublabel: "1994년", rings: ring(127.0012, 37.5003) }),
  ];
  const mixedModel = { center: CENTER, radiusM: 1000, features: [], total: 2, notes: [], polygons: mixed, polygonsTotal: 2, tileCode: "D03" };
  const svg = renderToStaticMarkup(createElement(MapFigure, { model: mixedModel, width: W, height: 519, fixed: true, basemap: "none", legend: false }));
  const weightOf = (text) => svg.match(new RegExp(`font-weight="(\\d+)"[^>]*>${text}<`))?.[1];
  assert.equal(weightOf("고덕 센트럴"), "700");
  assert.equal(weightOf("제2종근린생활시설"), "500");

  // ⑨ PPT: 이름 제목 run은 bold, 이름 없는 제목 run은 bold 아님
  const view = { ...toTileView(GODEOK_RESULTS.find((r) => r.tileCode === "A01")), tileId: "t4-d03", code: "D03", title: "D03 제목 fixture", tileType: "diagram", hasFace: false, map: mixedModel, backdrop: mixedModel };
  const plan = { kind: "tile", view, body: { kind: "result", face: "single" }, faceLabel: null, map: mixedModel, muted: false, pinnedKeys: [], footer: "출처 fixture", no: 1, total: 1 };
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const { mapKeysOf } = await import("../../lib/v2/report/report-plan.ts");
  const images = Object.fromEntries(mapKeysOf(plan).map((key) => [key, PNG]));
  const zip = await JSZip.loadAsync(await renderReportPptx([plan], images));
  const xml = await zip.file("ppt/slides/slide1.xml").async("string");
  const runOf = (text) => xml.match(new RegExp(`<a:r>(?:(?!</a:r>)[\\s\\S])*<a:t>${text}[^<]*</a:t></a:r>`))?.[0];
  assert.ok(runOf("고덕 센트럴"), "PPT에 이름 라벨 run");
  assert.ok(runOf("제2종근린생활시설"), "PPT에 이름 없는 라벨 run");
  assert.match(runOf("고덕 센트럴"), /b="1"/);
  assert.doesNotMatch(runOf("제2종근린생활시설"), /b="1"/);
  console.log("test-v2-label-render task4: ok");
}

/**
 * PPT 지도 표현 회귀 테스트.
 *
 * 이 테스트는 화면용 fixture의 결과 계약을 바탕으로 대표 지도 4장을 만들고,
 * 보고서 렌더러의 PPTX XML에서 배경 이미지와 편집 가능한 지도 도형을 함께
 * 확인한다. 지도 좌표의 소수점 단위 XML을 고정하지 않고, 한 점의 중심 위치만
 * 장면 모델의 투영 결과와 비교해 렌더러가 다른 좌표계를 쓰지 않는지 확인한다.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import JSZip from "jszip";

const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { TILE_CODES, TILE_CATALOG } = await import("../../lib/v2/ui/tile-catalog.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { isEditableMap, nativeMapStatus } = await import("../../lib/v2/report/map-pptx.ts");
const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const { SLIDE, slideLegend, slideReserved, slideSiteX } = await import("../../lib/v2/ui/overlay-layout.ts");
const { mapKeysOf } = await import("../../lib/v2/report/report-plan.ts");
const { sheetCells } = await import("../../lib/v2/ui/sheet.ts");

const VIEW_W = 960;
const VIEW_H = 540;
const PX_PER_INCH = VIEW_W / SLIDE.w;
const EMU_PER_INCH = 914400;
const SAMPLE_PATH = process.env.V2_EDITABLE_MAP_SAMPLE_PATH
  ?? "C:\\Users\\da\\AppData\\Local\\Temp\\claude\\D--V-coding-16-SiteAnalysis\\6c9abf34-5f45-4bb2-a9cd-a613cdb3c712\\scratchpad\\W12\\editable-map-sample.pptx";

// pptxgenjs에 넘기는 최소 이미지. 대표·폴백 장 모두 배경 이미지가 실제로 한 장
// 들어갔는지 검사할 수 있도록 같은 이미지를 각 지도 자리의 키에 넣는다.
const BACKGROUND_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const CENTER = [127.1542, 37.555];
const FEATURE_COLOR = "#1F5FA8";
const MAP_CODES = TILE_CODES.filter((code) => code !== "S01" && code !== "D22");

const point = (eastM, northM) => [CENTER[0] + eastM / 88200, CENTER[1] + northM / 111320];
const closedRing = (points) => [...points, points[0]];

function feature(layer, fid, eastM, northM, extra = {}) {
  const [lng, lat] = point(eastM, northM);
  return { layer, fid, lng, lat, ...extra };
}

function line(layer, fid, points, extra = {}) {
  return { layer, fid, points: points.map(([eastM, northM]) => point(eastM, northM)), ...extra };
}

function polygon(layer, fid, points, extra = {}) {
  return { layer, fid, rings: [closedRing(points.map(([eastM, northM]) => point(eastM, northM)))], ...extra };
}

const siteParcel = [polygon("parcel_site", "site-1", [[-46, -32], [55, -32], [55, 42], [-46, 42]], { name: "분석 대지", label: "대지" })];

function representativeMap(code) {
  const common = {
    center: CENTER,
    radiusM: 1000,
    total: 0,
    notes: [`${code} 구조 회귀 fixture`],
    siteParcel,
    tileCode: code,
  };
  const maps = {
    A01: {
      features: [
        feature("rail_station", "a01-station", 80, 100, { name: "고덕역", label: "고덕역", sublabel: "2호선", highlight: true, distanceM: 480, labelPriority: 2, badges: [{ text: "2", color: FEATURE_COLOR }] }),
        feature("rail_entrance", "a01-entrance", 94, 86, { name: "2번 출입구", label: "2", labelPriority: 1 }),
        feature("bus_stop", "a01-bus", -180, -100, { name: "고덕역 버스정류장", label: "정류장", labelPriority: 1 }),
        feature("bus_stop", "a01-bus-2", -140, -120, { name: "보조 버스정류장", label: "정류장", labelPriority: 1 }),
        feature("bus_nearest", "a01-nearest", -300, -160, { name: "최근접 정류장", label: "340m", highlight: true, distanceM: 340, labelPriority: 2 }),
      ],
      lines: [
        line("rail_line", "a01-route", [[-460, 160], [-220, 132], [0, 115], [250, 102], [440, 80]], { label: "2호선", name: "2호선", legendLabel: "2호선", color: FEATURE_COLOR, labelPriority: 1 }),
        line("rail_station_axis", "a01-axis", [[-440, 160], [-220, 132], [0, 115], [250, 102], [440, 80]], { label: "2호선", name: "2호선", legendLabel: "2호선", color: FEATURE_COLOR, casing: "#FFFFFF", strokeWidth: 9, casingWidth: 13, labelPriority: 2 }),
      ],
      polygons: [],
    },
    A09: {
      features: [
        feature("maint_zone_center", "a09-zone-center", -170, 150, { name: "정비구역 A", label: "정비구역 A", labelPriority: 2, highlight: true }),
        feature("maint_zone", "a09-zone-point", 240, -130, { name: "정비구역 B", label: "정비구역 B", labelPriority: 1 }),
      ],
      lines: [],
      polygons: [
        polygon("maint_zone", "a09-zone", [[-300, 260], [-100, 260], [-80, 80], [-290, 40]], { name: "정비구역 A", label: "정비구역 A", labelPriority: 2 }),
      ],
    },
    D02: {
      features: [
        feature("bldg_point", "d02-building-point", 120, 100, { name: "건물 대표점", label: "건물", labelPriority: 1 }),
        feature("building", "d02-building", -210, -90, { name: "건물 B", label: "건물 B", labelPriority: 1 }),
      ],
      lines: [],
      polygons: [
        polygon("building", "d02-footprint-a", [[-260, -10], [-80, -10], [-80, -180], [-260, -180]], { name: "건물 발자국 A", label: "건물 A", labelPriority: 1 }),
        polygon("building", "d02-footprint-b", [[110, -20], [300, -20], [300, -190], [110, -190]], { name: "건물 발자국 B", label: "건물 B", labelPriority: 1 }),
      ],
    },
    D13: {
      features: [
        feature("road:간선", "d13-road-point", 60, -90, { name: "간선도로", label: "간선", labelPriority: 1 }),
      ],
      lines: [
        line("road:간선", "d13-arterial", [[-460, -260], [-220, -160], [0, -100], [240, -15], [460, 105]], { name: "간선도로", label: "간선도로", color: "#C45A36", casing: "#FFFFFF", strokeWidth: 3, casingWidth: 5.4, labelPriority: 2, emphasis: "major" }),
        line("road:국지", "d13-local", [[-440, 260], [-240, 180], [-20, 105], [180, 20], [400, -70]], { name: "국지도로", label: "국지도로", color: "#7BA68A", strokeWidth: 1.2, labelPriority: 1 }),
      ],
      polygons: [],
    },
  };
  const selected = maps[code] ?? maps.A01;
  const features = selected.features;
  return { ...common, ...selected, total: features.length + selected.polygons.length + selected.lines.length };
}

const a01Fixture = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
assert.ok(a01Fixture, "GODEOK_RESULTS A01 fixture가 필요하다");
const fixtureView = toTileView(a01Fixture);
const a05Fixture = GODEOK_RESULTS.find((result) => result.tileCode === "A05");
assert.ok(a05Fixture, "GODEOK_RESULTS A05 fixture가 필요하다");
const a05View = toTileView(a05Fixture);
assert.equal(TILE_CATALOG.S01.kind, "simulation", "S01 매스 특수 경로가 카탈로그에 남아 있다");
assert.equal(TILE_CATALOG.D22.kind, "diagram", "D22 장미 특수 경로가 카탈로그에 남아 있다");

function viewFor(code, map, suffix = code) {
  return {
    ...fixtureView,
    tileId: `editable-${suffix}`,
    code,
    title: `${code} 구조 fixture`,
    tileType: code.startsWith("D") ? "diagram" : "analysis",
    hasFace: false,
    map,
    backdrop: map,
  };
}

function plannedTile(code, map, suffix = code) {
  const view = viewFor(code, map, suffix);
  return {
    kind: "tile",
    view,
    body: { kind: "result", face: "single" },
    faceLabel: null,
    map,
    muted: false,
    pinnedKeys: [],
    footer: "출처 구조 회귀 fixture · 기준일 2026-10-14",
  };
}

const representativePlans = ["A01", "A09", "D02", "D13"].map((code) => plannedTile(code, representativeMap(code)));
const fallbackMap = { ...representativeMap("A01"), tileCode: "A03", notes: ["A03은 1단계 대표 타일 밖의 이미지 폴백"] };
const fallbackPlan = plannedTile("A03", fallbackMap, "fallback-a03");
const denseFeatures = Array.from({ length: 1501 }, (_, index) => feature("bus_stop", `dense-${index}`, -400 + (index % 60) * 12, -300 + Math.floor(index / 60) * 12, { label: null }));
const denseMap = { ...representativeMap("D02"), tileCode: "D02", features: denseFeatures, total: denseFeatures.length, notes: ["dense layer fallback fixture"] };
const densePlan = plannedTile("D02", denseMap, "dense-d02");
const catalogPlans = MAP_CODES.map((code) => plannedTile(code, representativeMap(code), `catalog-${code}`));
const a05BackdropMap = { ...a05View.backdrop, tileCode: "A05" };
const a05BackdropPlan = {
  ...plannedTile("A05", a05BackdropMap, "a05-backdrop"),
  view: { ...a05View, tileId: "editable-a05-backdrop", code: "A05", map: a05BackdropMap, backdrop: a05BackdropMap },
  ...(a05View.callout ? { callout: { model: a05View.callout, page: 0, pages: 1, filterLine: a05View.filterLine } } : {}),
};
const sheetPlan = {
  kind: "sheet",
  view: { ...fixtureView, tileId: "editable-sheet", code: "SHEET", title: "지도 조판", tileType: "stack", map: null },
  grid: "2x2",
  cells: [
    { view: viewFor("A01", representativeMap("A01"), "sheet-a01"), face: "front", mapKey: "sheet-a01", pinnedKeys: [] },
    { view: viewFor("D13", representativeMap("D13"), "sheet-d13"), face: "front", mapKey: "sheet-d13", pinnedKeys: [] },
  ],
  footer: "조판 회귀 fixture · 기준일 2026-10-14",
};
const rawPlans = [...representativePlans, fallbackPlan, densePlan, ...catalogPlans, a05BackdropPlan, sheetPlan];
const plans = rawPlans.map((plan, index, all) => ({ ...plan, no: index + 1, total: all.length }));
const imageKeys = [...new Set(plans.flatMap((plan) => mapKeysOf(plan)))];
const images = Object.fromEntries(imageKeys.map((key) => [key, BACKGROUND_PNG]));

const bytes = await renderReportPptx(plans, images);
mkdirSync(dirname(SAMPLE_PATH), { recursive: true });
writeFileSync(SAMPLE_PATH, bytes);

const zip = await JSZip.loadAsync(bytes);
const slideNames = Object.keys(zip.files)
  .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
assert.equal(slideNames.length, plans.length, "fixture plan 장수와 PPTX 장수가 같다");

const slideXml = async (index) => zip.file(slideNames[index])?.async("string") ?? "";
const shapeCount = (xml) => (xml.match(/<p:(?:sp|pic|cxnSp|graphicFrame)>/g) ?? []).length;
const groupCount = (xml) => (xml.match(/<p:grpSp>/g) ?? []).length;
const pictureCount = (xml) => (xml.match(/<p:pic>/g) ?? []).length;
const textContent = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join("|");
const taggedShapeBlocks = (xml) => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]).filter((block) => block.includes("GRP|"));
const groupBlocks = (xml) => [...xml.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)].map((match) => match[0]);
const groupNames = (xml) => groupBlocks(xml).map((block) => block.match(/<p:cNvPr id="\d+" name="([^"]*)"/)?.[1]).filter(Boolean);
const shapeBlocks = (xml) => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0]);

function geometryForBlock(block) {
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  if (!off || !ext) return null;
  return { x: Number(off[1]), y: Number(off[2]), w: Number(ext[1]), h: Number(ext[2]) };
}

function textForBlock(block) {
  return [...block.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1]).join("");
}

function textShapesInRect(xml, rect) {
  return shapeBlocks(xml).flatMap((block) => {
    const geometry = geometryForBlock(block);
    const text = textForBlock(block);
    if (!geometry || !text) return [];
    const center = { x: geometry.x + geometry.w / 2, y: geometry.y + geometry.h / 2 };
    if (center.x < rect.x || center.x > rect.x + rect.w || center.y < rect.y || center.y > rect.y + rect.h) return [];
    return [{ geometry, text, fontSizes: [...block.matchAll(/\bsz="(\d+)"/g)].map((match) => Number(match[1])) }];
  });
}

function groupGeometryContaining(xml, token) {
  const block = groupBlocks(xml).find((candidate) => candidate.includes(token));
  return block ? geometryForBlock(block) : null;
}

function groupGeometryContainingAll(xml, tokens) {
  const block = groupBlocks(xml).find((candidate) => tokens.every((token) => candidate.includes(token)));
  return block ? geometryForBlock(block) : null;
}

function overlapsRect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function assertValidGroupedXml(xml, label) {
  assert.ok(xml.includes("<p:spTree>"), `${label} spTree 없음`);
  for (const block of groupBlocks(xml)) {
    const ids = [...block.matchAll(/<p:cNvPr id="(\d+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${label} grpSp 안 id 중복: ${ids.join(",")}`);
  }
}

function geometryForName(xml, token) {
  const block = taggedShapeBlocks(xml).find((candidate) => candidate.includes(token));
  if (!block) return null;
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  if (!off || !ext) return null;
  return {
    x: Number(off[1]),
    y: Number(off[2]),
    w: Number(ext[1]),
    h: Number(ext[2]),
  };
}

const counts = [];
for (let index = 0; index < representativePlans.length; index += 1) {
  const plan = representativePlans[index];
  const xml = await slideXml(index);
  const status = nativeMapStatus(plan.map);
  const count = shapeCount(xml);
  counts.push({ code: plan.view.code, native: status.native, shapeCount: count, groups: groupCount(xml), pictures: pictureCount(xml), layerCounts: status.layerCounts });
  assert.equal(isEditableMap(plan.map), true, `${plan.view.code}가 대표 네이티브 경로여야 한다`);
  assert.equal(pictureCount(xml), 1, `${plan.view.code} 지도 배경 이미지는 한 장이어야 한다`);
  assert.match(xml, /<a:custGeom(?:\s|\/|>)/, `${plan.view.code} custGeom 없음`);
  assert.match(xml, /prst="ellipse"/, `${plan.view.code} ellipse 없음`);
  assert.match(xml, /prst="line"|<a:ln(?:\s|\/|>)/, `${plan.view.code} line 없음`);
  assert.match(xml, /<a:t>[^<]+<\/a:t>/, `${plan.view.code} 텍스트 없음`);
  assert.match(xml, new RegExp(`GRP\\|map-${plan.view.code}-`), `${plan.view.code} GRP 태그 없음`);
  assert.match(xml, /<p:grpSp>/, `${plan.view.code} 후처리 p:grpSp 없음`);
  assert.match(xml, /\|방위표\|/, `${plan.view.code} 방위표 없음`);
  assert.match(xml, /\|축척\|/, `${plan.view.code} 축척 없음`);
  assertValidGroupedXml(xml, plan.view.code);
  assert.ok(count <= 1500, `${plan.view.code} native shape count ${count} > 1500`);
}

const catalogStart = representativePlans.length + 2;
for (const [index, plan] of catalogPlans.entries()) {
  const xml = await slideXml(catalogStart + index);
  const status = nativeMapStatus(plan.map);
  assert.equal(status.native, true, `${plan.view.code} 카탈로그 지도 타일은 native 판정이어야 한다`);
  assert.equal(isEditableMap(plan.map), true, `${plan.view.code} 카탈로그 지도 타일 native 판정`);
  assert.equal(pictureCount(xml), 1, `${plan.view.code} 지도 배경은 한 장이어야 한다`);
  assert.match(xml, new RegExp(`GRP\\|map-${plan.view.code}-`), `${plan.view.code} 지도 GRP 태그 없음`);
  assert.match(xml, /\|반경\|/, `${plan.view.code} 반경 그룹 태그 없음`);
  assert.match(xml, /\|범례 /, `${plan.view.code} 레이어 범례 그룹 태그 없음`);
  assert.match(xml, /\|범례\|/, `${plan.view.code} 범례 패널 그룹 태그 없음`);
  assert.match(xml, /\|요약\|/, `${plan.view.code} 요약 패널 그룹 태그 없음`);
  assert.match(xml, /\|제목\|/, `${plan.view.code} 제목 패널 그룹 태그 없음`);
  assertValidGroupedXml(xml, plan.view.code);
}

// 같은 MapScene 투영 결과가 PPT 점 도형의 중심으로 이어지는지 한 대표 지물만
// 비교한다. XML의 개별 EMU 값에 의존하지 않고 슬라이드 좌표 오차만 제한한다.
const a01Map = representativePlans[0].map;
const a01Legend = slideLegend(a01Map, true).rect;
const a01Scene = buildMapScene({
  model: a01Map,
  width: VIEW_W,
  height: VIEW_H,
  activeLayer: a01Map.basemap ?? "white",
  siteX: slideSiteX(),
  bottomInset: SLIDE.stripH * PX_PER_INCH,
  scale: true,
  muted: false,
  pinnedKeys: [],
  showAutomaticLabels: true,
  avoid: slideReserved(PX_PER_INCH, { legend: a01Legend }),
  bare: false,
});
const expectedFeature = a01Scene.features.find((entry) => entry.feature.fid === "a01-bus");
assert.ok(expectedFeature, "A01 scene representative feature가 필요하다");
const featureToken = "GRP|map-A01-legend-버스정류장";
const actualFeature = geometryForName(await slideXml(0), featureToken);
assert.ok(actualFeature, "A01 representative feature의 PPT 도형 위치를 찾을 수 없다");
const actualFeatureCenter = {
  x: (actualFeature.x + actualFeature.w / 2) / EMU_PER_INCH,
  y: (actualFeature.y + actualFeature.h / 2) / EMU_PER_INCH,
};
const expectedFeatureCenter = { x: (expectedFeature.p[0] / VIEW_W) * SLIDE.w, y: (expectedFeature.p[1] / VIEW_H) * SLIDE.h };
assert.ok(Math.abs(actualFeatureCenter.x - expectedFeatureCenter.x) < 0.12, `A01 feature x 좌표 불일치: ${actualFeatureCenter.x} vs ${expectedFeatureCenter.x}`);
assert.ok(Math.abs(actualFeatureCenter.y - expectedFeatureCenter.y) < 0.12, `A01 feature y 좌표 불일치: ${actualFeatureCenter.y} vs ${expectedFeatureCenter.y}`);
const a01Xml = await slideXml(0);
const hiddenBus = a01Scene.labels.find((entry) => entry.pick.fid === "a01-bus");
assert.ok(hiddenBus, "A01 자동 라벨 숨김 검증용 버스 라벨이 없다");
const hiddenScene = buildMapScene({
  model: a01Map,
  width: VIEW_W,
  height: VIEW_H,
  activeLayer: a01Map.basemap ?? "white",
  siteX: slideSiteX(),
  bottomInset: SLIDE.stripH * PX_PER_INCH,
  scale: true,
  muted: false,
  pinnedKeys: [],
  hiddenKeys: [hiddenBus.key],
  showAutomaticLabels: true,
  avoid: slideReserved(PX_PER_INCH, { legend: a01Legend }),
  bare: false,
});
assert.equal(hiddenScene.labelPlacements.some((placement) => placement.entry.key === hiddenBus.key), false, "scene가 hiddenKeys 자동 라벨을 제거하지 않았다");
const hiddenBusKey = hiddenBus.key.replace(/[|\r\n]/g, "-").slice(0, 90);
const hiddenBusPlan = {
  ...representativePlans[0],
  style: { ...(representativePlans[0].style ?? {}), hiddenKeys: [hiddenBus.key] },
};
const hiddenBytes = await renderReportPptx([hiddenBusPlan], images);
const hiddenZip = await JSZip.loadAsync(hiddenBytes);
const hiddenXml = await hiddenZip.file("ppt/slides/slide1.xml")?.async("string") ?? "";
assert.doesNotMatch(hiddenXml, new RegExp(`GRP\\|map-A01-label-${hiddenBusKey}\\|`), "hiddenKeys 라벨이 PPT XML에 남아 있다");
assert.match(a01Xml, /\|범례 2호선\|/, "A01 PPT에 네이티브 노선 범례 그룹이 없다");
assert.match(a01Xml, /\|axis-label/, "A01 PPT에 네이티브 역사 막대 라벨이 없다");
assert.match(a01Xml, /\|역명 · 고덕역\|/, "A01 PPT에 네이티브 역명이 없다");
const a01LegendItems = slideLegend(a01Map, true).items;
assert.equal(a01LegendItems.find((item) => item.layer === "rail_station")?.symbol, "rail-axis", "PPT 역사 범례는 막대 기호 계약을 가져야 한다");
assert.equal(a01LegendItems.find((item) => item.layer === "rail_entrance")?.symbol, "rail-exit", "PPT 출구 범례는 출구 기호 계약을 가져야 한다");
assert.match(a01Xml, /FFD200/u, "PPT 출구 범례에 #FFD200 기호가 없다");
assert.match(a01Xml, /name="범례 2호선"/u, "PPT 역사 범례 그룹이 없다");

const d13Xml = await slideXml(3);
const d13LegendTagCounts = new Map();
for (const match of d13Xml.matchAll(/GRP\|map-D13-(legend-[^|]+)\|범례 ([^|]+)\|/g)) d13LegendTagCounts.set(match[1], (d13LegendTagCounts.get(match[1]) ?? 0) + 1);
assert.ok([...d13LegendTagCounts.values()].some((count) => count >= 2), "같은 범례 항목의 점·선이 하나의 그룹 키를 공유하지 않는다");

const noteXml = await Promise.all(Object.keys(zip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).map((name) => zip.file(name).async("string")));
const allNotes = noteXml.map(textContent).join("|");
const fallbackXml = await slideXml(representativePlans.length);
const denseXml = await slideXml(representativePlans.length + 1);
assert.equal(isEditableMap(fallbackMap), true, "tileCode가 있는 비대표 타일도 네이티브 경로여야 한다");
assert.equal(pictureCount(fallbackXml), 1, "비대표 지도도 배경 이미지 한 장을 유지한다");
assert.equal(isEditableMap(denseMap), true, "밀집 지도도 층별 폴백 native 경로여야 한다");
assert.ok(nativeMapStatus(denseMap).denseLayers.includes("bus_stop"), "밀집 폴백 레이어가 기록되지 않았다");
assert.equal(pictureCount(denseXml), 1, "밀집 폴백도 기존 지도 이미지 한 장을 유지한다");
assert.match(allNotes, /레이어 도형 수 상한 초과/, "밀집 폴백 사유 speaker note가 없다");
assert.ok(nativeMapStatus(denseMap).rasterLayers.includes("bus_stop"), "밀집 층이 backgroundOnly 목록에 없다");
assertValidGroupedXml(fallbackXml, "A03 dense-free");
assertValidGroupedXml(denseXml, "D02 dense");

const a05Index = catalogStart + catalogPlans.length;
const a05Xml = await slideXml(a05Index);
assert.equal(nativeMapStatus(a05BackdropMap).native, true, "A05 backdrop tileCode native 판정");
assert.match(a05Xml, /GRP\|map-A05-/, "A05 backdrop에 편집 가능한 지도 도형이 없다");
assert.match(a05Xml, /<p:grpSp>/, "A05 backdrop 그룹이 없다");
assertValidGroupedXml(a05Xml, "A05 backdrop");
const a05ScaleGroup = groupGeometryContaining(a05Xml, "map-A05-scale");
const a05CalloutLegendGroup = groupGeometryContaining(a05Xml, "panel-callout-legend");
assert.ok(a05ScaleGroup, "A05 개요 축척 그룹 bbox가 없다");
assert.ok(a05CalloutLegendGroup, "A05 개요 콜아웃 범례 그룹 bbox가 없다");
assert.equal(overlapsRect(a05ScaleGroup, a05CalloutLegendGroup), false, "A05 개요 축척과 콜아웃 범례가 겹친다");

const sheetIndex = a05Index + 1;
const sheetXml = await slideXml(sheetIndex);
assert.ok(shapeCount(sheetXml) > 4, "조판 셀 지도 도형이 생성되지 않았다");
assert.ok(groupNames(sheetXml).some((name) => name === "범례"), "조판 셀 범례 패널 그룹이 없다");
assert.match(sheetXml, /GRP\|map-cell-0-A01-/, "조판 A01 셀 native 도형이 없다");
assert.match(sheetXml, /GRP\|map-cell-1-D13-/, "조판 D13 셀 native 도형이 없다");
assertValidGroupedXml(sheetXml, "sheet");

const sheetCellRects = sheetCells("2x2").slice(0, sheetPlan.cells.length).map((cell) => ({ x: cell.x * EMU_PER_INCH, y: cell.y * EMU_PER_INCH, w: cell.w * EMU_PER_INCH, h: cell.h * EMU_PER_INCH }));
for (const [index, cellRect] of sheetCellRects.entries()) {
  const cellTextShapes = textShapesInRect(sheetXml, cellRect);
  assert.ok(cellTextShapes.length > 0, `조판 ${index} 셀 텍스트가 없다`);
  const legendGroup = groupGeometryContainingAll(sheetXml, [`map-cell-${index}-`, "legend-panel"]);
  assert.ok(legendGroup, `조판 ${index} 셀 범례 그룹 bbox가 없다`);
  for (const shape of cellTextShapes) {
    assert.ok(shape.fontSizes.length > 0, `조판 ${index} 셀 텍스트 run 크기가 없다: ${shape.text}`);
    assert.ok(Math.min(...shape.fontSizes) >= 800, `조판 ${index} 셀 텍스트가 8pt 미만이다: ${shape.text} (${shape.fontSizes.join(",")})`);
  }
  const sourceTexts = cellTextShapes.filter((shape) => shape.text.startsWith("출처 "));
  if (sourceTexts.length > 0) {
    assert.equal(sourceTexts.some((shape) => overlapsRect(shape.geometry, legendGroup)), false, `조판 ${index} 셀 출처와 범례가 겹친다`);
  }
}
assert.equal(textShapesInRect(sheetXml, sheetCellRects[0]).some((shape) => shape.text.startsWith("출처 ")), false, "조판 셀 안에 출처 문구가 남아 있다");

for (const name of slideNames) assertValidGroupedXml(await zip.file(name).async("string"), name);

counts.push({ code: fallbackMap.tileCode, native: true, shapeCount: shapeCount(fallbackXml), groups: groupCount(fallbackXml), pictures: pictureCount(fallbackXml), reason: nativeMapStatus(fallbackMap).reason });
counts.push({ code: "D02:dense", native: true, rasterLayers: nativeMapStatus(denseMap).rasterLayers, shapeCount: shapeCount(denseXml), groups: groupCount(denseXml), pictures: pictureCount(denseXml), reason: nativeMapStatus(denseMap).reason });
console.log(`editable map PPT sample: ${SAMPLE_PATH}`);
console.log(`editable map PPT counts: ${JSON.stringify(counts)}`);
console.log(`editable map coordinate check: ${JSON.stringify({ expected: expectedFeatureCenter, actual: actualFeatureCenter, delta: { x: actualFeatureCenter.x - expectedFeatureCenter.x, y: actualFeatureCenter.y - expectedFeatureCenter.y } })}`);
console.log(`v2 editable map PPT tests passed (${plans.length} slides)`);

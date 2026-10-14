import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;

const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const { canonicalRailLineLabel, railLineColor, railLineCasing, railLineEmphasis, railLineBadgeText } = await import("../../lib/v2/tile/rail-presentation.ts");
const { subwayStationDisplayName } = await import("../../lib/osm-subway-overlay.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { framedViewport, tileUrl, tilesFor } = await import("../../lib/v2/ui/map-projection.ts");
const { serveTile } = await import("../../lib/v2/tiles.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const { createRequire } = await import("node:module");
const { fileURLToPath } = await import("node:url");
const requireFromWorktree = createRequire(new URL("../../../package.json", import.meta.url));
const sharp = requireFromWorktree("sharp");

const ROOT = new URL("../../../", import.meta.url);
const outputDir = process.env.A01_RAIL_IMPL_OUT_DIR
  ?? "C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/6c9abf34-5f45-4bb2-a9cd-a613cdb3c712/scratchpad/W15";
const publicDataPath = process.env.PUBLIC_SUBWAY_PATH ?? fileURLToPath(new URL("public/data/osm-subway.json", ROOT));
const mockupDir = process.env.RAIL_MOCKUP_DIR
  ?? "C:/Users/da/AppData/Local/Temp/claude/D--V-coding-16-SiteAnalysis/6c9abf34-5f45-4bb2-a9cd-a613cdb3c712/scratchpad/W14a3";
// 승인 시안 3과 같은 VWorld white 타일 캐시를 사용해 비교판의 좌우가
// 배경·프레임·축척까지 동일하게 맞는다. 렌더 산출물 폴더에는 타일을 복사하지 않는다.
const tileCacheDir = process.env.RAIL_BASEMAP_CACHE_DIR ?? join(mockupDir, ".vworld-white-cache");
const tileDataCache = new Map();
const tileStats = { requested: 0, loaded: 0, failed: 0 };

const publicData = JSON.parse(await readFile(publicDataPath, "utf8"));
const TARGETS = [
  { id: "dogok", stationName: "도곡" },
  { id: "express", stationName: "고속터미널" },
  { id: "wangsimni", stationName: "왕십리" },
  { id: "sungshin", stationName: "성신여대입구", mockupId: "sungshin" },
  { id: "daechi", stationName: "대치" },
];
const CUTS = [
  { id: "card-r1000", width: 480, height: 320, radiusM: 1000, compact: true },
  { id: "detail-r1000", width: 960, height: 600, radiusM: 1000, compact: false },
  { id: "detail-r300", width: 960, height: 600, radiusM: 300, compact: false },
  { id: "detail-r1000-zoom", width: 960, height: 600, radiusM: 1000, compact: false, view: { zoomDelta: 2, offsetM: [0, 0] } },
];
const M_PER_DEGREE_LAT = 111320;

function distanceM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const east = (a[0] - b[0]) * Math.cos(lat) * M_PER_DEGREE_LAT;
  const north = (a[1] - b[1]) * M_PER_DEGREE_LAT;
  return Math.hypot(east, north);
}

function averagePoint(points) {
  if (points.length === 0) return [0, 0];
  const total = points.reduce(([lng, lat], [nextLng, nextLat]) => [lng + nextLng, lat + nextLat], [0, 0]);
  return [total[0] / points.length, total[1] / points.length];
}

function lineLabel(line) {
  const label = canonicalRailLineLabel(line.line_ref ?? null, line.line_name ?? null);
  return label === "철도" ? null : label;
}

function geometryPaths(line) {
  const coordinates = line.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  const paths = line.geometry?.type === "LineString" ? [coordinates] : coordinates;
  return paths
    .filter((path) => Array.isArray(path) && path.length >= 2)
    .map((path) => path.filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])).map(([lng, lat]) => [lng, lat]));
}

function pathLengthM(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distanceM(points[index - 1], points[index]);
  return length;
}

function localRoute(rawLine, center, radiusM) {
  const candidates = [];
  for (const path of geometryPaths(rawLine)) {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < path.length; index += 1) {
      const nextDistance = distanceM(center, path[index]);
      if (nextDistance < nearestDistance) {
        nearestDistance = nextDistance;
        nearestIndex = index;
      }
    }
    const inRadius = path.map((point) => distanceM(center, point) <= radiusM + 100);
    const firstInRadius = inRadius.findIndex(Boolean);
    const lastInRadius = inRadius.lastIndexOf(true);
    const start = firstInRadius >= 0 ? Math.max(0, firstInRadius - 1) : Math.max(0, nearestIndex - 2);
    const end = firstInRadius >= 0 ? Math.min(path.length, lastInRadius + 2) : Math.min(path.length, nearestIndex + 3);
    const local = path.slice(start, end);
    if (local.length >= 2) candidates.push({ points: local, nearestDistance, lengthM: pathLengthM(local) });
  }
  candidates.sort((a, b) => a.nearestDistance - b.nearestDistance || b.lengthM - a.lengthM);
  return candidates[0]?.points ?? null;
}

function stationRecords(stationName) {
  return publicData.stations.filter((station) => station.station_name === stationName);
}

function axesForStation(stationName) {
  return publicData.station_axes
    .filter((axis) => axis.station_name === stationName && Array.isArray(axis.endpoints) && axis.endpoints.length === 2)
    .filter((axis) => lineLabel(axis))
    .map((axis, index) => ({ ...axis, label: lineLabel(axis), index }))
    .sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
}

function uniqueAxisLines(axes) {
  const seen = new Set();
  return axes.filter((axis) => {
    const key = `${axis.label}|${axis.endpoints.map((point) => point.map((value) => value.toFixed(7)).join(",")).join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildModel(target, radiusM) {
  const records = stationRecords(target.stationName);
  if (records.length === 0) throw new Error(`공개 역 데이터 없음: ${target.stationName}`);
  const center = averagePoint(records.map((record) => [record.lng, record.lat]));
  const axes = uniqueAxisLines(axesForStation(target.stationName));
  const labels = [...new Set(axes.map((axis) => axis.label))];
  const displayName = subwayStationDisplayName(target.stationName);
  const stationFeatures = records.map((station, index) => ({
    fid: station.osm_id,
    layer: "rail_station",
    lng: station.lng,
    lat: station.lat,
    name: displayName,
    label: displayName,
    sublabel: labels.join("·"),
    labelPriority: 1,
    // 공개된 구 A01 저장 결과와 같은 메타데이터를 일부러 보존한다.
    // MapFigure는 이 badges를 그리지 않고 공유 rail scene만 사용해야 한다.
    badges: labels.slice(0, 4).map((label) => ({ text: railLineBadgeText(label), color: railLineColor(null, label) })),
    type: index === 0 ? "station" : "station-platform",
  }));
  const entranceFeatures = publicData.entrances
    .filter((entrance) => entrance.station_name === target.stationName)
    .filter((entrance) => distanceM(center, [entrance.lng, entrance.lat]) <= radiusM + 80)
    .map((entrance) => ({
      fid: entrance.osm_id,
      layer: "rail_entrance",
      lng: entrance.lng,
      lat: entrance.lat,
      name: `${displayName} ${entrance.entrance_ref}번 출구`,
      label: String(entrance.entrance_ref),
      labelPriority: 0,
    }));
  const axisLines = axes.map((axis, index) => ({
    fid: `axis-${axis.station_osm_id ?? records[0].osm_id}-${axis.label}-${index}`,
    layer: "rail_station_axis",
    points: axis.endpoints,
    name: null,
    label: axis.label,
    legendLabel: axis.label,
    color: railLineColor(null, axis.label),
    casing: railLineCasing(railLineColor(null, axis.label)),
    strokeWidth: 9,
    emphasis: railLineEmphasis(axis.label),
    labelPriority: 0,
  }));
  const routeByLabel = new Map();
  for (const rawLine of publicData.lines) {
    const label = lineLabel(rawLine);
    if (!label || !labels.includes(label) || routeByLabel.has(label)) continue;
    const points = localRoute(rawLine, center, radiusM);
    if (!points) continue;
    routeByLabel.set(label, {
      fid: `route-${label}`,
      layer: "rail_line",
      points,
      name: label,
      label,
      legendLabel: label,
      color: railLineColor(null, label),
      casing: railLineCasing(railLineColor(null, label)),
      strokeWidth: 2,
      emphasis: railLineEmphasis(label),
      labelPriority: 1,
    });
  }
  // Route geometry가 공개 스냅샷에서 누락된 옛 저장 결과도 같은 화면 계약으로
  // 확인할 수 있게, 역축이 있는 호선만 최소 fallback 선형을 만든다.
  for (const axis of axes) {
    if (routeByLabel.has(axis.label)) continue;
    routeByLabel.set(axis.label, {
      fid: `route-fallback-${axis.label}`,
      layer: "rail_line",
      points: axis.endpoints,
      name: axis.label,
      label: axis.label,
      legendLabel: axis.label,
      color: railLineColor(null, axis.label),
      casing: railLineCasing(railLineColor(null, axis.label)),
      strokeWidth: 2,
      emphasis: railLineEmphasis(axis.label),
      labelPriority: 1,
    });
  }
  return {
    center,
    radiusM,
    tileCode: "A01",
    features: [...stationFeatures, ...entranceFeatures],
    lines: [...axisLines, ...routeByLabel.values()],
    polygons: [],
    total: stationFeatures.length + entranceFeatures.length + axisLines.length + routeByLabel.size,
    notes: ["public/data/osm-subway.json rail slice"],
  };
}

function dataUrl(buffer, type = "image/png") {
  return `data:${type};base64,${Buffer.from(buffer).toString("base64")}`;
}

async function loadTileData(tile) {
  const cacheKey = `${tile.z}/${tile.x}/${tile.y}`;
  if (tileDataCache.has(cacheKey)) return tileDataCache.get(cacheKey);
  tileStats.requested += 1;
  const reply = await serveTile({ layer: "white", z: String(tile.z), y: String(tile.y), x: String(tile.x) }, null, { cacheRoot: tileCacheDir });
  const value = reply.status === 200 && reply.body instanceof Uint8Array ? dataUrl(reply.body, reply.type) : null;
  if (value) tileStats.loaded += 1;
  else tileStats.failed += 1;
  tileDataCache.set(cacheKey, value);
  return value;
}

async function loadBackground(center, cut) {
  if (process.env.RAIL_IMPL_SKIP_TILES === "1") return new Map();
  const viewport = framedViewport(center, cut.radiusM, cut.width, cut.height, 0.5, 0.8, 0.5);
  const entries = await Promise.all(tilesFor(viewport).map(async (tile) => [tileUrl("white", tile.z, tile.x, tile.y), await loadTileData(tile)]));
  return new Map(entries.filter(([, href]) => href));
}

function figureOptions(model, cut, background = new Map()) {
  return {
    model,
    width: cut.width,
    height: cut.height,
    fixed: true,
    basemap: "tiles",
    layer: "white",
    tileHref: (url) => background.get(url) ?? null,
    compact: cut.compact,
    view: cut.view,
    showAutomaticLabels: !cut.compact,
    legend: false,
    scale: false,
    north: false,
    showRadius: false,
    showSiteMarker: false,
    credit: false,
  };
}

function sceneOptions(model, cut) {
  return {
    model,
    width: cut.width,
    height: cut.height,
    activeLayer: "white",
    compact: cut.compact,
    view: cut.view,
    showAutomaticLabels: !cut.compact,
    showRadius: false,
    showSiteMarker: false,
    scale: false,
    north: false,
  };
}

function boxesOverlap(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function assertRailSceneContract(scene, targetId, cutId) {
  const labels = scene.rail.stationLabels;
  const stationKeys = new Set(labels.map((label) => label.stationKey));
  assert.ok(labels.length <= stationKeys.size, `${targetId}/${cutId}: 역 단지당 역명 1개 계약 위반`);
  for (let index = 0; index < labels.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < labels.length; otherIndex += 1) {
      assert.equal(boxesOverlap(labels[index].box, labels[otherIndex].box), false, `${targetId}/${cutId}: 역명 박스 겹침`);
    }
  }
  const visibleExitBoxes = scene.rail.exits.filter((exit) => !exit.demoted).map((exit) => exit.box);
  for (let index = 0; index < visibleExitBoxes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < visibleExitBoxes.length; otherIndex += 1) {
      assert.equal(boxesOverlap(visibleExitBoxes[index], visibleExitBoxes[otherIndex]), false, `${targetId}/${cutId}: 출구 표식 겹침`);
    }
  }
}

async function comparisonPanel(id, implementationPath, mockupPath) {
  const [implementation, mockup] = await Promise.all([
    sharp(implementationPath).resize(960, 600, { fit: "fill" }).png().toBuffer(),
    sharp(mockupPath).resize(960, 600, { fit: "fill" }).png().toBuffer(),
  ]);
  const header = Buffer.from(`<svg width="1920" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="1920" height="40" fill="#172033"/><text x="480" y="27" text-anchor="middle" font-family="Malgun Gothic, Noto Sans KR, sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">앱 구현 · MapFigure</text><text x="1440" y="27" text-anchor="middle" font-family="Malgun Gothic, Noto Sans KR, sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">승인 시안 3</text></svg>`);
  const panelPath = join(outputDir, `impl-vs-mockup-${id}.png`);
  await sharp({ create: { width: 1920, height: 640, channels: 4, background: "#F2F2EF" } })
    .composite([{ input: header, top: 0, left: 0 }, { input: implementation, top: 40, left: 0 }, { input: mockup, top: 40, left: 960 }])
    .png()
    .toFile(panelPath);
  return panelPath;
}

await mkdir(outputDir, { recursive: true });
const manifest = { source: publicDataPath, outputDir, targets: [], generatedAt: new Date().toISOString() };
let representativeModel = null;
for (const target of TARGETS) {
  const targetManifest = { id: target.id, stationName: target.stationName, variants: [] };
  const models = new Map();
  for (const cut of CUTS) {
    const model = models.get(cut.radiusM) ?? buildModel(target, cut.radiusM);
    models.set(cut.radiusM, model);
    if (target.id === "dogok" && cut.id === "detail-r300") representativeModel = model;
    const background = await loadBackground(model.center, cut);
    const options = figureOptions(model, cut, background);
    const svg = renderToStaticMarkup(createElement(MapFigure, options));
    const scene = buildMapScene(sceneOptions(model, cut));
    assertRailSceneContract(scene, target.id, cut.id);
    const stem = join(outputDir, `a01-rail-impl-${target.id}-${cut.id}`);
    await writeFile(`${stem}.svg`, svg, "utf8");
    await sharp(Buffer.from(svg)).png().toFile(`${stem}.png`);
    const variant = {
      id: cut.id,
      png: `${stem}.png`,
      svg: `${stem}.svg`,
      mpp: scene.mpp,
      axisCount: scene.rail.axes.length,
      routeCount: scene.rail.routes.length,
      stationLabelCount: scene.rail.stationLabels.length,
      exitCount: scene.rail.exits.length,
      exitVisible: scene.rail.exitVisible,
      compact: cut.compact,
    };
    if (cut.compact) {
      if (scene.rail.exits.length !== 0 || scene.rail.stationLabels.length !== 0 || scene.rail.routeLabels.length !== 0 || scene.rail.axisLabels.length !== 0) throw new Error(`${target.id}/${cut.id}: 카드 글자 또는 출구가 남음`);
      if (svg.includes("data-rail-exit=") || svg.includes("data-rail-station-label=")) throw new Error(`${target.id}/${cut.id}: 카드 SVG에 철도 라벨이 남음`);
    }
    if (cut.id === "detail-r1000" && scene.rail.exits.length !== 0) throw new Error(`${target.id}/${cut.id}: 1km 기본 뷰 출구가 보임`);
    if (cut.id === "detail-r300" && scene.rail.exits.length === 0) throw new Error(`${target.id}/${cut.id}: 300m 상세 출구가 없음`);
    if (cut.id === "detail-r1000-zoom" && scene.rail.exits.length === 0) throw new Error(`${target.id}/${cut.id}: 줌인 상세 출구가 없음`);
    targetManifest.variants.push(variant);
  }
  const detailPath = join(outputDir, `a01-rail-impl-${target.id}-detail-r300.png`);
  const mockupId = target.mockupId ?? target.id;
  const mockupPath = join(mockupDir, `rail-mockup-${mockupId}-detail-r300.png`);
  const panelPath = await comparisonPanel(target.id, detailPath, mockupPath);
  targetManifest.comparison = panelPath;
  manifest.targets.push(targetManifest);
  console.log(`${target.id}: axes=${targetManifest.variants[1].axisCount}, 1km exits=${targetManifest.variants[1].exitCount}, 300m exits=${targetManifest.variants[2].exitCount}, zoom exits=${targetManifest.variants[3].exitCount}`);
}
if (!representativeModel) throw new Error("대표 A01 PPT 모델이 만들어지지 않았습니다");
// PPT 16:9 지도 영역은 960×540이라 300m 기준 뷰의 m/px가 1.3을
// 살짝 넘는다. 네이티브 출구 도형까지 확인할 대표 슬라이드는 승인 시안의
// 상세 프레임보다 한 단계 더 들어간 250m 장면으로 만든다.
const representativePptModel = buildModel({ id: "dogok", stationName: "도곡" }, 250);
const pptCut = { id: "ppt", width: 960, height: 540, radiusM: 250, compact: false };
const pptBackground = await loadBackground(representativePptModel.center, pptCut);
const pptBackgroundSvg = renderToStaticMarkup(createElement(MapFigure, {
  ...figureOptions(representativePptModel, pptCut, pptBackground),
  backgroundOnly: true,
}));
const pptBackgroundPath = join(outputDir, "a01-rail-impl-representative-background.png");
await sharp(Buffer.from(pptBackgroundSvg)).png().toFile(pptBackgroundPath);
const fixtureA01 = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
if (!fixtureA01) throw new Error("A01 PPT fixture가 없습니다");
const fixtureView = toTileView(fixtureA01);
const representativeView = {
  ...fixtureView,
  tileId: "a01-rail-impl-dogok-r300",
  code: "A01",
  title: "역사·출구",
  map: representativePptModel,
  backdrop: representativePptModel,
  notes: ["공개 지하철 스냅샷 · 공유 MapScene"],
  sourceLine: "공개 지하철 스냅샷 · 2026-10-14",
};
const representativePlan = {
  kind: "tile",
  view: representativeView,
  body: { kind: "result", face: "single" },
  faceLabel: null,
  map: representativePptModel,
  muted: false,
  pinnedKeys: [],
  footer: "A01 역사·출구 네이티브 도형 회귀 · 기준일 2026-10-14",
  no: 1,
  total: 1,
};
const representativePng = await readFile(pptBackgroundPath);
const representativePptx = await renderReportPptx([representativePlan], { [representativeView.tileId]: `data:image/png;base64,${representativePng.toString("base64")}` });
const representativePptxPath = join(outputDir, "a01-rail-impl-representative.pptx");
await writeFile(representativePptxPath, representativePptx);
manifest.pptx = representativePptxPath;
manifest.basemap = { layer: "white", cacheDir: tileCacheDir, requested: tileStats.requested, loaded: tileStats.loaded, failed: tileStats.failed };
await writeFile(join(outputDir, "a01-rail-implementation-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`wrote ${representativePptxPath}`);
console.log(`wrote ${outputDir}`);

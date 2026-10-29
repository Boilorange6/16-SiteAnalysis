import PptxGenJS from "pptxgenjs";
import { buildingStyleForRaster, isBuildingLayer, layerStyle, legendItems, legendItemsForModel, legendLabelOf, modelLayerStyle, type MapModel } from "../ui/map-layers";
import { isSiteParcelLayer } from "../ui/site-parcel";
import { calloutLegendEntries, SLIDE, slideCalloutAvoidance, slideGeometry, slideLayout, slideLegend, slidePanelRects, slideReserved, slideSiteX, terrainSectionLayout, type SlideFormat } from "../ui/overlay-layout";
import { SLIDE_OVERVIEW_FILL, slideCalloutFrame } from "../ui/callout-layout";
import { buildMapScene, locatorBox, mapLabelEntries, nearestLineStroke, NORTH_GLYPH, NORTH_RADIUS, northArrowBox, northArrowPoints, RAIL_EXIT_COLOR, RAIL_EXIT_DOT_RADIUS, RAIL_EXIT_DOT_STROKE, SCALE_FONT_PX, SCALE_PANEL_ABOVE, SCALE_PANEL_BELOW, scaleBarBox, scaleChromeScaleForBox, scaleFontScaleForPt, type MapScene, type MapSceneBaseBucket, type MapSceneBox } from "../ui/map-scene";
import { baseTheme, type BaseThemeRef } from "../ui/map-theme";
import { badgeTextColor } from "../ui/map-labels";
import { terrainSectionMapStyle } from "../ui/terrain-section";
import { FONT, fontSizeForStyle, INK, hex, textIn, type Slide } from "./pptx-kit";
import type { PlannedSlide } from "./report-plan";
import type { PageStyle } from "../ui/board-state";
import { metersPerPixel, slideViewport, type BasemapChoice } from "../ui/map-projection";
import { scaleOptionsForFrame, zoomForScale } from "../ui/report-scale";
import { DEFAULT_REPORT_FONT_SIZES, type MapFrameState, type PagePanelRect, type ReportLayout } from "./report-doc";
import { mapLayoutUnitForFrame } from "./report-geometry";

const VIEW_W = 960;
const VIEW_H = 540;
const PX_PER_INCH = VIEW_W / SLIDE.w;
const PX_TO_PT = 0.75;
const MAX_LAYER_ELEMENTS = 1500;

function savedPanelBox(panel: PagePanelRect | undefined, basis: "page" | "frame" = "page"): MapSceneBox | null {
  if (!panel) return null;
  const sourceWidth = (basis === "page" ? activeGeometry.w : activeFrame.w) * activePxPerInch;
  const sourceHeight = (basis === "page" ? activeGeometry.h : activeFrame.h) * activePxPerInch;
  const originX = basis === "page" ? activeFrame.x * activePxPerInch : 0;
  const originY = basis === "page" ? activeFrame.y * activePxPerInch : 0;
  const x0 = Math.max(0, Math.min(activeSceneWidth - 1, panel.x * sourceWidth - originX));
  const y0 = Math.max(0, Math.min(activeSceneHeight - 1, panel.y * sourceHeight - originY));
  return { x0, y0, x1: Math.max(x0 + 1, Math.min(activeSceneWidth, x0 + panel.w * sourceWidth)), y1: Math.max(y0 + 1, Math.min(activeSceneHeight, y0 + panel.h * sourceHeight)) };
}

function boxScale(saved: MapSceneBox | null, automatic: MapSceneBox | null): number {
  if (!saved || !automatic) return 1;
  const savedWidth = Math.max(1, saved.x1 - saved.x0);
  const savedHeight = Math.max(1, saved.y1 - saved.y0);
  const automaticWidth = Math.max(1, automatic.x1 - automatic.x0);
  const automaticHeight = Math.max(1, automatic.y1 - automatic.y0);
  return Math.max(0.5, Math.min(3, (savedWidth / automaticWidth + savedHeight / automaticHeight) / 2));
}

export type NativeMapFrame = { x: number; y: number; w: number; h: number };
export type NativeMapMode = "tile" | "cell";
export type NativeMapOptions = {
  frame?: NativeMapFrame;
  mode?: NativeMapMode;
  /** 셀마다 같은 범례가 별도 그룹이 되도록 하는 슬라이드 내 scope. */
  scope?: string;
  /** 페이지 또는 조판 셀의 지도 설정. 셀에서는 지도 필드만 소비한다. */
  style?: PageStyle;
  /** 타일 지도에서 출처 띠 위까지의 로컬 장면 하단(px). 셀은 기본값(셀 전체)을 쓴다. */
  clipBottom?: number;
  /** 보고서 판형. 셀·기존 호출은 wide 기본값을 사용한다. */
  format?: SlideFormat;
  /** 보고서 편집기의 지도 프레임 상태. */
  reportFrame?: MapFrameState;
  /** report page layout, used for shared map geometry. */
  layout?: ReportLayout;
  /** 이 지도가 실제로 그리는 바탕(`exportBasemap` 결과). "vector"이면 장면의 바탕 묶음을 도형으로 그린다. */
  basemap?: BasemapChoice;
  /** 벡터 바탕 색 테마(보드 선택). 없으면 기본 테마. */
  baseTheme?: BaseThemeRef;
  /** 벡터 바탕 도형 다음, 주제 도형 앞에서 불린다. 값 래스터 그림을 이 자리에 넣는다. */
  underlay?: () => void;
};

export type NativeMapStatus = {
  code: string | undefined;
  native: boolean;
  reason: string;
  estimatedShapes: number;
  layerCounts: Record<string, number>;
  denseLayers: string[];
  /** 값 래스터·배경 타일은 늘 이미지로 남고, 이 목록은 도형 수 상한을 넘은 벡터 층이다. */
  rasterLayers: string[];
  /** scene에 대응하는 native 도형이 없는 값 래스터 이름. */
  rasterValues: string[];
};

const color = (value: string): string => hex(value);

const transparency = (opacity: number): number => Math.max(0, Math.min(100, Math.round((1 - opacity) * 100)));
const lineDash = (dash: string | undefined): "dash" | undefined => dash ? "dash" : undefined;
const safeKey = (value: string): string => value.replace(/[|\r\n]/g, "-").slice(0, 90);

function addCount(map: Map<string, number>, layer: string, count: number): void {
  map.set(layer, (map.get(layer) ?? 0) + count);
}

export function nativeMapStatus(model: MapModel): NativeMapStatus {
  const layerCounts = new Map<string, number>();
  for (const feature of model.features) addCount(layerCounts, feature.layer, 1);
  for (const polygon of model.polygons ?? []) if (!isSiteParcelLayer(polygon.layer)) addCount(layerCounts, polygon.layer, 1);
  for (const line of model.lines ?? []) addCount(layerCounts, line.layer, 1);
  const denseLayers = [...layerCounts.entries()].filter(([, count]) => count > MAX_LAYER_ELEMENTS).map(([layer]) => layer);
  const badgeCount = model.features.reduce((sum, feature) => sum + Math.min(4, feature.badges?.length ?? 0), 0);
  const estimatedShapes = 12
    + (model.features.length * 2)
    + ((model.polygons ?? []).length * 1)
    + ((model.lines ?? []).length * 2)
    + badgeCount * 2
    + Math.max(0, Math.ceil(model.radiusM / 500));
  const code = model.tileCode;
  // tileCode가 있는 지도는 모두 native 경로로 보낸다. 밀집 층은 아래
  // rasterLayers만 배경 SVG에 남겨 나머지 층의 편집성을 보존한다.
  const native = !!code;
  const reason = !code
    ? "tileCode 없음"
    : denseLayers.length > 0
      ? `레이어 도형 수 상한 초과: ${denseLayers.join(", ")}`
      : "tileCode 지도 네이티브 경로";
  return { code, native, reason, estimatedShapes, layerCounts: Object.fromEntries(layerCounts), denseLayers, rasterLayers: denseLayers, rasterValues: (model.rasters ?? []).map((raster) => raster.name) };
}

/**
 * 한 지도 자리를 무엇으로 그리는가. 그림 만들기(map-image)와 PPT 그리기(render-pptx)가 같은 판정을 쓴다.
 * - image "full": 지도 전체가 그림 한 장(JPEG). 이미지 한 장 모드, 도형화 못 하는 지도, 표지·출처 장.
 * - image "background": 편집 도형 아래 배경(타일·값 래스터·밀집 층)만 담은 JPEG.
 * - image "transparent": 벡터 바탕 위에 얹는 값 래스터·밀집 층만 담은 투명 PNG.
 * - image "none": 그림 없음(벡터 바탕이고 값 래스터·밀집 층도 없다).
 */
export type MapDrawPlan = { image: "none" | "transparent" | "background" | "full"; thematicShapes: boolean };

export function mapDrawPlan(status: NativeMapStatus, drawn: BasemapChoice, mapDrawing: "editable" | "image"): MapDrawPlan {
  if (mapDrawing === "image" || !status.native) return { image: "full", thematicShapes: false };
  if (drawn !== "vector") return { image: "background", thematicShapes: true };
  const hasRaster = status.rasterValues.length > 0 || status.rasterLayers.length > 0;
  return { image: hasRaster ? "transparent" : "none", thematicShapes: true };
}

export function isEditableMap(model: MapModel | null | undefined): boolean {
  return !!model && nativeMapStatus(model).native;
}

export function nativeMapFallbackNote(model: MapModel): string {
  const status = nativeMapStatus(model);
  const rasterNote = status.rasterValues.length > 0 ? ` 값 래스터 배경 유지: ${status.rasterValues.join(", ")}.` : "";
  return status.denseLayers.length > 0
    ? `지도 네이티브 도형 폴백: ${status.reason}. 해당 층은 배경 래스터로 유지했습니다.${rasterNote}`
    : status.rasterValues.length > 0
      ? `지도 네이티브 도형 폴백: 값 래스터는 도형화하지 않고 배경 래스터로 유지했습니다.${rasterNote}`
      : `지도 네이티브 도형 폴백: ${status.reason}. 이미지 배경/기존 지도 표현을 유지했습니다.`;
}

const FULL_FRAME: NativeMapFrame = { x: 0, y: 0, w: SLIDE.w, h: SLIDE.h };
let activeFrame = FULL_FRAME;
let activeFormat: SlideFormat = "wide";
let activeGeometry = slideGeometry();
let activePxPerInch = PX_PER_INCH;
let activeSceneWidth = VIEW_W;
let activeSceneHeight = VIEW_H;
let activeClipBottom = VIEW_H;
let activeRasterLayers = new Set<string>();
let activeMode: NativeMapMode = "tile";

const CELL_LEGEND_MAX_ITEMS = 4;
const CELL_LEGEND_ROW_H = 28;
const CELL_LEGEND_PAD = 10;

type CellLegendItem = ReturnType<typeof slideLegend>["items"][number];

function fullFrame(format: SlideFormat): NativeMapFrame {
  const geometry = slideGeometry(format);
  return { x: 0, y: 0, w: geometry.w, h: geometry.h };
}

function hiddenLayerMatches(layer: string, value: string): boolean {
  const needle = value.trim().toLowerCase();
  if (!needle) return false;
  const style = layerStyle(layer);
  return layer.toLowerCase() === needle
    || style.label.toLowerCase() === needle
    || (needle === "건물" && isBuildingLayer(layer));
}

function frameHidden(model: MapModel, hiddenLayers: readonly string[]): MapModel {
  if (hiddenLayers.length === 0) return model;
  const hidden = (layer: string) => hiddenLayers.some((value) => hiddenLayerMatches(layer, value));
  return {
    ...model,
    features: model.features.filter((feature) => !hidden(feature.layer)),
    polygons: model.polygons?.filter((polygon) => !hidden(polygon.layer)),
    lines: model.lines?.filter((line) => !hidden(line.layer)),
    siteParcel: model.siteParcel?.filter((polygon) => !hidden(polygon.layer)),
  };
}

function fixedScaleViewport(model: MapModel, style: PageStyle, frame: MapFrameState | undefined, dimensions: { width: number; height: number; siteX: number; siteY: number; fill: number }) {
  const base = slideViewport(model, { zoomDelta: 0, offsetM: [0, 0] }, dimensions);
  if (!frame || frame.scaleDenominator === null || !Number.isFinite(frame.scaleDenominator) || frame.scaleDenominator <= 0) {
    return slideViewport(model, style, dimensions);
  }
  const scaleOptions = scaleOptionsForFrame(activeFrame.w * 25.4, dimensions);
  const zoomDelta = zoomForScale(frame.scaleDenominator, model, scaleOptions);
  return slideViewport(model, { zoomDelta, offsetM: frame.offsetM }, dimensions);
}

function cellLegendItems(model: MapModel): CellLegendItem[] {
  const all = slideLegend(model, true, undefined, true, activeFormat).items;
  if (all.length <= CELL_LEGEND_MAX_ITEMS) return all;
  const site = all.find((item) => item.site);
  const nonSite = all.filter((item) => !item.site);
  const shown = nonSite.slice(0, Math.max(1, CELL_LEGEND_MAX_ITEMS - (site ? 2 : 1)));
  const hidden = all.length - shown.length - (site ? 1 : 0);
  return [
    ...shown,
    ...(site ? [site] : []),
    { layer: "__more__", label: `외 ${hidden}`, color: "#7A7E87" },
  ];
}

function cellLegendLayout(model: MapModel): { items: CellLegendItem[]; x: number; y: number; w: number; h: number; box: MapSceneBox } | null {
  const base = slideLegend(model, true, undefined, true, activeFormat).rect;
  if (!base) return null;
  const items = cellLegendItems(model);
  const x = 24;
  const measuredLabelW = Math.max(...items.map((item) => textIn(item.label, 8) * activePxPerInch), 0);
  // 8pt 셀 라벨은 PPT의 fit="shrink"에 맡기면 긴 역명이 끝에서 잘린다.
  // 측정 폭을 먼저 확보해 셀 전체 범위 안에서 범례 판을 넓힌다.
  const w = Math.min(activeSceneWidth - x * 2, Math.max(220, base.w * activePxPerInch, measuredLabelW + 46 + 18));
  const h = CELL_LEGEND_PAD * 2 + items.length * CELL_LEGEND_ROW_H;
  const y = activeSceneHeight - 24 - h;
  return { items, x, y, w, h, box: { x0: x, y0: y, x1: x + w, y1: y + h } };
}

function fontPt(value: number, regularFloor: number): number {
  return Math.max(activeMode === "cell" ? 8 : regularFloor, pxPt(value));
}

function pxX(x: number): number { return activeFrame.x + (x / activeSceneWidth) * activeFrame.w; }
function pxY(y: number): number { return activeFrame.y + (y / activeSceneHeight) * activeFrame.h; }
function pxW(value: number): number { return (value / VIEW_W) * activeFrame.w; }
function pxH(value: number): number { return (value / activeSceneHeight) * activeFrame.h; }
function pxPt(value: number): number { return value * PX_TO_PT * Math.min(activeFrame.w / activeGeometry.w, activeFrame.h / activeGeometry.h); }
function isRasterizedLayer(layer: string): boolean { return activeRasterLayers.has(layer); }

type PixelPoint = readonly [number, number];
type PixelPath = readonly PixelPoint[];
type ShapePart = { x: number; y: number; moveTo?: boolean } | { close: true };

/**
 * PowerPoint custom geometry는 브라우저 SVG보다 큰 점 배열에 취약하다.
 * 공개 철도 관계의 로컬 선형은 화면에서 이미 2px 선으로 보이므로, PPT
 * 네이티브 도형에만 균등 샘플링 상한을 적용해 모양은 유지하고 파일·호환성
 * 부담을 줄인다. MapFigure의 공유 scene 좌표 자체는 줄이지 않는다.
 */
const MAX_NATIVE_PATH_POINTS = 48;

function capNativePath(path: PixelPath): PixelPath {
  if (path.length <= MAX_NATIVE_PATH_POINTS) return path;
  const last = path.length - 1;
  return Array.from({ length: MAX_NATIVE_PATH_POINTS }, (_, index) => path[Math.round((index * last) / (MAX_NATIVE_PATH_POINTS - 1))]!);
}

/** PPT native geometry에는 화면 밖 조각을 넘기지 않는다. */
function clipSegmentToFrame(a: PixelPoint, b: PixelPoint, width: number, height: number): PixelPath | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [[-dx, a[0]], [dx, width - a[0]], [-dy, a[1]], [dy, height - a[1]]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

function clipRailPath(points: PixelPath, width = activeSceneWidth, height = activeClipBottom): PixelPath[] {
  const clipped: PixelPath[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = clipSegmentToFrame(points[index - 1]!, points[index]!, width, height);
    if (!segment) continue;
    const previous = clipped.at(-1);
    const joins = previous && Math.hypot(previous.at(-1)![0] - segment[0]![0], previous.at(-1)![1] - segment[0]![1]) < 0.01;
    if (joins) clipped[clipped.length - 1] = [...previous!, segment[1]!];
    else clipped.push(segment);
  }
  return clipped;
}

function clipOpenPath(points: PixelPath, width = activeSceneWidth, height = activeClipBottom): PixelPath[] {
  const clipped: PixelPath[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = clipSegmentToFrame(points[index - 1]!, points[index]!, width, height);
    if (!segment) continue;
    const previous = clipped.at(-1);
    const joins = previous && Math.hypot(previous.at(-1)![0] - segment[0]![0], previous.at(-1)![1] - segment[0]![1]) < 0.01;
    if (joins) clipped[clipped.length - 1] = [...previous!, segment[1]!];
    else clipped.push(segment);
  }
  return clipped;
}

function clipClosedPath(path: PixelPath, width = activeSceneWidth, height = activeClipBottom): PixelPath | null {
  if (path.length < 3) return null;
  const source: PixelPoint[] = path.length > 1 && path[0]![0] === path.at(-1)![0] && path[0]![1] === path.at(-1)![1]
    ? path.slice(0, -1)
    : [...path];
  type Boundary = { inside: (point: PixelPoint) => boolean; intersect: (a: PixelPoint, b: PixelPoint) => PixelPoint };
  const boundary = (inside: Boundary["inside"], coordinate: (point: PixelPoint) => number, limit: number): Boundary => ({
    inside,
    intersect: (a, b) => {
      const delta = coordinate(b) - coordinate(a);
      const t = delta === 0 ? 0 : (limit - coordinate(a)) / delta;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    },
  });
  const boundaries: Boundary[] = [
    boundary(([x]) => x >= 0, ([x]) => x, 0),
    boundary(([x]) => x <= width, ([x]) => x, width),
    boundary(([, y]) => y >= 0, ([, y]) => y, 0),
    boundary(([, y]) => y <= height, ([, y]) => y, height),
  ];
  let output = source;
  for (const edge of boundaries) {
    if (output.length === 0) return null;
    const next: PixelPoint[] = [];
    let previous = output.at(-1)!;
    for (const current of output) {
      const currentInside = edge.inside(current);
      const previousInside = edge.inside(previous);
      if (currentInside !== previousInside) next.push(edge.intersect(previous, current));
      if (currentInside) next.push(current);
      previous = current;
    }
    output = next;
  }
  return output.length >= 3 ? output : null;
}

function rectInsideFrame(x: number, y: number, w: number, h: number): boolean {
  return x >= -1e-6 && y >= -1e-6 && x + w <= activeSceneWidth + 1e-6 && y + h <= activeClipBottom + 1e-6;
}

function rectToFrame(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(activeSceneWidth, x + w);
  const y1 = Math.min(activeClipBottom, y + h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function tag(code: string, key: string, display: string, part: string): string {
  return `GRP|map-${safeKey(code)}-${safeKey(key)}|${safeKey(display)}|${safeKey(part)}`;
}

function legendLabelFor(model: MapModel, layer: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const presented = legendItemsForModel(model);
  const exact = presented.find((item) => item.layer === layer);
  if (exact) return exact.label;
  const style = layerStyle(layer);
  return presented.find((item) => item.label === style.label)?.label ?? legendItems(model).find((item) => item.label === style.label)?.label ?? style.label;
}

function legendTag(model: MapModel, code: string, layer: string, part: string, explicit?: string): string {
  const label = legendLabelFor(model, layer, explicit);
  return tag(code, `legend-${safeKey(label)}`, `범례 ${label}`, part);
}

/** Douglas-Peucker. 닫힌 고리는 첫 점을 끝에 한 번 더 붙여 돌린 뒤 떼어 낸다. */
function simplifyPath(path: PixelPath, tolerance: number, closed: boolean): PixelPath {
  const source: PixelPoint[] = closed ? [...path, path[0]!] : [...path];
  if (source.length <= 2) return path;
  const keep = new Uint8Array(source.length);
  keep[0] = 1;
  keep[source.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, source.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = source[a]!;
    const [bx, by] = source[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    let far = -1;
    let farDistance = tolerance;
    for (let index = a + 1; index < b; index += 1) {
      const [px, py] = source[index]!;
      const distance = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * (px - ax) - dx * (py - ay)) / length;
      if (distance > farDistance) { farDistance = distance; far = index; }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const kept = source.filter((_, index) => keep[index] === 1);
  return closed ? kept.slice(0, -1) : kept;
}

function addCustom(
  slide: Slide,
  paths: readonly PixelPath[],
  options: { fill?: string; fillOpacity?: number; line?: string; lineWidth?: number; lineOpacity?: number; dash?: string; objectName: string; closed?: boolean; simplify?: number },
): void {
  // 면·선 모두 출처 띠 위의 지도 프레임 안으로 잘라낸 뒤 PPT에 넘긴다.
  const clippedPaths = options.closed
    ? paths.flatMap((path) => {
      const clipped = clipClosedPath(path);
      return clipped ? [clipped] : [];
    })
    : paths.flatMap((path) => clipOpenPath(path));
  // simplify가 있으면(벡터 바탕) 꼭짓점 상한 없이 그 허용오차(px)로만 줄인다. 아니면 기존 균등 샘플링 상한.
  const nativePaths = options.simplify !== undefined
    ? clippedPaths.map((path) => simplifyPath(path, options.simplify!, !!options.closed)).filter((path) => path.length >= (options.closed ? 3 : 2))
    : options.closed ? clippedPaths : clippedPaths.map(capNativePath);
  const points = nativePaths.flatMap((path) => path);
  if (points.length < 2) return;
  const hasFill = !!options.fill && options.fill !== "none";
  const hasLine = !!options.line && options.line !== "none";
  // 바탕 묶음은 점이 수만 개일 수 있어 Math.min(...배열) 대신 한 번 훑는다.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    const px = pxX(x);
    const py = pxY(y);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const parts: ShapePart[] = [];
  for (const path of nativePaths) {
    if (path.length < 2) continue;
    path.forEach(([x, y], index) => parts.push({ x: pxX(x) - minX, y: pxY(y) - minY, ...(index === 0 ? { moveTo: true } : {}) }));
    if (options.closed) parts.push({ close: true });
  }
  if (parts.length === 0) return;
  slide.addShape("custGeom" as PptxGenJS.SHAPE_NAME, {
    x: minX,
    y: minY,
    w: Math.max(0.005, maxX - minX),
    h: Math.max(0.005, maxY - minY),
    points: parts,
    fill: { color: color(hasFill ? options.fill! : "FFFFFF"), transparency: hasFill ? transparency(options.fillOpacity ?? 1) : 100 },
    line: {
      color: color(hasLine ? options.line! : "000000"),
      width: Math.max(0.1, pxPt(options.lineWidth ?? 1)),
      transparency: hasLine ? transparency(options.lineOpacity ?? 1) : 100,
      dashType: lineDash(options.dash),
    },
    objectName: options.objectName,
  });
}

/**
 * 같은 색 점 여러 개를 custGeom 한 도형으로 그린다(점마다 원 하위 경로). 좌표·반지름은 슬라이드 inch.
 * 점이 수천 개여도 도형은 하나라 PPT에서 색 하나 = 선택 대상 하나다. stroke의 widthPt는 pt(배율 없음).
 */
export function addDots(slide: Slide, points: readonly (readonly [number, number])[], r: number, fillColor: string, opacity: number, objectName: string, stroke?: { color: string; widthPt: number }): void {
  if (points.length === 0) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x - r < minX) minX = x - r;
    if (x + r > maxX) maxX = x + r;
    if (y - r < minY) minY = y - r;
    if (y + r > maxY) maxY = y + r;
  }
  const parts: NonNullable<PptxGenJS.ShapeProps["points"]> = [];
  for (const [x, y] of points) {
    const left = x - r - minX;
    const right = x + r - minX;
    const cy = y - minY;
    // 왼쪽 끝에서 위쪽을 지나 오른쪽 끝까지, 다시 아래쪽을 지나 왼쪽 끝까지 반원 둘.
    parts.push(
      { x: left, y: cy, moveTo: true },
      { x: right, y: cy, curve: { type: "arc", wR: r, hR: r, stAng: 180, swAng: 180 } },
      { x: left, y: cy, curve: { type: "arc", wR: r, hR: r, stAng: 0, swAng: 180 } },
      { close: true },
    );
  }
  slide.addShape("custGeom" as PptxGenJS.SHAPE_NAME, {
    x: minX,
    y: minY,
    w: Math.max(0.005, maxX - minX),
    h: Math.max(0.005, maxY - minY),
    points: parts,
    fill: { color: color(fillColor), transparency: transparency(opacity) },
    line: stroke ? { color: color(stroke.color), width: stroke.widthPt } : { color: color(fillColor), width: 0, transparency: 100 },
    objectName,
  });
}

function addSegment(slide: Slide, a: PixelPoint, b: PixelPoint, lineColor: string, width: number, objectName: string, transparencyValue = 0, dash?: string): void {
  const clipped = clipSegmentToFrame(a, b, activeSceneWidth, activeClipBottom);
  if (!clipped) return;
  const [start, end] = clipped;
  slide.addShape("line", {
    x: Math.min(pxX(start[0]), pxX(end[0])),
    y: Math.min(pxY(start[1]), pxY(end[1])),
    w: Math.max(Math.abs(pxX(end[0]) - pxX(start[0])), 0.005),
    h: Math.max(Math.abs(pxY(end[1]) - pxY(start[1])), 0.005),
    line: { color: color(lineColor), width: Math.max(0.1, pxPt(width)), transparency: transparencyValue, dashType: lineDash(dash) },
    flipV: pxX(end[0]) >= pxX(start[0]) !== pxY(end[1]) >= pxY(start[1]),
    objectName,
  });
}

function lineTickSegments(points: readonly PixelPoint[], size: number): Array<[PixelPoint, PixelPoint]> {
  const ticks: Array<[PixelPoint, PixelPoint]> = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const nx = -dy / length * size;
    const ny = dx / length * size;
    ticks.push([[mx - nx, my - ny], [mx + nx, my + ny]]);
  }
  return ticks;
}

function sceneFor(model: MapModel, options: { plan?: PlannedSlide & { kind: "tile" }; mode?: NativeMapMode; style?: PageStyle; format?: SlideFormat; reportFrame?: MapFrameState; layout?: ReportLayout; basemap?: BasemapChoice; baseTheme?: BaseThemeRef }): MapScene {
  const mode = options.mode ?? "tile";
  const format = options.format ?? activeFormat;
  const reportFrame = options.reportFrame;
  const displayModel = frameHidden(model, reportFrame?.hiddenLayers ?? []);
  if (mode === "cell") {
    const width = VIEW_W;
    const height = activeSceneHeight;
    const cellLegend = cellLegendLayout(displayModel);
    const style = options.style ?? {};
    const cellUnit = mapLayoutUnitForFrame(activeFrame.h * activePxPerInch);
    const savedNorthBox = savedPanelBox(style.panels?.north, "frame");
    const savedScaleBox = savedPanelBox(style.panels?.scaleBar, "frame");
    const cellViewport = slideViewport(displayModel, style, { width, height, siteX: 0.5, fill: 0.8 });
    const cellMpp = metersPerPixel(cellViewport.center[1], cellViewport.zoom);
    const defaultNorthBox = northArrowBox(width, height, 0, undefined, cellUnit);
    const defaultScaleBox = scaleBarBox(width, height, cellMpp, cellLegend ? cellLegend.h + 32 : 0, 0, false, undefined, cellUnit);
    const northScale = boxScale(savedNorthBox, defaultNorthBox);
    const scaleChromeScale = scaleChromeScaleForBox(savedScaleBox, defaultScaleBox);
    const focus = legendLabelOf(displayModel, style.legendFocus);
    // 조판 셀의 코드 chip은 map scene 위에 마지막으로 그려진다. 고정·자동
    // 라벨 카드가 chip 아래에서 시작하도록 셀 좌표의 상단 안전영역을 예약한다.
    const cellChipBottom = ((0.1 + 0.3) / activeFrame.h) * height;
    return buildMapScene({
      model: displayModel,
      width,
      height,
      activeLayer: options.basemap === "vector" ? "vector" : displayModel.basemap ?? "white",
      baseTheme: options.baseTheme,
      siteX: 0.5,
      bottomInset: cellLegend ? cellLegend.h + 32 : 0,
      scale: true,
      compact: true,
      pinnedKeys: style.pinnedKeys ?? [],
      hiddenKeys: style.hiddenKeys ?? [],
      deletedElementKeys: reportFrame?.deletedElementKeys ?? [],
      labelBoxes: reportFrame?.labelBoxes ?? {},
      highlightLabel: focus,
      legendFocus: focus,
      // 2x2 셀에서는 자동 콜아웃을 모두 쌓으면 카드가 지도를 압도한다.
      // pinnedKeys로 고정한 사용자 라벨은 아래 후보에 계속 포함된다.
      showAutomaticLabels: false,
      labelScale: fontSizeForStyle(style, "labels") / 10,
      scaleFontScale: scaleFontScaleForPt(fontSizeForStyle(style, "scale")),
      legendBox: cellLegend?.box ?? null,
      calloutTop: cellChipBottom + 8 * cellUnit,
      avoid: [],
      bare: false,
      viewport: slideViewport(displayModel, style, { width, height, siteX: 0.5, fill: 0.8 }),
      northScale,
      scaleChromeScale,
      ...(savedNorthBox ? { north: savedNorthBox.y0 + (savedNorthBox.y1 - savedNorthBox.y0) / 2, northX: (savedNorthBox.x0 + savedNorthBox.x1) / 2 } : {}),
      ...(savedScaleBox ? { scaleX: savedScaleBox.x0 + 6 * cellUnit, scaleY: savedScaleBox.y1 - 8 * cellUnit, scaleBoxOverride: savedScaleBox } : {}),
    });
  }
  const plan = options.plan!;
  const style = options.style ?? plan.style ?? {};
  const frameStyle: PageStyle = reportFrame
    ? {
        ...style,
        zoomDelta: reportFrame.zoomDelta,
        offsetM: reportFrame.offsetM,
        pinnedKeys: [...new Set([...(style.pinnedKeys ?? []), ...reportFrame.pinnedKeys])],
        hiddenKeys: [...new Set([...(style.hiddenKeys ?? []), ...reportFrame.hiddenLabelKeys])],
      }
    : style;
  const hasSummary = style.summary !== false && !(plan.callout && plan.callout.page > 0);
  const baseLegend = slideLegend(displayModel, !plan.muted, undefined, hasSummary, format, reportFrame?.legend ?? {}).rect;
  const panels = slidePanelRects(style, hasSummary, baseLegend, format);
  const terrainShown = plan.view.code === "D17" && !!plan.view.terrainSections && !!plan.terrainSection;
  const terrainLayout = terrainShown ? terrainSectionLayout(panels, slideLayout(format), format) : null;
  const legend = panels.legend;
  const calloutOverview = !!plan.callout && plan.callout.page === 0;
  const calloutDetail = !!plan.callout && plan.callout.page > 0 ? slideCalloutFrame(4) : null;
  const layout = slideLayout(format);
  const calloutEntries = calloutOverview ? calloutLegendEntries(plan.callout!.model, reportFrame?.legend) : [];
  const calloutAlignment = calloutDetail ? null : slideCalloutAvoidance(panels, calloutEntries, layout, format, fontSizeForStyle(style, "legend") / DEFAULT_REPORT_FONT_SIZES.legend);
  const calloutLegend = calloutAlignment?.calloutLegend ?? null;
  const geometry = slideGeometry(format);
  const summaryX = panels.summary?.x ?? geometry.w;
  const gap = geometry.edge * activePxPerInch * 0.5;
  const siteX = calloutDetail?.siteX ?? slideSiteX(style, hasSummary, format);
  const fill = calloutDetail?.fill ?? terrainLayout?.mapFill ?? (calloutOverview ? SLIDE_OVERVIEW_FILL : undefined);
  const rightInset = calloutDetail ? 0 : hasSummary ? Math.max(0, VIEW_W - summaryX * activePxPerInch + gap) : geometry.edge * activePxPerInch;
  // 방위표는 지도 scene의 고정 y(22u)만 쓰면 크게 키운 제목 판과 겹친다.
  // 제목 판 아래에 방위표 반지름과 안전 간격을 확보한 중심을 전달한다.
  const calloutTopPx = calloutAlignment ? calloutAlignment.calloutTop * activePxPerInch : (panels.title.y + panels.title.h) * activePxPerInch + gap;
  const height = activeSceneHeight;
  const northY = calloutTopPx + NORTH_RADIUS * Math.min(1.5, Math.max(1, height / 360));
  const bottomInset = geometry.stripH * activePxPerInch + (calloutLegend ? (calloutLegend.h + 0.18) * activePxPerInch : 0);
  const viewport = fixedScaleViewport(displayModel, frameStyle, reportFrame, { width: VIEW_W, height, siteX, siteY: terrainLayout?.mapSiteY ?? 0.5, fill: fill ?? 0.8 });
  const showScale = reportFrame?.decorations.scaleBar ?? true;
  const showNorth = reportFrame?.decorations.north ?? true;
  const savedNorthBox = savedPanelBox(style.panels?.north);
  const savedScaleBox = savedPanelBox(style.panels?.scaleBar);
  const nativeScaleMaxPx = reportFrame?.scaleDenominator !== null && reportFrame?.scaleDenominator !== undefined ? 150 : undefined;
  const defaultScaleBox = calloutDetail || !showScale ? null : scaleBarBox(VIEW_W, height, metersPerPixel(viewport.center[1], viewport.zoom), bottomInset, rightInset, false, undefined, undefined, nativeScaleMaxPx);
  const defaultNorthBox = calloutDetail || !showNorth ? null : northArrowBox(VIEW_W, height, rightInset, northY);
  const scaleAvoid = savedScaleBox ?? defaultScaleBox;
  const northAvoid = savedNorthBox ?? defaultNorthBox;
  const northScale = boxScale(savedNorthBox, defaultNorthBox);
  const scaleChromeScale = scaleChromeScaleForBox(savedScaleBox, defaultScaleBox);
  const frameOriginX = activeFrame.x * activePxPerInch;
  const frameOriginY = activeFrame.y * activePxPerInch;
  const localize = (box: MapSceneBox): MapSceneBox => ({ x0: box.x0 - frameOriginX, y0: box.y0 - frameOriginY, x1: box.x1 - frameOriginX, y1: box.y1 - frameOriginY });
  const avoid = calloutDetail
    ? []
     : [...slideReserved(activePxPerInch, { info: hasSummary, titleRect: panels.title, infoRect: panels.summary, legend, calloutLegend, terrainSection: terrainLayout?.rect, format }).map(localize), ...(savedScaleBox ? [] : scaleAvoid ? [scaleAvoid] : []), ...(savedNorthBox ? [] : northAvoid ? [northAvoid] : [])];
  const focus = legendLabelOf(displayModel, style.legendFocus);
  const pinnedKeys = [...new Set([
    ...(plan.pinnedKeys ?? []),
    ...(frameStyle.pinnedKeys ?? []),
    ...(reportFrame?.labelRule === "all-visible" ? mapLabelEntries(displayModel).map((entry) => entry.key) : []),
  ])];
  return buildMapScene({
    rightInset,
    ...(calloutDetail ? {} : { calloutTop: calloutTopPx }),
    ...(calloutAlignment?.calloutLeftBottom !== undefined
      ? { calloutLeftBottom: calloutAlignment.calloutLeftBottom * activePxPerInch }
      : terrainLayout?.calloutLeftBottom !== undefined ? { calloutLeftBottom: terrainLayout.calloutLeftBottom * activePxPerInch } : {}),
    model: displayModel,
    width: VIEW_W,
    height,
    activeLayer: options.basemap === "vector" ? "vector" : displayModel.basemap ?? "white",
    baseTheme: options.baseTheme,
    fill,
    siteX,
    bottomInset,
    scale: !calloutDetail,
    muted: !!plan.muted,
    pinnedKeys,
    hiddenKeys: frameStyle.hiddenKeys ?? [],
    deletedElementKeys: reportFrame?.deletedElementKeys ?? [],
    labelBoxes: reportFrame?.labelBoxes ?? {},
    terrainSection: plan.terrainSection,
    highlightLabel: focus,
    legendFocus: focus,
    showAutomaticLabels: reportFrame?.labelRule !== "off",
    labelScale: fontSizeForStyle(frameStyle, "labels") / 10,
    scaleFontScale: scaleFontScaleForPt(fontSizeForStyle(frameStyle, "scale")),
    northScale,
    scaleChromeScale,
    north: showNorth ? (savedNorthBox ? (savedNorthBox.y0 + savedNorthBox.y1) / 2 : northY) : false,
    ...(savedNorthBox ? { northX: (savedNorthBox.x0 + savedNorthBox.x1) / 2 } : {}),
    ...(savedScaleBox ? { scaleX: savedScaleBox.x0 + 6 * Math.min(1.5, Math.max(1, height / 360)), scaleY: savedScaleBox.y1 - 8 * Math.min(1.5, Math.max(1, height / 360)), scaleBoxOverride: savedScaleBox } : {}),
    avoid,
    bare: false,
    viewport,
    ...(nativeScaleMaxPx !== undefined ? { scaleMaxPx: nativeScaleMaxPx } : {}),
  });
}

type Bucket = { paths: PixelPath[]; fill?: string; fillOpacity?: number; line?: string; lineWidth?: number; lineOpacity?: number; dash?: string; key: string; display: string };

function addBuckets(slide: Slide, code: string, buckets: Map<string, Bucket>, closed: boolean): void {
  for (const bucket of buckets.values()) {
    addCustom(slide, bucket.paths, {
      fill: bucket.fill,
      fillOpacity: bucket.fillOpacity,
      line: bucket.line,
      lineWidth: bucket.lineWidth,
      lineOpacity: bucket.lineOpacity,
      dash: bucket.dash,
      closed,
      objectName: tag(code, bucket.key, bucket.display, "geometry"),
    });
  }
}

const BASE_LAYER_NAME: Record<MapSceneBaseBucket["layer"], string> = { water: "물", green: "녹지", parcel: "필지선", road: "도로", rail: "철도", building: "건물", station: "역" };
/** 바탕 도형은 0.25px보다 작은 편차의 꼭짓점만 줄인다(1000 m 장면에서 0.25px는 약 1 m 미만). */
const BASE_SIMPLIFY_PX = 0.25;
const BASE_MUTED_OPACITY = 0.55;

/**
 * 벡터 바탕을 PPT 도형으로 옮긴다: 프레임 안 바탕색 사각형 1개 + 묶음마다 custGeom 1개. 이름 라벨은 addBaseLabels(주제 면·선 위).
 * 화면(MapFigure)과 같은 scene.base를 쓰므로 층 순서·색·굵기가 같다. 도형 이름은 `GRP|map-<code>-<layer>|바탕 · <층>|<묶음>`.
 * code는 슬라이드 안에서 지도마다 다른 값("base", 조판 칸은 "cell-N-base").
 */
function addBaseMap(slide: Slide, code: string, scene: MapScene, muted: boolean): void {
  const base = scene.base;
  if (!base) return;
  const fade = muted ? BASE_MUTED_OPACITY : 1;
  const bg = { x: activeFrame.x, y: activeFrame.y, w: activeFrame.w, h: activeFrame.h, fill: { color: color(base.bg) }, line: { color: color(base.bg), width: 0, transparency: 100 }, objectName: tag(code, "bg", "바탕 · 바탕색", "rect") };
  if (activeMode === "cell") slide.addShape("roundRect", { ...bg, rectRadius: 0.08 });
  else slide.addShape("rect", bg);
  for (const bucket of base.buckets) {
    addCustom(slide, bucket.paths, {
      fill: bucket.fill ?? undefined,
      fillOpacity: fade,
      line: bucket.stroke ?? undefined,
      lineWidth: bucket.strokeWidth,
      lineOpacity: (bucket.opacity ?? 1) * fade,
      dash: bucket.dash,
      closed: bucket.closed,
      simplify: BASE_SIMPLIFY_PX,
      objectName: tag(code, bucket.layer, `바탕 · ${BASE_LAYER_NAME[bucket.layer]}`, bucket.key),
    });
  }
}

/** 바탕 이름 라벨: 주제 면·선 위, 점·대지 표식·주제 라벨 아래(화면 MapFigure의 data-map-base="labels"와 같은 자리). */
function addBaseLabels(slide: Slide, code: string, scene: MapScene, muted: boolean): void {
  for (const label of scene.base?.labels ?? []) {
    const pt = fontPt(label.fontSize, 6);
    const w = textIn(label.text, pt) + 0.12;
    const h = (pt / 72) * 1.5;
    const key = `label-${label.key.replace(/^base-/, "")}`;
    const display = `바탕 라벨 · ${label.text}`;
    const common = {
      x: pxX(label.x) - w / 2,
      y: pxY(label.y) - h / 2,
      w,
      h,
      align: "center" as const,
      valign: "middle" as const,
      fontFace: FONT,
      fontSize: pt,
      bold: label.kind === "station",
      margin: 0,
      wrap: false,
      ...(label.angle ? { rotate: label.angle } : {}),
    };
    // 화면의 paint-order 후광: 같은 글자를 후광색 윤곽선으로 한 번 더 깔고 그 위에 글자를 얹는다.
    // 흐린 장은 화면처럼 라벨도 55%로 옅게: 윤곽선은 투명도를 줄 수 없어 후광은 생략하고 글자만 옅게 한다.
    if (!muted) slide.addText(label.text, { ...common, color: color(label.halo), outline: { size: Math.max(1.2, pxPt(Math.max(2, label.fontSize * 0.3))), color: color(label.halo) }, objectName: tag(code, key, display, "halo") });
    slide.addText(label.text, { ...common, color: color(label.color), ...(muted ? { transparency: transparency(BASE_MUTED_OPACITY) } : {}), objectName: tag(code, key, display, "text") });
  }
}

function addPolygons(slide: Slide, code: string, scene: MapScene, model: MapModel): void {
  const buckets = new Map<string, Bucket>();
  const hasRaster = (model.rasters?.length ?? 0) > 0;
  for (const polygon of scene.polygons) {
    if (isSiteParcelLayer(polygon.polygon.layer) || isRasterizedLayer(polygon.polygon.layer)) continue;
    const legendLabel = legendLabelFor(model, polygon.polygon.layer);
    const groupKey = `legend-${safeKey(legendLabel)}`;
    const style = modelLayerStyle(model, polygon.polygon.layer);
    const estimated = polygon.polygon.layer.endsWith("_est") || style.label.startsWith("[추정]") || style.hatch === true;
    const neutral = hasRaster && isBuildingLayer(polygon.polygon.layer);
    const building = buildingStyleForRaster(polygon.polygon.layer, hasRaster);
    const fill = neutral ? building.fill : estimated ? (style.fill ?? style.color) : (style.fill ?? style.color);
    const dimmed = scene.isElementDimmed(polygon.polygon.layer, polygon.key);
    const fillOpacity = (neutral ? building.fillOpacity ?? scene.polygonOpacity : style.fillOpacity ?? scene.polygonOpacity) * (dimmed ? 0.2 : 1);
    const stroke = neutral ? building.stroke : style.stroke ?? style.color;
    const lineWidth = neutral ? building.strokeWidth ?? 0.8 : style.strokeWidth ?? 1;
    const lineOpacity = dimmed ? 0.2 : 1;
    const dash = estimated ? "dash" : undefined;
    const key = `${groupKey}-polygon-${safeKey(`${fill}-${fillOpacity}-${stroke}-${lineWidth}-${lineOpacity}-${dash ?? "solid"}`)}`;
    const bucket = buckets.get(key) ?? { paths: [], fill, fillOpacity, line: stroke, lineWidth, lineOpacity, dash, key: groupKey, display: `범례 ${legendLabel}` };
    bucket.paths.push(...polygon.rings);
    buckets.set(key, bucket);
  }
  addBuckets(slide, code, buckets, true);
}

function addLines(slide: Slide, code: string, scene: MapScene, model: MapModel): void {
  const buckets = new Map<string, Bucket>();
  const ticks: Array<{ points: Array<[PixelPoint, PixelPoint]>; color: string; width: number; opacity: number; key: string }> = [];
  for (const entry of scene.lines) {
    if (isRasterizedLayer(entry.line.layer) || entry.line.layer === "rail_line" || entry.line.layer === "rail_station_axis") continue;
    if (entry.points.length < 2) continue;
    const style = modelLayerStyle(model, entry.line.layer);
    const sectionId = entry.line.layer === "terrain_section_a" ? "A" : entry.line.layer === "terrain_section_b" ? "B" : null;
    const sectionStyle = sectionId ? terrainSectionMapStyle(sectionId, scene.terrainSection) : null;
    const baseWidth = sectionStyle?.strokeWidth ?? entry.line.strokeWidth ?? style.strokeWidth ?? 1.5;
    const width = sectionStyle ? baseWidth : baseWidth * (entry.line.emphasis === "major" ? 1.2 : entry.line.emphasis === "minor" ? 0.85 : 1);
    const opacity = sectionStyle?.opacity ?? entry.line.opacity ?? style.opacity ?? 1;
    const dash = sectionStyle ? sectionStyle.dash : style.dash;
    const dimmed = scene.isElementDimmed(entry.line.layer, entry.key, entry.line.legendLabel);
    const stroke = entry.line.color ?? style.color;
    const casing = entry.line.casing ?? style.casing;
    const casingWidth = entry.line.casingWidth ?? width + 2.4;
    const legendLabel = legendLabelFor(model, entry.line.layer, entry.line.legendLabel);
    const groupKey = `legend-${safeKey(legendLabel)}`;
    if (casing) {
      const key = `${groupKey}-line-casing-${safeKey(`${casing}-${casingWidth}-${dimmed}-${dash ?? "solid"}`)}`;
      const bucket = buckets.get(key) ?? { paths: [], line: casing, lineWidth: casingWidth, lineOpacity: opacity * (dimmed ? 0.2 : 1), dash, key: groupKey, display: `범례 ${legendLabel}` };
      bucket.paths.push(entry.points);
      buckets.set(key, bucket);
    }
    const key = `${groupKey}-line-${safeKey(`${stroke}-${width}-${dimmed}-${dash ?? "solid"}`)}`;
    const bucket = buckets.get(key) ?? { paths: [], line: stroke, lineWidth: width, lineOpacity: opacity * (dimmed ? 0.2 : 1), dash, key: groupKey, display: `범례 ${legendLabel}` };
    bucket.paths.push(entry.points);
    buckets.set(key, bucket);
    if (style.tickMarks) ticks.push({ points: lineTickSegments(entry.points, 4), color: stroke, width: Math.max(0.7, width * 0.55), opacity: opacity * (dimmed ? 0.2 : 1), key: `${groupKey}-tick-${entry.index}` });
  }
  addBuckets(slide, code, buckets, false);
  for (const entry of ticks) for (const [index, [start, end]] of entry.points.entries()) addSegment(slide, start, end, entry.color, entry.width, tag(code, entry.key, "옹벽", `tick-${index}`), transparency(entry.opacity));
}

function addRadius(slide: Slide, code: string, scene: MapScene): void {
  const [cx, cy] = scene.center;
  for (const [index, radius] of scene.rings.entries()) {
    if (!rectInsideFrame(cx - radius, cy - radius, radius * 2, radius * 2)) continue;
    slide.addShape("ellipse", { x: pxX(cx - radius), y: pxY(cy - radius), w: pxW(radius * 2), h: pxH(radius * 2), fill: { color: "FFFFFF", transparency: 100 }, line: { color: color(scene.ringColor), width: pxPt(1), transparency: scene.activeLayer === "Satellite" ? 30 : 65, dashType: "dash" }, objectName: tag(code, "radius", "반경", `ring-${index}`) });
  }
  const radius = scene.radiusPx;
  if (rectInsideFrame(cx - radius, cy - radius, radius * 2, radius * 2)) {
    slide.addShape("ellipse", { x: pxX(cx - radius), y: pxY(cy - radius), w: pxW(radius * 2), h: pxH(radius * 2), fill: { color: "FFFFFF", transparency: 100 }, line: { color: color(scene.ringColor), width: pxPt(1.6), transparency: scene.activeLayer === "Satellite" ? 5 : 25 }, objectName: tag(code, "radius", "반경", "outer") });
  }
}

function addFeatures(slide: Slide, code: string, scene: MapScene, model: MapModel): void {
  const hasRaster = (model.rasters?.length ?? 0) > 0;
  const satellite = scene.activeLayer === "Satellite";
  for (const entry of scene.features) {
    const feature = entry.feature;
    if (isRasterizedLayer(feature.layer)) continue;
    const r = entry.radius;
    if (!rectInsideFrame(entry.p[0] - r, entry.p[1] - r, r * 2, r * 2)) continue;
    const style = modelLayerStyle(model, feature.layer);
    const neutral = hasRaster && isBuildingLayer(feature.layer);
    const building = buildingStyleForRaster(feature.layer, hasRaster);
    const hollow = style.sizeBy === "weight" && !feature.weight;
    const opacity = scene.isElementDimmed(feature.layer, entry.key) ? 0.2 : 1;
    const fill = neutral ? building.fill ?? style.color : hollow ? "FFFFFF" : feature.color ?? style.color;
    const fillOpacity = (neutral ? building.fillOpacity ?? 0.94 : hollow ? 0.6 : style.sizeBy === "weight" ? 0.55 : feature.highlight ? 1 : 0.85) * (opacity < 1 ? opacity : 1);
    const stroke = scene.isElementStrong(feature.layer, entry.key) || feature.highlight || entry.selected ? INK : neutral ? building.stroke ?? style.color : satellite ? "FFFFFF" : style.sizeBy === "weight" ? style.color : "FFFFFF";
    const strokeWidth = scene.isElementStrong(feature.layer, entry.key) ? 1.6 : feature.highlight || entry.selected ? 2.8 : neutral ? building.strokeWidth ?? 0.8 : satellite ? 1.5 : style.sizeBy === "weight" ? 1.4 : 0.8;
    const specialRail = feature.layer === "rail_station" || feature.layer === "rail_nearest" || feature.layer === "rail_entrance";
    if (!specialRail) slide.addShape("ellipse", { x: pxX(entry.p[0] - r), y: pxY(entry.p[1] - r), w: pxW(r * 2), h: pxH(r * 2), fill: { color: color(fill), transparency: transparency(fillOpacity) }, line: { color: color(stroke), width: pxPt(strokeWidth), transparency: transparency(opacity) }, objectName: legendTag(model, code, feature.layer, "dot") });
    const legendLabel = legendLabelFor(model, feature.layer);
    const badgeKey = `legend-${safeKey(legendLabel)}`;
    const badgeDimmed = opacity < 1;
    for (const [badgeIndex, badge] of (feature.badges ?? []).slice(0, 4).entries()) {
      const badgeR = Math.max(3.2, r * 0.72);
      const offset = (badgeIndex - ((feature.badges?.length ?? 1) - 1) / 2) * (badgeR * 2.05);
      const bx = Math.max(badgeR, Math.min(VIEW_W - badgeR, entry.p[0] + offset));
      const by = Math.max(badgeR, entry.p[1] - r - badgeR * 0.35);
      if (!rectInsideFrame(bx - badgeR, by - badgeR, badgeR * 2, badgeR * 2)) continue;
      slide.addShape("ellipse", { x: pxX(bx - badgeR), y: pxY(by - badgeR), w: pxW(badgeR * 2), h: pxH(badgeR * 2), fill: { color: color(badge.color ?? style.color), transparency: badgeDimmed ? 80 : 5 }, line: { color: "FFFFFF", width: pxPt(0.8), transparency: badgeDimmed ? 80 : 0 }, objectName: tag(code, badgeKey, `범례 ${legendLabel}`, `badge-${badgeIndex}`) });
      slide.addText(badge.text, { x: pxX(bx - badgeR), y: pxY(by - badgeR), w: pxW(badgeR * 2), h: pxH(badgeR * 2), align: "center", valign: "middle", fontFace: FONT, fontSize: fontPt(badgeR * 0.9, 5.5), bold: true, color: color(badgeTextColor(badge.color ?? style.color)), transparency: badgeDimmed ? 80 : 0, margin: 0, fit: "shrink", objectName: tag(code, badgeKey, `범례 ${legendLabel}`, `badge-text-${badgeIndex}`) });
    }
  }
}

function addNearestLines(slide: Slide, code: string, scene: MapScene): void {
  const [cx, cy] = scene.center;
  for (const entry of scene.features) {
    if (isRasterizedLayer(entry.feature.layer)) continue;
    if (!entry.feature.highlight || entry.feature.distanceM == null) continue;
    addSegment(slide, [cx, cy], entry.p, nearestLineStroke(scene, scene.isElementStrong(entry.feature.layer, entry.key)), scene.isElementStrong(entry.feature.layer, entry.key) ? 1.6 : 1.4, tag(code, `nearest-${safeKey(entry.key)}`, "최근접 지시선", "line"), 0, "3 3");
  }
}

function addRoute(slide: Slide, code: string, scene: MapScene): void {
  if (scene.routePoints.length < 2) return;
  addCustom(slide, [scene.routePoints], { line: "FFFFFF", lineWidth: 8, lineOpacity: 0.92, objectName: tag(code, "route", "보행 경로", "halo") });
  addCustom(slide, [scene.routePoints], { line: "D97706", lineWidth: 4.5, objectName: tag(code, "route", "보행 경로", "line") });
  const start = scene.routePoints[0]!;
  const end = scene.routePoints.at(-1)!;
  if (rectInsideFrame(start[0] - 5.5, start[1] - 5.5, 11, 11)) {
    slide.addShape("ellipse", { x: pxX(start[0] - 5.5), y: pxY(start[1] - 5.5), w: pxW(11), h: pxH(11), fill: { color: color(INK) }, line: { color: "FFFFFF", width: pxPt(2) }, objectName: tag(code, "route", "보행 경로", "start") });
  }
  if (rectInsideFrame(end[0] - 6.5, end[1] - 6.5, 13, 13)) {
    slide.addShape("ellipse", { x: pxX(end[0] - 6.5), y: pxY(end[1] - 6.5), w: pxW(13), h: pxH(13), fill: { color: "D97706" }, line: { color: "FFFFFF", width: pxPt(2.5) }, objectName: tag(code, "route", "보행 경로", "end") });
  }
}

function addSite(slide: Slide, code: string, scene: MapScene, themeId?: BaseThemeRef): void {
  const [cx, cy] = scene.center;
  const siteR = 10;
  if (scene.siteMode === "parcel" && scene.siteParcels.length > 0) {
    const paths = scene.siteParcels.flatMap((polygon) => polygon.rings);
    if (scene.base) {
      // 벡터 바탕 위에서는 화면(MapFigure)과 같은 테마 대지 표시: 테마색 면 + 외곽선, 후광은 있을 때만.
      const site = baseTheme(themeId).site;
      if (site.haloPx > 0) addCustom(slide, paths, { line: "FFFFFF", lineWidth: site.lineWidthPx + 2 * site.haloPx, objectName: tag(code, "site", "분석 대지", "halo"), closed: true });
      addCustom(slide, paths, { fill: site.fill, fillOpacity: site.fillOpacity, line: site.line, lineWidth: site.lineWidthPx, objectName: tag(code, "site", "분석 대지", "outline"), closed: true });
    } else {
      addCustom(slide, paths, { fill: "FFFFFF", fillOpacity: 0.18, line: "FFFFFF", lineWidth: Math.max(0.5 * siteR, 2.4), objectName: tag(code, "site", "분석 대지", "halo"), closed: true });
      addCustom(slide, paths, { line: "111111", lineWidth: Math.max(0.2 * siteR, 1.2), objectName: tag(code, "site", "분석 대지", "outline"), closed: true });
    }
    if (rectInsideFrame(cx - 0.7 * siteR, cy - 0.7 * siteR, 1.4 * siteR, 1.4 * siteR)) {
      slide.addShape("diamond", { x: pxX(cx - 0.7 * siteR), y: pxY(cy - 0.7 * siteR), w: pxW(1.4 * siteR), h: pxH(1.4 * siteR), fill: { color: "FFFFFF" }, line: { color: "111111", width: pxPt(0.22 * siteR) }, objectName: tag(code, "site", "분석 대지", "diamond") });
    }
    if (rectInsideFrame(cx - 0.2 * siteR, cy - 0.2 * siteR, 0.4 * siteR, 0.4 * siteR)) {
      slide.addShape("ellipse", { x: pxX(cx - 0.2 * siteR), y: pxY(cy - 0.2 * siteR), w: pxW(0.4 * siteR), h: pxH(0.4 * siteR), fill: { color: "111111" }, line: { color: "111111", width: 0 }, objectName: tag(code, "site", "분석 대지", "dot") });
    }
    return;
  }
  if (rectInsideFrame(cx - 1.25 * siteR, cy - 1.25 * siteR, 2.5 * siteR, 2.5 * siteR)) {
    slide.addShape("ellipse", { x: pxX(cx - 1.25 * siteR), y: pxY(cy - 1.25 * siteR), w: pxW(2.5 * siteR), h: pxH(2.5 * siteR), fill: { color: "FFFFFF", transparency: 100 }, line: { color: "FFFFFF", width: pxPt(0.55 * siteR) }, objectName: tag(code, "site", "분석 대지", "ring-halo") });
    slide.addShape("ellipse", { x: pxX(cx - 1.25 * siteR), y: pxY(cy - 1.25 * siteR), w: pxW(2.5 * siteR), h: pxH(2.5 * siteR), fill: { color: "FFFFFF", transparency: 100 }, line: { color: "111111", width: pxPt(0.22 * siteR) }, objectName: tag(code, "site", "분석 대지", "ring") });
  }
  addSegment(slide, [cx, cy - 2 * siteR], [cx, cy - 0.6 * siteR], "FFFFFF", 0.5 * siteR, tag(code, "site", "분석 대지", "cross-halo"));
  addSegment(slide, [cx, cy + 0.6 * siteR], [cx, cy + 2 * siteR], "FFFFFF", 0.5 * siteR, tag(code, "site", "분석 대지", "cross-halo"));
  addSegment(slide, [cx - 2 * siteR, cy], [cx - 0.6 * siteR, cy], "FFFFFF", 0.5 * siteR, tag(code, "site", "분석 대지", "cross-halo"));
  addSegment(slide, [cx + 0.6 * siteR, cy], [cx + 2 * siteR, cy], "FFFFFF", 0.5 * siteR, tag(code, "site", "분석 대지", "cross-halo"));
  addSegment(slide, [cx, cy - 2 * siteR], [cx, cy - 0.6 * siteR], "111111", 0.2 * siteR, tag(code, "site", "분석 대지", "cross"));
  addSegment(slide, [cx, cy + 0.6 * siteR], [cx, cy + 2 * siteR], "111111", 0.2 * siteR, tag(code, "site", "분석 대지", "cross"));
  addSegment(slide, [cx - 2 * siteR, cy], [cx - 0.6 * siteR, cy], "111111", 0.2 * siteR, tag(code, "site", "분석 대지", "cross"));
  addSegment(slide, [cx + 0.6 * siteR, cy], [cx + 2 * siteR, cy], "111111", 0.2 * siteR, tag(code, "site", "분석 대지", "cross"));
  if (rectInsideFrame(cx - 0.28 * siteR, cy - 0.28 * siteR, 0.56 * siteR, 0.56 * siteR)) {
    slide.addShape("ellipse", { x: pxX(cx - 0.28 * siteR), y: pxY(cy - 0.28 * siteR), w: pxW(0.56 * siteR), h: pxH(0.56 * siteR), fill: { color: "111111" }, line: { color: "FFFFFF", width: pxPt(0.12 * siteR) }, objectName: tag(code, "site", "분석 대지", "dot") });
  }
}

function addLabels(slide: Slide, code: string, scene: MapScene): void {
  for (const placement of scene.labelPlacements) {
    const entry = placement.entry;
    if (isRasterizedLayer(entry.layer)) continue;
    const box = placement.box;
    if (!rectInsideFrame(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0)) continue;
    const anchorRadius = Math.max(1.8 * scene.unit, placement.text.fontSize * 0.2);
    if (!rectInsideFrame(entry.p[0] - anchorRadius, entry.p[1] - anchorRadius, anchorRadius * 2, anchorRadius * 2)) continue;
    // legendFocus는 범례 항목의 지도 도형에만 적용한다. 사용자가 고정한
    // 라벨·콜아웃은 판독을 위해 원래 색과 불투명도를 유지한다.
    const dimmed = false;
    const key = `label-${safeKey(entry.key)}`;
    const display = entry.text || entry.title;
    const points: PixelPoint[] = [entry.p, placement.placed.knee, placement.placed.edge];
    addSegment(slide, points[0]!, points[1]!, "FFFFFF", 3.6 * scene.unit, tag(code, key, `라벨 · ${display}`, "leader-halo"), dimmed ? 80 : 0);
    addSegment(slide, points[1]!, points[2]!, "FFFFFF", 3.6 * scene.unit, tag(code, key, `라벨 · ${display}`, "leader-halo"), dimmed ? 80 : 0);
    addSegment(slide, points[0]!, points[1]!, INK, 1.2 * scene.unit, tag(code, key, `라벨 · ${display}`, "leader"), dimmed ? 80 : 0);
    addSegment(slide, points[1]!, points[2]!, INK, 1.2 * scene.unit, tag(code, key, `라벨 · ${display}`, "leader"), dimmed ? 80 : 0);
    slide.addShape("ellipse", { x: pxX(entry.p[0] - anchorRadius), y: pxY(entry.p[1] - anchorRadius), w: pxW(anchorRadius * 2), h: pxH(anchorRadius * 2), fill: { color: color(INK), transparency: dimmed ? 80 : 0 }, line: { color: color(INK), width: 0, transparency: dimmed ? 80 : 0 }, objectName: tag(code, key, `라벨 · ${display}`, "anchor") });
    slide.addShape("roundRect", { x: pxX(box.x0), y: pxY(box.y0), w: pxW(box.x1 - box.x0), h: pxH(box.y1 - box.y0), rectRadius: 0.04, fill: { color: "FFFFFF", transparency: dimmed ? 80 : 0 }, line: { color: color(INK), width: pxPt(1.2 * scene.unit), transparency: dimmed ? 80 : 0 }, objectName: tag(code, key, `라벨 · ${display}`, "box") });
    const dot = Math.max(1.8 * scene.unit, placement.text.fontSize * 0.2);
    slide.addShape("ellipse", { x: pxX(box.x0 + 4 * scene.unit - dot), y: pxY((box.y0 + box.y1) / 2 - dot), w: pxW(dot * 2), h: pxH(dot * 2), fill: { color: color(INK), transparency: dimmed ? 80 : 0 }, line: { color: color(INK), width: 0, transparency: dimmed ? 80 : 0 }, objectName: tag(code, key, `라벨 · ${display}`, "box-dot") });
    const text = placement.text.lines.map((line) => line.kind === "joined" ? `${line.title} · ${line.detail}` : line.text).join("\n");
    slide.addText(text, { x: pxX(box.x0 + 8 * scene.unit), y: pxY(box.y0 + 3 * scene.unit), w: pxW(Math.max(1, box.x1 - box.x0 - 12 * scene.unit)), h: pxH(Math.max(1, box.y1 - box.y0 - 6 * scene.unit)), valign: "top", fontFace: FONT, fontSize: fontPt(placement.text.fontSize, 7), color: dimmed ? "8C919B" : INK, transparency: dimmed ? 80 : 0, margin: 0, fit: "shrink", breakLine: false, objectName: tag(code, key, `라벨 · ${display}`, "text") });
  }
}

function addRailText(slide: Slide, code: string, key: string, display: string, text: { text: string; x: number; y: number; width: number; height: number; fontSize: number; angle: number; color: string; placement?: "inside" | "adjacent" | "route" }, scene: MapScene, part: string, dimmed = false): void {
  const safe = rectToFrame(text.x, text.y, Math.max(1, text.width), Math.max(1, text.height));
  if (!safe) return;
  const options = { x: pxX(safe.x), y: pxY(safe.y), w: pxW(safe.w), h: pxH(safe.h), align: "center" as const, valign: "middle" as const, fontFace: FONT, bold: true, margin: 0, fit: "shrink" as const, rotate: text.angle };
  if (text.placement !== "inside") slide.addText(text.text, { ...options, fontSize: fontPt(text.fontSize + 1.6, 6), color: dimmed ? "FFFFFF" : "FFFFFF", objectName: tag(code, key, display, `${part}-halo`) });
  slide.addText(text.text, { ...options, fontSize: fontPt(text.fontSize, 6), color: color(dimmed ? "8C919B" : text.color), objectName: tag(code, key, display, part) });
}

/** MapFigure와 같은 scene.rail 결과를 PowerPoint의 편집 가능한 네이티브 도형으로 옮긴다. */
function addRailOverlay(slide: Slide, code: string, scene: MapScene): void {
  for (const route of scene.rail.routes) {
    if (isRasterizedLayer("rail_line")) continue;
    const key = `legend-${safeKey(route.label)}`;
    const display = `범례 ${route.label}`;
    const dimmed = scene.isElementDimmed("rail_line", route.key, route.label);
    const paths = clipRailPath(route.points);
    if (paths.length === 0) continue;
    if (route.casing) addCustom(slide, paths, { line: route.casing, lineWidth: route.width + 1.2, lineOpacity: dimmed ? 0.2 : 1, objectName: tag(code, key, display, "casing") });
    addCustom(slide, paths, { line: route.color, lineWidth: route.width, lineOpacity: dimmed ? 0.2 : 1, objectName: tag(code, key, display, "line") });
    if (!scene.hiddenKeys.has(route.key) && route.labelPlacement) addRailText(slide, code, key, display, route.labelPlacement, scene, "route-label", false);
  }
  for (const axis of scene.rail.axes) {
    if (isRasterizedLayer("rail_station_axis")) continue;
    const key = `legend-${safeKey(axis.label)}`;
    const display = `범례 ${axis.label}`;
    const dimmed = scene.isElementDimmed("rail_station_axis", axis.key, axis.label);
    const paths = clipRailPath(axis.points);
    if (paths.length === 0) continue;
    if (axis.casing) addCustom(slide, paths, { line: axis.casing, lineWidth: axis.width + 1.4, lineOpacity: dimmed ? 0.2 : 1, objectName: tag(code, key, display, "casing") });
    addCustom(slide, paths, { line: axis.color, lineWidth: axis.width, lineOpacity: dimmed ? 0.2 : 1, objectName: tag(code, key, display, "bar") });
    if (!scene.hiddenKeys.has(axis.key) && axis.labelPlacement) addRailText(slide, code, key, display, axis.labelPlacement, scene, "axis-label", false);
  }
  for (const exit of scene.rail.exits) {
    if (isRasterizedLayer("rail_entrance")) continue;
    if (scene.hiddenKeys.has(exit.featureKey)) continue;
    const key = `rail-exit-${safeKey(exit.key)}`;
    const display = `출구 · ${exit.number}`;
    const dimmed = scene.isElementDimmed("rail_entrance", exit.featureKey);
    addSegment(slide, exit.axisPoint, exit.point, "FFFFFF", 1.5, tag(code, key, display, "connector-halo"), dimmed ? 80 : 25);
    addSegment(slide, exit.axisPoint, exit.point, exit.color, 0.6, tag(code, key, display, "connector"), dimmed ? 80 : 40);
    if (exit.demoted) {
      if (rectInsideFrame(exit.point[0] - RAIL_EXIT_DOT_RADIUS, exit.point[1] - RAIL_EXIT_DOT_RADIUS, RAIL_EXIT_DOT_RADIUS * 2, RAIL_EXIT_DOT_RADIUS * 2)) {
        slide.addShape("ellipse", { x: pxX(exit.point[0] - RAIL_EXIT_DOT_RADIUS), y: pxY(exit.point[1] - RAIL_EXIT_DOT_RADIUS), w: pxW(RAIL_EXIT_DOT_RADIUS * 2), h: pxH(RAIL_EXIT_DOT_RADIUS * 2), fill: { color: color(RAIL_EXIT_COLOR), transparency: dimmed ? 80 : 0 }, line: { color: color("172033"), width: pxPt(RAIL_EXIT_DOT_STROKE), transparency: dimmed ? 80 : 0 }, objectName: tag(code, key, display, "dot") });
      }
      continue;
    }
    const width = exit.box.x1 - exit.box.x0;
    const height = exit.box.y1 - exit.box.y0;
    const safe = rectToFrame(exit.box.x0, exit.box.y0, width, height);
    if (!safe) continue;
    slide.addShape("roundRect", { x: pxX(safe.x), y: pxY(safe.y), w: pxW(safe.w), h: pxH(safe.h), rectRadius: exit.pill ? pxH(safe.h) / 2 : 0.03, fill: { color: color(RAIL_EXIT_COLOR), transparency: dimmed ? 80 : 0 }, line: { color: color("172033"), width: pxPt(0.65), transparency: dimmed ? 80 : 0 }, objectName: tag(code, key, display, "marker") });
    slide.addText(exit.number, { x: pxX(safe.x), y: pxY(safe.y), w: pxW(safe.w), h: pxH(safe.h), align: "center", valign: "middle", fontFace: FONT, fontSize: fontPt(exit.fontSize, 6), bold: true, color: dimmed ? "8C919B" : color("111827"), margin: 0, fit: "shrink", objectName: tag(code, key, display, "number") });
  }
  for (const station of scene.rail.stationLabels) {
    if (isRasterizedLayer("rail_station")) continue;
    if (scene.hiddenKeys.has(station.stationFeatureKey)) continue;
    const key = `rail-station-${safeKey(station.stationKey)}`;
    const display = `역명 · ${station.text}`;
    const text = { text: station.text, x: station.x, y: station.y, width: station.width, height: station.height, fontSize: station.fontSize, angle: 0, color: INK };
    addRailText(slide, code, key, display, text, scene, "station-label", false);
  }
}

function addNorth(slide: Slide, code: string, scene: MapScene): void {
  if (!scene.north) return;
  const u = scene.northUnit;
  const r = NORTH_RADIUS * u;
  const x = Math.max(r, Math.min(activeSceneWidth - r, scene.north.x));
  const y = Math.max(r, Math.min(activeClipBottom - r, scene.north.y));
  if (activeSceneWidth < 2 * r || activeClipBottom < 2 * r) return;
  const key = "north";
  // 화면 feDropShadow(아래 dy, 번짐 σ)와 같은 그림자: OOXML 바깥 그림자는 반지름이므로 2σ.
  const shadow = { type: "outer" as const, angle: 90, color: "000000", opacity: NORTH_GLYPH.shadowOpacity, offset: pxPt(NORTH_GLYPH.shadowDy * u), blur: pxPt(2 * NORTH_GLYPH.shadowBlur * u) };
  slide.addShape("ellipse", { x: pxX(x - r), y: pxY(y - r), w: pxW(2 * r), h: pxH(2 * r), fill: { color: "FFFFFF" }, line: { color: "FFFFFF", width: 0 }, shadow, objectName: tag(code, key, "방위표", "bg") });
  addCustom(slide, [northArrowPoints(x, y, u)], { fill: INK, line: INK, lineWidth: 0.1, objectName: tag(code, key, "방위표", "arrow"), closed: true });
  const letterH = NORTH_GLYPH.letterPx * 1.2 * u;
  slide.addText("N", { x: pxX(x - 8 * u), y: pxY(y + NORTH_GLYPH.letterY * u - letterH / 2), w: pxW(16 * u), h: pxH(letterH), align: "center", valign: "middle", fontFace: FONT, fontSize: fontPt(NORTH_GLYPH.letterPx * u, 6), bold: true, color: INK, margin: 0, objectName: tag(code, key, "방위표", "label") });
}

function addScale(slide: Slide, code: string, scene: MapScene): void {
  const bar = scene.scale;
  const u = scene.unit;
  const chrome = scene.scaleChromeScale;
  const textChrome = chrome * scene.scaleFontScale;
  const key = "scale";
  const maxBarX0 = activeSceneWidth - bar.px - 6 * u;
  const x0 = Math.max(6 * u, Math.min(maxBarX0, bar.x0));
  const x1 = x0 + bar.px;
  const y = Math.max(SCALE_PANEL_ABOVE * u, Math.min(activeClipBottom - SCALE_PANEL_BELOW * u, bar.y));
  if (maxBarX0 < 6 * u || activeClipBottom < (SCALE_PANEL_ABOVE + SCALE_PANEL_BELOW) * u) return;
  slide.addShape("roundRect", { x: pxX(scene.scaleBox.x0), y: pxY(scene.scaleBox.y0), w: pxW(scene.scaleBox.x1 - scene.scaleBox.x0), h: pxH(scene.scaleBox.y1 - scene.scaleBox.y0), rectRadius: 0.06 * chrome, fill: { color: "FFFFFF", transparency: 15 }, line: { color: "FFFFFF", width: 0 }, objectName: tag(code, key, "축척", "bg") });
  addSegment(slide, [x0, y - 4 * chrome * u], [x0, y], INK, 1.6 * chrome * u, tag(code, key, "축척", "left"));
  addSegment(slide, [x0, y], [x1, y], INK, 1.6 * chrome * u, tag(code, key, "축척", "bar"));
  addSegment(slide, [x1, y], [x1, y - 4 * chrome * u], INK, 1.6 * chrome * u, tag(code, key, "축척", "right"));
  // 화면 글자의 기준선(막대 위 6·tc·u)과 크기에 맞춘 상자: 높이는 글자의 8/9.5, 숫자 가운데는 기준선 위 0.36 글자.
  const fontPx = SCALE_FONT_PX * textChrome * u;
  const labelH = fontPx * 8 / 9.5;
  slide.addText(bar.label, { x: pxX(x0), y: pxY(y - 6 * textChrome * u - 0.36 * fontPx - labelH / 2), w: pxW(bar.px), h: pxH(labelH), align: "center", valign: "middle", fontFace: FONT, fontSize: fontPt(fontPx, 6), bold: true, color: INK, margin: 0, objectName: tag(code, key, "축척", "label") });
}

function addLocator(slide: Slide, code: string, model: MapModel, scene: MapScene, savedBox?: MapSceneBox | null): void {
  if (!Number.isFinite(model.radiusM) || model.radiusM <= 0) return;
  const localUnit = activeSceneWidth / Math.max(0.1, activeFrame.w);
  const box = savedBox ?? locatorBox(activeSceneWidth, activeSceneHeight, localUnit, scene.occupiedBoxes);
  const width = Math.max(1, box.x1 - box.x0);
  const height = Math.max(1, box.y1 - box.y0);
  const x = box.x0;
  const y = box.y0;
  const locatorModel = { ...model, radiusM: Math.max(model.radiusM * 3, model.radiusM + 1), features: [], polygons: [], lines: [], total: 0 };
  const viewport = slideViewport(locatorModel, undefined, { width, height, siteX: 0.5, siteY: 0.5, fill: 0.82 });
  const radiusPx = Math.min(width * 0.45, model.radiusM / Math.max(0.0001, metersPerPixel(model.center[1], viewport.zoom)));
  const cx = x + width / 2;
  const cy = y + height / 2;
  const frameTag = (part: string) => tag(code, "locator", "위치도", part);
  slide.addShape("roundRect", { x: pxX(x), y: pxY(y), w: pxW(width), h: pxH(height), rectRadius: 0.04, fill: { color: "FFFFFF", transparency: 5 }, line: { color: "26364E", width: pxPt(0.8) }, objectName: frameTag("frame") });
  slide.addShape("ellipse", { x: pxX(cx - radiusPx), y: pxY(cy - radiusPx), w: pxW(radiusPx * 2), h: pxH(radiusPx * 2), fill: { color: "2F6FDB", transparency: 88 }, line: { color: "2F6FDB", width: pxPt(1.1) }, objectName: frameTag("radius") });
  slide.addShape("diamond", { x: pxX(cx - 6), y: pxY(cy - 6), w: pxW(12), h: pxH(12), fill: { color: "FFFFFF" }, line: { color: "111111", width: pxPt(0.8) }, objectName: frameTag("site") });
  slide.addShape("ellipse", { x: pxX(cx - 2), y: pxY(cy - 2), w: pxW(4), h: pxH(4), fill: { color: "111111" }, line: { color: "111111", width: 0 }, objectName: frameTag("site-dot") });
}

/** 조판 셀은 지도 이미지 안의 범례도 native로 옮겨야 하므로 셀 전용 패널을 그린다. */
function addCellLegend(slide: Slide, code: string, model: MapModel, style: PageStyle = {}): void {
  const layout = cellLegendLayout(model);
  if (!layout) return;
  const { items, x, y, w, h } = layout;
  const legendPt = fontSizeForStyle(style, "legend");
  const focus = legendLabelOf(model, style.legendFocus);
  const panelTag = (part: string) => tag(code, "legend-panel", "범례", part);
  slide.addShape("roundRect", { x: pxX(x), y: pxY(y), w: pxW(w), h: pxH(h), rectRadius: 0.08, fill: { color: "FFFFFF", transparency: 6 }, line: { color: "FFFFFF", width: 0 }, objectName: panelTag("panel") });
  items.forEach((item, index) => {
    const iy = y + CELL_LEGEND_PAD + index * CELL_LEGEND_ROW_H;
    const dimmed = focus !== null && !item.site && item.label !== focus;
    const fade = dimmed ? 65 : 0;
    const mutedColor = dimmed ? "8C919B" : INK;
    if (item.site) {
      slide.addShape("diamond", { x: pxX(x + 13), y: pxY(iy + 8), w: pxW(12), h: pxH(12), fill: { color: "FFFFFF", transparency: fade }, line: { color: "111111", width: pxPt(0.8), transparency: fade }, objectName: panelTag(`item-${index}`) });
      slide.addShape("ellipse", { x: pxX(x + 17), y: pxY(iy + 12), w: pxW(4), h: pxH(4), fill: { color: "111111", transparency: fade }, line: { color: "111111", width: 0, transparency: fade }, objectName: panelTag(`item-dot-${index}`) });
    } else if (item.symbol === "rail-axis") {
      slide.addShape("line", { x: pxX(x + 10), y: pxY(iy + 14), w: pxW(22), h: 0, line: { color: "172033", width: pxPt(5), transparency: fade }, objectName: panelTag(`item-${index}`) });
      slide.addShape("line", { x: pxX(x + 10), y: pxY(iy + 14), w: pxW(22), h: 0, line: { color: color(item.color), width: pxPt(3.5), transparency: fade }, objectName: panelTag(`item-color-${index}`) });
    } else if (item.symbol === "rail-exit") {
      slide.addShape("ellipse", { x: pxX(x + 10), y: pxY(iy + 7), w: pxW(16), h: pxH(16), fill: { color: "FFD200", transparency: fade }, line: { color: "172033", width: pxPt(0.75), transparency: fade }, objectName: panelTag(`item-${index}`) });
    } else {
      slide.addShape("ellipse", { x: pxX(x + 12), y: pxY(iy + 9), w: pxW(12), h: pxH(12), fill: { color: color(item.color), transparency: fade }, line: { color: "FFFFFF", width: pxPt(0.75), transparency: fade }, objectName: panelTag(`item-${index}`) });
      if (item.badge) slide.addText(item.badge, { x: pxX(x + 12), y: pxY(iy + 9), w: pxW(12), h: pxH(12), align: "center", valign: "middle", fontFace: FONT, fontSize: fontPt(6, 5), bold: true, color: dimmed ? "8C919B" : color(badgeTextColor(item.color)), margin: 0, objectName: panelTag(`item-badge-${index}`) });
    }
    slide.addText(item.label, { x: pxX(x + 36), y: pxY(iy), w: pxW(w - 46), h: pxH(CELL_LEGEND_ROW_H), valign: "middle", fontFace: FONT, fontSize: fontPt(legendPt, 6), bold: focus === item.label, color: mutedColor, margin: 0, fit: "shrink", objectName: panelTag(`item-label-${index}`) });
  });
}

/** 지도 장에 배경 이미지 위의 편집 가능한 네이티브 지도 표현을 그린다. */
export function addEditableMap(slide: Slide, plan: (PlannedSlide & { kind: "tile" }) | null, model: MapModel, options: NativeMapOptions = {}): NativeMapStatus {
  const status = nativeMapStatus(model);
  if (!status.native) return status;
  const previousFrame = activeFrame;
  const previousFormat = activeFormat;
  const previousGeometry = activeGeometry;
  const previousPxPerInch = activePxPerInch;
  const previousSceneWidth = activeSceneWidth;
  const previousSceneHeight = activeSceneHeight;
  const previousClipBottom = activeClipBottom;
  const previousRasterLayers = activeRasterLayers;
  const previousMode = activeMode;
  activeFormat = options.format ?? "wide";
  activeGeometry = slideGeometry(activeFormat);
  activePxPerInch = VIEW_W / activeGeometry.w;
  const explicitFrame = options.frame !== undefined;
  activeFrame = options.frame ?? (activeFormat === "wide" ? FULL_FRAME : fullFrame(activeFormat));
  activeSceneWidth = VIEW_W;
  activeSceneHeight = !explicitFrame && activeFormat === "wide" && options.mode !== "cell"
    ? VIEW_H
    : activeFrame.w > 0 ? VIEW_W * (activeFrame.h / activeFrame.w) : VIEW_H;
  const defaultClipBottom = options.mode === "cell" || options.frame ? activeSceneHeight : activeSceneHeight - activeGeometry.stripH * activePxPerInch;
  activeClipBottom = Math.max(0, Math.min(activeSceneHeight, options.clipBottom ?? defaultClipBottom));
  activeRasterLayers = new Set(status.rasterLayers);
  activeMode = options.mode ?? "tile";
  try {
    const visibleModel = frameHidden(model, options.reportFrame?.hiddenLayers ?? []);
    const scene = sceneFor(visibleModel, {
      plan: plan ?? undefined,
      mode: options.mode ?? "tile",
      style: options.style ?? plan?.style,
      format: activeFormat,
      reportFrame: options.reportFrame,
      layout: options.layout,
      basemap: options.basemap,
      baseTheme: options.baseTheme,
    });
    const baseCode = model.tileCode ?? "map";
    const code = options.scope ? `${options.scope}-${baseCode}` : baseCode;
    if (scene.base) addBaseMap(slide, options.scope ? `${options.scope}-base` : "base", scene, !!plan?.muted);
    options.underlay?.();
    addPolygons(slide, code, scene, visibleModel);
    addLines(slide, code, scene, visibleModel);
    if (scene.base) addBaseLabels(slide, options.scope ? `${options.scope}-base` : "base", scene, !!plan?.muted);
    addRadius(slide, code, scene);
    addNearestLines(slide, code, scene);
    addFeatures(slide, code, scene, visibleModel);
    addRailOverlay(slide, code, scene);
    addRoute(slide, code, scene);
    addSite(slide, code, scene, visibleModel.baseTheme ?? options.baseTheme);
    addLabels(slide, code, scene);
    addNorth(slide, code, scene);
    if (options.reportFrame?.decorations.scaleBar !== false) addScale(slide, code, scene);
    if (options.reportFrame?.decorations.locator) addLocator(slide, code, model, scene, savedPanelBox(options.style?.panels?.locator, (options.mode ?? "tile") === "cell" ? "frame" : "page"));
    if ((options.mode ?? "tile") === "cell") addCellLegend(slide, code, visibleModel, options.style);
    return status;
  } finally {
    activeFrame = previousFrame;
    activeFormat = previousFormat;
    activeGeometry = previousGeometry;
    activePxPerInch = previousPxPerInch;
    activeSceneWidth = previousSceneWidth;
    activeSceneHeight = previousSceneHeight;
    activeClipBottom = previousClipBottom;
    activeRasterLayers = previousRasterLayers;
    activeMode = previousMode;
  }
}

export function editableMapAvoid(plan: PlannedSlide & { kind: "tile" }, model: MapModel): MapSceneBox[] {
  const style = plan.style ?? {};
  const hasSummary = style.summary !== false && !(plan.callout && plan.callout.page > 0);
  const panels = slidePanelRects(style, hasSummary, slideLegend(model, !plan.muted).rect);
  const terrainShown = plan.view.code === "D17" && !!plan.view.terrainSections && !!plan.terrainSection;
  const terrainLayout = terrainShown ? terrainSectionLayout(panels) : null;
  const frame = plan.page?.kind === "tile" ? plan.page.frame : undefined;
  const calloutEntries = plan.callout?.page === 0 ? calloutLegendEntries(plan.callout.model, frame?.legend) : [];
  const calloutAlignment = slideCalloutAvoidance(panels, calloutEntries, undefined, "wide", fontSizeForStyle(style, "legend") / DEFAULT_REPORT_FONT_SIZES.legend);
  const calloutLegend = calloutAlignment.calloutLegend;
  const calloutDetail = plan.callout?.page ? slideCalloutFrame(4) : null;
  const summaryX = panels.summary?.x ?? SLIDE.w;
  const gap = SLIDE.edge * PX_PER_INCH * 0.5;
  const siteX = calloutDetail?.siteX ?? slideSiteX(style, hasSummary);
  const rightInset = calloutDetail ? 0 : hasSummary ? Math.max(0, VIEW_W - summaryX * PX_PER_INCH + gap) : SLIDE.edge * PX_PER_INCH;
  const calloutTopPx = calloutDetail ? (panels.title.y + panels.title.h) * PX_PER_INCH + gap : calloutAlignment.calloutTop * PX_PER_INCH;
  const northY = calloutTopPx + NORTH_RADIUS * Math.min(1.5, Math.max(1, VIEW_H / 360));
  const bottomInset = SLIDE.stripH * PX_PER_INCH + (calloutLegend ? (calloutLegend.h + 0.18) * PX_PER_INCH : 0);
  const fill = calloutDetail?.fill ?? terrainLayout?.mapFill ?? (plan.callout?.page === 0 ? SLIDE_OVERVIEW_FILL : 0.8);
  const viewport = slideViewport(model, style, { width: VIEW_W, height: VIEW_H, siteX, siteY: terrainLayout?.mapSiteY ?? 0.5, fill });
  const reserved = slideReserved(PX_PER_INCH, { info: hasSummary, titleRect: panels.title, infoRect: panels.summary, legend: panels.legend, calloutLegend, terrainSection: terrainLayout?.rect });
  if (calloutDetail) return reserved;
  const northAvoid = northArrowBox(VIEW_W, VIEW_H, rightInset, northY);
  return [
    ...reserved,
    scaleBarBox(VIEW_W, VIEW_H, metersPerPixel(viewport.center[1], viewport.zoom), bottomInset, rightInset),
    ...(northAvoid ? [northAvoid] : []),
  ];
}

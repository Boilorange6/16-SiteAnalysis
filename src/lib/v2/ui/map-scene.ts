import type { MapFeature, MapLine, MapPolygon } from "../tile-result";
import { maxOf, minOf } from "../extent";
import { automaticLabelText, labelBoxesOverlap, legacyLabelPriority, mapLabelContent, mapLabelText as formatMapLabelText, selectAutomaticLabels, type MapLabelKind } from "./map-labels";
import { applyView, framedViewport, makeProjector, metersPerPixel, scaleBar, tilesFor, type BasemapChoice, type MapView, type Viewport } from "./map-projection";
import { calloutFrame, layoutCallouts, PX, PX_NARROW, type Placed } from "./callout-layout";
import { isSiteParcelLayer } from "./site-parcel";
import { layerStyle, type MapModel } from "./map-layers";
import { tileClientModuleFor } from "../tile/client";

export type MapSceneBox = { x0: number; y0: number; x1: number; y1: number };
type ScreenPoint = readonly [number, number];

export type MapLabelEntry = {
  key: string;
  text: string;
  title: string;
  detailLines: string[];
  lines: string[];
  autoText: string | null;
  labelPriority: number;
  order: number;
  layer: string;
  kind: MapLabelKind;
  fid?: string;
};

export type MapCalloutTextLine = {
  kind: "title" | "detail" | "joined";
  text: string;
  title?: string;
  detail?: string;
};

export type MapCalloutTextLayout = {
  fontSize: number;
  lineHeight: number;
  width: number;
  height: number;
  textWidth: number;
  lines: MapCalloutTextLine[];
};

export const mapFeatureKey = (layer: string, fid: string | undefined, index: number): string => `${layer}|${fid ?? index}`;
export const mapElementKey = (kind: MapLabelKind, layer: string, fid: string | undefined, index: number): string => `${kind}|${mapFeatureKey(layer, fid, index)}`;
export const mapLabelText = formatMapLabelText;

/** SVG와 PPT가 공유하는 고정폭 문자 측정. 브라우저 폰트 측정에 의존하지 않는다. */
export const mapTextWidth = (s: string, fs: number) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? fs : fs * 0.58), 0);

/** 화면 보드의 고정 라벨과 지도 장면이 같은 키·문구를 사용한다. */
export function mapLabelEntries(model: MapModel): MapLabelEntry[] {
  const features = model.features.map((feature, index) => ({
    ...mapLabelContent(feature.layer, "feature", feature),
    key: mapFeatureKey(feature.layer, feature.fid, index),
    text: formatMapLabelText(feature.layer, "feature", feature),
    autoText: automaticLabelText(feature.layer, "feature", feature),
    labelPriority: feature.labelPriority ?? 0,
    order: index,
    layer: feature.layer,
    kind: "feature" as const,
    ...(feature.fid ? { fid: feature.fid } : {}),
  }));
  const polygons = (model.polygons ?? []).map((polygon, index) => ({
    ...mapLabelContent(polygon.layer, "polygon", polygon),
    key: mapElementKey("polygon", polygon.layer, polygon.fid, index),
    text: formatMapLabelText(polygon.layer, "polygon", polygon),
    autoText: automaticLabelText(polygon.layer, "polygon", polygon),
    labelPriority: polygon.labelPriority ?? 0,
    order: model.features.length + index,
    layer: polygon.layer,
    kind: "polygon" as const,
    ...(polygon.fid ? { fid: polygon.fid } : {}),
  }));
  const lines = (model.lines ?? []).map((line, index) => ({
    ...mapLabelContent(line.layer, "line", line),
    key: mapElementKey("line", line.layer, line.fid, index),
    text: formatMapLabelText(line.layer, "line", line),
    autoText: automaticLabelText(line.layer, "line", line),
    labelPriority: line.labelPriority ?? 0,
    order: model.features.length + (model.polygons ?? []).length + index,
    layer: line.layer,
    kind: "line" as const,
    ...(line.fid ? { fid: line.fid } : {}),
  }));
  return [...features, ...polygons, ...lines];
}

/** SVG text의 흰 외곽선과 같은 폭 규칙을 PPT 말풍선에도 적용한다. */
export function mapCalloutTextLayout(
  entry: Pick<MapLabelEntry, "title" | "detailLines">,
  fontSize: number,
  maxWidth: number,
  textLeft = 8,
  textRight = 4,
  padY = 3,
): MapCalloutTextLayout {
  const details = entry.detailLines.slice(0, 3);
  const joined = [entry.title, ...details].join(" · ");
  const availableTextWidth = Math.max(1, maxWidth - textLeft - textRight);
  const lines: MapCalloutTextLine[] = details.length > 0 && mapTextWidth(joined, fontSize) <= availableTextWidth
    ? [{ kind: "joined", text: joined, title: entry.title, detail: details.join(" · ") }]
    : [{ kind: "title", text: entry.title }, ...details.map((detail) => ({ kind: "detail" as const, text: detail }))];
  const textWidth = Math.max(...lines.map((line) => mapTextWidth(line.text, fontSize)), 1);
  const width = Math.min(maxWidth, textLeft + textRight + textWidth);
  const lineHeight = fontSize * 1.24;
  return { fontSize, lineHeight, width, height: lines.length * lineHeight + 2 * padY, textWidth: Math.min(textWidth, availableTextWidth), lines };
}

export type MapSceneFeature = {
  feature: MapFeature;
  p: [number, number];
  selected: boolean;
  index: number;
  radius: number;
  key: string;
};

export type MapSceneLine = {
  line: MapLine;
  points: Array<[number, number]>;
  center: [number, number];
  index: number;
  key: string;
};

export type MapScenePolygon = {
  polygon: MapPolygon;
  rings: Array<Array<[number, number]>>;
  center: [number, number];
  area: number;
  index: number;
  key: string;
};

export type MapSceneLabel = MapLabelEntry & {
  p: [number, number];
  radius: number;
  small: boolean;
  explicit: boolean;
  highlighted: boolean;
  pick: { fid?: string; lng: number; lat: number; kind: "feature" | "polygon" | "line"; key: string };
};

export type MapSceneLabelPlacement = {
  entry: MapSceneLabel;
  placed: Placed;
  box: MapSceneBox;
  leader: MapSceneBox;
  text: MapCalloutTextLayout;
  variant: "auto" | "fixed" | "hover";
};

export type MapSceneBadge = {
  featureIndex: number;
  badgeIndex: number;
  text: string;
  color: string;
  station: boolean;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MapSceneOptions = {
  model: MapModel;
  width: number;
  height: number;
  activeLayer?: BasemapChoice;
  fill?: number;
  siteX?: number;
  siteY?: number;
  bottomInset?: number;
  rightInset?: number;
  scaleLeft?: boolean;
  scaleX?: number;
  scale?: boolean;
  showRadius?: boolean;
  showSiteMarker?: boolean;
  muted?: boolean;
  fixed?: boolean;
  compact?: boolean;
  selectedFids?: readonly string[];
  highlightLabel?: string | null;
  emphasisKey?: string | null;
  hoverKey?: string | null;
  pinnedKeys?: readonly string[];
  showAutomaticLabels?: boolean;
  bare?: boolean;
  view?: MapView;
  legendBox?: MapSceneBox | null;
  avoid?: MapSceneBox[];
  /** 슬라이드처럼 지도 밖 판이 있을 때 말풍선 칸 위 끝·왼쪽 칸 아래 끝(px). */
  calloutTop?: number;
  calloutLeftBottom?: number;
  path?: Array<[number, number]>;
  north?: number | false;
  dragging?: boolean;
};

export type MapScene = {
  width: number;
  height: number;
  unit: number;
  activeLayer: BasemapChoice;
  viewport: Viewport;
  mpp: number;
  center: [number, number];
  radiusPx: number;
  tiles: ReturnType<typeof tilesFor>;
  features: MapSceneFeature[];
  lines: MapSceneLine[];
  polygons: MapScenePolygon[];
  siteParcels: MapScenePolygon[];
  siteMode: "parcel" | "ring";
  sitePath: string;
  sitePoints: Array<[number, number]>;
  siteBounds: MapSceneBox;
  rings: number[];
  scale: { meters: number; px: number; label: string; x0: number; x1: number; y: number };
  north: { x: number; y: number } | null;
  routePoints: Array<[number, number]>;
  labels: MapSceneLabel[];
  labelPlacements: MapSceneLabelPlacement[];
  badges: MapSceneBadge[];
  occupiedBoxes: MapSceneBox[];
  polygonOpacity: number;
  lineColor: string;
  isLayerHighlighted: (layer: string) => boolean;
  isElementDimmed: (layer: string, key: string) => boolean;
  isElementStrong: (layer: string, key: string) => boolean;
};

function a04PolygonDrawOrder(layer: string): number {
  if (layer === "green_zone" || layer === "green_parcel") return 0;
  if (layer === "water_parcel") return 1;
  if (layer === "park" || layer === "park_nearest") return 2;
  return 3;
}

function polygonArea(ring: Array<[number, number]>): number {
  return Math.abs(ring.reduce((sum, point, i) => {
    const previous = ring[(i + ring.length - 1) % ring.length];
    return sum + previous[0] * point[1] - point[0] * previous[1];
  }, 0)) / 2;
}

function centerOf(points: Array<[number, number]>): [number, number] {
  if (points.length === 0) return [0, 0];
  const total = points.reduce(([lng, lat], [nextLng, nextLat]) => [lng + nextLng, lat + nextLat], [0, 0]);
  return [total[0] / points.length, total[1] / points.length];
}

function polygonPath(rings: Array<Array<[number, number]>>): string {
  return rings.map((ring) => `${ring.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("")}Z`).join(" ");
}

function pointInFrame(point: readonly [number, number], width: number, height: number): boolean {
  return point[0] >= 0 && point[0] <= width && point[1] >= 0 && point[1] <= height;
}

function segmentAnchor(a: readonly [number, number], b: readonly [number, number], width: number, height: number): [number, number] | null {
  const ts = [0, 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx !== 0) ts.push((0 - a[0]) / dx, (width - a[0]) / dx);
  if (dy !== 0) ts.push((0 - a[1]) / dy, (height - a[1]) / dy);
  const visible = ts.filter((t) => t >= 0 && t <= 1).map((t) => [a[0] + dx * t, a[1] + dy * t] as [number, number]).filter((point) => pointInFrame(point, width, height));
  if (visible.length === 0) return null;
  const first = visible[0]!;
  const last = visible.at(-1)!;
  return [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
}

function visibleAnchor(points: readonly (readonly [number, number])[], fallback: readonly [number, number], width: number, height: number): [number, number] | null {
  const visible = points.filter((point) => pointInFrame(point, width, height));
  if (visible.length > 0) return visible[Math.floor(visible.length / 2)] as [number, number];
  for (let index = 1; index < points.length; index += 1) {
    const anchor = segmentAnchor(points[index - 1]!, points[index]!, width, height);
    if (anchor) return anchor;
  }
  return pointInFrame(fallback, width, height) ? fallback as [number, number] : null;
}

function badgeBox(feature: MapSceneFeature, width: number, height: number, dx: number, dy: number, distance: number): MapSceneBox {
  const centerX = feature.p[0] + dx * distance;
  const centerY = feature.p[1] + dy * distance;
  const x0 = centerX - (dx > 0.2 ? 0 : dx < -0.2 ? width : width / 2);
  const y0 = centerY - (dy > 0.2 ? 0 : dy < -0.2 ? height : height / 2);
  return { x0, y0, x1: x0 + width, y1: y0 + height };
}

/** MapFigure의 투영·표식·말풍선·배지 배치를 하나의 순수 장면으로 계산한다. */
export function buildMapScene(options: MapSceneOptions): MapScene {
  const {
    model,
    width: W,
    height: H,
    activeLayer = "white",
    fill = 0.8,
    siteX = 0.5,
    siteY = 0.5,
    bottomInset = 0,
    rightInset = 0,
    scaleLeft = false,
    scaleX,
    scale = true,
    showRadius = true,
    showSiteMarker = true,
    muted = false,
    fixed = false,
    compact = false,
    selectedFids = [],
    highlightLabel = null,
    emphasisKey = null,
    hoverKey = null,
    pinnedKeys = [],
    showAutomaticLabels = true,
    bare = false,
    legendBox = null,
    avoid = [],
    calloutTop: calloutTopOpt,
    calloutLeftBottom,
    path = [],
    north: northOpt,
    dragging = false,
  } = options;
  const layer = model.basemap ?? activeLayer;
  const sat = layer === "Satellite";
  const lineColor = sat ? "#fff" : "#16181d";
  const u = Math.min(1.5, Math.max(1, H / 360));
  const vp = applyView(framedViewport(model.center, model.radiusM, W, H, siteX, fill, siteY), model.center[1], options.view);
  const project = makeProjector(vp);
  const mpp = metersPerPixel(model.center[1], vp.zoom);
  const [cx, cy] = project(model.center[0], model.center[1]);
  const radiusPx = model.radiusM / mpp;
  const tiles = tilesFor(vp);
  const selected = new Set(selectedFids);
  const pinned = new Set(pinnedKeys);
  const highlightActive = highlightLabel !== null;
  const emphasisActive = emphasisKey !== null;
  const isLayerHighlighted = (layerName: string) => !highlightActive || layerStyle(layerName).label === highlightLabel;
  const isElementEmphasized = (key: string) => !emphasisActive || key === emphasisKey;
  const isElementDimmed = (layerName: string, key: string) => (highlightActive && !isLayerHighlighted(layerName)) || (emphasisActive && !isElementEmphasized(key));
  const isElementStrong = (layerName: string, key: string) => (highlightActive && isLayerHighlighted(layerName)) || (emphasisActive && isElementEmphasized(key));
  const isSelected = (fid: string | undefined) => !!fid && selected.has(fid);
  const wmax = Math.max(0, maxOf(model.features.map((feature) => feature.weight ?? 0)));
  const radiusOf = (feature: MapFeature) => {
    const style = layerStyle(feature.layer);
    if (style.sizeBy !== "weight") return (feature.highlight ? 4.6 : 2.6) * u;
    const min = 3.2 * u;
    const max = 13 * u;
    return feature.weight && wmax > 0 ? min + (max - min) * Math.sqrt(feature.weight / wmax) : min;
  };
  const features: MapSceneFeature[] = model.features.map((feature, index) => ({ feature, p: project(feature.lng, feature.lat), selected: isSelected(feature.fid), index, radius: radiusOf(feature), key: mapFeatureKey(feature.layer, feature.fid, index) }));
  const drawn = [...features].sort((a, b) => {
    const rank = (entry: MapSceneFeature) => (entry.feature.highlight || entry.selected ? 2 : entry.feature.layer === "store:other" ? 0 : 1);
    return rank(a) - rank(b) || (b.feature.weight ?? 0) - (a.feature.weight ?? 0);
  });
  const linePaths: MapSceneLine[] = (model.lines ?? []).map((line, index) => {
    const points = line.points.map(([lng, lat]) => project(lng, lat));
    return { line, points, center: centerOf(points), index, key: mapElementKey("line", line.layer, line.fid, index) };
  });
  const polygons: MapScenePolygon[] = (model.polygons ?? []).map((polygon, index) => {
    const rings = polygon.rings.map((ring) => ring.map(([lng, lat]) => project(lng, lat)));
    const outer = rings[0] ?? [];
    const xs = outer.map(([x]) => x);
    const ys = outer.map(([, y]) => y);
    const center: [number, number] = xs.length > 0 ? [(minOf(xs) + maxOf(xs)) / 2, (minOf(ys) + maxOf(ys)) / 2] : [cx, cy];
    return { polygon, rings, center, area: polygonArea(outer), index, key: mapElementKey("polygon", polygon.layer, polygon.fid, index) };
  });
  if (model.tileCode === "A04") polygons.sort((a, b) => a04PolygonDrawOrder(a.polygon.layer) - a04PolygonDrawOrder(b.polygon.layer) || a.index - b.index);
  const siteParcelModels = model.siteParcel === undefined ? (model.polygons ?? []).filter((polygon) => isSiteParcelLayer(polygon.layer)) : (model.siteParcel ?? []);
  const siteParcels: MapScenePolygon[] = siteParcelModels.map((polygon, index) => {
    const rings = polygon.rings.map((ring) => ring.map(([lng, lat]) => project(lng, lat)));
    const outer = rings[0] ?? [];
    const xs = outer.map(([x]) => x);
    const ys = outer.map(([, y]) => y);
    const center: [number, number] = xs.length > 0 ? [(minOf(xs) + maxOf(xs)) / 2, (minOf(ys) + maxOf(ys)) / 2] : [cx, cy];
    return { polygon, rings, center, area: polygonArea(outer), index: polygons.length + index, key: mapElementKey("polygon", polygon.layer, polygon.fid, polygons.length + index) };
  });
  const sitePoints = siteParcels.flatMap((polygon) => polygon.rings.flat());
  const sitePath = siteParcels.map((polygon) => polygonPath(polygon.rings)).join(" ");
  const siteMode: "parcel" | "ring" = siteParcels.flatMap((polygon) => polygon.rings[0] ?? []).length >= 3
    && (() => {
      const points = siteParcels.flatMap((polygon) => polygon.rings[0] ?? []);
      if (points.length < 3) return false;
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      return Math.min(maxOf(xs) - minOf(xs), maxOf(ys) - minOf(ys)) >= 10;
    })()
    ? "parcel"
    : "ring";
  const siteR = fixed ? 10 : H < 360 ? 4 : 7;
  const markerHalfStroke = siteMode === "parcel" ? Math.max(0.5 * siteR, 2.4) / 2 : 0.25 * siteR;
  const diamondExtent = 1.1 * siteR;
  const siteBounds: MapSceneBox = siteMode === "parcel" && sitePoints.length > 0
    ? {
        x0: Math.min(cx - diamondExtent, ...sitePoints.map(([x]) => x)) - markerHalfStroke,
        y0: Math.min(cy - diamondExtent, ...sitePoints.map(([, y]) => y)) - markerHalfStroke,
        x1: Math.max(cx + diamondExtent, ...sitePoints.map(([x]) => x)) + markerHalfStroke,
        y1: Math.max(cy + diamondExtent, ...sitePoints.map(([, y]) => y)) + markerHalfStroke,
      }
    : { x0: cx - 2.25 * siteR, y0: cy - 2.25 * siteR, x1: cx + 2.25 * siteR, y1: cy + 2.25 * siteR };
  const rings: number[] = [];
  if (showRadius) for (let meters = 500; meters < model.radiusM - 1; meters += 500) rings.push(meters / mpp);
  const bar = scaleBar(mpp, 88 * u);
  const barY = H - bottomInset - 20 * u;
  const barX1 = scaleX !== undefined ? scaleX + bar.px : scaleLeft ? Math.max(6 * u, 12) + bar.px : W - 6 * u - rightInset;
  const barX0 = barX1 - bar.px;
  const north = northOpt === false ? null : { x: W - rightInset - 20 * u, y: northOpt || 22 * u };
  const routePoints = path.map(([lng, lat]) => project(lng, lat));
  const inFrame = (point: readonly [number, number]) => pointInFrame(point, W, H);
  const labelEntriesByKey = new Map(mapLabelEntries(model).map((entry) => [entry.key, entry]));
  const labels: MapSceneLabel[] = [
    ...drawn.flatMap((entry) => {
      if (!inFrame(entry.p)) return [];
      const base = labelEntriesByKey.get(entry.key);
      if (!base) return [];
      const highlighted = isLayerHighlighted(entry.feature.layer) && (!!entry.feature.highlight || entry.selected);
      return [{ ...base, autoText: automaticLabelText(entry.feature.layer, "feature", entry.feature, highlighted), labelPriority: legacyLabelPriority("feature", entry.feature, highlighted) ?? 0, order: entry.index, p: entry.p, radius: entry.radius, small: false, explicit: !!automaticLabelText(entry.feature.layer, "feature", entry.feature), highlighted, pick: { fid: entry.feature.fid, lng: entry.feature.lng, lat: entry.feature.lat, kind: "feature" as const, key: entry.key } }];
    }),
    ...polygons.flatMap((entry) => {
      const anchor = visibleAnchor(entry.rings.flat(), entry.center, W, H);
      if (!anchor) return [];
      const base = labelEntriesByKey.get(entry.key);
      if (!base) return [];
      const highlighted = isLayerHighlighted(entry.polygon.layer) && highlightActive;
      const [lng, lat] = centerOf(entry.polygon.rings[0] ?? []);
      return [{ ...base, autoText: automaticLabelText(entry.polygon.layer, "polygon", entry.polygon, highlighted), labelPriority: legacyLabelPriority("polygon", entry.polygon, highlighted) ?? 0, order: model.features.length + entry.index, p: anchor, radius: 0, small: false, explicit: !!automaticLabelText(entry.polygon.layer, "polygon", entry.polygon), highlighted, pick: { fid: entry.polygon.fid, lng, lat, kind: "polygon" as const, key: entry.key } }];
    }),
    ...linePaths.flatMap((entry) => {
      const center = visibleAnchor(entry.points, entry.points[Math.floor(entry.points.length / 2)] ?? [cx, cy], W, H);
      if (!center) return [];
      const [lng, lat] = centerOf(entry.line.points);
      const base = labelEntriesByKey.get(entry.key);
      if (!base) return [];
      const highlighted = isLayerHighlighted(entry.line.layer) && highlightActive;
      return [{ ...base, autoText: automaticLabelText(entry.line.layer, "line", entry.line, highlighted), labelPriority: legacyLabelPriority("line", entry.line, highlighted) ?? 0, order: model.features.length + (model.polygons ?? []).length + entry.index, p: center, radius: 0, small: true, explicit: !!automaticLabelText(entry.line.layer, "line", entry.line), highlighted, pick: { fid: entry.line.fid, lng, lat, kind: "line" as const, key: entry.key } }];
    }),
  ];
  const labelByKey = new Map(labels.map((entry) => [entry.key, entry]));
  const labelCollisionGap = 3 * u;
  const calloutLabelFs = Math.max(11, 10.5 * u);
  const calloutTextLeft = 8 * u;
  const calloutTextRight = 4 * u;
  const calloutPadY = 3 * u;
  const calloutLineHeight = calloutLabelFs * 1.24;
  const baseCalloutMetrics = W <= 420 ? PX_NARROW : PX;
  const calloutMetrics = { ...baseCalloutMetrics, cardW: baseCalloutMetrics.cardW * u, compactW: baseCalloutMetrics.compactW * u, minW: baseCalloutMetrics.minW * u, gap: baseCalloutMetrics.gap * u, stub: baseCalloutMetrics.stub * u, rMin: baseCalloutMetrics.rMin * u, rMax: baseCalloutMetrics.rMax * u, head: baseCalloutMetrics.head * u, row: baseCalloutMetrics.row * u, pad: baseCalloutMetrics.pad * u, compactH: calloutPadY * 2 + calloutLineHeight };
  const legendY = legendBox?.y0 ?? 0;
  const legendH = legendBox ? legendBox.y1 - legendBox.y0 : 0;
  const calloutTop = calloutTopOpt ?? (legendBox && legendY <= H / 2 ? legendY + legendH + 6 * u : 4 * u);
  const calloutBottom = legendBox && legendY > H / 2 ? legendY - 6 * u : H - bottomInset - 4 * u;
  const calloutFrameModel = { ...calloutFrame({ W, H, m: calloutMetrics, edge: 4 * u, top: calloutTop, bottom: Math.max(calloutTop, calloutBottom), ...(calloutLeftBottom !== undefined ? { leftBottom: Math.max(calloutTop, calloutLeftBottom) } : {}), rightInset, perSide: 100, rows: 3, variant: "compact", maxFill: 0.8 }), centerX: W / 2 };
  const placementFor = (placed: Placed, entry: MapSceneLabel, text: MapCalloutTextLayout): MapSceneLabelPlacement => {
    const box: MapSceneBox = { x0: placed.x, y0: placed.y, x1: placed.x + placed.width, y1: placed.y + placed.height };
    const points = [entry.p, placed.knee, placed.edge];
    const leader: MapSceneBox = { x0: Math.max(0, Math.min(...points.map(([x]) => x)) - 2 * u), y0: Math.max(0, Math.min(...points.map(([, y]) => y)) - 2 * u), x1: Math.min(W, Math.max(...points.map(([x]) => x)) + 2 * u), y1: Math.min(H, Math.max(...points.map(([, y]) => y)) + 2 * u) };
    return { entry, placed, box, leader, text, variant: "auto" };
  };
  const placementCandidates: Array<{ entry: MapSceneLabel; variant: "auto" | "fixed" | "hover"; rank: number }> = [];
  if (!bare) {
    const pinnedLabels = pinnedKeys.map((key) => labelByKey.get(key)).filter((entry): entry is MapSceneLabel => !!entry);
    const pinnedSet = new Set(pinnedLabels.map((entry) => entry.key));
    const hoverLabel = hoverKey && !pinned.has(hoverKey) ? labelByKey.get(hoverKey) : undefined;
    const automatic = showAutomaticLabels && (model.tileCode ? tileClientModuleFor(model.tileCode)?.autoLabels !== false : true) ? selectAutomaticLabels(labels).filter((entry) => !pinnedSet.has(entry.key) && entry.key !== hoverLabel?.key) : [];
    placementCandidates.push(...pinnedLabels.map((entry) => ({ entry, variant: "fixed" as const, rank: -2 })), ...(hoverLabel ? [{ entry: hoverLabel, variant: "hover" as const, rank: -1 }] : []), ...automatic.map((entry) => ({ entry, variant: "auto" as const, rank: 2 - (entry.labelPriority ?? 0) })));
  }
  const candidateLayouts = placementCandidates.map(({ entry, variant, rank }) => {
    const fontSize = variant === "auto" ? Math.max(9, entry.small ? 10.5 * u * 0.9 : 10.5 * u) : calloutLabelFs;
    return { entry, variant, rank, text: mapCalloutTextLayout(entry, fontSize, calloutFrameModel.cardW, calloutTextLeft, calloutTextRight, calloutPadY) };
  });
  const layout = layoutCallouts(calloutFrameModel, candidateLayouts.map(({ entry, rank, text }) => ({ id: entry.key, x: entry.p[0], y: entry.p[1], rank, width: text.width, height: text.height })));
  const placedByKey = new Map(layout.placed.map((placed) => [placed.id, placed]));
  const labelPlacements: MapSceneLabelPlacement[] = [];
  for (const { entry, variant, text } of candidateLayouts) {
    const placed = placedByKey.get(entry.key);
    if (!placed) continue;
    const placement = placementFor(placed, entry, text);
    placement.variant = variant;
    labelPlacements.push(placement);
  }
  const occupiedBoxes: MapSceneBox[] = [
    ...(legendBox ? [legendBox] : []),
    ...avoid,
    ...(scale ? [{ x0: barX0 - 8 * u, y0: barY - 16 * u, x1: W, y1: H }] : []),
    ...(!muted ? [siteBounds] : []),
    ...labelPlacements.flatMap((placement) => [placement.box, placement.leader]),
  ];
  const badgeDirections: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, -1], [0, 1], [0.707, -0.707], [-0.707, -0.707], [0.707, 0.707], [-0.707, 0.707]];
  const boxOverlapArea = (a: MapSceneBox, b: MapSceneBox) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const badges: MapSceneBadge[] = [];
  const badgeBoxes: MapSceneBox[] = [];
  for (const feature of drawn) {
    for (const [badgeIndex, badge] of (feature.feature.badges ?? []).slice(0, 4).entries()) {
      const station = feature.feature.layer === "rail_station" || feature.feature.layer === "rail_nearest";
      const fontSize = station ? Math.max(7, 10.5 * u * 0.72) : Math.max(8, 10.5 * u * 0.72);
      const height = station ? Math.max(15 * u, fontSize * 1.55) : Math.max(12 * u, fontSize * 1.35);
      // 숫자 호선은 원, 이름 호선(수인분당 등)은 글자 폭 알약 — MapFigure와 같은 규칙.
      const width = station ? Math.max(height, mapTextWidth(badge.text, fontSize) + 8 * u) : mapTextWidth(badge.text, fontSize) + 8 * u;
      const candidates = badgeDirections.flatMap(([dx, dy]) => [3, 15, 29, 45].map((distance) => badgeBox(feature, width, height, dx, dy, feature.radius + distance * u)));
      const occupied = [...occupiedBoxes, ...badgeBoxes];
      const fit = candidates.find((candidate) => candidate.x0 >= 2 && candidate.x1 <= W - 2 && candidate.y0 >= 2 && candidate.y1 <= H - 2 && !occupied.some((other) => labelBoxesOverlap(other, candidate, labelCollisionGap)));
      const chosen = fit ?? [...candidates].filter((candidate) => candidate.x1 >= 2 && candidate.x0 <= W - 2 && candidate.y1 >= 2 && candidate.y0 <= H - 2).sort((a, b) => occupied.reduce((sum, other) => sum + boxOverlapArea(a, other), 0) - occupied.reduce((sum, other) => sum + boxOverlapArea(b, other), 0))[0] ?? candidates[0]!;
      const clamped: MapSceneBox = { x0: Math.max(2, Math.min(W - width - 2, chosen.x0)), y0: Math.max(2, Math.min(H - height - 2, chosen.y0)), x1: 0, y1: 0 };
      clamped.x1 = clamped.x0 + width;
      clamped.y1 = clamped.y0 + height;
      badgeBoxes.push(clamped);
      badges.push({ featureIndex: feature.index, badgeIndex, text: badge.text, color: badge.color, station, fontSize, x: clamped.x0, y: clamped.y0, width, height });
    }
  }
  occupiedBoxes.push(...badgeBoxes);
  return {
    width: W,
    height: H,
    unit: u,
    activeLayer: layer,
    viewport: vp,
    mpp,
    center: [cx, cy],
    radiusPx,
    tiles,
    features: drawn,
    lines: linePaths,
    polygons,
    siteParcels,
    siteMode,
    sitePath,
    sitePoints,
    siteBounds,
    rings,
    scale: { ...bar, x0: barX0, x1: barX1, y: barY },
    north,
    routePoints,
    labels,
    labelPlacements,
    badges,
    occupiedBoxes,
    polygonOpacity: sat ? 0.45 : 0.35,
    lineColor,
    isLayerHighlighted,
    isElementDimmed,
    isElementStrong,
  };
}

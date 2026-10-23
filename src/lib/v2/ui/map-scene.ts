import type { MapFeature, MapLine, MapPolygon } from "../tile-result";
import { maxOf, minOf } from "../extent";
import { automaticLabelText, legacyLabelPriority, mapLabelContent, mapLabelText as formatMapLabelText, selectAutomaticLabels, type MapLabelKind } from "./map-labels";
import { applyView, framedViewport, makeProjector, metersPerPixel, scaleBar, tilesFor, type BasemapChoice, type MapView, type Viewport } from "./map-projection";
import { calloutFrame, layoutCallouts, PX, PX_NARROW, type Placed } from "./callout-layout";
import { isSiteParcelLayer } from "./site-parcel";
import { layerStyle, legendItemsForModel, type MapModel } from "./map-layers";
import { tileClientModuleFor } from "../tile/client";
import { canonicalRailLineLabel, railLineColor, railLineIsLightRail, railStationMatchKey } from "../tile/rail-presentation";
import { terrainSectionLabelAnchor } from "./terrain-section";
import type { MapLabelBox } from "../report/report-doc";

export type MapSceneBox = { x0: number; y0: number; x1: number; y1: number };

type ScaleBarLayout = {
  bar: ReturnType<typeof scaleBar>;
  x0: number;
  x1: number;
  y: number;
  unit: number;
};

/** 북쪽 표시의 실제 배경·화살표·N 문자를 함께 감싸는 회피 상자. */
export function northArrowBox(width: number, height: number, rightInset = 0, north?: number | false, unitOverride?: number): MapSceneBox | null {
  if (north === false) return null;
  const u = unitOverride ?? Math.min(1.5, Math.max(1, height / 360));
  const x = width - rightInset - 20 * u;
  const y = north || 22 * u;
  return { x0: Math.max(0, x - 13 * u), y0: Math.max(0, y - 13 * u), x1: Math.min(width, x + 13 * u), y1: Math.min(height, y + 13 * u) };
}

function boxesOverlap(a: MapSceneBox, b: MapSceneBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** 지도 프레임 안에서 제목·요약·범례·축척·방위표를 피하는 위치도 자리. */
export function locatorBox(width: number, height: number, pxPerInch: number, reserved: readonly MapSceneBox[] = []): MapSceneBox {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const unit = Math.max(0.1, Number.isFinite(pxPerInch) ? pxPerInch : 1);
  const gap = Math.max(2, unit * 0.16);
  const candidates = (scale: number): MapSceneBox[] => {
    const boxW = Math.max(1, Math.min(safeWidth * 0.24, unit * 2.2) * scale);
    const boxH = Math.max(1, Math.min(safeHeight * 0.25, unit * 1.35) * scale);
    const xs = [gap, (safeWidth - boxW) / 2, safeWidth - boxW - gap];
    const ys = [gap, (safeHeight - boxH) / 2, safeHeight - boxH - gap];
    const positions = [
      [xs[2], ys[0]], [xs[0], ys[0]], [xs[2], ys[2]], [xs[0], ys[2]],
      [xs[1], ys[0]], [xs[1], ys[2]], [xs[2], ys[1]], [xs[0], ys[1]], [xs[1], ys[1]],
    ];
    return positions.map(([x, y]) => ({
      x0: Math.max(0, Math.min(safeWidth - boxW, x)),
      y0: Math.max(0, Math.min(safeHeight - boxH, y)),
      x1: Math.max(1, Math.min(safeWidth, x + boxW)),
      y1: Math.max(1, Math.min(safeHeight, y + boxH)),
    }));
  };
  for (const scale of [1, 0.88, 0.76, 0.64, 0.52]) {
    const candidate = candidates(scale).find((box) => reserved.every((item) => !boxesOverlap(box, item)));
    if (candidate) return candidate;
  }
  return candidates(0.44)[0]!;
}

function scaleBarLayout(width: number, height: number, mpp: number, bottomInset = 0, rightInset = 0, scaleLeft = false, scaleX?: number, unitOverride?: number, maxBarPx = 88): ScaleBarLayout {
  const unit = unitOverride ?? Math.min(1.5, Math.max(1, height / 360));
  const bar = scaleBar(mpp, maxBarPx * unit);
  const y = height - bottomInset - 20 * unit;
  const x1 = scaleX !== undefined ? scaleX + bar.px : scaleLeft ? Math.max(6 * unit, 12) + bar.px : width - 6 * unit - rightInset;
  return { bar, x0: x1 - bar.px, x1, y, unit };
}

function scaleBarBoxFromLayout(width: number, height: number, layout: ScaleBarLayout): MapSceneBox {
  const { x0, x1, y, unit } = layout;
  const box = { x0: Math.max(0, x0 - 6 * unit), y0: Math.max(0, y - 14 * unit) };
  // 작은 썸네일·큰 하단 여백에서는 막대가 화면 밖이라 상자가 뒤집히지 않게 빈 상자로 둔다.
  return { ...box, x1: Math.max(box.x0, Math.min(width, x1 + 6 * unit)), y1: Math.max(box.y0, Math.min(height, y + 8 * unit)) };
}

/** 축척 막대의 실제 불투명 판·막대·문자 영역과 같은 회피 상자. */
export function scaleBarBox(width: number, height: number, mpp: number, bottomInset = 0, rightInset = 0, scaleLeft = false, scaleX?: number, unitOverride?: number, maxBarPx = 88): MapSceneBox {
  return scaleBarBoxFromLayout(width, height, scaleBarLayout(width, height, mpp, bottomInset, rightInset, scaleLeft, scaleX, unitOverride, maxBarPx));
}
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

/** 사용자가 폭을 줄인 말풍선의 줄바꿈. 띄어쓰기에서 먼저 끊고, 한 단어가 넘치면 글자 단위로 끊는다. */
export function wrapMapText(text: string, fs: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (mapTextWidth(next, fs) <= width) { line = next; continue; }
    if (line) out.push(line);
    line = "";
    for (const ch of word) {
      if (line && mapTextWidth(line + ch, fs) > width) { out.push(line); line = ""; }
      line += ch;
    }
  }
  if (line || out.length === 0) out.push(line);
  return out;
}

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
  reserveShortLabelSpace = true,
  maxWrapLines = 0,
): MapCalloutTextLayout {
  const details = entry.detailLines.slice(0, 3);
  const joined = [entry.title, ...details].join(" · ");
  const availableTextWidth = Math.max(1, maxWidth - textLeft - textRight);
  // 넘치는 줄은 maxWrapLines까지 나누고, 남은 글은 마지막 줄에 붙여 그리는 쪽에서 말줄임한다.
  const wrapped = (kind: "title" | "detail", text: string): MapCalloutTextLine[] => {
    const parts = maxWrapLines > 0 ? wrapMapText(text, fontSize, availableTextWidth) : [text];
    const kept = parts.length > maxWrapLines && maxWrapLines > 0 ? [...parts.slice(0, maxWrapLines - 1), parts.slice(maxWrapLines - 1).join(" ")] : parts;
    return kept.map((part) => ({ kind, text: part }));
  };
  const lines: MapCalloutTextLine[] = details.length > 0 && mapTextWidth(joined, fontSize) <= availableTextWidth
    ? [{ kind: "joined", text: joined, title: entry.title, detail: details.join(" · ") }]
    : [...wrapped("title", entry.title), ...details.flatMap((detail) => wrapped("detail", detail))];
  const textWidth = Math.max(...lines.map((line) => mapTextWidth(line.text, fontSize)), 1);
  // Fixed-width CJK estimates can be a fraction narrower than the active SVG
  // font (especially for three-glyph Korean labels). Reserve a small, bounded
  // breathing room so the renderer does not turn a meaningful short label into
  // an ellipsis at the exact measured width.
  const textSafety = reserveShortLabelSpace && textWidth > 0 ? Math.max(2, fontSize * 0.25) : 0;
  const width = Math.min(maxWidth, textLeft + textRight + textWidth + textSafety);
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
  autoBox?: MapSceneBox;
  leader: MapSceneBox;
  text: MapCalloutTextLayout;
  variant: "auto" | "fixed" | "hover";
};

/**
 * 출구를 켜는 화면 축척. 300m 상세 프레임은 기본 fill 0.8, 높이 600px에서
 * 600m/480px = 1.25m/px이므로 반올림한 1.3m/px을 기준선으로 둔다.
 * 카드·1km 기본 장면은 이 값보다 작아지지 않으며, 줌 상태가 바뀌면 다시 계산한다.
 */
export const RAIL_EXIT_REFERENCE_MPP = 1.3;
export const RAIL_EXIT_COLOR = "#FFD200";
export const RAIL_AXIS_WIDTH_DEFAULT = 9;
export const RAIL_AXIS_WIDTH_DETAIL = 18;
export const RAIL_EXIT_MARKER_HEIGHT = 9;
export const RAIL_EXIT_FONT_SIZE = 7;
export const RAIL_EXIT_DOT_RADIUS = 1.25;
export const RAIL_EXIT_DOT_STROKE = 0.4;

export type MapSceneRailText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  angle: number;
  color: string;
  placement: "inside" | "adjacent" | "route";
  box: MapSceneBox;
};

export type MapSceneRailRoute = {
  key: string;
  label: string;
  color: string;
  casing: string | null;
  width: number;
  points: Array<[number, number]>;
  labelPlacement: MapSceneRailText | null;
};

export type MapSceneRailAxis = {
  key: string;
  stationKey: string;
  stationFeatureKey: string;
  label: string;
  color: string;
  casing: string | null;
  width: number;
  points: Array<[number, number]>;
  center: [number, number];
  source: "stationAxes" | "fallback";
  labelPlacement: MapSceneRailText | null;
};

export type MapSceneRailStationLabel = {
  key: string;
  stationKey: string;
  stationFeatureKey: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  box: MapSceneBox;
};

export type MapSceneRailExit = {
  key: string;
  featureKey: string;
  stationKey: string;
  number: string;
  point: [number, number];
  axisPoint: [number, number];
  color: string;
  fontSize: number;
  box: MapSceneBox;
  pill: boolean;
  demoted: boolean;
};

export type MapSceneRail = {
  routes: MapSceneRailRoute[];
  axes: MapSceneRailAxis[];
  routeLabels: MapSceneRailText[];
  axisLabels: MapSceneRailText[];
  stationLabels: MapSceneRailStationLabel[];
  exits: MapSceneRailExit[];
  exitVisible: boolean;
  exitReferenceMpp: number;
  occupiedBoxes: MapSceneBox[];
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
  /** D17 단면 지도에서 선택한 단면을 PPT/native 경로에도 전달한다. */
  terrainSection?: "A" | "B";
  highlightLabel?: string | null;
  /** 보고서 legendFocus 모드: 강조 항목의 원래 색·두께를 보존한다. */
  legendFocus?: string | null;
  emphasisKey?: string | null;
  hoverKey?: string | null;
  pinnedKeys?: readonly string[];
  hiddenKeys?: readonly string[];
  deletedElementKeys?: readonly string[];
  labelBoxes?: Readonly<Record<string, MapLabelBox>>;
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
  /** 보고서가 미리 계산한 동일 프레임 뷰. 지정하면 view 재계산을 하지 않는다. */
  viewport?: Viewport;
  /** 보고서 요소별 지도 라벨 pt를 기존 scene 기준으로 환산한 배율. */
  labelScale?: number;
  /** 보고서 preview와 PPT가 같은 논리 단위로 callout·scale chrome을 배치할 때 쓴다. */
  layoutUnit?: number;
  /** 명시적 보고서 축척에서 네이티브 막대의 기존 판형 라벨 여유를 유지한다. */
  scaleMaxPx?: number;
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
  terrainSection: "A" | "B";
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
  scaleBox: MapSceneBox;
  north: { x: number; y: number } | null;
  routePoints: Array<[number, number]>;
  labels: MapSceneLabel[];
  labelPlacements: MapSceneLabelPlacement[];
  hiddenKeys: ReadonlySet<string>;
  rail: MapSceneRail;
  occupiedBoxes: MapSceneBox[];
  polygonOpacity: number;
  lineColor: string;
  isLayerHighlighted: (layer: string) => boolean;
  isElementDimmed: (layer: string, key: string, explicitLabel?: string) => boolean;
  isElementStrong: (layer: string, key: string, explicitLabel?: string) => boolean;
};

function recordMapSceneBuild(): void {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return;
  const target = window as Window & { __V2_PREVIEW_METRICS__?: Record<string, number> };
  const metrics = target.__V2_PREVIEW_METRICS__ ?? (target.__V2_PREVIEW_METRICS__ = {});
  metrics.buildMapSceneCalls = (metrics.buildMapSceneCalls ?? 0) + 1;
}

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

const railPointDistance = (a: readonly [number, number], b: readonly [number, number]): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
const railPolylineLength = (points: readonly (readonly [number, number])[]): number => points.slice(1).reduce((sum, point, index) => sum + railPointDistance(points[index]!, point), 0);

function railLabel(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const number = raw.match(/^([1-9])(?:호선)?$/u)?.[1];
  const label = number ? `${number}호선` : canonicalRailLineLabel(null, raw);
  return label === "철도" ? null : label;
}

function railColor(label: string, source?: string): string {
  return source && /^#[0-9A-Fa-f]{6}$/u.test(source) ? source : railLineColor(null, label);
}

function railCasing(color: string): string | null {
  const value = color.match(/^#([0-9a-f]{6})$/iu)?.[1];
  if (!value) return "#172033";
  const yiq = (0.299 * parseInt(value.slice(0, 2), 16) + 0.587 * parseInt(value.slice(2, 4), 16) + 0.114 * parseInt(value.slice(4, 6), 16)) / 255;
  return yiq > 0.55 ? "#172033" : null;
}

function railRgb(color: string): [number, number, number] | null {
  const value = color.match(/^#([0-9a-f]{6})$/iu)?.[1];
  if (!value) return null;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function railLuminance(color: string): number {
  const rgb = railRgb(color) ?? [23, 32, 51];
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** 작은 inside 라벨도 SVG·PPT에서 같은 WCAG 대비 판단을 쓴다. */
export function railTextContrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = railLuminance(foreground);
  const backgroundLuminance = railLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function railTextColor(color: string): string {
  const dark = "#172033";
  const light = "#FFFFFF";
  return railTextContrastRatio(light, color) >= railTextContrastRatio(dark, color) ? light : dark;
}

function railAxisAngle(points: readonly (readonly [number, number])[]): number {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return 0;
  let angle = Math.atan2(last[1] - first[1], last[0] - first[0]) * 180 / Math.PI;
  while (angle > 90) angle -= 180;
  while (angle < -90) angle += 180;
  return angle;
}

function railPointSegment(point: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): { point: [number, number]; distance: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  const projected: [number, number] = [a[0] + dx * t, a[1] + dy * t];
  return { point: projected, distance: railPointDistance(point, projected), t };
}

function railNearestPoint(point: readonly [number, number], points: readonly (readonly [number, number])[]): { point: [number, number]; distance: number; a: [number, number]; b: [number, number] } | null {
  let best: { point: [number, number]; distance: number; a: [number, number]; b: [number, number] } | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const candidate = railPointSegment(point, a, b);
    if (!best || candidate.distance < best.distance) best = { point: candidate.point, distance: candidate.distance, a: [...a], b: [...b] };
  }
  return best;
}

function railAxisFallback(point: readonly [number, number], line: MapSceneLine, minimumPx: number): Array<[number, number]> | null {
  const nearest = railNearestPoint(point, line.points);
  if (!nearest) return null;
  const dx = nearest.b[0] - nearest.a[0];
  const dy = nearest.b[1] - nearest.a[1];
  const segmentLength = Math.hypot(dx, dy);
  if (segmentLength === 0) return null;
  const wanted = Math.max(minimumPx, segmentLength);
  const ux = dx / segmentLength;
  const uy = dy / segmentLength;
  return [
    [nearest.point[0] - ux * wanted / 2, nearest.point[1] - uy * wanted / 2],
    [nearest.point[0] + ux * wanted / 2, nearest.point[1] + uy * wanted / 2],
  ];
}

function railAxisPoints(points: Array<[number, number]>, minimumPx: number): Array<[number, number]> {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 2) return points;
  const length = railPolylineLength(points);
  if (length >= minimumPx) return [first, last];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const direct = Math.hypot(dx, dy);
  const midpoint: [number, number] = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
  if (direct === 0) return [[midpoint[0] - minimumPx / 2, midpoint[1]], [midpoint[0] + minimumPx / 2, midpoint[1]]];
  return [[midpoint[0] - dx / direct * minimumPx / 2, midpoint[1] - dy / direct * minimumPx / 2], [midpoint[0] + dx / direct * minimumPx / 2, midpoint[1] + dy / direct * minimumPx / 2]];
}

function railBoxOverlap(a: MapSceneBox, b: MapSceneBox, gap = 0): boolean {
  return a.x0 < b.x1 + gap && a.x1 + gap > b.x0 && a.y0 < b.y1 + gap && a.y1 + gap > b.y0;
}

function railLineBox(points: readonly (readonly [number, number])[], padding: number): MapSceneBox {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { x0: Math.min(...xs) - padding, y0: Math.min(...ys) - padding, x1: Math.max(...xs) + padding, y1: Math.max(...ys) + padding };
}

function railTextBox(x: number, y: number, width: number, height: number): MapSceneBox {
  return { x0: x, y0: y, x1: x + width, y1: y + height };
}

function railTextPlacement(
  text: string,
  box: MapSceneBox,
  fontSize: number,
  color: string,
  placement: MapSceneRailText["placement"],
  angle = 0,
): MapSceneRailText {
  return { text, x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, fontSize, angle, color, placement, box };
}

function railStationLineLabels(feature: MapFeature): string[] {
  const labels: string[] = [];
  const values = [feature.sublabel ?? "", ...(feature.badges ?? []).map((badge) => badge.text)];
  for (const value of values.flatMap((entry) => entry.split(/[·,/|]/u))) {
    const raw = value.trim();
    if (!raw) continue;
    const label = /^\d{1,2}$/u.test(raw) ? `${raw}호선` : railLabel(raw);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function railExitNumber(feature: MapFeature): string | null {
  const label = feature.label?.trim();
  if (label && /^(?:\d{1,2})(?:-\d{1,2})?$/u.test(label)) return label;
  const value = `${feature.name ?? ""} ${label ?? ""}`;
  return value.match(/(\d{1,2}(?:-\d{1,2})?)\s*(?:번\s*)?(?:출구|출입구)/u)?.[1] ?? null;
}

function railExitStationKey(feature: MapFeature, stations: readonly { key: string; name: string; p: [number, number] }[], point: readonly [number, number]): string | null {
  const raw = feature.name?.trim()?.replace(/\s*\d{1,2}(?:-\d{1,2})?\s*(?:번\s*)?(?:출구|출입구).*$/u, "");
  const key = raw ? railStationMatchKey(raw) : "";
  const exact = key ? stations.find((station) => station.key === key) : undefined;
  if (exact) return exact.key;
  return [...stations].sort((a, b) => railPointDistance(a.p, point) - railPointDistance(b.p, point))[0]?.key ?? null;
}

type RailStationBuildRecord = {
  key: string;
  name: string;
  representative: MapSceneFeature;
  p: [number, number];
  featureKeys: Set<string>;
  lineLabels: Set<string>;
};

function buildRailScene(args: {
  model: MapModel;
  features: MapSceneFeature[];
  lines: MapSceneLine[];
  width: number;
  height: number;
  mpp: number;
  compact: boolean;
  labelScale: number;
  hiddenKeys: ReadonlySet<string>;
  occupied: MapSceneBox[];
  inFrame: (point: readonly [number, number]) => boolean;
}): MapSceneRail {
  const { model, features, lines, width: W, height: H, mpp, compact, labelScale, hiddenKeys, occupied, inFrame } = args;
  const stationMap = new Map<string, RailStationBuildRecord>();
  for (const feature of features.filter((entry) => entry.feature.layer === "rail_station" || entry.feature.layer === "rail_nearest")) {
    const rawName = feature.feature.name?.trim() || feature.feature.label?.trim() || feature.feature.fid || `station-${feature.index}`;
    const key = railStationMatchKey(rawName) || `station-${feature.index}`;
    const existing = stationMap.get(key);
    const isPreferred = !existing || (feature.feature.layer === "rail_station" && existing.representative.feature.layer !== "rail_station");
    if (!existing) {
      stationMap.set(key, { key, name: rawName, representative: feature, p: [...feature.p], featureKeys: new Set([feature.key]), lineLabels: new Set(railStationLineLabels(feature.feature)) });
    } else {
      existing.featureKeys.add(feature.key);
      for (const label of railStationLineLabels(feature.feature)) existing.lineLabels.add(label);
      if (isPreferred) { existing.representative = feature; existing.p = [...feature.p]; existing.name = rawName; }
    }
  }
  const stations = [...stationMap.values()];
  const routeEntries = lines.filter((entry) => entry.line.layer === "rail_line" && entry.points.length >= 2);
  const routeGroups = new Map<string, MapSceneLine[]>();
  for (const entry of routeEntries) {
    const label = railLabel(entry.line.legendLabel ?? entry.line.label ?? entry.line.name);
    if (!label) continue;
    const group = routeGroups.get(label) ?? [];
    group.push(entry);
    routeGroups.set(label, group);
  }
  // 같은 호선의 공개 데이터는 타일 경계·관계 분할 때문에 여러 조각으로
  // 들어온다. 조각 하나를 대표로 고르면 화면 안 조각이 사라질 수 있으므로
  // scene에는 원본 조각을 모두 남긴다.
  const routes: MapSceneRailRoute[] = [...routeGroups.entries()].flatMap(([label, entries]) => entries.map((entry) => {
    const color = railColor(label, entry.line.color);
    return { key: entry.key, label, color, casing: railCasing(color), width: compact ? 1.8 : 2, points: entry.points, labelPlacement: null };
  }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  const routesByLabel = new Map<string, MapSceneRailRoute[]>();
  for (const route of routes) {
    const group = routesByLabel.get(route.label) ?? [];
    group.push(route);
    routesByLabel.set(route.label, group);
  }
  const axisEntries = lines.filter((entry) => entry.line.layer === "rail_station_axis" && entry.points.length >= 2);
  const axes: MapSceneRailAxis[] = [];
  for (const station of stations) {
    const labels = new Set(station.lineLabels);
    const nearbyAxes = axisEntries
      .map((entry) => ({ entry, label: railLabel(entry.line.legendLabel ?? entry.line.label ?? entry.line.name), distance: railNearestPoint(station.p, entry.points)?.distance ?? Number.POSITIVE_INFINITY }))
      .filter((candidate): candidate is { entry: MapSceneLine; label: string; distance: number } => !!candidate.label && candidate.distance <= Math.max(42, Math.min(150, 180 / Math.max(mpp, 0.1))));
    for (const candidate of nearbyAxes) labels.add(candidate.label);
    for (const label of labels) {
      const sameLabel = nearbyAxes.filter((candidate) => candidate.label === label);
      const scoped = sameLabel.filter((candidate) => station.representative.feature.fid && candidate.entry.line.fid?.includes(station.representative.feature.fid));
      const selected = scoped.length > 0 ? scoped : sameLabel.length > 0 ? sameLabel : [];
      const fallbackRoutes = routesByLabel.get(label) ?? [];
      const fallbackRoute = [...fallbackRoutes]
        .map((route) => ({ route, entry: lines.find((entry) => entry.key === route.key), distance: railNearestPoint(station.p, route.points)?.distance ?? Infinity }))
        .filter((candidate): candidate is { route: MapSceneRailRoute; entry: MapSceneLine; distance: number } => !!candidate.entry)
        .sort((a, b) => a.distance - b.distance)[0];
      const sources = selected.length > 0
        ? selected.slice(0, 4).map((candidate) => ({ entry: candidate.entry, points: railAxisPoints(candidate.entry.points, (railLineIsLightRail(label) ? 50 : 160) / mpp), source: "stationAxes" as const }))
        : fallbackRoute
          ? (railAxisFallback(station.p, fallbackRoute.entry, (railLineIsLightRail(label) ? 50 : 160) / mpp) ? [{ entry: fallbackRoute.entry, points: railAxisFallback(station.p, fallbackRoute.entry, (railLineIsLightRail(label) ? 50 : 160) / mpp)!, source: "fallback" as const }] : [])
          : [];
      for (const [sourceIndex, source] of sources.entries()) {
        const points = source.points;
        if (points.length < 2) continue;
        const color = railColor(label, source.entry.line.color);
        axes.push({ key: `rail-axis-${station.key}-${label}-${sourceIndex}`, stationKey: station.key, stationFeatureKey: station.representative.key, label, color, casing: railCasing(color), width: mpp <= RAIL_EXIT_REFERENCE_MPP ? RAIL_AXIS_WIDTH_DETAIL : RAIL_AXIS_WIDTH_DEFAULT, points, center: [(points[0]![0] + points.at(-1)![0]) / 2, (points[0]![1] + points.at(-1)![1]) / 2], source: source.source, labelPlacement: null });
      }
    }
  }
  // 같은 역·호선의 중복 저장 축은 한 막대로 합친다. 끝점이 막대 굵기
  // 이내일 때만 병합해, 고속터미널처럼 떨어진 승강장은 보존한다.
  const dedupedAxes: MapSceneRailAxis[] = [];
  for (const axis of axes) {
    const first = axis.points[0];
    const last = axis.points.at(-1);
    if (!first || !last) continue;
    const duplicateIndex = dedupedAxes.findIndex((other) => {
      const otherFirst = other.points[0];
      const otherLast = other.points.at(-1);
      if (!otherFirst || !otherLast || other.stationKey !== axis.stationKey || other.label !== axis.label) return false;
      const tolerance = Math.max(axis.width, other.width);
      const sameDirection = railPointDistance(first, otherFirst) <= tolerance && railPointDistance(last, otherLast) <= tolerance;
      const reverseDirection = railPointDistance(first, otherLast) <= tolerance && railPointDistance(last, otherFirst) <= tolerance;
      return sameDirection || reverseDirection;
    });
    if (duplicateIndex < 0) {
      dedupedAxes.push(axis);
      continue;
    }
    if (axis.source === "stationAxes" && dedupedAxes[duplicateIndex]!.source === "fallback") dedupedAxes[duplicateIndex] = axis;
  }
  axes.length = 0;
  axes.push(...dedupedAxes);
  // 오래된 저장 결과가 호선 소속도 축도 잃은 경우에도 역을 빈 점으로 되돌리지 않는다.
  for (const station of stations) {
    if (axes.some((axis) => axis.stationKey === station.key)) continue;
    const nearestRoute = [...routes]
      .map((route) => ({ route, entry: lines.find((entry) => entry.key === route.key), distance: railNearestPoint(station.p, route.points)?.distance ?? Infinity }))
      .filter((candidate): candidate is { route: MapSceneRailRoute; entry: MapSceneLine; distance: number } => !!candidate.entry)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearestRoute) continue;
    const label = nearestRoute.route.label;
    const points = railAxisFallback(station.p, nearestRoute.entry, (railLineIsLightRail(label) ? 50 : 160) / mpp);
    if (!points) continue;
    axes.push({ key: `rail-axis-${station.key}-${label}-fallback`, stationKey: station.key, stationFeatureKey: station.representative.key, label, color: nearestRoute.route.color, casing: nearestRoute.route.casing, width: mpp <= RAIL_EXIT_REFERENCE_MPP ? RAIL_AXIS_WIDTH_DETAIL : RAIL_AXIS_WIDTH_DEFAULT, points, center: [(points[0]![0] + points[1]![0]) / 2, (points[0]![1] + points[1]![1]) / 2], source: "fallback", labelPlacement: null });
  }
  // 위 fallback도 같은 역에서 이미 생성된 축과 겹칠 수 있다.
  const uniqueAxes: MapSceneRailAxis[] = [];
  for (const axis of axes) {
    const first = axis.points[0];
    const last = axis.points.at(-1);
    const duplicateIndex = first && last ? uniqueAxes.findIndex((other) => {
      const otherFirst = other.points[0];
      const otherLast = other.points.at(-1);
      if (!otherFirst || !otherLast || other.stationKey !== axis.stationKey || other.label !== axis.label) return false;
      const tolerance = Math.max(axis.width, other.width);
      return (railPointDistance(first, otherFirst) <= tolerance && railPointDistance(last, otherLast) <= tolerance)
        || (railPointDistance(first, otherLast) <= tolerance && railPointDistance(last, otherFirst) <= tolerance);
    }) : -1;
    if (duplicateIndex < 0) uniqueAxes.push(axis);
    else if (axis.source === "stationAxes" && uniqueAxes[duplicateIndex]!.source === "fallback") uniqueAxes[duplicateIndex] = axis;
  }
  axes.length = 0;
  axes.push(...uniqueAxes);
  const axisBoxes = axes.map((axis) => railLineBox(axis.points, axis.width / 2 + 3));
  const routeLabels: MapSceneRailText[] = [];
  if (!compact) {
    const placedRouteLabels = new Set<string>();
    for (const route of routes) {
      if ((routesByLabel.get(route.label) ?? []).every((fragment) => hiddenKeys.has(fragment.key))) continue;
      if (placedRouteLabels.has(route.label)) continue;
      placedRouteLabels.add(route.label);
      const candidates = (routesByLabel.get(route.label) ?? []).flatMap((fragment) => fragment.points.slice(1).map((point, index) => {
        const a = fragment.points[index]!;
        const b = point;
        const center: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const distance = axes.reduce((best, axis) => Math.min(best, railNearestPoint(center, axis.points)?.distance ?? Infinity), Infinity);
        return { route: fragment, a, b, center, distance, length: railPointDistance(a, b) };
      })).sort((a, b) => b.distance - a.distance || b.length - a.length);
      const fontSize = 10 * labelScale;
      const textWidth = mapTextWidth(route.label, fontSize) + 4;
      const candidate = candidates.find((item) => {
        if (item.length < textWidth + 8 || !inFrame(item.center)) return false;
        const box = railTextBox(item.center[0] - textWidth / 2, item.center[1] - fontSize * 0.7, textWidth, fontSize * 1.35);
        return box.x0 >= 2 && box.y0 >= 2 && box.x1 <= W - 2 && box.y1 <= H - 2 && ![...occupied, ...axisBoxes, ...routeLabels.map((label) => label.box)].some((other) => railBoxOverlap(other, box, 2));
      });
      if (!candidate) continue;
      const angle = railAxisAngle([candidate.a, candidate.b]);
      const box = railTextBox(candidate.center[0] - textWidth / 2, candidate.center[1] - fontSize * 0.7, textWidth, fontSize * 1.35);
      // 노선 위 글자는 흰 헤일로 위에 놓이므로 노선색과 무관하게 잉크색
      routeLabels.push(railTextPlacement(route.label, box, fontSize, "#172033", "route", angle));
      candidate.route.labelPlacement = routeLabels.at(-1)!;
    }
  }
  const exits: MapSceneRailExit[] = [];
  const exitVisible = !compact && mpp <= RAIL_EXIT_REFERENCE_MPP;
  if (exitVisible) {
    const stationLookup = stations.map((station) => ({ key: station.key, name: station.name, p: station.p }));
    const entranceEntries = features.filter((entry) => entry.feature.layer === "rail_entrance" && railExitNumber(entry.feature) && inFrame(entry.p)).sort((a, b) => a.key.localeCompare(b.key));
    for (const entry of entranceEntries) {
      const number = railExitNumber(entry.feature)!;
      const stationKey = railExitStationKey(entry.feature, stationLookup, entry.p);
      if (!stationKey) continue;
      const stationAxes = axes.filter((axis) => axis.stationKey === stationKey);
      const axis = [...stationAxes].sort((a, b) => (railNearestPoint(entry.p, a.points)?.distance ?? Infinity) - (railNearestPoint(entry.p, b.points)?.distance ?? Infinity))[0];
      const axisPoint = axis ? railNearestPoint(entry.p, axis.points)?.point ?? axis.center : stations.find((station) => station.key === stationKey)?.p ?? entry.p;
      const pill = number.includes("-") || number.length > 1;
      const fontSize = RAIL_EXIT_FONT_SIZE * labelScale;
      const markerHeight = RAIL_EXIT_MARKER_HEIGHT * labelScale;
      const width = pill ? Math.max(markerHeight, mapTextWidth(number, fontSize) + 5 * labelScale) : markerHeight;
      const fullBox = railTextBox(entry.p[0] - width / 2, entry.p[1] - markerHeight / 2, width, markerHeight);
      // 출구는 축 위에 놓이는 표식이므로 축 자체와의 겹침은 충돌로 세지 않는다.
      const occupiedForExit = [...occupied, ...routeLabels.map((label) => label.box), ...exits.map((exit) => exit.box)];
      const demoted = occupiedForExit.some((box) => railBoxOverlap(box, fullBox, 1));
      const box = demoted ? railTextBox(entry.p[0] - RAIL_EXIT_DOT_RADIUS, entry.p[1] - RAIL_EXIT_DOT_RADIUS, RAIL_EXIT_DOT_RADIUS * 2, RAIL_EXIT_DOT_RADIUS * 2) : fullBox;
      exits.push({ key: `rail-exit-${entry.key}`, featureKey: entry.key, stationKey, number, point: [...entry.p], axisPoint: [...axisPoint], color: axis?.color ?? RAIL_EXIT_COLOR, fontSize, box, pill, demoted });
    }
  }
  const axisLabels: MapSceneRailText[] = [];
  if (!compact) {
    for (const [axisIndex, axis] of axes.entries()) {
      if (hiddenKeys.has(axis.key)) continue;
      const first = axis.points[0]!;
      const last = axis.points.at(-1)!;
      const length = railPointDistance(first, last);
      const fontSize = 9 * labelScale;
      const textWidth = mapTextWidth(axis.label, fontSize) + 2;
      const textHeight = fontSize * 1.35;
      const occupiedForLabel = [...occupied, ...routeLabels.map((label) => label.box), ...exits.map((exit) => exit.box), ...axisLabels.map((label) => label.box)];
      let placement: MapSceneRailText | null = null;
      const angle = railAxisAngle(axis.points);
      if (length >= textWidth + 12) {
        const insideCenters = [0.5, 0.28, 0.72, 0.12, 0.88].map((ratio) => [first[0] + (last[0] - first[0]) * ratio, first[1] + (last[1] - first[1]) * ratio] as [number, number]);
        for (const center of insideCenters) {
          // 회전은 렌더러에 맡기되, 점유 판정은 보수적인 축정렬 박스로
          // 계산한다. 중심 표식에 걸리면 같은 막대의 빈 구간으로 옮긴다.
          const box = railTextBox(center[0] - textWidth / 2, center[1] - textHeight / 2, textWidth, textHeight);
          if (box.x0 < 2 || box.y0 < 2 || box.x1 > W - 2 || box.y1 > H - 2 || occupiedForLabel.some((other) => railBoxOverlap(other, box, 1))) continue;
          placement = railTextPlacement(axis.label, box, fontSize, railTextColor(axis.color), "inside", angle);
          break;
        }
      }
      if (!placement) {
        const dx = last[0] - first[0];
        const dy = last[1] - first[1];
        const lengthSafe = Math.max(length, 1);
        const nx = -dy / lengthSafe;
        const ny = dx / lengthSafe;
        for (const sign of [1, -1]) {
          const center: [number, number] = [axis.center[0] + nx * sign * (axis.width / 2 + 8), axis.center[1] + ny * sign * (axis.width / 2 + 8)];
          const box = railTextBox(center[0] - textWidth / 2, center[1] - textHeight / 2, textWidth, textHeight);
          if (box.x0 < 2 || box.y0 < 2 || box.x1 > W - 2 || box.y1 > H - 2 || occupiedForLabel.some((other) => railBoxOverlap(other, box, 1))) continue;
          // 축 밖 후보는 흰 바탕이므로 호선색 자체가 아니라 잉크색을
          // 사용해 작은 글자도 4.5:1 대비를 유지한다.
          placement = railTextPlacement(axis.label, box, fontSize, "#172033", "adjacent", angle);
          break;
        }
      }
      axisLabels.push(...(placement ? [placement] : []));
      axes[axisIndex]!.labelPlacement = placement;
    }
  }
  const stationLabels: MapSceneRailStationLabel[] = [];
  if (!compact) {
    const labelFontSize = (mpp <= RAIL_EXIT_REFERENCE_MPP ? 13 : 14) * labelScale;
    for (const station of stations) {
      if (hiddenKeys.has(station.representative.key)) continue;
      const stationAxes = axes.filter((axis) => axis.stationKey === station.key);
      const points = stationAxes.flatMap((axis) => axis.points);
      const origin: [number, number] = points.length > 0 ? [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length] : station.p;
      const xExtent = points.length > 0 ? [Math.min(...points.map(([x]) => x)), Math.max(...points.map(([x]) => x))] : [origin[0], origin[0]];
      const yExtent = points.length > 0 ? [Math.min(...points.map(([, y]) => y)), Math.max(...points.map(([, y]) => y))] : [origin[1], origin[1]];
      const textWidth = mapTextWidth(station.name, labelFontSize) + 4;
      const textHeight = labelFontSize * 1.3;
      const gap = Math.max(10 * labelScale, (mpp <= RAIL_EXIT_REFERENCE_MPP ? RAIL_AXIS_WIDTH_DETAIL : RAIL_AXIS_WIDTH_DEFAULT) / 2 + 6 * labelScale);
      const candidates = [
        [xExtent[1] + gap, origin[1] - textHeight / 2],
        [xExtent[0] - gap - textWidth, origin[1] - textHeight / 2],
        [origin[0] - textWidth / 2, yExtent[0] - gap - textHeight],
        [origin[0] - textWidth / 2, yExtent[1] + gap],
        [xExtent[1] + gap, yExtent[0] - gap - textHeight],
        [xExtent[0] - gap - textWidth, yExtent[0] - gap - textHeight],
        [xExtent[1] + gap, yExtent[1] + gap],
        [xExtent[0] - gap - textWidth, yExtent[1] + gap],
      ];
      const stationOccupied = [...occupied, ...axisBoxes, ...routeLabels.map((label) => label.box), ...axisLabels.map((label) => label.box), ...exits.map((exit) => exit.box), ...stationLabels.map((label) => label.box)];
      const chosen = candidates.map(([x, y]) => railTextBox(x!, y!, textWidth, textHeight)).find((box) => box.x0 >= 2 && box.y0 >= 2 && box.x1 <= W - 2 && box.y1 <= H - 2 && !stationOccupied.some((other) => railBoxOverlap(other, box, 2)));
      if (!chosen) continue;
      stationLabels.push({ key: `rail-station-label-${station.key}`, stationKey: station.key, stationFeatureKey: station.representative.key, text: station.name, x: chosen.x0, y: chosen.y0, width: chosen.x1 - chosen.x0, height: chosen.y1 - chosen.y0, fontSize: labelFontSize, box: chosen });
    }
  }
  const occupiedBoxes = [...axisBoxes, ...routeLabels.map((label) => label.box), ...axisLabels.map((label) => label.box), ...exits.map((exit) => exit.box), ...stationLabels.map((label) => label.box)];
  // 카드는 승인 시안 계약대로 철도 선형과 역사 막대만 남긴다. 글자·출구는
  // compact 장면에 넣지 않지만, 노선 선형은 막대와 함께 축척 맥락을 유지한다.
  return { routes, axes, routeLabels, axisLabels, stationLabels, exits, exitVisible, exitReferenceMpp: RAIL_EXIT_REFERENCE_MPP, occupiedBoxes };
}

/** MapFigure의 투영·표식·말풍선·철도 표현 배치를 하나의 순수 장면으로 계산한다. */
export function buildMapScene(options: MapSceneOptions): MapScene {
  recordMapSceneBuild();
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
    terrainSection = "A",
    highlightLabel = null,
    legendFocus: legendFocusOpt = null,
    emphasisKey = null,
    hoverKey = null,
    pinnedKeys = [],
    hiddenKeys = [],
    deletedElementKeys = [],
    labelBoxes = {},
    showAutomaticLabels = true,
    bare = false,
    legendBox = null,
    avoid = [],
    calloutTop: calloutTopOpt,
    calloutLeftBottom,
    path = [],
    north: northOpt,
    dragging = false,
    viewport: viewportOpt,
    layoutUnit,
    labelScale: labelScaleOpt = 1,
    scaleMaxPx = 88,
  } = options;
  const layer = model.basemap ?? activeLayer;
  const sat = layer === "Satellite";
  const lineColor = sat ? "#fff" : "#16181d";
  const u = layoutUnit ?? Math.min(1.5, Math.max(1, H / 360));
  const labelScale = Number.isFinite(labelScaleOpt) && labelScaleOpt > 0 ? labelScaleOpt : 1;
  const vp = viewportOpt ?? applyView(framedViewport(model.center, model.radiusM, W, H, siteX, fill, siteY), model.center[1], options.view);
  const project = makeProjector(vp);
  const mpp = metersPerPixel(model.center[1], vp.zoom);
  const [cx, cy] = project(model.center[0], model.center[1]);
  const radiusPx = model.radiusM / mpp;
  const tiles = tilesFor(vp);
  const selected = new Set(selectedFids);
  const pinned = new Set(pinnedKeys);
  const hidden = new Set(hiddenKeys);
  const deleted = new Set(deletedElementKeys);
  const highlightActive = highlightLabel !== null;
  const legendFocusOnly = legendFocusOpt !== null;
  const emphasisActive = emphasisKey !== null;
  const presentedLegendByLayer = new Map(legendItemsForModel(model).map((item) => [item.layer, item.label]));
  const presentedLabelOf = (layerName: string, explicit?: string) => explicit?.trim() || presentedLegendByLayer.get(layerName) || layerStyle(layerName).label;
  const isLayerHighlighted = (layerName: string) => !highlightActive || presentedLabelOf(layerName) === highlightLabel
    || (highlightLabel !== null && (model.lines ?? []).some((line) => line.layer === layerName && line.legendLabel === highlightLabel));
  const isElementEmphasized = (key: string) => !emphasisActive || key === emphasisKey;
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
  const drawn = features.filter((entry) => !deleted.has(entry.key)).sort((a, b) => {
    const rank = (entry: MapSceneFeature) => (entry.feature.highlight || entry.selected ? 2 : entry.feature.layer === "store:other" ? 0 : 1);
    return rank(a) - rank(b) || (b.feature.weight ?? 0) - (a.feature.weight ?? 0);
  });
  const linePaths: MapSceneLine[] = (model.lines ?? []).map((line, index) => {
    const points = line.points.map(([lng, lat]) => project(lng, lat));
    return { line, points, center: centerOf(points), index, key: mapElementKey("line", line.layer, line.fid, index) };
  }).filter((entry) => !deleted.has(entry.key));
  const polygons: MapScenePolygon[] = (model.polygons ?? []).map((polygon, index) => {
    const rings = polygon.rings.map((ring) => ring.map(([lng, lat]) => project(lng, lat)));
    const outer = rings[0] ?? [];
    const xs = outer.map(([x]) => x);
    const ys = outer.map(([, y]) => y);
    const center: [number, number] = xs.length > 0 ? [(minOf(xs) + maxOf(xs)) / 2, (minOf(ys) + maxOf(ys)) / 2] : [cx, cy];
    return { polygon, rings, center, area: polygonArea(outer), index, key: mapElementKey("polygon", polygon.layer, polygon.fid, index) };
  });
  const visiblePolygons = polygons.filter((entry) => !deleted.has(entry.key));
  if (model.tileCode === "A04") visiblePolygons.sort((a, b) => a04PolygonDrawOrder(a.polygon.layer) - a04PolygonDrawOrder(b.polygon.layer) || a.index - b.index);
  const polygonCount = polygons.length;
  const siteParcelModels = model.siteParcel === undefined ? (model.polygons ?? []).filter((polygon) => isSiteParcelLayer(polygon.layer)) : (model.siteParcel ?? []);
  const siteParcels: MapScenePolygon[] = siteParcelModels.map((polygon, index) => {
    const rings = polygon.rings.map((ring) => ring.map(([lng, lat]) => project(lng, lat)));
    const outer = rings[0] ?? [];
    const xs = outer.map(([x]) => x);
    const ys = outer.map(([, y]) => y);
    const center: [number, number] = xs.length > 0 ? [(minOf(xs) + maxOf(xs)) / 2, (minOf(ys) + maxOf(ys)) / 2] : [cx, cy];
    return { polygon, rings, center, area: polygonArea(outer), index: polygonCount + index, key: mapElementKey("polygon", polygon.layer, polygon.fid, polygonCount + index) };
  }).filter((entry) => !deleted.has(entry.key));
  const legendLabelByElementKey = new Map<string, string>();
  for (const entry of features) legendLabelByElementKey.set(entry.key, presentedLabelOf(entry.feature.layer));
  for (const entry of linePaths) legendLabelByElementKey.set(entry.key, presentedLabelOf(entry.line.layer, entry.line.legendLabel));
  for (const entry of visiblePolygons) legendLabelByElementKey.set(entry.key, presentedLabelOf(entry.polygon.layer));
  const elementHighlighted = (layerName: string, key: string, explicitLabel?: string) => !highlightActive
    || explicitLabel === highlightLabel
    || legendLabelByElementKey.get(key) === highlightLabel
    || layerStyle(layerName).label === highlightLabel;
  const isElementDimmed = (layerName: string, key: string, explicitLabel?: string) => !elementHighlighted(layerName, key, explicitLabel) || (emphasisActive && !isElementEmphasized(key));
  const isElementStrong = (layerName: string, key: string, explicitLabel?: string) => ((!legendFocusOnly && highlightActive && elementHighlighted(layerName, key, explicitLabel)) || (emphasisActive && isElementEmphasized(key)));
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
  const scaleLayout = scaleBarLayout(W, H, mpp, bottomInset, rightInset, scaleLeft, scaleX, u, scaleMaxPx);
  const { bar, y: barY, x0: barX0, x1: barX1 } = scaleLayout;
  const scaleBox = scaleBarBoxFromLayout(W, H, scaleLayout);
  const north = northOpt === false ? null : { x: W - rightInset - 20 * u, y: northOpt || 22 * u };
  const northBox = north ? northArrowBox(W, H, rightInset, northOpt, u) : null;
  const calloutAvoid = [
    ...avoid,
    ...(scale ? [scaleBox] : []),
    ...(northBox ? [northBox] : []),
  ];
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
    ...visiblePolygons.flatMap((entry) => {
      const anchor = visibleAnchor(entry.rings.flat(), entry.center, W, H);
      if (!anchor) return [];
      const base = labelEntriesByKey.get(entry.key);
      if (!base) return [];
      const highlighted = isLayerHighlighted(entry.polygon.layer) && highlightActive;
      const [lng, lat] = centerOf(entry.polygon.rings[0] ?? []);
      return [{ ...base, autoText: automaticLabelText(entry.polygon.layer, "polygon", entry.polygon, highlighted), labelPriority: legacyLabelPriority("polygon", entry.polygon, highlighted) ?? 0, order: model.features.length + entry.index, p: anchor, radius: 0, small: false, explicit: !!automaticLabelText(entry.polygon.layer, "polygon", entry.polygon), highlighted, pick: { fid: entry.polygon.fid, lng, lat, kind: "polygon" as const, key: entry.key } }];
    }),
    ...linePaths.flatMap((entry) => {
      const sectionAnchor = entry.line.layer === "terrain_section_a" || entry.line.layer === "terrain_section_b"
        ? terrainSectionLabelAnchor(entry.points, [cx, cy], radiusPx)
        : null;
      const center = sectionAnchor ?? visibleAnchor(entry.points, entry.points[Math.floor(entry.points.length / 2)] ?? [cx, cy], W, H);
      if (!center) return [];
      const [lng, lat] = centerOf(entry.line.points);
      const base = labelEntriesByKey.get(entry.key);
      if (!base) return [];
      const highlighted = isLayerHighlighted(entry.line.layer) && highlightActive;
      return [{ ...base, autoText: automaticLabelText(entry.line.layer, "line", entry.line, highlighted), labelPriority: legacyLabelPriority("line", entry.line, highlighted) ?? 0, order: model.features.length + (model.polygons ?? []).length + entry.index, p: center, radius: 0, small: true, explicit: !!automaticLabelText(entry.line.layer, "line", entry.line), highlighted, pick: { fid: entry.line.fid, lng, lat, kind: "line" as const, key: entry.key } }];
    }),
  ];
  const labelByKey = new Map(labels.map((entry) => [entry.key, entry]));
  const labelCollisionGap = 3 * u * labelScale;
  const calloutLabelFs = Math.max(11 * labelScale, 10.5 * u * labelScale);
  const calloutTextLeft = 8 * u * labelScale;
  const calloutTextRight = 4 * u * labelScale;
  const calloutPadY = 3 * u * labelScale;
  const calloutLineHeight = calloutLabelFs * 1.24;
  const baseCalloutMetrics = W <= 420 ? PX_NARROW : PX;
  const calloutMetrics = { ...baseCalloutMetrics, cardW: baseCalloutMetrics.cardW * u, compactW: baseCalloutMetrics.compactW * u, minW: baseCalloutMetrics.minW * u, gap: baseCalloutMetrics.gap * u, stub: baseCalloutMetrics.stub * u, rMin: baseCalloutMetrics.rMin * u, rMax: baseCalloutMetrics.rMax * u, head: baseCalloutMetrics.head * u, row: baseCalloutMetrics.row * u, pad: baseCalloutMetrics.pad * u, compactH: calloutPadY * 2 + calloutLineHeight };
  const legendY = legendBox?.y0 ?? 0;
  const legendH = legendBox ? legendBox.y1 - legendBox.y0 : 0;
  const naturalCalloutTop = calloutTopOpt ?? (legendBox && legendY <= H / 2 ? legendY + legendH + 6 * u : 4 * u);
  // 외부 제목 칩·컨트롤은 occupiedBoxes에만 남겨 두면 콜아웃 배치가 이미
  // 그 위를 지난 뒤라서 의미가 없다. 좌우 카드 칸과 실제로 겹치는 상단
  // 오버레이만 먼저 예약해 카드와 설명선의 시작점을 함께 아래로 내린다.
  const provisionalFrame = calloutFrame({ W, H, m: calloutMetrics, edge: 4 * u, top: naturalCalloutTop, bottom: H, ...(calloutLeftBottom !== undefined ? { leftBottom: Math.max(naturalCalloutTop, calloutLeftBottom) } : {}), rightInset, perSide: 100, rows: 3, variant: "compact", maxFill: 0.8 });
  const calloutColumns = [provisionalFrame.left, provisionalFrame.right];
  const overlayCalloutTop = calloutAvoid
    .filter((box) => box.y0 < naturalCalloutTop + provisionalFrame.cardH && box.y1 > naturalCalloutTop && calloutColumns.some((column) => box.x0 < column.x1 && column.x0 < box.x1))
    .reduce((top, box) => Math.max(top, box.y1 + 6 * u), naturalCalloutTop);
  const calloutTop = overlayCalloutTop;
  const naturalCalloutBottom = legendBox && legendY > H / 2 ? legendY - 6 * u : H - bottomInset - 4 * u;
  // 축척 판은 occupiedBoxes에만 기록하면 이미 배치된 콜아웃과 겹칠 수 있다.
  // 콜아웃 하단을 축척 판 위로 먼저 제한해 조판 셀에서도 카드가 축척을 가리지 않게 한다.
  const calloutBottom = Math.min(naturalCalloutBottom, scale ? scaleBox.y0 - 6 * u : H);
  const calloutFrameModel = calloutFrame({ W, H, m: calloutMetrics, edge: 4 * u, top: calloutTop, bottom: Math.max(calloutTop, calloutBottom), ...(calloutLeftBottom !== undefined ? { leftBottom: Math.max(calloutTop, calloutLeftBottom) } : {}), rightInset, perSide: 100, rows: 3, variant: "compact", maxFill: 0.8 });
  const hasTerrainSupplement = (model.lines ?? []).some((line) => ["retaining_wall", "cut_fill", "fence"].includes(line.layer));
  const protectTerrainLabel = (layerName: string) => hasTerrainSupplement && (layerName === "contour" || layerName === "retaining_wall" || layerName === "cut_fill" || layerName === "fence" || layerName === "terrain_section_a" || layerName === "terrain_section_b");
  const placementFor = (placed: Placed, entry: MapSceneLabel, text: MapCalloutTextLayout): MapSceneLabelPlacement => {
    const box: MapSceneBox = { x0: placed.x, y0: placed.y, x1: placed.x + placed.width, y1: placed.y + placed.height };
    const points = [entry.p, placed.knee, placed.edge];
    const leader: MapSceneBox = { x0: Math.max(0, Math.min(...points.map(([x]) => x)) - 2 * u), y0: Math.max(0, Math.min(...points.map(([, y]) => y)) - 2 * u), x1: Math.min(W, Math.max(...points.map(([x]) => x)) + 2 * u), y1: Math.min(H, Math.max(...points.map(([, y]) => y)) + 2 * u) };
    return { entry, placed, box, leader, text, variant: "auto" };
  };
  const nearestBoxEdge = (box: MapSceneBox, point: readonly [number, number]): [number, number] => {
    const x = Math.max(box.x0, Math.min(box.x1, point[0]));
    const y = Math.max(box.y0, Math.min(box.y1, point[1]));
    if (point[0] >= box.x0 && point[0] <= box.x1 && point[1] >= box.y0 && point[1] <= box.y1) {
      const distances = [
        { distance: Math.abs(point[0] - box.x0), edge: [box.x0, y] as [number, number] },
        { distance: Math.abs(box.x1 - point[0]), edge: [box.x1, y] as [number, number] },
        { distance: Math.abs(point[1] - box.y0), edge: [x, box.y0] as [number, number] },
        { distance: Math.abs(box.y1 - point[1]), edge: [x, box.y1] as [number, number] },
      ];
      return distances.sort((a, b) => a.distance - b.distance)[0].edge;
    }
    return [x, y];
  };
  const leaderFor = (entry: MapSceneLabel, placed: Placed): MapSceneBox => {
    const points = [entry.p, placed.knee, placed.edge];
    return { x0: Math.max(0, Math.min(...points.map(([x]) => x)) - 2 * u), y0: Math.max(0, Math.min(...points.map(([, y]) => y)) - 2 * u), x1: Math.min(W, Math.max(...points.map(([x]) => x)) + 2 * u), y1: Math.min(H, Math.max(...points.map(([, y]) => y)) + 2 * u) };
  };
  const placementCandidates: Array<{ entry: MapSceneLabel; variant: "auto" | "fixed" | "hover"; rank: number }> = [];
  if (!bare) {
    const pinnedLabelKeys = [...new Set([...pinnedKeys, ...Object.keys(labelBoxes)])];
    const pinnedLabels = pinnedLabelKeys.map((key) => labelByKey.get(key)).filter((entry): entry is MapSceneLabel => !!entry && !hidden.has(entry.key));
    const pinnedSet = new Set(pinnedLabels.map((entry) => entry.key));
    const hoverLabel = hoverKey && !pinned.has(hoverKey) && !hidden.has(hoverKey) ? labelByKey.get(hoverKey) : undefined;
    const automatic = showAutomaticLabels && (model.tileCode ? tileClientModuleFor(model.tileCode)?.autoLabels !== false : true)
      ? selectAutomaticLabels(labels).filter((entry) => !hidden.has(entry.key) && !pinnedSet.has(entry.key) && entry.key !== hoverLabel?.key && !["rail_station", "rail_nearest", "rail_entrance", "rail_line", "rail_station_axis"].includes(entry.layer))
      : [];
    placementCandidates.push(...pinnedLabels.map((entry) => ({ entry, variant: "fixed" as const, rank: -2 })), ...(hoverLabel ? [{ entry: hoverLabel, variant: "hover" as const, rank: -1 }] : []), ...automatic.map((entry) => ({ entry, variant: "auto" as const, rank: 2 - (entry.labelPriority ?? 0) })));
  }
  const candidateLayouts = placementCandidates.map(({ entry, variant, rank }) => {
    const fontSize = variant === "auto" ? Math.max(9 * labelScale, entry.small ? 10.5 * u * 0.9 * labelScale : 10.5 * u * labelScale) : calloutLabelFs;
    const custom = labelBoxes[entry.key];
    const maxWidth = custom ? Math.max(1, custom.w * W) : calloutFrameModel.cardW;
    return { entry, variant, rank, custom, text: mapCalloutTextLayout(entry, fontSize, maxWidth, calloutTextLeft, calloutTextRight, calloutPadY, protectTerrainLabel(entry.layer), custom ? Infinity : 2) };
  });
  const layout = layoutCallouts(calloutFrameModel, candidateLayouts.map(({ entry, rank, text }) => ({ id: entry.key, x: entry.p[0], y: entry.p[1], rank, width: text.width, height: text.height })));
  const placedByKey = new Map(layout.placed.map((placed) => [placed.id, placed]));
  const labelPlacements: MapSceneLabelPlacement[] = [];
  for (const { entry, variant, custom, text } of candidateLayouts) {
    const placed = placedByKey.get(entry.key);
    if (!placed) continue;
    const placement = placementFor(placed, entry, text);
    placement.variant = variant;
    if (!custom && placed.width < text.width - 0.5) {
      // 배치가 칸을 글 폭보다 좁게 잡으면 그 폭으로 다시 나누고 높이를 늘린다(말줄임 대신 줄바꿈).
      const fitted = mapCalloutTextLayout(entry, text.fontSize, placed.width, calloutTextLeft, calloutTextRight, calloutPadY, protectTerrainLabel(entry.layer), 2);
      placement.text = fitted;
      placement.box = { ...placement.box, y1: Math.min(H, placement.box.y0 + Math.max(placed.height, fitted.height)) };
    }
    if (custom) {
      const autoBox = placement.box;
      const box: MapSceneBox = {
        x0: Math.max(0, Math.min(W, custom.x * W)),
        y0: Math.max(0, Math.min(H, custom.y * H)),
        x1: Math.max(0, Math.min(W, (custom.x + custom.w) * W)),
        y1: Math.max(0, Math.min(H, (custom.y + custom.h) * H)),
      };
      const edge = nearestBoxEdge(box, entry.p);
      const customPlaced: Placed = { ...placed, x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, dot: entry.p, knee: edge, edge };
      placement.placed = customPlaced;
      placement.box = box;
      placement.autoBox = autoBox;
      placement.leader = leaderFor(entry, customPlaced);
    }
    labelPlacements.push(placement);
  }
  const occupiedBoxes: MapSceneBox[] = [
    ...(legendBox ? [legendBox] : []),
    ...calloutAvoid,
    ...(scale ? [scaleBox] : []),
    ...(showSiteMarker && !muted ? [siteBounds] : []),
    ...labelPlacements.flatMap((placement) => [placement.box, placement.leader]),
  ];
  const rail = buildRailScene({ model, features: drawn, lines: linePaths, width: W, height: H, mpp, compact, labelScale, hiddenKeys: hidden, occupied: occupiedBoxes, inFrame });
  occupiedBoxes.push(...rail.occupiedBoxes);
  return {
    width: W,
    height: H,
    unit: u,
    activeLayer: layer,
    viewport: vp,
    mpp,
    center: [cx, cy],
    radiusPx,
    terrainSection,
    tiles,
    features: drawn,
    lines: linePaths,
    polygons: visiblePolygons,
    siteParcels,
    siteMode,
    sitePath,
    sitePoints,
    siteBounds,
    rings,
    scale: { ...bar, x0: barX0, x1: barX1, y: barY },
    scaleBox,
    north,
    routePoints,
    labels,
    labelPlacements,
    hiddenKeys: hidden,
    rail,
    occupiedBoxes,
    polygonOpacity: sat ? 0.45 : 0.35,
    lineColor,
    isLayerHighlighted,
    isElementDimmed,
    isElementStrong,
  };
}

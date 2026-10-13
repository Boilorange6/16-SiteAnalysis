import PptxGenJS from "pptxgenjs";
import { buildingStyleForRaster, isBuildingLayer, layerStyle, type MapModel } from "../ui/map-layers";
import { isSiteParcelLayer } from "../ui/site-parcel";
import { SLIDE, slideLegend, slideReserved, slideSiteX } from "../ui/overlay-layout";
import { SLIDE_OVERVIEW_FILL } from "../ui/callout-layout";
import { buildMapScene, type MapScene, type MapSceneBox } from "../ui/map-scene";
import { badgeTextColor } from "../ui/map-labels";
import { FONT, INK, hex, type Slide } from "./pptx-kit";
import type { PlannedSlide } from "./report-plan";

const VIEW_W = 960;
const VIEW_H = 540;
const PX_PER_INCH = VIEW_W / SLIDE.w;
const PX_TO_PT = 0.75;
const EDITABLE_CODES = new Set(["A01", "A09", "D02", "D13"]);
const MAX_LAYER_ELEMENTS = 1500;

export type NativeMapStatus = {
  code: string | undefined;
  native: boolean;
  reason: string;
  estimatedShapes: number;
  layerCounts: Record<string, number>;
  denseLayers: string[];
};

const color = (value: string): string => {
  let result = hex(value).replace(/[^0-9a-f]/gi, "");
  if (result.length === 3) result = result.split("").map((part) => `${part}${part}`).join("");
  return (result || "000000").slice(0, 6).toUpperCase();
};

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
  const native = !!code && EDITABLE_CODES.has(code) && denseLayers.length === 0;
  const reason = !code
    ? "tileCode 없음"
    : !EDITABLE_CODES.has(code)
      ? `1단계 대표 타일 외 타일(${code})`
      : denseLayers.length > 0
        ? `레이어 도형 수 상한 초과: ${denseLayers.join(", ")}`
        : "대표 타일 네이티브 경로";
  return { code, native, reason, estimatedShapes, layerCounts: Object.fromEntries(layerCounts), denseLayers };
}

export function isEditableMap(model: MapModel | null | undefined): boolean {
  return !!model && nativeMapStatus(model).native;
}

export function nativeMapFallbackNote(model: MapModel): string {
  const status = nativeMapStatus(model);
  return `지도 네이티브 도형 폴백: ${status.reason}. 이미지 배경/기존 지도 표현을 유지했습니다.`;
}

function pxX(x: number): number { return (x / VIEW_W) * SLIDE.w; }
function pxY(y: number): number { return (y / VIEW_H) * SLIDE.h; }
function pxPt(value: number): number { return value * PX_TO_PT; }

type PixelPoint = readonly [number, number];
type PixelPath = readonly PixelPoint[];
type ShapePart = { x: number; y: number; moveTo?: boolean } | { close: true };

function tag(code: string, key: string, display: string, part: string): string {
  return `GRP|map-${safeKey(code)}-${safeKey(key)}|${safeKey(display)}|${safeKey(part)}`;
}

function addCustom(
  slide: Slide,
  paths: readonly PixelPath[],
  options: { fill?: string; fillOpacity?: number; line?: string; lineWidth?: number; lineOpacity?: number; dash?: string; objectName: string; closed?: boolean },
): void {
  const points = paths.flatMap((path) => path);
  if (points.length < 2) return;
  const minX = Math.min(...points.map(([x]) => pxX(x)));
  const minY = Math.min(...points.map(([, y]) => pxY(y)));
  const maxX = Math.max(...points.map(([x]) => pxX(x)));
  const maxY = Math.max(...points.map(([, y]) => pxY(y)));
  const parts: ShapePart[] = [];
  for (const path of paths) {
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
    fill: { color: color(options.fill ?? "FFFFFF"), transparency: options.fill ? transparency(options.fillOpacity ?? 1) : 100 },
    line: {
      color: color(options.line ?? "000000"),
      width: Math.max(0.1, pxPt(options.lineWidth ?? 1)),
      transparency: options.line ? transparency(options.lineOpacity ?? 1) : 100,
      dashType: lineDash(options.dash),
    },
    objectName: options.objectName,
  });
}

function addSegment(slide: Slide, a: PixelPoint, b: PixelPoint, lineColor: string, width: number, objectName: string, transparencyValue = 0, dash?: string): void {
  slide.addShape("line", {
    x: Math.min(pxX(a[0]), pxX(b[0])),
    y: Math.min(pxY(a[1]), pxY(b[1])),
    w: Math.max(Math.abs(pxX(b[0]) - pxX(a[0])), 0.005),
    h: Math.max(Math.abs(pxY(b[1]) - pxY(a[1])), 0.005),
    line: { color: color(lineColor), width: Math.max(0.1, pxPt(width)), transparency: transparencyValue, dashType: lineDash(dash) },
    flipV: pxX(b[0]) >= pxX(a[0]) !== pxY(b[1]) >= pxY(a[1]),
    objectName,
  });
}

function sceneFor(plan: PlannedSlide & { kind: "tile" }, model: MapModel): MapScene {
  const legend = slideLegend(model, !plan.muted).rect;
  const avoid = slideReserved(PX_PER_INCH, { legend });
  const calloutOverview = !!plan.callout && plan.callout.page === 0;
  return buildMapScene({
    model,
    width: VIEW_W,
    height: VIEW_H,
    activeLayer: model.basemap ?? "white",
    fill: calloutOverview ? SLIDE_OVERVIEW_FILL : undefined,
    siteX: slideSiteX(),
    bottomInset: SLIDE.stripH * PX_PER_INCH,
    scale: true,
    muted: !!plan.muted,
    pinnedKeys: plan.pinnedKeys ?? [],
    showAutomaticLabels: true,
    avoid,
    bare: false,
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

function addPolygons(slide: Slide, code: string, scene: MapScene, model: MapModel): void {
  const buckets = new Map<string, Bucket>();
  const hasRaster = (model.rasters?.length ?? 0) > 0;
  for (const polygon of scene.polygons) {
    if (isSiteParcelLayer(polygon.polygon.layer)) continue;
    const style = layerStyle(polygon.polygon.layer);
    const estimated = polygon.polygon.layer.endsWith("_est") || style.label.startsWith("[추정]") || style.hatch === true;
    const neutral = hasRaster && isBuildingLayer(polygon.polygon.layer);
    const building = buildingStyleForRaster(polygon.polygon.layer, hasRaster);
    const fill = neutral ? building.fill : estimated ? (style.fill ?? style.color) : (style.fill ?? style.color);
    const fillOpacity = neutral ? building.fillOpacity : style.fillOpacity ?? scene.polygonOpacity;
    const stroke = neutral ? building.stroke : style.stroke ?? style.color;
    const lineWidth = neutral ? building.strokeWidth ?? 0.8 : style.strokeWidth ?? 1;
    const dash = estimated ? "dash" : undefined;
    const key = `polygon-${safeKey(`${fill}-${fillOpacity}-${stroke}-${lineWidth}-${dash ?? "solid"}`)}`;
    const bucket = buckets.get(key) ?? { paths: [], fill, fillOpacity, line: stroke, lineWidth, dash, key, display: `면 · ${style.label}` };
    bucket.paths.push(...polygon.rings);
    buckets.set(key, bucket);
  }
  addBuckets(slide, code, buckets, true);
}

function addLines(slide: Slide, code: string, scene: MapScene): void {
  const buckets = new Map<string, Bucket>();
  for (const entry of scene.lines) {
    if (entry.points.length < 2) continue;
    const style = layerStyle(entry.line.layer);
    const baseWidth = entry.line.strokeWidth ?? style.strokeWidth ?? 1.5;
    const width = baseWidth * (entry.line.emphasis === "major" ? 1.2 : entry.line.emphasis === "minor" ? 0.85 : 1);
    const opacity = entry.line.opacity ?? style.opacity ?? 1;
    const stroke = entry.line.color ?? style.color;
    const casing = entry.line.casing ?? style.casing;
    const casingWidth = entry.line.casingWidth ?? width + 2.4;
    if (casing) {
      const key = `line-casing-${safeKey(`${casing}-${casingWidth}-${style.dash ?? "solid"}`)}`;
      const bucket = buckets.get(key) ?? { paths: [], line: casing, lineWidth: casingWidth, lineOpacity: opacity, dash: style.dash, key, display: `선 외곽 · ${style.label}` };
      bucket.paths.push(entry.points);
      buckets.set(key, bucket);
    }
    const key = `line-${safeKey(`${stroke}-${width}-${style.dash ?? "solid"}`)}`;
    const bucket = buckets.get(key) ?? { paths: [], line: stroke, lineWidth: width, lineOpacity: opacity, dash: style.dash, key, display: `선 · ${style.label}` };
    bucket.paths.push(entry.points);
    buckets.set(key, bucket);
  }
  addBuckets(slide, code, buckets, false);
}

function addRadius(slide: Slide, code: string, scene: MapScene): void {
  const [cx, cy] = scene.center;
  for (const [index, radius] of scene.rings.entries()) {
    slide.addShape("ellipse", { x: pxX(cx - radius), y: pxY(cy - radius), w: pxX(radius * 2), h: pxY(radius * 2), fill: { color: "FFFFFF", transparency: 100 }, line: { color: color(scene.lineColor), width: pxPt(1), transparency: scene.activeLayer === "Satellite" ? 30 : 65, dashType: "dash" }, objectName: tag(code, "radius", "분석 반경", `ring-${index}`) });
  }
  const radius = scene.radiusPx;
  slide.addShape("ellipse", { x: pxX(cx - radius), y: pxY(cy - radius), w: pxX(radius * 2), h: pxY(radius * 2), fill: { color: "FFFFFF", transparency: 100 }, line: { color: color(scene.lineColor), width: pxPt(1.6), transparency: scene.activeLayer === "Satellite" ? 5 : 25 }, objectName: tag(code, "radius", "분석 반경", "outer") });
}

function addFeatures(slide: Slide, code: string, scene: MapScene, model: MapModel): void {
  const hasRaster = (model.rasters?.length ?? 0) > 0;
  const satellite = scene.activeLayer === "Satellite";
  for (const entry of scene.features) {
    const feature = entry.feature;
    const r = entry.radius;
    if (entry.p[0] < -r || entry.p[1] < -r || entry.p[0] > VIEW_W + r || entry.p[1] > VIEW_H + r) continue;
    const style = layerStyle(feature.layer);
    const neutral = hasRaster && isBuildingLayer(feature.layer);
    const building = buildingStyleForRaster(feature.layer, hasRaster);
    const hollow = style.sizeBy === "weight" && !feature.weight;
    const entrance = feature.layer === "rail_entrance";
    const key = `feature-${safeKey(entry.key)}`;
    const display = feature.label?.trim() || style.label;
    const opacity = scene.isElementDimmed(feature.layer, entry.key) ? 0.2 : 1;
    if (entrance) {
      const diameter = Math.max(3.5 * scene.unit, r * 1.7);
      slide.addShape("ellipse", { x: pxX(entry.p[0] - diameter / 2), y: pxY(entry.p[1] - diameter / 2), w: pxX(diameter), h: pxY(diameter), fill: { color: "FFFFFF" }, line: { color: color("334155"), width: pxPt(1.1 * scene.unit), transparency: transparency(opacity) }, objectName: tag(code, key, display, "entrance") });
      if (feature.label?.trim()) slide.addText(feature.label.trim(), { x: pxX(entry.p[0] - diameter / 2), y: pxY(entry.p[1] - diameter * 0.2), w: pxX(diameter), h: pxY(diameter * 0.8), align: "center", valign: "middle", fontFace: FONT, fontSize: Math.max(7, pxPt(10.5 * scene.unit * 0.72)), bold: true, color: INK, margin: 0, objectName: tag(code, key, display, "number") });
      continue;
    }
    const fill = neutral ? building.fill ?? style.color : hollow ? "FFFFFF" : feature.color ?? style.color;
    const fillOpacity = neutral ? building.fillOpacity ?? 0.94 : hollow ? 0.6 : style.sizeBy === "weight" ? 0.55 : feature.highlight ? 1 : 0.85;
    const stroke = scene.isElementStrong(feature.layer, entry.key) || feature.highlight || entry.selected ? INK : neutral ? building.stroke ?? style.color : satellite ? "FFFFFF" : style.sizeBy === "weight" ? style.color : "FFFFFF";
    const strokeWidth = scene.isElementStrong(feature.layer, entry.key) ? 1.6 : feature.highlight || entry.selected ? 2.8 : neutral ? building.strokeWidth ?? 0.8 : satellite ? 1.5 : style.sizeBy === "weight" ? 1.4 : 0.8;
    slide.addShape("ellipse", { x: pxX(entry.p[0] - r), y: pxY(entry.p[1] - r), w: pxX(r * 2), h: pxY(r * 2), fill: { color: color(fill), transparency: transparency(fillOpacity) }, line: { color: color(stroke), width: pxPt(strokeWidth), transparency: transparency(opacity) }, objectName: tag(code, key, display, "dot") });
  }
}

function addNearestLines(slide: Slide, code: string, scene: MapScene): void {
  const [cx, cy] = scene.center;
  for (const entry of scene.features) {
    if (!entry.feature.highlight || entry.feature.distanceM == null) continue;
    addSegment(slide, [cx, cy], entry.p, scene.isElementStrong(entry.feature.layer, entry.key) ? INK : scene.lineColor, scene.isElementStrong(entry.feature.layer, entry.key) ? 1.6 : 1.4, tag(code, `nearest-${safeKey(entry.key)}`, "최근접 지시선", "line"), scene.isElementDimmed(entry.feature.layer, entry.key) ? 80 : 0, "3 3");
  }
}

function addRoute(slide: Slide, code: string, scene: MapScene): void {
  if (scene.routePoints.length < 2) return;
  addCustom(slide, [scene.routePoints], { line: "FFFFFF", lineWidth: 8, lineOpacity: 0.92, objectName: tag(code, "route", "보행 경로", "halo") });
  addCustom(slide, [scene.routePoints], { line: "D97706", lineWidth: 4.5, objectName: tag(code, "route", "보행 경로", "line") });
  const start = scene.routePoints[0]!;
  const end = scene.routePoints.at(-1)!;
  slide.addShape("ellipse", { x: pxX(start[0] - 5.5), y: pxY(start[1] - 5.5), w: pxX(11), h: pxY(11), fill: { color: color(INK) }, line: { color: "FFFFFF", width: pxPt(2) }, objectName: tag(code, "route", "보행 경로", "start") });
  slide.addShape("ellipse", { x: pxX(end[0] - 6.5), y: pxY(end[1] - 6.5), w: pxX(13), h: pxY(13), fill: { color: "D97706" }, line: { color: "FFFFFF", width: pxPt(2.5) }, objectName: tag(code, "route", "보행 경로", "end") });
}

function addSite(slide: Slide, code: string, scene: MapScene): void {
  const [cx, cy] = scene.center;
  const siteR = 10;
  if (scene.siteMode === "parcel" && scene.siteParcels.length > 0) {
    const paths = scene.siteParcels.flatMap((polygon) => polygon.rings);
    addCustom(slide, paths, { fill: "FFFFFF", fillOpacity: 0.18, line: "FFFFFF", lineWidth: Math.max(0.5 * siteR, 2.4), objectName: tag(code, "site", "분석 대지", "halo"), closed: true });
    addCustom(slide, paths, { line: "111111", lineWidth: Math.max(0.2 * siteR, 1.2), objectName: tag(code, "site", "분석 대지", "outline"), closed: true });
    slide.addShape("diamond", { x: pxX(cx - 0.7 * siteR), y: pxY(cy - 0.7 * siteR), w: pxX(1.4 * siteR), h: pxY(1.4 * siteR), fill: { color: "FFFFFF" }, line: { color: "111111", width: pxPt(0.22 * siteR) }, objectName: tag(code, "site", "분석 대지", "diamond") });
    slide.addShape("ellipse", { x: pxX(cx - 0.2 * siteR), y: pxY(cy - 0.2 * siteR), w: pxX(0.4 * siteR), h: pxY(0.4 * siteR), fill: { color: "111111" }, line: { color: "111111", width: 0 }, objectName: tag(code, "site", "분석 대지", "dot") });
    return;
  }
  slide.addShape("ellipse", { x: pxX(cx - 1.25 * siteR), y: pxY(cy - 1.25 * siteR), w: pxX(2.5 * siteR), h: pxY(2.5 * siteR), fill: { color: "FFFFFF", transparency: 100 }, line: { color: "FFFFFF", width: pxPt(0.55 * siteR) }, objectName: tag(code, "site", "분석 대지", "ring-halo") });
  slide.addShape("ellipse", { x: pxX(cx - 1.25 * siteR), y: pxY(cy - 1.25 * siteR), w: pxX(2.5 * siteR), h: pxY(2.5 * siteR), fill: { color: "FFFFFF", transparency: 100 }, line: { color: "111111", width: pxPt(0.22 * siteR) }, objectName: tag(code, "site", "분석 대지", "ring") });
  addSegment(slide, [cx, cy - 2 * siteR], [cx, cy - 0.6 * siteR], "FFFFFF", 0.5 * siteR, tag(code, "site", "분석 대지", "cross-halo"));
  addSegment(slide, [cx, cy + 0.6 * siteR], [cx, cy + 2 * siteR], "FFFFFF", 0.5 * siteR, tag(code, "site", "분석 대지", "cross-halo"));
  addSegment(slide, [cx - 2 * siteR, cy], [cx - 0.6 * siteR, cy], "FFFFFF", 0.5 * siteR, tag(code, "site", "분석 대지", "cross-halo"));
  addSegment(slide, [cx + 0.6 * siteR, cy], [cx + 2 * siteR, cy], "FFFFFF", 0.5 * siteR, tag(code, "site", "분석 대지", "cross-halo"));
  addSegment(slide, [cx, cy - 2 * siteR], [cx, cy - 0.6 * siteR], "111111", 0.2 * siteR, tag(code, "site", "분석 대지", "cross"));
  addSegment(slide, [cx, cy + 0.6 * siteR], [cx, cy + 2 * siteR], "111111", 0.2 * siteR, tag(code, "site", "분석 대지", "cross"));
  addSegment(slide, [cx - 2 * siteR, cy], [cx - 0.6 * siteR, cy], "111111", 0.2 * siteR, tag(code, "site", "분석 대지", "cross"));
  addSegment(slide, [cx + 0.6 * siteR, cy], [cx + 2 * siteR, cy], "111111", 0.2 * siteR, tag(code, "site", "분석 대지", "cross"));
  slide.addShape("ellipse", { x: pxX(cx - 0.28 * siteR), y: pxY(cy - 0.28 * siteR), w: pxX(0.56 * siteR), h: pxY(0.56 * siteR), fill: { color: "111111" }, line: { color: "FFFFFF", width: pxPt(0.12 * siteR) }, objectName: tag(code, "site", "분석 대지", "dot") });
}

function addLabels(slide: Slide, code: string, scene: MapScene): void {
  for (const placement of scene.labelPlacements) {
    const entry = placement.entry;
    const key = `label-${safeKey(entry.key)}`;
    const display = entry.text || entry.title;
    const points: PixelPoint[] = [entry.p, placement.placed.knee, placement.placed.edge];
    addSegment(slide, points[0]!, points[1]!, "FFFFFF", 3.6 * scene.unit, tag(code, key, `라벨 · ${display}`, "leader-halo"));
    addSegment(slide, points[1]!, points[2]!, "FFFFFF", 3.6 * scene.unit, tag(code, key, `라벨 · ${display}`, "leader-halo"));
    addSegment(slide, points[0]!, points[1]!, INK, 1.2 * scene.unit, tag(code, key, `라벨 · ${display}`, "leader"));
    addSegment(slide, points[1]!, points[2]!, INK, 1.2 * scene.unit, tag(code, key, `라벨 · ${display}`, "leader"));
    slide.addShape("ellipse", { x: pxX(entry.p[0] - Math.max(1.8 * scene.unit, placement.text.fontSize * 0.2)), y: pxY(entry.p[1] - Math.max(1.8 * scene.unit, placement.text.fontSize * 0.2)), w: pxX(Math.max(1.8 * scene.unit, placement.text.fontSize * 0.2) * 2), h: pxY(Math.max(1.8 * scene.unit, placement.text.fontSize * 0.2) * 2), fill: { color: color(INK) }, line: { color: color(INK), width: 0 }, objectName: tag(code, key, `라벨 · ${display}`, "anchor") });
    const box = placement.box;
    slide.addShape("roundRect", { x: pxX(box.x0), y: pxY(box.y0), w: pxX(box.x1 - box.x0), h: pxY(box.y1 - box.y0), rectRadius: 0.04, fill: { color: "FFFFFF" }, line: { color: color(INK), width: pxPt(1.2 * scene.unit) }, objectName: tag(code, key, `라벨 · ${display}`, "box") });
    const dot = Math.max(1.8 * scene.unit, placement.text.fontSize * 0.2);
    slide.addShape("ellipse", { x: pxX(box.x0 + 4 * scene.unit - dot), y: pxY((box.y0 + box.y1) / 2 - dot), w: pxX(dot * 2), h: pxY(dot * 2), fill: { color: color(INK) }, line: { color: color(INK), width: 0 }, objectName: tag(code, key, `라벨 · ${display}`, "box-dot") });
    const text = placement.text.lines.map((line) => line.kind === "joined" ? `${line.title} · ${line.detail}` : line.text).join("\n");
    slide.addText(text, { x: pxX(box.x0 + 8 * scene.unit), y: pxY(box.y0 + 3 * scene.unit), w: pxX(Math.max(1, box.x1 - box.x0 - 12 * scene.unit)), h: pxY(Math.max(1, box.y1 - box.y0 - 6 * scene.unit)), valign: "top", fontFace: FONT, fontSize: Math.max(7, pxPt(placement.text.fontSize)), color: INK, margin: 0, fit: "shrink", breakLine: false, objectName: tag(code, key, `라벨 · ${display}`, "text") });
  }
}

function addBadges(slide: Slide, code: string, scene: MapScene): void {
  for (const badge of scene.badges) {
    const key = `badge-${badge.featureIndex}-${badge.badgeIndex}`;
    const display = `배지 · ${badge.text}`;
    if (badge.station) {
      slide.addShape("ellipse", { x: pxX(badge.x), y: pxY(badge.y), w: pxX(badge.width), h: pxY(badge.height), fill: { color: color(badge.color) }, line: { color: "FFFFFF", width: pxPt(0.8 * scene.unit) }, objectName: tag(code, key, display, "circle") });
    } else {
      slide.addShape("roundRect", { x: pxX(badge.x), y: pxY(badge.y), w: pxX(badge.width), h: pxY(badge.height), rectRadius: 0.04, fill: { color: color(badge.color) }, line: { color: "FFFFFF", width: pxPt(0.8 * scene.unit) }, objectName: tag(code, key, display, "rect") });
    }
    slide.addText(badge.text, { x: pxX(badge.x), y: pxY(badge.y), w: pxX(badge.width), h: pxY(badge.height), align: "center", valign: "middle", fontFace: FONT, fontSize: Math.max(6, pxPt(badge.fontSize)), bold: true, color: color(badgeTextColor(badge.color)), margin: 0, fit: "shrink", objectName: tag(code, key, display, "text") });
  }
}

function addNorth(slide: Slide, code: string, scene: MapScene): void {
  if (!scene.north) return;
  const { x, y } = scene.north;
  const u = scene.unit;
  const key = "north";
  slide.addShape("ellipse", { x: pxX(x - 13 * u), y: pxY(y - 13 * u), w: pxX(26 * u), h: pxY(26 * u), fill: { color: "FFFFFF", transparency: 10 }, line: { color: "FFFFFF", width: 0 }, objectName: tag(code, key, "방위표", "bg") });
  addCustom(slide, [[ [x, y - 9 * u], [x + 4.5 * u, y + 3 * u], [x, y + 0.5 * u], [x - 4.5 * u, y + 3 * u] ]], { fill: INK, line: INK, lineWidth: 0.1, objectName: tag(code, key, "방위표", "arrow"), closed: true });
  slide.addText("N", { x: pxX(x - 8 * u), y: pxY(y + 5 * u), w: pxX(16 * u), h: pxY(8 * u), align: "center", valign: "middle", fontFace: FONT, fontSize: Math.max(6, pxPt(7.5 * u)), bold: true, color: INK, margin: 0, objectName: tag(code, key, "방위표", "label") });
}

function addScale(slide: Slide, code: string, scene: MapScene): void {
  const bar = scene.scale;
  const u = scene.unit;
  const key = "scale";
  slide.addShape("roundRect", { x: pxX(bar.x0 - 6 * u), y: pxY(bar.y - 14 * u), w: pxX(bar.px + 12 * u), h: pxY(22 * u), rectRadius: 0.06, fill: { color: "FFFFFF", transparency: 15 }, line: { color: "FFFFFF", width: 0 }, objectName: tag(code, key, "축척", "bg") });
  addSegment(slide, [bar.x0, bar.y - 4 * u], [bar.x0, bar.y], INK, 1.6 * u, tag(code, key, "축척", "left"));
  addSegment(slide, [bar.x0, bar.y], [bar.x1, bar.y], INK, 1.6 * u, tag(code, key, "축척", "bar"));
  addSegment(slide, [bar.x1, bar.y], [bar.x1, bar.y - 4 * u], INK, 1.6 * u, tag(code, key, "축척", "right"));
  slide.addText(bar.label, { x: pxX(bar.x0), y: pxY(bar.y - 11 * u), w: pxX(bar.px), h: pxY(8 * u), align: "center", valign: "middle", fontFace: FONT, fontSize: Math.max(6, pxPt(9.5 * u)), bold: true, color: INK, margin: 0, objectName: tag(code, key, "축척", "label") });
}

/** 지도 장에 배경 이미지 위의 편집 가능한 네이티브 지도 표현을 그린다. */
export function addEditableMap(slide: Slide, plan: PlannedSlide & { kind: "tile" }, model: MapModel): NativeMapStatus {
  const status = nativeMapStatus(model);
  if (!status.native) return status;
  const scene = sceneFor(plan, model);
  const code = model.tileCode ?? "map";
  addPolygons(slide, code, scene, model);
  addLines(slide, code, scene);
  addRadius(slide, code, scene);
  addNearestLines(slide, code, scene);
  addFeatures(slide, code, scene, model);
  addBadges(slide, code, scene);
  addRoute(slide, code, scene);
  addSite(slide, code, scene);
  addLabels(slide, code, scene);
  addNorth(slide, code, scene);
  addScale(slide, code, scene);
  return status;
}

export function editableMapAvoid(plan: PlannedSlide & { kind: "tile" }, model: MapModel): MapSceneBox[] {
  const legend = slideLegend(model, !plan.muted).rect;
  return slideReserved(PX_PER_INCH, { legend });
}

import { memo, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { buildingStyleForRaster, isBuildingLayer, layerStyle, legendItems, RASTER_STYLES, type MapModel, type RasterStyle } from "@/lib/v2/ui/map-layers";
import { badgeTextColor, mapLabelText as formatMapLabelText } from "@/lib/v2/ui/map-labels";
import { applyView, BASEMAP_ATTRIBUTION, BASEMAP_STACK, framedViewport, makeProjector, metersPerPixel, scaleBar, tilesFor, tileUrl, worldPx, type BasemapChoice, type MapView, type Viewport } from "@/lib/v2/ui/map-projection";
import { rasterAffine, rasterLegendColor, rasterLegendEntries, resolveRasterStyle } from "@/lib/v2/ui/raster-image";
import type { MapFeature, MapLine, MapPolygon, RasterRef } from "@/lib/v2/tile-result";
import { maxOf, minOf } from "@/lib/v2/extent";
import { isSiteParcelLayer } from "@/lib/v2/ui/site-parcel";
import { calloutFrame, layoutCallouts, PX, PX_NARROW, type Placed } from "@/lib/v2/ui/callout-layout";
import { buildMapScene, mapCalloutTextLayout, mapElementKey, mapFeatureKey, mapLabelEntries, mapTextWidth, RAIL_EXIT_COLOR, RAIL_EXIT_DOT_RADIUS, RAIL_EXIT_DOT_STROKE, type MapCalloutTextLayout, type MapSceneLabel } from "@/lib/v2/ui/map-scene";

export { mapCalloutTextLayout, mapFeatureKey, mapLabelEntries, mapLabelText } from "@/lib/v2/ui/map-scene";

/**
 * 지도 그림 하나(SVG). 카드·상세·PPT가 같은 입력으로 같은 그림을 그린다.
 * CSS 모듈을 쓰지 않는다 — 문자열로 직렬화해 PNG로 바꿀 수 있어야 한다.
 */
export type MapFigureProps = {
  model: MapModel;
  width: number;
  height: number;
  /** "none"이면 배경 타일 없이 격자만 (배경을 못 받았을 때) */
  basemap?: "tiles" | "none";
  /** 배경지도 종류 (기본 일반=white). 항공은 위성 사진 위에 글자 레이어를 겹친다 */
  layer?: BasemapChoice;
  /** 배경 타일 주소 → 실제 href (PPT용: data URI로 바꿔 넣는다). 반환 undefined면 그 타일은 생략 */
  tileHref?: (url: string) => string | undefined;
  /** 결과 래스터 이름 → 압축 해제·팔레트 처리한 이미지 data URL (MapBox/PPT가 주입) */
  rasterHref?: (ref: RasterRef) => string | null;
  /** 컷 렌더러가 직접 지정할 수 있는 래스터 이름. TileView의 viewWithOnlyRaster와 함께 쓴다. */
  rasterName?: string;
  /** true면 범례·문구를 그리지 않는다 (대지 요약 칸) */
  bare?: boolean;
  /** 배경 타일·래스터만 남긴다. 문자열 배열이면 해당 벡터 층만 래스터에 남긴다. */
  backgroundOnly?: boolean | readonly string[];
  /** 직렬화용: width/height 속성을 붙인다. 아니면 부모를 채운다 */
  fixed?: boolean;
  /** 카드처럼 작은 프레임에서 출구 번호를 최근접 출구 하나로 줄인다. */
  compact?: boolean;
  label?: string;
  /** false면 SVG 안의 벡터·래스터 범례를 모두 그리지 않는다. */
  legend?: boolean;
  /** 범례 위쪽 위치(px). 제목 칩 아래에 놓을 때 */
  legendY?: number;
  /** 북쪽 표시의 중심 y(px). false면 그리지 않는다 (보고서 칩 아래에 놓거나 슬라이드에서는 생략) */
  north?: number | false;
  /** 축척 막대 (기본 그림) */
  scale?: boolean;
  /** 대지 지정 화면처럼 큰 반경 원·바깥 dim을 숨긴다. */
  showRadius?: boolean;
  /** 호출부가 별도의 대지 표식을 그릴 때 기본 표식을 숨긴다. */
  showSiteMarker?: boolean;
  /** 그림 안 저작권 글자. 출처 띠가 대신하면 false */
  credit?: boolean;
  /** 맨 아래 출처 띠가 덮는 높이(px). 축척 막대가 그 위에 놓인다 */
  bottomInset?: number;
  /** 오버레이가 덮는 자리 — 강조 라벨이 피한다 */
  avoid?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  /** 대지 중심의 가로 위치(0~1, 기본 0.5). 오른쪽에 정보 판이 있으면 왼쪽으로 옮긴다 */
  siteX?: number;
  /** 흐리게(흑백+번짐): 상태 화면 배경 */
  muted?: boolean;
  /** 오른쪽에 떠 있는 정보 판의 폭(px): 북쪽·축척이 그 왼쪽에 놓인다 */
  rightInset?: number;
  /** 축척을 왼쪽 아래에 (펼침) */
  scaleLeft?: boolean;
  /** 반경 원 지름 / 그림 높이 (기본 0.8). 설명선 칸 사이에 원을 넣을 때 줄인다 */
  fill?: number;
  /** 축척 막대 왼쪽 끝 x(px). 지정하면 rightInset·scaleLeft 대신 이 자리에 놓는다 (설명선 칸 사이) */
  scaleX?: number;
  /** 대지 중심의 세로 위치(0~1, 기본 0.5). 아래에서 올라오는 시트가 있으면 위로 옮긴다 */
  siteY?: number;
  /** 상세 창에서 행/지도 선택을 같은 fid로 강조한다. */
  selectedFids?: readonly string[];
  /** 범례 라벨 기준 화면 강조. 같은 라벨의 여러 레이어를 함께 강조한다. */
  highlightLabel?: string | null;
  /** 키보드/클릭으로 고정된 범례 라벨(aria-pressed에 사용). */
  highlightPinnedLabel?: string | null;
  /** 요소 호버 라벨과 고정 라벨에 쓰는 현재 요소 키. */
  hoverKey?: string | null;
  /** 상세의 고정 라벨 목록에서 가리킨 요소를 지도에서 시각적으로 강조한다. */
  emphasisKey?: string | null;
  /** 지도에 남길 고정 라벨 키. */
  pinnedKeys?: readonly string[];
  /** 자동 라벨·말풍선·지시선을 표시한다. 생략하면 상세/PPT 호환을 위해 표시한다. */
  showAutomaticLabels?: boolean;
  /** 요소 포인터 호버. 터치 포인터에서는 호출하지 않는다. */
  onFeatureHover?: (key: string | null) => void;
  /** 요소 클릭/키보드 선택에 따른 라벨 고정 토글. */
  onFeaturePin?: (feature: MapFigureElementPick) => void;
  /** SVG 범례 호버. */
  onLegendHover?: (label: string | null) => void;
  /** SVG 범례 클릭/키보드 고정 토글. null은 강조 해제다. */
  onLegendPin?: (label: string | null) => void;
  /** 상세 창의 보행 경로 등 WGS84 경로선. */
  path?: Array<[number, number]>;
  /** 점·면·선 지물을 클릭하거나 Enter/Space로 선택했을 때의 좌표. */
  onFeatureClick?: (feature: { fid?: string; lng: number; lat: number; kind: "feature" | "polygon" | "line" }) => void;
  /** 래스터 지점처럼 별도 벡터 지물이 없는 곳을 클릭했을 때의 WGS84 좌표. */
  onMapClick?: (coordinate: { lng: number; lat: number }) => void;
  /** 화면 탐색용 확정 뷰. 생략하면 보고서·기존 렌더와 같은 반경 전체 뷰다. */
  view?: MapView;
  /** 드래그 중에는 hover 라벨을 갱신하지 않는다. */
  dragging?: boolean;
};

export type MapFigurePick = { fid?: string; lng: number; lat: number; kind: "feature" | "polygon" | "line" };
export type MapFigureElementPick = MapFigurePick & { key: string };

const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
const INK = "#16181d";

function a04PolygonDrawOrder(layer: string): number {
  if (layer === "green_zone" || layer === "green_parcel") return 0;
  if (layer === "water_parcel") return 1;
  if (layer === "park" || layer === "park_nearest") return 2;
  return 3;
}

const textW = mapTextWidth;
type Box = { x0: number; y0: number; x1: number; y1: number };
type ScreenPoint = readonly [number, number];

export type SiteMarkerMode = "parcel" | "ring";

function truncateMapLabelText(value: string, maxWidth: number, fontSize: number): string {
  if (textW(value, fontSize) <= maxWidth) return value;
  const ellipsis = "…";
  if (textW(ellipsis, fontSize) >= maxWidth) return ellipsis;
  let result = "";
  for (const character of [...value]) {
    if (textW(`${result}${character}${ellipsis}`, fontSize) > maxWidth) break;
    result += character;
  }
  return `${result}${ellipsis}`;
}

const labelText = formatMapLabelText;

const SITE_MARKER_EDGE_PX = 10;
/** 작은 필지는 윤곽이 점처럼 뭉개지므로 후보 1 링으로 바꾼다. 크기는 필지 외곽 상자의 짧은 변으로 본다
 * (꼭짓점 사이 변 길이로 보면 꼭짓점이 촘촘한 큰 필지도 링이 된다). */
export function siteMarkerMode(points?: readonly ScreenPoint[] | null): SiteMarkerMode {
  if (!points || points.length < 3) return "ring";
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return Math.min(x1 - x0, y1 - y0) >= SITE_MARKER_EDGE_PX ? "parcel" : "ring";
}

/** fixed SVG는 보고서/PPT, 높이가 작은 MapBox는 카드, 나머지는 상세 보기다. */
export function siteMarkerRadius(height: number, fixed = false): number {
  if (fixed) return 10;
  return height < 360 ? 4 : 7;
}

function rasterStopPositions(style: RasterStyle): number[] {
  const colors = style.colors;
  const min = style.min ?? 0;
  const max = style.max ?? 1;
  const supplied = style.stops?.length === colors.length ? style.stops : null;
  const valid = supplied && supplied.every((stop, index) => Number.isFinite(stop) && (index === 0 || stop > supplied[index - 1]!));
  const values = valid ? supplied! : colors.map((_, index) => (colors.length === 1 ? min : min + ((max - min) * index) / (colors.length - 1)));
  return values.map((value) => max <= min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min))));
}

type RasterLegendEntry = { label: string; min: number | null; max: number | null };
type RasterPresentationModel = MapModel & {
  legend?: RasterLegendEntry[];
  defaultRaster?: string;
  rasterOptions?: RasterRef[];
};
type PrimaryRasterRef = RasterRef & { primary?: boolean };
type RasterLegendConfig = { ref: RasterRef; style: RasterStyle; entries: RasterLegendEntry[] };

function rasterCandidates(model: RasterPresentationModel): RasterRef[] {
  const displayed = model.rasters ?? [];
  const options = model.rasterOptions ?? [];
  // Keep the full option list for normal tile views, but honor an explicit
  // caller-provided raster that is not part of that list (test/cut models).
  if (displayed.some((ref) => !options.some((option) => option.name === ref.name))) return displayed;
  return options.length > 0 ? options : displayed;
}

function selectedRaster(model: RasterPresentationModel, requestedName?: string): RasterRef | null {
  const refs = rasterCandidates(model);
  if (refs.length === 0) return null;
  const requested = requestedName ?? model.defaultRaster;
  if (requested) {
    const declared = refs.find((ref) => ref.name === requested);
    if (declared) return declared;
  }
  const primary = refs.find((ref) => (ref as PrimaryRasterRef).primary === true);
  return primary ?? refs[0] ?? null;
}

function steppedLegendTitle(ref: RasterRef, style: RasterStyle): string {
  return style.label ?? ref.label ?? ref.name;
}

/** 카드 알약은 공간이 좁으므로, 원문을 자르지 않는 짧은 표시명을 사용한다. */
function compactSteppedLegendTitle(ref: RasterRef, style: RasterStyle): string {
  return steppedLegendTitle(ref, style);
}

/** 범주명이 있는 팔레트(UTCI)는 칸 경계마다 하한 숫자를 모두 적는다. */
function steppedLegendTicksFor(ref: RasterRef, entries: RasterLegendEntry[], style?: RasterStyle): Array<{ label: string; position: number }> {
  if (entries.length === 0) return [];
  if (style?.legendLabels) {
    return entries.flatMap((entry, index) => (index === 0 || entry.min === null ? [] : [{ label: String(entry.min), position: index / entries.length }]));
  }
  const last = entries.length - 1;
  const indexes = ref.palette === "sun_hours"
    ? [0, 3, 6, 9, 12, last].filter((index) => index <= last)
    : [0, Math.round(last * 0.25), Math.round(last * 0.5), Math.round(last * 0.75), last];
  const unique = Array.from(new Set(indexes)).sort((a, b) => a - b);
  return unique.map((index) => {
    const entry = entries[index]!;
    const value = entry.min ?? entry.max ?? index;
    const numeric = Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
    const lastBin = index === last && (entry.max === null || ref.palette === "sun_hours");
    return {
      label: lastBin ? `${numeric}+` : numeric,
      // A tick names the lower edge of its cell; the open-ended last bin ends at the bar edge.
      position: entries.length === 1 ? 0 : index === last ? 1 : index / entries.length,
    };
  });
}

/** 칸 가운데에 놓는 범주명 (stepped + legendLabels). */
function steppedLegendNames(style: RasterStyle, count: number): Array<{ label: string; position: number }> {
  return (style.legendLabels ?? []).slice(0, count).map((label, index) => ({ label, position: (index + 0.5) / count }));
}

type BackgroundImage = { key: string; href: string; tile: ReturnType<typeof tilesFor>[number] };
type BackgroundFrame = { key: string; vp: Viewport; images: readonly BackgroundImage[] };

function backgroundTransform(from: Viewport, to: Viewport, width: number, height: number): string {
  const scale = 2 ** (to.zoom - from.zoom);
  const [fromX, fromY] = worldPx(from.center[0], from.center[1], from.zoom);
  const [toX, toY] = worldPx(to.center[0], to.center[1], to.zoom);
  const e = width / 2 + scale * fromX - toX - scale * width / 2;
  const f = height / 2 + scale * fromY - toY - scale * height / 2;
  return `matrix(${scale},0,0,${scale},${e},${f})`;
}

function MapFigure({ model, width: W, height: H, basemap = "tiles", layer = "white", tileHref, rasterHref, rasterName, bare, backgroundOnly = false, fixed, compact = false, label, legend, legendY, north: northOpt, scale = true, showRadius = true, showSiteMarker = true, credit = true, bottomInset = 0, avoid = [], siteX = 0.5, muted, rightInset = 0, scaleLeft, fill = 0.8, scaleX, siteY = 0.5, selectedFids = [], highlightLabel = null, highlightPinnedLabel = null, hoverKey = null, emphasisKey = null, pinnedKeys = [], showAutomaticLabels = true, onFeatureClick, onFeatureHover, onFeaturePin, onLegendHover, onLegendPin, path = [], onMapClick, view, dragging = false }: MapFigureProps) {
  const backgroundLayerSet = Array.isArray(backgroundOnly) ? new Set(backgroundOnly) : null;
  const backgroundOnlyActive = backgroundOnly === true || backgroundLayerSet !== null;
  const shouldRasterizeLayer = (layerName: string) => !backgroundOnlyActive || !!backgroundLayerSet?.has(layerName);
  const showNativeChrome = !backgroundOnlyActive;
  const rasterModel = model as RasterPresentationModel;
  const activeLayer = model.basemap ?? layer;
  const sat = activeLayer === "Satellite";
  // 항공 사진 위에서는 어두운 선·점 테두리가 묻히므로 흰색으로 바꾼다
  const line = sat ? "#fff" : INK;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const lastPointerType = useRef<string | null>(null);
  const lastLegendPointerType = useRef<string | null>(null);
  const u = Math.min(1.5, Math.max(1, H / 360));
  const activeRaster = selectedRaster(rasterModel, rasterName);
  const internalLegendVisible = !bare && legend !== false;

  // 범례 (지물이 있는 레이어 + 선택된 래스터의 숫자 범례). 이 레이아웃은
  // 뷰포트를 만들기 전에 계산해, 래스터 범례가 반경 원을 가리지 않도록 위쪽을 예약한다.
  const present = legendItems(model).filter((item) => !isSiteParcelLayer(item.layer));
  const rasterPresentation = rasterModel.legend ?? [];
  const rasterStyle = activeRaster ? RASTER_STYLES[activeRaster.palette] : undefined;
  const resolvedRasterStyle = activeRaster && rasterStyle ? resolveRasterStyle(activeRaster, rasterStyle) : undefined;
  const rasterEntries = activeRaster && resolvedRasterStyle?.mode === "stepped"
    ? rasterLegendEntries(activeRaster, resolvedRasterStyle, rasterPresentation)
    : [];
  const rasterLegends: RasterLegendConfig[] = internalLegendVisible && activeRaster && resolvedRasterStyle && resolvedRasterStyle.mode !== "mask"
    ? [{ ref: activeRaster, style: resolvedRasterStyle, entries: rasterEntries }]
    : [];
  const fs = 10.5 * u;
  const pad = 6 * u;
  const legendMaxW = Math.max(0, W - 2 * pad - 56 * u);
  const cuts = [
    ...(model.total > model.features.length ? [`표시 ${model.features.length.toLocaleString("en-US")} / 전체 ${model.total.toLocaleString("en-US")}`] : []),
    ...(model.polygonsTotal !== undefined && model.polygonsTotal > (model.polygons?.length ?? 0) ? [`영역 표시 ${(model.polygons?.length ?? 0).toLocaleString("en-US")} / 전체 ${model.polygonsTotal.toLocaleString("en-US")}`] : []),
    ...(model.linesTotal !== undefined && model.linesTotal > (model.lines?.length ?? 0) ? [`경로 표시 ${(model.lines?.length ?? 0).toLocaleString("en-US")} / 전체 ${model.linesTotal.toLocaleString("en-US")}`] : []),
  ];
  const notes = [...model.notes, ...cuts];
  const legendRows: Array<Array<{ layer: string; label: string; color: string; x: number; w: number; site?: boolean; badge?: string; symbol?: "rail-axis" | "rail-exit" }>> = [[]];
  let lx = 0;
  for (const item of present) {
    const w = 12 * u + textW(item.label, fs) + 8 * u;
    if (lx + w > legendMaxW && legendRows.at(-1)!.length) {
      legendRows.push([]);
      lx = 0;
    }
    legendRows.at(-1)!.push({ layer: item.layer, label: item.label, color: item.color, badge: item.badge, symbol: item.symbol, x: lx, w });
    lx += w;
  }
  if (!bare && !muted) {
    const w = 12 * u + textW("대지", fs) + 8 * u;
    if (lx + w > legendMaxW && legendRows.at(-1)!.length) {
      legendRows.push([]);
      lx = 0;
    }
    legendRows.at(-1)!.push({ layer: "__site_marker", label: "대지", color: "#111111", x: lx, w, site: true });
  }
  const rowH = fs * 1.5;
  const legendRowsN = legendRows.some((row) => row.length) ? legendRows.length : 0;
  const rasterFs = Math.max(8.5, fs * 0.9);
  const rasterBarH = 12 * u;
  const rasterBarW = Math.max(80 * u, Math.min(240 * u, Math.max(1, legendMaxW - 3 * pad)));
  const steppedConfig = rasterLegends.find(({ style }) => style.mode === "stepped");
  const steppedRasterLegend = !!steppedConfig;
  // SVG 내부 범례를 유지하는 작은 직접 렌더링은 아래 왼쪽 face-control과
  // 겹치지 않도록 오른쪽 rail로 접는다. 카드·상세의 legend=false 경로는
  // 이 계산에 들어오지 않고 바깥 공용 띠가 범례를 맡는다.
  const cardRailRasterLegend = internalLegendVisible
    && H < 360
    && rasterLegends.length > 0;
  const steppedTitle = steppedConfig ? steppedLegendTitle(steppedConfig.ref, steppedConfig.style) : "";
  const steppedTitleAvailable = Math.max(8 * u, legendMaxW - 2.8 * pad);
  const steppedTitleFs = steppedTitle
    ? Math.max(7.5, Math.min(rasterFs, rasterFs * steppedTitleAvailable / Math.max(1, textW(steppedTitle, rasterFs))))
    : rasterFs;
  // 카드 범례: 지도 왼쪽 아래 한 줄 알약 (제목 · 최소 · 얇은 막대 · 최대). 제목은 축척 막대 앞에서 말줄임.
  const compactCfg = cardRailRasterLegend ? rasterLegends[0] : undefined;
  const compactEnds = ((): [string, string] => {
    if (!compactCfg) return ["", ""];
    const { ref, style, entries } = compactCfg;
    if (style.mode !== "stepped") return ["0%", "100%"];
    if (style.legendLabels) {
      const names = steppedLegendNames(style, entries.length);
      return [names[0]?.label ?? "", names.at(-1)?.label ?? ""];
    }
    const ticks = steppedLegendTicksFor(ref, entries, style);
    return [ticks[0]?.label ?? "", ticks.at(-1)?.label ?? ""];
  })();
  const compactFullTitle = compactCfg ? (compactCfg.style.mode === "stepped" ? steppedLegendTitle(compactCfg.ref, compactCfg.style) : (compactCfg.style.label ?? compactCfg.ref.label ?? compactCfg.ref.name)) : "";
  const compactFs = 10 * u;
  const compactBarW = 48 * u;
  const compactFixedW = 2 * 8 * u + 4 * 4 * u + compactBarW + textW(compactEnds[0], compactFs) + textW(compactEnds[1], compactFs);
  const compactTitleMax = Math.max(0, W - 8 - 112 * u - compactFixedW);
  const compactTitle = compactCfg?.style.mode === "stepped" ? compactSteppedLegendTitle(compactCfg.ref, compactCfg.style) : compactFullTitle;
  const compactTitleW = textW(compactTitle, compactFs);
  const compactTitleFs = compactTitleW > compactTitleMax && compactTitleW > 0 ? Math.max(7.5, compactFs * compactTitleMax / compactTitleW) : compactFs;
  const rasterRailW = compactFixedW + compactTitleW;
  const rasterRailH = 22 * u;
  const steppedBarW = Math.max(64 * u, Math.min(360 * u, Math.max(64 * u, legendMaxW - 3 * pad)));
  // 칸이 좁으면(모바일) 범주명을 두 줄로 어긋나게 놓아 글자 크기를 유지한다.
  const nameStagger = !!steppedConfig?.style.legendLabels && steppedBarW / Math.max(1, rasterEntries.length) < 29;
  const vectorLegendW = Math.min(
    legendMaxW,
    Math.max(0, maxOf([
      ...legendRows.map((r) => r.reduce((sum, item) => sum + item.w, 0)),
      ...notes.map((n) => textW(n, fs * 0.95)),
    ])) + 2 * pad,
  );
  const rasterLegendW = cardRailRasterLegend
    ? rasterRailW
    : steppedRasterLegend
    ? Math.min(legendMaxW, Math.max(steppedBarW + 2.8 * pad, textW(steppedTitle, steppedTitleFs) + 2.8 * pad))
    : rasterLegends.some(({ style }) => style.mode === "continuous")
      ? Math.min(legendMaxW, Math.max(rasterBarW + 2 * pad, maxOf(rasterLegends.map(({ ref, style }) => Math.max(textW(style.label ?? ref.label ?? ref.name, fs), textW(style.legendNote ?? "", fs * 0.82)) + 2 * pad))))
      : 0;
  const vectorLegendH = legendRowsN * rowH + notes.length * rowH * 0.95 + (legendRowsN + notes.length ? pad * 1.4 : 0);
  const steppedLegendH = steppedRasterLegend
    ? 2 * pad + steppedTitleFs + 4 * u + rasterBarH + rasterFs * 1.25 + (steppedConfig?.style.legendLabels ? rasterFs * (nameStagger ? 2.1 : 1.15) : 0)
    : 0;
  const rasterLegendH = cardRailRasterLegend
    ? rasterRailH
    : steppedRasterLegend
    ? steppedLegendH
    : rasterLegends.some(({ style }) => style.mode === "continuous")
      ? (rasterLegends.length > 0 ? 3 * rowH + pad * 1.2 : 0)
      : 0;
  const vectorLegendVisible = internalLegendVisible && vectorLegendH > 0;
  const rasterLegendVisible = internalLegendVisible && rasterLegendH > 0;
  // 카드 지도는 제목·보고서 칩과 MapBox의 compact vector legend가 위쪽을
  // 차지한다. 그 아래에서 시작해야 색 바가 카드 chrome에 가려지지 않는다.
  const requestedLy = Math.max(pad, legendY ?? (legend === false ? 68 * u : pad));
  const preliminaryPanelH = (vectorLegendVisible ? vectorLegendH : 0) + (rasterLegendVisible ? rasterLegendH + (vectorLegendVisible ? 4 * u : 0) : 0);
  const ly = cardRailRasterLegend && rasterLegendVisible
    ? H - bottomInset - preliminaryPanelH - 8
    : Math.min(requestedLy, Math.max(pad, H - bottomInset - preliminaryPanelH - pad));
  const rasterLy = rasterLegendVisible
    ? vectorLegendVisible
      ? ly + vectorLegendH + 4 * u
      : ly
    : 0;
  const panelY = vectorLegendVisible ? ly : rasterLy;
  const panelW = Math.max(vectorLegendVisible ? vectorLegendW : 0, rasterLegendVisible ? rasterLegendW : 0);
  const panelH = preliminaryPanelH;
  const panelX = cardRailRasterLegend ? 8 : pad;
  const showLegend = vectorLegendVisible || rasterLegendVisible;
  const legendMargin = 6 * u;
  const maxRadius = rasterLegendVisible
    ? cardRailRasterLegend
      ? fill * H / 2
      : Math.max(1, (H - bottomInset - panelY - panelH - 2 * legendMargin) / 2)
    : fill * H / 2;
  const mapRadius = rasterLegendVisible ? Math.min(fill * H / 2, maxRadius) : fill * H / 2;
  const mapFill = H > 0 ? Math.max(0.02, Math.min(fill, (2 * mapRadius) / H)) : fill;
  const mapSiteX = siteX;
  const preferredCenterY = H * siteY;
  const mapCenterY = rasterLegendVisible
    ? cardRailRasterLegend
      ? preferredCenterY
      : Math.min(H - bottomInset - legendMargin - mapRadius, Math.max(preferredCenterY, panelY + panelH + legendMargin + mapRadius))
    : preferredCenterY;
  const mapSiteY = H > 0 ? mapCenterY / H : siteY;
  const scene = buildMapScene({
    model,
    width: W,
    height: H,
    activeLayer,
    fill: mapFill,
    siteX: mapSiteX,
    siteY: mapSiteY,
    bottomInset,
    rightInset,
    scaleLeft,
    scaleX,
    scale,
    showRadius,
    showSiteMarker,
    muted: !!muted,
    fixed: !!fixed,
    compact,
    selectedFids,
    highlightLabel,
    emphasisKey,
    hoverKey,
    pinnedKeys,
    showAutomaticLabels,
    bare: !!bare,
    legendBox: showLegend ? { x0: panelX, y0: panelY, x1: panelX + panelW, y1: panelY + panelH } : null,
    avoid,
    path,
    north: northOpt,
    dragging,
    view,
  });
  const vp = scene.viewport;
  const proj = makeProjector(vp);
  const mpp = scene.mpp;
  const [cx, cy] = scene.center;
  const R = scene.radiusPx;

  const tiles = basemap === "tiles" ? scene.tiles : [];
  const stack = BASEMAP_STACK[activeLayer];
  const backgroundImages: BackgroundImage[] = stack.flatMap((ly) => tiles.flatMap((tile) => {
    const url = tileUrl(ly, tile.z, tile.x, tile.y);
    const href = tileHref ? tileHref(url) : url;
    return href ? [{ key: `${ly}/${tile.z}/${tile.x}/${tile.y}`, href, tile }] : [];
  }));
  const backgroundKey = `${vp.center[0]}:${vp.center[1]}:${vp.zoom}:${W}:${H}:${backgroundImages.map((image) => image.key).join("|")}`;
  const desiredBackground: BackgroundFrame = { key: backgroundKey, vp, images: backgroundImages };
  const loadedBackgroundRef = useRef<{ key: string; tiles: Set<string> }>({ key: backgroundKey, tiles: new Set() });
  if (loadedBackgroundRef.current.key !== backgroundKey) loadedBackgroundRef.current = { key: backgroundKey, tiles: new Set() };
  const [backgroundRevision, setBackgroundRevision] = useState(0);
  const ready = backgroundRevision >= 0 && backgroundImages.every((image) => loadedBackgroundRef.current.tiles.has(image.key));
  const [readyBackground, setReadyBackground] = useState<BackgroundFrame | null>(null);
  useEffect(() => {
    if (!ready) return;
    setReadyBackground((current) => current?.key === backgroundKey ? current : desiredBackground);
  }, [backgroundKey, desiredBackground, ready]);
  const markBackgroundTileReady = useCallback((frameKey: string, tileKey: string) => {
    const current = loadedBackgroundRef.current;
    if (frameKey !== current.key || current.tiles.has(tileKey)) return;
    current.tiles.add(tileKey);
    setBackgroundRevision((revision) => revision + 1);
  }, []);
  const previousBackground = readyBackground?.key !== backgroundKey ? readyBackground : null;
  const rasterImages = (activeRaster ? [activeRaster] : [])
    .map((ref) => ({ ref, href: rasterHref?.(ref) ?? null, matrix: rasterAffine(ref, vp) }))
    .filter((item): item is typeof item & { href: string } => !!item.href);
  const grid = scaleBar(mpp, 110 * u).px;

  const selected = new Set(selectedFids);
  const pinned = new Set(pinnedKeys);
  const highlightActive = highlightLabel !== null;
  const isLayerHighlighted = scene.isLayerHighlighted;
  const isElementDimmed = scene.isElementDimmed;
  const isElementStrong = scene.isElementStrong;
  const isSelected = (fid: string | undefined) => !!fid && selected.has(fid);
  const feats = scene.features.map(({ feature: f, p, selected: featureSelected, index }) => ({ f, p, selected: featureSelected, index }));
  const drawn = feats;
  const linePaths = scene.lines.map(({ line: l, points, index }) => ({ l, points, index }));
  const polygons = scene.polygons;
  const siteParcels = scene.siteParcels;
  type ScreenPolygon = (typeof polygons)[number];
  const rings = scene.rings;
  const polygonOpacity = scene.polygonOpacity;
  const radiusByIndex = new Map(scene.features.map((feature) => [feature.index, feature.radius]));
  const radiusOf = (f: MapFigureProps["model"]["features"][number]) => radiusByIndex.get(model.features.indexOf(f)) ?? (f.highlight ? 4.6 : 2.6) * u;
  const isEstimated = (polygon: ScreenPolygon) => polygon.polygon.layer.endsWith("_est") || layerStyle(polygon.polygon.layer).label.startsWith("[추정]") || layerStyle(polygon.polygon.layer).hatch === true;
  const hatchId = (index: number) => `hatch${uid}-${index}`;
  const polygonPath = (rings: Array<Array<[number, number]>>) => rings.map((ring) => `${ring.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("")}Z`).join(" ");
  const centerOf = (points: Array<[number, number]>): [number, number] => {
    if (points.length === 0) return model.center as [number, number];
    const total = points.reduce(([lng, lat], [nextLng, nextLat]) => [lng + nextLng, lat + nextLat], [0, 0]);
    return [total[0] / points.length, total[1] / points.length];
  };
  const pickProps = (pick: MapFigurePick, key: string, labelText: string) => {
    if (!onFeatureClick && !onFeatureHover && !onFeaturePin) return {};
    const hover = (value: string | null) => { if (!dragging) onFeatureHover?.(value); };
    const choose = () => onFeatureClick?.(pick);
    const pin = () => onFeaturePin?.({ ...pick, key });
    const onKeyDown = (event: ReactKeyboardEvent<SVGElement>) => {
      if (event.key === "Escape") {
        hover(null);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      choose();
      pin();
    };
    return {
      "data-map-feature": key,
      className: "map-figure-interactive",
      role: "button" as const,
      tabIndex: 0,
      "aria-label": labelText,
      "aria-pressed": onFeaturePin ? pinned.has(key) : undefined,
      onClick: () => {
        choose();
        pin();
      },
      onKeyDown,
      onPointerDown: (event: ReactPointerEvent<SVGElement>) => { lastPointerType.current = event.pointerType; },
      onPointerEnter: (event: ReactPointerEvent<SVGElement>) => {
        lastPointerType.current = event.pointerType;
        if (event.pointerType !== "touch") hover(key);
      },
      onPointerLeave: () => { lastPointerType.current = null; hover(null); },
      onFocus: () => { if (lastPointerType.current !== "touch") hover(key); },
      onBlur: () => { lastPointerType.current = null; hover(null); },
      style: { cursor: "pointer" },
    };
  };
  const routePoints = scene.routePoints;
  const [worldCenterX, worldCenterY] = worldPx(vp.center[0], vp.center[1], vp.zoom);
  const mapClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!onMapClick) return;
    const target = event.target as Element;
    if (target.closest("[data-map-feature], [data-map-legend]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (event.clientX - rect.left) * (W / rect.width);
    const y = (event.clientY - rect.top) * (H / rect.height);
    const size = 256 * 2 ** vp.zoom;
    const worldX = worldCenterX + x - W / 2;
    const worldY = worldCenterY + y - H / 2;
    const lng = (worldX / size) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * worldY) / size))) * 180) / Math.PI;
    if (Number.isFinite(lng) && Number.isFinite(lat)) onMapClick({ lng, lat });
  };

  const bar = scene.scale;
  const barY = bar.y;
  const barX1 = bar.x1;
  const barX0 = bar.x0;
  const siteR = siteMarkerRadius(H, fixed);
  const sitePoints = scene.sitePoints;
  const sitePath = scene.sitePath;
  const siteMode = scene.siteMode;
  const siteBounds = scene.siteBounds;

  type ScreenLabel = MapSceneLabel;
  const screenLabels: ScreenLabel[] = scene.labels;
  const labelByKey = new Map(screenLabels.map((entry) => [entry.key, entry]));
  const calloutLabelFs = Math.max(11, fs);
  const calloutTextLeft = 8 * u;
  const calloutTextRight = 4 * u;
  const calloutPadY = 3 * u;
  const calloutLineHeight = calloutLabelFs * 1.24;
  const baseCalloutMetrics = W <= 420 ? PX_NARROW : PX;
  const calloutMetrics = {
    ...baseCalloutMetrics,
    cardW: baseCalloutMetrics.cardW * u,
    compactW: baseCalloutMetrics.compactW * u,
    minW: baseCalloutMetrics.minW * u,
    gap: baseCalloutMetrics.gap * u,
    stub: baseCalloutMetrics.stub * u,
    rMin: baseCalloutMetrics.rMin * u,
    rMax: baseCalloutMetrics.rMax * u,
    head: baseCalloutMetrics.head * u,
    row: baseCalloutMetrics.row * u,
    pad: baseCalloutMetrics.pad * u,
    // Variable labels provide their own height. This is only the one-line
    // fallback used by the frame when there are no measured candidates.
    compactH: calloutPadY * 2 + calloutLineHeight,
  };
  const calloutTop = showLegend && panelY <= H / 2 ? panelY + panelH + 6 * u : 4 * u;
  const calloutBottom = showLegend && panelY > H / 2 ? panelY - 6 * u : H - bottomInset - 4 * u;
  const calloutFrameModel = {
    ...calloutFrame({
      W,
      H,
      m: calloutMetrics,
      edge: 4 * u,
      top: calloutTop,
      bottom: Math.max(calloutTop, calloutBottom),
      rightInset,
      perSide: 100,
      rows: 3,
      variant: "compact",
      maxFill: 0.8,
    }),
    // A label belongs to the left/right side of the map, not to the shifted
    // center left by a detail-panel inset.
    centerX: W / 2,
  };
  type MapCalloutPlacement = { placed: Placed; box: Box; leader: Box; text: MapCalloutTextLayout };
  const calloutPlacement = (placed: Placed, point: ScreenLabel, text: MapCalloutTextLayout): MapCalloutPlacement => {
    const box: Box = { x0: placed.x, y0: placed.y, x1: placed.x + placed.width, y1: placed.y + placed.height };
    const points = [point.p, placed.knee, placed.edge];
    const leader: Box = {
      x0: Math.max(0, Math.min(...points.map(([x]) => x)) - 2 * u),
      y0: Math.max(0, Math.min(...points.map(([, y]) => y)) - 2 * u),
      x1: Math.min(W, Math.max(...points.map(([x]) => x)) + 2 * u),
      y1: Math.min(H, Math.max(...points.map(([, y]) => y)) + 2 * u),
    };
    return { placed, box, leader, text };
  };
  const labelNode = (d: ScreenLabel, placement: MapCalloutPlacement, variant: "auto" | "fixed" | "hover"): ReactNode => {
    const fixedLabel = variant === "fixed";
    const textFs = placement.text.fontSize;
    const textX = placement.box.x0 + calloutTextLeft;
    const textMaxWidth = Math.max(1, placement.box.x1 - placement.box.x0 - calloutTextLeft - calloutTextRight);
    const textY = placement.box.y0 + calloutPadY + textFs * 0.9;
    const dimmed = variant === "auto" && highlightActive && !d.highlighted;
    const pinPick = () => onFeaturePin?.(d.pick);
    const onKeyDown = (event: ReactKeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pinPick();
      }
    };
    return (
      <g
        key={`${variant}-label-${d.key}`}
        data-map-label-key={d.key}
        data-map-label-variant={variant}
        {...(fixedLabel && onFeaturePin ? { "data-map-feature": d.key, className: "map-figure-interactive", role: "button" as const, tabIndex: 0, "aria-label": `${d.text} 고정 라벨`, "aria-pressed": true, onClick: pinPick, onKeyDown } : { "aria-hidden": true })}
        style={fixedLabel && onFeaturePin ? { cursor: "pointer" } : undefined}
        pointerEvents={fixedLabel && onFeaturePin ? "all" : "none"}
        opacity={dimmed ? 0.2 : 1}
      >
        <title>{d.text}</title>
        {!dragging && <>
          <polyline data-map-label-leader={d.key} points={[d.p, placement.placed.knee, placement.placed.edge].map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="#fff" strokeWidth={3.6 * u} strokeLinecap="round" strokeLinejoin="round" />
          <polyline data-map-label-leader={d.key} points={[d.p, placement.placed.knee, placement.placed.edge].map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={INK} strokeWidth={1.2 * u} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={d.p[0]} cy={d.p[1]} r={Math.max(1.8 * u, textFs * 0.2)} fill={INK} />
        </>}
        <rect data-map-label-box={d.key} x={placement.box.x0} y={placement.box.y0} width={placement.box.x1 - placement.box.x0} height={placement.box.y1 - placement.box.y0} rx={3 * u} fill="#fff" stroke={INK} strokeWidth={1.2 * u} />
        <circle cx={placement.box.x0 + 4 * u} cy={(placement.box.y0 + placement.box.y1) / 2} r={Math.max(1.8 * u, textFs * 0.2)} fill={INK} />
        <text x={textX} y={textY} fontSize={textFs} fill={INK} style={{ whiteSpace: "nowrap" }}>
          {placement.text.lines.map((line, index) => {
            const rendered = truncateMapLabelText(line.text, textMaxWidth, textFs);
            if (line.kind === "joined" && rendered === line.text) {
              return <tspan key={`${d.key}-line-${index}`} x={textX} dy={index === 0 ? 0 : placement.text.lineHeight}>
                <tspan fontWeight={700}>{line.title}</tspan><tspan fill="#5c5f66" fontWeight={500}>{` · ${line.detail}`}</tspan>
              </tspan>;
            }
            return <tspan key={`${d.key}-line-${index}`} x={textX} dy={index === 0 ? 0 : placement.text.lineHeight} fontWeight={line.kind === "title" ? 700 : 500} fill={line.kind === "title" ? INK : "#5c5f66"}>{rendered}</tspan>;
          })}
        </text>
      </g>
    );
  };
  const labels: ReactNode[] = [];
  let hoverLabelNode: ReactNode = null;
  for (const placement of scene.labelPlacements) {
    const node = labelNode(placement.entry, placement, placement.variant);
    if (placement.variant === "hover") hoverLabelNode = node;
    else labels.push(node);
  }
  const railLineSource = (key: string) => scene.lines.find((entry) => entry.key === key);
  const railFeatureSource = (key: string) => scene.features.find((entry) => entry.key === key);
  const railNodes = (
    <g data-rail-overlay="true">
      {scene.rail.routes.map((route) => {
        const source = railLineSource(route.key);
        const center = source ? centerOf(source.line.points) : model.center as [number, number];
        const routePick = source ? pickProps({ fid: source.line.fid, lng: center[0], lat: center[1], kind: "line" }, route.key, `${route.label} 노선`) : {};
        const points = route.points.map(([x, y]) => `${x},${y}`).join(" ");
        return (
          <g key={`rail-route-${route.key}`} data-rail-route={route.label} opacity={source && isElementDimmed(source.line.layer, source.key) ? 0.2 : 1}>
            {route.casing && <polyline points={points} fill="none" stroke={route.casing} strokeWidth={route.width + 1.2} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
            <polyline data-rail-route-line="true" points={points} fill="none" stroke={route.color} strokeWidth={route.width} strokeLinecap="round" strokeLinejoin="round" {...routePick} />
          </g>
        );
      })}
      {scene.rail.axes.map((axis) => {
        const source = railFeatureSource(axis.stationFeatureKey);
        const pick = source ? pickProps({ fid: source.feature.fid, lng: source.feature.lng, lat: source.feature.lat, kind: "feature" }, source.key, `${source.feature.name ?? "철도역"} ${axis.label}`) : {};
        const points = axis.points.map(([x, y]) => `${x},${y}`).join(" ");
        return (
          <g key={axis.key} data-rail-axis={axis.key} pointerEvents={source ? "all" : "none"}>
            {axis.casing && <polyline points={points} fill="none" stroke={axis.casing} strokeWidth={axis.width + 1.4} strokeLinecap="butt" strokeLinejoin="miter" pointerEvents="none" />}
            <polyline data-rail-axis-bar="true" points={points} fill="none" stroke={axis.color} strokeWidth={axis.width} strokeLinecap="butt" strokeLinejoin="miter" {...pick} />
          </g>
        );
      })}
      {scene.rail.exits.map((exit) => (
        <g key={exit.key} data-rail-exit={exit.number} aria-label={`${exit.number}번 출구`} pointerEvents="none">
          <line data-rail-exit-connector="true" x1={exit.axisPoint[0]} y1={exit.axisPoint[1]} x2={exit.point[0]} y2={exit.point[1]} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" opacity={0.75} />
          <line data-rail-exit-connector-line="true" x1={exit.axisPoint[0]} y1={exit.axisPoint[1]} x2={exit.point[0]} y2={exit.point[1]} stroke={exit.color} strokeWidth={0.6} strokeLinecap="round" opacity={0.6} />
          {exit.demoted ? (
            <circle data-rail-exit-dot="true" cx={exit.point[0]} cy={exit.point[1]} r={RAIL_EXIT_DOT_RADIUS} fill={RAIL_EXIT_COLOR} stroke="#172033" strokeWidth={RAIL_EXIT_DOT_STROKE} />
          ) : (
            <>
              <rect data-rail-exit-marker="true" x={exit.box.x0} y={exit.box.y0} width={exit.box.x1 - exit.box.x0} height={exit.box.y1 - exit.box.y0} rx={exit.pill ? (exit.box.y1 - exit.box.y0) / 2 : 2} fill={RAIL_EXIT_COLOR} stroke="#172033" strokeWidth={0.65} />
              <text data-rail-exit-number="true" x={(exit.box.x0 + exit.box.x1) / 2} y={exit.box.y0 + (exit.box.y1 - exit.box.y0) * 0.76} textAnchor="middle" fontSize={7} fontWeight={700} fill="#111827">{exit.number}</text>
            </>
          )}
        </g>
      ))}
      {scene.rail.routeLabels.map((text) => (
        <text key={`rail-route-label-${text.text}-${text.x}-${text.y}`} data-rail-route-label={text.text} x={text.x + text.width / 2} y={text.y + text.height * 0.78} textAnchor="middle" fontSize={text.fontSize} fontWeight={700} fill={text.color} stroke="#fff" strokeWidth={3} paintOrder="stroke fill" transform={`rotate(${text.angle} ${(text.x + text.width / 2)} ${(text.y + text.height / 2)})`}>{text.text}</text>
      ))}
      {scene.rail.axisLabels.map((text, index) => (
        <text key={`rail-axis-label-${index}-${text.text}-${text.x}-${text.y}`} data-rail-axis-label={text.text} data-rail-axis-label-placement={text.placement} x={text.x + text.width / 2} y={text.y + text.height * 0.78} textAnchor="middle" fontSize={text.fontSize} fontWeight={700} fill={text.color} stroke={text.placement === "inside" ? "none" : "#fff"} strokeWidth={text.placement === "inside" ? 0 : 2.6} paintOrder={text.placement === "inside" ? undefined : "stroke fill"} transform={`rotate(${text.angle} ${(text.x + text.width / 2)} ${(text.y + text.height / 2)})`}>{text.text}</text>
      ))}
      {scene.rail.stationLabels.map((station) => (
        <text key={station.key} data-rail-station-label={station.stationKey} x={station.x + station.width / 2} y={station.y + station.height * 0.78} textAnchor="middle" fontSize={station.fontSize} fontWeight={700} fill={INK} stroke="#fff" strokeWidth={5} paintOrder="stroke fill">{station.text}</text>
      ))}
    </g>
  );

  const north = scene.north ?? { x: W - rightInset - 20 * u, y: 22 * u };
  const dim = `M0 0H${W}V${H}H0Z M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`0 0 ${W} ${H}`}
      {...(fixed ? { width: W, height: H } : { width: "100%", height: "100%" })}
      role="img"
      aria-label={label ?? "분석 반경 지도"}
      fontFamily={FONT}
      style={{ display: "block" }}
      onClick={mapClick}
    >
      <defs>
        <filter id={`s${uid}`}>
          <feColorMatrix type="saturate" values="0.3" />
        </filter>
        <filter id={`m${uid}`}>
          <feColorMatrix type="saturate" values="0" />
          <feGaussianBlur stdDeviation={2} />
        </filter>
        <clipPath id={`c${uid}`}>
          <rect width={W} height={H} />
        </clipPath>
        <clipPath id={`r${uid}`}>
          <path d={`M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z`} />
        </clipPath>
        {rasterLegends.filter(({ style }) => style.mode === "continuous").map(({ ref, style }) => (
          <linearGradient key={`raster-gradient-${ref.name}`} id={`raster-gradient-${uid}-${ref.name}`} x1="0%" y1="0%" x2="100%" y2="0%">
            {style.colors.map((color, index) => (
              <stop key={`${color}-${index}`} offset={`${(rasterStopPositions(style)[index] ?? 0) * 100}%`} stopColor={color} />
            ))}
          </linearGradient>
        ))}
        {polygons.filter(isEstimated).map((polygon) => {
          const st = layerStyle(polygon.polygon.layer);
          return (
            <pattern key={hatchId(polygon.index)} id={hatchId(polygon.index)} patternUnits="userSpaceOnUse" width={10 * u} height={10 * u} patternTransform="rotate(45)">
              <rect width={10 * u} height={10 * u} fill={st.fill ?? st.color} fillOpacity={st.fillOpacity ?? polygonOpacity} />
              <path d={`M0 0V${10 * u}`} stroke={st.color} strokeWidth={1.2 * u} strokeOpacity={0.75} />
            </pattern>
            );
        })}
        {linePaths.filter((d) => layerStyle(d.l.layer).arrow).map((d) => {
          const st = layerStyle(d.l.layer);
          return (
            <marker key={`arrow-${d.index}`} id={`arrow-${uid}-${d.index}`} markerWidth={4 * u} markerHeight={4 * u} refX={8} refY={5} viewBox="0 0 10 10" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={d.l.color ?? st.color} />
            </marker>
          );
        })}
      </defs>
      <g clipPath={`url(#c${uid})`}>
        <rect width={W} height={H} fill="#f2f2ef" />
        {basemap === "none" && (
          <g stroke="#dcdde1" strokeWidth={1}>
            {Array.from({ length: Math.ceil(W / grid) + 1 }, (_, i) => (
              <line key={`v${i}`} x1={(cx % grid) + i * grid} y1={0} x2={(cx % grid) + i * grid} y2={H} />
            ))}
            {Array.from({ length: Math.ceil(H / grid) + 1 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(cy % grid) + i * grid} x2={W} y2={(cy % grid) + i * grid} />
            ))}
          </g>
        )}
        {/* 표준 지도는 색이 진해 점이 묻히므로 채도를 낮추고 흰 막을 덮는다 */}
        <g filter={muted ? `url(#m${uid})` : sat ? undefined : `url(#s${uid})`}>
          {view === undefined
            ? stack.map((ly) => tiles.map((tile) => {
              const url = tileUrl(ly, tile.z, tile.x, tile.y);
              const href = tileHref ? tileHref(url) : url;
              return href ? <image key={`tile-${ly}/${tile.z}/${tile.x}/${tile.y}`} href={href} x={tile.left} y={tile.top} width={tile.size + 0.6} height={tile.size + 0.6} preserveAspectRatio="none" /> : null;
            }))
            : <>
              {previousBackground && <g data-map-background="previous" transform={backgroundTransform(previousBackground.vp, vp, W, H)}>
                {previousBackground.images.map((image) => <image key={`previous-tile-${image.key}`} href={image.href} x={image.tile.left} y={image.tile.top} width={image.tile.size + 0.6} height={image.tile.size + 0.6} preserveAspectRatio="none" />)}
              </g>}
              <g data-map-background="current">
                {desiredBackground.images.map((image) => <image key={`current-tile-${image.key}`} href={image.href} x={image.tile.left} y={image.tile.top} width={image.tile.size + 0.6} height={image.tile.size + 0.6} preserveAspectRatio="none" onLoad={() => markBackgroundTileReady(backgroundKey, image.key)} onError={() => markBackgroundTileReady(backgroundKey, image.key)} />)}
              </g>
            </>}
        </g>
        {tiles.length > 0 && (!sat || muted) && <rect width={W} height={H} fill="#fff" fillOpacity={muted ? 0.5 : activeLayer === "Base" ? 0.35 : 0.15} />}
        {tiles.length > 0 && sat && !muted && <rect width={W} height={H} fill="#000" fillOpacity={0.12} />}

        {/* 격자 셀 경계가 보이는 원해상도 래스터. 배경 타일 위, 면·선·점 아래에 둔다. */}
        {rasterImages.map(({ ref, href, matrix }) => (
          <image
            key={`raster-${ref.name}`}
            data-raster={ref.name}
            href={href}
            x={0}
            y={0}
            width={ref.cols}
            height={ref.rows}
            preserveAspectRatio="none"
            transform={`matrix(${matrix.join(",")})`}
            // Continuous rasters are resampled smoothly; stepped, class and
            // mask palettes retain their cell boundaries when zoomed.
            style={{ imageRendering: resolvedRasterStyle?.mode === "continuous" ? "auto" : "pixelated" }}
            opacity={1}
          />
        ))}

        {(!backgroundOnlyActive || (backgroundLayerSet?.size ?? 0) > 0) && <>
        {showNativeChrome && showRadius && <path d={dim} fillRule="evenodd" fill="#14161c" fillOpacity={0.09} />}
        <g clipPath={showRadius ? `url(#r${uid})` : undefined} data-radius-clip={showRadius ? "true" : undefined}>
          {polygons.map((polygon) => {
            if (isSiteParcelLayer(polygon.polygon.layer) || !shouldRasterizeLayer(polygon.polygon.layer)) return null;
            const st = layerStyle(polygon.polygon.layer);
            const estimated = isEstimated(polygon);
            const neutralBuilding = rasterImages.length > 0 && isBuildingLayer(polygon.polygon.layer);
            const buildingStyle = buildingStyleForRaster(polygon.polygon.layer, rasterImages.length > 0);
            const polygonFid = polygon.polygon.fid;
            const polygonCenter = centerOf(polygon.polygon.rings[0] ?? []);
            const polygonSelected = isSelected(polygonFid);
            const polygonKey = mapElementKey("polygon", polygon.polygon.layer, polygonFid, polygon.index);
            const strong = isElementStrong(polygon.polygon.layer, polygonKey);
            return <path key={`poly${polygon.index}`} data-poly="true" data-map-layer={polygon.polygon.layer} d={polygonPath(polygon.rings)} fillRule="evenodd" fill={neutralBuilding ? buildingStyle.fill : estimated ? `url(#${hatchId(polygon.index)})` : st.fill ?? st.color} fillOpacity={neutralBuilding ? buildingStyle.fillOpacity : estimated ? 1 : st.fillOpacity ?? polygonOpacity} opacity={isElementDimmed(polygon.polygon.layer, polygonKey) ? 0.2 : undefined} stroke={strong || polygonSelected ? INK : neutralBuilding ? buildingStyle.stroke : st.stroke ?? st.color} strokeWidth={(strong ? 1.6 : polygonSelected ? 3 : neutralBuilding ? buildingStyle.strokeWidth ?? 0.8 : st.strokeWidth ?? 1) * u} {...pickProps({ fid: polygonFid, lng: polygonCenter[0], lat: polygonCenter[1], kind: "polygon" }, polygonKey, labelText(polygon.polygon.layer, "polygon", polygon.polygon))} />;
          })}
          {linePaths.filter((d) => backgroundOnlyActive ? shouldRasterizeLayer(d.l.layer) : (d.l.layer !== "rail_line" && d.l.layer !== "rail_station_axis")).map((d) => {
            const st = layerStyle(d.l.layer);
            const lineSelected = isSelected(d.l.fid);
            const center = centerOf(d.l.points);
            const lineKey = mapElementKey("line", d.l.layer, d.l.fid, d.index);
            const strong = isElementStrong(d.l.layer, lineKey);
            const baseWidth = d.l.strokeWidth ?? st.strokeWidth ?? 1.5;
            const width = lineSelected ? Math.max(4, baseWidth) : (strong ? baseWidth * 1.35 : baseWidth) * (d.l.emphasis === "major" ? 1.2 : d.l.emphasis === "minor" ? 0.85 : 1);
            const points = d.points.map(([x, y]) => `${x},${y}`).join(" ");
            const stroke = d.l.color ?? st.color;
            const casing = strong || lineSelected ? INK : d.l.casing ?? st.casing;
            const casingWidth = d.l.casingWidth ?? width + 2.4;
            const opacity = d.l.opacity ?? st.opacity;
            return (
              <g key={`line${d.index}`} opacity={isElementDimmed(d.l.layer, lineKey) ? 0.2 : opacity}>
                {casing && <polyline points={points} fill="none" stroke={casing} strokeWidth={casingWidth * u} strokeDasharray={st.dash} strokeLinejoin="round" pointerEvents="none" />}
                <polyline data-line="true" points={points} fill="none" stroke={stroke} strokeWidth={width * u} strokeDasharray={st.dash} strokeLinejoin="round" markerEnd={st.arrow ? `url(#arrow-${uid}-${d.index})` : undefined} {...pickProps({ fid: d.l.fid, lng: center[0], lat: center[1], kind: "line" }, lineKey, labelText(d.l.layer, "line", d.l))} />
              </g>
            );
          })}
          {showNativeChrome && railNodes}
        </g>
        {showNativeChrome && showRadius && rings.map((r, i) => (
          <circle key={`ring-${i}-${r}`} cx={cx} cy={cy} r={r} fill="none" stroke={line} strokeOpacity={sat ? 0.7 : 0.35} strokeWidth={1 * u} strokeDasharray={`${4 * u} ${4 * u}`} />
        ))}
        {showNativeChrome && showRadius && <circle cx={cx} cy={cy} r={R} fill="none" stroke={line} strokeOpacity={sat ? 0.95 : 0.75} strokeWidth={1.6 * u} />}

         {showNativeChrome && drawn.map((d, i) => {
            if (d.f.highlight && d.f.distanceM != null) {
             const featureKey = mapFeatureKey(d.f.layer, d.f.fid, d.index);
             const strong = isElementStrong(d.f.layer, featureKey);
             return <line key={`nearest-${i}-${d.f.fid ?? d.f.layer}`} x1={cx} y1={cy} x2={d.p[0]} y2={d.p[1]} stroke={strong ? INK : line} strokeWidth={(strong ? 1.6 : 1.4) * u} strokeOpacity={isElementDimmed(d.f.layer, featureKey) ? 0.2 : undefined} strokeDasharray={`${3 * u} ${3 * u}`} />;
           }
          return null;
        })}
         {drawn.map((d, i) => {
             const st = layerStyle(d.f.layer);
             const r = radiusOf(d.f);
             const neutralBuilding = rasterImages.length > 0 && isBuildingLayer(d.f.layer);
             const buildingStyle = buildingStyleForRaster(d.f.layer, rasterImages.length > 0);
            if (d.p[0] < -r || d.p[1] < -r || d.p[0] > W + r || d.p[1] > H + r) return null;
            if (!backgroundOnlyActive && (d.f.layer === "rail_station" || d.f.layer === "rail_nearest" || d.f.layer === "rail_entrance")) return null;
            if (!shouldRasterizeLayer(d.f.layer)) return null;
            const hollow = st.sizeBy === "weight" && !d.f.weight;
            const featureKey = mapFeatureKey(d.f.layer, d.f.fid, d.index);
            const strong = isElementStrong(d.f.layer, featureKey);
            return (
            <circle
              key={`feature-${i}-${d.f.fid ?? d.f.layer}`}
              cx={d.p[0]}
              cy={d.p[1]}
              r={r}
              fill={neutralBuilding ? buildingStyle.fill : hollow ? "#fff" : d.f.color ?? st.color}
              fillOpacity={neutralBuilding ? buildingStyle.fillOpacity : hollow ? 0.6 : st.sizeBy === "weight" ? 0.55 : d.f.highlight ? 1 : 0.85}
              opacity={isElementDimmed(d.f.layer, featureKey) ? 0.2 : undefined}
              stroke={strong || d.f.highlight || d.selected ? INK : neutralBuilding ? buildingStyle.stroke : sat ? "#fff" : st.sizeBy === "weight" ? st.color : "#fff"}
              strokeWidth={(strong ? 1.6 : d.f.highlight || d.selected ? 2.8 : neutralBuilding ? buildingStyle.strokeWidth ?? 0.8 : sat ? 1.5 : st.sizeBy === "weight" ? 1.4 : 0.8) * u}
              {...pickProps({ fid: d.f.fid, lng: d.f.lng, lat: d.f.lat, kind: "feature" }, featureKey, labelText(d.f.layer, "feature", d.f))}
            />
          );
         })}
        {showNativeChrome && routePoints.length >= 2 && (
          <>
            <polyline data-route="true" points={routePoints.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="#fff" strokeWidth={8 * u} strokeLinecap="round" strokeLinejoin="round" opacity={0.92} />
            <polyline data-route="true" points={routePoints.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="#D97706" strokeWidth={4.5 * u} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={routePoints[0]![0]} cy={routePoints[0]![1]} r={5.5 * u} fill={INK} stroke="#fff" strokeWidth={2 * u} />
            <circle cx={routePoints.at(-1)![0]} cy={routePoints.at(-1)![1]} r={6.5 * u} fill="#D97706" stroke="#fff" strokeWidth={2.5 * u} />
          </>
        )}
        {/* 대지 표시 */}
        {showNativeChrome && !muted && showSiteMarker && (
          <g role="img" aria-label="분석 대지">
            {siteMode === "parcel" && sitePath ? (
              <>
                <path d={sitePath} fillRule="evenodd" fill="rgba(255,255,255,.18)" stroke="#fff" strokeWidth={Math.max(0.5 * siteR, 2.4)} strokeLinejoin="round" clipPath={`url(#r${uid})`} />
                <path d={sitePath} fill="none" stroke="#111" strokeWidth={Math.max(0.2 * siteR, 1.2)} strokeLinejoin="round" clipPath={`url(#r${uid})`} />
              </>
            ) : (
              <>
                <circle r={1.25 * siteR} cx={cx} cy={cy} fill="none" stroke="#fff" strokeWidth={0.55 * siteR} />
                <circle r={1.25 * siteR} cx={cx} cy={cy} fill="none" stroke="#111" strokeWidth={0.22 * siteR} />
                <path d={`M${cx} ${cy - 2 * siteR}V${cy - 0.6 * siteR}M${cx} ${cy + 0.6 * siteR}V${cy + 2 * siteR}M${cx - 2 * siteR} ${cy}H${cx - 0.6 * siteR}M${cx + 0.6 * siteR} ${cy}H${cx + 2 * siteR}`} fill="none" stroke="#fff" strokeWidth={0.5 * siteR} strokeLinecap="butt" />
                <path d={`M${cx} ${cy - 2 * siteR}V${cy - 0.6 * siteR}M${cx} ${cy + 0.6 * siteR}V${cy + 2 * siteR}M${cx - 2 * siteR} ${cy}H${cx - 0.6 * siteR}M${cx + 0.6 * siteR} ${cy}H${cx + 2 * siteR}`} fill="none" stroke="#111" strokeWidth={0.2 * siteR} strokeLinecap="butt" />
                <circle r={0.28 * siteR} cx={cx} cy={cy} fill="#111" stroke="#fff" strokeWidth={0.12 * siteR} />
              </>
            )}
            {siteMode === "parcel" && (
              <>
                <g transform={`translate(${cx} ${cy}) rotate(45)`}>
                  <rect x={-0.7 * siteR} y={-0.7 * siteR} width={1.4 * siteR} height={1.4 * siteR} fill="#fff" stroke="#111" strokeWidth={0.22 * siteR} />
                </g>
                <circle cx={cx} cy={cy} r={0.2 * siteR} fill="#111" />
              </>
            )}
          </g>
        )}

        {/* 범례·문구 */}
        {showNativeChrome && showLegend && (
          <g>
            <rect data-map-legend="panel" data-map-legend-panel="true" x={panelX} y={panelY} width={panelW} height={panelH} rx={cardRailRasterLegend ? 11 * u : 6 * u} fill="#fff" fillOpacity={0.94} />
            {vectorLegendVisible && (
              <>
                {legendRows.map((row, ri) => row.map((it, ii) => {
                  const legendLabel = it.label;
                  const interactive = !it.site && !!(onLegendHover || onLegendPin);
                  const onKeyDown = (event: ReactKeyboardEvent<SVGGElement>) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      onLegendHover?.(null);
                      onLegendPin?.(null);
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onLegendPin?.(legendLabel);
                    }
                  };
                  return (
                    <g
                      key={`legend-${ri}-${ii}-${it.layer}`}
                      data-map-legend={interactive ? legendLabel : "decorative"}
                      {...(interactive ? {
                        role: "button" as const,
                        className: "map-figure-interactive",
                        tabIndex: 0,
                        "aria-label": `${legendLabel} 범례 강조`,
                        "aria-pressed": highlightPinnedLabel === legendLabel,
                        onClick: () => onLegendPin?.(legendLabel),
                        onKeyDown,
                        onPointerDown: (event: ReactPointerEvent<SVGGElement>) => { lastLegendPointerType.current = event.pointerType; },
                        onPointerEnter: (event: ReactPointerEvent<SVGGElement>) => { lastLegendPointerType.current = event.pointerType; if (event.pointerType !== "touch") onLegendHover?.(legendLabel); },
                        onPointerLeave: () => { lastLegendPointerType.current = null; onLegendHover?.(null); },
                        onFocus: () => { if (lastLegendPointerType.current !== "touch") onLegendHover?.(legendLabel); },
                        onBlur: () => { lastLegendPointerType.current = null; onLegendHover?.(null); },
                        style: { cursor: "pointer" },
                      } : { "aria-hidden": true })}
                    >
                      {interactive && <rect x={panelX + pad + it.x} y={ly + ri * rowH} width={it.w} height={rowH} rx={2 * u} fill={highlightLabel === legendLabel ? "#eef0f3" : "transparent"} stroke={highlightLabel === legendLabel ? INK : "transparent"} strokeWidth={highlightLabel === legendLabel ? 1.1 * u : 0} />}
                      {it.site ? (
                        <g transform={`translate(${panelX + pad * 1.8 + it.x + 4 * u} ${ly + pad * 0.7 + ri * rowH + rowH / 2})`} aria-hidden="true">
                          <rect x={-3.2 * u} y={-3.2 * u} width={6.4 * u} height={6.4 * u} fill="#fff" stroke="#111" strokeWidth={0.9 * u} transform="rotate(45)" />
                          <circle r={0.9 * u} fill="#111" />
                        </g>
                      ) : it.symbol === "rail-axis" ? (
                        <g data-legend-symbol="rail-axis" aria-hidden="true">
                          <line x1={panelX + pad * 1.8 + it.x + 0.5 * u} y1={ly + pad * 0.7 + ri * rowH + rowH / 2} x2={panelX + pad * 1.8 + it.x + 7.5 * u} y2={ly + pad * 0.7 + ri * rowH + rowH / 2} stroke="#172033" strokeWidth={6 * u} strokeLinecap="round" />
                          <line x1={panelX + pad * 1.8 + it.x + 0.5 * u} y1={ly + pad * 0.7 + ri * rowH + rowH / 2} x2={panelX + pad * 1.8 + it.x + 7.5 * u} y2={ly + pad * 0.7 + ri * rowH + rowH / 2} stroke={it.color} strokeWidth={4 * u} strokeLinecap="round" />
                        </g>
                      ) : it.symbol === "rail-exit" ? (
                        <circle data-legend-symbol="rail-exit" cx={panelX + pad * 1.8 + it.x + 4 * u} cy={ly + pad * 0.7 + ri * rowH + rowH / 2} r={4.8 * u} fill="#FFD200" stroke="#172033" strokeWidth={0.8 * u} />
                      ) : it.badge ? (
                        <>
                          <circle cx={panelX + pad * 1.8 + it.x + 4 * u} cy={ly + pad * 0.7 + ri * rowH + rowH / 2} r={5 * u} fill={it.color} fillOpacity={0.95} stroke="#fff" strokeWidth={0.8 * u} />
                          <text x={panelX + pad * 1.8 + it.x + 4 * u} y={ly + pad * 0.7 + ri * rowH + rowH / 2 + 2.5 * u} textAnchor="middle" fontSize={Math.max(7, fs * 0.62)} fontWeight={700} fill={badgeTextColor(it.color)}>{it.badge}</text>
                        </>
                      ) : (
                        <circle cx={panelX + pad * 1.8 + it.x + 4 * u} cy={ly + pad * 0.7 + ri * rowH + rowH / 2} r={4 * u} fill={it.color} fillOpacity={0.85} />
                      )}
                      <text x={panelX + pad * 1.8 + it.x + 11 * u} y={ly + pad * 0.7 + ri * rowH + rowH * 0.72} fontSize={fs} fill={INK}>
                        {legendLabel}
                      </text>
                    </g>
                  );
                }))}
                {notes.map((n, i) => (
                  <text key={`note-${i}-${n}`} x={panelX + pad + pad * 0.8} y={ly + pad * 0.7 + legendRowsN * rowH + i * rowH * 0.95 + rowH * 0.72} fontSize={fs * 0.95} fill="#555a64">
                    {n}
                  </text>
                ))}
              </>
            )}
            {rasterLegendVisible && rasterLegends.map(({ ref, style, entries }) => {
              if (cardRailRasterLegend) {
                const midY = rasterLy + panelH / 2;
                const barX = panelX + 8 * u + compactTitleW + 4 * u + textW(compactEnds[0], compactFs) + 4 * u;
                return (
                  <g key={`raster-legend-${ref.name}`} data-raster-legend={ref.name} data-raster-legend-rail="true">
                    <title>{style.legendNote ? `${compactFullTitle} · ${style.legendNote}` : compactFullTitle}</title>
                    <text data-raster-legend-title="true" x={panelX + 8 * u} y={midY} dominantBaseline="central" fontSize={compactTitleFs} fontWeight={700} fill={INK}>
                      {compactTitle}
                    </text>
                    <text data-raster-legend-tick={compactEnds[0]} x={barX - 4 * u} y={midY} textAnchor="end" dominantBaseline="central" fontSize={compactFs} fill="#334155">
                      {compactEnds[0]}
                    </text>
                    <g data-raster-legend-bar="true">
                      {style.mode === "stepped"
                        ? entries.map((entry, index) => (
                          <rect
                            key={`${ref.name}-pill-cell-${index}-${entry.label}`}
                            data-raster-legend-entry={entry.label}
                            aria-label={entry.label}
                            x={barX + (index / entries.length) * compactBarW}
                            y={midY - 3.5 * u}
                            width={compactBarW / entries.length + 0.25}
                            height={7 * u}
                            fill={rasterLegendColor(ref, style, entry) ?? style.colors[0] ?? "#43566B"}
                          />
                        ))
                        : <rect x={barX} y={midY - 3.5 * u} width={compactBarW} height={7 * u} rx={2 * u} fill={`url(#raster-gradient-${uid}-${ref.name})`} stroke="#64748B" strokeWidth={0.6 * u} />}
                    </g>
                    <text data-raster-legend-tick={compactEnds[1]} x={barX + compactBarW + 4 * u} y={midY} dominantBaseline="central" fontSize={compactFs} fill="#334155">
                      {compactEnds[1]}
                    </text>
                  </g>
                );
              }
              if (style.mode === "stepped") {
                const barX = panelX + pad * 1.4;
                const barWidth = Math.max(1, Math.min(steppedBarW, panelW - 2.8 * pad));
                const titleY = rasterLy + pad + steppedTitleFs;
                const barY = titleY + 4 * u;
                const tickY = barY + rasterBarH + rasterFs;
                const ticks = steppedLegendTicksFor(ref, entries, style);
                const names = steppedLegendNames(style, entries.length);
                return (
                  <g key={`raster-legend-${ref.name}`} data-raster-legend={ref.name}>
                    <text data-raster-legend-title="true" x={barX} y={titleY} fontSize={steppedTitleFs} fontWeight={700} fill={INK}>
                      {steppedTitle}
                    </text>
                    <g data-raster-legend-bar="true">
                      {entries.map((entry, index) => (
                        <rect
                          key={`${ref.name}-cell-${index}-${entry.label}`}
                          data-raster-legend-entry={entry.label}
                          aria-label={entry.label}
                          x={barX + (index / entries.length) * barWidth}
                          y={barY}
                          width={barWidth / entries.length + 0.25}
                          height={rasterBarH}
                          fill={rasterLegendColor(ref, style, entry) ?? style.colors[0] ?? "#43566B"}
                          stroke="#fff"
                          strokeWidth={0.45 * u}
                        />
                      ))}
                    </g>
                    {ticks.map((tick, index) => (
                      <text key={`${ref.name}-tick-${index}-${tick.label}`} data-raster-legend-tick={tick.label} x={barX + barWidth * tick.position} y={tickY} textAnchor={tick.position === 0 ? "start" : tick.position === 1 ? "end" : "middle"} fontSize={Math.max(7.5, rasterFs * 0.82)} fill="#334155">
                        {tick.label}
                      </text>
                    ))}
                    {names.map((name, nameIndex) => (
                      <text key={`${ref.name}-name-${name.label}`} data-raster-legend-name={name.label} x={barX + barWidth * name.position} y={tickY + rasterFs * 1.1 + (nameStagger && nameIndex % 2 === 1 ? rasterFs : 0)} textAnchor="middle" fontSize={Math.max(7, Math.min(rasterFs * 0.82, (nameStagger ? 2 : 1) * (barWidth / entries.length) / 3.9))} fill="#1F2937">
                        {name.label}
                      </text>
                    ))}
                  </g>
                );
              }
              const min = style.min ?? 0;
              const max = style.max ?? 1;
              const ticks = style.legendTicks?.length ? style.legendTicks : [min, max];
              const tickPosition = (tick: number) => max <= min ? 0 : Math.max(0, Math.min(1, (tick - min) / (max - min)));
              const tickLabel = (tick: number) => `${Math.round(tickPosition(tick) * 100)}%`;
              const continuousTop = rasterLy + pad * 0.7;
              const continuousX = panelX + pad * 0.8;
              const barY = continuousTop + rowH + pad * 0.25;
              const tickY = barY + rasterBarH + rowH * 0.72;
              return (
                <g key={`raster-legend-${ref.name}`} data-raster-legend={ref.name}>
                  <text x={continuousX} y={continuousTop + rowH * 0.72} fontSize={fs} fontWeight={700} fill={INK}>{style.label ?? ref.label ?? ref.name}</text>
                  <rect x={continuousX} y={barY} width={rasterBarW} height={rasterBarH} rx={2 * u} fill={`url(#raster-gradient-${uid}-${ref.name})`} stroke="#64748B" strokeWidth={0.6 * u} />
                  {ticks.map((tick) => {
                    const position = tickPosition(tick);
                    return <text key={`${ref.name}-tick-${tick}`} x={continuousX + rasterBarW * position} y={tickY} textAnchor={position === 0 ? "start" : position === 1 ? "end" : "middle"} fontSize={fs * 0.82} fill="#334155">{tickLabel(tick)}</text>;
                  })}
                  {style.legendNote && <text x={continuousX} y={tickY + rowH * 0.9} fontSize={fs * 0.82} fill="#555a64">{style.legendNote}</text>}
                </g>
              );
            })}
          </g>
        )}

        {/* 북쪽 */}
        {showNativeChrome && northOpt !== false && (
          <g>
            <circle cx={north.x} cy={north.y} r={13 * u} fill="#fff" fillOpacity={0.9} />
            <path d={`M${north.x} ${north.y - 9 * u}L${north.x + 4.5 * u} ${north.y + 3 * u}L${north.x} ${north.y + 0.5 * u}L${north.x - 4.5 * u} ${north.y + 3 * u}Z`} fill={INK} />
            <text x={north.x} y={north.y + 11 * u} fontSize={7.5 * u} fontWeight={700} textAnchor="middle" fill={INK}>
              N
            </text>
          </g>
        )}

        {/* 축척 막대 + 저작권 */}
        {showNativeChrome && <g>
          {scale && (
            <>
              <rect x={barX0 - 6 * u} y={barY - 14 * u} width={bar.px + 12 * u} height={22 * u} rx={5 * u} fill="#fff" fillOpacity={0.85} />
              <path d={`M${barX0} ${barY - 4 * u}V${barY}H${barX1}V${barY - 4 * u}`} fill="none" stroke={INK} strokeWidth={1.6 * u} />
              <text x={barX0 + bar.px / 2} y={barY - 6 * u} fontSize={9.5 * u} fontWeight={700} textAnchor="middle" fill={INK}>
                {bar.label}
              </text>
            </>
          )}
          {credit && (
            <text x={W - 4 * u} y={H - 4 * u} fontSize={6.6 * u} textAnchor="end" fill="#3b3f47" stroke="#fff" strokeOpacity={0.8} strokeWidth={2 * u} paintOrder="stroke">
              {BASEMAP_ATTRIBUTION}
            </text>
          )}
        </g>}
        {showNativeChrome && labels}
        {/* 호버 라벨은 모든 지도 장식 위에 놓고 포인터 이벤트를 받지 않는다. */}
        {showNativeChrome && hoverLabelNode}
        </>}
      </g>
    </svg>
  );
}

export default memo(MapFigure);

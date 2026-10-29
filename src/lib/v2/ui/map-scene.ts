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
import { toUtmk, type LngLat } from "../crs";
import type { SiteOutline } from "./site-outline";
import { BASE_SUPPRESS, resolveBasemap, type BaseLayerKind, type MapBase } from "./basemap";
import { baseTheme, type BaseTheme, type BaseThemeRef } from "./map-theme";

export type MapSceneBox = { x0: number; y0: number; x1: number; y1: number };

/** 바탕 한 층의 도형 묶음. 화면은 묶음마다 경로 하나, PPT는 묶음마다 편집 도형 하나로 그린다. */
export type MapSceneBaseBucket = {
  key: string;
  layer: BaseLayerKind;
  /** 사용자에게 보이는 묶음 이름(PPT 도형 이름 등) */
  display: string;
  /** 면(고리)이면 true, 선이면 false */
  closed: boolean;
  paths: Array<Array<[number, number]>>;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  dash?: string;
  opacity?: number;
};

/** 바탕의 이름 라벨. (x, y)는 글자 중심이고 angle(-90~90도)만큼 돌려 쓴다. */
export type MapSceneBaseLabel = {
  key: string;
  kind: "road" | "place" | "park" | "station";
  text: string;
  x: number;
  y: number;
  angle: number;
  fontSize: number;
  color: string;
  halo: string;
  box: MapSceneBox;
};

type ScaleBarLayout = {
  bar: ReturnType<typeof scaleBar>;
  x0: number;
  x1: number;
  y: number;
  unit: number;
};

/** §9-12 방위표 A형: 지름 46 px(지도 단위 u = 1). 중심은 오른쪽·위 가장자리에서 반지름 + 7 안쪽이다. */
export const NORTH_RADIUS = 23;
export const NORTH_INSET = NORTH_RADIUS + 7;
/** §9-12 축척 막대: 최대 길이 134 px, 길이 글자 12 px(u = 1). */
export const SCALE_MAX_PX = 134;
export const SCALE_FONT_PX = 12;
/** 축척 판이 막대 기준선 위로 올라가는 높이(글자 + 5)·아래로 내려가는 높이(u 단위). */
export const SCALE_PANEL_ABOVE = SCALE_FONT_PX + 5;
export const SCALE_PANEL_BELOW = 8;
/** 축척 판의 막대 좌우 여백(u 단위). */
export const SCALE_PANEL_SIDE = 6;
/** 방위표 그림(중심 기준, u 단위): 화살촉 끝·날개·파인 곳, N 글자 중심·크기, 그림자(아래 1·번짐 1.4·검정 28 %). */
export const NORTH_GLYPH = { tipY: -15.6, wingX: 7.8, wingY: 2.8, notchY: -0.9, letterY: 12.4, letterPx: 11, shadowDy: 1, shadowBlur: 1.4, shadowOpacity: 0.28 } as const;

/** 방위표 화살촉의 네 꼭짓점(끝 → 오른쪽 날개 → 파인 곳 → 왼쪽 날개). */
export function northArrowPoints(x: number, y: number, u: number): [number, number][] {
  const g = NORTH_GLYPH;
  return [[x, y + g.tipY * u], [x + g.wingX * u, y + g.wingY * u], [x, y + g.notchY * u], [x - g.wingX * u, y + g.wingY * u]];
}

/** 이전 보고서 pt → px 환산(9pt가 9.5 px였다). 보고서 축척 글자는 pt가 정본이다. */
export const SCALE_PT_TO_PX = 9.5 / 9;

/** 보고서 축척 글자 pt를 장면 `scaleFontScale`로 바꾼다. */
export function scaleFontScaleForPt(pt: number): number {
  return (pt * SCALE_PT_TO_PX) / SCALE_FONT_PX;
}

/**
 * §9-12 대지 치수선(A형)·꼭짓점 표고(C형). 길이·굵기·글자 크기 모두 지도 단위 u 배율이고, 화면과 PPT가 이 값을 그대로 읽는다.
 * 치수: 35 m 미만 변 생략 · 평행선 8 띄움 · 연장선 2 → 8+4 · 사선 (d+n)·3.2 · 글자는 평행선에서 글자 × 0.8.
 * 표고: × 반폭 3(흰 3 밑선 + 검정 1.2) · 숫자는 꼭짓점에서 대지 중심 쪽으로 글자 × 1.1 · 글자 × 3.2 안의 꼭짓점은 생략.
 */
export const SITE_MARK = {
  dimMinM: 35, dimOffset: 8, dimFont: 10.5, dimExtStart: 2, dimExtOver: 4, dimTick: 3.2, dimTextGap: 0.8, dimProbe: 4,
  dimInk: "#2b2b2b", dimParallelWidth: 0.8, dimExtWidth: 0.7, dimTickWidth: 1.1, dimWeight: 500,
  elevFont: 8.5, elevCross: 3, elevTextGap: 1.1, elevMinGap: 3.2, elevHaloWidth: 3, elevInkWidth: 1.2, elevInk: "#16181d", elevWeight: 400,
  /** 흰 halo 굵기 = 글자 크기 × 0.36 (치수·표고 공통). */
  haloRatio: 0.36,
} as const;

type SegmentPx = [[number, number], [number, number]];

export type MapSceneSiteDim = {
  ext: SegmentPx[];
  line: SegmentPx;
  ticks: SegmentPx[];
  text: string;
  x: number;
  y: number;
  angle: number;
  fontSize: number;
  box: MapSceneBox;
};

export type MapSceneSiteElevation = {
  x: number;
  y: number;
  text: string;
  tx: number;
  ty: number;
  anchor: "start" | "middle" | "end";
  fontSize: number;
  box: MapSceneBox;
};

function pointInRing(x: number, y: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** 대지 윤곽 변마다 치수선(35 m 이상)을 바깥쪽에 만든다. 바깥쪽은 변 가운데 + n·4u가 윤곽 밖인 쪽이다. */
function siteDimScene(outline: SiteOutline, project: (lng: number, lat: number) => [number, number], u: number): MapSceneSiteDim[] {
  const k = SITE_MARK;
  const fs = k.dimFont * u;
  const dims: MapSceneSiteDim[] = [];
  for (const ring of outline.rings) {
    const px = ring.points.map(([lng, lat]) => project(lng, lat));
    const utm = ring.points.map((point) => toUtmk(point));
    px.forEach((a, i) => {
      const j = (i + 1) % px.length;
      const b = px[j];
      const meters = Math.hypot(utm[j][0] - utm[i][0], utm[j][1] - utm[i][1]);
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (meters < k.dimMinM || length < 1e-6) return;
      const d: [number, number] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let n: [number, number] = [d[1], -d[0]];
      if (pointInRing(mid[0] + n[0] * k.dimProbe * u, mid[1] + n[1] * k.dimProbe * u, px)) n = [-n[0], -n[1]];
      const at = (p: readonly [number, number], dist: number): [number, number] => [p[0] + n[0] * dist * u, p[1] + n[1] * dist * u];
      const a1 = at(a, k.dimOffset);
      const b1 = at(b, k.dimOffset);
      const tick = [(d[0] + n[0]) * k.dimTick * u, (d[1] + n[1]) * k.dimTick * u];
      const ticks: SegmentPx[] = [a1, b1].map((p): SegmentPx => [[p[0] - tick[0], p[1] - tick[1]], [p[0] + tick[0], p[1] + tick[1]]]);
      const [x, y] = at(mid, k.dimOffset + k.dimTextGap * k.dimFont);
      let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      else if (angle < -90) angle += 180;
      const text = `${meters.toFixed(1)} m`;
      const rad = (angle * Math.PI) / 180;
      const halfW = mapTextWidth(text, fs) / 2 + fs * k.haloRatio / 2;
      const halfH = fs / 2 + fs * k.haloRatio / 2;
      const ex = Math.abs(Math.cos(rad)) * halfW + Math.abs(Math.sin(rad)) * halfH;
      const ey = Math.abs(Math.sin(rad)) * halfW + Math.abs(Math.cos(rad)) * halfH;
      dims.push({
        ext: [[at(a, k.dimExtStart), at(a, k.dimOffset + k.dimExtOver)], [at(b, k.dimExtStart), at(b, k.dimOffset + k.dimExtOver)]],
        line: [a1, b1],
        ticks,
        text,
        x,
        y,
        angle,
        fontSize: fs,
        box: { x0: x - ex, y0: y - ey, x1: x + ex, y1: y + ey },
      });
    });
  }
  return dims;
}

/** 꼭짓점 표고를 대지 중심 쪽 글자로 만든다. 표고가 null이거나 먼저 표시한 꼭짓점과 글자 × 3.2 안이면 생략한다. */
function siteElevationScene(outline: SiteOutline, project: (lng: number, lat: number) => [number, number], u: number): MapSceneSiteElevation[] {
  const k = SITE_MARK;
  const fs = k.elevFont * u;
  const shown: Array<[number, number]> = [];
  const elevations: MapSceneSiteElevation[] = [];
  for (const ring of outline.rings) {
    const px = ring.points.map(([lng, lat]) => project(lng, lat));
    const center: [number, number] = [px.reduce((sum, p) => sum + p[0], 0) / px.length, px.reduce((sum, p) => sum + p[1], 0) / px.length];
    px.forEach((p, i) => {
      const value = ring.elevations[i];
      if (value === null || value === undefined) return;
      if (shown.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < fs * k.elevMinGap)) return;
      shown.push(p);
      const dist = Math.hypot(center[0] - p[0], center[1] - p[1]) || 1;
      const n: [number, number] = [(center[0] - p[0]) / dist, (center[1] - p[1]) / dist];
      const anchor = Math.abs(n[0]) < 0.35 ? "middle" : n[0] > 0 ? "start" : "end";
      const text = value.toFixed(1);
      const tx = p[0] + n[0] * fs * k.elevTextGap;
      const ty = p[1] + n[1] * fs * k.elevTextGap;
      const half = fs * k.haloRatio / 2;
      const tw = mapTextWidth(text, fs);
      const left = anchor === "start" ? tx : anchor === "end" ? tx - tw : tx - tw / 2;
      const cross = k.elevCross * u;
      elevations.push({
        x: p[0],
        y: p[1],
        text,
        tx,
        ty,
        anchor,
        fontSize: fs,
        box: { x0: Math.min(left - half, p[0] - cross), y0: Math.min(ty - fs / 2 - half, p[1] - cross), x1: Math.max(left + tw + half, p[0] + cross), y1: Math.max(ty + fs / 2 + half, p[1] + cross) },
      });
    });
  }
  return elevations;
}

/** 북쪽 표시의 실제 배경·화살표·N 문자를 함께 감싸는 회피 상자. */
export function northArrowBox(width: number, height: number, rightInset = 0, north?: number | false, unitOverride?: number): MapSceneBox | null {
  if (north === false) return null;
  const u = unitOverride ?? Math.min(1.5, Math.max(1, height / 360));
  const x = width - rightInset - NORTH_INSET * u;
  const y = north || NORTH_INSET * u;
  return { x0: Math.max(0, x - NORTH_RADIUS * u), y0: Math.max(0, y - NORTH_RADIUS * u), x1: Math.min(width, x + NORTH_RADIUS * u), y1: Math.min(height, y + NORTH_RADIUS * u) };
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

function scaleBarLayout(width: number, height: number, mpp: number, bottomInset = 0, rightInset = 0, scaleLeft = false, scaleX?: number, unitOverride?: number, maxBarPx = SCALE_MAX_PX, scaleY?: number): ScaleBarLayout {
  const unit = unitOverride ?? Math.min(1.5, Math.max(1, height / 360));
  const bar = scaleBar(mpp, maxBarPx * unit);
  const y = scaleY ?? (height - bottomInset - 20 * unit);
  const x1 = scaleX !== undefined ? scaleX + bar.px : scaleLeft ? Math.max(6 * unit, 12) + bar.px : width - 6 * unit - rightInset;
  return { bar, x0: x1 - bar.px, x1, y, unit };
}

function scaleBarBoxFromLayout(width: number, height: number, layout: ScaleBarLayout): MapSceneBox {
  const { x0, x1, y, unit } = layout;
  const box = { x0: Math.max(0, x0 - SCALE_PANEL_SIDE * unit), y0: Math.max(0, y - SCALE_PANEL_ABOVE * unit) };
  // 작은 썸네일·큰 하단 여백에서는 막대가 화면 밖이라 상자가 뒤집히지 않게 빈 상자로 둔다.
  return { ...box, x1: Math.max(box.x0, Math.min(width, x1 + SCALE_PANEL_SIDE * unit)), y1: Math.max(box.y0, Math.min(height, y + SCALE_PANEL_BELOW * unit)) };
}

/** 축척 막대의 실제 불투명 판·막대·문자 영역과 같은 회피 상자. */
export function scaleBarBox(width: number, height: number, mpp: number, bottomInset = 0, rightInset = 0, scaleLeft = false, scaleX?: number, unitOverride?: number, maxBarPx = SCALE_MAX_PX): MapSceneBox {
  return scaleBarBoxFromLayout(width, height, scaleBarLayout(width, height, mpp, bottomInset, rightInset, scaleLeft, scaleX, unitOverride, maxBarPx));
}

/** 저장된 축척 막대 프레임의 높이를 자동 배치 프레임과 비교해 크롬 배율로 바꾼다. */
export function scaleChromeScaleForBox(saved: MapSceneBox | null | undefined, automatic: MapSceneBox | null | undefined): number {
  if (!saved || !automatic) return 1;
  return Math.max(0.5, Math.min(3, (saved.y1 - saved.y0) / Math.max(1, automatic.y1 - automatic.y0)));
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
  /** 사용자가 고른 바탕. 없으면 바탕 자료가 있는 모델은 벡터, 아니면 일반지도. */
  activeLayer?: BasemapChoice;
  /** 벡터 바탕의 색 테마(없으면 기본 테마). `model.baseTheme`이 있으면 그것이 먼저다. */
  baseTheme?: BaseThemeRef | null;
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
  /** 저장된 방위표 중심 x(px). 생략하면 오른쪽 기본 위치. */
  northX?: number;
  /** 저장된 방위표 사각형에서 계산한 장식 크기 배율. */
  northScale?: number;
  dragging?: boolean;
  /** 보고서가 미리 계산한 동일 프레임 뷰. 지정하면 view 재계산을 하지 않는다. */
  viewport?: Viewport;
  /** 보고서 요소별 지도 라벨 pt를 기존 scene 기준으로 환산한 배율. */
  labelScale?: number;
  /** 보고서 preview와 PPT가 같은 논리 단위로 callout·scale chrome을 배치할 때 쓴다. */
  layoutUnit?: number;
  /** 명시적 보고서 축척에서 네이티브 막대의 기존 판형 라벨 여유를 유지한다. */
  scaleMaxPx?: number;
  /** 저장된 축척 막대 중심 y(px)와 판 사각형. 막대 길이 자체는 mpp로 다시 계산한다. */
  scaleY?: number;
  scaleBoxOverride?: MapSceneBox;
  /** 저장된 축척 막대 사각형에서 계산한 굵기·글자 배율. */
  scaleChromeScale?: number;
  /** 보고서 축척 글자 pt를 기존 장면의 9pt 기준으로 환산한 배율. */
  scaleFontScale?: number;
  /** 보고서 장식 `대지 치수`·`대지 표고`. 꺼져 있거나 `model.siteOutline`이 없으면 그리지 않는다. */
  siteMarks?: { dims: boolean; elevations: boolean };
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
  /** 벡터 바탕(아래→위 순서의 묶음과 이름 라벨). 벡터 바탕이 아니면 null. */
  base: { bg: string; buckets: MapSceneBaseBucket[]; labels: MapSceneBaseLabel[] } | null;
  features: MapSceneFeature[];
  lines: MapSceneLine[];
  polygons: MapScenePolygon[];
  siteParcels: MapScenePolygon[];
  siteMode: "parcel" | "ring";
  sitePath: string;
  sitePoints: Array<[number, number]>;
  siteBounds: MapSceneBox;
  siteDims: MapSceneSiteDim[];
  siteElevations: MapSceneSiteElevation[];
  rings: number[];
  scale: { meters: number; px: number; label: string; x0: number; x1: number; y: number };
  scaleBox: MapSceneBox;
  north: { x: number; y: number } | null;
  northUnit: number;
  scaleChromeScale: number;
  scaleFontScale: number;
  routePoints: Array<[number, number]>;
  labels: MapSceneLabel[];
  labelPlacements: MapSceneLabelPlacement[];
  hiddenKeys: ReadonlySet<string>;
  rail: MapSceneRail;
  occupiedBoxes: MapSceneBox[];
  lineColor: string;
  /** 반경 원·점선 고리 색. 위성은 흰색, 벡터 바탕은 테마의 ring, 그 밖은 잉크색(= lineColor). */
  ringColor: string;
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

/** 최근접 지시선 색. 일반선은 반경 고리색, 강조선은 잉크색(어두운 바탕에서는 고리색 — 잉크는 먹 바탕에서 1.1:1이라 안 보인다). */
export function nearestLineStroke(scene: Pick<MapScene, "base" | "ringColor">, strong: boolean): string {
  const ink = "#16181d";
  if (!strong) return scene.ringColor;
  return scene.base && railTextContrastRatio(ink, scene.base.bg) < 3 ? scene.ringColor : ink;
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

// ── 벡터 바탕: 층별 묶음(경로 하나씩)과 겹치지 않는 이름 라벨 ──

type BaseProjection = {
  buckets: MapSceneBaseBucket[];
  /** 이름별로 화면 안에서 가장 긴 도로 구간 */
  roadRuns: Array<{ name: string; rank: number; run: Array<[number, number]>; length: number }>;
  stations: Array<{ name: string; p: [number, number] }>;
  places: Array<{ name: string; kind: "dong" | "park"; p: [number, number] }>;
};

const BASE_ROAD_RANK = ["고속도로", "간선", "보조간선", "집산", "국지", "보행·자전거", "기타"];
const BASE_VIEW_MARGIN = 24;
const BASE_STATION_SIDES = 12;
const BASE_LABEL_MIN_WIDTH = 600;
/** `layoutUnit`이 주어지는 표면(보고서 미리보기·내보내기)에서 PPT(u = 1.5)와 같은 비율로 맞추는 기준 단위. */
const BASE_LABEL_REFERENCE_UNIT = 1.5;
const baseProjectionCache = new WeakMap<MapBase, Map<string, BaseProjection>>();
const BASE_PROJECTION_CACHE_SIZE = 12;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const baseRoadRank = (hierarchy: string): number => { const index = BASE_ROAD_RANK.indexOf(hierarchy); return index < 0 ? BASE_ROAD_RANK.length : index; };

/** 한 장면·뷰포트·테마·생략 조합의 묶음은 33개 타일이 한 번만 계산한다. */
function baseProjection(base: MapBase, theme: BaseTheme, vp: Viewport, width: number, height: number, mpp: number, suppress: ReadonlySet<BaseLayerKind>): BaseProjection {
  // 만든 색은 id가 모두 "custom"이라, 도형 색을 정하는 값으로 구분한다.
  const themeKey = theme.id === "custom" ? [theme.bg, theme.building.fill, theme.parcel.line, theme.road.fill, theme.green.park, theme.water].join(",") : theme.id;
  const key = `${themeKey}|${vp.center[0]},${vp.center[1]},${vp.zoom}|${width}x${height}|${[...suppress].sort().join()}`;
  let byKey = baseProjectionCache.get(base);
  if (!byKey) baseProjectionCache.set(base, byKey = new Map());
  const cached = byKey.get(key);
  if (cached) return cached;
  const project = makeProjector(vp);
  const inFrame = (x: number, y: number, margin = 0) => x >= -margin && x <= width + margin && y >= -margin && y <= height + margin;
  const visible = (points: ReadonlyArray<readonly [number, number]>, margin: number) => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const [x, y] of points) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 >= -margin && x0 <= width + margin && y1 >= -margin && y0 <= height + margin;
  };
  const toPx = (points: readonly LngLat[]): Array<[number, number]> => points.map(([lng, lat]) => { const [x, y] = project(lng, lat); return [round2(x), round2(y)]; });
  /** 화면 밖 지물은 버리고, 안에 걸치는 면은 모든 고리를 함께 낸다(구멍 보존). */
  const polygonRings = (polygons: readonly (readonly (readonly LngLat[])[])[]): Array<Array<[number, number]>> => polygons.flatMap((rings) => {
    const projected = rings.map(toPx).filter((ring) => ring.length >= 3);
    return projected.length > 0 && visible(projected[0]!, BASE_VIEW_MARGIN) ? projected : [];
  });
  const buckets: MapSceneBaseBucket[] = [];
  const add = (bucket: Omit<MapSceneBaseBucket, "strokeWidth"> & { strokeWidth?: number }) => { if (bucket.paths.length > 0) buckets.push({ strokeWidth: 0, ...bucket }); };

  if (!suppress.has("water")) add({ key: "water", layer: "water", display: "물", closed: true, paths: polygonRings(base.water), fill: theme.water, stroke: null });
  if (!suppress.has("green")) {
    for (const [kind, display] of [["forest", "숲"], ["park", "공원"], ["grass", "잔디"]] as const) {
      const rings = base.green.filter((item) => (item.kind === "orchard" ? "grass" : item.kind) === kind).map((item) => item.rings);
      add({ key: `green-${kind}`, layer: "green", display, closed: true, paths: polygonRings(rings), fill: theme.green[kind], stroke: null });
    }
  }
  if (!suppress.has("parcel") && mpp <= theme.parcel.maxMPerPx) {
    add({ key: "parcel", layer: "parcel", display: "필지선", closed: true, paths: polygonRings(base.parcels), fill: null, stroke: theme.parcel.line, strokeWidth: theme.parcel.lineWidthPx, opacity: theme.parcel.opacity });
  }

  const roadRuns = new Map<string, BaseProjection["roadRuns"][number]>();
  if (!suppress.has("road")) {
    const groups = new Map<string, { hierarchy: string; widthM: number; paths: Array<Array<[number, number]>> }>();
    for (const road of base.roads) {
      const widthM = Math.round(road.widthM);
      const groupKey = `${road.hierarchy}|${widthM}`;
      let group = groups.get(groupKey);
      if (!group) groups.set(groupKey, group = { hierarchy: road.hierarchy, widthM, paths: [] });
      const points = toPx(road.points);
      if (points.length < 2) continue;
      if (visible(points, BASE_VIEW_MARGIN + (widthM * theme.road.widthScale) / mpp)) group.paths.push(points);
      if (!road.name) continue;
      // 이름이 붙을 구간: 화면 안 연속 점들 중 가장 긴 것
      let run: Array<[number, number]> = [];
      let runLength = 0;
      const close = () => {
        const best = roadRuns.get(road.name!);
        if (run.length >= 2 && (!best || runLength > best.length)) roadRuns.set(road.name!, { name: road.name!, rank: baseRoadRank(road.hierarchy), run, length: runLength });
        run = []; runLength = 0;
      };
      for (const point of points) {
        if (!inFrame(point[0], point[1])) { close(); continue; }
        const previous = run.at(-1);
        if (previous) runLength += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        run.push(point);
      }
      close();
    }
    const ordered = [...groups.values()].filter((group) => group.paths.length > 0).sort((a, b) => a.widthM - b.widthM || baseRoadRank(a.hierarchy) - baseRoadRank(b.hierarchy));
    const fillPx = (group: { widthM: number }) => Math.max(theme.road.minWidthPx, (group.widthM * theme.road.widthScale) / mpp);
    for (const group of ordered) add({ key: `road-casing-${group.hierarchy}-${group.widthM}`, layer: "road", display: "도로 테두리", closed: false, paths: group.paths, fill: null, stroke: theme.road.casing, strokeWidth: round2(fillPx(group) + theme.road.casingM / mpp) });
    for (const group of ordered) add({ key: `road-fill-${group.hierarchy}-${group.widthM}`, layer: "road", display: "도로", closed: false, paths: group.paths, fill: null, stroke: theme.road.fill, strokeWidth: round2(fillPx(group)) });
  }
  if (!suppress.has("rail")) {
    const byColor = new Map<string, Array<Array<[number, number]>>>();
    for (const line of base.rail) {
      const points = toPx(line.points);
      if (points.length < 2 || !visible(points, BASE_VIEW_MARGIN)) continue;
      byColor.set(line.color, [...(byColor.get(line.color) ?? []), points]);
    }
    for (const [color, paths] of byColor) add({ key: `rail-${color}`, layer: "rail", display: "철도", closed: false, paths, fill: null, stroke: color, strokeWidth: theme.rail.widthPx, dash: theme.rail.dash, opacity: theme.rail.opacity });
  }
  if (!suppress.has("building")) add({ key: "building", layer: "building", display: "건물", closed: true, paths: polygonRings(base.buildings), fill: theme.building.fill, stroke: theme.building.line, strokeWidth: theme.building.lineWidthPx });
  const stations: BaseProjection["stations"] = [];
  if (!suppress.has("station")) {
    const circles: Array<Array<[number, number]>> = [];
    for (const station of base.stations) {
      const [x, y] = project(station.p[0], station.p[1]);
      if (!inFrame(x, y, theme.station.radiusPx)) continue;
      stations.push({ name: station.name, p: [x, y] });
      circles.push(Array.from({ length: BASE_STATION_SIDES }, (_, i) => [round2(x + theme.station.radiusPx * Math.cos((2 * Math.PI * i) / BASE_STATION_SIDES)), round2(y + theme.station.radiusPx * Math.sin((2 * Math.PI * i) / BASE_STATION_SIDES))]));
    }
    add({ key: "station", layer: "station", display: "역", closed: true, paths: circles, fill: theme.station.fill, stroke: theme.station.line, strokeWidth: 1.2 });
  }
  const places = base.places.flatMap((place) => { if (place.kind === "park" && suppress.has("green")) return []; const [x, y] = project(place.p[0], place.p[1]); return inFrame(x, y) ? [{ name: place.name, kind: place.kind, p: [x, y] as [number, number] }] : []; });
  const result: BaseProjection = { buckets, roadRuns: [...roadRuns.values()], stations, places };
  if (byKey.size >= BASE_PROJECTION_CACHE_SIZE) byKey.delete(byKey.keys().next().value!);
  byKey.set(key, result);
  return result;
}

/** 역 > 동 > 공원 > 도로 순으로 놓고, 점유 상자·이미 놓은 라벨과 겹치거나 지도 밖이면 버린다. */
/** circle이 있으면(분석 반경 표시) 라벨 상자는 반경 원 안에 통째로 들어와야 한다: 원 밖은 흐려지고 바탕 자료도 끝나는 자리이며, PPT 글상자는 잘라낼 수 없다. */
function baseLabels(projection: BaseProjection, theme: BaseTheme, width: number, height: number, labelScale: number, occupied: readonly MapSceneBox[], circle: { cx: number; cy: number; r: number } | null = null): MapSceneBaseLabel[] {
  const fontSize = theme.label.fontPx * labelScale;
  const textHeight = fontSize * 1.3;
  const placed: MapSceneBaseLabel[] = [];
  const blockers: MapSceneBox[] = [...occupied];
  // 후광 획(map-figure: strokeWidth = max(2, 0.3·fontSize))이 글자 상자 밖으로 나가는 폭. 겹침·프레임·반경 판정은 후광까지 넓힌 상자로 한다.
  const halo = Math.max(1, fontSize * 0.15);
  const inCircle = (box: MapSceneBox) => !circle || [box.x0, box.x1].every((x) => [box.y0, box.y1].every((y) => Math.hypot(x - circle.cx, y - circle.cy) <= circle.r));
  const fits = (raw: MapSceneBox) => {
    const box = { x0: raw.x0 - halo, y0: raw.y0 - halo, x1: raw.x1 + halo, y1: raw.y1 + halo };
    return box.x0 >= 0 && box.y0 >= 0 && box.x1 <= width && box.y1 <= height && inCircle(box) && !blockers.some((other) => boxesOverlap(box, other));
  };
  const place = (label: Omit<MapSceneBaseLabel, "fontSize" | "halo" | "color" | "box">, color: string, box: MapSceneBox): boolean => {
    if (!fits(box)) return false;
    placed.push({ ...label, fontSize, color, halo: theme.label.halo, box });
    blockers.push(box);
    return true;
  };
  const boxAround = (cx: number, cy: number, w: number, h: number): MapSceneBox => ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });

  projection.stations.forEach(({ name, p }, index) => {
    // 환승역은 노선마다 역 점이 따로 있다: 가까운 같은 이름 역에 이미 라벨이 있으면 다시 쓰지 않는다.
    if (placed.some((l) => l.text === name && Math.hypot(l.x - p[0], l.y - p[1]) < fontSize * 8)) return;
    const w = mapTextWidth(name, fontSize);
    const gap = theme.station.radiusPx + 3;
    const label = { key: `base-station-${index}`, kind: "station" as const, text: name, angle: 0 };
    for (const cx of [p[0] + gap + w / 2, p[0] - gap - w / 2]) {
      if (place({ ...label, x: cx, y: p[1] }, theme.label.station, boxAround(cx, p[1], w, textHeight))) break;
    }
  });
  projection.places.filter((item) => item.kind === "dong").forEach(({ name, p }, index) => {
    place({ key: `base-place-${index}`, kind: "place", text: name, x: p[0], y: p[1], angle: 0 }, theme.label.place, boxAround(p[0], p[1], mapTextWidth(name, fontSize), textHeight));
  });
  projection.places.filter((item) => item.kind === "park").forEach(({ name, p }, index) => {
    place({ key: `base-park-${index}`, kind: "park", text: name, x: p[0], y: p[1], angle: 0 }, theme.label.park, boxAround(p[0], p[1], mapTextWidth(name, fontSize), textHeight));
  });
  const roads = [...projection.roadRuns].sort((a, b) => a.rank - b.rank || b.length - a.length);
  for (const road of roads) {
    const w = mapTextWidth(road.name, fontSize);
    if (road.length < w * 1.2) continue;
    // 구간 가운데에서 글자 폭만큼의 현을 잡아 그 방향으로 쓴다. 글자가 뒤집히지 않게 -90~90도로 접는다.
    const at = (distance: number): [number, number] => {
      let rest = distance;
      for (let i = 1; i < road.run.length; i += 1) {
        const a = road.run[i - 1]!; const b = road.run[i]!;
        const segment = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (rest <= segment || i === road.run.length - 1) { const t = segment === 0 ? 0 : Math.min(1, rest / segment); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
        rest -= segment;
      }
      return road.run[0]!;
    };
    const from = at(road.length / 2 - w / 2);
    const to = at(road.length / 2 + w / 2);
    let angle = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const cx = (from[0] + to[0]) / 2;
    const cy = (from[1] + to[1]) / 2;
    const cos = Math.abs(Math.cos((angle * Math.PI) / 180));
    const sin = Math.abs(Math.sin((angle * Math.PI) / 180));
    place({ key: `base-road-${road.name}`, kind: "road", text: road.name, x: cx, y: cy, angle: round2(angle) }, theme.label.road, boxAround(cx, cy, w * cos + textHeight * sin, w * sin + textHeight * cos));
  }
  return placed;
}

/** MapFigure의 투영·표식·말풍선·철도 표현 배치를 하나의 순수 장면으로 계산한다. */
export function buildMapScene(options: MapSceneOptions): MapScene {
  recordMapSceneBuild();
  const {
    model,
    width: W,
    height: H,
    activeLayer,
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
    northX,
    northScale: northScaleOpt = 1,
    dragging = false,
    viewport: viewportOpt,
    layoutUnit,
    labelScale: labelScaleOpt = 1,
    scaleMaxPx = SCALE_MAX_PX,
    scaleY,
    scaleBoxOverride,
    scaleChromeScale: scaleChromeScaleOpt = 1,
    scaleFontScale: scaleFontScaleOpt = 1,
    siteMarks,
  } = options;
  const layer = resolveBasemap(model, activeLayer);
  const sat = layer === "Satellite";
  const lineColor = sat ? "#fff" : "#16181d";
  const u = layoutUnit ?? Math.min(1.5, Math.max(1, H / 360));
  const northScale = Number.isFinite(northScaleOpt) && northScaleOpt > 0 ? Math.min(3, Math.max(0.5, northScaleOpt)) : 1;
  const scaleChromeScale = Number.isFinite(scaleChromeScaleOpt) && scaleChromeScaleOpt > 0 ? Math.min(3, Math.max(0.5, scaleChromeScaleOpt)) : 1;
  const scaleFontScale = Number.isFinite(scaleFontScaleOpt) && scaleFontScaleOpt > 0 ? Math.min(3, Math.max(0.5, scaleFontScaleOpt)) : 1;
  const northUnit = u * northScale;
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
  // 저장된 축척 상자(옛 최대 길이로 만든 것 포함)보다 막대가 길어지지 않게 상자 폭에서 좌우 여백을 뺀 길이로 묶는다.
  // 기본 상자 폭은 막대 + 12u라 경계값(scaleBar의 m <= maxM)과 같다. 저장·이동 중 부동소수 오차로 한 단계 짧아지지 않게 1e-6 px 허용한다.
  const scaleBarMaxPx = scaleBoxOverride ? Math.max(1, Math.min(scaleMaxPx, (scaleBoxOverride.x1 - scaleBoxOverride.x0 + 1e-6) / u - 2 * SCALE_PANEL_SIDE)) : scaleMaxPx;
  const scaleLayout = scaleBarLayout(W, H, mpp, bottomInset, rightInset, scaleLeft, scaleX, u, scaleBarMaxPx, scaleY);
  const { bar, y: barY } = scaleLayout;
  const scaleBox = scaleBoxOverride ?? scaleBarBoxFromLayout(W, H, scaleLayout);
  const scaleBoxWidth = Math.max(0, scaleBox.x1 - scaleBox.x0);
  const barX0 = scaleBoxOverride ? scaleBox.x0 + Math.max(0, scaleBoxWidth - bar.px) / 2 : scaleLayout.x0;
  const barX1 = barX0 + bar.px;
  const north = northOpt === false ? null : { x: northX ?? (W - rightInset - NORTH_INSET * u), y: northOpt || NORTH_INSET * u };
  const northBox = north ? northArrowBox(W, H, rightInset, northOpt, northUnit) : null;
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
  const siteOutline = model.siteOutline;
  const siteDims = siteMarks?.dims && siteOutline ? siteDimScene(siteOutline, project, u) : [];
  const siteElevations = siteMarks?.elevations && siteOutline ? siteElevationScene(siteOutline, project, u) : [];
  const siteMarkBoxes = [...siteDims.map((dim) => dim.box), ...siteElevations.map((elevation) => elevation.box)];
  const occupiedBoxes: MapSceneBox[] = [
    ...(legendBox ? [legendBox] : []),
    ...calloutAvoid,
    ...(scale ? [scaleBox] : []),
    ...(showSiteMarker && !muted ? [siteBounds] : []),
    ...labelPlacements.flatMap((placement) => [placement.box, placement.leader]),
    ...siteMarkBoxes,
  ];
  const rail = buildRailScene({ model, features: drawn, lines: linePaths, width: W, height: H, mpp, compact, labelScale, hiddenKeys: hidden, occupied: occupiedBoxes, inFrame });
  occupiedBoxes.push(...rail.occupiedBoxes);
  let baseScene: MapScene["base"] = null;
  const theme = layer === "vector" && model.base ? baseTheme(model.baseTheme ?? options.baseTheme) : null;
  if (theme && model.base) {
    const suppress = new Set<BaseLayerKind>([...(BASE_SUPPRESS[model.tileCode ?? ""] ?? []), ...(model.baseHide ?? [])]);
    const projection = baseProjection(model.base, theme, vp, W, H, mpp, suppress);
    // 바탕 라벨은 가장 낮은 우선순위: 방위표·축척·범례·대지 표식·철도 라벨·주제 라벨이 먼저 자리를 잡는다.
    // 주제 점 기호는 라벨 위에 그려지므로 점 상자(중심 ± 반지름)도 비켜 간다.
    const pointBoxes = drawn.map(({ p, radius }): MapSceneBox => ({ x0: p[0] - radius, y0: p[1] - radius, x1: p[0] + radius, y1: p[1] + radius }));
    const labelOccupied = [...(legendBox ? [legendBox] : []), ...calloutAvoid, ...(showSiteMarker && !muted ? [siteBounds] : []), ...labelPlacements.flatMap((placement) => [placement.box, placement.leader]), ...rail.occupiedBoxes, ...pointBoxes, ...siteMarkBoxes];
    // 바탕 라벨은 표면 폭에 비례한다: layoutUnit이 있으면 PPT(u = 1.5)와 같은 비율로 글자와 600 px 최소 폭 기준을 맞춘다.
    const labelUnit = layoutUnit ? layoutUnit / BASE_LABEL_REFERENCE_UNIT : 1;
    baseScene = { bg: theme.bg, buckets: projection.buckets, labels: compact || W / labelUnit < BASE_LABEL_MIN_WIDTH ? [] : baseLabels(projection, theme, W, H, labelScale * labelUnit, labelOccupied, showRadius ? { cx, cy, r: radiusPx } : null) };
  }
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
    base: baseScene,
    features: drawn,
    lines: linePaths,
    polygons: visiblePolygons,
    siteParcels,
    siteMode,
    sitePath,
    sitePoints,
    siteBounds,
    siteDims,
    siteElevations,
    rings,
    scale: { ...bar, x0: barX0, x1: barX1, y: barY },
    scaleBox,
    north,
    northUnit,
    scaleChromeScale,
    scaleFontScale,
    routePoints,
    labels,
    labelPlacements,
    hiddenKeys: hidden,
    rail,
    occupiedBoxes,
    lineColor,
    ringColor: theme?.ring ?? lineColor,
    isLayerHighlighted,
    isElementDimmed,
    isElementStrong,
  };
}

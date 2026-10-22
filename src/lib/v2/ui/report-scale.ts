import type { MapFrameState } from "../report/report-doc";
import type { MapModel } from "./map-layers";
import { layoutRects, slideSize, type SlideFormat } from "./overlay-layout";
import { metersPerPixel, siteFitView, slideViewport, type Viewport } from "./map-projection";
import type { ReportLayout } from "../report/report-doc";

export const SCALE_PRESETS = [1000, 2500, 5000, 10000] as const;
const SCALE_MIN = 500;
const SCALE_MAX = 50000;
const DEFAULT_VIEW_WIDTH = 960;

/** 축척 분모의 보기 표기. 입력 중에는 DrawerMap이 편집 문자열을 그대로 보여준다. */
export function formatScaleDenominator(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("ko-KR");
}

export type ReportScaleViewport = {
  width: number;
  height: number;
  siteX?: number;
  siteY?: number;
  fill?: number;
};

export type ReportScaleOptions = ReportScaleViewport & { frameWidthMm: number };

/** 보고서 지도 프레임이 실제 PPT 종이에서 차지하는 가로 폭(mm). */
export function mapFrameWidthMm(format: SlideFormat, layout: ReportLayout): number {
  const map = layoutRects(layout, format).map;
  const widthRatio = map && Number.isFinite(map.w) && map.w > 0 ? map.w : 1;
  return slideSize(format).w * widthRatio * 25.4;
}

/** 주어진 물리 폭과 실제 렌더러 viewport 인자를 묶어 축척 계산 계약으로 만든다. */
export function scaleOptionsForFrame(frameWidthMm: number, viewport: ReportScaleViewport): ReportScaleOptions {
  return { ...viewport, frameWidthMm };
}

/** 보고서 레이아웃의 map rect에 맞춘 축척 계산 인자. 기본 크기는 PPT scene 기준이다. */
export function mapFrameScaleOptions(
  format: SlideFormat,
  layout: ReportLayout,
  viewport: Partial<ReportScaleViewport> = {},
): ReportScaleOptions {
  const map = layoutRects(layout, format).map;
  const size = slideSize(format);
  const fullHeight = DEFAULT_VIEW_WIDTH * size.h / size.w;
  return scaleOptionsForFrame(mapFrameWidthMm(format, layout), {
    width: viewport.width ?? DEFAULT_VIEW_WIDTH * (map?.w ?? 1),
    height: viewport.height ?? fullHeight * (map?.h ?? 1),
    siteX: viewport.siteX ?? 0.5,
    siteY: viewport.siteY ?? 0.5,
    fill: viewport.fill ?? 0.8,
  });
}

/** 1:N 축척에서 지도 프레임에 보이는 지상 폭(m). */
export function visibleGroundWidthM(frameWidthMm: number, denominator: number): number {
  return frameWidthMm * denominator / 1000;
}

function viewportArgs(options: ReportScaleOptions): ReportScaleViewport {
  return { width: options.width, height: options.height, siteX: options.siteX, siteY: options.siteY, fill: options.fill };
}

function validDenominator(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function roundScale(value: number): number {
  return Math.max(1, Math.round(value / 10) * 10);
}

/** 실제로 그려진 viewport의 폭과 물리 프레임 폭으로 1:N 축척을 계산한다. */
export function scaleForViewport(viewport: Viewport, frameWidthMm: number): number {
  if (!Number.isFinite(viewport.width) || viewport.width <= 0 || !Number.isFinite(frameWidthMm) || frameWidthMm <= 0) return 1;
  return roundScale(metersPerPixel(viewport.center[1], viewport.zoom) * viewport.width / (frameWidthMm / 1000));
}

/** 지도 프레임의 현재 view를 실제 투영에서 1:N으로 표시한다. */
export function scaleForFrame(
  map: Pick<MapModel, "center" | "radiusM">,
  frame: Pick<MapFrameState, "zoomDelta" | "offsetM" | "scaleDenominator">,
  options: ReportScaleOptions,
): number {
  if (frame.scaleDenominator !== null && validDenominator(frame.scaleDenominator)) return roundScale(frame.scaleDenominator);
  return scaleForViewport(slideViewport(map, frame, viewportArgs(options)), options.frameWidthMm);
}

/** 실제 기준 viewport에서 목표 1:N 축척으로 가는 zoomDelta를 역산한다. */
export function zoomForScale(
  denominator: number,
  map: Pick<MapModel, "center" | "radiusM">,
  options: ReportScaleOptions,
): number {
  const base = slideViewport(map, undefined, viewportArgs(options));
  const targetScale = validDenominator(denominator) ? denominator : scaleForViewport(base, options.frameWidthMm);
  const targetMpp = targetScale * (options.frameWidthMm / 1000) / options.width;
  if (!Number.isFinite(targetMpp) || targetMpp <= 0) return 0;
  return Math.log2(metersPerPixel(base.center[1], base.zoom) / targetMpp);
}

export type SiteFitPatch = Pick<MapFrameState, "zoomDelta" | "offsetM">;

/** 보고서 기본 프레임의 대지 앵커를 유지하는 현재 축척용 frame patch. */
export function siteFitPatch(
  map: Pick<MapModel, "center" | "radiusM">,
  frame: Pick<MapFrameState, "zoomDelta" | "offsetM" | "scaleDenominator">,
  options: ReportScaleOptions,
): SiteFitPatch {
  const zoomDelta = frame.scaleDenominator !== null && validDenominator(frame.scaleDenominator)
    ? zoomForScale(frame.scaleDenominator, map, options)
    : frame.zoomDelta;
  const base = slideViewport(map, { zoomDelta: 0, offsetM: [0, 0] }, viewportArgs(options));
  const view = siteFitView(
    base,
    base.width * (options.siteX ?? 0.5),
    base.height * (options.siteY ?? 0.5),
    zoomDelta,
  );
  return { zoomDelta: view.zoomDelta, offsetM: [view.offsetM[0], view.offsetM[1]] };
}

export function parseScaleInput(value: string): number | null {
  const normalized = value.trim().replace(/\s+/g, "").replace(/,/g, "");
  const match = /^(?:1(?::|\/))?([0-9]+(?:\.[0-9]+)?)$/.exec(normalized);
  if (!match) return null;
  const denominator = Math.round(Number(match[1]));
  return Number.isFinite(denominator) && denominator >= SCALE_MIN && denominator <= SCALE_MAX ? denominator : null;
}

import type { MapFrameState } from "../report/report-doc";
import { layoutRects, slideSize, type SlideFormat } from "./overlay-layout";
import type { ReportLayout } from "../report/report-doc";

export const SCALE_PRESETS = [1000, 2500, 5000, 10000] as const;
const SCALE_MIN = 500;
const SCALE_MAX = 50000;

export type ReportScaleOptions = { aspectRatio?: number };

const LEGACY_MAP_WIDTH_MM: Record<SlideFormat, number> = { wide: 240, a3: 270, a4: 190 };

/** 보고서 지도 프레임의 실제 종이 폭(mm). 기존 map-summary 폭은 PPT 호환을 위해 보존한다. */
export function mapFrameWidthMm(format: SlideFormat, layout: ReportLayout): number {
  const map = layoutRects(layout, format).map;
  if (layout === "numbers-first" || layout === "side-by-side") {
    return map ? slideSize(format).w * 25.4 * map.w : LEGACY_MAP_WIDTH_MM[format] * 0.45;
  }
  return LEGACY_MAP_WIDTH_MM[format];
}

/** 비기본 레이아웃에서 기준 반경 뷰의 가로/세로 지상폭 비율을 반환한다. */
export function mapFrameScaleOptions(format: SlideFormat, layout: ReportLayout, fill = 0.8): ReportScaleOptions | undefined {
  const map = layoutRects(layout, format).map;
  if (!map || layout === "map-full" || layout === "map-summary" || !(map.w > 0) || !(map.h > 0) || !(fill > 0)) return undefined;
  return { aspectRatio: map.w / (map.h * fill) };
}

/** 1:N 축척에서 지도 프레임에 보이는 지상 폭(m). */
export function visibleGroundWidthM(frameWidthMm: number, denominator: number): number {
  return frameWidthMm * denominator / 1000;
}

function roundScale(value: number): number {
  return Math.max(1, Math.round(value / 10) * 10);
}

function baseScale(mapWidthMm: number, radiusM: number, options: ReportScaleOptions = {}): number {
  if (!Number.isFinite(mapWidthMm) || mapWidthMm <= 0 || !Number.isFinite(radiusM) || radiusM <= 0) return 1;
  const aspectRatio = Number.isFinite(options.aspectRatio) && (options.aspectRatio ?? 0) > 0 ? options.aspectRatio! : 1;
  return (radiusM * 2 * aspectRatio * 1000) / mapWidthMm;
}

/** 지도 프레임의 가로 폭과 분석 반경으로 1:N 축척을 계산한다. */
export function scaleForFrame(frame: Pick<MapFrameState, "zoomDelta" | "scaleDenominator">, mapWidthMm: number, radiusM: number, options: ReportScaleOptions = {}): number {
  if (frame.scaleDenominator !== null && Number.isFinite(frame.scaleDenominator) && frame.scaleDenominator > 0) return roundScale(frame.scaleDenominator);
  return roundScale(baseScale(mapWidthMm, radiusM, options) * (2 ** frame.zoomDelta));
}

/** 1:N 축척을 현재 반경 기준의 화면 확대량으로 바꾼다. */
export function zoomForScale(denominator: number, mapWidthMm: number, radiusM: number, options: ReportScaleOptions = {}): number {
  const scale = Number.isFinite(denominator) && denominator > 0 ? denominator : baseScale(mapWidthMm, radiusM, options);
  return Math.log2(scale / baseScale(mapWidthMm, radiusM, options));
}

export function parseScaleInput(value: string): number | null {
  const normalized = value.trim().replace(/\s+/g, "").replace(/,/g, "");
  const match = /^(?:1(?::|\/))?([0-9]+(?:\.[0-9]+)?)$/.exec(normalized);
  if (!match) return null;
  const denominator = Math.round(Number(match[1]));
  return Number.isFinite(denominator) && denominator >= SCALE_MIN && denominator <= SCALE_MAX ? denominator : null;
}

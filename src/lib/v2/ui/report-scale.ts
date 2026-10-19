import type { MapFrameState } from "../report/report-doc";

export const SCALE_PRESETS = [1000, 2500, 5000, 10000] as const;
const SCALE_MIN = 500;
const SCALE_MAX = 50000;

function roundScale(value: number): number {
  return Math.max(1, Math.round(value / 10) * 10);
}

function baseScale(mapWidthMm: number, radiusM: number): number {
  if (!Number.isFinite(mapWidthMm) || mapWidthMm <= 0 || !Number.isFinite(radiusM) || radiusM <= 0) return 1;
  return (radiusM * 2 * 1000) / mapWidthMm;
}

/** 지도 프레임의 가로 폭과 분석 반경으로 1:N 축척을 계산한다. */
export function scaleForFrame(frame: Pick<MapFrameState, "zoomDelta" | "scaleDenominator">, mapWidthMm: number, radiusM: number): number {
  if (frame.scaleDenominator !== null && Number.isFinite(frame.scaleDenominator) && frame.scaleDenominator > 0) return roundScale(frame.scaleDenominator);
  return roundScale(baseScale(mapWidthMm, radiusM) * (2 ** frame.zoomDelta));
}

/** 1:N 축척을 현재 반경 기준의 화면 확대량으로 바꾼다. */
export function zoomForScale(denominator: number, mapWidthMm: number, radiusM: number): number {
  const scale = Number.isFinite(denominator) && denominator > 0 ? denominator : baseScale(mapWidthMm, radiusM);
  return Math.log2(scale / baseScale(mapWidthMm, radiusM));
}

export function parseScaleInput(value: string): number | null {
  const normalized = value.trim().replace(/\s+/g, "").replace(/,/g, "");
  const match = /^(?:1(?::|\/))?([0-9]+(?:\.[0-9]+)?)$/.exec(normalized);
  if (!match) return null;
  const denominator = Math.round(Number(match[1]));
  return Number.isFinite(denominator) && denominator >= SCALE_MIN && denominator <= SCALE_MAX ? denominator : null;
}

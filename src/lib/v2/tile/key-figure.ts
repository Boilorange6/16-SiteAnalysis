/** 타일 모듈의 `keyFigureFor`가 같이 쓰는 값 읽기·표기 도우미. */
import type { TileResult } from "../tile-result";
import { fmtInt } from "../ui/callout-layout";
import type { KeyFigure, TileHeadlineHelpers } from "./types";

/** 지표 값. 미확인·비공개·해당 없음이면 null이라 그 줄은 카드에 넣지 않는다. */
export const metricNumber = (result: TileResult, id: string): number | null => result.metrics.find((metric) => metric.id === id)?.value ?? null;

/** 값이 있는 지표(없으면 null). 화면과 같은 서식은 `helpers.metricRow(metric).value`로 얻는다. */
export const valueMetric = (result: TileResult, id: string): TileResult["metrics"][number] | null => {
  const metric = result.metrics.find((candidate) => candidate.id === id);
  return metric && metric.value !== null ? metric : null;
};

/** 화면과 같은 서식의 지표 값(`196m`, `1.3 km`). 값이 없으면 null. */
export const metricText = (result: TileResult, id: string, helpers: TileHeadlineHelpers): string | null => {
  const metric = valueMetric(result, id);
  return metric ? helpers.metricRow(metric).value : null;
};

/** 반경 표기: 1000 → `1km`, 500 → `500m`, 1500 → `1.5km`. */
export const radiusLabel = (radiusM: number): string => (radiusM >= 1000 ? `${radiusM / 1000}km` : `${radiusM}m`);

/** 소수 한 자리 비율(`61.0%`). */
export const percentText = (value: number): string => `${value.toFixed(1)}%`;

/** 천 단위 쉼표 + 단위 붙임(`1,734동`, `106곳`). 소수는 반올림한다(`-0`은 `0`). */
export const countText = (value: number, unit: string): string => `${fmtInt(Math.round(value) || 0)}${unit}`;

/** 지표 값을 천 단위 쉼표 + 단위로(없으면 null). */
export const metricCount = (result: TileResult, id: string, unit: string): string | null => {
  const value = metricNumber(result, id);
  return value === null ? null : countText(value, unit);
};

/** 지표 값을 소수 한 자리 비율로(없으면 null). */
export const metricPercent = (result: TileResult, id: string): string | null => {
  const value = metricNumber(result, id);
  return value === null ? null : percentText(value);
};

/** ha 값 표기: 1 ha 미만은 소수 두 자리(`0.51 ha`), 그 이상은 한 자리(`64.6 ha`). */
export const haText = (ha: number): string => `${ha.toFixed(ha < 1 ? 2 : 1)} ha`;

/** ㎡ 값을 ha로(`450365` → `45.0 ha`). */
export const m2ToHaText = (m2: number): string => haText(m2 / 10_000);

/** 값이 있는 보조 숫자만 남긴다. */
export const statList = (entries: ReadonlyArray<readonly [string | null, string]>): KeyFigure["stats"] =>
  entries.flatMap(([value, label]) => (value === null ? [] : [{ value, label }]));

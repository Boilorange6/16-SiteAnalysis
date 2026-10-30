/** 타일 모듈의 `keyFigureFor`가 같이 쓰는 값 읽기·표기 도우미. */
import type { TileResult } from "../tile-result";
import { fmtInt } from "../ui/callout-layout";

/** 지표 값. 미확인·비공개·해당 없음이면 null이라 그 줄은 카드에 넣지 않는다. */
export const metricNumber = (result: TileResult, id: string): number | null => result.metrics.find((metric) => metric.id === id)?.value ?? null;

/** 반경 표기: 1000 → `1km`, 500 → `500m`, 1500 → `1.5km`. */
export const radiusLabel = (radiusM: number): string => (radiusM >= 1000 ? `${radiusM / 1000}km` : `${radiusM}m`);

/** 소수 한 자리 비율(`61.0%`). */
export const percentText = (value: number): string => `${value.toFixed(1)}%`;

/** 천 단위 쉼표 + 단위 붙임(`1,734동`, `106곳`). */
export const countText = (value: number, unit: string): string => `${fmtInt(value)}${unit}`;

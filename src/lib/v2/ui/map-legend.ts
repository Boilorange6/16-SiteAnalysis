export type LegendScrollMetrics = {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
};

export type LegendScrollState = {
  overflowing: boolean;
  atStart: boolean;
  atEnd: boolean;
  maxScrollLeft: number;
};

const SCROLL_EPSILON = 1;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 범례 띠의 현재 위치와 양 끝 페이드 상태를 계산한다. DOM이나 React 상태를 알지 않는 순수 함수다. */
export function legendScrollState({ scrollLeft, clientWidth, scrollWidth }: LegendScrollMetrics): LegendScrollState {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  const position = clamp(Number.isFinite(scrollLeft) ? scrollLeft : 0, 0, maxScrollLeft);
  const overflowing = maxScrollLeft > SCROLL_EPSILON;
  return {
    overflowing,
    atStart: position <= SCROLL_EPSILON,
    atEnd: position >= maxScrollLeft - SCROLL_EPSILON,
    maxScrollLeft,
  };
}

/** 세로 휠을 가로 이동량으로 바꾸되, 넘치지 않거나 끝에서 더 진행할 수 없으면 null을 반환한다. */
export function legendWheelScrollTarget({ scrollLeft, clientWidth, scrollWidth, deltaX, deltaY }: LegendScrollMetrics & { deltaX: number; deltaY: number }): number | null {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
  if (maxScrollLeft <= SCROLL_EPSILON) return null;
  const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
  if (!Number.isFinite(delta) || delta === 0) return null;
  const current = clamp(Number.isFinite(scrollLeft) ? scrollLeft : 0, 0, maxScrollLeft);
  const target = clamp(current + delta, 0, maxScrollLeft);
  return Math.abs(target - current) > SCROLL_EPSILON ? target : null;
}

export function toggleLegendPin(current: string | null, label: string): string | null {
  return current === label ? null : label;
}

export function activeLegendLabel(hover: string | null, pinned: string | null): string | null {
  return hover ?? pinned;
}

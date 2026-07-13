import type { Poi, PoiPosition } from "./types";

/**
 * 지도에 실제로 그려지는 POI 라벨 문자열 — 두 렌더러(ppt-canvas-renderer.ts/ppt-generator.ts)와
 * 레이아웃 폭 산정(layoutPoiLabels)이 모두 이 함수를 공유해 "표시 텍스트 = 폭 산정 텍스트"를 보장한다.
 * Task 5 — 지명 색 문법(산 초록 "+높이m") 중 고도 표기 부분. mountain은 elevation_m 실측 필드를 사용
 * (없는 데이터 발명 금지 원칙에 따라 다른 카테고리는 이름만 표기).
 */
export function poiLabelText(poi: Poi): string {
  if (poi.category === "mountain") return `${poi.name} ${poi.elevation_m}m`;
  return poi.name;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PoiLabelPlacement {
  readonly poiId: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const LABEL_HEIGHT = 0.26;
const LABEL_GAP = 0.08;
const LABEL_MARGIN = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function overlaps(left: Rect, right: Rect): boolean {
  return !(
    left.x + left.w <= right.x ||
    right.x + right.w <= left.x ||
    left.y + left.h <= right.y ||
    right.y + right.h <= left.y
  );
}

export function layoutPoiLabels(
  positions: readonly PoiPosition[],
  slideWidth: number,
  slideHeight: number,
  markerSize: number
): readonly PoiLabelPlacement[] {
  const occupiedRects: Rect[] = [];
  const placements: PoiLabelPlacement[] = [];
  const sortedPositions = [...positions].sort((left, right) => left.ny - right.ny || left.nx - right.nx);

  sortedPositions.forEach((position) => {
    const markerX = position.nx * slideWidth;
    const markerY = position.ny * slideHeight;
    const labelWidth = clamp(poiLabelText(position.poi).length * 0.13 + 0.35, 0.9, 2.5);
    const preferredRightX = markerX + markerSize / 2 + LABEL_GAP;
    const preferredLeftX = markerX - labelWidth - markerSize / 2 - LABEL_GAP;
    const centeredY = markerY - LABEL_HEIGHT / 2;
    const raisedY = centeredY - LABEL_HEIGHT - 0.06;
    const loweredY = centeredY + LABEL_HEIGHT + 0.06;

    const candidateRects: Rect[] = [
      {
        x: clamp(preferredRightX, LABEL_MARGIN, slideWidth - labelWidth - LABEL_MARGIN),
        y: clamp(centeredY, LABEL_MARGIN, slideHeight - LABEL_HEIGHT - LABEL_MARGIN),
        w: labelWidth,
        h: LABEL_HEIGHT,
      },
      {
        x: clamp(preferredLeftX, LABEL_MARGIN, slideWidth - labelWidth - LABEL_MARGIN),
        y: clamp(centeredY, LABEL_MARGIN, slideHeight - LABEL_HEIGHT - LABEL_MARGIN),
        w: labelWidth,
        h: LABEL_HEIGHT,
      },
      {
        x: clamp(preferredRightX, LABEL_MARGIN, slideWidth - labelWidth - LABEL_MARGIN),
        y: clamp(raisedY, LABEL_MARGIN, slideHeight - LABEL_HEIGHT - LABEL_MARGIN),
        w: labelWidth,
        h: LABEL_HEIGHT,
      },
      {
        x: clamp(preferredLeftX, LABEL_MARGIN, slideWidth - labelWidth - LABEL_MARGIN),
        y: clamp(loweredY, LABEL_MARGIN, slideHeight - LABEL_HEIGHT - LABEL_MARGIN),
        w: labelWidth,
        h: LABEL_HEIGHT,
      },
    ];

    const availableRect = candidateRects.find(
      (candidate) => !occupiedRects.some((occupied) => overlaps(occupied, candidate))
    );

    if (!availableRect) {
      return;
    }

    occupiedRects.push({
      x: availableRect.x - 0.04,
      y: availableRect.y - 0.04,
      w: availableRect.w + 0.08,
      h: availableRect.h + 0.08,
    });

    placements.push({
      poiId: position.poi.id,
      x: availableRect.x,
      y: availableRect.y,
      w: availableRect.w,
      h: availableRect.h,
    });
  });

  return placements;
}

import type { PoiPosition } from "./types";

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
    const labelWidth = clamp(position.poi.name.length * 0.13 + 0.35, 0.9, 2.5);
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

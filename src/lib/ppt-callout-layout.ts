export interface ResidentialCalloutMarker {
  readonly id: string;
  readonly nx: number;
  readonly ny: number;
}

export interface ResidentialCalloutPlacement {
  readonly id: string;
  readonly labelX: number;
  readonly labelY: number;
}

interface LayoutOptions {
  readonly slideWidth: number;
  readonly slideHeight: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly cardMargin: number;
  readonly chipY: number;
  readonly chipHeight: number;
  readonly legendRows: number;
  readonly legendRowHeight: number;
  readonly legendBottomMargin: number;
}

interface SafeColumn {
  readonly labelX: number;
  readonly topY: number;
  readonly bottomY: number;
  readonly capacity: number;
}

const MIN_CARD_GAP = 0.12;
const TITLE_CLEARANCE = 0.20;
const EDGE_CLEARANCE = 0.40;
const LEGEND_EXTRA_HEIGHT = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getColumnCapacity(column: Pick<SafeColumn, "topY" | "bottomY">, minPitch: number): number {
  const range = column.bottomY - column.topY;
  if (range < 0) return 0;
  return Math.max(1, Math.floor(range / minPitch) + 1);
}

function chooseLeftCount(total: number, leftCapacity: number, rightCapacity: number): number {
  if (total <= 0) return 0;
  if (leftCapacity <= 0) return 0;
  if (rightCapacity <= 0) return Math.min(total, leftCapacity);

  const maxLeft = Math.min(leftCapacity, Math.max(0, total - 1));
  const minLeft = Math.max(0, total - rightCapacity);
  const weightedLeft = Math.floor(total * leftCapacity / (leftCapacity + rightCapacity));
  return clamp(weightedLeft, minLeft, maxLeft);
}

function distributeColumn(
  markers: readonly ResidentialCalloutMarker[],
  column: SafeColumn,
  rowPitch: number,
): ResidentialCalloutPlacement[] {
  if (markers.length === 0) return [];

  const sorted = [...markers].sort((a, b) => a.ny - b.ny || a.nx - b.nx);
  const blockHeight = (sorted.length - 1) * rowPitch;
  const range = column.bottomY - column.topY;
  const startY = sorted.length === 1
    ? (column.topY + column.bottomY) / 2
    : column.topY + Math.max(0, range - blockHeight) / 2;

  return sorted.map((marker, index) => ({
    id: marker.id,
    labelX: column.labelX,
    labelY: startY + index * rowPitch,
  }));
}

export function computeResidentialCalloutLayout(
  markerPositions: readonly ResidentialCalloutMarker[],
  options: LayoutOptions,
): ResidentialCalloutPlacement[] {
  if (markerPositions.length === 0) return [];

  const minPitch = options.cardHeight + MIN_CARD_GAP;
  const legendHeight = options.legendRows * options.legendRowHeight + LEGEND_EXTRA_HEIGHT;
  const legendTopY = options.slideHeight - legendHeight - options.legendBottomMargin;
  const subtitleBottomY = options.chipY + options.chipHeight + 0.08 + 0.28;

  const leftColumnBase = {
    labelX: options.cardMargin + options.cardWidth / 2,
    topY: subtitleBottomY + TITLE_CLEARANCE + options.cardHeight / 2,
    bottomY: legendTopY - MIN_CARD_GAP - options.cardHeight / 2,
  };
  const rightColumnBase = {
    labelX: options.slideWidth - options.cardMargin - options.cardWidth / 2,
    topY: EDGE_CLEARANCE + options.cardHeight / 2,
    bottomY: options.slideHeight - EDGE_CLEARANCE - options.cardHeight / 2,
  };

  const leftColumn: SafeColumn = {
    ...leftColumnBase,
    capacity: getColumnCapacity(leftColumnBase, minPitch),
  };
  const rightColumn: SafeColumn = {
    ...rightColumnBase,
    capacity: getColumnCapacity(rightColumnBase, minPitch),
  };

  const orderedByX = [...markerPositions].sort((a, b) => a.nx - b.nx || a.ny - b.ny);
  const leftCount = chooseLeftCount(markerPositions.length, leftColumn.capacity, rightColumn.capacity);
  const leftMarkers = orderedByX.slice(0, leftCount);
  const rightMarkers = orderedByX.slice(leftCount);

  const pitchLimits = [
    leftMarkers.length > 1 ? (leftColumn.bottomY - leftColumn.topY) / (leftMarkers.length - 1) : Number.POSITIVE_INFINITY,
    rightMarkers.length > 1 ? (rightColumn.bottomY - rightColumn.topY) / (rightMarkers.length - 1) : Number.POSITIVE_INFINITY,
  ];
  const finitePitchLimits = pitchLimits.filter(Number.isFinite);
  const rowPitch = finitePitchLimits.length > 0
    ? Math.max(minPitch, Math.min(...finitePitchLimits))
    : minPitch;

  return [
    ...distributeColumn(leftMarkers, leftColumn, rowPitch),
    ...distributeColumn(rightMarkers, rightColumn, rowPitch),
  ];
}

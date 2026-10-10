/** D16 KDE의 수치 계산. 점별 가우시안 합을 분리해 지수 계산을 재사용한다. */
import { toUtmk, type LngLat } from "../../crs";
import { difference, featureCollection, intersect, isobands, point, polygon } from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import type { LocalGrid } from "../../engine/tiles/raster-grid";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { polygonCandidate, type PolygonCandidate } from "../../engine/tiles/common";

export const KDE_BANDWIDTH_M = 100;
export const KDE_ZERO_THRESHOLD = 0.5;

/**
 * 같은 100 m 가우시안 KDE를 exp(-dx²-dy²)로 분리해 계산한다.
 *
 * 기존 식과 동일하게 각 점의 x/y 가중치를 한 번씩 만들고, 격자 셀에서는
 * 두 가중치의 곱만 누적한다. 점을 다른 격자로 양자화하거나 커널 반경을
 * 자르지 않으므로 밀도 값·백분위·등치면의 품질을 바꾸지 않는다.
 */
export function kdeGrid(
  center: LngLat,
  radiusM: number,
  cellM: number,
  points: readonly [number, number][],
): LocalGrid {
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError("invalid KDE radius");
  if (!Number.isFinite(cellM) || cellM <= 0) throw new RangeError("invalid KDE cell size");

  const [cx, cy] = toUtmk(center);
  const span = radiusM + cellM;
  const cols = Math.floor((2 * span) / cellM) + 1;
  const rows = cols;
  const x0 = cx - span;
  const y0 = cy - span;
  const values = new Float64Array(cols * rows);
  const twiceBandwidthSquared = 2 * KDE_BANDWIDTH_M ** 2;
  const normalizer = (1 / (2 * Math.PI * KDE_BANDWIDTH_M ** 2)) * 1e6;
  const xWeights = new Float64Array(points.length * cols);
  const yWeights = new Float64Array(points.length * rows);

  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const [px, py] = points[pointIndex];
    const xOffset = pointIndex * cols;
    const yOffset = pointIndex * rows;
    for (let col = 0; col < cols; col += 1) {
      const dx = x0 + col * cellM - px;
      xWeights[xOffset + col] = Math.exp(-(dx * dx) / twiceBandwidthSquared);
    }
    for (let row = 0; row < rows; row += 1) {
      const dy = y0 + row * cellM - py;
      yWeights[yOffset + row] = Math.exp(-(dy * dy) / twiceBandwidthSquared);
    }
  }

  // 누적 순서는 점 입력 순서와 동일하다. 기존 reduce의 덧셈 순서를 유지해
  // 부동소수점 차이를 최소화하고, 마지막에만 동/㎢ 단위와 0 임계값을 적용한다.
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const xOffset = pointIndex * cols;
    const yOffset = pointIndex * rows;
    for (let row = 0; row < rows; row += 1) {
      const rowOffset = row * cols;
      const yWeight = yWeights[yOffset + row] * normalizer;
      for (let col = 0; col < cols; col += 1) {
        values[rowOffset + col] += xWeights[xOffset + col] * yWeight;
      }
    }
  }

  for (let index = 0; index < values.length; index += 1) {
    if (values[index] < KDE_ZERO_THRESHOLD) values[index] = 0;
  }
  return { cx, cy, cellM, cols, rows, x0, y0, values };
}

const NODATA_OFFSET = 2_000_000;
const NODATA_LOW_OFFSET = 3_000_000;
const CELL_EPSILON = 1e-9;
type XY = [number, number];
type BandGeometry = { type: "Polygon"; coordinates: number[][][] };

function finiteValues(g: LocalGrid): number[] {
  const values: number[] = [];
  for (const value of g.values) if (Number.isFinite(value)) values.push(value);
  return values;
}

function turfGrid(g: LocalGrid, missingValue: number): FeatureCollection<Point> {
  const points: Feature<Point>[] = [];
  for (let row = 0; row < g.rows; row += 1) {
    for (let col = 0; col < g.cols; col += 1) {
      const value = g.values[row * g.cols + col];
      points.push(point([g.x0 + col * g.cellM, g.y0 + row * g.cellM], { elevation: Number.isFinite(value) ? value : missingValue }));
    }
  }
  return featureCollection(points);
}

function bandIndex(value: number, breaks: readonly number[]): number {
  for (let index = 0; index < breaks.length; index += 1) if (value < breaks[index]) return index;
  return breaks.length;
}

function appendBandGeometry(
  center: LngLat,
  radiusM: number,
  geometry: BandGeometry,
  layer: string,
  id: number,
  areaM2: { value: number },
  polygons: PolygonCandidate[],
  collectedParts: number[][][][],
): number {
  const clipped = areaInCircle(center, radiusM, geometry);
  if (!clipped || clipped.areaM2 <= 0) return id;
  areaM2.value += clipped.areaM2;
  collectedParts.push(...clipped.parts);
  for (const rings of clipped.parts) {
    const area = polygonArea(rings);
    if (area <= 0) continue;
    const candidate = polygonCandidate(id++, layer, rings, area, null, { name: null, sublabel: null, labelPriority: 0 });
    if (candidate) polygons.push(candidate);
  }
  return id;
}

function circleRing(center: LngLat, radiusM: number): XY[] {
  const [cx, cy] = toUtmk(center);
  const segmentCount = 96;
  const correctedRadius = radiusM * Math.sqrt((2 * Math.PI) / (segmentCount * Math.sin((2 * Math.PI) / segmentCount)));
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = (2 * Math.PI * (index % segmentCount)) / segmentCount;
    return [cx + correctedRadius * Math.cos(angle), cy + correctedRadius * Math.sin(angle)];
  });
}

/** 등치면이 격자 외곽에서 끊길 때 원과 격자 범위에서 미방출 영역을 복구한다. */
function uncoveredCircleParts(center: LngLat, radiusM: number, g: LocalGrid, bandParts: number[][][][]): number[][][][] {
  const halfCell = g.cellM / 2;
  const xMin = g.x0 - halfCell;
  const yMin = g.y0 - halfCell;
  const xMax = g.x0 + (g.cols - 1) * g.cellM + halfCell;
  const yMax = g.y0 + (g.rows - 1) * g.cellM + halfCell;
  const gridRing: XY[] = [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax], [xMin, yMin]];
  let remaining: Feature<Polygon | MultiPolygon> | null;
  try {
    remaining = intersect(featureCollection<Polygon | MultiPolygon>([
      polygon([circleRing(center, radiusM)]),
      polygon([gridRing]),
    ]));
  } catch {
    return [];
  }
  for (const rings of bandParts) {
    if (!remaining) break;
    try {
      remaining = difference(featureCollection<Polygon | MultiPolygon>([remaining, polygon(rings)]));
    } catch {
      return [];
    }
  }
  if (!remaining) return [];
  return remaining.geometry.type === "Polygon" ? [remaining.geometry.coordinates] : remaining.geometry.coordinates;
}

function appendPolygonParts(layer: string, id: number, parts: number[][][][], polygons: PolygonCandidate[]): number {
  for (const rings of parts) {
    const area = polygonArea(rings);
    if (area <= 0) continue;
    const candidate = polygonCandidate(id++, layer, rings, area, null, { name: null, sublabel: null, labelPriority: 0 });
    if (candidate) polygons.push(candidate);
  }
  return id;
}

function cross(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** CCW 볼록 다각형 반평면으로 주제를 자른다. D16 셀-원 경계 셀에만 사용한다. */
function clipConvex(subject: XY[], a: XY, b: XY): XY[] {
  if (subject.length === 0) return [];
  const out: XY[] = [];
  const inside = (p: XY) => cross(a, b, p) >= -CELL_EPSILON;
  const intersection = (from: XY, to: XY): XY => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) <= CELL_EPSILON) return [from[0], from[1]];
    const t = ((a[0] - from[0]) * ey - (a[1] - from[1]) * ex) / denominator;
    return [from[0] + t * dx, from[1] + t * dy];
  };
  let previous = subject[subject.length - 1];
  let previousInside = inside(previous);
  for (const current of subject) {
    const currentInside = inside(current);
    if (currentInside !== previousInside) out.push(intersection(previous, current));
    if (currentInside) out.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return out;
}

function ringArea(ring: readonly XY[]): number {
  let sum = 0;
  for (let index = 1; index < ring.length; index += 1) sum += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
  return Math.abs(sum) / 2;
}

/**
 * 격자 셀과 96각형 분석 원의 교차 면적. 내부 셀은 사각형 면적을 바로
 * 반환하고, 원주에 닿는 셀만 볼록 클리핑한다(셀마다 Turf 교집합을 만들지 않는다).
 */
function cellAreaInCircle(cx: number, cy: number, radiusM: number, x: number, y: number, halfCell: number, circle: XY[]): number {
  const radiusSquared = radiusM ** 2;
  const corners: XY[] = [[x - halfCell, y - halfCell], [x + halfCell, y - halfCell], [x + halfCell, y + halfCell], [x - halfCell, y + halfCell]];
  if (corners.every(([px, py]) => (px - cx) ** 2 + (py - cy) ** 2 <= radiusSquared)) return (halfCell * 2) ** 2;
  const nearX = Math.max(Math.abs(x - cx) - halfCell, 0);
  const nearY = Math.max(Math.abs(y - cy) - halfCell, 0);
  if (nearX ** 2 + nearY ** 2 > radiusSquared) return 0;

  const subject: XY[] = [
    [x - halfCell, y - halfCell], [x + halfCell, y - halfCell],
    [x + halfCell, y + halfCell], [x - halfCell, y + halfCell],
  ];
  const bbox: XY[] = [[cx - radiusM, cy - radiusM], [cx + radiusM, cy - radiusM], [cx + radiusM, cy + radiusM], [cx - radiusM, cy + radiusM]];
  let clipped = subject;
  for (let index = 0; index < bbox.length && clipped.length > 0; index += 1) clipped = clipConvex(clipped, bbox[index], bbox[(index + 1) % bbox.length]);
  for (let index = 0; index < circle.length - 1 && clipped.length > 0; index += 1) clipped = clipConvex(clipped, circle[index], circle[index + 1]);
  return clipped.length >= 3 ? ringArea([...clipped, clipped[0]]) : 0;
}

function validateBandInputs(breaks: readonly number[], layers: readonly string[]): void {
  if (breaks.length === 0 || breaks.some((value) => !Number.isFinite(value))) throw new RangeError("breaks must be finite and non-empty");
  for (let index = 1; index < breaks.length; index += 1) if (breaks[index] <= breaks[index - 1]) throw new RangeError("breaks must be strictly ascending");
  if (layers.length !== breaks.length + 1 || layers.some((layer) => typeof layer !== "string" || layer.length === 0)) throw new RangeError("layers must contain one label for each band");
}

/** D16 전용 등치면: isobands는 한 번만 만들고 원주 셀 면적은 수학적 클리핑으로 계산한다. */
export function kdeBandPolygons(
  center: LngLat,
  radiusM: number,
  g: LocalGrid,
  breaks: number[],
  layers: string[],
): { polygons: PolygonCandidate[]; areaM2: number[] } {
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError("invalid band radius");
  validateBandInputs(breaks, layers);
  const allFinite = finiteValues(g);
  const baseMin = Math.min(0, ...breaks, ...allFinite);
  const baseMax = Math.max(0, ...breaks, ...allFinite);
  const missingValue = baseMin - NODATA_OFFSET;
  const boundaries = [baseMin - NODATA_LOW_OFFSET, baseMin - 1, ...breaks, baseMax + 1];
  const contours = isobands(turfGrid(g, missingValue), boundaries, { zProperty: "elevation" });
  const polygons: PolygonCandidate[] = [];
  const bandCount = layers.length;
  const observedAreas = Array.from({ length: bandCount }, () => 0);
  const observedParts = Array.from({ length: bandCount }, () => [] as number[][][][]);
  let id = 1;

  contours.features.forEach((feature, turfIndex) => {
    const index = turfIndex - 1;
    if (index < 0 || index >= layers.length) return;
    for (const coordinates of feature.geometry.coordinates) {
      const holder = { value: 0 };
      id = appendBandGeometry(center, radiusM, { type: "Polygon", coordinates }, layers[index], id, holder, polygons, observedParts[index]);
      observedAreas[index] += holder.value;
    }
  });

  const [cx, cy] = toUtmk(center);
  const cellAreas = Array.from({ length: bandCount }, () => 0);
  let hasNoData = false;
  const circle = circleRing(center, radiusM);
  const halfCell = g.cellM / 2;
  for (let row = 0; row < g.rows; row += 1) {
    for (let col = 0; col < g.cols; col += 1) {
      const x = g.x0 + col * g.cellM;
      const y = g.y0 + row * g.cellM;
      const area = cellAreaInCircle(cx, cy, radiusM, x, y, halfCell, circle);
      if (area <= 0) continue;
      const value = g.values[row * g.cols + col];
      if (!Number.isFinite(value)) {
        hasNoData = true;
        continue;
      }
      cellAreas[bandIndex(value, breaks)] += area;
    }
  }

  const deficits = cellAreas.map((area, index) => area - observedAreas[index]);
  const targetIndex = deficits.reduce((best, deficit, index) => deficit > deficits[best] ? index : best, 0);
  if (deficits[targetIndex] > 1e-6 && !hasNoData) {
    const targetLayer = layers[targetIndex];
    for (let index = polygons.length - 1; index >= 0; index -= 1) if (polygons[index].p.layer === targetLayer) polygons.splice(index, 1);
    const emittedParts = observedParts.flatMap((parts, index) => index === targetIndex ? [] : parts);
    const uncovered = uncoveredCircleParts(center, radiusM, g, emittedParts);
    if (uncovered.length > 0) {
      appendPolygonParts(targetLayer, id, uncovered, polygons);
    } else {
      // 매우 드문 Boolean 실패 경로의 시각적 폴백. 정상 경로는 위의 한 번의
      // 원-격자 교차로 끝나며, 이 경로만 기존 정확 클리핑을 사용한다.
      const cellParts: number[][][][] = [];
      for (let row = 0; row < g.rows; row += 1) {
        for (let col = 0; col < g.cols; col += 1) {
          const value = g.values[row * g.cols + col];
          if (!Number.isFinite(value) || bandIndex(value, breaks) !== targetIndex) continue;
          const x = g.x0 + col * g.cellM;
          const y = g.y0 + row * g.cellM;
          const cell: BandGeometry = { type: "Polygon", coordinates: [[[x - halfCell, y - halfCell], [x + halfCell, y - halfCell], [x + halfCell, y + halfCell], [x - halfCell, y + halfCell], [x - halfCell, y - halfCell]]] };
          const clipped = areaInCircle(center, radiusM, cell);
          if (clipped && clipped.areaM2 > 0) cellParts.push(...clipped.parts);
        }
      }
      appendPolygonParts(targetLayer, id, cellParts, polygons);
    }
  }
  return { polygons, areaM2: cellAreas };
}

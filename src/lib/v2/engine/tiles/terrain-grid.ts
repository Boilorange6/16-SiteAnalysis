/** D17·D18와 이후 지형 타일이 공유하는 DEM 격자·경사·밴드 계산. */
import { difference, featureCollection, intersect, isobands, multiPolygon, point, polygon } from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import { toLngLat, toUtmk, type LngLat } from "../../crs";
import type { EngineContext } from "../context";
import { polygonCandidate, type LineCandidate, type PolygonCandidate } from "./common";
import { areaInCircle, polygonArea } from "./geo";
import { contourLines as rasterContourLines, type LocalGrid } from "./raster-grid";
import { demGridFor } from "./terrain-shared";

export interface TerrainGrid {
  readonly cx: number;
  readonly cy: number;
  readonly cellM: number;
  readonly cols: number;
  readonly rows: number;
  readonly x0: number;
  readonly y0: number;
  /** row-major, row 0 = 남쪽(y0), NaN = 결측 */
  readonly values: Float32Array;
  /** 원래 DEM의 Float64 표본. Float32 공유 격자를 유지하면서 경계값 반올림을 되돌린다. */
  readonly precisionValues?: Float64Array;
  /** D18의 기존 밴드 경계를 보존하는 중앙차분 분류값. 표시 밴드만 이 값을 사용한다. */
  readonly classificationValues?: Float64Array;
}

const EPSILON = 1e-9;
const NODATA_OFFSET = 2_000_000;
const NODATA_LOW_OFFSET = 3_000_000;

function assertGrid(g: TerrainGrid): void {
  if (![g.cx, g.cy, g.cellM, g.x0, g.y0].every(Number.isFinite) || g.cellM <= 0) throw new RangeError("invalid terrain grid geometry");
  if (!Number.isInteger(g.cols) || !Number.isInteger(g.rows) || g.cols < 2 || g.rows < 2 || g.values.length !== g.cols * g.rows) {
    throw new RangeError("invalid terrain grid shape");
  }
  if ((g.precisionValues && g.precisionValues.length !== g.values.length) || (g.classificationValues && g.classificationValues.length !== g.values.length)) {
    throw new RangeError("invalid terrain grid auxiliary values");
  }
}

function assertCenterAndRadius(center: LngLat, radiusM: number): void {
  if (center.length !== 2 || !center.every(Number.isFinite)) throw new RangeError("invalid terrain center");
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError("invalid terrain radius");
}

function gridPoint(g: TerrainGrid, col: number, row: number): [number, number] {
  return [g.x0 + col * g.cellM, g.y0 + row * g.cellM];
}

function insideRadius(g: TerrainGrid, col: number, row: number, radiusM: number): boolean {
  const [x, y] = gridPoint(g, col, row);
  return Math.hypot(x - g.cx, y - g.cy) <= radiusM + EPSILON;
}

function finiteValues(g: TerrainGrid): number[] {
  const values: number[] = [];
  for (const value of bandValues(g)) if (Number.isFinite(value)) values.push(value);
  return values;
}

function gridValues(g: TerrainGrid): Float32Array | Float64Array {
  return g.precisionValues ?? g.values;
}

function bandValues(g: TerrainGrid): Float32Array | Float64Array {
  return g.classificationValues ?? gridValues(g);
}

/** 한 분석 안에서 DEM 원시 표본은 한 번만 읽고 Float32 격자를 공유한다. */
export function terrainGridFor(ctx: EngineContext, cellM: number): TerrainGrid | null {
  if (!Number.isFinite(cellM) || cellM <= 0) throw new RangeError("cellM must be positive");
  return ctx.memo(`terrain:grid:f32:${cellM}`, () => {
    const sampled = demGridFor(ctx, cellM);
    if (!sampled) return null;
    const values = new Float32Array(sampled.values.length);
    values.set(sampled.values);
    return { ...sampled, values, precisionValues: sampled.values };
  });
}

/** D17의 중심 상대고를 Float32 격자에 적용한다. 결측은 그대로 보존한다. */
export function relativeTerrainGrid(grid: TerrainGrid, originZ: number): TerrainGrid {
  assertGrid(grid);
  if (!Number.isFinite(originZ)) throw new RangeError("originZ must be finite");
  const values = new Float32Array(grid.values.length);
  const precisionValues = grid.precisionValues ? new Float64Array(grid.values.length) : undefined;
  const sourceValues = gridValues(grid);
  for (let index = 0; index < values.length; index += 1) {
    const value = sourceValues[index];
    const relative = Number.isFinite(value) ? value - originZ : Number.NaN;
    values[index] = relative;
    if (precisionValues) precisionValues[index] = relative;
  }
  return { ...grid, values, precisionValues, classificationValues: undefined };
}

/** 반경 안 셀 중심 수와 그중 유효한 셀 중심 수. */
export function terrainGridStats(g: TerrainGrid, radiusM: number): { cells: number; valid: number } {
  assertGrid(g);
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError("invalid terrain radius");
  let cells = 0;
  let valid = 0;
  const sourceValues = gridValues(g);
  for (let row = 0; row < g.rows; row += 1) {
    for (let col = 0; col < g.cols; col += 1) {
      if (!insideRadius(g, col, row, radiusM)) continue;
      cells += 1;
      if (Number.isFinite(sourceValues[row * g.cols + col])) valid += 1;
    }
  }
  return { cells, valid };
}

/** 반경 안 유효값을 수집한다. D17 중앙값·D18 요약에 공통으로 쓴다. */
export function terrainValuesInCircle(g: TerrainGrid, radiusM: number): number[] {
  assertGrid(g);
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError("invalid terrain radius");
  const values: number[] = [];
  const sourceValues = gridValues(g);
  for (let row = 0; row < g.rows; row += 1) {
    for (let col = 0; col < g.cols; col += 1) {
      if (!insideRadius(g, col, row, radiusM)) continue;
      const value = sourceValues[row * g.cols + col];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

/**
 * separable Horn 3×3 slope. 먼저 행·열 중앙 미분을 구하고 [1,2,1]/4로
 * 직교 방향을 평활한다. 원래 D18의 바깥 패딩 복구와 결측 전파 규칙은
 * 유지해 분석 원 안의 유효 셀 판정이 달라지지 않게 한다.
 */
export function slopeGrid(dem: TerrainGrid): TerrainGrid {
  assertGrid(dem);
  const sourceValues = gridValues(dem);
  const horizontal = new Float64Array(sourceValues.length);
  const vertical = new Float64Array(sourceValues.length);
  horizontal.fill(Number.NaN);
  vertical.fill(Number.NaN);
  const halfCell = 2 * dem.cellM;

  for (let row = 0; row < dem.rows; row += 1) {
    const rowOffset = row * dem.cols;
    for (let col = 1; col < dem.cols - 1; col += 1) {
      const west = sourceValues[rowOffset + col - 1];
      const east = sourceValues[rowOffset + col + 1];
      if (Number.isFinite(west) && Number.isFinite(east)) horizontal[rowOffset + col] = (east - west) / halfCell;
    }
  }
  for (let row = 1; row < dem.rows - 1; row += 1) {
    const rowOffset = row * dem.cols;
    const southOffset = (row - 1) * dem.cols;
    const northOffset = (row + 1) * dem.cols;
    for (let col = 0; col < dem.cols; col += 1) {
      const south = sourceValues[southOffset + col];
      const north = sourceValues[northOffset + col];
      if (Number.isFinite(south) && Number.isFinite(north)) vertical[rowOffset + col] = (north - south) / halfCell;
    }
  }

  const values = new Float32Array(sourceValues.length);
  const precisionValues = new Float64Array(sourceValues.length);
  const classificationValues = new Float64Array(sourceValues.length);
  values.fill(Number.NaN);
  precisionValues.fill(Number.NaN);
  classificationValues.fill(Number.NaN);
  for (let row = 1; row < dem.rows - 1; row += 1) {
    const rowOffset = row * dem.cols;
    const southOffset = (row - 1) * dem.cols;
    const northOffset = (row + 1) * dem.cols;
    for (let col = 1; col < dem.cols - 1; col += 1) {
      const dxSouth = horizontal[southOffset + col];
      const dxMiddle = horizontal[rowOffset + col];
      const dxNorth = horizontal[northOffset + col];
      const dyWest = vertical[rowOffset + col - 1];
      const dyMiddle = vertical[rowOffset + col];
      const dyEast = vertical[rowOffset + col + 1];
      if (Number.isFinite(dxMiddle) && Number.isFinite(dyMiddle)) {
        classificationValues[rowOffset + col] = Math.atan(Math.hypot(dxMiddle, dyMiddle)) * (180 / Math.PI);
      }
      if (![dxSouth, dxMiddle, dxNorth, dyWest, dyMiddle, dyEast].every(Number.isFinite)) continue;
      const dzdx = (dxSouth + 2 * dxMiddle + dxNorth) / 4;
      const dzdy = (dyWest + 2 * dyMiddle + dyEast) / 4;
      const slope = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
      values[rowOffset + col] = slope;
      precisionValues[rowOffset + col] = slope;
    }
  }

  // localGrid has one cell of padding around the analysis circle. It is not a
  // reported cell, but retaining its nearest slope prevents the outer isoband
  // from becoming an artificial nodata fringe.
  for (const row of [0, dem.rows - 1]) {
    const sourceRow = row === 0 ? 1 : dem.rows - 2;
    const sourceOffset = sourceRow * dem.cols;
    const targetOffset = row * dem.cols;
    for (let col = 0; col < dem.cols; col += 1) {
      const sourceIndex = sourceOffset + Math.min(dem.cols - 2, Math.max(1, col));
      const candidate = values[sourceIndex];
      if (Number.isFinite(candidate)) {
        values[targetOffset + col] = candidate;
        precisionValues[targetOffset + col] = precisionValues[sourceIndex];
      }
      if (Number.isFinite(classificationValues[sourceIndex])) classificationValues[targetOffset + col] = classificationValues[sourceIndex];
    }
  }
  for (const col of [0, dem.cols - 1]) {
    const sourceCol = col === 0 ? 1 : dem.cols - 2;
    for (let row = 1; row < dem.rows - 1; row += 1) {
      const sourceIndex = row * dem.cols + sourceCol;
      const candidate = values[sourceIndex];
      if (Number.isFinite(candidate)) {
        values[row * dem.cols + col] = candidate;
        precisionValues[row * dem.cols + col] = precisionValues[sourceIndex];
      }
      if (Number.isFinite(classificationValues[sourceIndex])) classificationValues[row * dem.cols + col] = classificationValues[sourceIndex];
    }
  }
  return { ...dem, values, precisionValues, classificationValues };
}

/** D18 경사도도 한 분석 안에서 한 번만 계산한다. */
export function slopeGridFor(ctx: EngineContext, cellM: number): TerrainGrid | null {
  return ctx.memo(`terrain:slope:${cellM}`, () => {
    const dem = terrainGridFor(ctx, cellM);
    return dem ? slopeGrid(dem) : null;
  });
}

/** D18 공개 결과는 기존 중앙차분 밴드·요약을 유지하고 Horn 격자는 공유한다. */
export function terrainClassGrid(g: TerrainGrid): TerrainGrid {
  assertGrid(g);
  if (!g.classificationValues) return g;
  const values = new Float32Array(g.classificationValues.length);
  values.set(g.classificationValues);
  return { ...g, values, precisionValues: g.classificationValues, classificationValues: undefined };
}

type BandGeometry = { type: "Polygon"; coordinates: number[][][] };

function turfGrid(g: TerrainGrid, missingValue: number): FeatureCollection<Point> {
  const points: Feature<Point>[] = [];
  const sourceValues = bandValues(g);
  for (let row = 0; row < g.rows; row += 1) {
    for (let col = 0; col < g.cols; col += 1) {
      const value = sourceValues[row * g.cols + col];
      points.push(point(gridPoint(g, col, row), { elevation: Number.isFinite(value) ? value : missingValue }));
    }
  }
  return featureCollection(points);
}

function bandIndex(value: number, breaks: readonly number[]): number {
  for (let index = 0; index < breaks.length; index += 1) if (value < breaks[index]) return index;
  return breaks.length;
}

function validateBandInputs(breaks: readonly number[], layers: readonly string[], nodataLayer: string | null): void {
  if (breaks.length === 0 || breaks.some((value) => !Number.isFinite(value))) throw new RangeError("breaks must be finite and non-empty");
  for (let index = 1; index < breaks.length; index += 1) if (breaks[index] <= breaks[index - 1]) throw new RangeError("breaks must be strictly ascending");
  if (layers.length !== breaks.length + 1 || layers.some((layer) => typeof layer !== "string" || layer.length === 0)) throw new RangeError("layers must contain one label for each band");
  if (nodataLayer !== null && (typeof nodataLayer !== "string" || nodataLayer.length === 0)) throw new RangeError("invalid nodata layer");
}

/** 원 안에 완전히 들어온 isobands 면은 좌표·면적을 그대로 재사용한다. */
function bandGeometryInCircle(center: LngLat, radiusM: number, geometry: BandGeometry): { areaM2: number; parts: number[][][][] } | null {
  const [cx, cy] = toUtmk(center);
  const radiusSquared = radiusM ** 2;
  const allInside = geometry.coordinates.every((ring) => ring.every(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= radiusSquared));
  if (!allInside) return null;
  return { areaM2: geometry.coordinates.length > 0 ? polygonArea(geometry.coordinates) : 0, parts: [geometry.coordinates] };
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
  const originalArea = polygonArea(geometry.coordinates);
  const fast = originalArea > 10 ? bandGeometryInCircle(center, radiusM, geometry) : null;
  const clipped = fast ?? areaInCircle(center, radiusM, geometry);
  if (!clipped || clipped.areaM2 <= 0) return id;
  areaM2.value += clipped.areaM2;
  collectedParts.push(...clipped.parts);
  for (const rings of clipped.parts) {
    const area = polygonArea(rings);
    if (area <= 1e-6) continue;
    const candidate = polygonCandidate(id++, layer, rings, area);
    if (candidate) polygons.push(candidate);
  }
  return id;
}

function circleRing(center: LngLat, radiusM: number): [number, number][] {
  const [cx, cy] = toUtmk(center);
  const segmentCount = 96;
  const correctedRadius = radiusM * Math.sqrt((2 * Math.PI) / (segmentCount * Math.sin((2 * Math.PI) / segmentCount)));
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = (2 * Math.PI * (index % segmentCount)) / segmentCount;
    return [cx + correctedRadius * Math.cos(angle), cy + correctedRadius * Math.sin(angle)];
  });
}

/** 등치면이 격자 외곽에서 끊길 때 원과 격자 범위의 미방출 영역을 복구한다. */
function uncoveredCircleParts(center: LngLat, radiusM: number, g: TerrainGrid, bandParts: number[][][][]): number[][][][] {
  const halfCell = g.cellM / 2;
  const xMin = g.x0 - halfCell;
  const yMin = g.y0 - halfCell;
  const xMax = g.x0 + (g.cols - 1) * g.cellM + halfCell;
  const yMax = g.y0 + (g.rows - 1) * g.cellM + halfCell;
  const gridRing: [number, number][] = [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax], [xMin, yMin]];
  const circle = circleRing(center, radiusM);
  let remaining: Feature<Polygon | MultiPolygon> | null = circle.every(([x, y]) => x >= xMin && x <= xMax && y >= yMin && y <= yMax)
    ? polygon([circle])
    : null;
  try {
    if (!remaining) remaining = intersect(featureCollection<Polygon | MultiPolygon>([
      polygon([circle]),
      polygon([gridRing]),
    ]));
  } catch {
    return [];
  }
  if (remaining && bandParts.length > 0) {
    try {
      remaining = difference(featureCollection<Polygon | MultiPolygon>([remaining, multiPolygon(bandParts)]));
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
    if (area <= 1e-6) continue;
    const candidate = polygonCandidate(id++, layer, rings, area);
    if (candidate) polygons.push(candidate);
  }
  return id;
}

function cross(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** CCW 볼록 다각형 반평면으로 subject를 자른다. 원주 셀에만 사용한다. */
function clipConvex(subject: [number, number][], a: [number, number], b: [number, number]): [number, number][] {
  if (subject.length === 0) return [];
  const out: [number, number][] = [];
  const inside = (p: [number, number]) => cross(a, b, p) >= -EPSILON;
  const intersectionPoint = (from: [number, number], to: [number, number]): [number, number] => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) <= EPSILON) return [from[0], from[1]];
    const t = ((a[0] - from[0]) * ey - (a[1] - from[1]) * ex) / denominator;
    return [from[0] + t * dx, from[1] + t * dy];
  };
  let previous = subject[subject.length - 1];
  let previousInside = inside(previous);
  for (const current of subject) {
    const currentInside = inside(current);
    if (currentInside !== previousInside) out.push(intersectionPoint(previous, current));
    if (currentInside) out.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return out;
}

function ringArea(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let index = 1; index < ring.length; index += 1) sum += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
  return Math.abs(sum) / 2;
}

/** 격자 내부는 O(1), 원주 셀만 96각형 반평면 클리핑으로 면적을 구한다. */
function cellAreaInCircle(cx: number, cy: number, radiusM: number, x: number, y: number, halfCell: number, circle: [number, number][]): number {
  const radiusSquared = radiusM ** 2;
  const corners: [number, number][] = [
    [x - halfCell, y - halfCell], [x + halfCell, y - halfCell],
    [x + halfCell, y + halfCell], [x - halfCell, y + halfCell],
  ];
  if (corners.every(([px, py]) => (px - cx) ** 2 + (py - cy) ** 2 <= radiusSquared)) return (halfCell * 2) ** 2;
  const nearX = Math.max(Math.abs(x - cx) - halfCell, 0);
  const nearY = Math.max(Math.abs(y - cy) - halfCell, 0);
  if (nearX ** 2 + nearY ** 2 > radiusSquared) return 0;

  const bbox: [number, number][] = [[cx - radiusM, cy - radiusM], [cx + radiusM, cy - radiusM], [cx + radiusM, cy + radiusM], [cx - radiusM, cy + radiusM]];
  let clipped = corners;
  for (let index = 0; index < bbox.length && clipped.length > 0; index += 1) clipped = clipConvex(clipped, bbox[index], bbox[(index + 1) % bbox.length]);
  for (let index = 0; index < circle.length - 1 && clipped.length > 0; index += 1) clipped = clipConvex(clipped, circle[index], circle[index + 1]);
  return clipped.length >= 3 ? ringArea([...clipped, clipped[0]]) : 0;
}

/**
 * D17·D18 공통 등치면. isobands는 한 번만 실행하고, 셀별 Turf 교집합은
 * 수학적 원주 클리핑으로 바꾼다. 밴드 경계·복구 규칙은 raster-grid와 같다.
 */
export function terrainBandPolygons(
  center: LngLat,
  radiusM: number,
  g: TerrainGrid,
  breaks: number[],
  layers: string[],
  nodataLayer: string | null,
): { polygons: PolygonCandidate[]; areaM2: number[] } {
  assertCenterAndRadius(center, radiusM);
  assertGrid(g);
  validateBandInputs(breaks, layers, nodataLayer);

  const allFinite = finiteValues(g);
  const baseMin = Math.min(0, ...breaks, ...allFinite);
  const baseMax = Math.max(0, ...breaks, ...allFinite);
  const missingValue = baseMin - NODATA_OFFSET;
  const boundaries = [baseMin - NODATA_LOW_OFFSET, baseMin - 1, ...breaks, baseMax + 1];
  const contours = isobands(turfGrid(g, missingValue), boundaries, { zProperty: "elevation" });
  const bandCount = layers.length + (nodataLayer === null ? 0 : 1);
  const polygons: PolygonCandidate[] = [];
  const observedAreas = Array.from({ length: bandCount }, () => 0);
  const observedParts = Array.from({ length: bandCount }, () => [] as number[][][][]);
  let id = 1;
  const sourceValues = bandValues(g);

  contours.features.forEach((feature, turfIndex) => {
    const index = turfIndex - 1;
    if (index < 0) {
      if (nodataLayer === null) return;
      for (const coordinates of feature.geometry.coordinates) {
        const holder = { value: 0 };
        id = appendBandGeometry(center, radiusM, { type: "Polygon", coordinates }, nodataLayer, id, holder, polygons, observedParts[layers.length]);
        observedAreas[layers.length] += holder.value;
      }
      return;
    }
    if (index >= layers.length) return;
    for (const coordinates of feature.geometry.coordinates) {
      const holder = { value: 0 };
      id = appendBandGeometry(center, radiusM, { type: "Polygon", coordinates }, layers[index], id, holder, polygons, observedParts[index]);
      observedAreas[index] += holder.value;
    }
  });

  const [cx, cy] = toUtmk(center);
  const cellAreas = Array.from({ length: bandCount }, () => 0);
  const halfCell = g.cellM / 2;
  const circle = circleRing(center, radiusM);
  let hasNoData = false;
  for (let row = 0; row < g.rows; row += 1) {
    for (let col = 0; col < g.cols; col += 1) {
      const x = g.x0 + col * g.cellM;
      const y = g.y0 + row * g.cellM;
      const area = cellAreaInCircle(cx, cy, radiusM, x, y, halfCell, circle);
      if (area <= 0) continue;
      const value = sourceValues[row * g.cols + col];
      if (!Number.isFinite(value)) {
        hasNoData = true;
        if (nodataLayer !== null) cellAreas[layers.length] += area;
        continue;
      }
      cellAreas[bandIndex(value, breaks)] += area;
    }
  }

  const deficits = cellAreas.map((area, index) => area - observedAreas[index]);
  const targetIndex = deficits.reduce((best, deficit, index) => deficit > deficits[best] ? index : best, 0);
  if (deficits[targetIndex] > 1e-6 && (nodataLayer !== null || !hasNoData)) {
    const targetLayer = targetIndex === layers.length ? nodataLayer! : layers[targetIndex];
    for (let index = polygons.length - 1; index >= 0; index -= 1) if (polygons[index].p.layer === targetLayer) polygons.splice(index, 1);
    const emittedParts = observedParts.flatMap((parts, index) => index === targetIndex ? [] : parts);
    const uncovered = uncoveredCircleParts(center, radiusM, g, emittedParts);
    if (uncovered.length > 0) {
      appendPolygonParts(targetLayer, id, uncovered, polygons);
    } else {
      // Boolean 실패는 기존 raster-grid의 정확 클리핑 경로로만 보완한다.
      const cellParts: number[][][][] = [];
      for (let row = 0; row < g.rows; row += 1) {
        for (let col = 0; col < g.cols; col += 1) {
          const value = sourceValues[row * g.cols + col];
          const index = Number.isFinite(value) ? bandIndex(value, breaks) : layers.length;
          if (index !== targetIndex) continue;
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

/** contourLines는 이미 한 isolines 호출로 모든 레벨을 처리한다. Float32 격자를 그대로 공유한다. */
export function terrainContourLines(center: LngLat, radiusM: number, g: TerrainGrid, intervalM: number, layer: string): LineCandidate[] {
  assertCenterAndRadius(center, radiusM);
  assertGrid(g);
  const local: LocalGrid = { ...g, values: Float64Array.from(gridValues(g)) };
  return rasterContourLines(center, radiusM, local, intervalM, layer);
}

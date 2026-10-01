/** D15 가구 — 도로 중심선으로 폐합된 블록의 면적·반경 교차 구성. */
import { difference, featureCollection, lineIntersect, lineSplit, lineString, multiPoint, polygon, polygonize } from "@turf/turf";
import type { Geometry, Position } from "geojson";
import { toUtmk } from "../../crs";
import type { FeatureHit } from "../../data/features";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation } from "../context";
import { makeTile, missing, obs, polygonCandidate, type PolygonCandidate, type TileDraft } from "./common";
import { areaInCircle, polygonArea } from "./geo";
import { notProvided } from "./not-provided";

const ROAD_SOURCES = ["osm_roads"] as const;
const BLOCK_LAYERS = ["block_lt05", "block_05_1", "block_1_2", "block_2_5", "block_ge5", "block_open"] as const;

/** Q7: 자동차 도로만 사용하고, 읽기 범위를 분석 반경에서 500m 넓힌다. */
export const BLOCK_ROAD_FILTER: { includePedestrian: boolean; bufferM: number } = {
  includePedestrian: false,
  bufferM: 500,
};

const BLOCK_CLASSES = [
  { suffix: "lt05", layer: "block_lt05", label: "0~0.5ha", matches: (ha: number) => ha < 0.5 },
  { suffix: "05_1", layer: "block_05_1", label: "0.5~1ha", matches: (ha: number) => ha >= 0.5 && ha < 1 },
  { suffix: "1_2", layer: "block_1_2", label: "1~2ha", matches: (ha: number) => ha >= 1 && ha < 2 },
  { suffix: "2_5", layer: "block_2_5", label: "2~5ha", matches: (ha: number) => ha >= 2 && ha < 5 },
  { suffix: "ge5", layer: "block_ge5", label: "5ha 이상", matches: (ha: number) => ha >= 5 },
] as const;

type Bbox = [minX: number, minY: number, maxX: number, maxY: number];
type Segment = [number, number][];
type RoadLine = { id: number; feature: ReturnType<typeof lineString>; bbox: Bbox };
type Block = { id: number; rings: number[][][]; areaM2: number };
type MeasuredBlock = Block & { crossAreaM2: number; clipped: number[][][][] };

const EPS = 1e-7;
const NODE_BUCKET_M = 250;

function hierarchyOf(value: unknown): string {
  return typeof value === "string" ? value : "기타";
}

function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates as number[][]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as number[][][];
  return [];
}

function bboxOf(points: number[][]): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return [minX, minY, maxX, maxY];
}

function bboxOverlaps(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] + EPS && a[2] + EPS >= b[0] && a[1] <= b[3] + EPS && a[3] + EPS >= b[1];
}

function coordinateKey(point: number[]): string {
  return `${Math.round(point[0] * 1e6)},${Math.round(point[1] * 1e6)}`;
}

function uniquePoints(points: number[][]): number[][] {
  return [...new Map(points.map((point) => [coordinateKey(point), [point[0], point[1]]])).values()];
}

/** Liang–Barsky로 한 선분을 읽기 사각형에 잘라낸다. */
function clipSegment(a: number[], b: number[], bounds: Bbox): Segment | null {
  const [minX, minY, maxX, maxY] = bounds;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let from = 0;
  let to = 1;
  const tests: Array<[number, number]> = [
    [-dx, a[0] - minX],
    [dx, maxX - a[0]],
    [-dy, a[1] - minY],
    [dy, maxY - a[1]],
  ];
  for (const [p, q] of tests) {
    if (Math.abs(p) <= EPS) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) from = Math.max(from, t);
    else to = Math.min(to, t);
    if (from > to + EPS) return null;
  }
  const start: [number, number] = [a[0] + from * dx, a[1] + from * dy];
  const end: [number, number] = [a[0] + to * dx, a[1] + to * dy];
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= EPS) return null;
  return [start, end];
}

function roadLines(hits: FeatureHit[], bounds: Bbox): RoadLine[] {
  const lines: RoadLine[] = [];
  let id = 1;
  for (const hit of hits) {
    if (!BLOCK_ROAD_FILTER.includePedestrian && hierarchyOf(hit.properties.hierarchy) === "보행·자전거") continue;
    for (const part of lineParts(hit.geometry)) {
      for (let i = 1; i < part.length; i++) {
        const clipped = clipSegment(part[i - 1], part[i], bounds);
        if (!clipped) continue;
        const feature = lineString(clipped as Position[]);
        lines.push({ id: hit.featureId * 100000 + id++, feature, bbox: bboxOf(clipped) });
      }
    }
  }
  return lines;
}

function pointOnSegment(point: number[], a: number[], b: number[]): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length <= EPS) return Math.hypot(point[0] - a[0], point[1] - a[1]) <= 1e-5;
  const distance = Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length;
  if (distance > 1e-5) return false;
  return (point[0] - a[0]) * (point[0] - b[0]) + (point[1] - a[1]) * (point[1] - b[1]) <= 1e-5;
}

function lineEndpoints(line: RoadLine): number[][] {
  const coordinates = line.feature.geometry.coordinates as number[][];
  return [coordinates[0], coordinates[coordinates.length - 1]];
}

function snapToSegment(point: number[], a: number[], b: number[]): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 <= EPS ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return [a[0] + t * dx, a[1] + t * dy];
}

function splitParameters(points: number[][], a: number[], b: number[]): number[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const values = [0, 1, ...points.map((point) =>
    length2 <= EPS ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)))];
  values.sort((x, y) => x - y);
  return values.filter((value, index) => index === 0 || value - values[index - 1] > 1e-9);
}

function manualLineSplit(a: number[], b: number[], points: number[][]): Array<ReturnType<typeof lineString>> {
  const parameters = splitParameters(points, a, b);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return parameters.slice(1).map((to, index) => {
    const from = parameters[index];
    return lineString([
      [a[0] + from * dx, a[1] + from * dy],
      [a[0] + to * dx, a[1] + to * dy],
    ] as Position[]);
  });
}

/** 격자 버킷으로 후보를 줄인 뒤, 겹치는 bbox 쌍만 Turf 교차를 호출한다. */
function candidatePairs(lines: RoadLine[], bounds: Bbox): Array<[number, number]> {
  const buckets = new Map<string, number[]>();
  const [minX, minY] = bounds;
  lines.forEach((line, index) => {
    const x0 = Math.floor((line.bbox[0] - minX) / NODE_BUCKET_M);
    const x1 = Math.floor((line.bbox[2] - minX) / NODE_BUCKET_M);
    const y0 = Math.floor((line.bbox[1] - minY) / NODE_BUCKET_M);
    const y1 = Math.floor((line.bbox[3] - minY) / NODE_BUCKET_M);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        const list = buckets.get(key) ?? [];
        list.push(index);
        buckets.set(key, list);
      }
    }
  });
  const pairs = new Set<string>();
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = Math.min(list[i], list[j]);
        const b = Math.max(list[i], list[j]);
        if (a !== b && bboxOverlaps(lines[a].bbox, lines[b].bbox)) pairs.add(`${a}:${b}`);
      }
    }
  }
  return [...pairs]
    .map((key) => key.split(":").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Turf polygonize의 전제인 끝점 노드 그래프를 만든다. */
function nodeRoadLines(lines: RoadLine[], bounds: Bbox): Array<ReturnType<typeof lineString>> {
  const splitPoints = lines.map(() => [] as number[][]);
  const pairs = candidatePairs(lines, bounds);
  for (const [i, j] of pairs) {
    const a = lines[i];
    const b = lines[j];
    const aEndpoints = lineEndpoints(a);
    const bEndpoints = lineEndpoints(b);
    const intersections = lineIntersect(a.feature, b.feature).features.map((point) => point.geometry.coordinates as number[]);
    const extraA = aEndpoints.filter((point) => pointOnSegment(point, bEndpoints[0], bEndpoints[1]));
    const extraB = bEndpoints.filter((point) => pointOnSegment(point, aEndpoints[0], aEndpoints[1]));
    splitPoints[i].push(...intersections, ...extraA, ...extraB);
    splitPoints[j].push(...intersections, ...extraA, ...extraB);
  }

  const result: Array<ReturnType<typeof lineString>> = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const [start, end] = lineEndpoints(lines[i]);
    const points = uniquePoints(splitPoints[i].map((point) => snapToSegment(point, start, end)));
    const [originX, originY] = bounds;
    const sourceCoordinates = lines[i].feature.geometry.coordinates as number[][];
    const localLine = lineString(sourceCoordinates.map(([x, y]) => [x - originX, y - originY]) as Position[]);
    const localPoints = points.map(([x, y]) => [x - originX, y - originY] as Position);
    const turfSplit = localPoints.length > 0 ? lineSplit(localLine, multiPoint(localPoints)).features : [localLine];
    const expected = splitParameters(points, start, end).length - 1;
    const split = turfSplit.length === expected
      ? turfSplit.map((piece) => lineString((piece.geometry.coordinates as number[][]).map(([x, y]) => [x + originX, y + originY]) as Position[]))
      : manualLineSplit(start, end, points);
    for (const piece of split) {
      const coordinates = piece.geometry.coordinates as number[][];
      if (coordinates.length < 2) continue;
      const a = coordinates[0];
      const b = coordinates[coordinates.length - 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= EPS) continue;
      const canonical = (point: number[]): [number, number] => [Math.round(point[0] * 1e6) / 1e6, Math.round(point[1] * 1e6) / 1e6];
      const normalized = coordinates.map(canonical);
      const forward = coordinateKey(normalized[0]) <= coordinateKey(normalized[normalized.length - 1])
        ? [normalized[0], normalized[normalized.length - 1]]
        : [normalized[normalized.length - 1], normalized[0]];
      const key = `${coordinateKey(forward[0])}:${coordinateKey(forward[1])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(lineString(normalized as Position[]));
    }
  }
  return result;
}

function touchesBoundary(rings: number[][][], bounds: Bbox): boolean {
  const [minX, minY, maxX, maxY] = bounds;
  return rings.some((ring) => ring.some(([x, y]) =>
    Math.abs(x - minX) <= 1e-5 || Math.abs(x - maxX) <= 1e-5 || Math.abs(y - minY) <= 1e-5 || Math.abs(y - maxY) <= 1e-5));
}

function closedBlocks(lines: RoadLine[], bounds: Bbox): Block[] {
  if (lines.length === 0) return [];
  const noded = nodeRoadLines(lines, bounds);
  if (noded.length === 0) return [];
  let polygons: ReturnType<typeof polygonize>;
  try {
    polygons = polygonize(featureCollection(noded));
  } catch {
    return [];
  }
  const blocks: Block[] = [];
  for (const [index, feature] of polygons.features.entries()) {
    const rings = feature.geometry.coordinates as number[][][];
    const areaM2 = polygonArea(rings);
    if (areaM2 <= 1e-4 || touchesBoundary(rings, bounds)) continue;
    blocks.push({ id: index + 1, rings, areaM2 });
  }
  return blocks;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

function framePolygon(bounds: Bbox) {
  const [minX, minY, maxX, maxY] = bounds;
  const ring: Position[] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
  return polygon([ring]);
}

/** 읽기 사각형에서 폐합 블록을 뺀 잔여 면은 읽기 경계·외곽을 block_open으로 표시한다. */
function openGeometry(bounds: Bbox, blocks: Block[]): Geometry {
  const frame = framePolygon(bounds);
  if (blocks.length === 0) return frame.geometry;
  try {
    const result = difference(featureCollection([
      frame,
      ...blocks.map((block) => polygon(block.rings as Position[][])),
    ]));
    return result?.geometry ?? frame.geometry;
  } catch {
    return frame.geometry;
  }
}

function openCandidates(ctx: EngineContext, bounds: Bbox, blocks: Block[]): PolygonCandidate[] {
  const measured = areaInCircle(ctx.input.center, ctx.input.radiusM, openGeometry(bounds, blocks));
  if (!measured || measured.areaM2 <= 1e-4) return [];
  return measured.parts.flatMap((rings, index) => {
    const candidate = polygonCandidate(-index - 1, "block_open", rings, polygonArea(rings));
    return candidate ? [candidate] : [];
  });
}

function measureBlocks(ctx: EngineContext, blocks: Block[]): { blocks: MeasuredBlock[]; failed: number } {
  const measured: MeasuredBlock[] = [];
  let failed = 0;
  for (const block of blocks) {
    const result = areaInCircle(ctx.input.center, ctx.input.radiusM, { type: "Polygon", coordinates: block.rings });
    if (!result) {
      failed++;
      continue;
    }
    if (result.areaM2 <= 1e-4) continue;
    measured.push({ ...block, crossAreaM2: result.areaM2, clipped: result.parts });
  }
  return { blocks: measured, failed };
}

export function d15(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ROAD_SOURCES);
  if (sources.length === 0) return notProvided(ctx, "D15", "도로(OSM) 미적재 — 원천 확보 후 제공");

  const readRadiusM = ctx.input.radiusM + BLOCK_ROAD_FILTER.bufferM;
  const [cx, cy] = toUtmk(ctx.input.center);
  const bounds: Bbox = [cx - readRadiusM, cy - readRadiusM, cx + readRadiusM, cy + readRadiusM];
  const roads = roadLines(ctx.hits("reference", ["road"], readRadiusM), bounds);
  const { blocks, failed } = measureBlocks(ctx, closedBlocks(roads, bounds));
  const circleAreaM2 = Math.PI * ctx.input.radiusM ** 2;
  const circleAreaRounded = Math.round(circleAreaM2);
  const closedAreaM2 = blocks.reduce((sum, block) => sum + block.crossAreaM2, 0);
  const openAreaM2 = Math.max(0, circleAreaM2 - closedAreaM2);
  const counts = BLOCK_CLASSES.map(() => 0);
  const crossAreas = BLOCK_CLASSES.map(() => 0);
  const originalAreasHa = blocks.map((block) => block.areaM2 / 10000);
  for (const block of blocks) {
    const classIndex = BLOCK_CLASSES.findIndex((item) => item.matches(block.areaM2 / 10000));
    if (classIndex < 0) continue;
    counts[classIndex]++;
    crossAreas[classIndex] += block.crossAreaM2;
  }

  const metrics: TileDraft["metrics"] = [
    obs("blocks", "반경과 교차하는 폐합 블록", blocks.length, "개", "d15-blocks@1:반경과 실제 교차하는 폐합 도로 블록 수", blocks.length, null),
    obs("fill_closed_pct", "폐합 블록 면적 채움률", pct(closedAreaM2, circleAreaM2), "%", "d15-fill-closed@1:폐합 블록의 반경 교차 면적÷π·r²", Math.round(closedAreaM2), circleAreaRounded),
    median(originalAreasHa) === null
      ? missing("median_block_ha", "폐합 블록 원래 면적 중앙값", "ha", "d15-median-area@1:반경과 교차하는 폐합 블록의 원래 도형 면적 중앙값")
      : obs("median_block_ha", "폐합 블록 원래 면적 중앙값", median(originalAreasHa)!, "ha", "d15-median-area@1:반경과 교차하는 폐합 블록의 원래 도형 면적 중앙값"),
  ];
  for (let i = 0; i < BLOCK_CLASSES.length; i++) {
    const item = BLOCK_CLASSES[i];
    metrics.push(
      blocks.length === 0
        ? missing(`share_count_${item.suffix}`, `${item.label} (블록 수)`, "%", "d15-share-count@1:원래 블록 면적 구간별 블록 수÷반경과 교차하는 폐합 블록 수")
        : obs(`share_count_${item.suffix}`, `${item.label} (블록 수)`, pct(counts[i], blocks.length), "%", "d15-share-count@1:원래 블록 면적 구간별 블록 수÷반경과 교차하는 폐합 블록 수", counts[i], blocks.length),
    );
    metrics.push(obs(`share_area_${item.suffix}`, `${item.label} (면적)`, pct(crossAreas[i], circleAreaM2), "%", "d15-share-area@1:원래 블록 면적 구간별 반경 교차 면적÷π·r²", Math.round(crossAreas[i]), circleAreaRounded));
  }
  metrics.push(obs("share_open_pct", "미폐합·읽기 경계 잔여 면적", pct(openAreaM2, circleAreaM2), "%", "d15-share-open@1:폐합 블록으로 덮이지 않은 반경 면적÷π·r²", Math.round(openAreaM2), circleAreaRounded));

  const coverage = ctx.coverage("reference", ROAD_SOURCES);
  const limitations: Limitation[] = [
    { kind: "partial", note: "OSM 중심선 기준 폐합 — 도로 폭·사유 통로 미반영, 보행로 제외" },
    { kind: "unknown", note: "폐합 블록 면적은 EPSG:5179 평면 도형 계산값이며 실제 대지·도로 폭·필지 경계를 뜻하지 않습니다." },
    { kind: "unknown", note: "© OpenStreetMap contributors · ODbL 1.0" },
    ...(failed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 교차 면적을 계산하지 못한 ${failed}개 블록은 면적 구성에서 제외했습니다.` }] : []),
    ...coverage,
  ];
  const sentence = blocks.length === 0
    ? `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안 폐합 블록이 확인되지 않음 → 도로망 공백 또는 미폐합 면을 구분할 수 없음 → 최신 OSM 도로망과 현장·공식 도면 확인 필요`
    : `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안 폐합 블록 ${blocks.length}개와 원래 면적 구간을 확인 → 도로 중심선으로 만든 가구 분포와 폐합 면적을 표시 → 도로 연결·사유 통로·실제 필지 경계는 최신 OSM과 공식 도면 확인 필요`;

  return makeTile(ctx, {
    code: "D15",
    type: "diagram",
    status: limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete",
    metrics,
    judgment: { ruleId: "D15-block@1", basisMetricIds: ["blocks", "fill_closed_pct"], sentence, level: null, criteria: null },
    sources,
    layers: [...BLOCK_LAYERS],
    polygons: [
      ...blocks.flatMap((block) => {
        const classIndex = BLOCK_CLASSES.findIndex((item) => item.matches(block.areaM2 / 10000));
        const layer = classIndex >= 0 ? BLOCK_CLASSES[classIndex].layer : "block_open";
        return block.clipped.flatMap((rings) => {
          const candidate = polygonCandidate(block.id, layer, rings, polygonArea(rings));
          return candidate ? [candidate] : [];
        });
      }),
      ...openCandidates(ctx, bounds, blocks),
    ],
    limitations,
  });
}

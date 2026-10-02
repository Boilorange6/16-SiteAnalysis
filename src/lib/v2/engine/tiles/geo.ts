/** 선형 지물 보조: 중심점(WGS84)에서 EPSG:5179 선형까지의 직선거리, 원 안 구간 표본점. */
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import { bboxClip, featureCollection, intersect, multiPolygon, polygon } from "@turf/turf";
import { toLngLat, toUtmk, type LngLat } from "../../crs";
import type { MapCandidate } from "./common";
import { maxOf, minOf } from "../../extent";

function lineParts(g: Geometry): number[][][] {
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}

const segDist = (px: number, py: number, a: number[], b: number[]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
};

export function distanceToLineM(center: LngLat, g: Geometry): number | null {
  const [cx, cy] = toUtmk(center);
  let best: number | null = null;
  for (const part of lineParts(g)) {
    for (let i = 1; i < part.length; i++) {
      const d = segDist(cx, cy, part[i - 1], part[i]);
      if (best === null || d < best) best = d;
    }
  }
  return best;
}

/**
 * 선을 stepM 간격 점으로 표본화하되 반경 원 안의 점만 남긴다(지도 밖 구간을 그리지 않는다).
 * ponytail: 지도 계약이 점뿐이라 선을 점열로 보낸다. 선 도형 필드가 생기면 그대로 보낸다.
 */
export function sampleLine(center: LngLat, g: Geometry, radiusM: number, stepM: number, id: number, layer: string): MapCandidate[] {
  const [cx, cy] = toUtmk(center);
  const out: MapCandidate[] = [];
  for (const part of lineParts(g)) {
    for (let i = 1; i < part.length; i++) {
      const a = part[i - 1];
      const b = part[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / stepM));
      for (let k = 0; k < n; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / n;
        const y = a[1] + ((b[1] - a[1]) * k) / n;
        if (Math.hypot(x - cx, y - cy) > radiusM) continue;
        const [lng, lat] = toLngLat([x, y]);
        out.push({ id, f: { layer, lng: Math.round(lng * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6 } });
      }
    }
  }
  return out;
}

type SegmentInterval = [number, number];

type AreaInCircleResult = { areaM2: number; parts: number[][][][]; clipped: boolean };
type AreaInCircleCache = {
  key: string;
  result: AreaInCircleResult | null;
  variants?: Map<string, AreaInCircleResult | null>;
};
const areaInCircleCache = new WeakMap<Geometry, AreaInCircleCache>();

function circleCacheKey(center: LngLat, radiusM: number): string {
  return `${center[0]}:${center[1]}:${radiusM}`;
}

/** EPSG:5179 선분에서 원 내부에 해당하는 매개변수 구간을 구한다. */
function segmentIntervalInCircle(a: number[], b: number[], cx: number, cy: number, radiusM: number): SegmentInterval | null {
  if (a.length < 2 || b.length < 2 || !Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) return null;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const qa = dx * dx + dy * dy;
  if (qa === 0) return null;
  const fx = a[0] - cx;
  const fy = a[1] - cy;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - radiusM * radiusM;
  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return qc <= 0 ? [0, 1] : null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const enter = (-qb - root) / (2 * qa);
  const leave = (-qb + root) / (2 * qa);
  const from = Math.max(0, enter);
  const to = Math.min(1, leave);
  return to - from > 1e-12 ? [from, to] : null;
}

/**
 * EPSG:5179 선형을 반경 원 안의 연속 선 경로로 잘라낸다.
 * 각 반환 경로는 원 안에 있는 부분 하나이며, 원 경계의 교점과 원래 꼭짓점을 보존한다.
 */
export function clipLineToCircle(center: LngLat, radiusM: number, g: Geometry): number[][][] {
  if (!center.every(Number.isFinite) || !Number.isFinite(radiusM) || radiusM <= 0) return [];
  const [cx, cy] = toUtmk(center);
  const out: number[][][] = [];
  const append = (path: number[][], point: number[]) => {
    const last = path.at(-1);
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-7) path.push([point[0], point[1]]);
  };
  const flush = (path: number[][]) => {
    if (path.length >= 2) out.push(path.slice());
    path.length = 0;
  };

  for (const part of lineParts(g)) {
    let path: number[][] = [];
    for (let i = 1; i < part.length; i++) {
      const a = part[i - 1];
      const b = part[i];
      const interval = segmentIntervalInCircle(a, b, cx, cy, radiusM);
      if (interval === null) {
        flush(path);
        path = [];
        continue;
      }
      const [from, to] = interval;
      const start = [a[0] + (b[0] - a[0]) * from, a[1] + (b[1] - a[1]) * from];
      const end = [a[0] + (b[0] - a[0]) * to, a[1] + (b[1] - a[1]) * to];
      if (path.length > 0 && Math.hypot(start[0] - path.at(-1)![0], start[1] - path.at(-1)![1]) > 1e-7) {
        flush(path);
        path = [];
      }
      append(path, start);
      append(path, end);
    }
    flush(path);
  }
  return out;
}

/** EPSG:5179 선 경로의 평면 길이. 반경 절단 후 선 후보의 상한 정렬에 쓴다. */
export function linePathLength(path: readonly number[][]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return total;
}

/** EPSG:5179 선분과 반경 원이 교차하는 실제 길이. 표본점 개수로 근사하지 않는다. */
export function lineLengthInCircle(center: LngLat, radiusM: number, g: Geometry): number {
  if (!Number.isFinite(radiusM) || radiusM < 0) return 0;
  const [cx, cy] = toUtmk(center);
  let total = 0;
  for (const part of lineParts(g)) {
    for (let i = 1; i < part.length; i++) {
      const [ax, ay] = part[i - 1];
      const [bx, by] = part[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const fx = ax - cx;
      const fy = ay - cy;
      const qa = dx * dx + dy * dy;
      const qb = 2 * (fx * dx + fy * dy);
      const qc = fx * fx + fy * fy - radiusM * radiusM;
      const discriminant = qb * qb - 4 * qa * qc;
      const cuts = [0, 1];
      if (discriminant >= 0) {
        const root = Math.sqrt(Math.max(0, discriminant));
        cuts.push((-qb - root) / (2 * qa), (-qb + root) / (2 * qa));
      }
      cuts.sort((a, b) => a - b);
      for (let j = 1; j < cuts.length; j++) {
        const from = Math.max(0, cuts[j - 1]);
        const to = Math.min(1, cuts[j]);
        if (to <= from) continue;
        const t = (from + to) / 2;
        const x = fx + t * dx;
        const y = fy + t * dy;
        if (x * x + y * y <= radiusM * radiusM + 1e-7) total += (to - from) * len;
      }
    }
  }
  return total;
}

// ── 면(폴리곤) 보조: 지도 전송용 단순화와 반경 원 절단 ──

/** 닫힌 고리를 Douglas–Peucker로 maxVertices(닫는 점 포함) 이하로 줄인다. 순수 함수, 좌표 단위 무관. */
export function simplifyRing(ring: number[][], maxVertices = 200): number[][] {
  if (ring.length <= maxVertices) return ring;
  const keepAt = (tol: number): number[] => {
    const keep = new Uint8Array(ring.length);
    keep[0] = 1;
    keep[ring.length - 1] = 1;
    const stack: Array<[number, number]> = [[0, ring.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let far = -1;
      let farD = tol;
      for (let i = a + 1; i < b; i++) {
        const d = segDist(ring[i][0], ring[i][1], ring[a], ring[b]);
        if (d > farD) { farD = d; far = i; }
      }
      if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    return Array.from(keep.keys()).filter((i) => keep[i]);
  };
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  let lo = 0;
  let hi = Math.hypot(maxOf(xs) - minOf(xs), maxOf(ys) - minOf(ys));
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (keepAt(mid).length <= maxVertices) hi = mid;
    else lo = mid;
  }
  const idx = keepAt(hi);
  if (idx.length >= 4) return idx.map((i) => ring[i]);
  // 너무 단순해져 면이 사라지는 경우: 균등 표본
  const out = Array.from({ length: maxVertices - 1 }, (_, i) => ring[Math.floor((i * (ring.length - 1)) / (maxVertices - 1))]);
  return [...out, out[0]];
}

/** Polygon/MultiPolygon → 폴리곤 목록(각각 [바깥, 구멍…]). 다른 도형은 빈 배열. */
export function polygonParts(g: Geometry): number[][][][] {
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  return [];
}

const ringArea = (r: number[][]) => {
  let s = 0;
  for (let i = 1; i < r.length; i++) s += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1];
  return Math.abs(s) / 2;
};
/** 평면(미터) 면적. 구멍은 뺀다. */
const polygonAreaCache = new WeakMap<number[][][], number>();
export function polygonArea(rings: number[][][]): number {
  const cached = polygonAreaCache.get(rings);
  if (cached !== undefined) return cached;
  const value = rings.reduce((a, r, i) => a + (i === 0 ? ringArea(r) : -ringArea(r)), 0);
  polygonAreaCache.set(rings, value);
  return value;
}

function firstPosition(coords: unknown): [number, number] | null {
  if (!Array.isArray(coords)) return null;
  if (typeof coords[0] === "number") {
    if (typeof coords[1] !== "number") throw new TypeError("invalid coordinate");
    return [coords[0], coords[1]];
  }
  for (const child of coords) {
    const found = firstPosition(child);
    if (found) return found;
  }
  return null;
}

/** 테스트·외부 호출의 WGS84 도형도 받아들이되, 계산 계약은 EPSG:5179 미터로 통일한다. */
function toUtmGeometry(g: Geometry): Geometry {
  if (g.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  const first = firstPosition(g.coordinates);
  if (!first) throw new TypeError("empty geometry");
  const isLngLat = Math.abs(first[0]) <= 180 && Math.abs(first[1]) <= 90;
  if (!isLngLat) return g;
  const project = (coords: unknown): unknown => {
    if (!Array.isArray(coords)) throw new TypeError("invalid coordinates");
    if (typeof coords[0] === "number") {
      if (typeof coords[1] !== "number" || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) throw new TypeError("invalid coordinate");
      return [...toUtmk([coords[0], coords[1]])];
    }
    return coords.map(project);
  };
  return { ...g, coordinates: project(g.coordinates) } as Geometry;
}

function validParts(parts: number[][][][]): boolean {
  return parts.every((polygonParts_) => polygonParts_.length > 0 && polygonParts_.every((ring) =>
    ring.length >= 4 && ring.every((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
  ));
}

/** 반경과 도형이 겹친 면적. 완전 포함이면 절단을 생략해 원본 면적을 보존한다. */
export function areaInCircle(center: LngLat, radiusM: number, g: Geometry): AreaInCircleResult | null {
  if (!center.every(Number.isFinite) || !Number.isFinite(radiusM) || radiusM < 0) return null;
  const key = circleCacheKey(center, radiusM);
  let cache = areaInCircleCache.get(g);
  if (cache?.key === key) return cache.result;
  const cachedVariant = cache?.variants?.get(key);
  if (cachedVariant !== undefined) return cachedVariant;
  let result: AreaInCircleResult | null = null;
  try {
    const geometry = toUtmGeometry(g);
    const [cx, cy] = toUtmk(center);
    const parts = polygonParts(geometry);
    if (parts.length === 0) {
      result = { areaM2: 0, parts: [], clipped: false };
    } else if (validParts(parts)) {
      const r2 = radiusM * radiusM;
      const allInside = parts.every((p) => p.every((ring) => ring.every(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= r2)));
      if (allInside) {
        result = { areaM2: parts.reduce((s, p) => s + polygonArea(p), 0), parts, clipped: false };
      } else {
        const clipped = clipToCircle(center, radiusM, geometry);
        result = clipped === null ? null : { areaM2: clipped.reduce((s, p) => s + polygonArea(p), 0), parts: clipped, clipped: true };
      }
    }
  } catch {
    result = null;
  }
  if (!cache) {
    areaInCircleCache.set(g, { key, result });
  } else if (!cache.variants) {
    cache.variants = new Map([[cache.key, cache.result], [key, result]]);
  } else {
    cache.variants.set(key, result);
  }
  return result;
}

/** 반경 원(면적이 πr²와 같도록 96각형)과 도형을 교차한 폴리곤 목록. 도형이 깨져 계산할 수 없으면 null. */
export function clipToCircle(center: LngLat, radiusM: number, g: Geometry): number[][][][] | null {
  const [cx, cy] = toUtmk(center);
  const n = 96;
  const r = radiusM * Math.sqrt((2 * Math.PI) / (n * Math.sin((2 * Math.PI) / n)));
  const ring = Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((2 * Math.PI * (i % n)) / n), cy + r * Math.sin((2 * Math.PI * (i % n)) / n)]);
  const parts = polygonParts(g);
  if (parts.length === 0) return [];
  try {
    const feat = (parts.length === 1 ? polygon(parts[0]) : multiPolygon(parts)) as Feature<Polygon | MultiPolygon>;
    const box = bboxClip(feat as Feature<Polygon>, [cx - radiusM, cy - radiusM, cx + radiusM, cy + radiusM]) as Feature<Polygon | MultiPolygon>;
    if (polygonParts(box.geometry).every((p) => p.length === 0 || p[0].length < 4)) return [];
    const res = intersect(featureCollection<Polygon | MultiPolygon>([box, polygon([ring])]));
    return res ? polygonParts(res.geometry) : [];
  } catch {
    return null;
  }
}

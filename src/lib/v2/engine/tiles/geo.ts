/** 선형 지물 보조: 중심점(WGS84)에서 EPSG:5179 선형까지의 직선거리, 원 안 구간 표본점. */
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import { bboxClip, featureCollection, intersect, multiPolygon, polygon } from "@turf/turf";
import { toLngLat, toUtmk, type LngLat } from "../../crs";
import type { MapCandidate } from "./common";

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
  let hi = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
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
export const polygonArea = (rings: number[][][]) => rings.reduce((a, r, i) => a + (i === 0 ? ringArea(r) : -ringArea(r)), 0);

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
export function areaInCircle(center: LngLat, radiusM: number, g: Geometry): { areaM2: number; parts: number[][][][]; clipped: boolean } | null {
  if (!center.every(Number.isFinite) || !Number.isFinite(radiusM) || radiusM < 0) return null;
  try {
    const geometry = toUtmGeometry(g);
    const [cx, cy] = toUtmk(center);
    const parts = polygonParts(geometry);
    if (parts.length === 0) return { areaM2: 0, parts: [], clipped: false };
    if (!validParts(parts)) return null;
    const r2 = radiusM * radiusM;
    const allInside = parts.every((p) => p.every((ring) => ring.every(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= r2)));
    if (allInside) return { areaM2: parts.reduce((s, p) => s + polygonArea(p), 0), parts, clipped: false };
    const clipped = clipToCircle(center, radiusM, geometry);
    if (clipped === null) return null;
    return { areaM2: clipped.reduce((s, p) => s + polygonArea(p), 0), parts: clipped, clipped: true };
  } catch {
    return null;
  }
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

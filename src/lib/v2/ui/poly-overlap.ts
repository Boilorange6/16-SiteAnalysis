import { feature, featureCollection, intersect, union } from "@turf/turf";
import type { MultiPolygon, Polygon } from "geojson";

/** 한 면: 고리 목록. 바깥 고리가 먼저, 나머지는 구멍. 좌표 단위는 호출자가 정한다(장면 m, 화면 px). */
export type Poly = readonly (readonly (readonly [number, number])[])[];

/** 겹침 넓이가 이보다 크면 겹친 것으로 본다(변만 닿거나 부동소수 잡음인 쌍은 거른다). */
const OVERLAP_EPS = 1e-6;

const closeRing = (ring: Poly[number]): Poly[number] => {
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
};
const toFeature = (poly: Poly) => feature({ type: "Polygon", coordinates: poly.map(closeRing) } as unknown as Polygon);

function ringArea(ring: Poly[number]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  return Math.abs(sum) / 2;
}
const polygonArea = (rings: Poly): number => rings.reduce((sum, ring, i) => sum + (i === 0 ? 1 : -1) * ringArea(ring), 0);
const geometryArea = (geometry: Polygon | MultiPolygon): number =>
  (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates).reduce((sum, rings) => sum + polygonArea(rings as unknown as Poly), 0);

/** 바깥 고리의 bbox. 고리가 3점 미만이면 null(겹침 대상이 아니다). */
function bboxOf(poly: Poly): [number, number, number, number] | null {
  const outer = poly[0];
  if (!outer || outer.length < 3) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of outer) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

type Ring = Poly[number];
const TOUCH = 1e-7;
const orient = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);

/** 점이 고리 안(1)·경계(0)·밖(-1). 경계는 TOUCH 이내. */
function locate(ring: Ring, x: number, y: number): -1 | 0 | 1 {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const len = Math.hypot(xj - xi, yj - yi);
    if (len > 0 && Math.abs((xj - xi) * (y - yi) - (yj - yi) * (x - xi)) / len <= TOUCH
      && x >= Math.min(xi, xj) - TOUCH && x <= Math.max(xi, xj) + TOUCH && y >= Math.min(yi, yj) - TOUCH && y <= Math.max(yi, yj) + TOUCH) return 0;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? 1 : -1;
}

/**
 * 구멍 없는 두 면의 값싼 판정: 변이 어긋나게 교차하거나 한 면의 꼭짓점·변 중점이 다른 면 안에 있으면 겹침, 모두 밖이면 안 겹침.
 * 경계에 닿는 점이 있어 모호하면 null(정밀 판정으로).
 */
function quickVerdict(a: Poly, b: Poly): boolean | null {
  if (a.length > 1 || b.length > 1) return null;
  const A = a[0]!;
  const B = b[0]!;
  for (let i = 0, j = A.length - 1; i < A.length; j = i++) {
    for (let k = 0, l = B.length - 1; k < B.length; l = k++) {
      const d1 = orient(B[l]!, B[k]!, A[j]!);
      const d2 = orient(B[l]!, B[k]!, A[i]!);
      const d3 = orient(A[j]!, A[i]!, B[l]!);
      const d4 = orient(A[j]!, A[i]!, B[k]!);
      if ((d1 > TOUCH && d2 < -TOUCH || d1 < -TOUCH && d2 > TOUCH) && (d3 > TOUCH && d4 < -TOUCH || d3 < -TOUCH && d4 > TOUCH)) return true;
    }
  }
  let touching = false;
  for (const [from, to] of [[A, B], [B, A]] as const) {
    for (let i = 0, j = from.length - 1; i < from.length; j = i++) {
      for (const [x, y] of [from[i]!, [(from[i]![0] + from[j]![0]) / 2, (from[i]![1] + from[j]![1]) / 2] as const]) {
        const where = locate(to, x, y);
        if (where === 1) return true;
        if (where === 0) touching = true;
      }
    }
  }
  return touching ? null : false;
}

function overlaps(a: Poly, b: Poly): boolean {
  const quick = quickVerdict(a, b);
  if (quick !== null) return quick;
  try {
    const shared = intersect(featureCollection([toFeature(a), toFeature(b)]));
    return !!shared && geometryArea(shared.geometry) > OVERLAP_EPS;
  } catch {
    return false; // 판정이 안 되면 겹침 없음으로 둔다(합치지도 나누지도 않아 기하를 잃지 않는다)
  }
}

/** 넓이가 실제로 겹치는 면 쌍의 색인. x 정렬 훑기로 bbox가 겹치는 쌍만 정밀 판정한다. */
export function overlapPairs(polys: readonly Poly[]): Array<[number, number]> {
  const boxes = polys.map(bboxOf);
  const order = boxes.flatMap((box, i) => (box ? [i] : [])).sort((a, b) => boxes[a]![0] - boxes[b]![0]);
  const pairs: Array<[number, number]> = [];
  for (let m = 0; m < order.length; m++) {
    const a = order[m]!;
    const boxA = boxes[a]!;
    for (let n = m + 1; n < order.length; n++) {
      const b = order[n]!;
      const boxB = boxes[b]!;
      if (boxB[0] >= boxA[2]) break;
      if (boxB[1] < boxA[3] && boxA[1] < boxB[3] && overlaps(polys[a]!, polys[b]!)) pairs.push(a < b ? [a, b] : [b, a]);
    }
  }
  return pairs;
}

/** 겹친 면을 연결된 덩어리마다 한 번씩 union한다. 겹치지 않은 면과 union이 실패한 덩어리는 그대로 둔다. */
export function mergeOverlapping(polys: readonly Poly[]): Poly[] {
  const pairs = overlapPairs(polys);
  if (pairs.length === 0) return [...polys];
  const parent = polys.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; }
    return i;
  };
  for (const [a, b] of pairs) parent[find(a)] = find(b);
  const groups = new Map<number, Poly[]>();
  polys.forEach((poly, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(poly); else groups.set(root, [poly]);
  });
  return [...groups.values()].flatMap((group) => {
    if (group.length === 1) return group;
    try {
      const geometry = union(featureCollection(group.map(toFeature)))?.geometry;
      if (geometry) return (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates) as unknown as Poly[];
    } catch {
      // 아래에서 원래 면을 그대로 돌려준다
    }
    return group;
  });
}

/** 탐욕 배정: 겹치는 면이 없는 첫 하위 묶음에 넣는다. 한 하위 묶음 안의 면끼리는 서로 겹치지 않는다. */
export function splitOverlapping(polys: readonly Poly[]): Poly[][] {
  const earlier: number[][] = polys.map(() => []);
  for (const [a, b] of overlapPairs(polys)) earlier[b]!.push(a);
  const groupOf: number[] = [];
  const groups: Poly[][] = [];
  polys.forEach((poly, i) => {
    const taken = new Set(earlier[i]!.map((j) => groupOf[j]));
    let g = 0;
    while (taken.has(g)) g++;
    (groups[g] ??= []).push(poly);
    groupOf[i] = g;
  });
  return groups;
}

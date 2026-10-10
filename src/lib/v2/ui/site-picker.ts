/**
 * 대지 지정 화면의 브라우저 순수 계산.
 * 서버/Node 모듈을 import하지 않으므로 UI·단위 테스트에서 같이 사용한다.
 */
import type { SiteInput } from "../site";

export type LngLat = [number, number];
export type SitePickerGeometry =
  | { type: "Polygon"; coordinates: LngLat[][] }
  | { type: "MultiPolygon"; coordinates: LngLat[][][] };

export type SitePickerParcel = {
  pnu: string;
  label: string;
  jimok: string | null;
  areaM2: number | null;
  geometry: SitePickerGeometry;
};

export type SitePickerMode = "address" | "parcels" | "polygon";
export type { SiteInput };

export const MAX_SITE_PARCELS = 30;
export const PARCEL_ADJACENCY_TOLERANCE_M = 0.5;

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320;
const EPSILON = 1e-9;

function samePoint(a: readonly [number, number], b: readonly [number, number], tolerance = EPSILON): boolean {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
}

function openRing(ring: readonly LngLat[]): LngLat[] {
  if (ring.length > 1 && samePoint(ring[0]!, ring.at(-1)!)) return ring.slice(0, -1).map(([lng, lat]) => [lng, lat]);
  return ring.map(([lng, lat]) => [lng, lat]);
}

export function outerRingsOf(geometry: SitePickerGeometry | null | undefined): LngLat[][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates[0] ? [openRing(geometry.coordinates[0])] : [];
  return geometry.coordinates.flatMap((polygon) => polygon[0] ? [openRing(polygon[0])] : []);
}

export function allRingsOf(geometry: SitePickerGeometry | null | undefined): LngLat[][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.map(openRing);
  return geometry.coordinates.flatMap((polygon) => polygon.map(openRing));
}

function project(point: readonly [number, number], latitude: number): [number, number] {
  return [point[0] * M_PER_DEG_LNG * Math.cos((latitude * Math.PI) / 180), point[1] * M_PER_DEG_LAT];
}

function areaInProjectedRing(ring: readonly LngLat[], latitude = ring.reduce((sum, [, lat]) => sum + lat, 0) / Math.max(1, ring.length)): number {
  const points = openRing(ring).map((point) => project(point, latitude));
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

/** 닫혔거나 열린 WGS84 ring의 근사 면적(m²). */
export function polygonAreaM2(ring: readonly LngLat[]): number {
  return areaInProjectedRing(ring);
}

export function geometryAreaM2(geometry: SitePickerGeometry | null | undefined): number {
  if (!geometry) return 0;
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return parts.reduce((sum, rings) => {
    const [outer, ...holes] = rings;
    if (!outer) return sum;
    return sum + Math.max(0, areaInProjectedRing(outer) - holes.reduce((holeSum, hole) => holeSum + areaInProjectedRing(hole), 0));
  }, 0);
}

function orient(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point: readonly [number, number], a: readonly [number, number], b: readonly [number, number], tolerance: number): boolean {
  return Math.abs(orient(a, b, point)) <= tolerance * Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])) &&
    point[0] >= Math.min(a[0], b[0]) - tolerance && point[0] <= Math.max(a[0], b[0]) + tolerance &&
    point[1] >= Math.min(a[1], b[1]) - tolerance && point[1] <= Math.max(a[1], b[1]) + tolerance;
}

function segmentsIntersect(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number], tolerance = 1e-8): boolean {
  const abC = orient(a, b, c);
  const abD = orient(a, b, d);
  const cdA = orient(c, d, a);
  const cdB = orient(c, d, b);
  if (((abC > tolerance && abD < -tolerance) || (abC < -tolerance && abD > tolerance)) && ((cdA > tolerance && cdB < -tolerance) || (cdA < -tolerance && cdB > tolerance))) return true;
  return pointOnSegment(c, a, b, tolerance) || pointOnSegment(d, a, b, tolerance) || pointOnSegment(a, c, d, tolerance) || pointOnSegment(b, c, d, tolerance);
}

function pointSegmentDistance(point: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  if (length2 <= EPSILON) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function segmentDistance(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** 두 필지 외곽선이 맞닿거나 지정 거리 이내인지 판정한다. */
export function parcelsAdjacent(a: SitePickerParcel, b: SitePickerParcel, toleranceM = PARCEL_ADJACENCY_TOLERANCE_M): boolean {
  const ringsA = outerRingsOf(a.geometry);
  const ringsB = outerRingsOf(b.geometry);
  const latitude = [...ringsA.flat(), ...ringsB.flat()].reduce((sum, [, lat]) => sum + lat, 0) / Math.max(1, [...ringsA.flat(), ...ringsB.flat()].length);
  const segmentsA = ringsA.flatMap((ring) => ring.map((point, index) => [project(point, latitude), project(ring[(index + 1) % ring.length]!, latitude)] as const));
  const segmentsB = ringsB.flatMap((ring) => ring.map((point, index) => [project(point, latitude), project(ring[(index + 1) % ring.length]!, latitude)] as const));
  return segmentsA.some(([a0, a1]) => segmentsB.some(([b0, b1]) => segmentDistance(a0, a1, b0, b1) <= toleranceM));
}

export function parcelAdjacencyGroups(parcels: readonly SitePickerParcel[], toleranceM = PARCEL_ADJACENCY_TOLERANCE_M): SitePickerParcel[][] {
  const groups: SitePickerParcel[][] = [];
  const visited = new Set<string>();
  parcels.forEach((parcel, start) => {
    if (visited.has(parcel.pnu)) return;
    const group: SitePickerParcel[] = [];
    const queue = [start];
    visited.add(parcel.pnu);
    while (queue.length > 0) {
      const index = queue.shift()!;
      const current = parcels[index]!;
      group.push(current);
      parcels.forEach((candidate, candidateIndex) => {
        if (visited.has(candidate.pnu) || !parcelsAdjacent(current, candidate, toleranceM)) return;
        visited.add(candidate.pnu);
        queue.push(candidateIndex);
      });
    }
    groups.push(group);
  });
  return groups;
}

export function isParcelSelectionConnected(parcels: readonly SitePickerParcel[], toleranceM = PARCEL_ADJACENCY_TOLERANCE_M): boolean {
  return parcels.length <= 1 || parcelAdjacencyGroups(parcels, toleranceM).length === 1;
}

function vertexKey(point: readonly [number, number]): string {
  return `${point[0].toFixed(7)},${point[1].toFixed(7)}`;
}

function edgeKey(a: readonly [number, number], b: readonly [number, number]): string {
  const first = vertexKey(a);
  const second = vertexKey(b);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

/** 선택 필지의 내부 공유 변을 제거하고 남은 바깥 ring만 돌려준다. */
export function outerBoundary(parcels: readonly SitePickerParcel[]): LngLat[][] {
  const byEdge = new Map<string, LngLat[][]>();
  parcels.flatMap((parcel) => outerRingsOf(parcel.geometry)).forEach((ring) => {
    if (ring.length < 3) return;
    ring.forEach((point, index) => {
      const next = ring[(index + 1) % ring.length]!;
      const key = edgeKey(point, next);
      const edges = byEdge.get(key) ?? [];
      edges.push([[...point] as LngLat, [...next] as LngLat]);
      byEdge.set(key, edges);
    });
  });
  const edges: Array<[LngLat, LngLat]> = [];
  for (const candidates of byEdge.values()) {
    if (candidates.length % 2 === 1) edges.push(candidates.at(-1)! as [LngLat, LngLat]);
  }
  const remaining = edges.slice();
  const result: LngLat[][] = [];
  while (remaining.length > 0) {
    const [first, second] = remaining.shift()!;
    const ring: LngLat[] = [first, second];
    while (remaining.length > 0 && !samePoint(ring[0]!, ring.at(-1)!)) {
      const current = ring.at(-1)!;
      const index = remaining.findIndex(([a, b]) => samePoint(a, current) || samePoint(b, current));
      if (index < 0) break;
      const [a, b] = remaining.splice(index, 1)[0]!;
      ring.push(samePoint(a, current) ? b : a);
    }
    if (ring.length >= 3) result.push(ring);
  }
  return result;
}

/** 열린 점 목록도 닫힌 ring으로 바꾼다. */
export function closePolygon(points: readonly LngLat[]): LngLat[] {
  const copy = points.map(([lng, lat]) => [lng, lat] as LngLat);
  if (copy.length > 0 && !samePoint(copy[0]!, copy.at(-1)!)) copy.push([...copy[0]!] as LngLat);
  return copy;
}

/** 인접 선분을 제외하고 다각형의 자기 교차를 판정한다. */
export function hasSelfIntersection(points: readonly LngLat[]): boolean {
  const ring = openRing(points);
  if (ring.length < 4) return false;
  for (let first = 0; first < ring.length; first += 1) {
    const firstNext = (first + 1) % ring.length;
    for (let second = first + 1; second < ring.length; second += 1) {
      const secondNext = (second + 1) % ring.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(ring[first]!, ring[firstNext]!, ring[second]!, ring[secondNext]!)) return true;
    }
  }
  return false;
}

function ringCentroid(ring: readonly LngLat[]): { center: LngLat; area: number } {
  const points = openRing(ring);
  if (points.length < 3) return { center: points[0] ? [...points[0]] as LngLat : [0, 0], area: 0 };
  const latitude = points.reduce((sum, [, lat]) => sum + lat, 0) / points.length;
  // Keep the shoelace calculation local to the ring. Multiplying absolute
  // WGS84 coordinates by meters first loses enough low bits at Korean
  // longitudes to move a small parcel's centroid by tens of meters.
  const origin = points[0]!;
  const meterLng = M_PER_DEG_LNG * Math.cos((latitude * Math.PI) / 180);
  const projected = points.map(([lng, lat]) => [(lng - origin[0]) * meterLng, (lat - origin[1]) * M_PER_DEG_LAT] as [number, number]);
  let crossSum = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const a = projected[index]!;
    const b = projected[(index + 1) % projected.length]!;
    const cross = a[0] * b[1] - b[0] * a[1];
    crossSum += cross;
    x += (a[0] + b[0]) * cross;
    y += (a[1] + b[1]) * cross;
  }
  const area = Math.abs(crossSum) / 2;
  if (area <= EPSILON) return { center: [...points[0]!] as LngLat, area: 0 };
  return { center: [origin[0] + x / (3 * crossSum) / meterLng, origin[1] + y / (3 * crossSum) / M_PER_DEG_LAT] as LngLat, area };
}

export function geometryCenter(geometry: SitePickerGeometry | null | undefined): LngLat | null {
  const parts = outerRingsOf(geometry).map(ringCentroid).filter(({ area }) => area > 0);
  if (parts.length === 0) return null;
  const total = parts.reduce((sum, part) => sum + part.area, 0);
  return [parts.reduce((sum, part) => sum + part.center[0] * part.area, 0) / total, parts.reduce((sum, part) => sum + part.center[1] * part.area, 0) / total];
}

function polygonRingsOf(geometry: SitePickerGeometry): LngLat[][][] {
  return geometry.type === "Polygon"
    ? [geometry.coordinates.map(openRing)]
    : geometry.coordinates.map((polygon) => polygon.map(openRing));
}

function pointInRing(point: LngLat, ring: readonly LngLat[]): boolean {
  const points = openRing(ring);
  if (points.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const current = points[index]!;
    const before = points[previous]!;
    if (pointOnSegment(point, before, current, 1e-12)) return true;
    const crosses = (current[1] > point[1]) !== (before[1] > point[1])
      && point[0] < ((before[0] - current[0]) * (point[1] - current[1])) / (before[1] - current[1]) + current[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: LngLat, rings: readonly (readonly LngLat[])[]): boolean {
  return !!rings[0] && pointInRing(point, rings[0]) && rings.slice(1).every((hole) => !pointInRing(point, hole));
}

/**
 * 대지 표식용 표면점. 엔진의 pointOnFeature와 같은 bbox 중심 우선 규칙을
 * 브라우저에서 계산한다. 중심이 도형 밖(오목면·구멍)이면 가장 가까운
 * 꼭짓점으로 폴백한다.
 */
export function pointOnSurface(geometry: SitePickerGeometry | null | undefined): LngLat | null {
  if (!geometry) return null;
  const polygons = polygonRingsOf(geometry);
  const points = polygons.flat(2);
  if (points.length === 0) return null;
  const bounds = points.reduce(
    (current, [lng, lat]) => ({ minLng: Math.min(current.minLng, lng), maxLng: Math.max(current.maxLng, lng), minLat: Math.min(current.minLat, lat), maxLat: Math.max(current.maxLat, lat) }),
    { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity },
  );
  const candidate: LngLat = [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2];
  if (polygons.some((rings) => pointInPolygon(candidate, rings))) return candidate;

  let nearest: LngLat | null = null;
  let best = Infinity;
  for (const point of points) {
    const distance = (point[0] - candidate[0]) ** 2 + (point[1] - candidate[1]) ** 2;
    if (distance < best) {
      best = distance;
      nearest = [...point] as LngLat;
    }
  }
  return nearest;
}

export function parcelAreaM2(parcel: SitePickerParcel): number {
  return typeof parcel.areaM2 === "number" && Number.isFinite(parcel.areaM2) && parcel.areaM2 > 0 ? parcel.areaM2 : Math.max(0, geometryAreaM2(parcel.geometry));
}

export function selectedAreaM2(parcels: readonly SitePickerParcel[]): number {
  return parcels.reduce((sum, parcel) => sum + parcelAreaM2(parcel), 0);
}

export function selectedCenter(parcels: readonly SitePickerParcel[]): LngLat | null {
  const boundary = outerBoundary(parcels);
  if (boundary.length === 0) return null;
  const geometry: SitePickerGeometry = boundary.length === 1
    ? { type: "Polygon", coordinates: [boundary[0]!] }
    : { type: "MultiPolygon", coordinates: boundary.map((ring) => [ring]) };
  return pointOnSurface(geometry);
}

export function districtFromAddress(address: string): string {
  return address.trim().split(/\s+/u).reverse().find((part) => /(?:동|읍|면|리)$/u.test(part)) ?? "";
}

export function representativeJibun(parcels: readonly SitePickerParcel[], district = ""): string {
  if (parcels.length === 0) return "필지 미선택";
  const first = parcels[0]!.label.trim() || "지번 미상";
  const full = district && !first.includes(district) ? `${district} ${first}` : first;
  return parcels.length > 1 ? `${full} 외 ${parcels.length - 1}필지` : full;
}

/** PNU의 본번·부번을 화면용 지번으로 복원한다. */
export function jibunFromPnu(pnu: string): string {
  if (!/^\d{19}$/.test(pnu)) return pnu;
  const main = String(Number(pnu.slice(11, 15)));
  const sub = Number(pnu.slice(15, 19));
  return sub > 0 ? `${main}-${sub}` : main;
}

export function toggleParcelPnu(pnus: readonly string[], pnu: string, max = MAX_SITE_PARCELS): { pnus: string[]; limited: boolean } {
  const current = [...new Set(pnus)];
  if (current.includes(pnu)) return { pnus: current.filter((value) => value !== pnu), limited: false };
  if (current.length >= max) return { pnus: current, limited: true };
  return { pnus: [...current, pnu], limited: false };
}

export function isRoadParcel(parcel: Pick<SitePickerParcel, "jimok">): boolean {
  return parcel.jimok?.trim() === "도";
}

export function formatAreaM2(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value).toLocaleString("ko-KR")}㎡` : "면적 미확인";
}

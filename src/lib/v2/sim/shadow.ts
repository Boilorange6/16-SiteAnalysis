/**
 * 건물 그림자 (미터 좌표계 평면, 예: EPSG:5186). x=동, y=북.
 * 그림자 = 바닥 발자국 ∪ 지붕 발자국을 그림자 벡터만큼 민 것 ∪ 각 변이 쓸고 간 사각형.
 * 높이를 모르는(null) 건물은 그림자를 만들지 않고 따로 센다. 0으로 취급하지 않는다.
 */
import { union } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { SunPosition } from "./sun";

export type XY = readonly [number, number];
/** 한 고리(기존 계약) 또는 합필/멀티폴리곤의 바깥 고리 목록. */
export type SiteRings = readonly XY[] | readonly (readonly XY[])[];
export interface Building {
  id: string;
  /** 외곽 링 (닫혀 있어도 열려 있어도 됨) */
  ring: readonly XY[];
  /** 지붕 높이(m). null = 모름 */
  heightM: number | null;
}
export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface Shadow {
  buildingId: string;
  geometry: Polygon | MultiPolygon;
  bbox: BBox;
}

export function ringBBox(ring: readonly XY[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function siteRings(site: SiteRings): readonly (readonly XY[])[] {
  const first = site[0] as XY | readonly XY[] | undefined;
  return first && typeof first[0] === "number" ? [site as readonly XY[]] : site as readonly (readonly XY[])[];
}

export function siteBBox(site: SiteRings): BBox {
  const boxes = siteRings(site).map(ringBBox);
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

export function pointInSite(x: number, y: number, site: SiteRings): boolean {
  return siteRings(site).some((ring) => pointInRings(x, y, [ring]));
}

const closed = (ring: readonly XY[]): XY[] => {
  const r = [...ring];
  const a = r[0], b = r[r.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push(a);
  return r;
};

/** 그림자 벡터(m): 태양 반대 방향으로 높이/tan(고도). 태양이 지평선 아래면 null. */
export function shadowVector(heightM: number, sun: SunPosition): XY | null {
  if (sun.altitudeDeg <= 0.01) return null;
  const len = heightM / Math.tan((sun.altitudeDeg * Math.PI) / 180);
  const az = (sun.azimuthDeg * Math.PI) / 180;
  return [-Math.sin(az) * len, -Math.cos(az) * len];
}

/** 그림자 벡터가 만드는 범위 bbox (union 전에 대지와 겹치는지 싸게 걸러내는 용도). */
export function shadowBBox(b: Building, v: XY): BBox {
  const f = ringBBox(b.ring);
  return { minX: f.minX + Math.min(0, v[0]), maxX: f.maxX + Math.max(0, v[0]), minY: f.minY + Math.min(0, v[1]), maxY: f.maxY + Math.max(0, v[1]) };
}

export function buildingShadow(b: Building, sun: SunPosition): Shadow | null {
  if (b.heightM === null || b.heightM <= 0) return null;
  const v = shadowVector(b.heightM, sun);
  if (!v) return null;
  const ring: number[][] = closed(b.ring).map((p) => [p[0], p[1]]);
  const shift = (p: number[]): number[] => [p[0] + v[0], p[1] + v[1]];
  const pieces: Feature<Polygon>[] = [ring, ring.map(shift)].map((r) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [r] } }));
  for (let i = 0; i < ring.length - 1; i++) {
    const [a, c] = [ring[i], ring[i + 1]];
    const cross = (c[0] - a[0]) * v[1] - (c[1] - a[1]) * v[0];
    if (Math.abs(cross) < 1e-9) continue; // 그림자 방향과 평행한 변은 면적을 쓸지 않는다
    pieces.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[a, c, shift(c), shift(a), a]] } });
  }
  const merged = union({ type: "FeatureCollection", features: pieces });
  if (!merged) return null;
  return { buildingId: b.id, geometry: merged.geometry, bbox: shadowBBox(b, v) };
}

/** 점이 (구멍 포함) 폴리곤 안에 있는가. 짝수-홀수 규칙. */
export function pointInRings(x: number, y: number, rings: readonly (readonly XY[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function pointInShadow(x: number, y: number, s: Shadow): boolean {
  const b = s.bbox;
  if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return false;
  const polys = s.geometry.type === "Polygon" ? [s.geometry.coordinates] : s.geometry.coordinates;
  return polys.some((p) => pointInRings(x, y, p as unknown as XY[][]));
}

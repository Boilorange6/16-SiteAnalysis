import type { Ring } from "../scene";

export type RingRole = "outer" | "hole";
export type CleanRing = [number, number][];

function signedArea(ring: CleanRing): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

function samePoint(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Exporter rings are normalized to outer CCW and hole CW after cleanup. */
export function cleanRing(ring: Ring, role: RingRole): CleanRing {
  const points: CleanRing = [];
  for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const point: [number, number] = [x, y];
    if (points.length === 0 || !samePoint(points[points.length - 1], point)) points.push(point);
  }
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
  if (points.length < 3) return [];

  const area = signedArea(points);
  if ((role === "outer" && area < 0) || (role === "hole" && area > 0)) points.reverse();
  return points;
}

export function cleanRings(rings: readonly Ring[]): CleanRing[] {
  return rings.map((ring, index) => cleanRing(ring, index === 0 ? "outer" : "hole")).filter((ring) => ring.length >= 3);
}

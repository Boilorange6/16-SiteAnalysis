import { feature, featureCollection, union } from "@turf/turf";
import type { Polygon, MultiPolygon } from "geojson";
import { toLngLat, type LngLat } from "../crs";
import { groundZAt, type Scene } from "../scene";

/** 대지 바깥 윤곽. 고리마다 꼭짓점 좌표와 같은 순서의 표고(m, 소수 1자리)를 싣는다. 닫는 점은 반복하지 않는다. */
export type SiteOutline = { rings: Array<{ points: LngLat[]; elevations: Array<number | null> }> };

const SIMPLIFY_TOLERANCE_M = 2;
const round1 = (value: number) => Math.round(value * 10) / 10;

const segDist = (p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** 열린 사슬의 Douglas–Peucker. 양 끝점은 남긴다. */
function simplifyChain(chain: [number, number][], tol: number): [number, number][] {
  if (chain.length < 3) return chain;
  const last = chain.length - 1;
  let far = -1;
  let farD = tol;
  for (let i = 1; i < last; i++) {
    const d = segDist(chain[i], chain[0], chain[last]);
    if (d > farD) { farD = d; far = i; }
  }
  if (far < 0) return [chain[0], chain[last]];
  return [...simplifyChain(chain.slice(0, far + 1), tol).slice(0, -1), ...simplifyChain(chain.slice(far), tol)];
}

/** 닫는 점이 없는 고리를 첫 점에서 가장 먼 점으로 둘로 나눠 각각 줄인다(통째로 줄이면 시작=끝이라 2점만 남는다). */
function simplifyClosed(ring: [number, number][], tol: number): [number, number][] {
  let split = 0;
  let splitD = -1;
  ring.forEach((p, i) => {
    const d = Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]);
    if (d > splitD) { splitD = d; split = i; }
  });
  const a = simplifyChain(ring.slice(0, split + 1), tol);
  const b = simplifyChain([...ring.slice(split), ring[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const closeRing = (ring: [number, number][]): [number, number][] => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
};

const cache = new WeakMap<Scene, SiteOutline | null>();

/** `scene.site`의 고리들을 합쳐 바깥 윤곽만 남기고 2 m 허용으로 줄인 꼭짓점(WGS84)과 표고를 만든다. 대지가 없으면 null. */
export function siteOutlineFromScene(scene: Scene): SiteOutline | null {
  if (cache.has(scene)) return cache.get(scene) ?? null;
  const outline = build(scene);
  cache.set(scene, outline);
  return outline;
}

function build(scene: Scene): SiteOutline | null {
  const closed = (scene.site ?? []).filter((ring) => ring.length >= 3).map(closeRing).filter((ring) => ring.length >= 4);
  if (closed.length === 0) return null;
  let outers: [number, number][][];
  try {
    if (closed.length === 1) outers = [closed[0]];
    else {
      const merged = union(featureCollection(closed.map((ring) => feature({ type: "Polygon", coordinates: [ring] } as Polygon))));
      const geometry = merged?.geometry as Polygon | MultiPolygon | undefined;
      if (!geometry) return null;
      outers = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates).map((polygon) => polygon[0] as [number, number][]);
    }
  } catch {
    return null;
  }
  const { origin, ground } = scene;
  const rings = outers.map((outer) => {
    const vertices = simplifyClosed(outer.slice(0, -1), SIMPLIFY_TOLERANCE_M);
    return {
      points: vertices.map(([x, y]) => toLngLat([origin.x + x, origin.y + y])),
      elevations: vertices.map(([x, y]) => {
        if (ground.kind !== "dem") return null;
        const z = groundZAt(ground, x, y);
        return z === null ? null : round1(ground.originZ + z);
      }),
    };
  }).filter((ring) => ring.points.length >= 3);
  return rings.length > 0 ? { rings } : null;
}

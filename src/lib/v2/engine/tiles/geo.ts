/** 선형 지물 보조: 중심점(WGS84)에서 EPSG:5179 선형까지의 직선거리, 원 안 구간 표본점. */
import type { Geometry } from "geojson";
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

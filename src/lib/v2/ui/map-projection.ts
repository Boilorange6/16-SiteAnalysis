/** 지도 그림의 순수 계산: Web Mercator 줌·좌표·타일 목록·축척 막대. 브라우저·Node 공용. */
export const TILE_PX = 256;
const M_PER_PX_Z0 = 156543.03392804097;
const MAX_TILE_ZOOM = 19;
const MAX_LAT = 85.0511287798;

export type Viewport = { center: readonly [number, number]; zoom: number; width: number; height: number };

const rad = (d: number) => (d * Math.PI) / 180;

/** 줌 z의 세계 픽셀 좌표(소수 줌 허용) */
export function worldPx(lng: number, lat: number, z: number): [number, number] {
  const size = TILE_PX * 2 ** z;
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const s = Math.sin(rad(la));
  return [((lng + 180) / 360) * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}

export const metersPerPixel = (latDeg: number, z: number) => (M_PER_PX_Z0 * Math.cos(rad(latDeg))) / 2 ** z;

/** 반경 원 지름이 그림 높이의 fill(기본 80%)이 되는 줌 (v1 PPT 프레이밍과 같은 규칙) */
export function zoomForRadius(latDeg: number, radiusM: number, heightPx: number, fill = 0.8): number {
  const mpp = (2 * radiusM) / (fill * heightPx);
  return Math.log2((M_PER_PX_Z0 * Math.cos(rad(latDeg))) / mpp);
}

export function viewportFor(center: readonly [number, number], radiusM: number, width: number, height: number): Viewport {
  return { center, zoom: zoomForRadius(center[1], radiusM, height), width, height };
}

/** (lng,lat) → 그림 좌표(px). 그림 중앙이 center. */
export function makeProjector(v: Viewport): (lng: number, lat: number) => [number, number] {
  const [cx, cy] = worldPx(v.center[0], v.center[1], v.zoom);
  return (lng, lat) => {
    const [x, y] = worldPx(lng, lat, v.zoom);
    return [x - cx + v.width / 2, y - cy + v.height / 2];
  };
}

export type MapTile = { z: number; x: number; y: number; left: number; top: number; size: number };

/** 그림을 덮는 배경 타일(정수 줌으로 받아 소수 줌에 맞게 확대·축소해 놓는다) */
export function tilesFor(v: Viewport): MapTile[] {
  const z = Math.max(0, Math.min(MAX_TILE_ZOOM, Math.round(v.zoom)));
  const size = TILE_PX * 2 ** (v.zoom - z);
  const [cx, cy] = worldPx(v.center[0], v.center[1], v.zoom);
  const left0 = cx - v.width / 2;
  const top0 = cy - v.height / 2;
  const n = 2 ** z;
  const out: MapTile[] = [];
  for (let ty = Math.max(0, Math.floor(top0 / size)); ty <= Math.min(n - 1, Math.floor((top0 + v.height) / size)); ty++) {
    for (let tx = Math.floor(left0 / size); tx <= Math.floor((left0 + v.width) / size); tx++) {
      out.push({ z, x: ((tx % n) + n) % n, y: ty, left: tx * size - left0, top: ty * size - top0, size });
    }
  }
  return out;
}

/**
 * 배경 타일 주소. OpenStreetMap 표준 타일 — CARTO light_all은 API 키 없이는 "API KEY REQUIRED" 자리표시 타일만 준다(2026-09-30 확인).
 * 공급자를 바꿀 때는 이 함수와 BASEMAP_ATTRIBUTION만 고친다.
 */
export function tileUrl(t: Pick<MapTile, "z" | "x" | "y">): string {
  return `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
}
export const BASEMAP_ATTRIBUTION = "© OpenStreetMap contributors";

/** maxPx 안에 들어가는 가장 긴 1·2·5×10ⁿ m 막대 */
export function scaleBar(mPerPx: number, maxPx: number): { meters: number; px: number; label: string } {
  const maxM = mPerPx * maxPx;
  const p = 10 ** Math.floor(Math.log10(maxM));
  const meters = [5, 2, 1].map((k) => k * p).find((m) => m <= maxM) ?? p;
  return { meters, px: meters / mPerPx, label: meters >= 1000 ? `${meters / 1000}km` : `${meters}m` };
}

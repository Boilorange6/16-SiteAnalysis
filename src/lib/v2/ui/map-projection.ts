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

export function viewportFor(center: readonly [number, number], radiusM: number, width: number, height: number, fill = 0.8): Viewport {
  return { center, zoom: zoomForRadius(center[1], radiusM, height, fill), width, height };
}

/** 대지를 가로 siteX(0~1) 위치에 놓은 뷰포트: 경도(메르카토르 x)는 선형이라 중심 경도만 옮기면 된다. 지도 그림·PPT 지도 이미지·설명선 점이 같은 값을 쓴다 */
export function framedViewport(center: readonly [number, number], radiusM: number, width: number, height: number, siteX = 0.5, fill = 0.8): Viewport {
  const vp0 = viewportFor(center, radiusM, width, height, fill);
  return { ...vp0, center: [center[0] + (0.5 - siteX) * width * (360 / (256 * 2 ** vp0.zoom)), center[1]] as const };
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
  // 올림: 타일을 축소만 해서 배경 지명 글자가 커지지 않고 선명하다(타일 수는 늘어난다).
  const z = Math.max(0, Math.min(MAX_TILE_ZOOM, Math.ceil(v.zoom)));
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

/** 배경지도 종류: 일반(white)·지도(Base)·항공(Satellite 위에 Hybrid 글자). 서버 프록시의 레이어 이름과 같다. */
export type BasemapLayer = "white" | "Base" | "Satellite" | "Hybrid";
export type BasemapChoice = "white" | "Base" | "Satellite";
/** 선택 하나가 겹쳐 그리는 레이어(아래→위) */
export const BASEMAP_STACK: Record<BasemapChoice, BasemapLayer[]> = { white: ["white"], Base: ["Base"], Satellite: ["Satellite", "Hybrid"] };

/**
 * 배경 타일 주소 = 우리 서버 프록시(같은 출처, basePath /site). VWorld 키는 서버에만 있다.
 * 프록시 경로의 y는 행(row), x는 열(column)이다: VWorld WMTS도 z/행/열 순서다(z15 행12700 열27946 = 서울).
 */
export function tileUrl(layer: BasemapLayer, z: number, x: number, y: number): string {
  return `/site/api/v2/tiles/${layer}/${z}/${y}/${x}`;
}
export const BASEMAP_ATTRIBUTION = "© VWorld(국토교통부)";

/** maxPx 안에 들어가는 가장 긴 1·2·5×10ⁿ m 막대 */
export function scaleBar(mPerPx: number, maxPx: number): { meters: number; px: number; label: string } {
  const maxM = mPerPx * maxPx;
  const p = 10 ** Math.floor(Math.log10(maxM));
  const meters = [5, 2, 1].map((k) => k * p).find((m) => m <= maxM) ?? p;
  return { meters, px: meters / mPerPx, label: meters >= 1000 ? `${meters / 1000}km` : `${meters}m` };
}

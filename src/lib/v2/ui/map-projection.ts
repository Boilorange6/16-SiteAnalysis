/** 지도 그림의 순수 계산: Web Mercator 줌·좌표·타일 목록·축척 막대. 브라우저·Node 공용. */
import type { PageStyle } from "./board-state";
import type { MapModel } from "./map-layers";

export const TILE_PX = 256;
const M_PER_PX_Z0 = 156543.03392804097;
const MAX_TILE_ZOOM = 19;
const MAX_LAT = 85.0511287798;
const DEFAULT_MAX_ZOOM_DELTA = 3;
const RASTER_MAX_CELL_PX = 12;

export type Viewport = { center: readonly [number, number]; zoom: number; width: number; height: number };
export type MapView = { zoomDelta: number; offsetM: readonly [number, number] };
export type MapZoom = { maxDelta?: number; maxAbsZoom?: number; card?: boolean };
export type SlideViewportFrame = { width: number; height: number; siteX?: number; siteY?: number; fill?: number };

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
export function framedViewport(center: readonly [number, number], radiusM: number, width: number, height: number, siteX = 0.5, fill = 0.8, siteY = 0.5): Viewport {
  const vp0 = viewportFor(center, radiusM, width, height, fill);
  const lng = center[0] + (0.5 - siteX) * width * (360 / (256 * 2 ** vp0.zoom));
  if (siteY === 0.5) return { ...vp0, center: [lng, center[1]] as const };
  // 세로 위치는 메르카토르 y가 위도에 비선형이라 세계 픽셀에서 옮긴 뒤 위도로 되돌린다
  const [, wy] = worldPx(center[0], center[1], vp0.zoom);
  const size = TILE_PX * 2 ** vp0.zoom;
  const y = wy + (0.5 - siteY) * height;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return { ...vp0, center: [lng, lat] as const };
}

/** 보고서·미리보기가 공유하는 기준 프레임과 페이지별 지도 이동/확대. */
export function slideViewport(
  map: Pick<MapModel, "center" | "radiusM">,
  style: Pick<PageStyle, "zoomDelta" | "offsetM"> | undefined,
  frame: SlideViewportFrame,
): Viewport {
  const base = framedViewport(
    map.center,
    map.radiusM,
    frame.width,
    frame.height,
    frame.siteX ?? 0.5,
    frame.fill ?? 0.8,
    frame.siteY ?? 0.5,
  );
  return applyView(base, map.center[1], {
    zoomDelta: style?.zoomDelta ?? 0,
    offsetM: style?.offsetM ?? [0, 0],
  });
}

function lngLatFromWorldPx(x: number, y: number, z: number): [number, number] {
  const size = TILE_PX * 2 ** z;
  const lng = (x / size) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return [lng, lat];
}

/** 화면에서 확정한 미터 단위 뷰를 같은 Web Mercator 투영의 뷰포트로 반영한다. */
export function applyView(vp: Viewport, lat: number, view?: MapView): Viewport {
  const zoomDelta = view?.zoomDelta ?? 0;
  const eastM = view?.offsetM[0] ?? 0;
  const northM = view?.offsetM[1] ?? 0;
  if (!view || (zoomDelta === 0 && eastM === 0 && northM === 0)) return vp;

  const zoom = vp.zoom + zoomDelta;
  if (eastM === 0 && northM === 0) return { ...vp, zoom };

  // metersPerPixel() is the local ground scale used by the rest of this module.
  // Applying both axes in world pixels keeps an offset followed by its inverse
  // stable even though the inverse Mercator latitude is non-linear.
  const [worldX, worldY] = worldPx(vp.center[0], vp.center[1], zoom);
  const mpp = metersPerPixel(lat, zoom);
  const [lng, nextLat] = lngLatFromWorldPx(worldX + eastM / mpp, worldY - northM / mpp, zoom);
  return { ...vp, zoom, center: [lng, nextLat] as const };
}

/**
 * 화면의 한 점을 고정한 채 줌하는 뷰를 계산한다.
 * px·py는 base viewport의 픽셀 좌표이며, CSS 좌표를 쓰는 호출부는 먼저
 * base.width/height와 실제 요소 크기의 비율을 적용해야 한다.
 */
export function zoomViewAt(base: Viewport, current: MapView, delta: number, px: number, py: number, maxDelta: number, minDelta = 0): MapView {
  const lowerBound = Math.min(minDelta, maxDelta);
  const upperBound = Math.max(minDelta, maxDelta);
  const zoomDelta = Math.max(lowerBound, Math.min(upperBound, current.zoomDelta + delta));
  const currentViewport = applyView(base, base.center[1], current);
  const nextZoom = base.zoom + zoomDelta;
  const scale = 2 ** (nextZoom - currentViewport.zoom);
  const [currentWorldX, currentWorldY] = worldPx(currentViewport.center[0], currentViewport.center[1], currentViewport.zoom);
  const pointerOffsetX = px - base.width / 2;
  const pointerOffsetY = py - base.height / 2;
  const nextWorldX = (currentWorldX + pointerOffsetX) * scale - pointerOffsetX;
  const nextWorldY = (currentWorldY + pointerOffsetY) * scale - pointerOffsetY;
  const [baseWorldX, baseWorldY] = worldPx(base.center[0], base.center[1], nextZoom);
  const nextMpp = metersPerPixel(base.center[1], nextZoom);
  return {
    zoomDelta,
    offsetM: [(nextWorldX - baseWorldX) * nextMpp, (baseWorldY - nextWorldY) * nextMpp],
  };
}

/** 기본 뷰포트의 한 화면 좌표에 대지를 고정한 채 목표 zoomDelta로 이동한다. */
export function siteFitView(base: Viewport, sitePx: number, sitePy: number, zoomDelta: number): MapView {
  // zoomViewAt의 경계가 목표값을 잘라 현재 축척을 바꾸지 않도록 목표를 양 끝에 포함한다.
  return zoomViewAt(
    base,
    { zoomDelta: 0, offsetM: [0, 0] },
    zoomDelta,
    sitePx,
    sitePy,
    Math.max(0, zoomDelta),
    Math.min(0, zoomDelta),
  );
}

/** 줌 델타와 중심 이동을 허용 범위 안으로 줄인다. offsetM은 [동, 북]이다. */
export function clampView(view: MapView, radiusM: number, maxZoom: number): MapView {
  const zoomLimit = Math.max(0, maxZoom);
  const zoomDelta = Math.max(0, Math.min(zoomLimit, view.zoomDelta));
  const radius = Math.max(0, radiusM);
  const eastM = view.offsetM[0];
  const northM = view.offsetM[1];
  const distance = Math.hypot(eastM, northM);
  if (distance <= radius || distance === 0) return { zoomDelta, offsetM: [eastM, northM] as const };
  const scale = radius / distance;
  return { zoomDelta, offsetM: [eastM * scale, northM * scale] as const };
}

/** 기준 뷰포트·타일 설정·래스터 해상도에 맞는 절대 최대 줌을 계산한다. */
export function maxZoomFor(base: Viewport | number, mapZoom?: MapZoom, rasterCellM?: number): number {
  const baseZoom = typeof base === "number" ? base : base.zoom;
  const maxDelta = Math.max(0, mapZoom?.maxDelta ?? DEFAULT_MAX_ZOOM_DELTA);
  const maxAbsZoom = Math.min(MAX_TILE_ZOOM, Math.max(0, mapZoom?.maxAbsZoom ?? MAX_TILE_ZOOM));
  let maxZoom = Math.min(baseZoom + maxDelta, maxAbsZoom);
  if (rasterCellM !== undefined && rasterCellM > 0) {
    // cellM / metersPerPixel(lat, z) <= 12, solved for z.
    const lat = typeof base === "number" ? 0 : base.center[1];
    const rasterZoom = Math.log2((RASTER_MAX_CELL_PX * M_PER_PX_Z0 * Math.cos(rad(lat))) / rasterCellM);
    maxZoom = Math.min(maxZoom, rasterZoom);
  }
  return maxZoom;
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

/**
 * v2의 모든 거리·면적은 EPSG:5179(UTM-K, 미터)에서 계산한다.
 * Web Mercator 면적은 위도에 따라 부풀어서 구성비가 틀린다.
 */
import proj4 from "proj4";

export const UTMK = "EPSG:5179";
proj4.defs(UTMK, "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs");

export type LngLat = readonly [number, number];
export type XY = readonly [number, number];

export function toUtmk([lng, lat]: LngLat): XY {
  const [x, y] = proj4("EPSG:4326", UTMK, [lng, lat]);
  return [x, y];
}

export function toLngLat([x, y]: XY): LngLat {
  const [lng, lat] = proj4(UTMK, "EPSG:4326", [x, y]);
  return [lng, lat];
}

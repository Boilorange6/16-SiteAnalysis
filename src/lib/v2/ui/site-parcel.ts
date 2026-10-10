import type { MapPolygon, TileResult } from "../tile-result";

/** D19가 대상 PNU에 붙이는 분석 대상 필지 레이어. 결과가 없으면 링 폴백을 쓴다. */
export const isSiteParcelLayer = (layer: string): boolean => layer === "parcel_site" || layer === "pnu";

/**
 * 타일 결과에 남아 있는 대상 필지만 분석 단위 지도 입력으로 승격한다.
 * 새 원천 질의는 하지 않으며, 옛 저장 결과에서 필지가 없으면 null이다.
 */
export function siteParcelFromResults(results: readonly TileResult[]): MapPolygon[] | null {
  const d19 = results.find((result) => result.tileCode === "D19");
  const polygons = d19?.presentation.polygons?.filter((polygon) => isSiteParcelLayer(polygon.layer)) ?? [];
  return polygons.length > 0 ? polygons : null;
}

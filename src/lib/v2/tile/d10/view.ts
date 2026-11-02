import type { TileResult } from "../../tile-result";
import { metricPercent, radiusLabel, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

function d10KeyFigure(result: TileResult): KeyFigure | null {
  const canopy = metricPercent(result, "canopy_pct");
  if (canopy === null) return null;
  return {
    question: "반경 수관 면적률",
    answer: { value: canopy, kind: "number" },
    sub: `반경 ${radiusLabel(result.conditions.radiusM)} 원 면적 기준`,
    stats: statList([[metricPercent(result, "canopy_site_pct"), "대지 수관 면적률"], [metricPercent(result, "osm_green_pct"), "OSM 녹지"]]),
  };
}

export const d10ClientModule = {
  code: "D10",
  headline: { ids: ["canopy_pct", "canopy_site_pct", "osm_green_pct"] },
  keyFigureFor: d10KeyFigure,
  /**
   * 엔진이 결과에 박은 위성 바탕(`presentation.basemap`)을 지도 모델에서 뺀다(사용자 결정 2026-11-02 d10: 위성 → 일반 + 수관 래스터).
   * 보드·상세·보고서·PPT가 모두 이 모델을 읽으므로 사용자가 고른 바탕이 그려지고, 저장된 분석도 열 때 바뀐다. D01은 그대로 위성이다.
   */
  view: (base) => {
    if (!base.map?.basemap) return base;
    const { basemap: _pinned, ...map } = base.map;
    return { ...base, map };
  },
  mapNote: "항공사진 색 기반 수관 검출 · 재현율 미검증 · OSM 녹지 보조",
} satisfies TileClientModule;

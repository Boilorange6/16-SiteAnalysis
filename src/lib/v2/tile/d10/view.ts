import type { TileResult } from "../../tile-result";
import { metricPercent, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

function d10KeyFigure(result: TileResult): KeyFigure | null {
  const canopy = metricPercent(result, "canopy_pct");
  if (canopy === null) return null;
  return {
    question: "반경 수관 면적률",
    answer: { value: canopy, kind: "number" },
    stats: statList([[metricPercent(result, "canopy_site_pct"), "대지 수관 면적률"], [metricPercent(result, "osm_green_pct"), "OSM 녹지"]]),
  };
}

export const d10ClientModule = {
  code: "D10",
  headline: { ids: ["canopy_pct", "canopy_site_pct", "osm_green_pct"] },
  keyFigureFor: d10KeyFigure,
  mapNote: "항공사진 색 기반 수관 검출 · 재현율 미검증 · OSM 녹지 보조",
} satisfies TileClientModule;

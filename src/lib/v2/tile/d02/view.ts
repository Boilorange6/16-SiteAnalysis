import type { TileResult } from "../../tile-result";
import { metricCount, metricPercent, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

function d02KeyFigure(result: TileResult): KeyFigure | null {
  const buildings = metricCount(result, "buildings", "동");
  if (buildings === null) return null;
  return {
    question: "반경 건물",
    answer: { value: buildings, kind: "number" },
    stats: statList([[metricPercent(result, "share_footprint_pct"), "건물 발자국 구성비"], [metricPercent(result, "fill_geometry_pct"), "유효 도형"]]),
  };
}

export const d02ClientModule = {
  code: "D02",
  headline: { ids: ["share_footprint_pct", "buildings"] },
  keyFigureFor: d02KeyFigure,
  mapNote: "건물 발자국 · 도형 변환 실패 건물만 점 표시",
} satisfies TileClientModule;

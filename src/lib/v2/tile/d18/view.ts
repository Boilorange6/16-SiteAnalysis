import type { TileResult } from "../../tile-result";
import { metricNumber, metricPercent, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

/** 각도는 판단 문장과 같은 소수 한 자리(`4.2°`)로 쓴다. */
const degrees = (result: TileResult, id: string): string | null => {
  const value = metricNumber(result, id);
  return value === null ? null : `${value.toFixed(1)}°`;
};

function d18KeyFigure(result: TileResult): KeyFigure | null {
  const median = degrees(result, "slope_median_deg");
  if (median === null) return null;
  return {
    question: "경사도 중앙값",
    answer: { value: median, kind: "number" },
    stats: statList([[degrees(result, "slope_max_deg"), "경사도 최댓값"], [metricPercent(result, "share_slope_0_5"), "경사 0~5° 면적"]]),
  };
}

export const d18ClientModule = {
  code: "D18",
  headline: { ids: ["slope_median_deg", "slope_max_deg"] },
  keyFigureFor: d18KeyFigure,
  mapNote: "Copernicus DEM GLO-30 30m 격자 경사 · EGM2008 · 옹벽·미세 지형 미반영",
} satisfies TileClientModule;

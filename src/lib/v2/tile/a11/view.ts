import type { TileResult } from "../../tile-result";
import { metricCount, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

function a11KeyFigure(result: TileResult): KeyFigure | null {
  const population = metricCount(result, "pop_est", "명");
  if (population === null) return null;
  return {
    question: "반경 추정 인구",
    answer: { value: population, kind: "number" },
    stats: statList([[metricCount(result, "density_per_km2", "명/㎢"), "인구밀도"], [metricCount(result, "hh_est", "가구"), "가구 수"]]),
  };
}

export const a11ClientModule = {
  code: "A11",
  headline: { ids: ["density_per_km2", "pop_est", "hh_est"] },
  keyFigureFor: a11KeyFigure,
  mapNote: "구간은 반경 전체 기준",
  metricFilter: (metric) => !metric.id.startsWith("share_dens_") || metric.value !== 0,
} satisfies TileClientModule;

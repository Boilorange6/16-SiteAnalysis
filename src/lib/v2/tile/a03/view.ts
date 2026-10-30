import type { TileResult } from "../../tile-result";
import { metricCount, radiusLabel, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

function a03KeyFigure(result: TileResult): KeyFigure | null {
  const stores = metricCount(result, "stores", "곳");
  if (stores === null) return null;
  const groups = result.metrics.find((metric) => metric.id === "basic_groups");
  const sub = groups?.numerator != null && groups.denominator != null ? `기초 생활시설 ${groups.denominator}군 중 ${groups.numerator}군 확인` : undefined;
  return {
    question: `반경 ${radiusLabel(result.conditions.radiusM)} 상가`,
    answer: { value: stores, kind: "number" },
    ...(sub ? { sub } : {}),
    stats: statList([[metricCount(result, "count_grocery", "곳"), "식료품"], [metricCount(result, "count_clinic", "곳"), "의원"]]),
  };
}

export const a03ClientModule = {
  code: "A03",
  headline: { ids: ["basic_groups"] },
  keyFigureFor: a03KeyFigure,
} satisfies TileClientModule;

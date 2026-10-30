import type { TileResult } from "../../tile-result";
import { m2ToHaText, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

const AREA_PREFIX = "back_area_";

/** 시설 종류별 반경 교차면적 순위. 큰 답은 가장 넓은 종류, 보조 숫자는 그다음 둘이다. */
function d12KeyFigure(result: TileResult): KeyFigure | null {
  const ranked = result.metrics
    .filter((metric) => metric.id.startsWith(AREA_PREFIX) && metric.value !== null)
    .map((metric) => ({ name: metric.id.slice(AREA_PREFIX.length), m2: metric.value as number }))
    .sort((a, b) => b.m2 - a.m2);
  const top = ranked[0];
  if (!top) return null;
  return {
    question: "반경 가장 넓은 시설",
    answer: { pre: top.name, value: m2ToHaText(top.m2), kind: "number" },
    sub: "도시계획시설 종류별 반경 교차면적 중 최대",
    stats: statList(ranked.slice(1, 3).map((item) => [m2ToHaText(item.m2), item.name] as const)),
  };
}

export const d12ClientModule = {
  code: "D12",
  chart: { subject: "도시계획시설", countUnit: "건" },
  autoLabels: false,
  headline: { maxPrefix: "back_area_" },
  keyFigureFor: d12KeyFigure,
} satisfies TileClientModule;

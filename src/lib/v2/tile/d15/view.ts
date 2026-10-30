import type { TileResult } from "../../tile-result";
import { haText, metricCount, metricNumber, metricPercent, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

function d15KeyFigure(result: TileResult): KeyFigure | null {
  const median = metricNumber(result, "median_block_ha");
  if (median === null) return null;
  return {
    question: "블록 면적 중앙값",
    answer: { value: haText(median), kind: "number" },
    stats: statList([[metricCount(result, "blocks", "개"), "폐합 블록 수"], [metricPercent(result, "share_count_lt05"), "0.5 ha 미만 블록 비율"]]),
  };
}

export const d15ClientModule = {
  code: "D15",
  chart: { subject: "폐합 블록", countUnit: "개" },
  headline: { ids: ["median_block_ha", "blocks"] },
  keyFigureFor: d15KeyFigure,
  mapNote: "OSM 도로로 폐합된 블록 · 반경 밖 500m까지 읽음",
} satisfies TileClientModule;

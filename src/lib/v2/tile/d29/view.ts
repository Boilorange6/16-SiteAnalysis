import type { TileResult } from "../../tile-result";
import { metricNumber, metricPercent, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

/** 하늘열림(SVF)은 0~1 비율이다. 카드에는 정수 %로 쓴다(`0.71` → `71%`). */
const svfPercent = (result: TileResult, id: string): string | null => {
  const value = metricNumber(result, id);
  return value === null ? null : `${Math.round(value * 100)}%`;
};

function d29KeyFigure(result: TileResult): KeyFigure | null {
  const site = svfPercent(result, "svf_site_median");
  if (site === null) return null;
  return {
    question: "대지 하늘열림",
    answer: { value: site, kind: "number" },
    stats: statList([[svfPercent(result, "svf_median"), "반경 하늘열림 중앙값"], [metricPercent(result, "back_nodata_pct"), "결측·지붕 면적률"]]),
  };
}

export const d29ClientModule = {
  code: "D29",
  headline: { ids: ["svf_site_median", "svf_median", "share_svf_lt03_pct"] },
  keyFigureFor: d29KeyFigure,
  mapNote: "건물·지형 기준 하늘열림(SVF) · 수목 제외",
} satisfies TileClientModule;

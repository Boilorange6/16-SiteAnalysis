import type { KeyFigure, TileClientModule } from "../types";
import type { TileResult } from "../../tile-result";
import { metricCount, statList } from "../key-figure";

function a07KeyFigure(result: TileResult): KeyFigure | null {
  const median = metricCount(result, "median_price_per_m2", "만원");
  if (median === null) return null;
  return {
    question: "㎡당 매매가 중앙값",
    answer: { value: median, post: "/㎡", kind: "number" },
    stats: statList([
      [metricCount(result, "valid_trades", "건"), "최근 12개월 거래"],
      [metricCount(result, "price_q1_per_m2", "만원"), "㎡당 하위 25%"],
      [metricCount(result, "price_q3_per_m2", "만원"), "㎡당 상위 25%"],
    ]),
  };
}

const layerOptions = (result: TileResult) => [
  ...(result.presentation.polygons?.some((polygon) => polygon.layer.startsWith("trade_district_"))
    ? [{ id: "all", label: "건물" }, { id: "district", label: "행정구역" }]
    : [{ id: "all", label: "기본 거래" }]),
];

export const a07ClientModule = {
  code: "A07",
  chart: { subject: "아파트", countUnit: "단지", statQualifier: "단지별", displayUnit: "만원/㎡" },
  headline: { ids: ["median_price_per_m2", "valid_trades"] },
  keyFigureFor: a07KeyFigure,
  mapNote: "색 구간은 반경 전체 기준",
  layers: {
    // 옛 D25 저장값(trade_location)은 tile-layers의 all fallback으로 복원한다.
    options: layerOptions,
    baseExcludes: ["district"],
  },
} satisfies TileClientModule;

import type { TileResult } from "../../tile-result";
import { metricCount, metricText, percentText, statList } from "../key-figure";
import type { KeyFigure, TileClientModule, TileHeadlineHelpers } from "../types";

function d19KeyFigure(result: TileResult, helpers: TileHeadlineHelpers): KeyFigure | null {
  const parcels = metricCount(result, "parcels", "필지");
  if (parcels === null) return null;
  // 지목 구성비는 필지 수 기준(share_jimok_N). 번호는 고정 그룹이지만 이름으로 찾는다.
  const site = result.metrics.find((metric) => metric.id.startsWith("share_jimok_") && metric.label === "지목: 대지" && metric.value !== null);
  return {
    question: "반경 필지",
    answer: { value: parcels, kind: "number" },
    stats: statList([
      [metricText(result, "median_parcel_m2", helpers), "필지 면적 중앙값"],
      [site ? percentText(site.value as number) : null, "지목 대지 필지"],
    ]),
  };
}

export const d19ClientModule = {
  code: "D19",
  baseSuppress: ["parcel"],
  headline: { ids: ["median_parcel_m2", "parcels"] },
  keyFigureFor: d19KeyFigure,
  mapNote: "연속지적 · 지목·필지 규모 레이어 · 참조용",
  layers: {
    options: [{ id: "all", label: "지목 기본" }, { id: "parcel_size", label: "필지 규모" }],
    baseExcludes: ["parcel_size"],
  },
} satisfies TileClientModule;

import type { TileResult } from "../../tile-result";
import { metricCount, metricNumber, metricText, m2ToHaText, radiusLabel, statList } from "../key-figure";
import type { KeyFigure, TileClientModule, TileHeadlineHelpers } from "../types";

/** 거리는 공원 대표점까지의 직선이다(입구 자료가 없다). 이름은 그 최근접 공원 지물에서 읽는다. */
function a04KeyFigure(result: TileResult, helpers: TileHeadlineHelpers): KeyFigure | null {
  const distance = metricText(result, "nearest_park_point_m", helpers);
  if (distance === null) return null;
  const park = result.presentation.features?.find((feature) => feature.layer === "park_nearest")?.name;
  const area = metricNumber(result, "park_area_sum_m2");
  return {
    question: "가장 가까운 공원",
    answer: { value: distance, ...(park ? { target: park } : {}), kind: "number" },
    sub: "공원 대표점까지 직선거리",
    stats: statList([
      [metricCount(result, "parks", "곳"), `${radiusLabel(result.conditions.radiusM)} 안 공원`],
      [area === null ? null : m2ToHaText(area), "공원 원천 면적 합"],
    ]),
  };
}

export const a04ClientModule = {
  code: "A04",
  polygonDrawOrder: (layer: string) => {
    if (layer === "green_zone" || layer === "green_parcel") return 0;
    if (layer === "water_parcel") return 1;
    if (layer === "park" || layer === "park_nearest") return 2;
    return 3;
  },
  headline: { ids: ["parks", "nearest_park_point_m"] },
  keyFigureFor: a04KeyFigure,
  mapNote: "공원·그 밖의 녹지·하천·수면 평면 레이어 (공원 경계 아님·입구 자료 한계)",
  layers: {
    options: [
      { id: "all", label: "전체" },
      { id: "park_only", label: "공원만" },
      { id: "green_space", label: "녹지·수면" },
    ],
  },
} satisfies TileClientModule;

/**
 * A05+A06는 하나의 소유 단위다. 기존 위치의 callout-*·callout-map·a05-filter와
 * 이 폴더의 A05/A06 화면·보고서 계약을 함께 변경한다.
 */
import { describeA05Filter, reaggregateA05, type A05Filter } from "../../engine/a05-filter";
import { DEFAULT_CALLOUT_MODE, fmtInt, OTHER_HOUSING_COLOR, OTHER_HOUSING_LABEL, rankComplexes, STOCK_LEGEND, summarize } from "../../ui/callout-layout";
import type { TileResult } from "../../tile-result";
import type { CalloutModel } from "../../ui/tile-view";
import type { TileClientModule, TileViewPreparation } from "../types";

const HOUSING_LAYERS = new Set(["apt", "officetel"]);

/** 저장하지 않는 A05 화면 필터를 파생 결과·카드 칩·보고서 한 줄로 투영한다. */
export function prepareA05(result: TileResult, filter: unknown): TileViewPreparation {
  const aggregation = reaggregateA05(result, filter as A05Filter | null | undefined);
  const description = aggregation.filter ? describeA05Filter(aggregation.filter) : null;
  const filterChip = description ? `필터 · ${description}` : null;
  const filterLine = description ? `적용 필터: ${description} · 정보 없음 포함 ${aggregation.counts.unknownKept}건` : null;
  // 재집계는 현재 화면용 파생 결과만 바꾼다. 원본 TileResult와 그 features 배열은 그대로 둔다.
  const prepared = aggregation.filter
    ? {
        ...result,
        metrics: aggregation.metrics,
        presentation: { ...result.presentation, features: aggregation.features, featuresTotal: aggregation.features.length },
      }
    : result;
  return { result: prepared, filterChip, filterLine, a05Counts: aggregation.counts };
}

/** A05 기존 주거 단지의 번호·설명선 모델을 만든다. */
export function calloutForA05(result: TileResult, sourceLine: string, filterLine?: string | null): CalloutModel | null {
  if (result.status !== "complete" && result.status !== "partial") return null;
  const features = result.presentation.features ?? [];
  const complexes = rankComplexes(features.filter((feature) => HOUSING_LAYERS.has(feature.layer)));
  const summary = summarize(complexes);
  const officetels = complexes.filter((complex) => complex.layer === "officetel").length;
  const hasOtherHousing = features.some((feature) => feature.layer === "other_housing");
  const unknown = summary.apartments - summary.householdsKnown;
  return {
    kind: "stock",
    unit: "단지",
    legend: hasOtherHousing
      ? { ...STOCK_LEGEND, items: [...STOCK_LEGEND.items, { label: OTHER_HOUSING_LABEL, color: OTHER_HOUSING_COLOR }] }
      : STOCK_LEGEND,
    stats: [
      { value: fmtInt(summary.apartments), unit: "단지", label: "반경 안 아파트" },
      { value: fmtInt(officetels), unit: "단지", label: "반경 안 오피스텔" },
      { value: fmtInt(summary.households), unit: "세대", label: "확인 세대(아파트)" },
    ],
    statNote: unknown > 0 ? `세대수 미확인 ${unknown}곳은 합계에서 제외` : null,
    pill: [{ value: fmtInt(summary.apartments), unit: "아파트" }, { value: fmtInt(officetels), unit: "오피스텔" }, { value: fmtInt(summary.households), unit: "확인 세대" }],
    center: result.conditions.center,
    radiusM: result.conditions.radiusM,
    complexes,
    others: features.filter((feature) => feature.layer === "other_housing").map((feature) => ({ lng: feature.lng, lat: feature.lat })),
    analysisYear: Number(result.conditions.analysisDate.slice(0, 4)),
    sourceLine,
    summary,
    ...(filterLine ? { filterLine } : {}),
  };
}

export const a05ClientModule = {
  code: "A05",
  headline: { ids: ["households", "apartment_complexes"] },
  mapNote: "원 크기 = 확인 세대·호실 · 색 = 준공 연대 · 속 빈 원 = 준공 연대 미상",
  prepare: (result, context) => prepareA05(result, context.filter),
  callout: calloutForA05,
  board: {
    size: () => 2 as const,
    callout: () => DEFAULT_CALLOUT_MODE,
  },
} satisfies TileClientModule;

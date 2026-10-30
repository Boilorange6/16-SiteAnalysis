/** A05+A06 공동 소유 단위의 A06 화면·보드 훅. 설명선 보고서는 tile/a05/report.ts가 소유한다. */
import { DEFAULT_CALLOUT_MODE, fmtInt, rankSupply, SUPPLY_LAYERS, SUPPLY_LEGEND, summarize, supplyStats } from "../../ui/callout-layout";
import type { TileResult } from "../../tile-result";
import type { CalloutModel } from "../../ui/tile-view";
import { metricCount, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

/** 큰 답은 청약홈 공급 세대다. 입주예정은 같은 사업이 겹칠 수 있어 합산하지 않고 보조 줄에 따로 둔다. */
function a06KeyFigure(result: TileResult): KeyFigure | null {
  const units = metricCount(result, "applyhome_units", "세대");
  if (units === null) return null;
  const moveIn = metricCount(result, "move_in_units", "세대");
  return {
    question: "청약 공급 세대",
    answer: { value: units, kind: "number" },
    ...(moveIn === null ? {} : { sub: `입주예정 공급 ${moveIn}는 별도 집계` }),
    stats: statList([
      [metricCount(result, "applyhome_projects", "곳"), "청약홈 사업"],
      [metricCount(result, "applyhome_units_m0_12", "세대"), "12개월 안 청약 세대"],
    ]),
  };
}

/** A06 분양·입주예정 사업의 번호·설명선 모델을 만든다. */
export function calloutForA06(result: TileResult, sourceLine: string): CalloutModel | null {
  if (result.status !== "complete" && result.status !== "partial") return null;
  const features = result.presentation.features ?? [];
  const complexes = rankSupply(features.filter((feature) => SUPPLY_LAYERS.has(feature.layer)), result.conditions.analysisDate);
  const supply = supplyStats(complexes);
  const soon = complexes.filter((complex) => complex.supply?.timing === "m0_12").length;
  return {
    kind: "supply",
    unit: "곳",
    legend: SUPPLY_LEGEND,
    stats: supply.stats,
    statNote: supply.note,
    pill: [{ value: fmtInt(complexes.length), unit: "곳" }, { value: fmtInt(soon), unit: "곳 12개월 내 입주" }],
    center: result.conditions.center,
    radiusM: result.conditions.radiusM,
    complexes,
    others: [],
    analysisYear: Number(result.conditions.analysisDate.slice(0, 4)),
    sourceLine,
    summary: summarize(complexes),
  };
}

export const a06ClientModule = {
  code: "A06",
  headline: { ids: ["applyhome_units", "move_in_units"] },
  keyFigureFor: a06KeyFigure,
  mapNote: "색 = 원천(청약홈·입주예정) · 원 크기 = 공급 세대 · 같은 사업 중복 가능",
  // 현재 공용 UI fixture에는 합계 행이 있어, 계획서의 "죽은 필터" 판정과 달리 실제로 행을 제거한다.
  metricFilter: (metric) => !/total|sum/.test(metric.id),
  limitationBadges: (limitation) => limitation.note.includes("중복") ? [{ text: "중복 가능 · 합계 보류", note: limitation.note, tone: "limit" as const }] : [],
  callout: calloutForA06,
  board: {
    size: () => 2 as const,
    callout: () => DEFAULT_CALLOUT_MODE,
  },
} satisfies TileClientModule;

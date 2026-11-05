import type { TileResult } from "../../tile-result";
import { metricCount, metricText, statList } from "../key-figure";
import type { KeyFigure, TileClientModule, TileHeadlineHelpers } from "../types";

/** 개통 예정 시점은 엔진이 원천에 일정이 없어 항상 미확인으로 내므로 싣지 않는다. */
function a10KeyFigure(result: TileResult, helpers: TileHeadlineHelpers): KeyFigure | null {
  const projects = metricCount(result, "planned_projects", "건");
  if (projects === null) return null;
  return {
    question: "반경 계획·공사 사업",
    answer: { value: projects, kind: "number" },
    stats: statList([[metricText(result, "nearest_planned_station_m", helpers), "최근접 계획역(직선)"]]),
  };
}

export const a10ClientModule = {
  code: "A10",
  baseSuppress: ["rail", "station"],
  headline: { ids: ["planned_projects"] },
  keyFigureFor: a10KeyFigure,
  layers: {
    options: [{ id: "all", label: "기본 계획" }],
  },
} satisfies TileClientModule;

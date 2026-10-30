import type { TileResult } from "../../tile-result";
import { countText, metricCount, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

const STAGE_PREFIX = "단계: ";

/** 단계가 확인된 사업 중 많은 두 단계. 단계를 모르는 사업(「미확인」)은 순위에서 뺀다. */
function a09KeyFigure(result: TileResult): KeyFigure | null {
  const projects = metricCount(result, "projects_in_radius", "건");
  if (projects === null) return null;
  const stages = result.metrics
    .filter((metric) => /^stage_\d+$/.test(metric.id) && metric.label.startsWith(STAGE_PREFIX) && metric.value !== null)
    .map((metric) => ({ name: metric.label.slice(STAGE_PREFIX.length), count: metric.value as number }))
    .filter((stage) => stage.name !== "미확인" && stage.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
  const known = result.metrics.find((metric) => metric.id === "fill_stage_pct")?.numerator;
  return {
    question: "반경 정비사업",
    answer: { value: projects, kind: "number" },
    ...(known == null ? {} : { sub: `단계가 확인된 ${countText(known, "건")} 중 상위 2` }),
    stats: statList([
      ...stages.map((stage) => [countText(stage.count, "건"), `${stage.name} 단계`] as const),
      [metricCount(result, "zones_in_radius", "곳"), "교차 정비구역"],
    ]),
  };
}

export const a09ClientModule = {
  code: "A09",
  chart: { subject: "정비사업", countUnit: "건" },
  headline: { ids: ["projects_in_radius", "zones_in_radius", "roster_projects"] },
  keyFigureFor: a09KeyFigure,
  layers: {
    options: [{ id: "all", label: "기본 정비" }, { id: "maintenance_stage", label: "사업 단계" }],
  },
} satisfies TileClientModule;

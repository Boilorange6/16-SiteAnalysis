import type { TileResult } from "../../tile-result";
import { metricCount, metricText, radiusLabel, statList } from "../key-figure";
import type { KeyFigure, TileClientModule, TileHeadlineHelpers } from "../types";
import { ASSIGNED_SCHOOL_SUBLABEL } from "./labels";

function a02KeyFigure(result: TileResult, helpers: TileHeadlineHelpers): KeyFigure | null {
  const distance = metricText(result, "nearest_elem_m", helpers);
  if (distance === null) return null;
  const radius = radiusLabel(result.conditions.radiusM);
  const school = result.presentation.features?.find((feature) => feature.layer === "school_nearest")?.name;
  const zone = result.metrics.find((metric) => metric.id === "in_school_zone");
  // 대지가 통학구역 안이고 배정 초등학교 지물이 있으면 셋째 칸은 안/밖 대신 그 학교 이름이다(맞춤은 세 칸 함께, `keyFigureFit`).
  // 공동학구(배정 2곳 이상)면 대지에서 가장 가까운 배정 학교 이름 + 이름표 「통학구역 배정 · 외 n곳」(T14b-1).
  const assignedAll = zone?.status === "observed" && zone.value === 1
    ? (result.presentation.features ?? []).filter((feature) => feature.sublabel?.startsWith(ASSIGNED_SCHOOL_SUBLABEL) && feature.name)
    : [];
  const assigned = assignedAll.reduce<(typeof assignedAll)[number] | undefined>((best, feature) => (!best || (feature.distanceM ?? Infinity) < (best.distanceM ?? Infinity) ? feature : best), undefined)?.name;
  const assignedLabel = assignedAll.length > 1 ? `${ASSIGNED_SCHOOL_SUBLABEL} · 외 ${assignedAll.length - 1}곳` : ASSIGNED_SCHOOL_SUBLABEL;
  return {
    question: "가장 가까운 초등학교",
    answer: { value: distance, ...(school ? { target: school } : {}), kind: "number" },
    stats: statList([
      [metricCount(result, "elem_schools", "개교"), `${radius} 안 초등학교`],
      [metricCount(result, "middle_schools", "개교"), `${radius} 안 중학교`],
      assigned ? [assigned, assignedLabel] : [zone?.status === "observed" ? (zone.value === 1 ? "안" : "밖") : null, "대지 초등 통학구역"],
    ]),
  };
}

export const a02ClientModule = {
  code: "A02",
  chart: { subject: "학교", countUnit: "곳" },
  headline: { ids: ["in_school_zone", "nearest_elem_m"] },
  keyFigureFor: a02KeyFigure,
  headlineFor: (result) => {
    const zone = result.metrics.find((metric) => metric.id === "in_school_zone");
    const asOf = result.provenance.sources.find((source) => source.sourceId === "school_zone")?.sourceAsOf;
    const inside = zone?.status === "observed" ? (zone.value === 1 ? "통학구역 안" : "통학구역 밖") : "통학구역 미확인";
    return { headline: { value: inside, label: "대지 기준", aux: `학구도 기준일 ${asOf ?? "미확인"}` }, metricId: "in_school_zone" };
  },
  rowsExclude: ["in_school_zone"],
  caveat: "배정은 교육청 확인",
  layers: {
    options: [{ id: "all", label: "기본 학교" }, { id: "school_zone", label: "학구·학교군" }],
    baseExcludes: ["school_zone"],
  },
} satisfies TileClientModule;

import type { TileClientModule } from "../types";

export const a02ClientModule = {
  code: "A02",
  chart: { subject: "학교", countUnit: "곳" },
  headline: { ids: ["in_school_zone", "nearest_elem_m"] },
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

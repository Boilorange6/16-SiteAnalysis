import type { TileClientModule } from "../types";

export const a12ClientModule = {
  code: "A12",
  headline: { ids: ["share_class_1", "mixed_zone_share_pct", "site_zoning_count"] },
  parameterBadges: [
    { metricId: "site_zoning_count", prefix: "중심점 지정", note: "대지 중심점이 들어간 용도지역 도형 수입니다. 지정의 적합성 판정이 아닙니다." },
  ],
  headlineFor: (result, helpers) => {
    const zoning = result.presentation.features?.find((feature) => feature.layer === "zoning_site")?.label;
    const selected = zoning ? null : helpers.policyMetric();
    if (zoning) return { headline: { value: zoning, label: "대지 중심점 용도지역" }, metricId: "site_zoning_label" };
    if (!selected) return null;
    const row = helpers.metricRow(selected);
    return { headline: { value: row.value, label: row.label, aux: row.aux, tag: row.tag }, metricId: selected.id };
  },
  layers: {
    options: [{ id: "all", label: "기본 토지" }, { id: "zoning_detail", label: "용도지역" }],
  },
} satisfies TileClientModule;

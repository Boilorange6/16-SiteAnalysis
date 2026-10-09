import type { TileClientModule } from "../types";

export const a12ClientModule = {
  code: "A12",
  headline: { ids: ["share_class_1", "site_zoning_count"] },
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
    // 기본 토지와 용도지역은 같은 지도 내용이므로 단일 선택지를 노출하지 않는다.
    options: [{ id: "all", label: "기본 토지" }],
  },
} satisfies TileClientModule;

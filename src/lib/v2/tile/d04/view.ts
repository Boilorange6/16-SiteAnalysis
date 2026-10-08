import type { TileResult } from "../../tile-result";
import type { Metric, TileClientModule, TileHeadlineHelpers } from "../types";

function d04HeadlineMetric(metrics: readonly Metric[]): Metric | null {
  const parts = ["share_pre1980", "share_1980s", "share_1990s"].map((id) => metrics.find((metric) => metric.id === id));
  if (parts.every((metric) => metric?.value === null || metric === undefined)) return null;
  const value = parts.reduce((sum, metric) => sum + (typeof metric?.value === "number" ? metric.value : 0), 0);
  const status = parts.some((metric) => metric?.status === "estimated") ? "estimated" : "observed";
  return {
    id: "share_pre2000",
    label: "1990년대 이전 준공",
    value,
    unit: "%",
    formulaVersion: "ui-headline@1:1979년 이하+1980년대+1990년대",
    numerator: null,
    denominator: null,
    status,
  };
}

function headlineForD04(result: TileResult, helpers: TileHeadlineHelpers) {
  const selected = d04HeadlineMetric(result.metrics) ?? helpers.policyMetric();
  if (!selected) return null;
  const row = helpers.metricRow(selected);
  return { headline: { value: row.value, label: row.label, aux: row.aux, tag: row.tag }, metricId: selected.id };
}

export const d04ClientModule = {
  code: "D04",
  headline: { ids: ["share_pre2000", "share_pre1980", "share_1990s"] },
  parameterBadges: [
    { metricId: "confirmed_share_pct", prefix: "확인율", note: "사용승인일이 확인된 건물의 비율입니다. 준공 연대 분포 자체와는 다른 보조 지표입니다." },
  ],
  headlineFor: headlineForD04,
  mapNote: "건물 발자국 · 준공 연대별 색",
} satisfies TileClientModule;

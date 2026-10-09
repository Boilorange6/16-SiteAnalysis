import type { TileResult } from "../../tile-result";
import type { Metric, TileClientModule, TileHeadlineHelpers } from "../types";

function d04HeadlineMetric(metrics: readonly Metric[]): Metric | null {
  const parts = ["share_pre1980", "share_1980s", "share_1990s"].map((id) => metrics.find((metric) => metric.id === id));
  if (parts.every((metric) => metric?.value === null || metric === undefined)) return null;
  const countParts = parts.filter((metric): metric is Metric => metric !== undefined
    && typeof metric.numerator === "number"
    && Number.isFinite(metric.numerator)
    && typeof metric.denominator === "number"
    && Number.isFinite(metric.denominator)
    && metric.denominator > 0);
  const counted = countParts.length === parts.length;
  const denominator = counted ? countParts[0]?.denominator ?? null : null;
  const sameDenominator = counted && denominator !== null && countParts.every((metric) => metric.denominator === denominator);
  const numerator = sameDenominator ? countParts.reduce((sum, metric) => sum + (metric.numerator ?? 0), 0) : null;
  const value = sameDenominator
    ? Math.round((numerator! / denominator!) * 1000) / 10
    : Math.round(parts.reduce((sum, metric) => sum + (typeof metric?.value === "number" ? metric.value : 0), 0) * 10) / 10;
  const status = parts.some((metric) => metric?.status === "estimated") ? "estimated" : "observed";
  return {
    id: "share_pre2000",
    label: "2000년 이전 준공",
    value,
    unit: "%",
    formulaVersion: "ui-headline@2:1979년 이하+1980년대+1990년대 count 합÷공통 분모",
    numerator,
    denominator,
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

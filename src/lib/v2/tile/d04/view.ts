import type { TileResult } from "../../tile-result";
import { countText, metricPercent, percentText, statList } from "../key-figure";
import type { KeyFigure, Metric, TileClientModule, TileHeadlineHelpers } from "../types";

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

/**
 * 몫(2000년 이전 준공)의 분모는 사용승인일을 모르는 건물까지 포함한 반경 전체 건물이다(그래프의 구성비와 같은 분모).
 * 그래서 사용승인일 확인률을 보조 숫자로 함께 싣는다.
 */
function d04KeyFigure(result: TileResult): KeyFigure | null {
  const share = d04HeadlineMetric(result.metrics);
  if (share?.value == null) return null;
  const sub = share.numerator !== null && share.denominator !== null ? `반경 건물 ${countText(share.denominator, "동")} 중 ${countText(share.numerator, "동")}` : undefined;
  return {
    question: "2000년 이전 준공",
    answer: { value: percentText(share.value), kind: "number" },
    ...(sub ? { sub } : {}),
    stats: statList([
      [metricPercent(result, "confirmed_share_pct"), "사용승인일 확인률"],
      [metricPercent(result, "share_1980s"), "1980년대"],
      [metricPercent(result, "share_1990s"), "1990년대"],
    ]),
  };
}

export const d04ClientModule = {
  code: "D04",
  chart: { subject: "건물", countUnit: "동", missingLabel: "연도 미상" },
  autoLabels: false,
  headline: { ids: ["share_pre2000", "share_pre1980", "share_1990s"] },
  parameterBadges: [
    { metricId: "confirmed_share_pct", prefix: "확인율", note: "사용승인일이 확인된 건물의 비율입니다. 준공 연대 분포 자체와는 다른 보조 지표입니다." },
  ],
  headlineFor: headlineForD04,
  keyFigureFor: d04KeyFigure,
  mapNote: "건물 발자국 · 준공 연대별 색",
} satisfies TileClientModule;

import type { TileResult } from "../../tile-result";
import { countText, metricNumber, percentText, radiusLabel } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

const USE_PREFIX = "구성비: ";

/** 몫(%)은 용도가 확인된 건물 수를 분모로 한다. 분모와 동수는 엔진이 지표에 적은 분자·분모에서 읽는다. */
function d03KeyFigure(result: TileResult): KeyFigure | null {
  const fill = result.metrics.find((metric) => metric.id === "fill_use_pct");
  const total = fill?.denominator ?? null;
  const known = fill?.numerator ?? null;
  if (total === null || known === null || known <= 0) return null;
  // 용도 미상(share_use_10)은 순위에서 뺀다.
  const uses = result.metrics
    .filter((metric) => metric.id.startsWith("share_use_") && metric.id !== "share_use_10" && metric.numerator !== null)
    .map((metric) => ({ name: metric.label.startsWith(USE_PREFIX) ? metric.label.slice(USE_PREFIX.length) : metric.label, count: metric.numerator as number }))
    .sort((a, b) => b.count - a.count);
  const top = uses[0];
  if (!top) return null;
  const second = uses[1];
  const unknown = result.metrics.find((metric) => metric.id === "share_use_10")?.numerator ?? null;
  const stats: KeyFigure["stats"] = [{ value: countText(total, "동"), label: `${radiusLabel(result.conditions.radiusM)} 안 건물` }];
  if (second && second.count > 0) stats.push({ value: percentText((second.count / known) * 100), label: `${second.name} · ${countText(second.count, "동")}` });
  if (unknown !== null) stats.push({ value: percentText((unknown / total) * 100), label: `용도 미상 · ${countText(unknown, "동")}` });
  return {
    question: "가장 많은 건물 용도",
    answer: { pre: top.name, value: percentText((top.count / known) * 100), kind: "number" },
    sub: `용도가 확인된 ${countText(known, "동")} 중 ${countText(top.count, "동")}`,
    stats,
  };
}

export const d03ClientModule = {
  code: "D03",
  chart: { subject: "건물", countUnit: "동" },
  autoLabels: false,
  headline: { ids: ["share_use_1", "share_use_2", "share_use_3", "share_use_4", "share_use_5", "share_use_6", "share_use_7", "share_use_8", "share_use_9"] },
  headlineFor: (result, helpers) => {
    const candidates = result.metrics.filter((metric) => metric.id.startsWith("share_use_") && metric.id !== "share_use_10");
    const selected = candidates
      .filter((metric) => metric.value !== null)
      .sort((a, b) => (b.value as number) - (a.value as number))[0] ?? candidates[0];
    if (!selected) return null;
    const row = helpers.metricRow(selected);
    return { headline: { value: row.value, label: row.label, aux: row.aux, tag: row.tag }, metricId: selected.id };
  },
  keyFigureFor: d03KeyFigure,
} satisfies TileClientModule;

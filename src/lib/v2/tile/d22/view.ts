import type { TileClientModule } from "../types";
import { DIR16_KO_NAMES, DIR16_NAMES } from "../../ui/wind-rose";
import { d22CutModule } from "./cut";

const formatPercent = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

function d22HeadlineFor(result: Parameters<NonNullable<TileClientModule["headlineFor"]>>[0], helpers: Parameters<NonNullable<TileClientModule["headlineFor"]>>[1]) {
  const prevailing = result.metrics.find((metric) => metric.id === "prevailing_dir_deg");
  if (prevailing?.status !== "missing" && prevailing?.status !== "not_applicable" && prevailing?.status !== "suppressed" && typeof prevailing?.value === "number" && Number.isFinite(prevailing.value) && typeof prevailing.numerator === "number" && typeof prevailing.denominator === "number" && prevailing.denominator > 0) {
    const index = ((Math.round(prevailing.value / 22.5) % 16) + 16) % 16;
    const pct = (prevailing.numerator / prevailing.denominator) * 100;
    return {
      headline: { value: `최빈 풍향 ${DIR16_KO_NAMES[index]}(${DIR16_NAMES[index]}) ${formatPercent(pct)}%`, label: "최빈 풍향" },
      metricId: prevailing.id,
    };
  }
  const selected = helpers.policyMetric();
  if (!selected) return null;
  const row = helpers.metricRow(selected);
  return { headline: { value: row.value, label: row.label, aux: row.aux, tag: row.tag }, metricId: selected.id };
}

export const d22ClientModule = {
  code: "D22",
  headline: { ids: ["prevailing_dir_deg", "station_distance_m"] },
  headlineFor: d22HeadlineFor,
  mapNote: "ASOS 최근접 관측소 · 연간·계절 16방위 바람장미",
  cut: d22CutModule,
} satisfies TileClientModule;

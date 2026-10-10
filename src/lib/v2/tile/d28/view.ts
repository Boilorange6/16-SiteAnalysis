import type { TileClientModule } from "../types";

const AREA_METRIC_IDS = new Set(["area_5min_km2", "area_10min_km2", "area_15min_km2"]);

function formatAreaMetricValue(value: number): string {
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km²`;
}

export const d28ClientModule = {
  code: "D28",
  headline: { ids: ["area_10min_km2", "reach_ratio_10min_pct"] },
  sentenceFor: (result, sentence) => {
    const area = result.metrics.find((metric) => metric.id === "area_10min_km2");
    const areaText = area?.value === null || area?.value === undefined ? null : formatAreaMetricValue(area.value);
    return areaText ? sentence.replace(/(도보 10분(?:\([^)]*\))? 도달 면적 )[^ (]+(?:\s*(?:㎢|km²))?/, `$1${areaText}`) : sentence;
  },
  view: (base, result) => {
    if (!result) return base;
    const areaTextById = new Map<string, string>();
    const areaTextByLabel = new Map<string, string>();
    for (const metric of result.metrics) {
      if (!AREA_METRIC_IDS.has(metric.id) || metric.value === null) continue;
      const value = formatAreaMetricValue(metric.value);
      areaTextById.set(metric.id, value);
      areaTextByLabel.set(metric.label, value);
    }
    const rows = base.rows.map((row) => {
      const value = areaTextByLabel.get(row.label);
      return value ? { ...row, value } : row;
    });
    const headlineValue = base.headlineMetricId ? areaTextById.get(base.headlineMetricId) : undefined;
    return {
      ...base,
      rows,
      headline: headlineValue && base.headline ? { ...base.headline, value: headlineValue } : base.headline,
    };
  },
  mapNote: "OSM 보행망 · 80 m/분 · 내부 제안 기준",
} satisfies TileClientModule;

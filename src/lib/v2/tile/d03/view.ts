import type { TileClientModule } from "../types";

export const d03ClientModule = {
  code: "D03",
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
} satisfies TileClientModule;

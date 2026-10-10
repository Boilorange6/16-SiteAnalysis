import type { TileResult } from "../../tile-result";
import type { TileView } from "../../ui/tile-view";
import type { RasterMap } from "../cut-utils";
import type { TileClientModule } from "../types";
import { s04CutModule } from "./cut";

function applyS04View(base: TileView, result?: TileResult): TileView {
  if (!result) return base;
  const representative = (metric: TileResult["metrics"][number]) => metric.id.endsWith("_summer_h14");
  const orderedMetrics = [
    ...result.metrics.filter(representative),
    ...result.metrics.filter((metric) => /_(spring|summer|autumn|winter)_h\d+$/.test(metric.id) && !representative(metric)),
  ];
  const rowsByLabel = new Map<string, TileView["rows"]>();
  for (const row of base.rows) rowsByLabel.set(row.label, [...(rowsByLabel.get(row.label) ?? []), row]);
  const orderedRows: TileView["rows"] = [];
  for (const metric of orderedMetrics) {
    const rows = rowsByLabel.get(metric.label);
    const row = rows?.shift();
    if (row) orderedRows.push(row);
  }
  if (!base.map) return { ...base, rows: orderedRows };
  const model = base.map as RasterMap;
  const options = model.rasterOptions ?? model.rasters ?? [];
  const selected = options.find((ref) => ref.name === "utci_summer_h14") ?? options[0];
  if (!selected) return { ...base, rows: orderedRows };
  const nextMap: RasterMap = { ...model, rasters: [selected], defaultRaster: selected.name };
  return { ...base, rows: orderedRows, map: nextMap };
}

function metricFilter(metric: TileResult["metrics"][number]): boolean {
  return metric.id.endsWith("_summer_h14") || /_(spring|summer|autumn|winter)_h\d+$/.test(metric.id);
}

export const s04ClientModule = {
  code: "S04",
  headline: { ids: ["utci_median_summer_h14", "shade_pct_summer_h14"] },
  caveat: "UTCI 근사 · 계절×시각 대표 기상 · 자리끼리 비교",
  modelBadge: "근사 · 건강 위험 예측 아님",
  metricFilter,
  view: applyS04View,
  cut: s04CutModule,
} satisfies TileClientModule;

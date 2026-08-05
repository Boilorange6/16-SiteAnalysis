import { CATEGORY_LABELS, type PoiCategory } from "./types";

export type PptLegendItem = {
  readonly label: string;
  readonly color: string;
};

export const PLANNED_RAIL_LEGEND_ITEM = {
  label: "예정 철도 (개략)",
  color: "#0F172A",
} as const satisfies PptLegendItem;

const CATEGORY_LEGEND_KEYS = [
  "subway",
  "school",
  "park",
  "mountain",
  "apartment",
  "officetel",
  "residential",
  "maintenance",
] as const satisfies readonly PoiCategory[];

export function buildPptLegendItems(
  categoryColors: Readonly<Record<PoiCategory, string>>,
  hasPlannedRail: boolean,
): readonly PptLegendItem[] {
  const items = CATEGORY_LEGEND_KEYS.map((key) => ({
    label: CATEGORY_LABELS[key],
    color: categoryColors[key],
  }));
  return hasPlannedRail ? [...items, PLANNED_RAIL_LEGEND_ITEM] : items;
}

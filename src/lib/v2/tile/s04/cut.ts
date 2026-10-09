import type { TileView } from "../../ui/tile-view";
import type { TileCutCandidate, TileCutModule, TileCutPlan } from "../types";
import { CUT_SEASON_LABEL, CUT_SEASONS } from "../cut-common";
import { isRecord, rasterCell, rasterNames, viewWithOnlyRaster } from "../cut-utils";

export type S04Cut = { tile: "S04"; mode: "single" | "seasons4" | "hours3"; season?: (typeof CUT_SEASONS)[number]; hour?: 10 | 14 | 18 };

export function isS04Cut(value: unknown): value is S04Cut {
  return isRecord(value)
    && value.tile === "S04"
    && (value.mode === "single" || value.mode === "seasons4" || value.mode === "hours3")
    && (value.season === undefined || CUT_SEASONS.includes(value.season as (typeof CUT_SEASONS)[number]))
    && (value.hour === undefined || value.hour === 10 || value.hour === 14 || value.hour === 18);
}

function ready(view: TileView, value: unknown): boolean {
  if (!isS04Cut(value)) return false;
  const names = rasterNames(view);
  const season = value.season ?? "summer";
  if (value.mode === "seasons4") return CUT_SEASONS.every((candidate) => names.has(`utci_${candidate}_h14`));
  if (value.mode === "hours3") return [10, 14, 18].every((hour) => names.has(`utci_${season}_h${hour}`));
  return names.has(`utci_${season}_h${value.hour ?? 14}`);
}

function candidates(view: TileView): TileCutCandidate[] {
  return [
    ...CUT_SEASONS.flatMap((season) => ([10, 14, 18] as const).map((hour) => ({ cut: { tile: "S04", mode: "single", season, hour }, label: `단일 · ${CUT_SEASON_LABEL[season]} ${hour}시`, disabled: false }))),
    ...CUT_SEASONS.map((season) => ({ cut: { tile: "S04", mode: "hours3", season }, label: `정시 3컷 · ${CUT_SEASON_LABEL[season]}`, disabled: false })),
    { cut: { tile: "S04", mode: "seasons4" }, label: "계절 4컷 · 14시", disabled: false },
  ].map((candidate) => ({ ...candidate, disabled: !ready(view, candidate.cut) }));
}

function note(value: unknown): string | undefined {
  if (!isS04Cut(value)) return undefined;
  return `${CUT_SEASON_LABEL[value.season ?? "summer"]} ${value.hour ?? 14}시`;
}

function firstRaster(view: TileView, value: unknown): string | null {
  if (!isS04Cut(value)) return null;
  const season = value.season ?? "summer";
  const name = value.mode === "seasons4" ? "utci_summer_h14" : value.mode === "hours3" ? `utci_${season}_h14` : `utci_${season}_h${value.hour ?? 14}`;
  return rasterNames(view).has(name) ? name : null;
}

function viewForCut(view: TileView, value: unknown): TileView {
  const name = firstRaster(view, value);
  return name ? viewWithOnlyRaster(view, name, note(value) ?? "") : view;
}

function plan(view: TileView, value: unknown): TileCutPlan {
  if (!isS04Cut(value)) return { sheets: [], single: { view, mapKey: `${view.tileId}:utci` } };
  const season = value.season ?? "summer";
  if (value.mode === "seasons4" && ready(view, value)) {
    const cells = CUT_SEASONS.map((candidate) => `utci_${candidate}_h14`)
      .map((name) => rasterCell(view, name, `${CUT_SEASON_LABEL[name.split("_")[1] as (typeof CUT_SEASONS)[number]]} 14시`, name));
    return { sheets: [{ grid: "2x2", cells }] };
  }
  if (value.mode === "hours3" && ready(view, value)) {
    const cells = [10, 14, 18].map((hour) => {
      const name = `utci_${season}_h${hour}`;
      return rasterCell(view, name, `${CUT_SEASON_LABEL[season]} ${hour}시`, name);
    });
    return { sheets: [{ grid: "3x1", cells }] };
  }
  const name = `utci_${season}_h${value.hour ?? 14}`;
  return { sheets: [], single: { view: viewForCut(view, value), mapKey: `${view.tileId}:${name}`, rasterName: name } };
}

export const s04CutModule: TileCutModule = {
  default: () => ({ tile: "S04", mode: "single", season: "summer", hour: 14 }),
  isValid: isS04Cut,
  ready,
  candidates,
  note,
  firstRaster,
  view: viewForCut,
  plan,
};

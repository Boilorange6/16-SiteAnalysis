import type { RoseSeason } from "../../tile-result";
import type { TileView } from "../../ui/tile-view";
import type { TileCutCandidate, TileCutModule, TileCutPlan } from "../types";
import { CUT_SEASON_LABEL, CUT_SEASONS } from "../cut-common";
import { rasterCell, roseCell } from "../cut-utils";

export type D22Cut = { tile: "D22"; mode: "annual" | "seasons4" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function isD22Cut(value: unknown): value is D22Cut {
  return isRecord(value) && value.tile === "D22" && (value.mode === "annual" || value.mode === "seasons4");
}

function ready(view: TileView, value: unknown): boolean {
  return isD22Cut(value) && (value.mode === "annual" ? !!view.rose : CUT_SEASONS.every((season) => !!view.roses?.[season]));
}

function candidates(view: TileView): TileCutCandidate[] {
  return [
    { cut: { tile: "D22", mode: "annual" }, label: "연간", disabled: !ready(view, { tile: "D22", mode: "annual" }) },
    { cut: { tile: "D22", mode: "seasons4" }, label: "계절 4컷", disabled: !ready(view, { tile: "D22", mode: "seasons4" }) },
  ];
}

function note(value: unknown): string | undefined {
  if (!isD22Cut(value)) return undefined;
  return value.mode === "seasons4" ? "계절 4컷" : "연간";
}

function viewForCut(view: TileView, value: unknown): TileView {
  if (!isD22Cut(value)) return view;
  if (value.mode === "annual") return { ...view, rose: view.rose ?? null };
  const label = note(value)!;
  return { ...view, notes: [label, ...view.notes.filter((existing) => existing !== label)] };
}

function plan(view: TileView, value: unknown): TileCutPlan {
  if (!isD22Cut(value)) return { sheets: [], single: { view, mapKey: `${view.tileId}:rose` } };
  if (value.mode === "seasons4" && ready(view, value)) {
    const cells = CUT_SEASONS.map((season) => roseCell(view, season, CUT_SEASON_LABEL[season], season));
    return { sheets: [{ grid: "2x2", cells }] };
  }
  const annual = roseCell(view, "annual", CUT_SEASON_LABEL.annual, "annual");
  return { sheets: [], single: { ...annual, view: viewForCut(view, value), mapKey: `${view.tileId}:rose` } };
}

export const d22CutModule: TileCutModule = {
  default: () => ({ tile: "D22", mode: "annual" }),
  isValid: isD22Cut,
  legacyForSeason: (season: RoseSeason) => ({ tile: "D22", mode: season === "annual" ? "annual" : "seasons4" }),
  ready,
  candidates,
  note,
  view: viewForCut,
  plan,
};

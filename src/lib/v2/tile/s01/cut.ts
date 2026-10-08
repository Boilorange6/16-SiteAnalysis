import type { TileView } from "../../ui/tile-view";
import type { TileCutCandidate, TileCutModule, TileCutPlan } from "../types";

export const S01_MASS_LABEL = "S01 3D 매스";
export type S01Cut = { tile: "S01"; mode: "mass" | "exploded" };

const S01_DEFAULT: S01Cut = { tile: "S01", mode: "mass" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function isS01Cut(value: unknown): value is S01Cut {
  return isRecord(value) && value.tile === "S01" && (value.mode === "mass" || value.mode === "exploded");
}

function ready(view: TileView, value: unknown): boolean {
  return isS01Cut(value) && !!view.mass;
}

function candidates(): TileCutCandidate[] {
  return [
    { cut: { ...S01_DEFAULT }, label: "기본 매스", disabled: false },
    { cut: { tile: "S01", mode: "exploded" }, label: "분해 매스", disabled: false },
  ];
}

function note(value: unknown): string | undefined {
  if (!isS01Cut(value)) return undefined;
  return value.mode === "exploded" ? "분해 매스" : "기본 매스";
}

function viewForCut(view: TileView, value: unknown): TileView {
  if (!isS01Cut(value)) return view;
  const cutNote = note(value)!;
  const mass = view.mass
    ? {
        ...view.mass,
        ...(value.mode === "exploded" ? { exploded: { spreadPct: 100, scheme: "use" as const } } : { exploded: undefined }),
      }
    : null;
  return {
    ...view,
    ...(mass ? { mass } : {}),
    notes: [cutNote, ...view.notes.filter((existing) => existing !== "기본 매스" && existing !== "분해 매스")],
  };
}

function plan(view: TileView, value: unknown): TileCutPlan {
  if (!isS01Cut(value)) return { sheets: [], single: { view, mapKey: `${view.tileId}:mass` } };
  const mass = view.mass
    ? { ...view.mass, ...(value.mode === "exploded" ? { exploded: { spreadPct: 24, scheme: "use" as const } } : { exploded: undefined }) }
    : undefined;
  return { sheets: [], single: { view: viewForCut(view, value), mapKey: `${view.tileId}:mass`, mass } };
}

export const s01CutModule: TileCutModule = {
  default: () => ({ ...S01_DEFAULT }),
  isValid: isS01Cut,
  ready,
  candidates: (view) => candidates().map((candidate) => ({ ...candidate, disabled: !ready(view, candidate.cut) })),
  note,
  view: viewForCut,
  plan,
};

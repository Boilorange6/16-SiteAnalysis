import type { TileView } from "../../ui/tile-view";
import type { TileCutCandidate, TileCutModule, TileCutPlan } from "../types";
import { CUT_SEASON_LABEL, CUT_SEASONS, CUT_WIND_SEASONS } from "../cut-common";
import { isRecord, rasterCell, rasterNames, rasterRefs, viewWithOnlyRaster } from "../cut-utils";

export type S03Cut = { tile: "S03"; mode: "single" | "seasons4"; layerZ: number; season?: (typeof CUT_WIND_SEASONS)[number] };

export function isS03Cut(value: unknown): value is S03Cut {
  return isRecord(value)
    && value.tile === "S03"
    && (value.mode === "single" || value.mode === "seasons4")
    && typeof value.layerZ === "number"
    && Number.isFinite(value.layerZ)
    && value.layerZ >= 0
    && (value.season === undefined || CUT_WIND_SEASONS.includes(value.season as (typeof CUT_WIND_SEASONS)[number]));
}

export function windRasterName(view: TileView, layerZ: number): string | null {
  const suffix = `_z${String(Math.round(layerZ)).padStart(2, "0")}`;
  const refs = rasterRefs(view);
  return refs.find((ref) => ref.name === `wind_annual${suffix}`)?.name
    ?? refs.find((ref) => ref.name.startsWith("wind_") && ref.name.endsWith(suffix))?.name
    ?? null;
}

function ready(view: TileView, value: unknown): boolean {
  if (!isS03Cut(value)) return false;
  const names = rasterNames(view);
  const layer = String(Math.round(value.layerZ)).padStart(2, "0");
  if (value.mode === "seasons4") return CUT_SEASONS.every((season) => names.has(`wind_${season}_z${layer}`));
  return value.season === "annual" || value.season === undefined
    ? !!windRasterName(view, value.layerZ)
    : names.has(`wind_${value.season}_z${layer}`);
}

function candidates(view: TileView, current?: unknown): TileCutCandidate[] {
  const layerZ = isS03Cut(current) ? current.layerZ : 6;
  return [
    ...CUT_WIND_SEASONS.map((season) => ({ cut: { tile: "S03", mode: "single", layerZ, season }, label: `단일 · ${CUT_SEASON_LABEL[season]}`, disabled: false })),
    { cut: { tile: "S03", mode: "seasons4", layerZ }, label: "계절 4컷", disabled: false },
  ].map((candidate) => ({ ...candidate, disabled: !ready(view, candidate.cut) }));
}

function note(value: unknown): string | undefined {
  if (!isS03Cut(value)) return undefined;
  return `${CUT_SEASON_LABEL[value.season ?? "annual"]} ${Math.round(value.layerZ)}m`;
}

function firstRaster(view: TileView, value: unknown): string | null {
  if (!isS03Cut(value)) return null;
  const layer = String(Math.round(value.layerZ)).padStart(2, "0");
  return value.season === "annual" || value.season === undefined
    ? windRasterName(view, value.layerZ)
    : value.mode === "seasons4" ? `wind_summer_z${layer}` : `wind_${value.season}_z${layer}`;
}

function viewForCut(view: TileView, value: unknown): TileView {
  const name = firstRaster(view, value);
  return name ? viewWithOnlyRaster(view, name, note(value) ?? "") : view;
}

function plan(view: TileView, value: unknown): TileCutPlan {
  if (!isS03Cut(value)) return { sheets: [], single: { view, mapKey: `${view.tileId}:wind` } };
  const layer = String(Math.round(value.layerZ)).padStart(2, "0");
  if (value.mode === "seasons4" && ready(view, value)) {
    const cells = CUT_SEASONS.map((season) => `wind_${season}_z${layer}`)
      .map((name) => rasterCell(view, name, `${CUT_SEASON_LABEL[name.split("_")[1] as (typeof CUT_SEASONS)[number]]} ${value.layerZ}m`, name));
    return { sheets: [{ grid: "2x2", cells }] };
  }
  return { sheets: [], single: { view: viewForCut(view, value), mapKey: `${view.tileId}:wind-${value.season ?? "annual"}-${layer}` } };
}

export const s03CutModule: TileCutModule = {
  default: () => ({ tile: "S03", mode: "single", layerZ: 6, season: "annual" }),
  isValid: isS03Cut,
  ready,
  candidates,
  note,
  firstRaster,
  view: viewForCut,
  plan,
};

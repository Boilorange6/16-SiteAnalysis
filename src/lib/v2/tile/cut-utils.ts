import type { RasterRef, RoseSeason } from "../tile-result";
import type { TileView } from "../ui/tile-view";
import type { TileCutCell } from "./types";

export type RasterMap = NonNullable<TileView["map"]> & { defaultRaster?: string; rasterOptions?: RasterRef[] };

/** 컷 입력의 선택적 매개변수를 읽을 때 쓰는 공용 JSON 객체 판정. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export const rasterRefs = (view: TileView): RasterRef[] => {
  const map = view.map as RasterMap | null;
  return [...new Map((map?.rasterOptions ?? map?.rasters ?? []).map((ref) => [ref.name, ref])).values()];
};

export const rasterNames = (view: TileView): Set<string> => new Set(rasterRefs(view).map((ref) => ref.name));

export function viewWithOnlyRaster(view: TileView, rasterName: string, note: string): TileView {
  if (!view.map) return view;
  const model = view.map as RasterMap;
  const selected = rasterRefs(view).find((ref) => ref.name === rasterName);
  if (!selected) return view;
  const nextMap: RasterMap = {
    ...model,
    rasters: [selected],
    defaultRaster: selected.name,
    ...(note && !model.notes.includes(note) ? { notes: [...model.notes, note] } : {}),
  };
  return note
    ? { ...view, notes: [note, ...view.notes.filter((existing) => existing !== note)], map: nextMap }
    : { ...view, map: nextMap };
}

export function rasterCell(view: TileView, name: string, note: string, key: string): TileCutCell {
  return { view: viewWithOnlyRaster(view, name, note), mapKey: `${view.tileId}:${key}`, rasterName: name };
}

export function roseCell(view: TileView, season: RoseSeason, label: string, key: string): TileCutCell {
  const model = season === "annual" ? view.rose : view.roses?.[season];
  const next = model
    ? { ...view, rose: model, notes: [label, ...view.notes.filter((note) => note !== label)] }
    : view;
  return { view: next, mapKey: `${view.tileId}:rose-${key}`, rose: model ?? undefined, roseSeason: season };
}

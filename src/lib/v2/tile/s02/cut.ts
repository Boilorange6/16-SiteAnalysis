import type { RasterRef, TileResult } from "../../tile-result";
import type { TileView } from "../../ui/tile-view";
import type { TileClientModule, TileCutCandidate, TileCutCell, TileCutModule, TileCutPlan } from "../types";
import { viewWithOnlyRasterForS02 } from "./view";

export const S02_DATE_KEYS = ["spring", "summer", "autumn", "winter", "analysis"] as const;
export type S02DateKey = (typeof S02_DATE_KEYS)[number];
export type S02Cut = { tile: "S02"; mode: "single" | "hours3" | "seasons4" | "flow"; date?: S02DateKey };

const S02_DATE_LABEL: Record<S02DateKey, string> = {
  spring: "춘분",
  summer: "하지",
  autumn: "추분",
  winter: "동지",
  analysis: "분석일",
};
const S02_SEASONS = ["spring", "summer", "autumn", "winter"] as const;
const S02_DEFAULT: S02Cut = { tile: "S02", mode: "single", date: "winter" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function isS02Cut(value: unknown): value is S02Cut {
  if (!isRecord(value) || value.tile !== "S02") return false;
  if (value.mode !== "single" && value.mode !== "hours3" && value.mode !== "seasons4" && value.mode !== "flow") return false;
  return value.date === undefined || S02_DATE_KEYS.includes(value.date as S02DateKey);
}

type RasterMap = NonNullable<TileView["map"]> & { rasterOptions?: RasterRef[] };

const rasterRefs = (view: TileView): RasterRef[] => {
  const map = view.map as RasterMap | null;
  return map?.rasterOptions ?? map?.rasters ?? [];
};

const rasterNames = (view: TileView): Set<string> => new Set(rasterRefs(view).map((ref) => ref.name));

const hoursFor = (view: TileView, date: S02DateKey): string[] => rasterRefs(view)
  .map((ref) => ref.name)
  .filter((name) => name.startsWith(`shade_${date}_h`))
  .sort((a, b) => Number(a.slice(-2)) - Number(b.slice(-2)));

const dateCandidates = (mode: "single" | "hours3" | "flow"): TileCutCandidate[] => S02_DATE_KEYS.map((date) => ({
  cut: { tile: "S02", mode, date },
  label: `${mode === "single" ? "단일" : mode === "hours3" ? "정시 3컷" : "그림자 흐름"} · ${S02_DATE_LABEL[date]}`,
  disabled: false,
}));

function ready(view: TileView, value: unknown): boolean {
  if (!isS02Cut(value)) return false;
  const names = rasterNames(view);
  const date = value.date ?? "winter";
  if (value.mode === "single") return names.has(`sun_hours_${date}`);
  if (value.mode === "seasons4") return S02_SEASONS.every((season) => names.has(`sun_hours_${season}`));
  const hours = hoursFor(view, date);
  if (value.mode === "flow") return names.has(`shade_${date}_flow`) && hours.length > 0;
  return hours.length >= 3;
}

function candidates(view: TileView): TileCutCandidate[] {
  return [
    ...dateCandidates("single"),
    ...dateCandidates("hours3").filter((candidate) => (candidate.cut as S02Cut).date !== "analysis"),
    { cut: { tile: "S02", mode: "seasons4" }, label: "계절 4컷", disabled: false },
    ...dateCandidates("flow").filter((candidate) => (candidate.cut as S02Cut).date !== "analysis"),
  ].map((candidate) => ({ ...candidate, disabled: !ready(view, candidate.cut) }));
}

function note(value: unknown, rasterName?: string): string | undefined {
  if (!isS02Cut(value)) return undefined;
  const date = value.date ?? "winter";
  const hour = rasterName?.match(/_h(\d{2})$/)?.[1];
  return hour ? `${S02_DATE_LABEL[date]} ${hour}:00` : S02_DATE_LABEL[date];
}

function firstRaster(view: TileView, value: unknown): string | null {
  if (!isS02Cut(value)) return null;
  const names = rasterNames(view);
  const date = value.date ?? "winter";
  if (value.mode === "single") return names.has(`sun_hours_${date}`) ? `sun_hours_${date}` : null;
  if (value.mode === "flow") return names.has(`shade_${date}_flow`) ? `shade_${date}_flow` : null;
  if (value.mode === "seasons4") return names.has("sun_hours_winter") ? "sun_hours_winter" : [...names].find((name) => name.startsWith("sun_hours_")) ?? null;
  return hoursFor(view, date)[0] ?? null;
}

function viewForCut(view: TileView, value: unknown): TileView {
  const name = firstRaster(view, value);
  if (!name) return view;
  return viewWithOnlyRasterForS02(view, name, note(value, name) ?? "");
}

function ownsRaster(view: TileView, value: unknown): boolean {
  return isS02Cut(value) && ready(view, value);
}

function pages(result: TileResult, value: unknown): number {
  if (!isS02Cut(value) || value.mode !== "flow") return 1;
  const date = value.date ?? "winter";
  const hourly = (result.presentation.rasters ?? []).filter((ref) => new RegExp(`^shade_${date}_h\\d{2}$`).test(ref.name)).length;
  return 1 + (hourly > 0 ? Math.ceil(hourly / 6) : 0);
}

function viewWithOnlyLayer(view: TileView, layer: string, layerNote: string): TileView {
  const polygons = (view.map?.polygons ?? []).filter((polygon) => polygon.layer === layer || polygon.layer === "sun_face");
  return {
    ...view,
    notes: [layerNote, ...view.notes.filter((existing) => existing !== layerNote)],
    map: view.map ? { ...view.map, polygons, polygonsTotal: polygons.length } : null,
  };
}

function rasterCell(view: TileView, name: string, cellNote: string, key: string): TileCutCell {
  const next = name.startsWith("shadow_") ? viewWithOnlyLayer(view, name, cellNote) : viewWithOnlyRasterForS02(view, name, cellNote);
  return { view: next, mapKey: `${view.tileId}:${key}`, rasterName: name };
}

function legacyShadowHours(view: TileView): string[] {
  return ["09", "12", "15"].filter((hour) =>
    (view.map?.polygons ?? []).some((polygon) => polygon.layer === `shadow_${hour}`),
  ).map((hour) => `shadow_${hour}`);
}

function plan(view: TileView, value: unknown): TileCutPlan {
  if (!isS02Cut(value)) return { sheets: [], single: { view, mapKey: `${view.tileId}:cut-winter` } };
  const date = value.date ?? "winter";
  if (value.mode === "single") return { sheets: [], single: { view: viewForCut(view, value), mapKey: `${view.tileId}:cut-${date}` } };
  if (value.mode === "seasons4") {
    const cells = S02_SEASONS.map((season) => `sun_hours_${season}`)
      .filter((name) => rasterNames(view).has(name))
      .map((name) => rasterCell(view, name, S02_DATE_LABEL[name.slice("sun_hours_".length) as S02DateKey], name.slice("sun_hours_".length)));
    return cells.length === 4
      ? { sheets: [{ grid: "2x2", cells }] }
      : { sheets: [], single: { view: viewForCut(view, value), mapKey: `${view.tileId}:cut-${date}` } };
  }
  const hourly = hoursFor(view, date);
  const legacy = hourly.length === 0 ? legacyShadowHours(view) : [];
  const names = hourly.length >= 3 ? [hourly[0]!, hourly[Math.floor(hourly.length / 2)]!, hourly[hourly.length - 1]!] : legacy;
  if (value.mode === "hours3") {
    const cells = names.slice(0, 3).map((name) => rasterCell(view, name, name.startsWith("shadow_") ? `${S02_DATE_LABEL[date]} ${name.slice(-2)}:00` : note(value, name) ?? "", `cut${name.slice(-2)}`));
    return cells.length === 3
      ? { sheets: [{ grid: "3x1", cells }] }
      : { sheets: [], single: { view: viewForCut(view, value), mapKey: `${view.tileId}:cut-${date}` } };
  }
  const flow = `shade_${date}_flow`;
  const groups = hourly.reduce<TileCutCell[][]>((all, name, index) => {
    const group = Math.floor(index / 6);
    (all[group] ??= []).push(rasterCell(view, name, note({ tile: "S02", mode: "flow", date }, name) ?? "", `flow-${name.slice(-2)}`));
    return all;
  }, []);
  const sheets = groups.filter((group) => group.length > 0).map((cells) => ({ grid: "3x2" as const, cells }));
  const single = rasterNames(view).has(flow)
    ? { view: viewWithOnlyRasterForS02(view, flow, `${S02_DATE_LABEL[date]} 그림자 흐름`), mapKey: `${view.tileId}:flow`, rasterName: flow }
    : undefined;
  return sheets.length > 0 || single
    ? { sheets, single }
    : { sheets: [], single: { view: viewForCut(view, value), mapKey: `${view.tileId}:cut-${date}` } };
}

const s02CutModule: TileCutModule = {
  default: () => ({ ...S02_DEFAULT }),
  isValid: isS02Cut,
  legacyForCount: (value) => ({ tile: "S02", mode: value === 3 ? "hours3" : "single", date: "winter" }),
  ready,
  candidates,
  note,
  firstRaster,
  view: viewForCut,
  ownsRaster,
  pages,
  plan,
};

export const s02ClientCutModule = {
  code: "S02",
  cut: s02CutModule,
} satisfies TileClientModule;

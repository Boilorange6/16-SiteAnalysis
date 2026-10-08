import type { CutSpec, Season, WindSeason } from "./board-state";
import type { RasterRef } from "../tile-result";
import type { TileView } from "./tile-view";
import { viewWithOnlyRaster } from "./tile-view";
import { windRasterName } from "./wind-upload";
import { defaultCutForCode } from "./board-state";
import { tileClientModuleFor } from "../tile/client";

export const CUT_SEASONS = ["spring", "summer", "autumn", "winter"] as const satisfies readonly Season[];
export const CUT_WIND_SEASONS = ["annual", ...CUT_SEASONS] as const satisfies readonly WindSeason[];
export const CUT_SEASON_LABEL: Record<WindSeason, string> = {
  annual: "연간",
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  winter: "겨울",
};

type RasterMap = NonNullable<TileView["map"]> & { rasterOptions?: RasterRef[] };

export type CutCandidate = {
  cut: CutSpec;
  label: string;
  disabled: boolean;
};

const rasterRefs = (view: TileView): RasterRef[] => {
  const map = view.map as RasterMap | null;
  return map?.rasterOptions ?? map?.rasters ?? [];
};

const rasterNames = (view: TileView): Set<string> => new Set(rasterRefs(view).map((ref) => ref.name));

const has = (names: Set<string>, name: string): boolean => names.has(name);

export function normalizedCut(view: Pick<TileView, "code">, cut?: CutSpec | null): CutSpec | null {
  const fallback = defaultCutForCode(view.code);
  return cut && cut.tile === view.code ? cut : fallback;
}

/** 계산 결과에 실제로 선택 가능한 래스터/계절이 있는지 판정한다. */
export function cutReady(view: TileView, cut: CutSpec): boolean {
  const moduleReady = tileClientModuleFor(cut.tile)?.cut?.ready;
  if (moduleReady) return moduleReady(view, cut);
  const names = rasterNames(view);
  switch (cut.tile) {
    case "S01": return !!view.mass;
    case "S03": {
      const layer = String(Math.round(cut.layerZ)).padStart(2, "0");
      if (cut.mode === "seasons4") return CUT_SEASONS.every((season) => has(names, `wind_${season}_z${layer}`));
      return cut.season === "annual" || cut.season === undefined
        ? !!windRasterName(view, cut.layerZ)
        : has(names, `wind_${cut.season}_z${layer}`);
    }
    case "S04": {
      const season = cut.season ?? "summer";
      if (cut.mode === "seasons4") return CUT_SEASONS.every((candidate) => has(names, `utci_${candidate}_h14`));
      if (cut.mode === "hours3") return [10, 14, 18].every((hour) => has(names, `utci_${season}_h${hour}`));
      return has(names, `utci_${season}_h${cut.hour ?? 14}`);
    }
    case "D22":
      return cut.mode === "annual" ? !!view.rose : CUT_SEASONS.every((season) => !!view.roses?.[season]);
  }
  return false;
}

export function cutOwnsRaster(view: TileView, cut: CutSpec | null): boolean {
  return !!cut && !!tileClientModuleFor(cut.tile)?.cut?.ownsRaster?.(view, cut);
}

export function cutCandidates(view: TileView, current?: CutSpec | null): CutCandidate[] {
  const moduleCandidates = tileClientModuleFor(view.code)?.cut?.candidates?.(view, current);
  if (moduleCandidates) {
    return moduleCandidates.map((candidate) => ({
      ...candidate,
      cut: candidate.cut as CutSpec,
      disabled: candidate.disabled || !cutReady(view, candidate.cut as CutSpec),
    }));
  }
  const layerZ = current?.tile === "S03" ? current.layerZ : 6;
  let candidates: CutCandidate[];
  switch (view.code) {
    case "S01":
      candidates = [
        { cut: { tile: "S01", mode: "mass" }, label: "기본 매스", disabled: false },
        { cut: { tile: "S01", mode: "exploded" }, label: "분해 매스", disabled: false },
      ];
      break;
    case "S03":
      candidates = [
        ...CUT_WIND_SEASONS.map((season) => ({ cut: { tile: "S03", mode: "single", layerZ, season } as const, label: `단일 · ${CUT_SEASON_LABEL[season]}`, disabled: false })),
        { cut: { tile: "S03", mode: "seasons4", layerZ }, label: "계절 4컷", disabled: false },
      ];
      break;
    case "S04":
      candidates = [
        ...CUT_SEASONS.flatMap((season) => ([10, 14, 18] as const).map((hour) => ({ cut: { tile: "S04", mode: "single", season, hour } as const, label: `단일 · ${CUT_SEASON_LABEL[season]} ${hour}시`, disabled: false }))),
        ...CUT_SEASONS.map((season) => ({ cut: { tile: "S04", mode: "hours3", season } as const, label: `정시 3컷 · ${CUT_SEASON_LABEL[season]}`, disabled: false })),
        { cut: { tile: "S04", mode: "seasons4" }, label: "계절 4컷 · 14시", disabled: false },
      ];
      break;
    case "D22":
      candidates = [
        { cut: { tile: "D22", mode: "annual" }, label: "연간", disabled: false },
        { cut: { tile: "D22", mode: "seasons4" }, label: "계절 4컷", disabled: false },
      ];
      break;
    default:
      return [];
  }
  return candidates.map((candidate) => ({ ...candidate, disabled: !cutReady(view, candidate.cut) }));
}

export function cutKey(cut: CutSpec): string {
  return JSON.stringify(cut);
}

export function cutNote(cut: CutSpec, rasterName?: string): string {
  const moduleNote = tileClientModuleFor(cut.tile)?.cut?.note?.(cut, rasterName);
  if (moduleNote !== undefined) return moduleNote;
  switch (cut.tile) {
    case "S01": return cut.mode === "exploded" ? "분해 매스" : "기본 매스";
    case "S03": return `${CUT_SEASON_LABEL[cut.season ?? "annual"]} ${Math.round(cut.layerZ)}m`;
    case "S04": return `${CUT_SEASON_LABEL[cut.season ?? "summer"]} ${cut.hour ?? 14}시`;
    case "D22": return cut.mode === "seasons4" ? "계절 4컷" : "연간";
  }
  return "";
}

function firstRasterFor(view: TileView, cut: CutSpec): string | null {
  const moduleRaster = tileClientModuleFor(cut.tile)?.cut?.firstRaster?.(view, cut);
  if (moduleRaster !== undefined) return moduleRaster;
  const names = rasterNames(view);
  switch (cut.tile) {
    case "S03": return cut.season === "annual" || cut.season === undefined ? windRasterName(view, cut.layerZ) : `wind_${cut.season}_z${String(Math.round(cut.layerZ)).padStart(2, "0")}`;
    case "S04": return cut.mode === "seasons4" ? "utci_summer_h14" : cut.mode === "hours3" ? `utci_${cut.season ?? "summer"}_h14` : `utci_${cut.season ?? "summer"}_h${cut.hour ?? 14}`;
    default: return null;
  }
}

/** 카드·상세에서 보드의 컷을 바로 반영할 때 쓰는 파생 view. */
export function viewForCut(view: TileView, cut: CutSpec): TileView {
  const moduleView = tileClientModuleFor(cut.tile)?.cut?.view?.(view, cut);
  if (moduleView) return moduleView;
  if (cut.tile === "D22") {
    if (cut.mode === "annual") return { ...view, rose: view.rose ?? null };
    return { ...view, notes: ["계절 4컷", ...view.notes.filter((note) => note !== "계절 4컷")] };
  }
  if (cut.tile === "S01") return { ...view, notes: [cutNote(cut), ...view.notes.filter((note) => note !== "기본 매스" && note !== "분해 매스")] };
  const name = firstRasterFor(view, cut);
  return name ? viewWithOnlyRaster(view, name, cutNote(cut, name)) : view;
}

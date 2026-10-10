import type { CutSpec } from "./board-state";
import type { TileView } from "./tile-view";
import { defaultCutForCode } from "./board-state";
import { tileClientModuleFor } from "../tile/client";
import { viewWithOnlyRaster } from "../tile/cut-utils";
import type { TileCutCandidate } from "../tile/types";

export { CUT_SEASONS, CUT_WIND_SEASONS, CUT_SEASON_LABEL } from "../tile/cut-common";

export type CutCandidate = TileCutCandidate & { cut: CutSpec };

export function normalizedCut(view: Pick<TileView, "code">, cut?: CutSpec | null): CutSpec | null {
  const fallback = defaultCutForCode(view.code);
  return cut && cut.tile === view.code ? cut : fallback;
}

/** 계산 결과에 실제로 선택 가능한 래스터·계절이 있는지 타일 훅으로 판정한다. */
export function cutReady(view: TileView, cut: CutSpec): boolean {
  return tileClientModuleFor(cut.tile)?.cut?.ready?.(view, cut) ?? false;
}

export function cutOwnsRaster(view: TileView, cut: CutSpec | null): boolean {
  return !!cut && !!tileClientModuleFor(cut.tile)?.cut?.ownsRaster?.(view, cut);
}

export function cutCandidates(view: TileView, current?: CutSpec | null): CutCandidate[] {
  const candidates = tileClientModuleFor(view.code)?.cut?.candidates?.(view, current);
  if (!candidates) return [];
  return candidates.map((candidate) => {
    const cut = candidate.cut as CutSpec;
    return { ...candidate, cut, disabled: candidate.disabled || !cutReady(view, cut) };
  });
}

export function cutKey(cut: CutSpec): string {
  return JSON.stringify(cut);
}

export function cutNote(cut: CutSpec, rasterName?: string): string {
  return tileClientModuleFor(cut.tile)?.cut?.note?.(cut, rasterName) ?? "";
}

function firstRasterFor(view: TileView, cut: CutSpec): string | null {
  return tileClientModuleFor(cut.tile)?.cut?.firstRaster?.(view, cut) ?? null;
}

/** 카드·상세에서 보드의 컷을 바로 반영할 때 쓰는 파생 view. */
export function viewForCut(view: TileView, cut: CutSpec): TileView {
  const moduleView = tileClientModuleFor(cut.tile)?.cut?.view?.(view, cut);
  if (moduleView) return moduleView;
  const name = firstRasterFor(view, cut);
  return name ? viewWithOnlyRaster(view, name, cutNote(cut, name)) : view;
}

import { d05ClientModule } from "./d05/view";
import type { TileClientModule } from "./types";

export const CUT_CODES = new Set<string>(["S01", "S02", "S03", "S04", "D22"]);

export const TILE_CLIENT_MODULES: readonly TileClientModule[] = [d05ClientModule];

export function tileClientModuleFor(code: string): TileClientModule | undefined {
  return TILE_CLIENT_MODULES.find((module) => module.code === code);
}

import { d05ClientModule } from "./d05/view";
import { s02ClientModule } from "./s02/view";
import { s02ClientCutModule } from "./s02/cut";
import type { TileClientModule } from "./types";

export const CUT_CODES = new Set<string>(["S01", "S02", "S03", "S04", "D22"]);

export const TILE_CLIENT_MODULES: readonly TileClientModule[] = [d05ClientModule, { ...s02ClientModule, cut: s02ClientCutModule.cut }];

export function tileClientModuleFor(code: string): TileClientModule | undefined {
  return TILE_CLIENT_MODULES.find((module) => module.code === code);
}

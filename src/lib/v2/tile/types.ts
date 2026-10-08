import type { EngineContext } from "../engine/context";
import type { MergeOptions } from "../engine/tiles/merge";
import type { TileResult } from "../tile-result";

export type TileCompute = (ctx: EngineContext) => TileResult;

export interface TileServerModule {
  code: string;
  compute: TileCompute;
  absorbs?: readonly string[];
  mergeOptions?: MergeOptions;
}

export interface TileClientModule {
  code: string;
}

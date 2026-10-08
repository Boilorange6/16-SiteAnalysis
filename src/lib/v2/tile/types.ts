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

export type TileHeadlinePolicy = {
  ids?: readonly string[];
  maxPrefix?: string;
};

export type TileLayerOption = { id: string; label: string };

export type TileClientLayers = {
  options: readonly TileLayerOption[];
  baseExcludes?: readonly string[];
};

export interface TileClientModule {
  code: string;
  headline?: TileHeadlinePolicy;
  mapNote?: string;
  layers?: TileClientLayers;
}

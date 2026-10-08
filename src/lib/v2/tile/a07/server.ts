import type { TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d25 } from "./d25";
import { a07 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = {};

function computeA07(ctx: Parameters<TileCompute>[0]): TileResult {
  let result = retargetTile(a07(ctx), ctx, "A07");
  for (const extra of [d25]) result = mergeTileResults(result, retargetTile(extra(ctx), ctx, "A07"), MERGE_OPTIONS);
  return result;
}

export const a07ServerModule: TileServerModule = {
  code: "A07",
  compute: computeA07,
  absorbs: ["D25"],
  mergeOptions: MERGE_OPTIONS,
};

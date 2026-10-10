import type { TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d09 } from "./d09";
import { a04 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = {};

function computeA04(ctx: Parameters<TileCompute>[0]): TileResult {
  let result = retargetTile(a04(ctx), ctx, "A04");
  for (const extra of [d09]) result = mergeTileResults(result, retargetTile(extra(ctx), ctx, "A04"), MERGE_OPTIONS);
  return result;
}

export const a04ServerModule: TileServerModule = {
  code: "A04",
  compute: computeA04,
  absorbs: ["D09"],
  mergeOptions: MERGE_OPTIONS,
};

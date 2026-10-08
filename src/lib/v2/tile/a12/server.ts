import type { TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d08 } from "./d08";
import { a12 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = {};

function computeA12(ctx: Parameters<TileCompute>[0]): TileResult {
  let result = retargetTile(a12(ctx), ctx, "A12");
  for (const extra of [d08]) result = mergeTileResults(result, retargetTile(extra(ctx), ctx, "A12"), MERGE_OPTIONS);
  return result;
}

export const a12ServerModule: TileServerModule = {
  code: "A12",
  compute: computeA12,
  absorbs: ["D08"],
  mergeOptions: MERGE_OPTIONS,
};

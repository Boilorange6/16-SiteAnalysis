import type { TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d20 } from "./d20";
import { d19 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = {};

function computeD19(ctx: Parameters<TileCompute>[0]): TileResult {
  let result = retargetTile(d19(ctx), ctx, "D19");
  for (const extra of [d20]) result = mergeTileResults(result, retargetTile(extra(ctx), ctx, "D19"), MERGE_OPTIONS);
  return result;
}

export const d19ServerModule: TileServerModule = {
  code: "D19",
  compute: computeD19,
  absorbs: ["D20"],
  mergeOptions: MERGE_OPTIONS,
};

import type { TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d06 } from "./d06";
import { d07 } from "./d07";
import { d05 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = {};

function computeD05(ctx: Parameters<TileCompute>[0]): TileResult {
  let result = retargetTile(d05(ctx), ctx, "D05");
  for (const extra of [d06, d07]) {
    result = mergeTileResults(result, retargetTile(extra(ctx), ctx, "D05"), MERGE_OPTIONS);
  }
  return result;
}

export const d05ServerModule: TileServerModule = {
  code: "D05",
  compute: computeD05,
  absorbs: ["D06", "D07"],
  mergeOptions: MERGE_OPTIONS,
};

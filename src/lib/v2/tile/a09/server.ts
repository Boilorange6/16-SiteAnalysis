import type { TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d23 } from "./d23";
import { a09 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = {};

function computeA09(ctx: Parameters<TileCompute>[0]): TileResult {
  let result = retargetTile(a09(ctx), ctx, "A09");
  for (const extra of [d23]) result = mergeTileResults(result, retargetTile(extra(ctx), ctx, "A09"), MERGE_OPTIONS);
  return result;
}

export const a09ServerModule: TileServerModule = {
  code: "A09",
  compute: computeA09,
  absorbs: ["D23"],
  mergeOptions: MERGE_OPTIONS,
};

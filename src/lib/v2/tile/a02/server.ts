import type { TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d26 } from "./d26";
import { a02 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = {};

function computeA02(ctx: Parameters<TileCompute>[0]): TileResult {
  let result = retargetTile(a02(ctx), ctx, "A02");
  for (const extra of [d26]) result = mergeTileResults(result, retargetTile(extra(ctx), ctx, "A02"), MERGE_OPTIONS);
  return result;
}

export const a02ServerModule: TileServerModule = {
  code: "A02",
  compute: computeA02,
  absorbs: ["D26"],
  mergeOptions: MERGE_OPTIONS,
};

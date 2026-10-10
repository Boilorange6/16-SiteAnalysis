import type { TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d27 } from "./d27";
import { a11 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = {};

function computeA11(ctx: Parameters<TileCompute>[0]): TileResult {
  let result = retargetTile(a11(ctx), ctx, "A11");
  for (const extra of [d27]) result = mergeTileResults(result, retargetTile(extra(ctx), ctx, "A11"), MERGE_OPTIONS);
  return result;
}

export const a11ServerModule: TileServerModule = {
  code: "A11",
  compute: computeA11,
  absorbs: ["D27"],
  mergeOptions: MERGE_OPTIONS,
};

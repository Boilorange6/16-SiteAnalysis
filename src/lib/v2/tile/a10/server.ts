import type { TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d24 } from "./d24";
import { a10 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = {};

function computeA10(ctx: Parameters<TileCompute>[0]): TileResult {
  let result = retargetTile(a10(ctx), ctx, "A10");
  for (const extra of [d24]) result = mergeTileResults(result, retargetTile(extra(ctx), ctx, "A10"), MERGE_OPTIONS);
  return result;
}

export const a10ServerModule: TileServerModule = {
  code: "A10",
  compute: computeA10,
  absorbs: ["D24"],
  mergeOptions: MERGE_OPTIONS,
};

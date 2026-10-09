import type { TileResult } from "../../tile-result";
import { retargetTile } from "../../engine/tiles/merge";
import { d24 } from "./d24";
import type { TileCompute, TileServerModule } from "../types";

function computeA10(ctx: Parameters<TileCompute>[0]): TileResult {
  return retargetTile(d24(ctx), ctx, "A10");
}

export const a10ServerModule: TileServerModule = {
  code: "A10",
  compute: computeA10,
  absorbs: ["D24"],
};

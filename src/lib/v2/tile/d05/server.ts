import { parseTileResult, type TileResult } from "../../tile-result";
import { mergeTileResults, retargetTile, type MergeOptions } from "../../engine/tiles/merge";
import { d06 } from "./d06";
import { d07 } from "./d07";
import { d05 } from "./engine";
import type { TileCompute, TileServerModule } from "../types";

const MERGE_OPTIONS: MergeOptions = { d05BuildingPolygons: true };

function combineAbsorbedResults(results: readonly TileResult[]): TileResult {
  let merged = results[0]!;
  for (const result of results.slice(1)) merged = mergeTileResults(merged, result, MERGE_OPTIONS);
  return parseTileResult(merged);
}

function computeD05(ctx: Parameters<TileCompute>[0]): TileResult {
  const base = retargetTile(d05(ctx), ctx, "D05");
  const absorbed = [d06, d07].map((extra) => retargetTile(extra(ctx), ctx, "D05"));
  return mergeTileResults(base, combineAbsorbedResults(absorbed), MERGE_OPTIONS);
}

export const d05ServerModule: TileServerModule = {
  code: "D05",
  compute: computeD05,
  absorbs: ["D06", "D07"],
  mergeOptions: MERGE_OPTIONS,
};

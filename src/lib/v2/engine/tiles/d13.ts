/** D13 도로 — 원천 없음으로 유지되는 스텁. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";

export function d13(ctx: EngineContext): TileResult {
  return notProvided(ctx, "D13", "도로 원천(OSM PBF) 미적재 — 원천 확보 후 제공");
}

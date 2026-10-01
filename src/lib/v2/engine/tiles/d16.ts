/** D16 건물 밀도 — P3 데이터 적재·구현 전 스텁. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";

export function d16(ctx: EngineContext): TileResult {
  return notProvided(ctx, "D16");
}

/** D08 용도지역 — 스텁. Task 8이 구현으로 교체한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";

export function d08(ctx: EngineContext): TileResult { return notProvided(ctx, "D08"); }

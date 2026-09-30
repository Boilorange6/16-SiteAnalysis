/** D20 필지 규모 — 스텁. Task 9가 구현으로 교체한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";

export function d20(ctx: EngineContext): TileResult { return notProvided(ctx, "D20"); }

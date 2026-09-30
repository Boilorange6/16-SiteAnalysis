/** D03 건축물 용도 — 스텁. Task 6가 구현으로 교체한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";

export function d03(ctx: EngineContext): TileResult { return notProvided(ctx, "D03"); }

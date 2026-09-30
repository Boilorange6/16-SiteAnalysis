/** D25 실거래 — 스텁. Task 14가 구현으로 교체한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";

export function d25(ctx: EngineContext): TileResult { return notProvided(ctx, "D25"); }

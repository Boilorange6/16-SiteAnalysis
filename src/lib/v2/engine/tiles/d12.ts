/** D12 도시계획시설 — 스텁. Task 16이 구현으로 교체한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";

export function d12(ctx: EngineContext): TileResult { return notProvided(ctx, "D12"); }

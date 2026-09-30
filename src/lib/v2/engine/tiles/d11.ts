/** D11 구역·지구 — 스텁. Task 16이 구현으로 교체한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";

export function d11(ctx: EngineContext): TileResult { return notProvided(ctx, "D11"); }

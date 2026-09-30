/** 아직 원천이 적재되지 않은 타일: 지표 없이 “다음 단계에서 제공”으로 표시한다. */
import type { TileResult } from "../../tile-result";
import { catalogEntry } from "../../ui/tile-catalog";
import type { EngineContext } from "../context";
import { makeTile } from "./common";

export const NOT_PROVIDED_CODES = ["A02", "A07", "A09", "A10", "A12", "D04", "S02", "S03"] as const;

export function notProvided(ctx: EngineContext, code: string): TileResult {
  const kind = catalogEntry(code).kind;
  return makeTile(ctx, {
    code,
    type: kind,
    status: "not_provided",
    metrics: [],
    sources: [],
    limitations: [{ kind: "not_provided", note: "P1a-2 적재 후 제공됩니다." }],
  });
}

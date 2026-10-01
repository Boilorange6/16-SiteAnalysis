/** 아직 원천이 적재되지 않은 타일: 지표 없이 “다음 단계에서 제공”으로 표시한다. */
import type { TileResult } from "../../tile-result";
import { catalogEntry } from "../../ui/tile-catalog";
import type { EngineContext } from "../context";
import { makeTile } from "./common";

export const NOT_PROVIDED_CODES = [
  "A02", "A07", "A09", "A10", "A12",
  "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D11", "D12", "D14", "D15", "D16", "D17", "D18", "D19", "D20", "D21", "D22", "D23", "D24", "D25", "D26", "D27",
  "S01", "S02", "S03",
] as const;

export function notProvided(ctx: EngineContext, code: string, note = "P3 적재·구현 후 제공됩니다."): TileResult {
  const kind = catalogEntry(code).kind;
  return makeTile(ctx, {
    code,
    type: kind,
    status: "not_provided",
    metrics: [],
    sources: [],
    limitations: [{ kind: "not_provided", note }],
  });
}

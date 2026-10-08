import type { TileResult } from "../tile-result";
import { a01 } from "./a01/engine";
import { a02 } from "./a02/engine";
import { a03 } from "./a03/engine";
import { a04 } from "./a04/engine";
import { a05 } from "./a05/engine";
import { a06 } from "./a06/engine";
import { a07 } from "./a07/engine";
import { a08 } from "./a08/engine";
import { a09 } from "./a09/engine";
import { a10 } from "./a10/engine";
import { a11 } from "./a11/engine";
import { a12 } from "./a12/engine";
import { d01 } from "./d01/engine";
import { d02 } from "./d02/engine";
import { d03 } from "./d03/engine";
import { d04 } from "./d04/engine";
import { d08 } from "./a12/d08";
import { d09 } from "./a04/d09";
import { d11 } from "./d11/engine";
import { d12 } from "./d12/engine";
import { d13 } from "./d13/engine";
import { d15 } from "./d15/engine";
import { d16 } from "./d16/engine";
import { d17 } from "./d17/engine";
import { d18 } from "./d18/engine";
import { d19 } from "./d19/engine";
import { d20 } from "./d19/d20";
import { d22 } from "./d22/engine";
import { d23 } from "./a09/d23";
import { d24 } from "./a10/d24";
import { d25 } from "./a07/d25";
import { d26 } from "./a02/d26";
import { d27 } from "./a11/d27";
import { d28 } from "./d28/engine";
import { mergeTileResults, retargetTile, type MergeOptions } from "../engine/tiles/merge";
import { s01 } from "./s01/engine";
import { d05ServerModule } from "./d05/server";
import type { TileCompute, TileServerModule } from "./types";

/** 무거운 타일은 POST의 경량 계산 경로에서 호출되지 않는다. 작업자는 jobs.ts에서 로드한다. */
const deferredHeavyTile: TileCompute = () => {
  throw new Error("heavy tile compute is only available in the analysis worker");
};

function mergedTile(ctx: Parameters<TileCompute>[0], code: string, primary: TileCompute, extras: readonly TileCompute[], options: MergeOptions = {}): TileResult {
  let result = retargetTile(primary(ctx), ctx, code);
  for (const extra of extras) result = mergeTileResults(result, retargetTile(extra(ctx), ctx, code), options);
  return result;
}

function mergedModule(
  code: string,
  primary: TileCompute,
  absorbs: readonly string[],
  extras: readonly TileCompute[],
  mergeOptions: MergeOptions = {},
): TileServerModule {
  return {
    code,
    absorbs,
    mergeOptions,
    compute: (ctx) => mergedTile(ctx, code, primary, extras, mergeOptions),
  };
}

function directModule(code: string, compute: TileCompute): TileServerModule {
  return { code, compute };
}

/** 화면 순서(카탈로그 순). heavy 타일의 구현은 이 경량 레지스트리에 import하지 않는다. */
export const TILE_SERVER_MODULES: TileServerModule[] = [
  directModule("A01", a01),
  mergedModule("A02", a02, ["D26"], [d26]),
  directModule("A03", a03),
  mergedModule("A04", a04, ["D09"], [d09]),
  directModule("A05", a05),
  directModule("A06", a06),
  mergedModule("A07", a07, ["D25"], [d25]),
  directModule("A08", a08),
  mergedModule("A09", a09, ["D23"], [d23]),
  mergedModule("A10", a10, ["D24"], [d24]),
  mergedModule("A11", a11, ["D27"], [d27]),
  mergedModule("A12", a12, ["D08"], [d08]),
  directModule("D01", d01),
  directModule("D02", d02),
  directModule("D03", d03),
  directModule("D04", d04),
  d05ServerModule,
  directModule("D10", deferredHeavyTile),
  directModule("D11", d11),
  directModule("D12", d12),
  directModule("D13", d13),
  directModule("D15", d15),
  directModule("D16", d16),
  directModule("D17", d17),
  directModule("D18", d18),
  mergedModule("D19", d19, ["D20"], [d20]),
  directModule("D22", d22),
  directModule("D28", d28),
  directModule("D29", deferredHeavyTile),
  directModule("S01", s01),
  directModule("S02", deferredHeavyTile),
  directModule("S03", deferredHeavyTile),
  directModule("S04", deferredHeavyTile),
];

export const TILES: Array<[code: string, compute: TileCompute]> = TILE_SERVER_MODULES.map(({ code, compute }) => [code, compute]);

export const HEAVY_TILES = ["S02", "D29", "D10", "S03", "S04"] as const;
export const HEAVY_TILE_CODES = HEAVY_TILES;
export const DATE_INDEPENDENT = new Set(["S03", "D10", "D29", "D01", "D28"]);
export const DATE_INDEPENDENT_CODES = DATE_INDEPENDENT;
export const SITE_DEPENDENT_TILE_CODES = new Set(["D19", "S02", "A12", "D10", "S01", "S03", "S04"]);

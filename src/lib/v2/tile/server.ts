import type { TileResult } from "../tile-result";
import { a01 } from "../engine/tiles/a01";
import { a02 } from "../engine/tiles/a02";
import { a03 } from "../engine/tiles/a03";
import { a04 } from "../engine/tiles/a04";
import { a05 } from "../engine/tiles/a05";
import { a06 } from "../engine/tiles/a06";
import { a07 } from "../engine/tiles/a07";
import { a08 } from "../engine/tiles/a08";
import { a09 } from "../engine/tiles/a09";
import { a10 } from "../engine/tiles/a10";
import { a11 } from "../engine/tiles/a11";
import { a12 } from "../engine/tiles/a12";
import { d01 } from "../engine/tiles/d01";
import { d02 } from "../engine/tiles/d02";
import { d03 } from "../engine/tiles/d03";
import { d04 } from "../engine/tiles/d04";
import { d05 } from "./d05/engine";
import { d06 } from "./d06/engine";
import { d07 } from "./d07/engine";
import { d08 } from "../engine/tiles/d08";
import { d09 } from "../engine/tiles/d09";
import { d11 } from "../engine/tiles/d11";
import { d12 } from "../engine/tiles/d12";
import { d13 } from "../engine/tiles/d13";
import { d15 } from "../engine/tiles/d15";
import { d16 } from "../engine/tiles/d16";
import { d17 } from "../engine/tiles/d17";
import { d18 } from "../engine/tiles/d18";
import { d19 } from "../engine/tiles/d19";
import { d20 } from "../engine/tiles/d20";
import { d22 } from "../engine/tiles/d22";
import { d23 } from "../engine/tiles/d23";
import { d24 } from "../engine/tiles/d24";
import { d25 } from "../engine/tiles/d25";
import { d26 } from "../engine/tiles/d26";
import { d27 } from "../engine/tiles/d27";
import { d28 } from "../engine/tiles/d28";
import { mergeTileResults, retargetTile, type MergeOptions } from "../engine/tiles/merge";
import { s01 } from "../engine/tiles/s01";
import { s04 } from "../engine/tiles/s04";
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
  mergedModule("D05", d05, ["D06", "D07"], [d06, d07]),
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
  directModule("S04", s04),
];

export const TILES: Array<[code: string, compute: TileCompute]> = TILE_SERVER_MODULES.map(({ code, compute }) => [code, compute]);

export const HEAVY_TILES = ["S02", "D29", "D10", "S03", "S04"] as const;
export const HEAVY_TILE_CODES = HEAVY_TILES;
export const DATE_INDEPENDENT = new Set(["S03", "D10", "D29", "D01", "D28"]);
export const DATE_INDEPENDENT_CODES = DATE_INDEPENDENT;
export const SITE_DEPENDENT_TILE_CODES = new Set(["D19", "S02", "A12", "D10", "S01", "S03", "S04"]);

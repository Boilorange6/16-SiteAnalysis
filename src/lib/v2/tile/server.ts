import { a01 } from "./a01/engine";
import { a02ServerModule } from "./a02/server";
import { a03 } from "./a03/engine";
import { a04ServerModule } from "./a04/server";
import { a05 } from "./a05/engine";
import { a06 } from "./a06/engine";
import { a07ServerModule } from "./a07/server";
import { a08 } from "./a08/engine";
import { a09ServerModule } from "./a09/server";
import { a10ServerModule } from "./a10/server";
import { a11ServerModule } from "./a11/server";
import { a12ServerModule } from "./a12/server";
import { d01 } from "./d01/engine";
import { d02 } from "./d02/engine";
import { d03 } from "./d03/engine";
import { d04 } from "./d04/engine";
import { d11 } from "./d11/engine";
import { d12 } from "./d12/engine";
import { d13 } from "./d13/engine";
import { d15 } from "./d15/engine";
import { d16 } from "./d16/engine";
import { d17 } from "./d17/engine";
import { d18 } from "./d18/engine";
import { d19ServerModule } from "./d19/server";
import { d22 } from "./d22/engine";
import { d28 } from "./d28/engine";
import { s01 } from "./s01/engine";
import { d05ServerModule } from "./d05/server";
import type { TileCompute, TileServerModule } from "./types";

/** 무거운 타일은 POST의 경량 계산 경로에서 호출되지 않는다. 작업자는 jobs.ts에서 로드한다. */
const deferredHeavyTile: TileCompute = () => {
  throw new Error("heavy tile compute is only available in the analysis worker");
};

function directModule(code: string, compute: TileCompute): TileServerModule {
  return { code, compute };
}

/** 화면 순서(카탈로그 순). heavy 타일의 구현은 이 경량 레지스트리에 import하지 않는다. */
export const TILE_SERVER_MODULES: TileServerModule[] = [
  directModule("A01", a01),
  a02ServerModule,
  directModule("A03", a03),
  a04ServerModule,
  directModule("A05", a05),
  directModule("A06", a06),
  a07ServerModule,
  directModule("A08", a08),
  a09ServerModule,
  a10ServerModule,
  a11ServerModule,
  a12ServerModule,
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
  d19ServerModule,
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

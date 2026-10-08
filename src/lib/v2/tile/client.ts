import { a01ClientModule } from "./a01/view";
import { a02ClientModule } from "./a02/view";
import { a03ClientModule } from "./a03/view";
import { a04ClientModule } from "./a04/view";
import { a05ClientModule } from "./a05/view";
import { a06ClientModule } from "./a06/view";
import { a07ClientModule } from "./a07/view";
import { a08ClientModule } from "./a08/view";
import { a09ClientModule } from "./a09/view";
import { a10ClientModule } from "./a10/view";
import { a11ClientModule } from "./a11/view";
import { a12ClientModule } from "./a12/view";
import { d01ClientModule } from "./d01/view";
import { d02ClientModule } from "./d02/view";
import { d03ClientModule } from "./d03/view";
import { d04ClientModule } from "./d04/view";
import { d05ClientModule } from "./d05/view";
import { d10ClientModule } from "./d10/view";
import { d11ClientModule } from "./d11/view";
import { d12ClientModule } from "./d12/view";
import { d13ClientModule } from "./d13/view";
import { d15ClientModule } from "./d15/view";
import { d16ClientModule } from "./d16/view";
import { d17ClientModule } from "./d17/view";
import { d18ClientModule } from "./d18/view";
import { d19ClientModule } from "./d19/view";
import { d22ClientModule } from "./d22/view";
import { d28ClientModule } from "./d28/view";
import { d29ClientModule } from "./d29/view";
import { s02ClientModule } from "./s02/view";
import { s02ClientCutModule } from "./s02/cut";
import { s01ClientModule } from "./s01/view";
import { s03ClientModule } from "./s03/view";
import { s04ClientModule } from "./s04/view";
import type { TileClientModule } from "./types";

export const CUT_CODES = new Set<string>(["S01", "S02", "S03", "S04", "D22"]);

export const TILE_CLIENT_MODULES: readonly TileClientModule[] = [
  a01ClientModule,
  a02ClientModule,
  a03ClientModule,
  a04ClientModule,
  a05ClientModule,
  a06ClientModule,
  a07ClientModule,
  a08ClientModule,
  a09ClientModule,
  a10ClientModule,
  a11ClientModule,
  a12ClientModule,
  d01ClientModule,
  d02ClientModule,
  d03ClientModule,
  d04ClientModule,
  d05ClientModule,
  d10ClientModule,
  d11ClientModule,
  d12ClientModule,
  d13ClientModule,
  d15ClientModule,
  d16ClientModule,
  d17ClientModule,
  d18ClientModule,
  d19ClientModule,
  d22ClientModule,
  d28ClientModule,
  d29ClientModule,
  s01ClientModule,
  { ...s02ClientModule, cut: s02ClientCutModule.cut },
  s03ClientModule,
  s04ClientModule,
];

export function tileClientModuleFor(code: string): TileClientModule | undefined {
  return TILE_CLIENT_MODULES.find((module) => module.code === code);
}

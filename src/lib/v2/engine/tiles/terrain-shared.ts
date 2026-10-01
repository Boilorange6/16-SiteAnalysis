/** 장면·지형 타일이 함께 사용하는 DEM 조회와 로컬 격자. */
import { DEM_SOURCE_ID, DemReader } from "../../data/terrain";
import type { SourceRef, EngineContext } from "../context";
import { localGrid, type LocalGrid } from "./raster-grid";

export const DEM_LIMITATION = {
  kind: "estimated",
  note: "Copernicus DEM GLO-30(약 30m) 지표고를 보간한 지형입니다. 측량값·표면고(건물·수목)가 아니며 EGM2008 기준입니다.",
} as const;

/** 한 분석 안에서 terrain.sqlite와 DemReader를 한 번만 연다. */
export function demReader(ctx: EngineContext): DemReader | null {
  return ctx.memo("dem:reader", () => {
    const db = ctx.db("terrain");
    if (!db) return null;
    const reader = new DemReader(db);
    return reader.ready() ? reader : null;
  });
}

/** 분석 반경의 DEM을 공통 LocalGrid로 만든다. 결측 표본은 LocalGrid의 NaN으로 남긴다. */
export function demGridFor(ctx: EngineContext, cellM: number): LocalGrid | null {
  if (!Number.isFinite(cellM) || cellM <= 0) throw new RangeError("cellM must be positive");
  const reader = demReader(ctx);
  if (!reader) return null;
  return ctx.memo(`dem:grid:${cellM}`, () => localGrid(
    ctx.input.center,
    ctx.input.radiusM,
    cellM,
    (_x, _y, lng, lat) => reader.elevation(lng, lat),
  ));
}

export function demSources(ctx: EngineContext): SourceRef[] {
  return ctx.sources("terrain", [DEM_SOURCE_ID]);
}

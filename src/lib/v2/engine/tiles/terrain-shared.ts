/** 장면·지형 타일이 함께 사용하는 DEM 조회와 로컬 격자. */
import { DEM_SOURCE_ID, DemReader, type DemVertical } from "../../data/terrain";
import { toUtmk } from "../../crs";
import type { TopoDemReader } from "../../topo/dem";
import type { SourceRef, EngineContext } from "../context";
import { localGrid, type LocalGrid } from "./raster-grid";

export const DEM_LIMITATION = {
  kind: "estimated",
  note: "Copernicus GLO-30은 표면모델(DSM, 2011~15년 관측, 30 m 격자·평활화)입니다. 서울에서 실측된 건물 신호는 미미해 지형으로 쓰며, 측량값이 아니고 EGM2008 기준입니다.",
} as const;

export const topoTerrainLimitation = {
  kind: "estimated",
  note: "지형은 수치지형도 등고선·표고점 보간(추정)이고, 자료 범위 밖은 30m DEM으로 채웠습니다.",
} as const;

interface TerrainDemReader {
  ready(): boolean;
  verticalDatum(): DemVertical | null;
  resolution(): number | null;
  elevation(lng: number, lat: number): number | null;
}

/** 수치지형도 표고를 우선하고, 그 밖이나 결측 표본은 GLO-30으로 채운다. */
class CompositeDemReader implements TerrainDemReader {
  constructor(
    private readonly topo: TopoDemReader | null,
    private readonly glo30: DemReader | null,
  ) {}

  ready(): boolean {
    return this.topo !== null || this.glo30?.ready() === true;
  }

  verticalDatum(): DemVertical | null {
    // TopoDemReader has no datum metadata yet. Keep the published GLO-30 datum
    // when it is available; the scene fallback remains EGM2008 otherwise.
    return this.glo30?.verticalDatum() ?? null;
  }

  resolution(): number | null {
    return 5;
  }

  elevation(lng: number, lat: number): number | null {
    return this.topo?.elevation(lng, lat) ?? this.glo30?.elevation(lng, lat) ?? null;
  }
}

/** 한 분석 안에서 terrain.sqlite와 DEM reader를 한 번만 연다. */
export function demReader(ctx: EngineContext): TerrainDemReader | null {
  if (ctx.topo) {
    return ctx.memo(`dem:reader:topo:${ctx.topo.sha256}`, () => {
      const db = ctx.db("terrain");
      const glo30 = db ? new DemReader(db) : null;
      const reader = new CompositeDemReader(ctx.topo?.dem ?? null, glo30);
      return reader.ready() ? reader : null;
    });
  }

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
  const glo30 = ctx.sources("terrain", [DEM_SOURCE_ID]);
  return ctx.topo ? [ctx.topo.source, ...glo30] : glo30;
}

/** 대지 중심이 수치지형도 범위 안이면 D17/D18 및 상세 표본을 5 m로 계산한다. */
export function terrainCellM(ctx: EngineContext): 5 | 30 {
  if (!ctx.topo) return 30;
  const [x, y] = toUtmk(ctx.input.center);
  return ctx.topo.covers(x, y) ? 5 : 30;
}

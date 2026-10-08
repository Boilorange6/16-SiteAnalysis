import type { RasterRef, TileResult } from "../tile-result";
import { tileClientModuleFor } from "../tile/client";
import type { TileLayerOption } from "../tile/types";
import type { MapModel } from "./map-layers";

export type { TileLayerOption } from "../tile/types";

const STATIC_OPTIONS: Record<string, TileLayerOption[]> = {
  A01: [{ id: "all", label: "기본 교통" }, { id: "transit", label: "철도·출입구" }],
  A02: [{ id: "all", label: "기본 학교" }, { id: "school_zone", label: "학구·학교군" }],
  A04: [{ id: "all", label: "기본 공원" }, { id: "green_space", label: "녹지·수면" }],
  A07: [{ id: "all", label: "기본 거래" }, { id: "trade_location", label: "가격 구간" }],
  A09: [{ id: "all", label: "기본 정비" }, { id: "maintenance_stage", label: "사업 단계" }],
  A10: [{ id: "all", label: "기본 계획" }, { id: "planned_detail", label: "노선·계획역" }],
  A11: [{ id: "all", label: "기본 인구" }, { id: "density_detail", label: "밀도 구간" }],
  A12: [{ id: "all", label: "기본 토지" }, { id: "zoning_detail", label: "용도지역" }],
  D19: [{ id: "all", label: "지목 기본" }, { id: "parcel_size", label: "필지 규모" }],
};

const optionMatches: Record<string, (layer: string) => boolean> = {
  transit: (layer) => /^(rail_|bus_|walk_)/.test(layer),
  school_zone: (layer) => layer.startsWith("school_zone"),
  green_space: (layer) => ["green_zone", "green_parcel", "water_parcel"].includes(layer),
  trade_location: (layer) => layer.startsWith("trade_q"),
  maintenance_stage: (layer) => layer.startsWith("maint_stage:"),
  planned_detail: (layer) => layer.startsWith("planned_rail"),
  density_detail: (layer) => layer.startsWith("pop_grid_") || layer.startsWith("pop_dens_"),
  zoning_detail: (layer) => layer.startsWith("zone") || layer.startsWith("zoning"),
  height_tall: (layer) => layer.startsWith("tall_"),
  height_low: (layer) => layer.startsWith("low_"),
  parcel_size: (layer) => layer.startsWith("lot_"),
};

export function layerOptionsForResult(result: TileResult): TileLayerOption[] {
  const moduleOptions = tileClientModuleFor(result.tileCode)?.layers?.options;
  if (typeof moduleOptions === "function") return [...moduleOptions(result)];
  if (moduleOptions) return [...moduleOptions];
  return STATIC_OPTIONS[result.tileCode] ?? [];
}

export function defaultLayerId(result: TileResult): string {
  return layerOptionsForResult(result)[0]?.id ?? "all";
}

type LayeredMapModel = MapModel & {
  legend?: TileResult["presentation"]["legend"];
  defaultRaster?: string;
  rasterOptions?: RasterRef[];
};

/** 기본 보기에서 빼는 전환 레이어 — 흡수한 타일의 레이어가 기본 보기에 겹쳐 그려지지 않게 (타일 모듈 layers.baseExcludes) */
function baseExcludesFor(code: string): readonly string[] {
  return tileClientModuleFor(code)?.layers?.baseExcludes ?? [];
}

export function filterMapForLayer(model: MapModel | null, code: string, layerId: string): LayeredMapModel | null {
  if (!model) return model;
  const layered = model as LayeredMapModel;
  const moduleFilter = tileClientModuleFor(code)?.layers?.filter;
  const moduleResult = moduleFilter?.(model, layerId);
  if (moduleResult !== undefined) return moduleResult as LayeredMapModel | null;
  let matches: ((layer: string) => boolean) | undefined;
  if (layerId === "all") {
    const excluded = baseExcludesFor(code).map((id) => optionMatches[id]!);
    if (excluded.length === 0) return model;
    matches = (layer) => !excluded.some((match) => match(layer));
  } else matches = optionMatches[layerId];
  if (!matches) return model;
  const features = model.features.filter((feature) => matches(feature.layer));
  const polygons = (model.polygons ?? []).filter((polygon) => matches(polygon.layer));
  const lines = (model.lines ?? []).filter((line) => matches(line.layer));
  return {
    ...layered,
    features,
    total: features.length,
    ...(model.polygons ? { polygons, polygonsTotal: polygons.length } : {}),
    ...(model.lines ? { lines, linesTotal: lines.length } : {}),
  };
}

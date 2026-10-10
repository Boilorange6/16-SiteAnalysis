import type { RasterRef, TileResult } from "../tile-result";
import { tileClientModuleFor } from "../tile/client";
import type { TileLayerOption } from "../tile/types";
import type { MapModel } from "./map-layers";

export type { TileLayerOption } from "../tile/types";

const optionMatches: Record<string, (layer: string) => boolean> = {
  transit: (layer) => /^(rail_|bus_|walk_)/.test(layer),
  school_zone: (layer) => layer.startsWith("school_zone"),
  green_space: (layer) => ["green_zone", "green_parcel", "water_parcel"].includes(layer),
  maintenance_stage: (layer) => layer.startsWith("maint_stage:"),
  height_tall: (layer) => layer.startsWith("tall_"),
  height_low: (layer) => layer.startsWith("low_"),
  parcel_size: (layer) => layer.startsWith("lot_"),
};

const LEGACY_LAYER_FALLBACKS: Record<string, string> = {
  trade_location: "all",
};

function currentLayerOptions(options: readonly TileLayerOption[]): TileLayerOption[] {
  const seen = new Set<string>();
  return options.flatMap((option) => {
    const id = LEGACY_LAYER_FALLBACKS[option.id] ?? option.id;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ ...option, id }];
  });
}

export function layerOptionsForResult(result: TileResult): TileLayerOption[] {
  const moduleOptions = tileClientModuleFor(result.tileCode)?.layers?.options;
  if (typeof moduleOptions === "function") return currentLayerOptions(moduleOptions(result));
  if (moduleOptions) return currentLayerOptions(moduleOptions);
  return [];
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

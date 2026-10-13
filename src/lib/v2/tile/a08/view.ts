import type { TileClientModule } from "../types";
import type { TileResult } from "../../tile-result";
import type { MapModel } from "../../ui/map-layers";
import { layerStyle } from "../../ui/map-layers";

const DEFAULT_LAYER = "building_jeonse";

const layerOptions = (_result: TileResult) => [
  { id: "building_jeonse", label: "건물-전세" },
  { id: "building_monthly", label: "건물-월세" },
  { id: "district_jeonse", label: "행정구역-전세" },
  { id: "district_monthly", label: "행정구역-월세" },
];

const normalizeLayerId = (layerId: string) => layerId === "all" ? DEFAULT_LAYER : layerId;

const matchesFor = (layerId: string): ((layer: string) => boolean) | undefined => {
  switch (normalizeLayerId(layerId)) {
    case "building_jeonse": return (layer) => layer.startsWith("rent_jeonse_");
    case "building_monthly": return (layer) => layer.startsWith("rent_monthly_");
    case "district_jeonse": return (layer) => layer.startsWith("rent_district_jeonse_");
    case "district_monthly": return (layer) => layer.startsWith("rent_district_monthly_");
    default: return undefined;
  }
};

function filterA08Map(model: MapModel | null, layerId: string): MapModel | null | undefined {
  if (!model) return model;
  const matches = matchesFor(layerId);
  if (!matches) return undefined;
  const features = model.features.filter((feature) => matches(feature.layer));
  const polygons = (model.polygons ?? []).filter((polygon) => matches(polygon.layer));
  const lines = (model.lines ?? []).filter((line) => matches(line.layer));
  const visibleLabels = new Set([
    ...features.map((feature) => layerStyle(feature.layer).label),
    ...polygons.map((polygon) => layerStyle(polygon.layer).label),
    ...lines.map((line) => layerStyle(line.layer).label),
  ]);
  return {
    ...model,
    features,
    total: features.length,
    ...(model.polygons ? { polygons, polygonsTotal: polygons.length } : {}),
    ...(model.lines ? { lines, linesTotal: lines.length } : {}),
    ...(model.legend ? { legend: model.legend.filter((entry) => visibleLabels.has(entry.label)) } : {}),
  };
}

export const a08ClientModule = {
  code: "A08",
  headline: { ids: ["jeonse_to_trade_ratio_pct", "jeonse_deposit_per_m2", "monthly_rent_median", "jeonse_count", "monthly_count"] },
  layers: {
    options: layerOptions,
    filter: filterA08Map,
  },
  // 첫 렌더도 모드 선택과 같은 건물-전세 지도·범례를 사용한다. 구형 all 호출은 여기서도 같은 결과로 귀결된다.
  view: (base) => {
    const map = filterA08Map(base.map, DEFAULT_LAYER);
    return { ...base, ...(map !== undefined ? { map } : {}), defaultLayer: DEFAULT_LAYER };
  },
} satisfies TileClientModule;

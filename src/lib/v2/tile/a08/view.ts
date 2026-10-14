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

function matchesBuildingLayer(layer: string, contract: "jeonse" | "monthly"): boolean {
  const prefix = `rent_${contract}`;
  // W2 이전 저장 결과는 분위 레이어 suffix 없이 이 정확한 id를 사용했다.
  return layer === prefix || layer.startsWith(`${prefix}_`);
}

const matchesFor = (layerId: string): ((layer: string) => boolean) | undefined => {
  switch (normalizeLayerId(layerId)) {
    case "building_jeonse": return (layer) => matchesBuildingLayer(layer, "jeonse");
    case "building_monthly": return (layer) => matchesBuildingLayer(layer, "monthly");
    case "district_jeonse": return (layer) => layer.startsWith("rent_district_jeonse_");
    case "district_monthly": return (layer) => layer.startsWith("rent_district_monthly_");
    default: return undefined;
  }
};

function emptyMessageFor(layerId: string, model: MapModel): string {
  const normalized = normalizeLayerId(layerId);
  const hasLegacyPointResult = model.features.some((feature) => feature.layer === "rent_jeonse" || feature.layer === "rent_monthly");
  if ((normalized === "district_jeonse" || normalized === "district_monthly") && hasLegacyPointResult) {
    return "구버전 저장 결과에는 행정구역 면이 없습니다. 최신 엔진으로 갱신 버튼을 눌러 주세요.";
  }
  switch (normalized) {
    case "building_jeonse": return "이 반경에 전세 거래 없음";
    case "building_monthly": return "이 반경에 월세 거래 없음";
    case "district_jeonse": return "이 반경에 전세 행정구역 자료 없음";
    case "district_monthly": return "이 반경에 월세 행정구역 자료 없음";
    default: return "이 모드에 표시할 자료 없음";
  }
}

function filterA08Map(model: MapModel | null, layerId: string): MapModel | null | undefined {
  if (!model) return model;
  const matches = matchesFor(layerId);
  if (!matches) return undefined;
  const features = model.features.filter((feature) => matches(feature.layer));
  const polygons = (model.polygons ?? []).filter((polygon) => matches(polygon.layer));
  const lines = (model.lines ?? []).filter((line) => matches(line.layer));
  const hasGeometry = features.length > 0 || polygons.length > 0 || lines.length > 0;
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
    ...(hasGeometry ? { emptyMessage: undefined } : { emptyMessage: emptyMessageFor(layerId, model) }),
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
    // 계약과 면이 모두 0인 complete/partial 결과도 빈 지도 안내를 보여 줄 수 있게
    // 대지·반경 backdrop을 필터 입력으로 유지한다. 실패·대기 상태는 기존 상태판을 따른다.
    const sourceMap = base.map ?? (base.status === "complete" || base.status === "partial" ? base.backdrop : null);
    const map = filterA08Map(sourceMap, DEFAULT_LAYER);
    return { ...base, ...(map !== undefined ? { map } : {}), defaultLayer: DEFAULT_LAYER };
  },
} satisfies TileClientModule;

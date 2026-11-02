import type { TileResult } from "../../tile-result";
import { countText, metricNumber, radiusLabel, valueMetric } from "../key-figure";
import type { KeyFigure, TileClientModule, TileHeadlineHelpers } from "../types";

const filterTransitLayers = (layerId: string, layer: string): boolean => layerId === "transit" ? layer.startsWith("rail_") : layerId === "bus" ? layer.startsWith("bus_") : true;

const stationOf = (name: string | null | undefined): string | undefined => name?.replace(/\s+\d+번 출구$/, "") || undefined;

/**
 * 직선 최근접 역(최근접 표시 지물)과 도보 시간을 낸 역(철도 도보 경로 walk_route가 가리키는 지물)의 이름.
 * 보행망 최근접 역은 직선 최근접 역과 다를 수 있다. 도보 경로 자체가 결과에 없으면 둘을 같게 보고,
 * 경로는 있는데 그 지물이 지도에 없으면 도보 쪽 역은 모른다(직선 쪽 이름으로 대신하지 않는다).
 */
function railStationNames(result: TileResult): { straight?: string; exit?: string; walk?: string } {
  const features = result.presentation.features ?? [];
  const nearest = features.find((feature) => feature.highlight && (feature.layer === "rail_entrance" || feature.layer === "rail_nearest"));
  const walkLine = result.presentation.lines?.find((line) => line.layer === "walk_route" && line.sublabel?.startsWith("철도"));
  const walk = walkLine ? features.find((feature) => walkLine.fid !== undefined && feature.fid === walkLine.fid) : nearest;
  return {
    straight: stationOf(nearest?.name),
    exit: nearest?.layer === "rail_entrance" ? /\d+번 출구$/.exec(nearest.name ?? "")?.[0] : undefined,
    walk: stationOf(walk?.name),
  };
}

/** 반경 안 지하철역 수. 환승역은 노선마다 지물이 따로 있어 지표 값이 더 크므로 역 이름이 같은 지물은 한 곳으로 센다. */
function stationCount(result: TileResult): number | null {
  const metric = metricNumber(result, "rail_stations");
  if (metric === null) return null;
  const stations = (result.presentation.features ?? []).filter((feature) => feature.layer === "rail_station" || feature.layer === "rail_nearest");
  return stations.length === 0 ? metric : new Set(stations.map((feature) => feature.name ?? `#${feature.fid}`)).size;
}

function a01KeyFigure(result: TileResult, helpers: TileHeadlineHelpers): KeyFigure | null {
  const walkMin = metricNumber(result, "walk_nearest_rail_min");
  if (walkMin === null) return null;
  const distance = (id: string) => { const metric = valueMetric(result, id); return metric ? helpers.metricRow(metric).value : null; };
  const walkM = distance("walk_nearest_rail_m");
  const straightM = distance("nearest_rail_m");
  const radius = radiusLabel(result.conditions.radiusM);
  const busMin = metricNumber(result, "walk_nearest_bus_min");
  const stations = stationCount(result);
  const stops = metricNumber(result, "bus_stops");
  const stats: KeyFigure["stats"] = [];
  if (busMin !== null) stats.push({ value: `${busMin}분`, label: "정류장까지 도보" });
  if (stations !== null) stats.push({ value: countText(stations, "곳"), label: `${radius} 안 지하철역` });
  if (stops !== null) stats.push({ value: countText(stops, "곳"), label: `${radius} 안 정류장` });
  const { straight, exit, walk: target } = railStationNames(result);
  // 직선 거리는 직선 최근접 역의 값이다. 도보로 가는 역과 같으면 출구까지, 다르면 그 역 이름을 붙여 밝힌다.
  const straightText = straightM === null ? null
    : straight === undefined ? `직선 ${straightM}`
    : straight === target ? `${exit ? `${exit}까지 ` : ""}직선 ${straightM}`
    : `직선 최근접 ${straight} ${straightM}`;
  const sub = [walkM === null ? null : `보행망 ${walkM}`, straightText].filter((part) => part !== null).join(" · ");
  return {
    question: "가장 가까운 지하철역",
    answer: { pre: "도보", value: `${walkMin}분`, ...(target ? { target } : {}), kind: "number" },
    ...(sub ? { sub } : {}),
    stats,
  };
}

export const a01ClientModule = {
  code: "A01",
  headline: { ids: ["nearest_rail_m", "nearest_bus_m"] },
  keyFigureFor: a01KeyFigure,
  chart: { subject: "정류장·출입구", countUnit: "곳" },
  board: {
    // 철도역·노선·출구 라벨이 한 칸에서 서로 겹치므로 기본 보드만 2칸으로 연다.
    // restore가 저장된 sizes를 우선하므로 기존 사용자 배치는 덮어쓰지 않는다.
    size: () => 2 as const,
  },
  mapNotesFor: (result) => result.metrics.some((metric) => metric.id === "nearest_rail_m" && metric.status === "missing")
    ? ["철도 자료를 확인하지 못해 버스정류장만 표시"]
    : [],
  layers: {
    options: [{ id: "all", label: "전체" }, { id: "transit", label: "철도" }, { id: "bus", label: "버스" }],
    filter: (model, layerId) => {
      if (!model || layerId === "all") return model;
      if (layerId !== "transit" && layerId !== "bus") return undefined;
      const matches = (layer: string) => filterTransitLayers(layerId, layer);
      const features = model.features.filter((feature) => matches(feature.layer));
      const polygons = (model.polygons ?? []).filter((polygon) => matches(polygon.layer));
      const lines = (model.lines ?? []).filter((line) => matches(line.layer));
      return {
        ...model,
        features,
        total: features.length,
        ...(model.polygons ? { polygons, polygonsTotal: polygons.length } : {}),
        ...(model.lines ? { lines, linesTotal: lines.length } : {}),
      };
    },
  },
} satisfies TileClientModule;

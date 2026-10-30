import type { TileResult } from "../../tile-result";
import { fmtInt } from "../../ui/callout-layout";
import { countText, metricNumber, radiusLabel } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

const filterTransitLayers = (layerId: string, layer: string): boolean => layerId === "transit" ? layer.startsWith("rail_") : layerId === "bus" ? layer.startsWith("bus_") : true;

/**
 * 직선 최근접 역(최근접 표시 지물)과 도보 시간을 낸 역(철도 도보 경로 walk_route가 가리키는 지물)의 이름.
 * 보행망 최근접 역은 직선 최근접 역과 다를 수 있다. 경로 지물을 찾지 못하면 둘을 같게 본다.
 */
function railStationNames(result: TileResult): { straight?: string; walk?: string } {
  const features = result.presentation.features ?? [];
  const straight = features.find((feature) => feature.highlight && (feature.layer === "rail_entrance" || feature.layer === "rail_nearest"));
  const walkFid = result.presentation.lines?.find((line) => line.layer === "walk_route" && line.sublabel?.startsWith("철도"))?.fid;
  const walk = features.find((feature) => walkFid !== undefined && feature.fid === walkFid) ?? straight;
  // 출입구 이름은 「역명 N번 출구」다.
  const stationOf = (feature: typeof straight) => feature?.name?.replace(/\s+\d+번 출구$/, "") || undefined;
  return { straight: stationOf(straight), walk: stationOf(walk) };
}

function a01KeyFigure(result: TileResult): KeyFigure | null {
  const walkMin = metricNumber(result, "walk_nearest_rail_min");
  if (walkMin === null) return null;
  const walkM = metricNumber(result, "walk_nearest_rail_m");
  const straightM = metricNumber(result, "nearest_rail_m");
  const radius = radiusLabel(result.conditions.radiusM);
  const busMin = metricNumber(result, "walk_nearest_bus_min");
  const stations = metricNumber(result, "rail_stations");
  const stops = metricNumber(result, "bus_stops");
  const stats: KeyFigure["stats"] = [];
  if (busMin !== null) stats.push({ value: `${busMin}분`, label: "정류장까지 도보" });
  if (stations !== null) stats.push({ value: countText(stations, "곳"), label: `${radius} 안 지하철역` });
  if (stops !== null) stats.push({ value: countText(stops, "곳"), label: `${radius} 안 정류장` });
  const { straight, walk: target } = railStationNames(result);
  // 직선 거리는 직선 최근접 역의 값이라, 도보로 가는 역이 다르면 같은 줄에 두지 않는다.
  const sub = [walkM === null ? null : `보행망 ${fmtInt(walkM)}m`, straightM === null || straight !== target ? null : `직선 ${fmtInt(straightM)}m`].filter((part) => part !== null).join(" · ");
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

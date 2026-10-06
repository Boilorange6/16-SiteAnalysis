/** D14 지하철·버스 — 반경 안 운영 철도 시설과 버스정류장을 유형별로 표시한다. */
import type { FeatureHit } from "../../data/features";
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { candidate, lineCandidate, makeTile, missing, noDataTile, obs, type LineCandidate, type MapCandidate, type TileDraft } from "./common";
import { clipLineToCircle, linePathLength } from "./geo";

const BUS_SOURCES = ["bus_stop"] as const;
const RAIL_SOURCES = ["osm_subway"] as const;

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function stationName(hit: FeatureHit): string | null {
  return text(hit.name);
}

function entranceStationName(hit: FeatureHit): string | null {
  return text(hit.properties.stationName);
}

/** 같은 노선이 여러 선형 feature로 나뉘어도 노선 수는 한 번만 센다. */
function lineKey(hit: FeatureHit): string {
  return text(hit.properties.lineRef) ?? hit.stableId;
}

function countStationsWithEntrances(stations: FeatureHit[], entrances: FeatureHit[]): number {
  const stationNames = new Set(stations.map(stationName).filter((name): name is string => name !== null));
  const entranceNames = new Set(
    entrances.map(entranceStationName).filter((name): name is string => name !== null && stationNames.has(name)),
  );
  return stations.reduce((count, station) => {
    const name = stationName(station);
    return count + (name !== null && entranceNames.has(name) ? 1 : 0);
  }, 0);
}

export function d14(ctx: EngineContext): TileResult {
  const busSources = ctx.sources("reference", BUS_SOURCES);
  if (busSources.length === 0) return noDataTile(ctx, "D14", [...BUS_SOURCES]);

  const railSources = ctx.sources("reference", RAIL_SOURCES);
  const hasRail = railSources.length > 0;
  const busStops = ctx.hits("reference", ["bus_stop"]);
  const stations = hasRail ? ctx.hits("reference", ["rail_station"]) : [];
  const entrances = hasRail ? ctx.hits("reference", ["rail_entrance"]) : [];
  const lines = hasRail ? ctx.hits("reference", ["rail_line"]) : [];
  const uniqueLines = new Set(lines.map(lineKey));
  const stationsWithEntrances = hasRail ? countStationsWithEntrances(stations, entrances) : 0;

  const metrics: TileDraft["metrics"] = [
    hasRail ? obs("back_stations", "운영 철도역", stations.length, "역", "d14-stations@1:반경 내 rail_station 개수") : missing("back_stations", "운영 철도역", "역", "d14-rail@0:철도 자료 확인 불가"),
    hasRail ? obs("back_entrances", "철도역 출입구", entrances.length, "곳", "d14-entrances@1:반경 내 rail_entrance 개수") : missing("back_entrances", "철도역 출입구", "곳", "d14-rail@0:철도 자료 확인 불가"),
    obs("back_bus_stops", "버스정류장", busStops.length, "곳", "d14-bus-stops@1:반경 내 bus_stop 개수"),
    hasRail && stations.length > 0
      ? obs("fill_entrance_pct", "출입구 확인 역", pct(stationsWithEntrances, stations.length), "%", "d14-entrance-fill@1:출입구가 연결된 역÷반경 내 운영역", stationsWithEntrances, stations.length)
      : missing("fill_entrance_pct", "출입구 확인 역", "%", hasRail ? "d14-entrance-fill@1:역 0곳으로 분모 없음" : "d14-rail@0:철도 자료 확인 불가"),
    hasRail ? obs("rail_lines", "반경 내 철도 노선", uniqueLines.size, "개", "d14-lines@1:반경과 교차한 고유 rail_line 개수") : missing("rail_lines", "반경 내 철도 노선", "개", "d14-rail@0:철도 자료 확인 불가"),
  ];

  const map: MapCandidate[] = busStops.map((hit) => candidate(hit, "bus_stop"));
  const lineCandidates: LineCandidate[] = [];
  const layers = ["bus_stop"];
  if (hasRail) {
    layers.push("rail_station", "rail_entrance", "rail_line");
    stations.forEach((hit) => map.push(candidate(hit, "rail_station")));
    entrances.forEach((hit) => map.push(candidate(hit, "rail_entrance")));
    lines.forEach((hit) => {
      for (const path of clipLineToCircle(ctx.input.center, ctx.input.radiusM, hit.geometry)) {
        const line = lineCandidate(hit.featureId, "rail_line", path, linePathLength(path));
        if (line) lineCandidates.push(line);
      }
    });
  }

  const coverage = [
    ...ctx.coverage("reference", BUS_SOURCES),
    ...(hasRail ? ctx.coverage("reference", RAIL_SOURCES) : []),
  ];
  const limitations: TileDraft["limitations"] = [
    { kind: "unknown", note: "운영 시설만 표시하며 계획 철도는 D24에서 다룹니다." },
    ...(hasRail ? [] : [{ kind: "not_provided" as const, note: "철도 자료를 확인하지 못해 철도역·출입구·노선은 계산하지 못했습니다." }]),
    ...coverage,
  ];
  const status: TileResult["status"] = hasRail && !coverage.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "complete" : "partial";
  const judgment = hasRail
    ? {
        ruleId: "D14-transit@1",
        basisMetricIds: ["back_stations", "back_bus_stops"],
        sentence: `반경 안 운영 철도역 ${stations.length}역·출입구 ${entrances.length}곳·철도 노선 ${uniqueLines.size}개와 버스정류장 ${busStops.length}곳 확인 → 운영 시설을 유형별로 표시하고 계획 철도와 섞지 않음 → 실제 운행·환승 동선은 운영기관 확인 필요`,
        level: null,
        criteria: null,
      }
    : {
        ruleId: "D14-transit@1",
        basisMetricIds: ["back_bus_stops"],
        sentence: `반경 안 버스정류장 ${busStops.length}곳 확인, 철도 자료를 확인하지 못함 → 버스 시설만 표시하고 철도 수치는 산출하지 않음 → 철도 운영 현황과 환승 동선은 원천 확인 필요`,
        level: null,
        criteria: null,
      };

  return makeTile(ctx, {
    code: "D14",
    type: "diagram",
    status,
    metrics,
    judgment,
    sources: [...busSources, ...railSources],
    layers,
    map,
    lines: lineCandidates,
    limitations,
  });
}

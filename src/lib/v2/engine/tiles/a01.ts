/** A01 입지·대중교통 — 버스정류장 + 철도(운영역·출입구·노선, 적재돼 있을 때). 거리는 직선. 철도와 버스 등급은 합치지 않는다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import type { FeatureHit } from "../../data/features";
import { candidate, fmt, makeTile, missing, nearestHit, nearestM, noDataTile, obs, type MapCandidate, type TileDraft } from "./common";
import { sampleLine } from "./geo";

export const A01_CRITERIA = "버스정류장 직선 300m 이하 좋음 · 600m 이하 보통 · 초과 주의";
export const RAIL_CRITERIA = "철도역 직선 500m 이하 좋음 · 1,000m 이하 보통 · 초과 주의";
export const BUS_GOOD_M = 300;
export const BUS_FAIR_M = 600;
export const RAIL_GOOD_M = 500;
export const RAIL_FAIR_M = 1000;
/** 최근접 철도역을 찾는 최소 탐색 반경(분석 반경이 더 크면 그것) */
export const RAIL_SEARCH_MIN_M = 1500;

type Grade = "good" | "fair" | "caution";
export function gradeBus(m: number): Grade {
  return m <= BUS_GOOD_M ? "good" : m <= BUS_FAIR_M ? "fair" : "caution";
}
export function gradeRail(m: number): Grade {
  return m <= RAIL_GOOD_M ? "good" : m <= RAIL_FAIR_M ? "fair" : "caution";
}
const PHRASE = { good: "버스 접근은 가까운 편", fair: "버스 접근은 보통 수준", caution: "버스 접근은 먼 편" } as const;
const RAIL_PHRASE = { good: "철도 접근은 가까운 편", fair: "철도 접근은 보통 수준", caution: "철도 접근은 먼 편" } as const;

interface RailPoint {
  hit: FeatureHit;
  /** 역 대표점이면 true(출입구 자료가 없는 역) */
  isStationPoint: boolean;
  dist: number;
}
interface RailStation {
  hit: FeatureHit;
  best: RailPoint;
  entrances: FeatureHit[];
}

/** 역마다 출입구(역명 일치)가 있으면 가장 가까운 출입구, 없으면 역 대표점 */
function railStations(ctx: EngineContext, searchM: number): RailStation[] {
  const hits = ctx.hits("reference", ["rail_station", "rail_entrance"], searchM);
  const byName = new Map<string, FeatureHit[]>();
  for (const e of hits.filter((h) => h.kind === "rail_entrance")) {
    const n = e.properties.stationName;
    if (typeof n === "string") byName.set(n, [...(byName.get(n) ?? []), e]);
  }
  return hits
    .filter((h) => h.kind === "rail_station")
    .map((s) => {
      const entrances = (s.name ? byName.get(s.name) : undefined) ?? [];
      const e = nearestHit(entrances);
      const best: RailPoint = e ? { hit: e, isStationPoint: false, dist: e.distanceM! } : { hit: s, isStationPoint: true, dist: s.distanceM! };
      return { hit: s, best, entrances };
    });
}

export function a01(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["bus_stop"]);
  if (sources.length === 0) return noDataTile(ctx, "A01", ["bus_stop"]);
  const railSources = ctx.sources("reference", ["osm_subway"]);
  const hasRail = railSources.length > 0;
  const hits = ctx.hits("reference", ["bus_stop"]);
  const nearest = nearestM(hits.map((h) => h.distanceM));
  const near = nearestHit(hits);

  const radiusM = ctx.input.radiusM;
  const searchM = Math.max(radiusM, RAIL_SEARCH_MIN_M);
  const stations = hasRail ? railStations(ctx, searchM) : [];
  const inRadius = stations.filter((s) => s.best.dist <= radiusM);
  const railBest = stations.reduce<RailStation | null>((b, s) => (b === null || s.best.dist < b.best.dist || (s.best.dist === b.best.dist && s.hit.featureId < b.hit.featureId) ? s : b), null);
  const railM = railBest ? Math.round(railBest.best.dist) : null;
  const usesPoint = railBest?.best.isStationPoint ?? false;
  const lineRefs = [...new Set(inRadius.flatMap((s) => (Array.isArray(s.hit.properties.lineRefs) ? (s.hit.properties.lineRefs as unknown[]) : []).filter((r): r is string => typeof r === "string")))].sort();
  const searchTxt = `탐색 ${fmt(searchM)}m`;

  const busMetric = nearest === null ? missing("nearest_bus_m", "최근접 버스정류장", "m", "a01-bus-nearest@1") : obs("nearest_bus_m", "최근접 버스정류장", nearest, "m", "a01-bus-nearest@1");
  const railLabel = usesPoint ? `최근접 철도역(역 대표점, 출입구 자료 없음)` : "최근접 철도역 출입구";
  const railFormula = `a01-rail-nearest@1:직선, ${searchTxt}`;
  const metrics: TileDraft["metrics"] = [
    !hasRail || railM === null ? missing("nearest_rail_m", "최근접 철도역 출입구", "m", hasRail ? railFormula : "a01-rail@0") : obs("nearest_rail_m", railLabel, railM, "m", railFormula),
    hasRail ? obs("rail_stations", "반경 내 운영역", inRadius.length, "개", "a01-rail-stations@1:출입구·노선 중복 제거") : missing("rail_stations", "반경 내 운영역", "개", "a01-rail@0"),
    ...(hasRail ? [obs("rail_lines", "반경 내 운영역의 노선", lineRefs.length, "개", "a01-rail-lines@1:역 속성의 노선 기호")] : []),
    busMetric,
    obs("bus_stops", "버스 정류장", hits.length, "개", "a01-bus-count@1"),
    missing("bus_routes", "경유 버스 노선", "개", "a01-bus-routes@0"),
  ];

  const busTxt = nearest === null ? "반경 안 정류장 없음" : `최근접 정류장 직선 ${nearest}m`;
  const busPhrase = nearest === null ? "버스 접근은 확인되지 않음" : PHRASE[gradeBus(nearest)];
  let judgment: TileResult["judgment"];
  if (!hasRail) {
    const tail = "철도·실제 보행 경로는 확인 필요";
    judgment =
      nearest === null
        ? { ruleId: "a01-bus-distance@1", basisMetricIds: ["bus_stops"], sentence: `반경 안 버스 정류장 없음 → 버스 접근은 확인되지 않음 → ${tail}`, level: null, criteria: null }
        : { ruleId: "a01-bus-distance@1", basisMetricIds: ["nearest_bus_m"], sentence: `${busTxt} → ${busPhrase} → ${tail}`, level: gradeBus(nearest), criteria: A01_CRITERIA };
  } else {
    const railTxt = railM === null ? `${searchTxt} 안 운영역 없음` : `최근접 ${usesPoint ? "역 대표점" : "역 출입구"} 직선 ${fmt(railM)}m`;
    const railPhrase = railM === null ? RAIL_PHRASE.caution : RAIL_PHRASE[gradeRail(railM)];
    // 철도와 버스는 각자의 기준으로 말하고 하나의 등급으로 합치지 않는다(level 없음).
    judgment = {
      ruleId: "a01-rail-bus-distance@1",
      basisMetricIds: [...(railM === null ? [] : ["nearest_rail_m"]), ...(nearest === null ? ["bus_stops"] : ["nearest_bus_m"])],
      sentence: `${railTxt}, ${busTxt} → ${railPhrase}, ${busPhrase} → 실제 보행 경로는 확인 필요`,
      level: null,
      criteria: `${RAIL_CRITERIA} / ${A01_CRITERIA}`,
    };
  }

  const map: MapCandidate[] = hits.map((h) => (h === near ? candidate(h, "bus_nearest", { highlight: true, label: `직선 ${nearest}m` }) : candidate(h, "bus_stop")));
  const layers = ["bus_stop", "bus_nearest"];
  const limitations: TileDraft["limitations"] = [];
  if (hasRail) {
    layers.push("rail_station", "rail_entrance", "rail_line", "rail_nearest");
    const nearHit = railBest && railM !== null && railBest.best.dist <= radiusM ? railBest.best.hit : null;
    for (const s of inRadius) {
      const stationIsNearest = nearHit === s.hit;
      if (!stationIsNearest) map.push(candidate(s.hit, "rail_station"));
      for (const e of s.entrances) {
        if (e.distanceM! > radiusM) continue;
        map.push(e === nearHit ? candidate(e, "rail_nearest", { highlight: true, label: `직선 ${railM}m` }) : candidate(e, "rail_entrance"));
      }
      if (stationIsNearest) map.push(candidate(s.hit, "rail_nearest", { highlight: true, label: `직선 ${railM}m` }));
    }
    const step = Math.max(50, radiusM / 30);
    for (const l of ctx.hits("reference", ["rail_line"])) map.push(...sampleLine(ctx.input.center, l.geometry, radiusM, step, l.featureId, "rail_line"));
    if (usesPoint) limitations.push({ kind: "unknown", note: "최근접 역은 출입구 자료가 없어 역 대표점 거리입니다." });
    if (railM === null) limitations.push({ kind: "unknown", note: `${searchTxt} 안에 운영역이 없어 철도 거리는 계산하지 못했습니다.` });
    else if (railM > radiusM) limitations.push({ kind: "unknown", note: `최근접 역은 분석 반경(${fmt(radiusM)}m) 밖이라 지도에는 표시하지 않았습니다.` });
    limitations.push({ kind: "unknown", note: "철도는 OSM 스냅샷의 역·출입구·노선 기호이며 운영 빈도·배차는 확인하지 않았습니다." });
  } else {
    limitations.push({ kind: "not_provided", note: "철도 자료 미적재 — 철도역 거리·역 수는 계산하지 못했습니다." });
  }
  limitations.push({ kind: "unknown", note: "정류장별 경유 노선 연결 자료가 없어 노선 수는 계산하지 못했습니다." });
  limitations.push(...ctx.coverage("reference", ["bus_stop"]));
  if (hasRail) limitations.push(...ctx.coverage("reference", ["osm_subway"]));

  return makeTile(ctx, { code: "A01", status: "partial", metrics, judgment, sources: [...sources, ...railSources], layers, map, limitations });
}

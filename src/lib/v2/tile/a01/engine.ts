/** A01 입지·대중교통 — 버스정류장 + 철도(운영역·출입구·노선, 적재돼 있을 때). 등급은 직선, 도보 지표는 보행망 라우팅으로 분리한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import type { FeatureHit } from "../../data/features";
import { toUtmk } from "../../crs";
import { candidate, fmt, hitPoint, lineCandidate, makeTile, missing, nearestHit, nearestM, noDataTile, obs, type LineCandidate, type MapCandidate, type TileDraft } from "../../engine/tiles/common";
import { clipLineToCircle, linePathLength } from "../../engine/tiles/geo";
import { walkField, walkSources, type WalkField, type WalkRoute } from "../../engine/tiles/walk-shared";
import { formatDistanceM } from "../../ui/tile-view";

export const A01_CRITERIA = "버스정류장 직선 300m 이하 좋음 · 600m 이하 보통 · 초과 주의";
export const RAIL_CRITERIA = "철도역 직선 500m 이하 좋음 · 1,000m 이하 보통 · 초과 주의";
export const A01_RAIL_CRITERIA = RAIL_CRITERIA;
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
const WORST: Record<Grade, number> = { good: 0, fair: 1, caution: 2 };

/** 철도(500/1,000m)·버스(300/600m) 등급. 근거 거리가 없는 쪽은 만들지 않는다. */
export function a01Grades(railM: number | null, busM: number | null): { grades: Array<{ metricId: string; level: Grade; criteria: string }>; level: Grade | null } {
  const grades: Array<{ metricId: string; level: Grade; criteria: string }> = [];
  if (railM !== null) grades.push({ metricId: "nearest_rail_m", level: gradeRail(railM), criteria: A01_RAIL_CRITERIA });
  if (busM !== null) grades.push({ metricId: "nearest_bus_m", level: gradeBus(busM), criteria: A01_CRITERIA });
  const level = grades.length ? grades.reduce((w, g) => (WORST[g.level] > WORST[w] ? g.level : w), grades[0].level) : null;
  return { grades, level };
}
const PHRASE = { good: "버스 접근은 가까운 편", fair: "버스 접근은 보통 수준", caution: "버스 접근은 먼 편" } as const;
const RAIL_PHRASE = { good: "철도 접근은 가까운 편", fair: "철도 접근은 보통 수준", caution: "철도 접근은 먼 편" } as const;
const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

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

interface WalkTarget {
  hit: FeatureHit;
  route: WalkRoute;
}

/** 보행망의 정점 스냅·Dijkstra 결과 중 최단 경로를 고른다. 직선 최근접과는 별개다. */
function nearestWalkTarget(field: WalkField | null, hits: FeatureHit[]): WalkTarget | null {
  if (!field) return null;
  let best: WalkTarget | null = null;
  for (const hit of hits) {
    const route = field.distTo(toUtmk(hitPoint(hit)));
    if (!route) continue;
    if (best === null || route.distanceM < best.route.distanceM || (route.distanceM === best.route.distanceM && hit.featureId < best.hit.featureId)) {
      best = { hit, route };
    }
  }
  return best;
}

function walkMetrics(prefix: string, label: string, target: WalkTarget | null): TileDraft["metrics"] {
  const formula = "a01-walk-nearest@1:OSM 보행망·80 m/분·정점 스냅";
  return target
    ? [
        obs(`${prefix}_m`, `${label} 거리`, Math.round(target.route.distanceM), "m", formula),
        obs(`${prefix}_min`, `${label} 도보시간`, target.route.minutes, "분", formula),
      ]
    : [
        missing(`${prefix}_m`, `${label} 거리`, "m", "a01-walk-nearest@0"),
        missing(`${prefix}_min`, `${label} 도보시간`, "분", "a01-walk-nearest@0"),
      ];
}

function walkSentence(hasRail: boolean, rail: WalkTarget | null, bus: WalkTarget | null): string {
  if (!rail && !bus) return hasRail ? "실제 보행 경로는 확인 필요" : "철도·실제 보행 경로는 확인 필요";
  const parts = [
    ...(hasRail && !rail ? ["철도 경로 미확인"] : []),
    ...(!hasRail ? ["철도 경로 미확인"] : []),
    ...(rail ? [`철도 ${fmt(Math.round(rail.route.distanceM))}m·${rail.route.minutes}분`] : []),
    ...(bus ? [`버스 ${fmt(Math.round(bus.route.distanceM))}m·${bus.route.minutes}분`] : []),
  ];
  return `보행망 도보(OSM, 80 m/분, 내부 제안 기준): ${parts.join(" · ")}`;
}

function addWalkLine(lines: LineCandidate[], target: WalkTarget | null, label: string): void {
  if (!target) return;
  const line = lineCandidate(
    target.hit.featureId,
    "walk_route",
    target.route.path,
    target.route.distanceM,
    null,
    {
      name: null,
      sublabel: `${label} 도보 ${formatDistanceM(target.route.distanceM)} · ${target.route.minutes}분`,
      labelPriority: 0,
      emphasis: "minor",
    },
  );
  if (line) lines.push(line);
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

function lineKey(hit: FeatureHit): string {
  return text(hit.properties.lineRef) ?? hit.stableId;
}

function railLineNames(hit: FeatureHit): string[] {
  const raw = Array.isArray(hit.properties.lineNames)
    ? hit.properties.lineNames
    : Array.isArray(hit.properties.lineRefs)
      ? hit.properties.lineRefs
      : [];
  return raw
    .map(text)
    .filter((name): name is string => name !== null)
    .map((name) => /^\d+$/.test(name) ? `${name}호선` : name);
}

const DEFAULT_RAIL_COLOR = "#1F5FA8";

function hexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

function railBadgeText(name: string): string {
  const number = name.match(/(\d+)호선/);
  return number ? number[1] : name.replace(/선$/u, "").slice(0, 4);
}

function stationBadges(hit: FeatureHit): Array<{ text: string; color: string }> {
  const names = railLineNames(hit);
  const colors = Array.isArray(hit.properties.lineColors) ? hit.properties.lineColors : [];
  return names
    .map((name, index) => ({ text: railBadgeText(name), color: hexColor(colors[index]) ?? DEFAULT_RAIL_COLOR }))
    .filter((badge) => badge.text.length > 0)
    .slice(0, 4);
}

function distanceSublabel(distanceM: number | null): string | null {
  return distanceM === null ? null : `직선 ${formatDistanceM(distanceM)}`;
}

function entranceNumber(hit: FeatureHit): string | null {
  const raw = text(hit.properties.entranceRef) ?? text(hit.name);
  return raw?.match(/(\d+)/)?.[1] ?? null;
}

function entranceDisplayName(hit: FeatureHit): string | null {
  const station = entranceStationName(hit);
  const number = entranceNumber(hit);
  const sourceName = text(hit.name);
  if (station && number) return `${station} ${number}번 출구`;
  return station && sourceName ? `${station} ${sourceName}` : station ?? sourceName;
}

function entranceBadges(hit: FeatureHit): Array<{ text: string; color: string }> {
  const number = entranceNumber(hit);
  return number ? [{ text: number.slice(0, 4), color: "#FFFFFF" }] : [];
}

function railSummaryDetail(station: RailStation): string | null {
  const name = stationName(station.hit);
  const lines = railLineNames(station.hit);
  const detail = [name, ...lines].filter((value): value is string => value !== null).join("·");
  return detail || null;
}

function railSummary(usesPoint: boolean, distanceM: number): string {
  return `최근접 ${usesPoint ? "역 대표점" : "역 출입구"} 직선 ${fmt(distanceM)}m`;
}

function countStationsWithEntrances(stations: FeatureHit[], entrances: FeatureHit[]): number {
  const stationNames = new Set(stations.map(stationName).filter((name): name is string => name !== null));
  const entranceNames = new Set(entrances.map(entranceStationName).filter((name): name is string => name !== null && stationNames.has(name)));
  return stations.reduce((count, station) => count + (stationName(station) !== null && entranceNames.has(stationName(station)!) ? 1 : 0), 0);
}

export function a01(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["bus_stop"]);
  if (sources.length === 0) return noDataTile(ctx, "A01", ["bus_stop"]);
  const railSources = ctx.sources("reference", ["osm_subway"]);
  const roadSources = walkSources(ctx);
  const hasRail = railSources.length > 0;
  const hits = ctx.hits("reference", ["bus_stop"]);
  const nearest = nearestM(hits.map((h) => h.distanceM));
  const near = nearestHit(hits);

  const radiusM = ctx.input.radiusM;
  const searchM = Math.max(radiusM, RAIL_SEARCH_MIN_M);
  const stations = hasRail ? railStations(ctx, searchM) : [];
  // D14 흡수 후의 집계 기준: 대표점 대체 거리와 별개로 반경 내 원천 feature를 직접 센다.
  const stationHits = hasRail ? ctx.hits("reference", ["rail_station"]) : [];
  const entranceHits = hasRail ? ctx.hits("reference", ["rail_entrance"]) : [];
  const railLineHits = hasRail ? ctx.hits("reference", ["rail_line"]) : [];
  const stationsWithEntrances = hasRail ? countStationsWithEntrances(stationHits, entranceHits) : 0;
  const railLineCount = new Set(railLineHits.map(lineKey)).size;
  const railBest = stations.reduce<RailStation | null>((b, s) => (b === null || s.best.dist < b.best.dist || (s.best.dist === b.best.dist && s.hit.featureId < b.hit.featureId) ? s : b), null);
  const walk = walkField(ctx);
  const walkRailTargets = stations.flatMap((s) => (s.entrances.length > 0 ? s.entrances : [s.hit]));
  const walkRail = nearestWalkTarget(walk, walkRailTargets);
  const walkBus = nearestWalkTarget(walk, hits);
  const railM = railBest ? Math.round(railBest.best.dist) : null;
  const usesPoint = railBest?.best.isStationPoint ?? false;
  const searchTxt = `탐색 ${fmt(searchM)}m`;

  const busMetric = nearest === null ? missing("nearest_bus_m", "최근접 버스정류장", "m", "a01-bus-nearest@1") : obs("nearest_bus_m", "최근접 버스정류장", nearest, "m", "a01-bus-nearest@1");
  const railLabel = usesPoint ? `최근접 철도역(역 대표점, 출입구 자료 없음)` : "최근접 철도역 출입구";
  const railFormula = `a01-rail-nearest@1:직선, ${searchTxt}`;
  const metrics: TileDraft["metrics"] = [
    !hasRail || railM === null ? missing("nearest_rail_m", "최근접 철도역 출입구", "m", hasRail ? railFormula : "a01-rail@0") : obs("nearest_rail_m", railLabel, railM, "m", railFormula),
    hasRail ? obs("rail_stations", "반경 내 운영역", stationHits.length, "개", "a01-rail-stations@2:반경 내 rail_station 원천 feature") : missing("rail_stations", "반경 내 운영역", "개", "a01-rail@0"),
    hasRail ? obs("rail_entrances", "철도역 출입구", entranceHits.length, "곳", "a01-rail-entrances@2:반경 내 rail_entrance 원천 feature") : missing("rail_entrances", "철도역 출입구", "곳", "a01-rail@0"),
    hasRail && stationHits.length > 0
      ? obs("fill_entrance_pct", "출입구 확인 역", pct(stationsWithEntrances, stationHits.length), "%", "a01-entrance-fill@2:역명 연결 출입구가 있는 반경 내 운영역÷반경 내 운영역", stationsWithEntrances, stationHits.length)
      : missing("fill_entrance_pct", "출입구 확인 역", "%", hasRail ? "a01-entrance-fill@2:역 0곳으로 분모 없음" : "a01-rail@0"),
    hasRail ? obs("rail_lines", "반경 내 철도 노선", railLineCount, "개", "a01-rail-lines@2:반경과 교차한 고유 rail_line 개수") : missing("rail_lines", "반경 내 철도 노선", "개", "a01-rail@0"),
    busMetric,
    obs("bus_stops", "버스 정류장", hits.length, "개", "a01-bus-count@1"),
    missing("bus_routes", "경유 버스 노선", "개", "a01-bus-routes@0"),
    ...walkMetrics("walk_nearest_rail", "보행망 최근접 철도역", hasRail ? walkRail : null),
    ...walkMetrics("walk_nearest_bus", "보행망 최근접 버스정류장", walkBus),
  ];
  const busTxt = nearest === null ? "반경 안 정류장 없음" : `최근접 정류장 직선 ${fmt(nearest)}m`;
  const busPhrase = nearest === null ? "버스 접근은 확인되지 않음" : PHRASE[gradeBus(nearest)];
  let judgment: TileResult["judgment"];
  if (!hasRail) {
    judgment =
      nearest === null
        ? { ruleId: "a01-bus-distance@1", basisMetricIds: ["bus_stops"], sentence: `반경 안 버스 정류장 없음 → 버스 접근은 확인되지 않음 → ${walkSentence(false, null, walkBus)}`, level: null, criteria: null }
        : { ruleId: "a01-bus-distance@1", basisMetricIds: ["nearest_bus_m"], sentence: `${busTxt} → ${busPhrase} → ${walkSentence(false, null, walkBus)}`, level: gradeBus(nearest), criteria: A01_CRITERIA, grades: a01Grades(null, nearest).grades };
  } else {
    const railTxt = railM === null ? `${searchTxt} 안 운영역 없음` : railSummary(usesPoint, railM);
    const railDetail = railM === null ? null : railSummaryDetail(railBest!);
    const railPhrase = railM === null ? RAIL_PHRASE.caution : RAIL_PHRASE[gradeRail(railM)];
    // 철도와 버스는 각자의 기준으로 말하고 하나의 등급으로 합치지 않는다(level 없음).
    judgment = {
      ruleId: "a01-rail-bus-distance@1",
      basisMetricIds: [...(railM === null ? [] : ["nearest_rail_m"]), ...(nearest === null ? ["bus_stops"] : ["nearest_bus_m"])],
      sentence: `${railTxt}, ${busTxt} → ${railPhrase}, ${busPhrase} → ${walkSentence(true, walkRail, walkBus)}${railDetail ? ` (${railDetail})` : ""}`,
      level: null,
      criteria: `${RAIL_CRITERIA} / ${A01_CRITERIA}`,
    };
  }

  const map: MapCandidate[] = hits.map((h) =>
    candidate(h, h === near ? "bus_nearest" : "bus_stop", {
      highlight: h === near,
      sublabel: h === near ? distanceSublabel(h.distanceM) : null,
      labelPriority: h === near ? 2 : 0,
    }),
  );
  const layers = ["bus_stop", "bus_nearest"];
  const lines: LineCandidate[] = [];
  addWalkLine(lines, walkRail, "철도");
  addWalkLine(lines, walkBus, "버스");
  if (lines.length > 0) layers.push("walk_route");
  const limitations: TileDraft["limitations"] = [];
  if (hasRail) {
    layers.push("rail_station", "rail_entrance", "rail_line", "rail_nearest");
    const nearestStation = nearestHit(stationHits);
    const nearestEntrance = nearestHit(entranceHits);
    // D14 흡수 후에도 반경 내 원천 역·출입구 전체를 지도에 남긴다.
    // 최근접 역과 최근접 출입구는 각각 원천 지물에 우선순위·강조를 부여한다.
    for (const station of stationHits) {
      const isNearest = station.featureId === nearestStation?.featureId;
      const lineNames = railLineNames(station);
      map.push(candidate(station, isNearest ? "rail_nearest" : "rail_station", {
        highlight: isNearest,
        sublabel: isNearest ? distanceSublabel(station.distanceM) : lineNames.length > 0 ? lineNames.join("·") : null,
        labelPriority: isNearest ? 2 : stationName(station) ? 1 : 0,
        badges: stationBadges(station),
      }));
    }
    for (const entrance of entranceHits) {
      const isNearest = entrance.featureId === nearestEntrance?.featureId;
      map.push(candidate(entrance, "rail_entrance", {
        name: entranceDisplayName(entrance),
        highlight: isNearest,
        sublabel: isNearest ? distanceSublabel(entrance.distanceM) : null,
        labelPriority: isNearest ? 2 : 0,
        badges: entranceBadges(entrance),
      }));
    }
    const railLineParts = railLineHits.flatMap((l) => clipLineToCircle(ctx.input.center, radiusM, l.geometry).map((path, index) => ({
      hit: l,
      index,
      path,
      lengthM: linePathLength(path),
    })));
    const longestByLine = new Map<string, { lengthM: number; fid: string }>();
    for (const part of railLineParts) {
      const fid = `${part.hit.featureId}:${part.index}`;
      const key = lineKey(part.hit);
      const current = longestByLine.get(key);
      if (!current || part.lengthM > current.lengthM || (part.lengthM === current.lengthM && fid < current.fid)) longestByLine.set(key, { lengthM: part.lengthM, fid });
    }
    for (const part of railLineParts) {
      const name = text(part.hit.name);
      const fid = `${part.hit.featureId}:${part.index}`;
      const line = lineCandidate(part.hit.featureId, "rail_line", part.path, part.lengthM, null, {
        fid,
        name,
        sublabel: null,
        labelPriority: name && longestByLine.get(lineKey(part.hit))?.fid === fid ? 1 : 0,
        color: hexColor(part.hit.properties.color) ?? DEFAULT_RAIL_COLOR,
        emphasis: "major",
      });
      if (line) lines.push(line);
    }
    if (usesPoint) limitations.push({ kind: "unknown", note: "최근접 역은 출입구 자료가 없어 역 대표점 거리입니다." });
    if (railM === null) limitations.push({ kind: "unknown", note: `${searchTxt} 안에 운영역이 없어 철도 거리는 계산하지 못했습니다.` });
    else if (railM > radiusM) limitations.push({ kind: "unknown", note: `최근접 역은 분석 반경(${fmt(radiusM)}m) 밖이라 지도에는 표시하지 않았습니다.` });
    limitations.push({ kind: "unknown", note: "철도는 OSM 스냅샷의 역·출입구·노선 기호이며 운영 빈도·배차는 확인하지 않았습니다." });
  } else {
    limitations.push({ kind: "not_provided", note: "철도 자료를 확인하지 못해 철도역 거리·역 수는 계산하지 못했습니다." });
  }
  limitations.push({ kind: "unknown", note: "정류장별 경유 노선 연결 자료가 없어 노선 수는 계산하지 못했습니다." });
  if (roadSources.length === 0) {
    limitations.push({ kind: "not_provided", note: "보행망 자료를 확인하지 못해 거리·시간·경로를 계산하지 못했습니다." });
  } else {
    limitations.push({ kind: "unknown", note: "보행망 도보는 OSM 중심선·80 m/분·정점 스냅 기준이며 실제 입구·횡단·경사는 반영하지 않았습니다." });
    limitations.push(...ctx.coverage("reference", ["osm_roads"]));
  }
  limitations.push(...ctx.coverage("reference", ["bus_stop"]));
  if (hasRail) limitations.push(...ctx.coverage("reference", ["osm_subway"]));

  return makeTile(ctx, { code: "A01", status: "partial", metrics, judgment, sources: [...sources, ...railSources, ...roadSources], layers, map, lines, limitations });
}

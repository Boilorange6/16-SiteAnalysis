/** D13 도로 — OSM 도로 중심선 길이와 위계별 구성비. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { ROAD_HIERARCHIES, type RoadHierarchy } from "../../ingest/sources/osm-roads";
import { clipLineToCircle, distanceToLineM, lineLengthInCircle, linePathLength } from "../../engine/tiles/geo";
import { lineCandidate, makeTile, missing, obs, type LineCandidate, type TileDraft } from "../../engine/tiles/common";
import { notProvided } from "../../engine/tiles/not-provided";
import { formatDistanceM } from "../../ui/tile-view";

const ROAD_SOURCES = ["osm_roads"] as const;
const ROAD_LAYERS = ROAD_HIERARCHIES.map((hierarchy) => `road:${hierarchy}`);
const ARTERIAL = new Set<RoadHierarchy>(["고속도로", "간선"]);
const NAMED_ROADS = new Set<RoadHierarchy>(["고속도로", "간선", "보조간선"]);

function hierarchyOf(value: unknown): RoadHierarchy {
  return typeof value === "string" && (ROAD_HIERARCHIES as readonly string[]).includes(value) ? value as RoadHierarchy : "기타";
}

/** 반올림한 0.1%가 합계 100.0%가 되도록 가장 큰 항목에 잔차를 넣는다. */
function sharesTenths(lengths: readonly number[], total: number): number[] {
  if (total <= 0) return lengths.map(() => 0);
  const units = lengths.map((length) => Math.round((length / total) * 1000));
  const adjust = lengths.reduce((best, length, index) => length > lengths[best] ? index : best, 0);
  units[adjust] += 1000 - units.reduce((sum, value) => sum + value, 0);
  return units.map((value) => value / 10);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function d13(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ROAD_SOURCES);
  if (sources.length === 0) return notProvided(ctx, "D13", "도로 자료를 확인하지 못했습니다. 최신 도로 자료 확인 후 제공됩니다.");

  const roads = ctx.hits("reference", ["road"]);
  const lengths = ROAD_HIERARCHIES.map(() => 0);
  const lineParts: Array<{ road: (typeof roads)[number]; index: number; path: number[][]; lengthM: number; hierarchy: RoadHierarchy }> = [];
  for (const road of roads) {
    const hierarchy = hierarchyOf(road.properties.hierarchy);
    const index = ROAD_HIERARCHIES.indexOf(hierarchy);
    const length = lineLengthInCircle(ctx.input.center, ctx.input.radiusM, road.geometry);
    lengths[index] += length;
    for (const [pathIndex, path] of clipLineToCircle(ctx.input.center, ctx.input.radiusM, road.geometry).entries()) {
      lineParts.push({ road, index: pathIndex, path, lengthM: linePathLength(path), hierarchy });
    }
  }

  const total = lengths.reduce((sum, length) => sum + length, 0);
  const totalRounded = Math.round(total);
  const shareValues = sharesTenths(lengths, total);
  const shareMetrics: TileDraft["metrics"] = total <= 0
    ? ROAD_HIERARCHIES.map((hierarchy, index) => missing(`share_road_${index + 1}`, `구성비: ${hierarchy}`, "%", "d13-share-length@1:위계별 반경 교차 중심선 길이÷전체 중심선 길이"))
    : ROAD_HIERARCHIES.map((hierarchy, index) => obs(
        `share_road_${index + 1}`,
        `구성비: ${hierarchy}`,
        shareValues[index],
        "%",
        "d13-share-length@1:위계별 반경 교차 중심선 길이÷전체 중심선 길이",
        Math.round(lengths[index]),
        totalRounded,
      ));

  const nearestSearchM = Math.min(5000, Math.max(ctx.input.radiusM, 1500));
  const nearestCandidates = ctx.hits("reference", ["road"], nearestSearchM).filter((hit) => ARTERIAL.has(hierarchyOf(hit.properties.hierarchy)));
  const nearestCandidatesWithDistance = nearestCandidates
    .map((hit) => ({ hit, distance: distanceToLineM(ctx.input.center, hit.geometry) }))
    .filter((item): item is { hit: (typeof nearestCandidates)[number]; distance: number } => item.distance !== null)
    .sort((a, b) => a.distance - b.distance || a.hit.featureId - b.hit.featureId);
  const nearestCandidate = nearestCandidatesWithDistance[0] ?? null;
  const nearest = nearestCandidate === null ? null : Math.round(nearestCandidate.distance);
  const nearestMetric = nearest === null
    ? missing("nearest_arterial_or_higher_m", "최근접 간선 이상 도로 중심선", "m", "d13-nearest@1:검색 반경 안 간선·고속도로 중심선까지의 최단 거리")
    : obs("nearest_arterial_or_higher_m", "최근접 간선 이상 도로 중심선", nearest, "m", "d13-nearest@1:검색 반경 안 간선·고속도로 중심선까지의 최단 거리", nearest, null);

  const coverage = ctx.coverage("reference", ROAD_SOURCES);
  const topShares = ROAD_HIERARCHIES
    .map((hierarchy, index) => ({ hierarchy, index, value: shareValues[index] }))
    .filter(({ value }) => value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, 2)
    .map(({ hierarchy, value }) => `${hierarchy} ${value.toFixed(1)}%`)
    .join(" · ");
  const nearestName = nearestCandidate === null
    ? null
    : text(nearestCandidate.hit.name) ?? text(nearestCandidate.hit.properties.name);
  const nearestText = nearest === null ? "확인되지 않음" : `${nearestName ? `${nearestName} ` : ""}${formatDistanceM(nearest)}`;
  const longestByName = new Map<string, number>();
  for (const part of lineParts) {
    const name = text(part.road.name);
    if (!name) continue;
    const key = `${part.hierarchy}|${name}`;
    longestByName.set(key, Math.max(longestByName.get(key) ?? 0, part.lengthM));
  }
  const lines: LineCandidate[] = [];
  for (const part of lineParts) {
    const name = text(part.road.name);
    const key = name ? `${part.hierarchy}|${name}` : null;
    const isNearest = nearestCandidate?.hit.featureId === part.road.featureId;
    const isLongest = key !== null && part.lengthM === longestByName.get(key);
    const line = lineCandidate(part.road.featureId, `road:${part.hierarchy}`, part.path, part.lengthM, null, {
      fid: `${part.road.featureId}:${part.index}`,
      name,
      sublabel: isNearest && nearest !== null ? `직선 ${formatDistanceM(nearest)}` : null,
      labelPriority: isNearest ? 2 : isLongest && NAMED_ROADS.has(part.hierarchy) ? 1 : 0,
      emphasis: NAMED_ROADS.has(part.hierarchy) ? "major" : "minor",
    });
    if (line) lines.push(line);
  }
  const sentence = total <= 0
    ? `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안 OSM 도로 중심선이 확인되지 않음 → 도로 공백과 원천 미확보를 구분할 수 없음 → 최신 OSM과 공식 도로대장 확인 필요`
    : `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안 OSM 도로 중심선 ${totalRounded.toLocaleString("en-US")}m, 구성비 상위 2: ${topShares || "확인되지 않음"}, 최근접 간선 이상 도로 ${nearestText} → 위계별 중심선 길이 구성비로 표시하고 선폭·공식 등급은 판단하지 않음 → 최신 OSM과 공식 도로대장 확인 필요`;

  return makeTile(ctx, {
    code: "D13",
    type: "diagram",
    status: "partial",
    metrics: [
      obs("road_length_in_radius_m", "반경 안 도로 중심선 총길이", totalRounded, "m", "d13-length@1:도로 선분과 반경 원이 교차하는 실제 중심선 길이 합", totalRounded, null),
      ...shareMetrics,
      nearestMetric,
    ],
    judgment: { ruleId: "D13-osm-roads@1", basisMetricIds: ["road_length_in_radius_m", "nearest_arterial_or_higher_m"], sentence, level: null, criteria: null },
    sources,
    layers: ROAD_LAYERS,
    lines,
    limitations: [
      { kind: "partial", note: "Geofabrik OSM 무료 SHP에서 확보한 도로 중심선만 집계합니다. OSM 커버리지와 갱신 시점은 지역별로 다릅니다." },
      { kind: "unknown", note: "중심선 길이는 실제 도로 폭·차로 수·통행 가능 여부·공식 도로 등급을 뜻하지 않으며 공식 도로대장이 아닙니다." },
      { kind: "unknown", note: "© OpenStreetMap contributors · ODbL 1.0" },
      ...coverage,
    ],
  });
}

/** A04 공원·녹지 — 공원은 대표점 자료뿐이다(경계·입구 미적재). 직선 대표점과 보행망 경로를 분리한다. */
import type { TileResult } from "../../tile-result";
import type { FeatureHit } from "../../data/features";
import type { EngineContext } from "../context";
import { toUtmk } from "../../crs";
import { candidate, hitPoint, lineCandidate, makeTile, missing, nearestHit, nearestM, noDataTile, obs, type LineCandidate, type TileDraft } from "./common";
import { walkField, walkSources, type WalkField, type WalkRoute } from "./walk-shared";

interface WalkTarget {
  hit: FeatureHit;
  route: WalkRoute;
}

/** 보행망의 정점 스냅·Dijkstra 결과에서 공원 대표점까지 최단 경로를 고른다. */
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

function walkMetrics(target: WalkTarget | null): TileDraft["metrics"] {
  const formula = "a04-walk-nearest@1:OSM 보행망·80 m/분·정점 스냅";
  return target
    ? [
        obs("walk_nearest_park_m", "보행망 최근접 공원 거리", Math.round(target.route.distanceM), "m", formula),
        obs("walk_nearest_park_min", "보행망 최근접 공원 도보시간", target.route.minutes, "분", formula),
      ]
    : [
        missing("walk_nearest_park_m", "보행망 최근접 공원 거리", "m", "a04-walk-nearest@0"),
        missing("walk_nearest_park_min", "보행망 최근접 공원 도보시간", "분", "a04-walk-nearest@0"),
      ];
}

export function a04(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["park"]);
  if (sources.length === 0) return noDataTile(ctx, "A04", ["park"]);
  const roadSources = walkSources(ctx);
  const hits = ctx.hits("reference", ["park"]);
  const nearest = nearestM(hits.map((h) => h.distanceM));
  const near = nearestHit(hits);
  const walkPark = nearestWalkTarget(walkField(ctx), hits);
  const areas = hits.map((h) => h.properties.areaM2).filter((a): a is number => typeof a === "number" && a > 0);
  const areaSum = Math.round(areas.reduce((s, a) => s + a, 0));
  const noArea = hits.length - areas.length;
  const metrics = [
    obs("parks", "반경 내 공원", hits.length, "곳", "a04-count@1"),
    nearest === null ? missing("nearest_park_point_m", "공원 대표점까지", "m", "a04-nearest-point@1") : obs("nearest_park_point_m", "공원 대표점까지", nearest, "m", "a04-nearest-point@1"),
    obs("park_area_sum_m2", "반경 내 공원 원천 면적 합", areaSum, "㎡", "a04-source-area-sum@1", areas.length, hits.length),
    missing("park_area_in_radius_m2", "반경 안에 든 공원 면적", "㎡", "a04-area-in-radius@0"),
    ...walkMetrics(walkPark),
  ];
  const sentence =
    nearest === null
      ? "반경 안 공원 대표점이 확인되지 않음 → 공원 경계·입구 자료가 없어 접근성은 판단하지 않음 → 실제 입구와 경계 확인 필요"
      : walkPark
        ? `공원 ${hits.length}곳 확인, 대표점까지 직선 ${nearest}m → 입구가 아닌 대표점 기준의 거리와 보행망 도보(OSM, 80 m/분, 내부 제안 기준) ${Math.round(walkPark.route.distanceM)}m·${walkPark.route.minutes}분을 함께 표시 → 실제 입구와 경계 확인 필요`
        : `공원 ${hits.length}곳 확인, 대표점까지 직선 ${nearest}m → 입구가 아닌 대표점 기준의 거리임 → 실제 입구와 경계 확인 필요`;
  const lines: LineCandidate[] = [];
  if (walkPark) {
    const line = lineCandidate(
      walkPark.hit.featureId,
      "walk_route",
      walkPark.route.path,
      walkPark.route.distanceM,
      `공원 도보 ${Math.round(walkPark.route.distanceM)}m · ${walkPark.route.minutes}분`,
    );
    if (line) lines.push(line);
  }
  const layers = ["park", "park_nearest"];
  if (lines.length > 0) layers.push("walk_route");
  const limitations: TileDraft["limitations"] = [
    { kind: "not_provided", note: "공원 경계·입구 자료 미적재 — 반경 안 면적과 입구 거리는 계산하지 못했습니다." },
    { kind: "unknown", note: `면적 합은 원천에 적힌 공원 면적이며 반경에 걸친 공원도 전체가 들어갑니다.${noArea > 0 ? ` 면적 미기재 ${noArea}곳은 합에서 제외했습니다.` : ""}` },
  ];
  if (roadSources.length === 0) {
    limitations.push({ kind: "not_provided", note: "보행망 자료 미적재 — 거리·시간·경로를 계산하지 못했습니다." });
  } else {
    limitations.push({ kind: "unknown", note: "보행망 도보는 OSM 중심선·80 m/분·정점 스냅 기준이며 공원 입구·횡단·경사는 반영하지 않았습니다." });
    limitations.push(...ctx.coverage("reference", ["osm_roads"]));
  }
  limitations.push(...ctx.coverage("reference", ["park"]));
  return makeTile(ctx, {
    code: "A04",
    status: "partial",
    metrics,
    judgment: { ruleId: "a04-park-points@1", basisMetricIds: ["parks"], sentence, level: null, criteria: null },
    sources: [...sources, ...roadSources],
    layers,
    map: hits.map((h) => {
      const weight = typeof h.properties.areaM2 === "number" && h.properties.areaM2 > 0 ? h.properties.areaM2 : null;
      return h === near ? candidate(h, "park_nearest", { weight, highlight: true, label: `대표점 ${nearest}m` }) : candidate(h, "park", { weight });
    }),
    lines,
    limitations,
  });
}

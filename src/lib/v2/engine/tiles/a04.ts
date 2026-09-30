/** A04 공원·녹지 — 공원은 대표점 자료뿐이다(경계·입구 미적재). 개수와 대표점 거리만, 등급 없음. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { makeTile, missing, nearestM, noDataTile, obs } from "./common";

export function a04(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["park"]);
  if (sources.length === 0) return noDataTile(ctx, "A04", ["park"]);
  const hits = ctx.hits("reference", ["park"]);
  const nearest = nearestM(hits.map((h) => h.distanceM));
  const areas = hits.map((h) => h.properties.areaM2).filter((a): a is number => typeof a === "number" && a > 0);
  const areaSum = Math.round(areas.reduce((s, a) => s + a, 0));
  const noArea = hits.length - areas.length;
  const metrics = [
    obs("parks", "반경 내 공원", hits.length, "곳", "a04-count@1"),
    nearest === null ? missing("nearest_park_point_m", "공원 대표점까지", "m", "a04-nearest-point@1") : obs("nearest_park_point_m", "공원 대표점까지", nearest, "m", "a04-nearest-point@1"),
    obs("park_area_sum_m2", "반경 내 공원 원천 면적 합", areaSum, "㎡", "a04-source-area-sum@1", areas.length, hits.length),
    missing("park_area_in_radius_m2", "반경 안에 든 공원 면적", "㎡", "a04-area-in-radius@0"),
  ];
  const sentence =
    nearest === null
      ? "반경 안 공원 대표점이 확인되지 않음 → 공원 경계·입구 자료가 없어 접근성은 판단하지 않음 → 실제 입구와 경계 확인 필요"
      : `공원 ${hits.length}곳 확인, 대표점까지 직선 ${nearest}m → 입구가 아닌 대표점 기준의 거리임 → 실제 입구와 경계 확인 필요`;
  return makeTile(ctx, {
    code: "A04",
    status: "partial",
    metrics,
    judgment: { ruleId: "a04-park-points@1", basisMetricIds: ["parks"], sentence, level: null, criteria: null },
    sources,
    layers: ["park"],
    limitations: [
      { kind: "not_provided", note: "공원 경계·입구 자료 미적재 — 반경 안 면적과 입구 거리는 계산하지 못했습니다." },
      { kind: "unknown", note: `면적 합은 원천에 적힌 공원 면적이며 반경에 걸친 공원도 전체가 들어갑니다.${noArea > 0 ? ` 면적 미기재 ${noArea}곳은 합에서 제외했습니다.` : ""}` },
      ...ctx.coverage("reference", ["park"]),
    ],
  });
}

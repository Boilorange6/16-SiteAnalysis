/** A01 입지·대중교통 — 이번 판은 버스정류장만 계산한다(철도 자료 미적재). 거리는 직선. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { candidate, makeTile, missing, nearestHit, nearestM, noDataTile, obs } from "./common";

export const A01_CRITERIA = "버스정류장 직선 300m 이하 좋음 · 600m 이하 보통 · 초과 주의";
export const BUS_GOOD_M = 300;
export const BUS_FAIR_M = 600;

export function gradeBus(m: number): "good" | "fair" | "caution" {
  return m <= BUS_GOOD_M ? "good" : m <= BUS_FAIR_M ? "fair" : "caution";
}
const PHRASE = { good: "버스 접근은 가까운 편", fair: "버스 접근은 보통 수준", caution: "버스 접근은 먼 편" } as const;

export function a01(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["bus_stop"]);
  if (sources.length === 0) return noDataTile(ctx, "A01", ["bus_stop"]);
  const hits = ctx.hits("reference", ["bus_stop"]);
  const nearest = nearestM(hits.map((h) => h.distanceM));
  const near = nearestHit(hits);
  const metrics = [
    missing("nearest_rail_m", "최근접 철도역 출입구", "m", "a01-rail@0"),
    missing("rail_stations", "반경 내 운영역", "개", "a01-rail@0"),
    nearest === null ? missing("nearest_bus_m", "최근접 버스정류장", "m", "a01-bus-nearest@1") : obs("nearest_bus_m", "최근접 버스정류장", nearest, "m", "a01-bus-nearest@1"),
    obs("bus_stops", "버스 정류장", hits.length, "개", "a01-bus-count@1"),
    missing("bus_routes", "경유 버스 노선", "개", "a01-bus-routes@0"),
  ];
  const tail = "철도·실제 보행 경로는 확인 필요";
  const judgment =
    nearest === null
      ? { ruleId: "a01-bus-distance@1", basisMetricIds: ["bus_stops"], sentence: `반경 안 버스 정류장 없음 → 버스 접근은 확인되지 않음 → ${tail}`, level: null, criteria: null }
      : {
          ruleId: "a01-bus-distance@1",
          basisMetricIds: ["nearest_bus_m"],
          sentence: `최근접 정류장 직선 ${nearest}m → ${PHRASE[gradeBus(nearest)]} → ${tail}`,
          level: gradeBus(nearest),
          criteria: A01_CRITERIA,
        };
  return makeTile(ctx, {
    code: "A01",
    status: "partial",
    metrics,
    judgment,
    sources,
    layers: ["bus_stop", "bus_nearest"],
    map: hits.map((h) => (h === near ? candidate(h, "bus_nearest", { highlight: true, label: `직선 ${nearest}m` }) : candidate(h, "bus_stop"))),
    limitations: [
      { kind: "not_provided", note: "철도 자료 미적재 — 철도역 거리·역 수는 계산하지 못했습니다." },
      { kind: "unknown", note: "정류장별 경유 노선 연결 자료가 없어 노선 수는 계산하지 못했습니다." },
      ...ctx.coverage("reference", ["bus_stop"]),
    ],
  });
}

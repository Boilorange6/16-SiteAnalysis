/**
 * A06 분양·입주예정 공급 — 원천별로 따로 센다. 청약홈과 입주예정은 같은 사업이 겹칠 수 있어 합계를 내지 않는다.
 * 일정은 월 단위이며 임의의 일자를 붙이지 않는다.
 */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { fmt, makeTile, noDataTile, obs, type TileDraft } from "./common";

const SOURCES = [
  { key: "applyhome", label: "청약홈" },
  { key: "move_in", label: "입주예정" },
] as const;
type Bucket = "m0_12" | "m13_24" | "later" | "past" | "unscheduled";
const BUCKETS: Array<{ id: Bucket; label: string }> = [
  { id: "m0_12", label: "분석일 기준 0~12개월" },
  { id: "m13_24", label: "13~24개월" },
  { id: "later", label: "24개월 이후" },
  { id: "past", label: "분석일 이전" },
  { id: "unscheduled", label: "일정 미확인" },
];

/** plannedMonth("YYYY-MM")를 분석일 기준 개월 차로 나눈다. 형식이 다르면 일정 미확인. */
export function bucketOf(plannedMonth: unknown, analysisDate: string): Bucket {
  const m = typeof plannedMonth === "string" ? /^(\d{4})-(\d{2})$/.exec(plannedMonth) : null;
  if (!m) return "unscheduled";
  const d = Number(m[1]) * 12 + Number(m[2]) - (Number(analysisDate.slice(0, 4)) * 12 + Number(analysisDate.slice(5, 7)));
  return d < 0 ? "past" : d <= 12 ? "m0_12" : d <= 24 ? "m13_24" : "later";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function a06(ctx: EngineContext): TileResult {
  const sources = ctx.sources("market", ["applyhome", "move_in"]);
  if (sources.length === 0) return noDataTile(ctx, "A06", ["applyhome", "move_in"]);
  const hits = ctx.hits("market", ["planned_supply"]);

  // development_event와 연결되는 사업 수(중복 제거는 다음 단계, 이번엔 연결 가능 여부만 기록)
  const market = ctx.db("market")!;
  const ids = hits.map((h) => h.stableId);
  const linked = ids.length
    ? (market.prepare(`SELECT count(*) FROM development_event WHERE geometry_id IN (${ids.map(() => "?").join(",")})`).pluck().get(...ids) as number)
    : 0;
  const link = `event-link=${linked}/${hits.length}`;

  const metrics: TileDraft["metrics"] = [];
  const sums: Record<string, number> = {};
  for (const s of SOURCES) {
    const mine = hits.filter((h) => h.properties.source === s.key);
    const withUnits = mine.filter((h) => num(h.properties.units) !== null);
    const units = withUnits.reduce((sum, h) => sum + (h.properties.units as number), 0);
    sums[s.key] = units;
    metrics.push(
      obs(`${s.key}_units`, `${s.label} 공급 세대`, units, "세대", "a06-units@1", withUnits.length, mine.length),
      obs(`${s.key}_projects`, `${s.label} 사업`, mine.length, "곳", `a06-projects@1;${link}`),
    );
    for (const b of BUCKETS) {
      const inBucket = withUnits.filter((h) => bucketOf(h.properties.plannedMonth, ctx.input.analysisDate) === b.id);
      metrics.push(obs(`${s.key}_units_${b.id}`, `${s.label} ${b.label} 세대`, inBucket.reduce((sum, h) => sum + (h.properties.units as number), 0), "세대", "a06-buckets@1", inBucket.length, withUnits.length));
    }
  }
  const empty = hits.length === 0;
  const sentence = empty
    ? "반경 안 분양·입주예정 사업이 확인되지 않음 → 위치를 확인하지 못한 사업은 빠져 있을 수 있음 → 사업별 연결 확인 필요"
    : `청약홈 ${fmt(sums.applyhome)}세대, 입주예정 ${fmt(sums.move_in)}세대가 각각 확인됨 → 같은 사업이 겹쳐 잡혔을 수 있어 합계는 내지 않음 → 사업별 연결 확인 필요`;
  return makeTile(ctx, {
    code: "A06",
    status: "partial",
    metrics,
    judgment: { ruleId: "a06-by-source@1", basisMetricIds: ["applyhome_units", "move_in_units"], sentence, level: null, criteria: null },
    sources,
    layers: ["planned_supply"],
    limitations: [
      { kind: "partial", note: "청약홈·입주예정에 같은 사업이 중복 등장할 수 있어 합계를 보류했습니다. 중복 제거는 다음 단계입니다." },
      ...ctx.coverage("market", ["applyhome", "move_in"]),
    ],
  });
}

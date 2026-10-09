/**
 * A06 분양·입주예정 공급 — 원천별로 따로 센다. 청약홈과 입주예정은 같은 사업이 겹칠 수 있어 합계를 내지 않는다.
 * 일정은 월 단위이며 임의의 일자를 붙이지 않는다.
 */
import type { TileResult } from "../../tile-result";
import { timingBucket, type Timing } from "../../ui/callout-layout";
import { unitTypesFromUnknown } from "../../unit-types";
import type { EngineContext } from "../../engine/context";
import { candidate, fmt, makeTile, noDataTile, obs, type TileDraft } from "../../engine/tiles/common";

const SOURCES = [
  { key: "applyhome", label: "청약홈" },
  { key: "move_in", label: "입주예정" },
] as const;
const BUCKETS: Array<{ id: Timing; label: string }> = [
  { id: "m0_12", label: "분석일 기준 0~12개월" },
  { id: "m13_24", label: "13~24개월" },
  { id: "later", label: "24개월 이후" },
  { id: "past", label: "분석일 이전" },
  { id: "unscheduled", label: "일정 미확인" },
];

/** plannedMonth("YYYY-MM")를 분석일 기준 개월 차로 나눈다. 형식이 다르면 일정 미확인. (화면 점 색과 같은 함수) */
export const bucketOf = timingBucket;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

const normName = (s: unknown) => (typeof s === "string" ? s.replace(/\([^)]*\)/g, "").replace(/[^0-9A-Za-z가-힣]/g, "").replace(/아파트$/, "") : "");
/** "…상일동 43번지 일원" / "…상일동 43-0" → "상일동43-0" (동·본번·부번만) */
const normAddr = (s: unknown) => {
  const m = typeof s === "string" ? /([가-힣]+\d*[동가리])\s*(\d+)(?:-(\d+))?/.exec(s) : null;
  return m ? `${m[1]}${m[2]}-${Number(m[3] ?? 0)}` : "";
};

/**
 * 서로 다른 원천에 같은 사업이 있는지. development_event.project_id는 사업 하나마다 새로 붙어(원천 사이 연결 없음) 쓸 수 없어,
 * 정규화한 이름이 같거나 주소가 같으면 "겹칠 수 있음"으로만 표시한다. 합치지 않고 합계도 만들지 않는다.
 */
export function markOverlaps(items: Array<{ source: string; name: string | null; address: unknown }>): boolean[] {
  const keys = items.map((it) => ({ n: normName(it.name), a: normAddr(it.address) }));
  return items.map((it, i) =>
    items.some((o, j) => j !== i && o.source !== it.source && ((keys[i].n !== "" && keys[i].n === keys[j].n) || (keys[i].a.length >= 6 && keys[i].a === keys[j].a))),
  );
}

const TYPE_TEXT: Record<string, string> = { apartment: "아파트", officetel: "오피스텔", residential: "주거" };

export function a06(ctx: EngineContext): TileResult {
  const sources = ctx.sources("market", ["applyhome", "applyhome_types", "move_in"]);
  if (sources.length === 0) return noDataTile(ctx, "A06", ["applyhome", "applyhome_types", "move_in"]);
  const hits = ctx.hits("market", ["planned_supply"]);

  // development_event 연결 근거는 남기되 SQLite 변수 상한을 넘지 않도록 500개씩 조회한다.
  const market = ctx.db("market")!;
  const ids = hits.map((h) => h.stableId);
  let linked = 0;
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    linked += chunk.length
      ? (market.prepare(`SELECT count(*) FROM development_event WHERE geometry_id IN (${chunk.map(() => "?").join(",")})`).pluck().get(...chunk) as number)
      : 0;
  }
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
      obs(`${s.key}_unit_type_projects`, `${s.label} 전용면적 타입 확인 사업`, mine.filter((h) => unitTypesFromUnknown(h.properties.unitTypes).length > 0).length, "곳", "a06-unit-types@1", mine.filter((h) => unitTypesFromUnknown(h.properties.unitTypes).length > 0).length, mine.length),
    );
    for (const b of BUCKETS) {
      const inBucket = withUnits.filter((h) => bucketOf(h.properties.plannedMonth, ctx.input.analysisDate) === b.id);
      metrics.push(obs(`${s.key}_units_${b.id}`, `${s.label} ${b.label} 세대`, inBucket.reduce((sum, h) => sum + (h.properties.units as number), 0), "세대", "a06-buckets@1", inBucket.length, withUnits.length));
    }
  }
  const mapped = hits.filter((h) => h.properties.source === "applyhome" || h.properties.source === "move_in");
  const overlaps = markOverlaps(mapped.map((h) => ({ source: h.properties.source as string, name: h.name, address: h.properties.address })));
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
    layers: SOURCES.map((s) => s.key),
    map: mapped.map((h, i) => {
      const month = typeof h.properties.plannedMonth === "string" && /^\d{4}-\d{2}$/.test(h.properties.plannedMonth) ? h.properties.plannedMonth : null;
      const kind = typeof h.properties.kind === "string" ? h.properties.kind : null;
      return candidate(h, h.properties.source as string, {
        weight: num(h.properties.units),
        households: num(h.properties.units),
        name: h.name,
        type: kind === null ? null : (TYPE_TEXT[kind] ?? kind),
        plannedMonth: month,
        distanceM: h.distanceM === null ? null : Math.round(h.distanceM),
        overlap: overlaps[i],
        unitTypes: unitTypesFromUnknown(h.properties.unitTypes),
      });
    }),
    limitations: [
      { kind: "partial", note: "청약홈·입주예정에 같은 사업이 중복 등장할 수 있어 합계를 보류했습니다. 이름·주소가 같은 쌍은 \"중복 가능\"으로 표시하지만 합치지는 않습니다." },
      ...ctx.coverage("market", ["applyhome", "applyhome_types", "move_in"]),
    ],
  });
}

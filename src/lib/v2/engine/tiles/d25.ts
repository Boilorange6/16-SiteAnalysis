/** D25 실거래 — 최근 12개월 아파트 매매의 단가 분위별 거래 건수와 위치 채움률. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { collectTrades, quintileOf, type TradePoint } from "./a07";
import { fmt, makeTile, missing, obs, type MapCandidate, type TileDraft } from "./common";
import { notProvided } from "./not-provided";

const SOURCE = "rtms_apt_trade";
const QUINTILES = [1, 2, 3, 4, 5] as const;
const QUINTILE_LABELS = [
  "㎡당 하위 20% 거래 건수",
  "㎡당 20~40% 거래 건수",
  "㎡당 40~60% 거래 건수",
  "㎡당 60~80% 거래 건수",
  "㎡당 상위 20% 거래 건수",
] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;

function tradeMap(points: TradePoint[]): MapCandidate[] {
  const top3 = new Set([...points].sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 3).map((p) => p.pnu));
  const all = points.map((p) => p.m);
  return points.map((p) => ({
    id: p.i,
    f: {
      layer: `trade_q${quintileOf(p.m, all)}`,
      lng: Math.round(p.at[0] * 1e6) / 1e6,
      lat: Math.round(p.at[1] * 1e6) / 1e6,
      weight: p.n,
      ...(top3.has(p.pnu) ? { label: `${p.n}건 ${fmt(Math.round(p.m))}만원/㎡` } : {}),
    },
  }));
}

export function d25(ctx: EngineContext): TileResult {
  const trades = collectTrades(ctx);
  if (!trades) return notProvided(ctx, "D25");

  const { sources, valid, priced, points, unlocated, absent, cancelled } = trades;
  const locationTotal = valid.length + unlocated;
  const locationPct = locationTotal > 0 ? round1((valid.length / locationTotal) * 100) : null;
  const units = priced.map((trade) => trade.unit);
  const quintileCounts = new Map<(typeof QUINTILES)[number], number>(QUINTILES.map((q) => [q, 0]));
  for (const unit of units) {
    const q = quintileOf(unit, units);
    quintileCounts.set(q, (quintileCounts.get(q) ?? 0) + 1);
  }
  const noArea = valid.length - priced.length;
  const coverage = ctx.coverage("market", [SOURCE]);

  const metrics: TileDraft["metrics"] = [
    locationPct === null
      ? missing("fill_location_pct", "위치 확인률", "%", "d25-location-fill@1:위치 확인 거래÷(위치 확인+위치 미확인)")
      : obs("fill_location_pct", "위치 확인률", locationPct, "%", "d25-location-fill@1:위치 확인 거래÷(위치 확인+위치 미확인)", valid.length, locationTotal),
    obs("unlocated_trades", "위치 미확인 거래", unlocated, "건", "d25-location@1:최근 12개월·취소 제외·시군구 자료 내 위치 미확인 거래"),
    ...QUINTILES.map((q, i) =>
      obs(`back_q${q}`, QUINTILE_LABELS[i], quintileCounts.get(q) ?? 0, "건", "d25-quintile-count@1:단지 중앙값이 아닌 원거래별 ㎡당 단가 구간 건수"),
    ),
  ];

  const status: TileResult["status"] = absent.length > 0 || unlocated > 0 || coverage.some((l) => l.kind === "partial" || l.kind === "incomplete") ? "partial" : "complete";
  const locationText = locationTotal > 0 ? `위치 확인률 ${locationPct}%(${valid.length}/${locationTotal})` : "위치 확인 거래 없음";
  const sentence =
    valid.length === 0
      ? `아파트 매매 · 최근 12개월 반경 안 위치 확인 유효 거래 없음${unlocated > 0 ? `, 위치 미확인 ${fmt(unlocated)}건` : ""} → 거래가 없었다는 뜻은 아니며 위치를 확인하지 못한 거래는 반경 판정에서 빠짐 → 시군구 단위 거래 자료와 개별 거래 확인 필요`
      : `아파트 매매 · 최근 12개월 반경 안 위치 확인 유효 거래 ${fmt(valid.length)}건 중 단가 확인 ${fmt(priced.length)}건, ${locationText} → 원거래별 ㎡당 단가 구간과 거래 건수를 표시하며 단지 중앙값을 다시 합산하지 않음 → 개별 거래·신고 정정과 위치 미확인 거래 확인 필요`;

  const limitations = [
    { kind: "partial" as const, note: "아파트 매매만 다룹니다(오피스텔·연립다세대·전월세 제외)." },
    { kind: "unknown" as const, note: "동·호를 공개하지 않아 같은 조건의 거래가 하나로 합쳐졌을 수 있습니다(실제 건수는 이보다 많을 수 있음)." },
    ...(unlocated > 0 ? [{ kind: "partial" as const, note: `반경과 겹치는 시군구에 위치를 확인하지 못한 거래 ${fmt(unlocated)}건이 있어 반경 안 여부를 알 수 없고 위 지표에서 빠집니다.` }] : []),
    ...(absent.length > 0 ? [{ kind: "incomplete" as const, note: `시군구 ${absent.map((s) => s.name || s.code).join(", ")}의 거래 자료를 확인하지 못했습니다.` }] : []),
    ...(noArea > 0 ? [{ kind: "partial" as const, note: `전용면적이 없는 ${noArea}건은 위치 확인 거래 건수에만 들어가고 분위 단가에서는 빠집니다.` }] : []),
    ...(cancelled > 0 ? [{ kind: "partial" as const, note: `취소된 거래 ${fmt(cancelled)}건은 분위 단가와 위치 확인률에서 제외하고 별도로 확인합니다.` }] : []),
    { kind: "unknown" as const, note: "계약일 기준이며 신고 지연·정정으로 최근 거래는 나중에 늘거나 바뀔 수 있습니다." },
    ...coverage,
  ];

  return makeTile(ctx, {
    code: "D25",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D25-trade@1", basisMetricIds: ["fill_location_pct", "unlocated_trades"], sentence, level: null, criteria: null },
    sources,
    layers: ["trade_q1", "trade_q2", "trade_q3", "trade_q4", "trade_q5"],
    map: tradeMap(points),
    limitations,
  });
}

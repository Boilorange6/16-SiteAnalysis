/**
 * A07 매매 실거래 — 분석일 이전 12개월 아파트 매매 중 취소되지 않고 위치가 확인된 반경 내 거래의 ㎡당 가격 분포.
 * 등급 없음. 가격 상승·하락을 좋고 나쁨으로 판정하지 않는다. 시세·감정가가 아니다.
 * 위치: 적재기가 법정동+지번→PNU→대표점으로 연결한 거래만 쓴다(위치 미확인 거래를 동 중심에 찍지 않는다).
 */
import { toUtmk } from "../../crs";
import { lookupParcelPoint } from "../../data/parcels";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation } from "../context";
import { fmt, makeTile, missing, obs, type MapCandidate, type TileDraft } from "./common";
import { notProvided } from "./not-provided";

const SOURCE = "rtms_apt_trade";
export const MIN_HALF_TRADES = 10;
/** 3.3㎡ 환산은 보조 표시 (평 = 3.3㎡ 근사) */
const PYEONG_M2 = 3.3;

interface Row {
  deal_date: string;
  price_krw: number | null;
  area_m2: number | null;
  cancelled_at: string | null;
  location_id: string | null;
}

/** ISO 날짜에서 n개월 전(말일 보정) */
export function monthsBefore(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = y * 12 + (m - 1) - n;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** 선형 보간 백분위수 (p: 0~1). 빈 배열은 null */
export function quantile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const sortedNums = (xs: number[]) => [...xs].sort((a, b) => a - b);
const median = (xs: number[]) => quantile(sortedNums(xs), 0.5);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** 단가(만원/㎡) 오름차순 분위 경계로 1~5 구간. 같은 값은 같은 구간. */
export function quintileOf(v: number, values: number[]): 1 | 2 | 3 | 4 | 5 {
  const s = sortedNums(values);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => quantile(s, p) as number);
  return (1 + cuts.filter((c) => v > c).length) as 1 | 2 | 3 | 4 | 5;
}

export function a07(ctx: EngineContext): TileResult {
  const sources = ctx.sources("market", [SOURCE]);
  const market = ctx.db("market");
  if (sources.length === 0 || !market) return notProvided(ctx, "A07");
  const core = ctx.db("core");
  const { center, radiusM, analysisDate } = ctx.input;
  const from = monthsBefore(analysisDate, 12);
  const mid = monthsBefore(analysisDate, 6);
  const sigungu = ctx.sigungu();
  const codes = sigungu.map((s) => s.code);

  const rows = codes.length
    ? (market
        .prepare(`SELECT deal_date, price_krw, area_m2, cancelled_at, location_id FROM property_transaction
          WHERE property_type = 'apt' AND contract_type = 'trade' AND match_status = 'located'
            AND lawd_cd IN (${codes.map(() => "?").join(",")}) AND deal_date > ? AND deal_date <= ?`)
        .all(...codes, from, analysisDate) as Row[])
    : [];
  const unlocated = codes.length
    ? (market
        .prepare(`SELECT COUNT(*) FROM property_transaction
          WHERE property_type = 'apt' AND contract_type = 'trade' AND match_status <> 'located' AND cancelled_at IS NULL
            AND lawd_cd IN (${codes.map(() => "?").join(",")}) AND deal_date > ? AND deal_date <= ?`)
        .pluck()
        .get(...codes, from, analysisDate) as number)
    : 0;
  const loaded = new Set(
    codes.length ? (market.prepare(`SELECT DISTINCT lawd_cd FROM property_transaction WHERE property_type = 'apt' AND contract_type = 'trade' AND lawd_cd IN (${codes.map(() => "?").join(",")})`).pluck().all(...codes) as string[]) : [],
  );
  const absent = sigungu.filter((s) => !loaded.has(s.code));

  // 필지 대표점까지의 거리로 반경 안 거래만 남긴다
  const [cx, cy] = toUtmk(center);
  const near = new Map<string, boolean>();
  const inRadius = (pnu: string | null): boolean => {
    if (!pnu || !core) return false;
    let v = near.get(pnu);
    if (v === undefined) {
      const p = lookupParcelPoint(core, pnu);
      v = p !== null && Math.hypot(toUtmk(p)[0] - cx, toUtmk(p)[1] - cy) <= radiusM;
      near.set(pnu, v);
    }
    return v;
  };
  const local = rows.filter((r) => inRadius(r.location_id));
  const cancelled = local.filter((r) => r.cancelled_at !== null).length;
  const valid = local.filter((r) => r.cancelled_at === null && r.price_krw !== null && r.price_krw > 0);
  const priced = valid.filter((r) => r.area_m2 !== null && r.area_m2 > 0).map((r) => ({ ...r, unit: r.price_krw! / 10_000 / r.area_m2! }));
  const noArea = valid.length - priced.length;

  const units = sortedNums(priced.map((r) => r.unit));
  const med = median(units);
  const q1 = quantile(units, 0.25);
  const q3 = quantile(units, 0.75);
  const recent = priced.filter((r) => r.deal_date > mid).map((r) => r.unit);
  const prev = priced.filter((r) => r.deal_date <= mid).map((r) => r.unit);
  const enough = recent.length >= MIN_HALF_TRADES && prev.length >= MIN_HALF_TRADES;
  const change = enough ? r1(((median(recent) as number) / (median(prev) as number) - 1) * 100) : null;
  const latest = valid.length ? valid.map((r) => r.deal_date).sort().at(-1)! : null;

  const CHANGE_ID = "a07-change@1";
  const metrics: TileDraft["metrics"] = [
    obs("valid_trades", "유효 매매 거래(최근 12개월)", valid.length, "건", "a07-count@1:취소 제외·위치 확인·반경 내 아파트 매매"),
    med === null ? missing("median_price_per_m2", "㎡당 가격 중앙값", "만원/㎡", "a07-median@1") : obs("median_price_per_m2", "㎡당 가격 중앙값", r1(med), "만원/㎡", "a07-median@1:거래금액÷전용면적의 중앙값", priced.length, null),
    q1 === null || q3 === null ? missing("price_q1_per_m2", "㎡당 가격 25%", "만원/㎡", "a07-iqr@1") : obs("price_q1_per_m2", "㎡당 가격 하위 25% 경계", r1(q1), "만원/㎡", "a07-iqr@1:선형 보간 백분위"),
    q1 === null || q3 === null ? missing("price_q3_per_m2", "㎡당 가격 75%", "만원/㎡", "a07-iqr@1") : obs("price_q3_per_m2", "㎡당 가격 상위 25% 경계", r1(q3), "만원/㎡", "a07-iqr@1:선형 보간 백분위"),
    med === null ? missing("median_price_per_3_3m2", "3.3㎡당 가격 중앙값(환산)", "만원/3.3㎡", "a07-pyeong@1") : obs("median_price_per_3_3m2", "3.3㎡당 가격 중앙값(환산)", r1(med * PYEONG_M2), "만원/3.3㎡", "a07-pyeong@1:㎡당 중앙값×3.3, 보조 표시"),
    change === null
      ? missing("median_change_pct", "직전 6개월 대비 중앙값 변화", "%", `${CHANGE_ID}:비교 기간별 유효 거래 ${MIN_HALF_TRADES}건 미만(최근 ${recent.length}건, 이전 ${prev.length}건)`)
      : obs("median_change_pct", "직전 6개월 대비 중앙값 변화", change, "%", `${CHANGE_ID}:최근 6개월 중앙값÷이전 6개월 중앙값−1`, recent.length, prev.length),
    latest === null ? missing("latest_trade_days", "최근 계약 후 경과일", "일", "a07-latest@1") : obs("latest_trade_days", "최근 계약 후 경과일", daysBetween(latest, analysisDate), "일", "a07-latest@1:분석일−가장 최근 계약일"),
    obs("cancelled_trades", "취소된 거래(별도)", cancelled, "건", "a07-cancelled@1:같은 기간·반경, 위 지표에서 제외"),
  ];

  const rangeTxt = `${fmt(Math.round(q1 ?? 0))}~${fmt(Math.round(q3 ?? 0))}`;
  const changeTxt = change === null ? "" : `, 직전 6개월 대비 중앙값 ${change > 0 ? "+" : ""}${change}%`;
  const sentence =
    valid.length === 0
      ? "최근 12개월 반경 안에 위치가 확인된 아파트 매매 거래 없음 → 거래가 없었다는 뜻은 아니며 위치를 확인하지 못한 거래는 빠짐 → 시군구 단위 거래 자료 확인 필요"
      : med === null
        ? `최근 12개월 반경 안 아파트 매매 ${valid.length}건(전용면적 없어 단가 산출 불가) → ㎡당 가격을 알 수 없음 → 개별 거래 확인 필요`
        : `최근 12개월 반경 안 아파트 매매 ${valid.length}건, ㎡당 중앙값 ${fmt(Math.round(med))}만원(중간 절반 ${rangeTxt}만원)${changeTxt} → 관측된 거래 분포이며 시세·감정가가 아니고 단지·면적 구성에 따라 달라짐${change === null ? ", 기간별 거래가 적어 변화는 판단하지 않음" : ""} → 단지·면적별 개별 거래 확인 필요`;

  // 지도: 필지(단지) 대표점 단위로 묶는다. 색은 이번 결과 안의 점별 중앙 단가 5분위.
  const byPnu = new Map<string, number[]>();
  for (const r of priced) byPnu.set(r.location_id!, [...(byPnu.get(r.location_id!) ?? []), r.unit]);
  const points = [...byPnu]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([pnu, us], i) => ({ pnu, i, n: us.length, m: median(us) as number, at: lookupParcelPoint(core!, pnu)! }));
  const top3 = new Set([...points].sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 3).map((p) => p.pnu));
  const all = points.map((p) => p.m);
  const map: MapCandidate[] = points.map((p) => ({
    id: p.i,
    f: {
      layer: `trade_q${quintileOf(p.m, all)}`,
      lng: Math.round(p.at[0] * 1e6) / 1e6,
      lat: Math.round(p.at[1] * 1e6) / 1e6,
      weight: p.n,
      ...(top3.has(p.pnu) ? { label: `${p.n}건 ${fmt(Math.round(p.m))}만원/㎡` } : {}),
    },
  }));

  const limitations: Limitation[] = [
    { kind: "partial", note: "아파트 매매만 다룹니다(오피스텔·연립다세대·전월세 제외)." },
    { kind: "unknown", note: "동·호를 공개하지 않아 같은 조건의 거래가 하나로 합쳐졌을 수 있습니다(실제 건수는 이보다 많을 수 있음)." },
    ...(unlocated > 0 ? [{ kind: "partial" as const, note: `반경과 겹치는 시군구에 위치를 확인하지 못한 거래 ${fmt(unlocated)}건이 있어 반경 안 여부를 알 수 없고 위 지표에서 빠집니다.` }] : []),
    ...(absent.length > 0 ? [{ kind: "incomplete" as const, note: `시군구 ${absent.map((s) => s.name || s.code).join(", ")}의 거래 자료가 적재되지 않았습니다.` }] : []),
    ...(noArea > 0 ? [{ kind: "partial" as const, note: `전용면적이 없는 ${noArea}건은 건수에만 들어가고 ㎡당 가격에서는 빠집니다.` }] : []),
    { kind: "unknown", note: "계약일 기준이며 신고 지연·정정으로 최근 거래는 나중에 늘거나 바뀔 수 있습니다." },
    ...ctx.coverage("market", [SOURCE]),
  ];

  return makeTile(ctx, {
    code: "A07",
    status: absent.length > 0 || unlocated > 0 ? "partial" : "complete",
    metrics,
    judgment: { ruleId: "a07-trade@1", basisMetricIds: med === null ? ["valid_trades"] : ["valid_trades", "median_price_per_m2"], sentence, level: null, criteria: null },
    sources,
    layers: ["trade_q1", "trade_q2", "trade_q3", "trade_q4", "trade_q5"],
    map,
    limitations,
  });
}

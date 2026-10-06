/**
 * A08 임대차 실거래 — 아파트 전세·월세 계약 조건을 같은 기간·반경으로 비교한다.
 *
 * 위치가 확인된 필지 대표점만 지도에 표시하고, 월세를 전세로 환산하지 않는다.
 * 전세가율은 같은 PNU에서 충분한 전세·매매 표본이 있을 때만 대응 지표로 낸다.
 */
import { toUtmk, type LngLat } from "../../crs";
import { lookupParcelPoints } from "../../data/parcels";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation, SourceRef } from "../context";
import { collectTrades, monthsBefore, type TradeCollection } from "./a07";
import { est, fmt, makeTile, missing, obs, type MapCandidate, type TileDraft } from "./common";
import { notProvided } from "./not-provided";

export const RENT_SOURCE = "rtms_apt_rent";
export const MIN_PAIRED = 3;

type RentContract = "jeonse" | "monthly";
type Renewal = "new" | "renewal";

export interface RentRow {
  deal_date: string;
  contract_type: RentContract;
  deposit_krw: number | null;
  rent_krw: number | null;
  area_m2: number | null;
  cancelled_at: string | null;
  location_id: string | null;
  renewal: Renewal | null;
}

export interface RentCollection {
  sources: SourceRef[];
  jeonse: RentRow[];
  monthly: RentRow[];
  hasRenewal: boolean;
  unlocated: number;
  absent: Array<{ code: string; name: string }>;
  cancelled: number;
}

interface RentPoint {
  pnu: string;
  n: number;
  medianUnit: number | null;
  at: LngLat;
}

const positive = (value: number | null): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);
const nonNegative = (value: number | null): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

/** 선형 보간 백분위수. A07과 같은 정의를 사용해 전세·매매를 직접 비교한다. */
export function quantile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const position = (sortedValues.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

const median = (values: number[]) => quantile(sorted(values), 0.5);
const round1 = (value: number) => Math.round(value * 10) / 10;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function unitPerM2(row: RentRow): number | null {
  const deposit = positive(row.deposit_krw);
  const area = positive(row.area_m2);
  return deposit === null || area === null ? null : deposit / 10_000 / area;
}

/** 같은 기간에 위치가 확인된 전세·매매 단지의 대응 중앙값을 계산한다. */
function pairedRatio(jeonse: RentRow[], trades: TradeCollection | null): { value: number; count: number } | null {
  if (!trades) return null;
  const rentByPnu = new Map<string, number[]>();
  for (const row of jeonse) {
    if (!row.location_id) continue;
    const unit = unitPerM2(row);
    if (unit !== null) rentByPnu.set(row.location_id, [...(rentByPnu.get(row.location_id) ?? []), unit]);
  }
  const tradeByPnu = new Map<string, number[]>();
  for (const row of trades.priced) {
    if (!row.location_id) continue;
    tradeByPnu.set(row.location_id, [...(tradeByPnu.get(row.location_id) ?? []), row.unit]);
  }

  const ratios: number[] = [];
  for (const [pnu, rents] of rentByPnu) {
    const sales = tradeByPnu.get(pnu) ?? [];
    if (rents.length < MIN_PAIRED || sales.length < MIN_PAIRED) continue;
    const rentMedian = median(rents);
    const saleMedian = median(sales);
    if (rentMedian === null || saleMedian === null || saleMedian <= 0) continue;
    ratios.push((rentMedian / saleMedian) * 100);
  }
  const value = median(ratios);
  return value === null ? null : { value: round1(value), count: ratios.length };
}

function pointGroups(rows: RentRow[], parcelPoints: Map<string, LngLat>, unit: (row: RentRow) => number | null): RentPoint[] {
  const groups = new Map<string, RentRow[]>();
  for (const row of rows) {
    if (!row.location_id || !parcelPoints.has(row.location_id)) continue;
    groups.set(row.location_id, [...(groups.get(row.location_id) ?? []), row]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pnu, group]) => ({
      pnu,
      n: group.length,
      medianUnit: median(group.map(unit).filter((value): value is number => value !== null)),
      at: parcelPoints.get(pnu)!,
    }));
}

function rentFeatures(jeonse: RentPoint[], monthly: RentPoint[]): MapCandidate[] {
  const topJeonse = new Set(
    [...jeonse]
      .sort((a, b) => b.n - a.n || a.pnu.localeCompare(b.pnu))
      .slice(0, 3)
      .map((point) => point.pnu),
  );
  const features: MapCandidate[] = [];
  jeonse.forEach((point, index) => {
    features.push({
      id: index,
      f: {
        layer: "rent_jeonse",
        lng: Math.round(point.at[0] * 1e6) / 1e6,
        lat: Math.round(point.at[1] * 1e6) / 1e6,
        weight: point.n,
        ...(topJeonse.has(point.pnu) && point.medianUnit !== null ? { label: `${point.n}건 전세 ${fmt(Math.round(point.medianUnit))}만원/㎡` } : {}),
      },
    });
  });
  monthly.forEach((point, index) => {
    features.push({
      id: 100_000 + index,
      f: {
        layer: "rent_monthly",
        lng: Math.round(point.at[0] * 1e6) / 1e6,
        lat: Math.round(point.at[1] * 1e6) / 1e6,
        weight: point.n,
      },
    });
  });
  return features;
}

function collectRentsUncached(ctx: EngineContext): RentCollection | null {
  const sources = ctx.sources("market", [RENT_SOURCE]);
  const market = ctx.db("market");
  if (sources.length === 0 || !market) return null;

  const core = ctx.db("core");
  const { center, radiusM, analysisDate } = ctx.input;
  const from = monthsBefore(analysisDate, 12);
  const sigungu = ctx.sigungu();
  const codes = sigungu.map((area) => area.code);
  const columns = market.prepare("PRAGMA table_info(property_transaction)").all() as Array<{ name: string }>;
  const hasRenewal = columns.some((column) => column.name === "renewal");
  const renewalSelect = hasRenewal ? "renewal" : "NULL AS renewal";
  const contractParams = ["jeonse", "monthly"];

  const rows = codes.length
    ? (market
        .prepare(`SELECT deal_date, contract_type, deposit_krw, rent_krw, area_m2, cancelled_at, location_id, ${renewalSelect}
          FROM property_transaction
          WHERE property_type = 'apt' AND contract_type IN (?, ?) AND match_status = 'located'
            AND lawd_cd IN (${codes.map(() => "?").join(",")}) AND deal_date > ? AND deal_date <= ?`)
        .all(...contractParams, ...codes, from, analysisDate) as RentRow[])
    : [];
  const unlocated = codes.length
    ? (market
        .prepare(`SELECT COUNT(*) FROM property_transaction
          WHERE property_type = 'apt' AND contract_type IN (?, ?) AND match_status <> 'located' AND cancelled_at IS NULL
            AND lawd_cd IN (${codes.map(() => "?").join(",")}) AND deal_date > ? AND deal_date <= ?`)
        .pluck()
        .get(...contractParams, ...codes, from, analysisDate) as number)
    : 0;
  const loaded = new Set(
    codes.length
      ? (market
          .prepare(`SELECT DISTINCT lawd_cd FROM property_transaction
            WHERE property_type = 'apt' AND contract_type IN (?, ?) AND lawd_cd IN (${codes.map(() => "?").join(",")})`)
          .pluck()
          .all(...contractParams, ...codes) as string[])
      : [],
  );
  const absent = sigungu.filter((area) => !loaded.has(area.code));

  const [cx, cy] = toUtmk(center);
  const parcelPoints = core
    ? lookupParcelPoints(core, rows.flatMap((row) => (row.location_id ? [row.location_id] : [])))
    : new Map<string, LngLat>();
  const inRadius = (pnu: string | null): boolean => {
    if (!pnu) return false;
    const point = parcelPoints.get(pnu);
    return point !== undefined && Math.hypot(toUtmk(point)[0] - cx, toUtmk(point)[1] - cy) <= radiusM;
  };
  const local = rows.filter((row) => inRadius(row.location_id));
  const cancelled = local.filter((row) => row.cancelled_at !== null).length;
  const valid = local.filter((row) => row.cancelled_at === null && (
    row.contract_type === "jeonse"
      ? positive(row.deposit_krw) !== null
      : positive(row.rent_krw) !== null && (row.deposit_krw === null || nonNegative(row.deposit_krw) !== null)
  ));

  return {
    sources,
    jeonse: valid.filter((row) => row.contract_type === "jeonse"),
    monthly: valid.filter((row) => row.contract_type === "monthly"),
    hasRenewal,
    unlocated,
    absent,
    cancelled,
  };
}

/** A07.collectTrades와 동일한 12개월 창을 공유한다. 구버전 market 파일은 renewal 없이 읽는다. */
export function collectRents(ctx: EngineContext): RentCollection | null {
  return ctx.memo("rents:apt:v1", () => collectRentsUncached(ctx));
}

export function a08(ctx: EngineContext): TileResult {
  const rents = collectRents(ctx);
  if (!rents) return notProvided(ctx, "A08");

  const { jeonse, monthly, absent, unlocated, cancelled, hasRenewal } = rents;
  const jeonseUnits = jeonse.map(unitPerM2).filter((value): value is number => value !== null);
  const monthlyRents = monthly.map((row) => positive(row.rent_krw)).filter((value): value is number => value !== null).map((value) => value / 10_000);
  const monthlyDeposits = monthly.map((row) => nonNegative(row.deposit_krw)).filter((value): value is number => value !== null).map((value) => value / 10_000);
  const jeonseMedian = median(jeonseUnits);
  const jeonseQ1 = quantile(sorted(jeonseUnits), 0.25);
  const jeonseQ3 = quantile(sorted(jeonseUnits), 0.75);
  const monthlyRentMedian = median(monthlyRents);
  const monthlyDepositMedian = median(monthlyDeposits);
  const trades = collectTrades(ctx);
  const paired = pairedRatio(jeonse, trades);
  const latestDate = [...jeonse, ...monthly].map((row) => row.deal_date).sort().at(-1) ?? null;
  const newCount = hasRenewal ? jeonse.concat(monthly).filter((row) => row.renewal === "new").length : null;
  const renewalCount = hasRenewal ? jeonse.concat(monthly).filter((row) => row.renewal === "renewal").length : null;
  const noArea = jeonse.length - jeonseUnits.length;

  const metrics: TileDraft["metrics"] = [
    obs("jeonse_count", "전세 계약", jeonse.length, "건", "a08-count@1:취소 제외·위치 확인·반경 내 아파트 전세"),
    obs("monthly_count", "월세 계약", monthly.length, "건", "a08-count@1:취소 제외·위치 확인·반경 내 아파트 월세"),
    hasRenewal
      ? obs("new_count", "신규 계약", newCount!, "건", "a08-renewal@1:renewal=new")
      : missing("new_count", "신규 계약", "건", "a08-renewal@1:신규·갱신 열 없는 자료 버전"),
    hasRenewal
      ? obs("renewal_count", "갱신 계약", renewalCount!, "건", "a08-renewal@1:renewal=renewal")
      : missing("renewal_count", "갱신 계약", "건", "a08-renewal@1:신규·갱신 열 없는 자료 버전"),
    jeonseMedian === null
      ? missing("jeonse_deposit_per_m2", "전세 보증금 단가 중앙값", "만원/㎡", "a08-jeonse-unit@1:보증금÷전용면적")
      : obs("jeonse_deposit_per_m2", "전세 보증금 단가 중앙값", round1(jeonseMedian), "만원/㎡", "a08-jeonse-unit@1:보증금÷전용면적의 중앙값", jeonseUnits.length, jeonse.length),
    jeonseQ1 === null
      ? missing("jeonse_q1_per_m2", "전세 보증금 단가 하위 25% 경계", "만원/㎡", "a08-jeonse-iqr@1:선형 보간 백분위")
      : obs("jeonse_q1_per_m2", "전세 보증금 단가 하위 25% 경계", round1(jeonseQ1), "만원/㎡", "a08-jeonse-iqr@1:선형 보간 백분위"),
    jeonseQ3 === null
      ? missing("jeonse_q3_per_m2", "전세 보증금 단가 상위 75% 경계", "만원/㎡", "a08-jeonse-iqr@1:선형 보간 백분위")
      : obs("jeonse_q3_per_m2", "전세 보증금 단가 상위 75% 경계", round1(jeonseQ3), "만원/㎡", "a08-jeonse-iqr@1:선형 보간 백분위"),
    monthlyRentMedian === null
      ? missing("monthly_rent_median", "월세 중앙값", "만원/월", "a08-monthly@1:월세 금액 중앙값")
      : obs("monthly_rent_median", "월세 중앙값", round1(monthlyRentMedian), "만원/월", "a08-monthly@1:월세 금액 중앙값", monthlyRents.length, monthly.length),
    monthlyDepositMedian === null
      ? missing("monthly_deposit_median", "월세 보증금 중앙값", "만원", "a08-monthly@1:보증금 중앙값")
      : obs("monthly_deposit_median", "월세 보증금 중앙값", round1(monthlyDepositMedian), "만원", "a08-monthly@1:보증금 중앙값", monthlyDeposits.length, monthly.length),
    paired === null
      ? missing("jeonse_to_trade_ratio_pct", "대응 전세가율", "%", "a08-paired-ratio@1:대응 표본 없음(단지·12개월)")
      : est("jeonse_to_trade_ratio_pct", "대응 전세가율", paired.value, "%", "a08-paired-ratio@1:동일 PNU 전세 단가 중앙값÷매매 단가 중앙값×100", paired.count, null),
    latestDate === null
      ? missing("latest_rent_days", "최근 계약 후 경과일", "일", "a08-latest@1:분석일−가장 최근 계약일")
      : obs("latest_rent_days", "최근 계약 후 경과일", daysBetween(latestDate, ctx.input.analysisDate), "일", "a08-latest@1:분석일−가장 최근 계약일"),
    obs("cancelled_rents", "취소된 임대차(별도)", cancelled, "건", "a08-cancelled@1:같은 기간·반경, 위 지표에서 제외"),
  ];

  const ratioText = paired === null ? "전세가율 미확인(대응 표본 없음)" : `전세가율 ${fmt(paired.value)}%(대응 ${paired.count}단지)`;
  const jeonseText = jeonseMedian === null ? "미확인" : fmt(Math.round(jeonseMedian));
  const monthlyDepositText = monthlyDepositMedian === null ? "미확인" : fmt(Math.round(monthlyDepositMedian));
  const monthlyRentText = monthlyRentMedian === null ? "미확인" : fmt(Math.round(monthlyRentMedian));
  const sentence =
    `최근 12개월 반경 안 전세 ${fmt(jeonse.length)}건(㎡당 보증금 중앙값 ${jeonseText}만원)·월세 ${fmt(monthly.length)}건(보증금 중앙값 ${monthlyDepositText}만원·월세 중앙값 ${monthlyRentText}만원), ${ratioText}`
    + " → 신규·갱신을 구분하고 전세가율은 대응 표본을 비교하는 지표로만 해석해야 함 → 단지·면적별 개별 계약 확인 필요";

  const core = ctx.db("core");
  const allRows = [...jeonse, ...monthly];
  const parcelPoints = core
    ? lookupParcelPoints(core, allRows.flatMap((row) => (row.location_id ? [row.location_id] : [])))
    : new Map<string, LngLat>();
  const jeonsePoints = pointGroups(jeonse, parcelPoints, unitPerM2);
  const monthlyPoints = pointGroups(monthly, parcelPoints, (row) => {
    const rent = positive(row.rent_krw);
    return rent === null ? null : rent / 10_000;
  });
  const limitations: Limitation[] = [
    { kind: "partial", note: "아파트 전월세만 다룹니다(오피스텔 제외 — 원천 자료 범위)." },
    { kind: "unknown", note: "동·호가 공개되지 않아 같은 단지·면적 조건의 계약이 하나로 합쳐졌을 수 있습니다." },
    ...(unlocated > 0 ? [{ kind: "partial" as const, note: `반경과 겹치는 시군구에 위치를 확인하지 못한 임대차 ${fmt(unlocated)}건이 있어 반경 안 여부를 알 수 없고 위 지표에서 빠집니다.` }] : []),
    ...(absent.length > 0 ? [{ kind: "incomplete" as const, note: `시군구 ${absent.map((area) => area.name || area.code).join(", ")}의 임대차 자료를 확인하지 못했습니다.` }] : []),
    ...(noArea > 0 ? [{ kind: "partial" as const, note: `전용면적이 없는 전세 ${fmt(noArea)}건은 건수에만 들어가고 ㎡당 보증금에서는 빠집니다.` }] : []),
    ...(paired === null ? [{ kind: "unknown" as const, note: `동일 PNU에서 전세·매매 각 ${MIN_PAIRED}건 이상인 대응 표본이 없어 전세가율을 생성하지 않았습니다.` }] : []),
    { kind: "unknown", note: "월세를 전세로 환산하지 않으며 전세가율은 대응 단지·면적 조건을 맞춘 비교 지표입니다." },
    { kind: "unknown", note: "계약일 기준이며 신고 지연·정정으로 최근 계약은 나중에 늘거나 바뀔 수 있습니다." },
    ...ctx.coverage("market", [RENT_SOURCE]),
  ];
  const tradeSources = trades?.sources ?? [];
  const sourceMap = new Map([...rents.sources, ...tradeSources].map((source) => [`${source.sourceId}:${source.releaseId}`, source]));
  const status = absent.length > 0 || unlocated > 0 ? "partial" : "complete";
  const basisMetricIds = ["jeonse_count", "monthly_count", ...(paired ? ["jeonse_to_trade_ratio_pct"] : [])];

  return makeTile(ctx, {
    code: "A08",
    status,
    metrics,
    judgment: { ruleId: "a08-rent@1", basisMetricIds, sentence, level: null, criteria: null },
    sources: [...sourceMap.values()],
    layers: ["rent_jeonse", "rent_monthly"],
    map: rentFeatures(jeonsePoints, monthlyPoints),
    limitations,
  });
}

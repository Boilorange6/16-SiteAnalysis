/**
 * A05 재집계 — 결과(TileResult)의 지도 지물에 필터를 걸어 지표를 다시 계산하는 순수 함수(서버·DB 불필요, 클라이언트에서도 쓴다).
 * 규칙: 범위 조건에서 해당 값이 모르는 값(null)이면 지물을 빼지 않고 "정보 없음 포함"으로 센다.
 * 주택 유형(layer)은 항상 알려진 값이라 알 수 없음 대상이 아니다.
 */
import type { MapFeature, TileResult } from "../tile-result";

type Metric = TileResult["metrics"][number];

export const A05_TYPES = ["apt", "other_housing", "officetel"] as const;
export type A05Type = (typeof A05_TYPES)[number];
export const A05_TYPE_LABEL: Record<A05Type, string> = { apt: "아파트", other_housing: "연립·다세대 등", officetel: "오피스텔" };

export type A05Range = { min?: number | null; max?: number | null };
export type A05Filter = {
  /** 비었거나 없으면 전체 유형 */
  types?: A05Type[];
  year?: A05Range;
  households?: A05Range;
  floors?: A05Range;
  buildings?: A05Range;
  /** 대지에서의 거리(m) 상한은 max만 쓴다 */
  distance?: A05Range;
};

type RangeKey = "year" | "households" | "floors" | "buildings" | "distance";
const RANGE_FIELD: Record<RangeKey, { prop: "approvalYear" | "households" | "floorsMax" | "buildingCount" | "distanceM"; label: string; unit: string }> = {
  year: { prop: "approvalYear", label: "준공연도", unit: "년" },
  households: { prop: "households", label: "세대수", unit: "세대" },
  floors: { prop: "floorsMax", label: "층수", unit: "층" },
  buildings: { prop: "buildingCount", label: "동수", unit: "동" },
  distance: { prop: "distanceM", label: "거리", unit: "m" },
};
const RANGE_KEYS = Object.keys(RANGE_FIELD) as RangeKey[];
const HOUSING = new Set<string>(A05_TYPES);

const bound = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** 값이 있는 조건만 남긴 정규형. 조건이 하나도 없으면 null */
export function normalizeA05Filter(f: A05Filter | null | undefined): A05Filter | null {
  if (!f) return null;
  const out: A05Filter = {};
  const types = [...new Set((f.types ?? []).filter((t) => (A05_TYPES as readonly string[]).includes(t)))];
  if (types.length > 0 && types.length < A05_TYPES.length) out.types = A05_TYPES.filter((t) => types.includes(t));
  for (const k of RANGE_KEYS) {
    const min = bound(f[k]?.min);
    const max = bound(f[k]?.max);
    if (min !== null || max !== null) out[k] = { min, max };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 보고서·카드에 쓰는 한 줄 설명. 필터가 없으면 null */
export function describeA05Filter(f: A05Filter | null | undefined): string | null {
  const n = normalizeA05Filter(f);
  if (!n) return null;
  const parts: string[] = [];
  if (n.types) parts.push(`유형 ${n.types.map((t) => A05_TYPE_LABEL[t]).join("·")}`);
  for (const k of RANGE_KEYS) {
    const r = n[k];
    if (!r) continue;
    const { label, unit } = RANGE_FIELD[k];
    const lo = r.min ?? null;
    const hi = r.max ?? null;
    parts.push(lo !== null && hi !== null ? `${label} ${lo}~${hi}${unit}` : lo !== null ? `${label} ${lo}${unit} 이상` : `${label} ${hi}${unit} 이하`);
  }
  return parts.join(", ");
}

export type A05Counts = {
  /** 필터 전 주거 지물 수 */
  total: number;
  /** 필터 뒤 남은 수 (정보 없음 포함분 포함) */
  kept: number;
  excluded: number;
  /** 활성 범위 조건 중 하나라도 값이 없어 빼지 않고 포함한 지물 수 */
  unknownKept: number;
  /** 필드별 정보 없음 포함 건수(그 필드 조건이 켜져 있을 때만 키가 있다) */
  unknownByField: Partial<Record<RangeKey, number>>;
};

export type A05Reaggregation = {
  filter: A05Filter | null;
  /** 한 줄 설명. "…" + 정보 없음 포함 N건 */
  description: string | null;
  counts: A05Counts;
  features: MapFeature[];
  /** 재계산한 지표(원본에서 복원할 수 없는 지표는 원본 그대로 이어 붙인다) */
  metrics: Metric[];
};

const m = (id: string, label: string, value: number | null, unit: string, formulaVersion: string, status: Metric["status"], numerator: number | null = null, denominator: number | null = null): Metric =>
  ({ id, label, value, unit, formulaVersion, numerator, denominator, status: value === null ? "missing" : status });

const lowerMedian = (xs: number[]): number | null => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]);

/** 지물 한 건이 필터를 통과하는지. unknownFields는 값이 없어서 통과한 필드 */
function pass(f: MapFeature, n: A05Filter): { ok: boolean; unknown: RangeKey[] } {
  if (n.types && !n.types.includes(f.layer as A05Type)) return { ok: false, unknown: [] };
  const unknown: RangeKey[] = [];
  for (const k of RANGE_KEYS) {
    const r = n[k];
    if (!r) continue;
    const v = f[RANGE_FIELD[k].prop];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      unknown.push(k);
      continue;
    }
    if ((r.min ?? null) !== null && v < (r.min as number)) return { ok: false, unknown: [] };
    if ((r.max ?? null) !== null && v > (r.max as number)) return { ok: false, unknown: [] };
  }
  return { ok: true, unknown };
}

export function reaggregateA05(result: TileResult, filter: A05Filter | null | undefined): A05Reaggregation {
  const n = normalizeA05Filter(filter);
  const all = (result.presentation.features ?? []).filter((f) => HOUSING.has(f.layer));
  const unknownByField: Partial<Record<RangeKey, number>> = {};
  if (n) for (const k of RANGE_KEYS) if (n[k]) unknownByField[k] = 0;
  let unknownKept = 0;
  const kept: MapFeature[] = [];
  for (const f of all) {
    const p = n ? pass(f, n) : { ok: true, unknown: [] as RangeKey[] };
    if (!p.ok) continue;
    kept.push(f);
    if (p.unknown.length > 0) unknownKept += 1;
    for (const k of p.unknown) unknownByField[k] = (unknownByField[k] ?? 0) + 1;
  }
  const counts: A05Counts = { total: all.length, kept: kept.length, excluded: all.length - kept.length, unknownKept, unknownByField };

  // 필터가 없으면 원본 지표를 그대로 쓴다(엔진이 일 단위 사용승인일로 계산한 값을 보존)
  if (!n) {
    return { filter: null, description: null, counts, features: result.presentation.features ?? [], metrics: result.metrics };
  }

  const apts = kept.filter((f) => f.layer === "apt");
  const others = kept.filter((f) => f.layer === "other_housing");
  const officetels = kept.filter((f) => f.layer === "officetel");
  const targets = [...apts, ...officetels];
  const hhOf = (f: MapFeature) => (typeof f.households === "number" ? f.households : null);
  const aptHh = apts.map(hhOf).filter((v): v is number => v !== null);
  const othersHh = others.map(hhOf).filter((v): v is number => v !== null).reduce((s, v) => s + v, 0);
  const otUnits = officetels.map(hhOf).filter((v): v is number => v !== null);
  const years = targets.map((t) => t.approvalYear).filter((v): v is number => typeof v === "number");
  const analysisYear = Number(result.conditions.analysisDate.slice(0, 4));
  // 일 단위 사용승인일이 지물에 없어 연도 기준으로 근사한다(승인 30주년이 되는 해부터 30년 이상)
  const aged = years.filter((y) => y + 30 <= analysisYear).length;
  let parkN = 0;
  let parkHh = 0;
  for (const a of apts) {
    if (typeof a.parking === "number" && a.parking > 0 && typeof a.households === "number") {
      parkN += a.parking;
      parkHh += a.households;
    }
  }
  const FV = "a05-filter@1";
  const recomputed: Metric[] = [
    m("apartment_complexes", "아파트 단지", apts.length, "개", FV, "observed"),
    m("other_residential", "기타 공동주택(연립·다세대 등)", others.length, "개", FV, "observed"),
    m("other_residential_households", "기타 공동주택 세대(세대 수 확인분)", othersHh, "세대", FV, "observed"),
    m("officetels", "오피스텔", officetels.length, "개", FV, "observed"),
    m("households", "확인 세대(필터 적용)", aptHh.reduce((s, v) => s + v, 0), "세대", FV, "observed", aptHh.length, apts.length),
    m("households_unknown_complexes", "세대 수를 알 수 없는 단지", apts.length - aptHh.length, "개", FV, "observed"),
    m("officetel_units", "오피스텔 호실", otUnits.length === 0 ? null : otUnits.reduce((s, v) => s + v, 0), "호", FV, "observed", otUnits.length, officetels.length),
    m("median_approval_year", "준공연도 중앙값(하위 중앙)", lowerMedian(years), "년", FV, "observed", years.length, targets.length),
    m("aged_share_pct", "30년 이상 건물 비중", years.length === 0 ? null : Math.round((aged / years.length) * 1000) / 10, "%", FV, "estimated", aged, years.length),
    m("parking_per_household", "세대당 주차대수", parkHh === 0 ? null : Math.round((parkN / parkHh) * 100) / 100, "대", FV, "observed", parkN, parkHh),
    m("filter_unknown_kept", "정보 없음이라 포함한 건물·단지", unknownKept, "건", FV, "observed"),
  ];
  const recomputedIds = new Set(recomputed.map((x) => x.id));
  // 복원할 수 없는 지표(대체 출처 개수, K-APT 전용 단지)는 원본 그대로: 필터 영향 밖
  const passthrough = result.metrics.filter((x) => !recomputedIds.has(x.id) && x.id !== "households_from_kapt" && x.id !== "households_from_units");
  const description = describeA05Filter(n);
  return { filter: n, description: `${description}${unknownKept > 0 ? ` · 정보 없음 포함 ${unknownKept}건` : ""}`, counts, features: kept, metrics: [...recomputed, ...passthrough] };
}

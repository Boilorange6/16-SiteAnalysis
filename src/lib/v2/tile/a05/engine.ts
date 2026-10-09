/** A05 기존 주거 공급 — 건축물대장 총괄표제부(단지)·표제부(단일동·오피스텔) 대표점. 등급 없음. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import type { FeatureHit } from "../../data/features";
import { unitTypesFromUnknown } from "../../unit-types";
import { candidate, est, fmt, makeTile, missing, noDataTile, obs, type TileDraft } from "../../engine/tiles/common";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const year = (v: unknown): number | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Number(v.slice(0, 4)) : null);

/** 사용승인일로부터 분석일까지 30년 이상(승인 30주년 당일 포함) */
export function isAged(approvalDate: string, analysisDate: string): boolean {
  return `${Number(approvalDate.slice(0, 4)) + 30}${approvalDate.slice(4)}` <= analysisDate;
}

/** 대장 단지(stable_id) → 같은 필지에 연결된 K-APT 세대수. 연결·세대수가 없는 단지는 빠진다. */
function kaptHouseholds(ctx: EngineContext, complexes: FeatureHit[]): Map<string, number> {
  const out = new Map<string, number>();
  const db = ctx.db("core");
  const ids = complexes.filter((c) => num(c.properties.households) === null).map((c) => c.stableId);
  if (!db) return out;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db
      .prepare(`SELECT l.to_stable_id AS id, f.properties_json AS props FROM feature_link l CROSS JOIN feature f ON f.stable_id = l.from_stable_id
        WHERE l.relation_type = 'same_parcel' AND f.kind = 'kapt_complex' AND l.to_stable_id IN (${chunk.map(() => "?").join(",")}) ORDER BY f.stable_id`)
      .all(...chunk) as Array<{ id: string; props: string }>;
    for (const r of rows) {
      const n = num((JSON.parse(r.props) as Record<string, unknown>).households);
      if (n !== null && !out.has(r.id)) out.set(r.id, n);
    }
  }
  return out;
}

/** 반경 안 K-APT 아파트 단지(종류 코드 1) 가운데 대장 단지와 연결되지 않은 것 */
function kaptOnly(ctx: EngineContext): FeatureHit[] {
  const kapts = ctx.hits("core", ["kapt_complex"]).filter((k) => k.properties.complexType === "1");
  const db = ctx.db("core");
  if (!db || kapts.length === 0) return kapts;
  const linked = new Set<string>();
  for (let i = 0; i < kapts.length; i += 500) {
    const chunk = kapts.slice(i, i + 500).map((k) => k.stableId);
    for (const id of db.prepare(`SELECT DISTINCT from_stable_id FROM feature_link WHERE relation_type = 'same_parcel' AND from_stable_id IN (${chunk.map(() => "?").join(",")})`).pluck().all(...chunk) as string[]) linked.add(id);
  }
  return kapts.filter((k) => !linked.has(k.stableId));
}

/** 설명선 카드에 쓰는 단지 값. 엔진이 아는 것만 담고 나머지는 null (K-APT·건물 연결은 다른 브랜치가 채운다) */
function callout(h: FeatureHit, type: string, households: number | null) {
  return {
    weight: households,
    households,
    name: h.name,
    type,
    approvalYear: year(h.properties.approvalDate),
    floorsMax: num(h.properties.floorsAbove),
    buildingCount: num(h.properties.buildingCount),
    distanceM: h.distanceM === null ? null : Math.round(h.distanceM),
    parking: num(h.properties.parking),
    unitTypes: unitTypesFromUnknown(h.properties.unitTypes),
  };
}

/**
 * 공동주택 행이 아파트 단지인지 (총괄표제부·표제부 모두 mainUse가 "공동주택"이라 mainUse로는 못 가른다).
 * 근거는 고덕역 1km 실측(207행)과 송파·강동 5km 총괄표제부 세대 분포:
 *  1) 기타용도에 다세대·연립·도시형·단지형·생활주택이 있으면 아파트가 아니다 (도시형/연립 단지는 최대 159세대).
 *  2) 기타용도에 "아파트"가 있으면 아파트 ("아파트, 상가", "공동주택(아파트),근린생활시설" 등).
 *  3) 그 외 "공동주택"·"주거시설"·빈 값은 100세대 이상이면 아파트, 미만이면 기타 공동주택 (세대 수 미상은 기타).
 * 고덕역 1km 207행: 아파트 28, 기타 공동주택 179.
 */
const VILLA = /다세대|연립|도시형|단지형|생활주택/;
export const AMBIGUOUS_APT_MIN_UNITS = 100;
export function isApartment(p: Record<string, unknown>): boolean {
  const use = typeof p.otherUse === "string" ? p.otherUse : "";
  if (VILLA.test(use)) return false;
  if (use.includes("아파트")) return true;
  const units = num(p.units);
  return units !== null && units >= AMBIGUOUS_APT_MIN_UNITS;
}

export function a05(ctx: EngineContext): TileResult {
  const sources = ctx.sources("core", ["ledger_recap", "ledger_title"]);
  if (sources.length === 0) return noDataTile(ctx, "A05", ["ledger_recap", "ledger_title"]);
  const unitTypeSources = ctx.sources("core", ["ledger_exclusive_area"]);
  const kaptSources = ctx.sources("core", ["kapt"]);
  const hasKapt = kaptSources.length > 0;
  const hits = ctx.hits("core", ["housing_complex", "officetel"]);
  const complexes = hits.filter((h) => h.kind === "housing_complex");
  const apts = complexes.filter((h) => h.properties.mainUse === "공동주택" && isApartment(h.properties));
  const others = complexes.filter((h) => !apts.includes(h));
  const officetels = hits.filter((h) => h.kind === "officetel");
  const targets: FeatureHit[] = [...apts, ...officetels]; // 연식·비중은 아파트·오피스텔 기준 (기타 공동주택은 별도 지표)
  const unitTypeKnown = targets.filter((h) => unitTypesFromUnknown(h.properties.unitTypes).length > 0).length;
  const kapt = hasKapt ? kaptHouseholds(ctx, apts) : new Map<string, number>();
  const kaptOnlyApts = hasKapt ? kaptOnly(ctx) : [];
  /** 가구 수(대장) → K-APT 세대수 → 세대 수(대장) */
  const hhOf = (h: FeatureHit): number | null => num(h.properties.households) ?? kapt.get(h.stableId) ?? num(h.properties.units);
  let othersHh = 0;
  for (const o of others) othersHh += hhOf(o) ?? 0;

  // 세대: 가구 수 우선, 없으면 K-APT(있을 때), 그다음 세대 수. 값을 못 얻은 단지는 합계에서 빼고 개수로 병기한다.
  let hh = 0;
  let hhKnown = 0;
  let fromUnits = 0;
  let fromKapt = 0;
  for (const a of apts) {
    const h = hhOf(a);
    if (h === null) continue;
    hh += h;
    hhKnown += 1;
    if (num(a.properties.households) === null) {
      if (kapt.has(a.stableId)) fromKapt += 1;
      else fromUnits += 1;
    }
  }
  const hhUnknown = apts.length - hhKnown;

  const officetelUnits = officetels.map((o) => num(o.properties.units)).filter((n): n is number => n !== null);
  const years = targets.map((t) => year(t.properties.approvalDate)).filter((y): y is number => y !== null).sort((a, b) => a - b);
  const dated = targets.filter((t) => year(t.properties.approvalDate) !== null);
  const aged = dated.filter((t) => isAged(t.properties.approvalDate as string, ctx.input.analysisDate)).length;

  let parkN = 0;
  let parkHh = 0;
  for (const a of apts) {
    const p = num(a.properties.parking);
    const h = hhOf(a);
    if (p !== null && h !== null) {
      parkN += p;
      parkHh += h;
    }
  }

  const basis = hasKapt ? "a05-households@2:세대수: 대장, 없으면 K-APT, 그다음 대장 세대 수" : "a05-households@1:가구 수 우선, 없으면 세대 수";
  const metrics: TileDraft["metrics"] = [
    obs("apartment_complexes", "아파트 단지", apts.length, "개", "a05-count@2:isApartment"),
    obs("other_residential", "기타 공동주택(연립·다세대 등)", others.length, "개", "a05-count@2:isApartment"),
    obs("other_residential_households", "기타 공동주택 세대(세대 수 확인분)", othersHh, "세대", "a05-count@2:isApartment"),
    obs("officetels", "오피스텔", officetels.length, "개", "a05-count@1"),
    obs("households", hasKapt ? "확인 세대(세대수: 대장, 없으면 K-APT)" : "확인 세대(가구 수 우선, 없으면 세대 수)", hh, "세대", basis, hhKnown, apts.length),
    ...(hasKapt ? [obs("households_from_kapt", "K-APT 세대수로 대신한 단지", fromKapt, "개", basis)] : []),
    obs("households_from_units", "세대 수로 대신한 단지", fromUnits, "개", basis),
    obs("households_unknown_complexes", "세대 수를 알 수 없는 단지", hhUnknown, "개", basis),
    obs("unit_type_complexes", "전용면적 타입 확인 단지", unitTypeKnown, "개", "a05-unit-types@1", unitTypeKnown, targets.length),
    officetelUnits.length === 0 && officetels.length > 0
      ? missing("officetel_units", "오피스텔 호실", "호", "a05-officetel-units@1")
      : obs("officetel_units", "오피스텔 호실", officetelUnits.reduce((s, n) => s + n, 0), "호", "a05-officetel-units@1", officetelUnits.length, officetels.length),
    years.length === 0
      ? missing("median_approval_year", "준공연도 중앙값(하위 중앙)", "년", "a05-median-year@1:lower-median")
      : obs("median_approval_year", "준공연도 중앙값(하위 중앙)", years[Math.floor((years.length - 1) / 2)], "년", "a05-median-year@1:lower-median", years.length, targets.length),
    dated.length === 0
      ? missing("aged_share_pct", "30년 이상 건물 비중", "%", "a05-aged-share@1")
      : est("aged_share_pct", "30년 이상 건물 비중", Math.round((aged / dated.length) * 1000) / 10, "%", "a05-aged-share@1", aged, dated.length),
    parkHh === 0 ? missing("parking_per_household", "세대당 주차대수", "대", "a05-parking@1") : obs("parking_per_household", "세대당 주차대수", Math.round((parkN / parkHh) * 100) / 100, "대", "a05-parking@1", parkN, parkHh),
    ...(hasKapt ? [obs("kapt_only_apartments", "K-APT에만 있는 아파트 단지", kaptOnlyApts.length, "개", "a05-kapt-only@1:단지종류 코드 1(아파트로 간주), 대장 단지와 같은 필지 연결 없음")] : []),
  ];

  const limitations: TileDraft["limitations"] = [];
  if (hasKapt && kaptOnlyApts.length > 0) limitations.push({ kind: "partial", note: `K-APT에만 있는 아파트 단지 ${kaptOnlyApts.length}곳은 아파트 단지 수·세대 합계에 넣지 않았습니다(단지종류 코드 1을 아파트로 간주).` });
  if (hhUnknown > 0) limitations.push({ kind: "incomplete", note: `세대 수를 알 수 없는 단지 ${hhUnknown}곳은 세대 합계에서 제외했습니다.` });
  if (dated.length > 0) limitations.push({ kind: "estimated", note: "30년 이상 비중은 분석일 대비 사용승인일 경과연수로 추정한 값입니다." });
  const coverage = ctx.coverage("core", ["ledger_recap", "ledger_title", "ledger_exclusive_area"]);
  limitations.push(...coverage);

  const sentence =
    hits.length === 0
      ? "반경 안 대장 자료의 주거 건물이 확인되지 않음 → 기존 공급이 없거나 대장 위치 미확인 → 현장과 대장 확인 필요"
      : `아파트 ${apts.length}개 단지 ${fmt(hh)}세대(연립·다세대 등 ${others.length}곳 별도)${years.length ? `, 준공연도 중앙값 ${years[Math.floor((years.length - 1) / 2)]}년` : ""} → 대장에 잡힌 기존 재고의 규모와 연식 → ${hhUnknown > 0 ? "세대수 미상 단지 확인 필요" : "위치 미확인 건물은 반경에 포함되지 않아 확인 필요"}`;
  const partial = limitations.some((l) => l.kind === "incomplete");
  const stockSublabel = (h: FeatureHit, unit: "세대" | "호"): string | null => {
    const value = unit === "호" ? num(h.properties.units) : hhOf(h);
    return value === null ? null : `${fmt(value)}${unit}`;
  };
  const labelPriority = (h: FeatureHit): 0 | 1 => (h.name ? 1 : 0);
  return makeTile(ctx, {
    code: "A05",
    status: partial ? "partial" : "complete",
    metrics,
    judgment: { ruleId: "a05-stock@1", basisMetricIds: ["apartment_complexes", "households"], sentence, level: null, criteria: null },
    sources: [...sources, ...unitTypeSources, ...kaptSources],
    layers: ["apt", "other_housing", "officetel"],
    map: [
      ...apts.map((h) => candidate(h, "apt", { ...callout(h, "아파트", hhOf(h)), sublabel: stockSublabel(h, "세대"), labelPriority: labelPriority(h) })),
      ...others.map((h) => candidate(h, "other_housing", { ...callout(h, "기타 공동주택", hhOf(h)), sublabel: stockSublabel(h, "세대"), labelPriority: labelPriority(h) })),
      ...officetels.map((h) => candidate(h, "officetel", { ...callout(h, "오피스텔", num(h.properties.units)), sublabel: stockSublabel(h, "호"), labelPriority: labelPriority(h) })),
    ],
    limitations,
  });
}

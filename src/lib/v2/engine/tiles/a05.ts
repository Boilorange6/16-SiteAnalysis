/** A05 기존 주거 공급 — 건축물대장 총괄표제부(단지)·표제부(단일동·오피스텔) 대표점. 등급 없음. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import type { FeatureHit } from "../../data/features";
import { est, fmt, makeTile, missing, noDataTile, obs, type TileDraft } from "./common";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const year = (v: unknown): number | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Number(v.slice(0, 4)) : null);

/** 사용승인일로부터 분석일까지 30년 이상(승인 30주년 당일 포함) */
export function isAged(approvalDate: string, analysisDate: string): boolean {
  return `${Number(approvalDate.slice(0, 4)) + 30}${approvalDate.slice(4)}` <= analysisDate;
}

/** 가구 수가 있으면 가구 수, 없으면 세대 수. 둘 다 없으면 null */
const householdsOf = (p: Record<string, unknown>): number | null => num(p.households) ?? num(p.units);

export function a05(ctx: EngineContext): TileResult {
  const sources = ctx.sources("core", ["ledger_recap", "ledger_title"]);
  if (sources.length === 0) return noDataTile(ctx, "A05", ["ledger_recap", "ledger_title"]);
  const hits = ctx.hits("core", ["housing_complex", "officetel"]);
  const complexes = hits.filter((h) => h.kind === "housing_complex");
  const apts = complexes.filter((h) => h.properties.mainUse === "공동주택");
  const others = complexes.filter((h) => h.properties.mainUse !== "공동주택");
  const officetels = hits.filter((h) => h.kind === "officetel");
  const targets: FeatureHit[] = [...complexes, ...officetels];

  // 세대: 가구 수 우선, 없으면 세대 수. 값을 못 얻은 단지는 합계에서 빼고 개수로 병기한다.
  let hh = 0;
  let hhKnown = 0;
  let fromUnits = 0;
  for (const a of apts) {
    const h = householdsOf(a.properties);
    if (h === null) continue;
    hh += h;
    hhKnown += 1;
    if (num(a.properties.households) === null) fromUnits += 1;
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
    const h = householdsOf(a.properties);
    if (p !== null && h !== null) {
      parkN += p;
      parkHh += h;
    }
  }

  const basis = "a05-households@1:가구 수 우선, 없으면 세대 수";
  const metrics: TileDraft["metrics"] = [
    obs("apartment_complexes", "아파트 단지", apts.length, "개", "a05-count@1"),
    obs("other_residential", "기타 주거 건물", others.length, "개", "a05-count@1"),
    obs("officetels", "오피스텔", officetels.length, "개", "a05-count@1"),
    obs("households", "확인 세대(가구 수 우선, 없으면 세대 수)", hh, "세대", basis, hhKnown, apts.length),
    obs("households_from_units", "세대 수로 대신한 단지", fromUnits, "개", basis),
    obs("households_unknown_complexes", "세대 수를 알 수 없는 단지", hhUnknown, "개", basis),
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
  ];

  const limitations: TileDraft["limitations"] = [];
  if (hhUnknown > 0) limitations.push({ kind: "incomplete", note: `세대 수를 알 수 없는 단지 ${hhUnknown}곳은 세대 합계에서 제외했습니다.` });
  if (dated.length > 0) limitations.push({ kind: "estimated", note: "30년 이상 비중은 분석일 대비 사용승인일 경과연수로 추정한 값입니다." });
  const coverage = ctx.coverage("core", ["ledger_recap", "ledger_title"]);
  limitations.push(...coverage);

  const sentence =
    hits.length === 0
      ? "반경 안 대장 자료의 주거 건물이 확인되지 않음 → 기존 공급이 없거나 대장 위치 미확인 → 현장과 대장 확인 필요"
      : `아파트 ${apts.length}개 단지 ${fmt(hh)}세대 확인${years.length ? `, 준공연도 중앙값 ${years[Math.floor((years.length - 1) / 2)]}년` : ""} → 대장에 잡힌 기존 재고의 규모와 연식 → ${hhUnknown > 0 ? "세대수 미상 단지 확인 필요" : "위치 미확인 건물은 반경에 포함되지 않아 확인 필요"}`;
  const partial = limitations.some((l) => l.kind === "incomplete");
  return makeTile(ctx, {
    code: "A05",
    status: partial ? "partial" : "complete",
    metrics,
    judgment: { ruleId: "a05-stock@1", basisMetricIds: ["apartment_complexes", "households"], sentence, level: null, criteria: null },
    sources,
    layers: ["housing_complex", "officetel"],
    limitations,
  });
}

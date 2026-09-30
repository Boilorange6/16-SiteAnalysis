/**
 * A11 인구·가구 — SGIS 1 km 격자(pop_grid)를 분석 원과 겹친 면적 비율로 나눠 더한 추정.
 *   반경 인구 = Σ(격자 인구 × A(격자∩원) / A(격자))   가구도 같은 식. 격자 안에서 인구가 고르게 퍼져 있다고 가정한다.
 * 비공개(N/A) 격자는 0으로 세지 않고 제외하며 몇 개인지 한계에 적는다. 등급은 없다.
 * 비율(1인 가구·연령 구성·가구원 수)은 분자·분모 모두 값이 공개된 같은 격자끼리만 계산한다.
 * 지도 지물은 격자 중심점이다. 격자 한 변(1,000 m)은 pop_grid 속성 cellSizeM에 있고 MapFeature 계약에는 아직 없다.
 */
import { toUtmk } from "../../crs";
import type { FeatureHit } from "../../data/features";
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { candidate, est, fmt, makeTile, missing, noDataTile, obs, type MapCandidate, type TileDraft } from "./common";

type Value = { v: number | null; s: string };
interface CellProps {
  cellSizeM?: number;
  dataYear?: string | null;
  population?: { total?: Value };
  ageGroups?: { under15?: Value; age15to64?: Value; age65plus?: Value };
  households?: { total?: Value; single?: Value };
}
type Metric = TileResult["metrics"][number];

const num = (x: Value | undefined): number | null => (x && x.s === "observed" && typeof x.v === "number" ? x.v : null);

// ── 원 ∩ 축정렬 사각형 넓이 (해석해) ──
/** 원(중심 0,0 반지름 r)과 [0,a]×[0,b] (a,b ≥ 0)의 겹침 넓이 */
function quadrant(a: number, b: number, r: number): number {
  a = Math.min(a, r);
  b = Math.min(b, r);
  if (a * a + b * b <= r * r) return a * b;
  const x0 = Math.sqrt(r * r - b * b);
  const prim = (x: number) => 0.5 * (x * Math.sqrt(Math.max(0, r * r - x * x)) + r * r * Math.asin(Math.min(1, x / r)));
  return b * x0 + prim(a) - prim(x0);
}
const signed = (x: number, y: number, r: number) => Math.sign(x) * Math.sign(y) * quadrant(Math.abs(x), Math.abs(y), r);

/** 원(중심 (cx,cy), 반지름 r)과 사각형 [x0,x1]×[y0,y1]의 겹침 넓이(㎡) */
export function circleRectOverlap(cx: number, cy: number, r: number, x0: number, y0: number, x1: number, y1: number): number {
  const [ax0, ax1, ay0, ay1] = [x0 - cx, x1 - cx, y0 - cy, y1 - cy];
  return Math.max(0, signed(ax1, ay1, r) - signed(ax0, ay1, r) - signed(ax1, ay0, r) + signed(ax0, ay0, r));
}

const suppressed = (id: string, label: string, unit: string, formula: string): Metric => ({ id, label, value: null, unit, formulaVersion: formula, numerator: null, denominator: null, status: "suppressed" });
const pct = (part: number, whole: number) => Math.round((1000 * part) / whole) / 10;

interface Cell {
  hit: FeatureHit;
  f: number; // 격자 넓이 중 원과 겹친 비율
  overlapM2: number;
  pop: number | null;
  hh: number | null;
  single: number | null;
  groups: { under15: number | null; age15to64: number | null; age65plus: number | null };
}

export function a11(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["sgis_grid"]);
  if (sources.length === 0) return noDataTile(ctx, "A11", ["sgis_grid"]);
  const r = ctx.input.radiusM;
  const [cx, cy] = toUtmk(ctx.input.center);
  const circleM2 = Math.PI * r * r;

  // 격자 중심이 r + 반대각선/2(≈708 m) 안이면 원과 겹칠 수 있다
  const cells: Cell[] = [];
  for (const hit of ctx.hits("reference", ["pop_grid"], r + 708)) {
    const p = hit.properties as CellProps;
    const size = p.cellSizeM ?? 1000;
    const [px, py] = (hit.geometry as { coordinates: number[] }).coordinates;
    const overlapM2 = circleRectOverlap(cx, cy, r, px - size / 2, py - size / 2, px + size / 2, py + size / 2);
    if (overlapM2 <= 1e-6) continue;
    cells.push({
      hit,
      f: overlapM2 / (size * size),
      overlapM2,
      pop: num(p.population?.total),
      hh: num(p.households?.total),
      single: num(p.households?.single),
      groups: { under15: num(p.ageGroups?.under15), age15to64: num(p.ageGroups?.age15to64), age65plus: num(p.ageGroups?.age65plus) },
    });
  }
  cells.sort((a, b) => a.hit.featureId - b.hit.featureId);

  const sum = (cs: Cell[], fn: (c: Cell) => number) => cs.reduce((s, c) => s + fn(c) * c.f, 0);
  const popCells = cells.filter((c) => c.pop !== null);
  const popSup = cells.filter((c) => c.pop === null);
  const supM2 = popSup.reduce((s, c) => s + c.overlapM2, 0);
  const coveredM2 = cells.reduce((s, c) => s + c.overlapM2, 0);
  const year = (cells[0]?.hit.properties as CellProps | undefined)?.dataYear ?? sources[0].sourceAsOf ?? "";

  const F_POP = "a11-pop@1:Σ(격자 인구×원∩격자 면적/격자 면적), 인구 공개 격자만";
  const F_HH = "a11-households@1:Σ(격자 가구×원∩격자 면적/격자 면적), 가구 공개 격자만";
  const F_DENS = "a11-density@1:추정 인구÷원 면적(π·r², 육지 구분 없음)";

  const popEst = popCells.length ? sum(popCells, (c) => c.pop!) : null;
  const hhCells = cells.filter((c) => c.hh !== null);
  const hhEst = hhCells.length ? sum(hhCells, (c) => c.hh!) : null;
  const both = cells.filter((c) => c.pop !== null && c.hh !== null && c.hh > 0);
  const singles = cells.filter((c) => c.hh !== null && c.hh > 0 && c.single !== null);
  const groupShare = (key: keyof Cell["groups"]) => {
    const cs = cells.filter((c) => c.pop !== null && c.groups[key] !== null);
    const whole = sum(cs, (c) => c.pop!);
    return cs.length && whole > 0 ? { share: pct(sum(cs, (c) => c.groups[key]!), whole), cells: cs.length } : null;
  };
  const elder = groupShare("age65plus");
  const youth = groupShare("under15");
  const working = groupShare("age15to64");

  const metrics: TileDraft["metrics"] = [];
  if (cells.length === 0) {
    metrics.push(missing("pop_est", "반경 추정 인구", "명", F_POP), missing("hh_est", "반경 추정 가구", "가구", F_HH));
  } else {
    metrics.push(
      popEst === null ? suppressed("pop_est", "반경 추정 인구", "명", F_POP) : est("pop_est", "반경 추정 인구", Math.round(popEst), "명", F_POP),
      popEst === null ? suppressed("density_per_km2", "인구밀도(원 면적 기준)", "명/㎢", F_DENS) : est("density_per_km2", "인구밀도(원 면적 기준)", Math.round(popEst / (circleM2 / 1e6)), "명/㎢", F_DENS),
      hhEst === null ? suppressed("hh_est", "반경 추정 가구", "가구", F_HH) : est("hh_est", "반경 추정 가구", Math.round(hhEst), "가구", F_HH),
    );
    if (both.length) {
      const p = sum(both, (c) => c.pop!);
      const h = sum(both, (c) => c.hh!);
      metrics.push(est("avg_hh_size", "가구당 인구", Math.round((100 * p) / h) / 100, "명", "a11-hh-size@1:인구·가구 모두 공개된 격자의 Σ인구÷Σ가구", p, h));
    }
    if (singles.length) {
      const s = sum(singles, (c) => c.single!);
      const h = sum(singles, (c) => c.hh!);
      metrics.push(est("single_hh_pct", "1인 가구 비중", pct(s, h), "%", "a11-single@1:가구·1인가구 모두 공개된 격자의 Σ1인가구÷Σ가구", s, h));
    }
    for (const [id, label, g, key] of [["elder_pct", "65세 이상 비중", elder, "age65plus"], ["youth_pct", "15세 미만 비중", youth, "under15"], ["working_pct", "15~64세 비중", working, "age15to64"]] as const) {
      if (g) metrics.push(est(id, label, g.share, "%", `a11-age@1:${key} 구간이 모두 공개된 격자의 Σ구간÷Σ인구(같은 격자)`));
    }
    metrics.push(obs("cells_in_circle", "원과 겹친 격자", cells.length, "개", "a11-cells@1:1km 격자 중 원과 겹치는 것"), obs("cells_suppressed", "인구 비공개 격자", popSup.length, "개", "a11-suppressed@1:총인구 N/A"));
  }

  const rTxt = fmt(r);
  const round10 = (n: number) => fmt(Math.round(n / 10) * 10);
  const sentence =
    cells.length === 0
      ? `반경 ${rTxt}m 안에 SGIS 격자 자료 셀 없음 → 무인 지역이거나 자료가 없는 곳이라 인구 0으로 볼 수 없음 → 실제 거주 여부는 주민등록 통계 확인 필요`
      : popEst === null
        ? `반경 ${rTxt}m 안 격자 ${cells.length}개의 인구가 모두 비공개 → 비밀보호로 값이 빠진 것이라 0명이 아님 → 인구는 다른 통계로 확인 필요`
        : `${year}년 격자 기준 반경 ${rTxt}m 안 추정 인구 약 ${round10(popEst)}명${hhEst === null ? "" : `·약 ${round10(hhEst)}가구`}${elder ? `, 65세 이상 ${elder.share}%` : ""} → 1km 격자를 면적비로 나눈 추정이고 비밀보호 노이즈가 섞여 실측 인구가 아니며 증감은 단년 자료라 비교 불가 → 경계 부근 실제 분포와 최신 주민등록 인구는 별도 확인 필요`;

  // 지도: 격자 중심점. 인구밀도(명/㎢) 5분위 레이어, 비공개는 회색.
  const map: MapCandidate[] = [];
  const dens = (c: Cell) => c.pop! / (((c.hit.properties as CellProps).cellSizeM ?? 1000) ** 2 / 1e6);
  const ranked = [...popCells].sort((a, b) => dens(a) - dens(b) || a.hit.featureId - b.hit.featureId);
  ranked.forEach((c, k) => {
    const q = Math.floor((k * 5) / ranked.length) + 1;
    map.push(candidate(c.hit, `pop_grid_q${q}`, { weight: c.pop, label: `${fmt(c.pop!)}명` }));
  });
  for (const c of popSup) map.push(candidate(c.hit, "pop_grid_na", { weight: null, label: "비공개" }));

  const limitations: TileDraft["limitations"] = [
    { kind: "estimated", note: "SGIS 격자 통계는 비밀보호로 5 미만 값을 0 또는 5로 확률 대체하고 그 이상 값에도 최대 ±7의 노이즈를 더합니다. 면적비 배분은 격자 안 인구가 고르게 퍼져 있다는 가정이라 실측 인구가 아니며 격자 경계와 실제 주거지가 다르면 어긋납니다." },
    { kind: "not_provided", note: "2024년 한 해 자료라 같은 경계·해상도의 전기 자료가 없어 인구 증감률은 계산하지 않았습니다." },
  ];
  if (popSup.length > 0) {
    limitations.push({ kind: "suppressed", note: `원과 겹친 격자 ${cells.length}개 중 ${popSup.length}개는 인구가 비공개(N/A)라 인구 합계에서 제외했습니다(원 면적의 ${pct(supM2, circleM2)}%). 0명이 아니므로 추정 인구가 실제보다 적게 나올 수 있습니다.` });
  }
  if (hhCells.length < cells.length) {
    limitations.push({ kind: "suppressed", note: `가구 수가 비공개인 격자 ${cells.length - hhCells.length}개는 가구 합계에서 제외했습니다.` });
  }
  for (const [label, g] of [["65세 이상", elder], ["15세 미만", youth], ["15~64세", working]] as const) {
    if (g && g.cells < popCells.length) limitations.push({ kind: "suppressed", note: `${label} 비중은 연령 구간이 모두 공개된 격자 ${g.cells}개(인구 공개 ${popCells.length}개 중)만으로 계산했습니다.` });
    else if (!g && popCells.length > 0) limitations.push({ kind: "suppressed", note: `${label} 비중: 연령 구간이 모두 공개된 격자가 없어 계산하지 않았습니다.` });
  }
  if (cells.length > 0 && coveredM2 < circleM2 * 0.99) {
    limitations.push({ kind: "unknown", note: `원 면적의 ${pct(circleM2 - coveredM2, circleM2)}%는 자료에 격자가 없는 곳입니다(무인 지역과 자료 없음을 구분할 수 없어 인구를 더하지 않았습니다).` });
  }
  limitations.push(...ctx.coverage("reference", ["sgis_grid"]));

  return makeTile(ctx, {
    code: "A11",
    status: cells.length === 0 || popSup.length > 0 ? "partial" : "complete",
    metrics,
    judgment: { ruleId: "a11-pop-grid@1", basisMetricIds: popEst === null ? [] : ["pop_est"], sentence, level: null, criteria: null },
    sources,
    layers: ["pop_grid_q1", "pop_grid_q2", "pop_grid_q3", "pop_grid_q4", "pop_grid_q5", "pop_grid_na"],
    map,
    limitations,
  });
}

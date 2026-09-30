/**
 * A10 계획 철도 — 공개 계획 철도 목록(planned_rail_*)의 반경 내 선형·계획역. 단계와 검토 경과일을 그대로 보인다.
 * 운영역 접근성(A01)과 합산하지 않고 등급도 없다. 목록이 일부 사업만 담고 있어 “없음”을 단정하지 않는다.
 */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { candidate, makeTile, missing, nearestHit, nearestM, obs, type MapCandidate, type TileDraft } from "./common";
import { distanceToLineM, sampleLine } from "./geo";
import { notProvided } from "./not-provided";

const STAGE_TEXT: Record<string, string> = {
  under_construction: "공사 중",
  planned: "계획",
  proposed: "구상",
  approved: "승인",
  official_plan: "공식 계획",
};
const stageOf = (v: unknown) => (typeof v === "string" && v !== "" ? STAGE_TEXT[v] ?? v : "단계 미상");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown): string | null => (typeof v === "string" && ISO.test(v) ? v : null);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function a10(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["planned_rail"]);
  if (sources.length === 0) return notProvided(ctx, "A10");
  const radiusM = ctx.input.radiusM;
  const lines = ctx.hits("reference", ["planned_rail_line"]).map((h) => ({ h, d: distanceToLineM(ctx.input.center, h.geometry) }));
  const stations = ctx.hits("reference", ["planned_rail_station"]);
  const total = (ctx.db("reference")?.prepare("SELECT COUNT(*) FROM feature WHERE kind = 'planned_rail_line'").pluck().get() as number | undefined) ?? 0;

  // 사업 단위 정리: 선형과 계획역을 projectId로 묶는다
  const projects = new Map<string, { stage: unknown; verified: string | null; nextReview: string | null; approx: boolean }>();
  for (const { h } of lines) {
    const p = h.properties;
    projects.set(String(p.projectId ?? h.stableId), { stage: p.lifecycleStatus, verified: iso(p.lastVerifiedAt), nextReview: iso(p.nextReviewAt), approx: p.sourceType === "approximation" });
  }
  for (const s of stations) {
    const id = String(s.properties.projectId ?? s.stableId);
    if (!projects.has(id)) projects.set(id, { stage: s.properties.lifecycleStatus, verified: iso(s.properties.lastVerifiedAt), nextReview: null, approx: false });
  }
  const byStage = new Map<string, number>();
  for (const p of projects.values()) byStage.set(stageOf(p.stage), (byStage.get(stageOf(p.stage)) ?? 0) + 1);
  const approx = [...projects.values()].some((p) => p.approx);
  const overdue = [...projects.values()].some((p) => p.nextReview !== null && p.nextReview < ctx.input.analysisDate);
  const verified = [...projects.values()].map((p) => p.verified).filter((v): v is string => v !== null).sort();
  const ageDays = verified.length ? daysBetween(verified[0], ctx.input.analysisDate) : null;
  const nearStation = nearestHit(stations);
  const nearStationM = nearestM(stations.map((s) => s.distanceM));
  const nearLineM = nearestM(lines.map((l) => l.d));

  const metrics: TileDraft["metrics"] = [
    obs("planned_projects", "반경 내 계획·공사 사업", projects.size, "건", "a10-projects@1:선형 또는 계획역이 반경에 든 고유 사업"),
    nearStationM === null ? missing("nearest_planned_station_m", "최근접 계획역", "m", "a10-station-distance@1:직선") : obs("nearest_planned_station_m", "최근접 계획역", nearStationM, "m", "a10-station-distance@1:직선"),
    nearLineM === null ? missing("nearest_planned_line_m", "최근접 계획 선형", "m", "a10-line-distance@1:직선") : obs("nearest_planned_line_m", approx ? "최근접 계획 선형(개략 선형)" : "최근접 계획 선형", nearLineM, "m", "a10-line-distance@1:직선"),
    ...[...byStage].sort(([a], [b]) => (a < b ? -1 : 1)).map(([stage, n], i) => obs(`stage_${i + 1}`, `단계: ${stage}`, n, "건", "a10-stage@1:원천 상태값")),
    missing("opening_schedule", "개통 예정 시점", "", "a10-schedule@0:원천에 일정 없음(연·반기·월 정밀도 미확인)"),
    ageDays === null ? missing("review_age_days", "근거 마지막 확인 후 경과일", "일", "a10-review-age@1") : obs("review_age_days", "근거 마지막 확인 후 경과일(가장 오래된 사업)", ageDays, "일", "a10-review-age@1:분석일 − 마지막 확인일"),
  ];

  const stageTxt = [...byStage].map(([s, n]) => `${s} ${n}건`).join(", ");
  const lead = [approx ? "위치는 개략 선형" : null, overdue ? "검토기한 경과" : null].filter(Boolean).join("·");
  const sentence =
    projects.size === 0
      ? "반경 안 공개 목록의 계획 철도 없음 → 목록이 일부 사업만 담고 있어 계획이 없다는 뜻은 아님 → 계획 여부는 관계 기관 확인 필요"
      : `${lead ? `${lead}: ` : ""}반경 안 계획·공사 사업 ${projects.size}건(${stageTxt})${nearStationM === null ? "" : `, 최근접 계획역 직선 ${nearStationM}m`} → 개통 시점은 원천에 없고 운영역 접근성과 합산하지 않음 → 확정 노선·일정은 원천 확인 필요`;

  const map: MapCandidate[] = [];
  const step = Math.max(50, radiusM / 30);
  for (const { h } of lines) map.push(...sampleLine(ctx.input.center, h.geometry, radiusM, step, h.featureId, "planned_rail_line"));
  for (const s of stations) map.push(s === nearStation ? candidate(s, "planned_rail_station", { highlight: true, label: `직선 ${nearStationM}m` }) : candidate(s, "planned_rail_station"));

  return makeTile(ctx, {
    code: "A10",
    status: "partial",
    metrics,
    judgment: { ruleId: "a10-planned-rail@1", basisMetricIds: ["planned_projects"], sentence, level: null, criteria: null },
    sources,
    layers: ["planned_rail_line", "planned_rail_station"],
    map,
    limitations: [
      { kind: "partial", note: `공개 계획 철도 목록이 일부(${total}건)만 포함` },
      ...(approx ? [{ kind: "estimated" as const, note: "선형은 공사 선형을 보조로 삼은 개략 위치이며 확정 노선이 아닙니다." }] : []),
      { kind: "not_provided", note: "개통 예정 시점(연·반기·월)은 원천에 없어 표시하지 않습니다." },
      ...ctx.coverage("reference", ["planned_rail"]),
    ],
  });
}

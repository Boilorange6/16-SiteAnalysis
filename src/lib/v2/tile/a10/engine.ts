/**
 * A10 계획 철도 — 공개 계획 철도 목록(planned_rail_*)의 반경 내 선형·계획역. 단계와 검토 경과일을 그대로 보인다.
 * 운영역 접근성(A01)과 합산하지 않고 등급도 없다. 목록이 일부 사업만 담고 있어 “없음”을 단정하지 않는다.
 */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { candidate, lineCandidate, makeTile, missing, nearestHit, nearestM, obs, type LineCandidate, type MapCandidate, type TileDraft } from "../../engine/tiles/common";
import { clipLineToCircle, distanceToLineM, linePathLength } from "../../engine/tiles/geo";
import { notProvided } from "../../engine/tiles/not-provided";
import { formatDistanceM } from "../../ui/tile-view";
import { plannedSublabel } from "./d24";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (v: unknown): string | null => (typeof v === "string" && ISO.test(v) ? v : null);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};
const projectIdOf = (properties: Record<string, unknown>, stableId: string): string => {
  const projectId = properties.projectId;
  return typeof projectId === "string" && projectId.trim() !== "" ? projectId : stableId;
};

export function a10(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["planned_rail"]);
  if (sources.length === 0) return notProvided(ctx, "A10");
  const radiusM = ctx.input.radiusM;
  const lines = ctx.hits("reference", ["planned_rail_line"]).map((h) => ({ h, d: distanceToLineM(ctx.input.center, h.geometry) }));
  const stations = ctx.hits("reference", ["planned_rail_station"]);
  const total = (ctx.db("reference")?.prepare("SELECT COUNT(*) FROM feature WHERE kind = 'planned_rail_line'").pluck().get() as number | undefined) ?? 0;

  // 사업 단위 정리: 선형과 계획역을 projectId로 묶는다
  const projects = new Map<string, { verified: string | null; approx: boolean }>();
  for (const { h } of lines) {
    const p = h.properties;
    projects.set(String(p.projectId ?? h.stableId), { verified: iso(p.lastVerifiedAt), approx: p.sourceType === "approximation" });
  }
  for (const s of stations) {
    const id = String(s.properties.projectId ?? s.stableId);
    if (!projects.has(id)) projects.set(id, { verified: iso(s.properties.lastVerifiedAt), approx: false });
  }
  const approx = [...projects.values()].some((p) => p.approx);
  const verified = [...projects.values()].map((p) => p.verified).filter((v): v is string => v !== null).sort();
  const ageDays = verified.length ? daysBetween(verified[0], ctx.input.analysisDate) : null;
  const nearStation = nearestHit(stations);
  const nearStationM = nearestM(stations.map((s) => s.distanceM));
  const nearLineM = nearestM(lines.map((l) => l.d));

  const metrics: TileDraft["metrics"] = [
    obs("planned_projects", "반경 내 계획·공사 사업", projects.size, "건", "a10-projects@1:선형 또는 계획역이 반경에 든 고유 사업"),
    nearStationM === null ? missing("nearest_planned_station_m", "최근접 계획역", "m", "a10-station-distance@1:직선") : obs("nearest_planned_station_m", "최근접 계획역", nearStationM, "m", "a10-station-distance@1:직선"),
    nearLineM === null ? missing("nearest_planned_line_m", "최근접 계획 선형", "m", "a10-line-distance@1:직선") : obs("nearest_planned_line_m", approx ? "최근접 계획 선형(개략 선형)" : "최근접 계획 선형", nearLineM, "m", "a10-line-distance@1:직선"),
    missing("opening_schedule", "개통 예정 시점", "", "a10-schedule@0:원천에 일정 없음(연·반기·월 정밀도 미확인)"),
    ageDays === null ? missing("review_age_days", "근거 마지막 확인 후 경과일", "일", "a10-review-age@1") : obs("review_age_days", "근거 마지막 확인 후 경과일(가장 오래된 사업)", ageDays, "일", "a10-review-age@1:분석일 − 마지막 확인일"),
  ];

  const map: MapCandidate[] = [];
  const lineCandidates: LineCandidate[] = [];
  const lineParts = lines.flatMap(({ h }) => clipLineToCircle(ctx.input.center, radiusM, h.geometry).map((path, index) => ({
    h,
    index,
    path,
    lengthM: linePathLength(path),
  })));
  const longestByProject = new Map<string, { lengthM: number; fid: string }>();
  for (const part of lineParts) {
    const projectId = projectIdOf(part.h.properties, part.h.stableId);
    const fid = `${part.h.featureId}:${part.index}`;
    const current = longestByProject.get(projectId);
    if (!current || part.lengthM > current.lengthM || (part.lengthM === current.lengthM && fid < current.fid)) longestByProject.set(projectId, { lengthM: part.lengthM, fid });
  }
  for (const part of lineParts) {
    const projectId = projectIdOf(part.h.properties, part.h.stableId);
    const name = text(part.h.name);
    const fid = `${part.h.featureId}:${part.index}`;
    const line = lineCandidate(part.h.featureId, "planned_rail_line", part.path, part.lengthM, null, {
      fid,
      name,
      sublabel: plannedSublabel(part.h.properties),
      labelPriority: name && longestByProject.get(projectId)?.fid === fid ? 1 : 0,
      emphasis: "major",
    });
    if (line) lineCandidates.push(line);
  }
  for (const s of stations) {
    const isNearest = s === nearStation;
    map.push(candidate(s, "planned_rail_station", {
      highlight: isNearest,
      sublabel: isNearest && s.distanceM !== null ? `직선 ${formatDistanceM(s.distanceM)}` : null,
      labelPriority: isNearest ? 2 : s.name ? 1 : 0,
    }));
  }

  return makeTile(ctx, {
    code: "A10",
    status: "partial",
    metrics,
    sources,
    layers: ["planned_rail_line", "planned_rail_station"],
    map,
    lines: lineCandidates,
    limitations: [
      { kind: "partial", note: `공개 계획 철도 목록이 일부(${total}건)만 포함` },
      ...(approx ? [{ kind: "estimated" as const, note: "선형은 공사 선형을 보조로 삼은 개략 위치이며 확정 노선이 아닙니다." }] : []),
      { kind: "not_provided", note: "개통 예정 시점(연·반기·월)은 원천에 없어 표시하지 않습니다." },
      ...ctx.coverage("reference", ["planned_rail"]),
    ],
  });
}

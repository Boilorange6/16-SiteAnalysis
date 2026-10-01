/** D24 계획 철도 — 등록된 계획·공사 사업을 운영 철도와 분리해 표시한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { candidate, lineCandidate, makeTile, missing, nearestHit, obs, type LineCandidate, type MapCandidate, type TileDraft } from "./common";
import { clipLineToCircle, lineLengthInCircle, linePathLength } from "./geo";
import { notProvided } from "./not-provided";

const STAGE_LABELS = ["구상", "공식 계획", "승인", "공사", "중단/변경", "미확인"] as const;
type StageLabel = (typeof STAGE_LABELS)[number];

/** 계획 철도 원천의 lifecycleStatus를 도판의 고정 6단계로 정규화한다. */
export const PLANNED_STAGES: Readonly<Record<string, StageLabel>> = {
  proposed: "구상",
  concept: "구상",
  "구상": "구상",
  planned: "공식 계획",
  official_plan: "공식 계획",
  official: "공식 계획",
  "공식 계획": "공식 계획",
  approved: "승인",
  "승인": "승인",
  under_construction: "공사",
  construction: "공사",
  "공사": "공사",
  cancelled: "중단/변경",
  canceled: "중단/변경",
  suspended: "중단/변경",
  changed: "중단/변경",
  withdrawn: "중단/변경",
  stopped: "중단/변경",
  "중단/변경": "중단/변경",
  // 구 스키마의 개통 확정도 계획 원천의 상태이며 별도 도판 단계는 두지 않는다.
  opening_confirmed: "공식 계획",
};

const stageOf = (value: unknown): StageLabel => {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === "" ? "미확인" : PLANNED_STAGES[raw] ?? "미확인";
};

interface ProjectSummary {
  stage: StageLabel;
  hasGeometry: boolean;
  approximation: boolean;
}

const projectIdOf = (properties: Record<string, unknown>, stableId: string) => {
  const projectId = properties.projectId;
  return typeof projectId === "string" && projectId.trim() !== "" ? projectId : stableId;
};

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

export function d24(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["planned_rail"]);
  if (sources.length === 0) return notProvided(ctx, "D24");

  const radiusM = ctx.input.radiusM;
  const lines = ctx.hits("reference", ["planned_rail_line"]);
  const stations = ctx.hits("reference", ["planned_rail_station"]);
  const projects = new Map<string, ProjectSummary>();

  for (const line of lines) {
    const id = projectIdOf(line.properties, line.stableId);
    const stage = stageOf(line.properties.lifecycleStatus);
    const current = projects.get(id);
    if (!current) {
      projects.set(id, {
        stage,
        hasGeometry: true,
        approximation: line.properties.sourceType === "approximation",
      });
    } else {
      if (current.stage === "미확인" && stage !== "미확인") current.stage = stage;
      current.hasGeometry = true;
      current.approximation ||= line.properties.sourceType === "approximation";
    }
  }
  for (const station of stations) {
    const id = projectIdOf(station.properties, station.stableId);
    const stage = stageOf(station.properties.lifecycleStatus);
    const current = projects.get(id);
    if (!current) projects.set(id, { stage, hasGeometry: false, approximation: false });
    else if (current.stage === "미확인" && stage !== "미확인") current.stage = stage;
  }

  const stageCounts = new Map<StageLabel, number>(STAGE_LABELS.map((stage) => [stage, 0]));
  for (const project of projects.values()) stageCounts.set(project.stage, (stageCounts.get(project.stage) ?? 0) + 1);

  const lineLength = Math.round(lines.reduce((total, line) => total + lineLengthInCircle(ctx.input.center, radiusM, line.geometry), 0));
  const geometryProjects = [...projects.values()].filter((project) => project.hasGeometry).length;
  const approx = [...projects.values()].some((project) => project.approximation);
  const total = (ctx.db("reference")?.prepare("SELECT COUNT(*) FROM feature WHERE kind = 'planned_rail_line'").pluck().get() as number | undefined) ?? 0;
  const stageText = STAGE_LABELS
    .map((stage) => [stage, stageCounts.get(stage) ?? 0] as const)
    .filter(([, count]) => count > 0)
    .map(([stage, count]) => `${stage} ${count}건`)
    .join(", ");

  const geometryMetric = projects.size === 0
    ? missing("fill_geometry_pct", "도형 확인 사업률", "%", "d24-geometry-fill@1:도형 있는 고유 사업÷반경 내 고유 사업")
    : obs("fill_geometry_pct", "도형 확인 사업률", pct(geometryProjects, projects.size), "%", "d24-geometry-fill@1:도형 있는 고유 사업÷반경 내 고유 사업", geometryProjects, projects.size);
  const metrics: TileDraft["metrics"] = [
    ...STAGE_LABELS.map((stage, index) => obs(`back_stage_${index}`, `단계: ${stage}`, stageCounts.get(stage) ?? 0, "건", "d24-stage@1:반경 안 선형 또는 계획역이 든 고유 사업")),
    obs("back_stations", "반경 내 계획역", stations.length, "역", "d24-stations@1:반경 안 계획역 지점 수"),
    obs("line_length_in_radius_m", "반경 안 계획 선형 길이", lineLength, "m", "d24-line-length@1:선분과 반경 원이 교차하는 실제 길이 합"),
    geometryMetric,
    obs("fill_schedule_pct", "일정 확인률", 0, "%", "d24-schedule@0:원천에 일정 없음", 0, projects.size),
  ];

  const map: MapCandidate[] = [];
  const lineCandidates: LineCandidate[] = [];
  for (const line of lines) {
    const label = line.properties.sourceType === "approximation" ? "[개략]" : null;
    for (const path of clipLineToCircle(ctx.input.center, radiusM, line.geometry)) {
      const clipped = lineCandidate(line.featureId, "planned_rail_line", path, linePathLength(path), label);
      if (clipped) lineCandidates.push(clipped);
    }
  }
  const nearestStation = nearestHit(stations);
  for (const station of stations) {
    map.push(candidate(station, "planned_rail_station", station === nearestStation ? { highlight: true, label: `직선 ${Math.round(station.distanceM ?? 0)}m` } : {}));
  }

  const sentence = projects.size === 0
    ? "반경 안 등록 계획 철도 사업 없음 → 공개 등록 목록 기준이며 계획이 없다는 뜻은 아님 → 관계 기관 자료 확인 필요"
    : `${approx ? "개략 선형 포함: " : ""}반경 안 계획 철도 사업 ${projects.size}건(${stageText}), 계획역 ${stations.length}곳, 반경 안 선형 ${lineLength}m → 운영 철도와 합산하지 않으며 일정 확인률은 원천 부재로 0% → 노선·단계·일정은 관계 기관 원문 확인 필요`;

  return makeTile(ctx, {
    code: "D24",
    status: "partial",
    metrics,
    judgment: { ruleId: "D24-planned-rail@1", basisMetricIds: ["back_stations", "line_length_in_radius_m"], sentence, level: null, criteria: null },
    sources,
    layers: ["planned_rail_line", "planned_rail_station"],
    map,
    lines: lineCandidates,
    limitations: [
      { kind: "partial", note: `공개 계획 철도 목록이 일부(${total}건)만 포함` },
      ...(approx ? [{ kind: "estimated" as const, note: "[개략] 선형은 보조 지오메트리이며 확정 노선처럼 해석하지 않습니다." }] : []),
      { kind: "not_provided", note: "일정은 원천에 없어 일정 확인률을 0%로 표시합니다." },
      ...ctx.coverage("reference", ["planned_rail"]),
    ],
  });
}

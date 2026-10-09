/** D23 정비사업 — 정비구역 경계와 사업 단계별 분포. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import {
  candidate,
  fmt,
  makeTile,
  missing,
  obs,
  polygonCandidate,
  type MapCandidate,
  type PolygonCandidate,
  type TileDraft,
} from "../../engine/tiles/common";
import { collectMaintenance, collectMaintenanceRoster, maintenanceSourceIds, maintenanceSources, STAGES, type Project } from "./engine";
import { notProvided } from "../../engine/tiles/not-provided";

const SOURCE_KEYS = ["market", "reference"] as const;

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

function stageCounts(projects: readonly Project[]): number[] {
  return STAGES.map((stage) => projects.filter((project) => project.stage === stage).length);
}

function stageText(projects: readonly Project[]): string {
  const counts = stageCounts(projects);
  return STAGES
    .map((stage, i) => [stage, counts[i]] as const)
    .filter(([, count]) => count > 0)
    .map(([stage, count]) => `${stage} ${count}건`)
    .join(", ");
}

function plannedHouseholds(projects: readonly Project[]): TileDraft["metrics"][number] {
  const known = projects.filter((project) => project.households !== null);
  if (known.length === 0) return missing("planned_households", "예정 세대(알려진 사업만)", "세대", "a09-households@1:세대수가 있는 사업 없음");
  const total = known.reduce((sum, project) => sum + (project.households as number), 0);
  return obs(
    "planned_households",
    "예정 세대(알려진 사업만)",
    total,
    "세대",
    "a09-households@1:세대수가 있는 사업만 합산, 반경 내부 배분값 아님",
    known.length,
    projects.length,
  );
}

function stageMetrics(projects: readonly Project[]): TileDraft["metrics"] {
  const counts = stageCounts(projects);
  return STAGES.map((stage, i) => obs(`back_stage_${i}`, `단계: ${stage}`, counts[i], "건", "d23-stage@1:반경 관련 고유 사업의 단계별 건수"));
}

function fillMetric(
  id: string,
  label: string,
  numerator: number,
  denominator: number,
  formulaVersion: string,
): TileDraft["metrics"][number] {
  if (denominator === 0) return missing(id, label, "%", `${formulaVersion}:분모 0`);
  return obs(id, label, pct(numerator, denominator), "%", formulaVersion, numerator, denominator);
}

function coverageLimitations(ctx: EngineContext): TileDraft["limitations"] {
  return SOURCE_KEYS
    .filter((key) => ctx.sources(key, maintenanceSourceIds(ctx, key)).length > 0)
    .flatMap((key) => ctx.coverage(key, maintenanceSourceIds(ctx, key)))
    .filter((limitation, i, all) => all.findIndex((other) => other.note === limitation.note) === i);
}

function baseMetrics(ctx: EngineContext, projects: readonly Project[], boundaryProjects: number, boundaryDenominator: number, zoneArea: number | null): TileDraft["metrics"] {
  const stageKnown = projects.filter((project) => project.stage !== "미확인").length;
  return [
    ...stageMetrics(projects),
    fillMetric("fill_boundary_pct", "경계 확인 사업 / 반경 걸친 시군구 명부", boundaryProjects, boundaryDenominator, "d23-boundary-fill@1:경계가 있는 고유 사업÷반경 걸친 시군구 명부 사업"),
    fillMetric("fill_stage_pct", "단계 확인 사업", stageKnown, projects.length, "d23-stage-fill@1:미확인 이외 단계 사업÷반경 관련 고유 사업"),
    zoneArea === null
      ? missing("zone_area_in_radius_m2", "반경과 교차하는 정비구역 면적 합", "㎡", "d23-zone-area@1:EPSG:5179 교차 면적 합")
      : obs("zone_area_in_radius_m2", "반경과 교차하는 정비구역 면적 합", zoneArea, "㎡", "d23-zone-area@1:EPSG:5179 교차 면적 합, 구역 간 중첩 미제거", zoneArea, null),
    plannedHouseholds(projects),
  ];
}

function rosterOnly(ctx: EngineContext, sources: ReturnType<typeof maintenanceSources>): TileResult {
  const projects = collectMaintenanceRoster(ctx);
  const areas = ctx.sigungu();
  const metrics = baseMetrics(ctx, projects, 0, projects.length, 0);
  const areaText = areas.map((area) => area.name).filter(Boolean).join("·") || "해당 시군구";
  const sentence = projects.length === 0
    ? `${areaText} 명부에 정비사업 없음 → 경계가 없어 반경 안 여부는 원래 알 수 없고 명부가 일부일 수 있음 → 지자체 고시 확인 필요`
    : `${areaText} 정비사업 명부 ${projects.length}건(${stageText(projects)}), 경계 미확보 → 단계와 명부 건수만 확인하고 반경 내 면적은 산출하지 않음 → 지자체 고시와 구역 경계 확인 필요`;
  return makeTile(ctx, {
    code: "D23",
    type: "diagram",
    status: "partial",
    metrics,
    judgment: { ruleId: "D23-maintenance-roster@1", basisMetricIds: ["fill_boundary_pct", "fill_stage_pct"], sentence, level: null, criteria: null },
    sources,
    layers: [],
    limitations: [
      { kind: "not_provided", note: "정비구역 경계 미확보 — 반경 내 여부와 면적 미확인, 시군구 단위 명부만 표시합니다." },
      { kind: "unknown", note: "예정 세대는 사업 전체 값이며 반경 안 배분값이 아닙니다. 세대수가 없는 사업은 합산에서 빠집니다." },
      ...coverageLimitations(ctx),
    ],
  });
}

export function d23(ctx: EngineContext): TileResult {
  const collection = collectMaintenance(ctx);
  const sources = maintenanceSources(ctx);
  if (!collection) {
    if (sources.length === 0) return notProvided(ctx, "D23");
    return rosterOnly(ctx, sources);
  }

  const { zones, projects: projectMap, zoneProject, linked } = collection;
  const projects = [...projectMap.values()];
  const roster = collectMaintenanceRoster(ctx);
  const points: MapCandidate[] = [];
  const polygons: PolygonCandidate[] = [];
  const layers: string[] = [];
  let zoneArea = 0;
  let invalidArea = false;
  const order = [...zones].sort((a, b) => a.featureId - b.featureId);
  const labelled = new Set(order.slice(0, 5).map((zone) => zone.featureId));

  for (const zone of order) {
    const project = projectMap.get(zoneProject.get(zone.featureId) ?? "");
    const stage = project?.stage ?? "미확인";
    const layer = `maint_stage:${stage}`;
    const label = `${project?.name ?? zone.name ?? "이름 없음"} ${stage}`;
    if (!layers.includes(layer)) layers.push(layer);
    points.push(candidate(zone, layer, labelled.has(zone.featureId) ? { label } : {}));

    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, zone.geometry);
    if (!clipped) {
      invalidArea = true;
      continue;
    }
    zoneArea += clipped.areaM2;
    for (const rings of clipped.parts) {
      const polygon = polygonCandidate(zone.featureId, layer, rings, polygonArea(rings), label);
      if (polygon) polygons.push(polygon);
    }
  }

  const limitations: TileDraft["limitations"] = [
    { kind: "partial", note: "경계가 확보된 사업만 반경 안 여부와 면적을 판단합니다. 경계가 없는 명부 사업은 면적에 포함하지 않았습니다." },
    { kind: "unknown", note: "정비구역 간 면적은 합치지 않아 중첩될 수 있습니다." },
    { kind: "unknown", note: "예정 세대는 사업 전체 값이며 반경 안 배분값이 아닙니다." },
    ...(zones.length > 0 && linked < zones.length ? [{ kind: "unknown" as const, note: `사업 연결(zone_of_project)이 없는 구역 ${zones.length - linked}곳은 구역 속성으로 단계·유형을 표시합니다.` }] : []),
    ...(invalidArea ? [{ kind: "unknown" as const, note: "일부 정비구역 도형의 반경 교차 면적을 계산하지 못했습니다." }] : []),
    ...coverageLimitations(ctx),
  ];
  const sentence = projects.length === 0
    ? "반경과 교차하는 확인된 정비구역 없음 → 경계가 확보된 사업 기준이며 없다는 단정은 아님 → 최신 고시는 지자체 확인 필요"
    : `반경과 교차하는 정비구역 ${zones.length}곳(사업 ${projects.length}건: ${stageText(projects)}), 경계 면적 ${fmt(Math.round(zoneArea))}㎡ → 단계별 고유 사업 수와 중첩 가능한 경계 면적을 분리해 표시 → 최신 고시와 사업별 경계·단계 확인 필요`;

  return makeTile(ctx, {
    code: "D23",
    type: "diagram",
    status: "partial",
    metrics: baseMetrics(ctx, projects, projects.length, roster.length, invalidArea ? null : Math.round(zoneArea)),
    judgment: { ruleId: "D23-maintenance@1", basisMetricIds: ["fill_boundary_pct", "fill_stage_pct", "zone_area_in_radius_m2"], sentence, level: null, criteria: null },
    sources,
    layers,
    map: points,
    polygons,
    limitations,
  });
}

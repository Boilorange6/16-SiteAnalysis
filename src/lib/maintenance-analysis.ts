import type { MaintenanceProject, MaintenanceStage } from "./types";
import { isRawPoiId } from "./poi-id-guard";

export interface MaintenanceSummary {
  readonly count: number;
  readonly totalAreaSqm: number;
  readonly boundaryConfirmedCount: number;
  readonly typeCounts: Record<string, number>;
  readonly stageCounts: Record<MaintenanceStage, number>;
  readonly topProjects: readonly MaintenanceProject[];
}

const STAGES: readonly MaintenanceStage[] = [
  "구역지정/변경",
  "추진위",
  "조합설립",
  "사업시행인가",
  "관리처분",
  "착공",
  "준공",
  "미확인",
];

export function formatMaintenanceArea(areaSqm: number): string {
  if (!areaSqm || areaSqm <= 0) return "미확인";
  if (areaSqm >= 10_000) return `${(areaSqm / 10_000).toFixed(areaSqm >= 100_000 ? 1 : 2)}만㎡`;
  return `${Math.round(areaSqm).toLocaleString()}㎡`;
}

export function summarizeMaintenanceProjects(projects: readonly MaintenanceProject[]): MaintenanceSummary {
  const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<MaintenanceStage, number>;
  const typeCounts: Record<string, number> = {};

  for (const project of projects) {
    stageCounts[project.stage] += 1;
    const type = project.type || "미확인";
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  }

  // P4R Task B-1: 원시 ID 이름 사업은 "주요 사업" 표시 후보에서 제외한다. count·typeCounts·
  // stageCounts·boundaryConfirmedCount 등 집계는 위에서 이미 원본 projects 배열 기준으로 계산했으므로
  // 영향 없음.
  const topProjects = [...projects]
    .filter((project) => !isRawPoiId(project.name))
    .sort((a, b) => {
      const areaDelta = (b.area_sqm || 0) - (a.area_sqm || 0);
      if (areaDelta !== 0) return areaDelta;
      return (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity);
    })
    .slice(0, 8);

  return {
    count: projects.length,
    totalAreaSqm: projects.reduce((sum, project) => sum + Math.max(0, project.area_sqm || 0), 0),
    boundaryConfirmedCount: projects.filter((project) => project.boundary_status === "confirmed").length,
    typeCounts,
    stageCounts,
    topProjects,
  };
}

export function buildMaintenanceDetailLines(projects: readonly MaintenanceProject[], limit = 8): string[] {
  const summary = summarizeMaintenanceProjects(projects);
  if (summary.count === 0) return ["반경 내 정비사업 미확인"];

  const typeSummary = Object.entries(summary.typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, count]) => `${type} ${count}건`)
    .join(" / ");

  const lines = [
    `정비사업 ${summary.count}건${summary.totalAreaSqm > 0 ? `, 총 ${formatMaintenanceArea(summary.totalAreaSqm)}` : ""}`,
    typeSummary ? `유형: ${typeSummary}` : "유형: 미확인",
    `경계 확인 ${summary.boundaryConfirmedCount}건 / 미확인 ${summary.count - summary.boundaryConfirmedCount}건`,
  ];

  for (const project of summary.topProjects) {
    if (lines.length >= limit) break;
    const area = project.area_sqm > 0 ? `, ${formatMaintenanceArea(project.area_sqm)}` : "";
    const distance = project.distance_m != null ? `, ${Math.round(project.distance_m).toLocaleString()}m` : "";
    lines.push(`${project.name} (${project.stage}${area}${distance})`);
  }

  return lines.slice(0, limit);
}

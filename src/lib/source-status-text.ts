import { MAINTENANCE_SOURCE_IDS, POI_SOURCE_LABELS, type SourceStatus } from "@/lib/types";

function sourceStatusLine(status: SourceStatus): string {
  const label = POI_SOURCE_LABELS[status.source];
  if (status.status === "failed") return `${label}: 수집 실패 — 본 보고서에 누락`;
  const d = new Date(status.fetchedAt ?? Date.now());
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${label}: ${ymd} 수집`;
}

/** "지하철역·학교·산: 2026-07-12 수집" | "공원: 수집 실패 — 본 보고서에 누락" */
export function sourceStatusLines(statuses: readonly SourceStatus[]): string[] {
  return statuses.map(sourceStatusLine);
}

export function generalSourceStatusLines(statuses: readonly SourceStatus[]): string[] {
  const maintenanceSources = new Set<string>(MAINTENANCE_SOURCE_IDS);
  return statuses.filter(({ source }) => !maintenanceSources.has(source)).map(sourceStatusLine);
}

export function maintenanceSourceStatusLines(statuses: readonly SourceStatus[]): string[] {
  return MAINTENANCE_SOURCE_IDS.map((source) => {
    const status = statuses.find((candidate) => candidate.source === source);
    return status ? sourceStatusLine(status) : `${POI_SOURCE_LABELS[source]}: 상태 미제공`;
  });
}

export function hasFailedSource(statuses: readonly SourceStatus[]): boolean {
  return statuses.some((s) => s.status === "failed");
}

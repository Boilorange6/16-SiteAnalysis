import {
  MAINTENANCE_SOURCE_IDS,
  POI_SOURCE_LABELS,
  type Poi,
  type PoiSourceId,
  type SourceStatus,
} from "@/lib/types";

export const PARK_DATA_UNAVAILABLE_NOTICE = "공원 데이터 수집 실패 · 산출 제외";
const STATUS_PRIORITY: Readonly<Record<SourceStatus["status"], number>> = {
  failed: 0,
  cached: 1,
  fresh: 2,
};

export function dedupeSourceStatuses(statuses: readonly SourceStatus[]): SourceStatus[] {
  const selected = new Map<PoiSourceId, SourceStatus>();
  for (const candidate of statuses) {
    const current = selected.get(candidate.source);
    const candidateTime = candidate.fetchedAt ?? Number.NEGATIVE_INFINITY;
    const currentTime = current?.fetchedAt ?? Number.NEGATIVE_INFINITY;
    if (!current || candidateTime > currentTime ||
      (candidateTime === currentTime && STATUS_PRIORITY[candidate.status] > STATUS_PRIORITY[current.status])) {
      selected.set(candidate.source, candidate);
    }
  }
  return [...selected.values()];
}

function sourceStatusLine(status: SourceStatus): string {
  const label = POI_SOURCE_LABELS[status.source];
  if (status.status === "failed") return `${label}: 수집 실패 — 본 보고서에 누락`;
  const d = new Date(status.fetchedAt ?? Date.now());
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${label}: ${ymd} 수집`;
}

/** "지하철역·학교·산: 2026-07-12 수집" | "공원: 수집 실패 — 본 보고서에 누락" */
export function sourceStatusLines(statuses: readonly SourceStatus[]): string[] {
  return dedupeSourceStatuses(statuses).map(sourceStatusLine);
}

export function generalSourceStatusLines(statuses: readonly SourceStatus[]): string[] {
  const maintenanceSources = new Set<string>(MAINTENANCE_SOURCE_IDS);
  return dedupeSourceStatuses(statuses).filter(({ source }) => !maintenanceSources.has(source)).map(sourceStatusLine);
}

export function maintenanceSourceStatusLines(statuses: readonly SourceStatus[]): string[] {
  const deduped = dedupeSourceStatuses(statuses);
  return MAINTENANCE_SOURCE_IDS.map((source) => {
    const status = deduped.find((candidate) => candidate.source === source);
    return status ? sourceStatusLine(status) : `${POI_SOURCE_LABELS[source]}: 상태 미제공`;
  });
}

export function hasFailedSource(statuses: readonly SourceStatus[]): boolean {
  return dedupeSourceStatuses(statuses).some((s) => s.status === "failed");
}

export function isSourceFailed(statuses: readonly SourceStatus[], source: PoiSourceId): boolean {
  return dedupeSourceStatuses(statuses).some((status) => status.source === source && status.status === "failed");
}

export type RadiusMetricLabel = "역" | "학교" | "공원" | "정비";

export function radiusMetricLabels(statuses: readonly SourceStatus[]): readonly RadiusMetricLabel[] {
  return isSourceFailed(statuses, "park") ? ["역", "학교", "정비"] : ["역", "학교", "공원", "정비"];
}

export function radiusLifestyleNote(statuses: readonly SourceStatus[]): string {
  return isSourceFailed(statuses, "park")
    ? "통학·역세권을 함께 판단"
    : "통학·공원·역세권을 함께 판단";
}

export function reportPoisForSourceStatuses(
  pois: readonly Poi[],
  statuses: readonly SourceStatus[],
): readonly Poi[] {
  return isSourceFailed(statuses, "park")
    ? pois.filter((poi) => poi.category !== "park")
    : pois;
}

import { POI_SOURCE_LABELS, type SourceStatus } from "@/lib/types";

/** "지하철역·학교·산: 2026-07-12 수집" | "공원: 수집 실패 — 본 보고서에 누락" */
export function sourceStatusLines(statuses: readonly SourceStatus[]): string[] {
  return statuses.map((s) => {
    const label = POI_SOURCE_LABELS[s.source];
    if (s.status === "failed") return `${label}: 수집 실패 — 본 보고서에 누락`;
    const d = new Date(s.fetchedAt ?? Date.now());
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `${label}: ${ymd} 수집`;
  });
}

export function hasFailedSource(statuses: readonly SourceStatus[]): boolean {
  return statuses.some((s) => s.status === "failed");
}

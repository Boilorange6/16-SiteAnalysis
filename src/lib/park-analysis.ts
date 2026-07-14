import type { Park, ParkQuality } from "./types";
import { firstDisplayable, isRawPoiId } from "./poi-id-guard";

export interface ParkSummary {
  readonly count: number;
  readonly totalAreaSqm: number;
  readonly nearby500Count: number;
  readonly majorCount: number;
  readonly nearestPark?: Park;
  readonly largestPark?: Park;
  readonly qualityCounts: Record<ParkQuality, number>;
  readonly accessibilityScore: number;
}

export function formatAreaSqm(areaSqm: number): string {
  if (areaSqm >= 1_000_000) return `${(areaSqm / 1_000_000).toFixed(1)}㎢`;
  if (areaSqm >= 10_000) return `${Math.round(areaSqm / 10_000 * 10) / 10}만㎡`;
  return `${Math.round(areaSqm).toLocaleString()}㎡`;
}

export function formatDistanceM(distanceM: number): string {
  if (distanceM >= 1000) return `${(distanceM / 1000).toFixed(1)}km`;
  return `${Math.round(distanceM).toLocaleString()}m`;
}

export function summarizeParks(parks: readonly Park[]): ParkSummary {
  const qualityCounts: Record<ParkQuality, number> = {
    major: 0,
    neighborhood: 0,
    children: 0,
    small: 0,
    green: 0,
    unknown: 0,
  };

  for (const park of parks) {
    qualityCounts[park.quality ?? "unknown"] += 1;
  }

  const totalAreaSqm = parks.reduce((sum, park) => sum + Math.max(0, park.area_sqm || 0), 0);
  const sortedByAccess = [...parks].sort(
    (a, b) => (a.access_distance_m ?? a.distance_m ?? Infinity) - (b.access_distance_m ?? b.distance_m ?? Infinity)
  );
  const sortedByArea = [...parks].sort((a, b) => (b.area_sqm || 0) - (a.area_sqm || 0));
  const nearby500Count = parks.filter((park) => (park.access_distance_m ?? park.distance_m ?? Infinity) <= 500).length;
  const majorCount = parks.filter((park) => (park.quality === "major" || (park.area_sqm || 0) >= 100_000)).length;

  const accessScore = Math.min(45, nearby500Count * 12)
    + Math.min(30, Math.log10(Math.max(totalAreaSqm, 1)) * 6)
    + Math.min(25, majorCount * 10 + qualityCounts.neighborhood * 3);

  return {
    count: parks.length,
    totalAreaSqm,
    nearby500Count,
    majorCount,
    // P4R Task B-1: 원시 ID 이름 공원은 "최근접/최대" 표시 후보에서 제외하고 다음 후보로 넘어간다.
    // count·totalAreaSqm 등 집계는 위에서 이미 원본 parks 배열 기준으로 계산을 마쳤으므로 영향 없음.
    nearestPark: firstDisplayable(sortedByAccess),
    largestPark: firstDisplayable(sortedByArea),
    qualityCounts,
    accessibilityScore: Math.max(0, Math.min(100, Math.round(accessScore))),
  };
}

export function buildParkDetailLines(parks: readonly Park[], limit = 8): string[] {
  const summary = summarizeParks(parks);
  const lines: string[] = [
    `공원 ${summary.count}개 / 총 면적 ${formatAreaSqm(summary.totalAreaSqm)}`,
    `500m 내 생활권 공원 ${summary.nearby500Count}개 / 대형공원 ${summary.majorCount}개`,
  ];
  if (summary.nearestPark) {
    lines.push(`최근접 ${summary.nearestPark.name} (${formatDistanceM(summary.nearestPark.access_distance_m ?? summary.nearestPark.distance_m ?? 0)})`);
  }
  if (summary.largestPark && summary.largestPark.area_sqm > 0) {
    lines.push(`최대 ${summary.largestPark.name} (${formatAreaSqm(summary.largestPark.area_sqm)})`);
  }
  lines.push(`공원 접근성 점수 ${summary.accessibilityScore}/100`);

  const featured = [...parks]
    .filter((park) => !isRawPoiId(park.name))
    .sort((a, b) => (b.area_sqm || 0) - (a.area_sqm || 0))
    .slice(0, Math.max(0, limit - lines.length))
    .map((park) => `${park.name}${park.park_type ? ` (${park.park_type})` : ""}`);
  return [...lines, ...featured].slice(0, limit);
}

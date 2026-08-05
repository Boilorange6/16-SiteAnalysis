import {
  MAINTENANCE_SOURCE_IDS,
  POI_SOURCE_CATEGORIES,
  POI_SOURCE_LABELS,
  type Poi,
  type PoiCategory,
  type PoiSourceId,
  type SourceStatus,
} from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1_000;

/** "오늘" | "3일 전" | "시점 미상" — 데이터 연령을 사람이 읽는 문구로 */
export function describeSourceAge(fetchedAt: number | null, now: number = Date.now()): string {
  if (fetchedAt === null) return "시점 미상";
  const days = Math.floor((now - fetchedAt) / DAY_MS);
  return days <= 0 ? "오늘" : `${days}일 전`;
}

/** 보고서 섹션별 결측 안내 — "없음"과 "수집하지 못함"을 구분한다 */
export const MISSING_DATA_NOTICES: Readonly<Record<PoiCategory, string>> = {
  subway: "지하철 데이터 수집 실패 · 산출 제외",
  school: "학교 데이터 수집 실패 · 산출 제외",
  park: "공원 데이터 수집 실패 · 산출 제외",
  mountain: "산·녹지 데이터 수집 실패 · 산출 제외",
  apartment: "주거 단지 데이터 수집 실패 · 산출 제외",
  officetel: "오피스텔 데이터 수집 실패 · 산출 제외",
  residential: "주거 데이터 수집 실패 · 산출 제외",
  maintenance: "정비사업 데이터 수집 실패 · 산출 제외",
};

/** 실패한 원천이 담당하던 카테고리에 결측 안내를 매핑한다 */
export function missingSectionNotices(
  statuses: readonly SourceStatus[],
): Partial<Record<PoiCategory, string>> {
  const notices: Partial<Record<PoiCategory, string>> = {};
  for (const category of fullyMissingCategories(statuses)) {
    notices[category] = MISSING_DATA_NOTICES[category];
  }
  return notices;
}

/**
 * 소스 코드명이 아니라 사용자가 읽을 수 있는 실패 안내로 바꾼다.
 *
 * 같은 배열에 실패가 아닌 안내도 들어온다("종료된 정비사업 4건 제외(...)").
 * 전부 실패로 감싸는 바람에 운영 화면에 이런 문장이 떴다 —
 * "종료된 정비사업 4건 제외(...) 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
 * 아무것도 안 깨졌는데 깨진 것처럼 보인다. 아는 소스 코드명만 감싼다.
 */
export function failedSourceMessages(sources: readonly string[]): string[] {
  return sources.map((source) => {
    const label = POI_SOURCE_LABELS[source as PoiSourceId];
    if (!label) return source;
    return `${label} 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.`;
  });
}

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

function sourceStatusLine(status: SourceStatus, now: number = Date.now()): string {
  const label = POI_SOURCE_LABELS[status.source];
  if (status.status === "failed") return `${label}: 수집 실패 — 본 보고서에 누락`;
  const d = new Date(status.fetchedAt ?? now);
  const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  // 만료 캐시를 정상 캐시처럼 보이게 하지 않는다 — 연령과 사유를 함께 밝힌다
  if (status.stale) {
    return `${label}: ${ymd} 수집 (${describeSourceAge(status.fetchedAt, now)}) — 원천 장애로 저장본 사용`;
  }
  return `${label}: ${ymd} 수집`;
}

/** "지하철역·학교·산: 2026-07-12 수집" | "공원: 수집 실패 — 본 보고서에 누락" */
export function sourceStatusLines(
  statuses: readonly SourceStatus[],
  options: { readonly now?: number } = {},
): string[] {
  return dedupeSourceStatuses(statuses).map((status) => sourceStatusLine(status, options.now));
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

/**
 * 그 카테고리를 담당하는 원천이 **전부** 실패했을 때만 산출에서 제외한다.
 * 정비사업처럼 원천이 여러 개인 카테고리는 하나가 실패해도 나머지 결과가 유효하므로
 * 통째로 지우면 오히려 정보를 잃는다.
 */
export function fullyMissingCategories(statuses: readonly SourceStatus[]): Set<PoiCategory> {
  const total = new Map<PoiCategory, number>();
  const failed = new Map<PoiCategory, number>();
  for (const status of dedupeSourceStatuses(statuses)) {
    for (const category of POI_SOURCE_CATEGORIES[status.source] ?? []) {
      total.set(category, (total.get(category) ?? 0) + 1);
      if (status.status === "failed") failed.set(category, (failed.get(category) ?? 0) + 1);
    }
  }
  const missing = new Set<PoiCategory>();
  for (const [category, count] of total) {
    if (count > 0 && failed.get(category) === count) missing.add(category);
  }
  return missing;
}

/**
 * 수집하지 못한 카테고리의 POI를 보고서 산출에서 제외한다.
 * 기존에는 공원만 처리해, 다른 원천이 실패하면 빈 결과가 "시설 없음"처럼 보였다.
 */
export function reportPoisForSourceStatuses(
  pois: readonly Poi[],
  statuses: readonly SourceStatus[],
): readonly Poi[] {
  const excluded = fullyMissingCategories(statuses);
  if (!excluded.size) return pois;
  return pois.filter((poi) => !excluded.has(poi.category));
}

/**
 * PPT 데이터 슬라이드 하단 각주 — 원천별 기준일을 한 줄로 통일한다.
 * "실거래 2026-07 기준 · 정비사업 2026-07-22 기준"처럼 보고서를 받는 쪽이
 * 언제 시점의 데이터인지 한눈에 알 수 있게 한다.
 */
export function dataAsOfFootnote(
  statuses: readonly SourceStatus[],
  options: { readonly now?: number } = {},
): string {
  const now = options.now ?? Date.now();
  const parts = dedupeSourceStatuses(statuses).map((status) => {
    const label = POI_SOURCE_LABELS[status.source] ?? status.source;
    if (status.status === "failed") return `${label} 수집 실패`;
    const d = new Date(status.fetchedAt ?? now);
    const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    return status.stale ? `${label} ${ymd} 기준(저장본)` : `${label} ${ymd} 기준`;
  });
  return parts.join(" · ");
}

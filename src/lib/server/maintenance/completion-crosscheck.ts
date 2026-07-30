import { booleanPointInPolygon, multiPolygon, point, polygon } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import type { MaintenanceProject, Poi, ResidentialPoi } from "../../types";
import { LEDGER_CHECK_STAGE_PATTERN } from "./building-ledger";

/**
 * 신축 준공 교차검증: 정비구역 폴리곤 안에 최근 사용승인된 대단지(건축물대장 주거 POI)가
 * 있으면 사업이 완료된 것으로 보고 지도에서 제외한다.
 * 재건축 완료 시 신축이 새 지번을 받아 옛 대표지번 기반 건축물대장 조회가 실패하는
 * 사례(예: 개포주공1단지 → 디에이치 퍼스티어 아이파크)를 잡는다.
 */
const MIN_COMPLETED_UNITS = 200;
const DEFAULT_COMPLETION_YEAR_THRESHOLD = 2018;

function boundaryFeature(project: MaintenanceProject): Feature<Polygon | MultiPolygon> | null {
  const boundary = project.boundary;
  if (!boundary) return null;
  return boundary.type === "Polygon"
    ? polygon(boundary.coordinates.map((ring) => ring.map(([lng, lat]) => [lng, lat])))
    : multiPolygon(boundary.coordinates.map((part) => part.map((ring) => ring.map(([lng, lat]) => [lng, lat]))));
}

function saleYear(poi: ResidentialPoi): number | null {
  const year = Number(poi.sale_date.slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : null;
}

function isExistingLargeComplex(poi: Poi): poi is ResidentialPoi {
  return (poi.category === "apartment" || poi.category === "officetel" || poi.category === "residential")
    && (poi as ResidentialPoi).status === "existing"
    && (poi as ResidentialPoi).units >= MIN_COMPLETED_UNITS;
}

export interface CompletionCrossCheckResult {
  readonly pois: readonly Poi[];
  readonly removedCount: number;
}

export function crossCheckMaintenanceCompletion(pois: readonly Poi[]): CompletionCrossCheckResult {
  const complexes = pois.filter(isExistingLargeComplex);
  if (!complexes.length) return { pois, removedCount: 0 };
  let removedCount = 0;
  const kept = pois.filter((poi) => {
    if (poi.category !== "maintenance") return true;
    const project = poi as MaintenanceProject;
    if (!project.stage_detail || !LEDGER_CHECK_STAGE_PATTERN.test(project.stage_detail)) return true;
    const feature = boundaryFeature(project);
    if (!feature) return true;
    const designationYear = Number(project.designation_date?.slice(0, 4));
    const threshold = Number.isFinite(designationYear) && designationYear > 1900
      ? designationYear
      : DEFAULT_COMPLETION_YEAR_THRESHOLD;
    const completed = complexes.some((complex) => {
      const year = saleYear(complex);
      return year !== null && year >= threshold
        && booleanPointInPolygon(point([complex.lng, complex.lat]), feature);
    });
    if (completed) removedCount += 1;
    return !completed;
  });
  return { pois: kept, removedCount };
}

import { formatMaintenanceArea } from "./maintenance-analysis";
import type { AnalysisConfig, MaintenanceProject, MaintenanceSource, RadiusPosition } from "./types";

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface MaintenancePresentationRow {
  readonly name: string;
  readonly typeStage: string;
  readonly implementer: string;
  readonly households: string;
  readonly areaDistance: string;
  readonly boundary: string;
  readonly sourceDate: string;
}

export interface MaintenancePresentationSource {
  readonly id: string;
  readonly title: string;
  readonly value: string;
  readonly detail: string;
}

export interface ProjectedMaintenancePoint {
  readonly nx: number;
  readonly ny: number;
}

export interface ProjectedMaintenanceBoundary {
  readonly projectId: string;
  readonly status: "confirmed" | "unmatched";
  readonly label: string;
  readonly labelPoint: ProjectedMaintenancePoint;
  readonly polygons: readonly (readonly (readonly ProjectedMaintenancePoint[])[])[];
}

export const MAINTENANCE_PRESENTATION_COLUMNS = [
  "구역명",
  "유형·단계",
  "시행자",
  "예정세대수",
  "면적·거리",
  "경계",
  "출처·기준일",
] as const;

export const MAINTENANCE_BOUNDARY_LEGEND = "공식 정비구역 경계 · 참고용";
export const MAINTENANCE_LEGAL_FOOTER = "법적 효력 없는 참고자료";
export const SYNTHETIC_REPORT_NOTICE = "합성 구조검증 데이터 · 실데이터 아님";
export const SYNTHETIC_BANNER_FILL = "#C4006F";

export function maintenanceBoundaryInfoLabel(project: MaintenanceProject): string {
  const sourceDate = project.source_updated_at || project.boundary_retrieved_at || "미확인";
  return `단계: ${project.stage} · 기준일: ${sourceDate}`;
}

export function compactMaintenanceBoundaryLabel(label: string): string {
  return label.replace(/^단계:\s*/u, "").replace(/\s*·\s*기준일:\s*/u, " · ");
}

export function formatMaintenanceTableName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const finalToken = parts.at(-1) ?? "";
  return finalToken.length >= 5 ? `${parts.slice(0, -1).join(" ")}\n${finalToken}` : name;
}

export function formatReportPoiCount(pois: readonly unknown[]): string {
  return `${pois.length.toLocaleString()}개 POI`;
}

export const MAINTENANCE_PRESENTATION_TYPOGRAPHY = {
  mapBulletPt: 14,
  insightPt: 13,
  tableHeaderPt: 12,
  tableBodyPt: 12,
  sourceLabelPt: 11,
  sourceValuePt: 15,
  sourceDetailPt: 11,
  cautionPt: 11,
  statusPt: 11,
  legalFooterPt: 9.5,
} as const;

export const GENERAL_PRESENTATION_SOURCES = [
  { id: "naver", title: "주소/지도", value: "Naver API", detail: "지오코딩·지도 표시·검색 좌표 기준" },
  { id: "poi", title: "교통/POI", value: "Naver + OSM", detail: "지하철·생활 POI·보조 경로 데이터" },
  { id: "park", title: "공원/녹지", value: "공공데이터 + OSM", detail: "도시공원 면적, 경계 좌표 보조" },
  { id: "maintenance", title: "정비사업", value: "공공 고시 데이터", detail: "전국·지역 정비사업 속성 보강" },
  { id: "residential", title: "주거 공급", value: "대장/분양 정보", detail: "세대수, 주차, 분양·입주 일정" },
  { id: "analysis", title: "보고서 산출", value: "자동 분석 모델", detail: "거리·개수·면적·단계 기반 점수화" },
] as const satisfies readonly MaintenancePresentationSource[];

export const GENERAL_SOURCE_CAUTIONS = [
  "거리: 기본 직선거리\n공원은 경계 최단거리로 보정",
  "정비사업: 고시 반영 시차 존재\n단계·경계는 원문 재확인",
  "공급 일정·평면도 링크\n원천 공고 변경 여부 확인",
  "점수는 의사결정 보조 지표\n현장·시세·법률 검토 병행",
] as const;

export const MAINTENANCE_PRESENTATION_SOURCES = [
  {
    id: "molit_integrated",
    title: "국토부 전국 통합",
    value: "15160169",
    detail: "전국 기본 목록",
  },
  {
    id: "public_standard",
    title: "전국 표준 API",
    value: "15155703",
    detail: "상세 속성 보강",
  },
  {
    id: "molit_spatial",
    title: "국토부 공식 SHP",
    value: "30335·30336",
    detail: "정비구역 공식 경계",
  },
  {
    id: "seoul_open_data",
    title: "서울 열린데이터",
    value: "upisRebuild",
    detail: "서울 상세 보강",
  },
  {
    id: "busan_data_go_kr",
    title: "부산 정비사업 API",
    value: "지역 상세",
    detail: "부산 상세 속성 보강",
  },
] as const satisfies readonly MaintenancePresentationSource[];

export function formatMaintenanceMapBullet(text: string): string {
  return text.replace(/\s*\([^,]+,\s*([^,]+),\s*([^)]+)\)$/, "\n$1·$2");
}

export function syntheticReportNotice(config: AnalysisConfig): string | null {
  return config.centerName.includes("합성 구조검증") ? SYNTHETIC_REPORT_NOTICE : null;
}

function boundaryRank(project: MaintenanceProject): number {
  return project.boundary_status === "confirmed" ? 0 : 1;
}

function formatHouseholds(value: number | undefined): string {
  return value && value > 0 ? `${value.toLocaleString()}세대` : "미확인";
}

function formatAreaDistance(project: MaintenanceProject): string {
  const area = project.area_sqm > 0 ? formatMaintenanceArea(project.area_sqm) : "면적 미확인";
  const distance = project.distance_m != null && Number.isFinite(project.distance_m)
    ? `${Math.round(Math.max(0, project.distance_m)).toLocaleString()}m`
    : "거리 미확인";
  return `${area}\n${distance}`;
}

function presentationBoundaryLabel(project: MaintenanceProject): string {
  if (project.boundary_status === "confirmed") return "경계 확인";
  if (project.boundary_status === "unmatched") return "경계 미결합";
  return "경계 미확인";
}

function presentationSourceLabel(source: MaintenanceSource): string {
  switch (source) {
    case "molit_integrated": return "국토부 통합";
    case "public_standard": return "전국 표준";
    case "molit_spatial": return "국토부 SHP";
    case "seoul_open_data": return "서울 데이터";
    case "busan_data_go_kr": return "부산 API";
  }
}

function toPresentationRow(project: MaintenanceProject): MaintenancePresentationRow {
  const sourceDate = project.source_updated_at ?? project.boundary_retrieved_at ?? "기준일 미확인";
  return {
    name: project.name,
    typeStage: `${project.type || "유형 미확인"}\n${project.stage}`,
    implementer: project.implementer || "미확인",
    households: formatHouseholds(project.planned_households),
    areaDistance: formatAreaDistance(project),
    boundary: presentationBoundaryLabel(project),
    sourceDate: `${presentationSourceLabel(project.source)}\n${sourceDate}`,
  };
}

export function buildMaintenancePresentationRows(
  projects: readonly MaintenanceProject[],
  limit = 6,
): readonly MaintenancePresentationRow[] {
  const rowLimit = Math.max(0, Math.floor(limit));
  return [...projects]
    .sort((left, right) => {
      const leftDistance = left.distance_m;
      const rightDistance = right.distance_m;
      const leftFinite = Number.isFinite(leftDistance);
      const rightFinite = Number.isFinite(rightDistance);
      if (leftFinite && rightFinite && leftDistance !== rightDistance) return Number(leftDistance) - Number(rightDistance);
      if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
      const boundaryDelta = boundaryRank(left) - boundaryRank(right);
      if (boundaryDelta !== 0) return boundaryDelta;
      return left.name.localeCompare(right.name, "ko");
    })
    .slice(0, rowLimit)
    .map(toPresentationRow);
}

interface BoundaryProjection {
  readonly centerLng: number;
  readonly centerMercatorY: number;
  readonly lngRadiusRad: number;
  readonly northMercatorDelta: number;
  readonly position: RadiusPosition;
}

function mercatorY(latitude: number): number {
  const latitudeRad = latitude * DEG_TO_RAD;
  return Math.log(Math.tan(Math.PI / 4 + latitudeRad / 2));
}

function projectBoundaryPoint(
  coordinate: readonly [number, number],
  projection: BoundaryProjection,
): ProjectedMaintenancePoint {
  const [lng, lat] = coordinate;
  return {
    nx: projection.position.centerNx
      + (((lng - projection.centerLng) * DEG_TO_RAD) / projection.lngRadiusRad) * projection.position.radiusNx,
    ny: projection.position.centerNy
      - ((mercatorY(lat) - projection.centerMercatorY) / projection.northMercatorDelta) * projection.position.radiusNy,
  };
}

function averageProjectedPoints(points: readonly ProjectedMaintenancePoint[]): ProjectedMaintenancePoint {
  if (points.length === 0) return { nx: 0.5, ny: 0.5 };
  return {
    nx: points.reduce((sum, point) => sum + point.nx, 0) / points.length,
    ny: points.reduce((sum, point) => sum + point.ny, 0) / points.length,
  };
}

export function projectMaintenanceBoundaries(
  projects: readonly MaintenanceProject[],
  config: AnalysisConfig,
  radiusPosition: RadiusPosition | null,
): readonly ProjectedMaintenanceBoundary[] {
  const radiusM = config.radiusKm * 1_000;
  if (!radiusPosition || !Number.isFinite(radiusM) || radiusM <= 0) return [];

  const centerLatRad = config.centerLat * DEG_TO_RAD;
  const latRadiusRad = radiusM / EARTH_RADIUS_M;
  const lngRadiusRad = Math.asin(Math.sin(latRadiusRad) / Math.cos(centerLatRad));
  const northLat = config.centerLat + latRadiusRad * RAD_TO_DEG;
  const centerMercatorY = mercatorY(config.centerLat);
  const northMercatorDelta = mercatorY(northLat) - centerMercatorY;
  if (!Number.isFinite(lngRadiusRad) || !Number.isFinite(northMercatorDelta)
    || lngRadiusRad <= 0 || northMercatorDelta <= 0) return [];

  const projection: BoundaryProjection = {
    centerLng: config.centerLng,
    centerMercatorY,
    lngRadiusRad,
    northMercatorDelta,
    position: radiusPosition,
  };
  const projected: ProjectedMaintenanceBoundary[] = [];

  for (const project of projects) {
    if (!project.boundary || project.boundary_status === "unavailable") continue;
    const polygons = project.boundary.type === "Polygon"
      ? [project.boundary.coordinates]
      : project.boundary.coordinates;
    const projectedPolygons = polygons.map((polygon) =>
      polygon.map((ring) => ring.map((coordinate) => projectBoundaryPoint(coordinate, projection))));
    const labelPoint = averageProjectedPoints(projectedPolygons[0]?.[0] ?? []);
    projected.push({
      projectId: project.id,
      status: project.boundary_status,
      label: maintenanceBoundaryInfoLabel(project),
      labelPoint,
      polygons: projectedPolygons,
    });
  }
  return projected;
}

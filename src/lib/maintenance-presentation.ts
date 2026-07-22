import { formatMaintenanceArea } from "./maintenance-analysis";
import { maintenanceBoundaryLabel, maintenanceSourceLabel } from "./maintenance-map-utils";
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
  readonly id: MaintenanceSource;
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

export const MAINTENANCE_BOUNDARY_LEGEND = "정비사업 공식 경계(참고용)";
export const MAINTENANCE_LEGAL_FOOTER = "법적 효력 없는 참고자료";

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
  return `${area} · ${distance}`;
}

function toPresentationRow(project: MaintenanceProject): MaintenancePresentationRow {
  const sourceDate = project.source_updated_at ?? project.boundary_retrieved_at ?? "기준일 미확인";
  return {
    name: project.name,
    typeStage: `${project.type || "유형 미확인"} · ${project.stage}`,
    implementer: project.implementer || "미확인",
    households: formatHouseholds(project.planned_households),
    areaDistance: formatAreaDistance(project),
    boundary: maintenanceBoundaryLabel(project.boundary_status),
    sourceDate: `${maintenanceSourceLabel(project.source)} · ${sourceDate}`,
  };
}

export function buildMaintenancePresentationRows(
  projects: readonly MaintenanceProject[],
  limit = 6,
): readonly MaintenancePresentationRow[] {
  const rowLimit = Math.max(0, Math.floor(limit));
  return [...projects]
    .sort((left, right) => {
      const distanceDelta = (left.distance_m ?? Infinity) - (right.distance_m ?? Infinity);
      if (distanceDelta !== 0) return distanceDelta;
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
    projected.push({
      projectId: project.id,
      status: project.boundary_status,
      polygons: polygons.map((polygon) =>
        polygon.map((ring) => ring.map((coordinate) => projectBoundaryPoint(coordinate, projection)))),
    });
  }
  return projected;
}

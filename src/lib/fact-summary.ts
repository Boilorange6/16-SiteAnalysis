/**
 * 팩트 시트(Task 4)·인사이트 카드(Task 5)가 공유하는 순수 계산 모듈.
 * `SlideRenderInput`(ppt-canvas-renderer.ts)과 구조적으로 호환되는 `{ config, allPois }`를
 * 입력으로 받는다 — 순환 참조를 피하기 위해 그 인터페이스를 직접 import하지 않고,
 * 필요한 필드만 별도로 선언한다.
 *
 * `allPois`는 호출부(site-analysis-app.tsx의 `visiblePois`, ppt-preview-modal.tsx)에서 이미
 * 반경(config.radiusKm)·레이어 필터가 적용된 목록을 넘겨준다는 전제 — 이 모듈은 반경으로
 * 다시 필터링하지 않고 주어진 목록 전체를 집계한다.
 */
import type { AnalysisConfig, Poi, SubwayStation, School, Park, ResidentialPoi, MaintenanceProject } from "./types";
import { POI_SOURCE_LABELS } from "./types";
import { haversineDistance } from "./geo";
import { summarizeMaintenanceProjects, formatMaintenanceArea } from "./maintenance-analysis";
import { isRawPoiId } from "./poi-id-guard";

/** 직선거리 → 도보시간 환산 속도. 성인 평균 보행속도 약 80m/분(≈4.8km/h) 가정. */
const WALK_SPEED_M_PER_MIN = 80;

export interface FactSummaryInput {
  readonly config: AnalysisConfig;
  readonly allPois: readonly Poi[];
}

export interface FactSummaryTransit {
  readonly nearestStationName: string | null;
  readonly distanceM: number | null;
  readonly walkMin: number | null;
  readonly lineCount: number;
  readonly stationCount: number;
}

export interface FactSummaryEducation {
  readonly schoolCount: number;
  readonly nearestSchoolName: string | null;
  readonly distanceM: number | null;
}

export interface FactSummaryNature {
  readonly parkCount: number;
  readonly mountainCount: number;
  readonly nearestParkName: string | null;
  readonly nearestParkDistanceM: number | null;
}

export interface FactSummaryHousing {
  readonly complexCount: number;
  readonly totalHouseholds: number;
}

export interface FactSummaryMaintenance {
  readonly count: number;
  readonly boundaryConfirmedCount: number;
  readonly totalAreaSqm: number;
}

export interface FactSummary {
  readonly transit: FactSummaryTransit;
  readonly education: FactSummaryEducation;
  readonly nature: FactSummaryNature;
  readonly housing: FactSummaryHousing;
  readonly maintenance: FactSummaryMaintenance;
}

interface NearestResult<T> {
  readonly poi: T;
  readonly distanceM: number;
}

/**
 * 원시 ID 이름(예: "school-4346679989")인 POI는 "최근접" 후보에서 제외하고 다음 후보로 넘어간다
 * (P4R Task B-1). count·length 등 집계 함수는 이 함수를 거치지 않은 원본 배열을 그대로 쓰므로
 * 영향받지 않는다.
 */
function findNearest<T extends Poi>(config: AnalysisConfig, pois: readonly T[]): NearestResult<T> | null {
  let best: NearestResult<T> | null = null;
  for (const poi of pois) {
    if (isRawPoiId(poi.name)) continue;
    const distanceM = haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng);
    if (!best || distanceM < best.distanceM) best = { poi, distanceM };
  }
  return best;
}

/** SlideRenderInput의 config/allPois에서 카테고리별 핵심 팩트를 계산한다. 데이터가 없으면 해당 필드는 null. */
export function buildFactSummary(input: FactSummaryInput): FactSummary {
  const { config, allPois } = input;

  const subways = allPois.filter((p): p is SubwayStation => p.category === "subway");
  const schools = allPois.filter((p): p is School => p.category === "school");
  const parks = allPois.filter((p): p is Park => p.category === "park");
  const mountains = allPois.filter((p) => p.category === "mountain");
  const residentials = allPois.filter(
    (p): p is ResidentialPoi =>
      p.category === "apartment" || p.category === "officetel" || p.category === "residential"
  );
  const maintenanceProjects = allPois.filter((p): p is MaintenanceProject => p.category === "maintenance");

  const nearestSubway = findNearest(config, subways);
  const nearestSchool = findNearest(config, schools);
  const nearestPark = findNearest(config, parks);
  const maintenanceSummary = summarizeMaintenanceProjects(maintenanceProjects);

  return {
    transit: {
      nearestStationName: nearestSubway?.poi.name ?? null,
      distanceM: nearestSubway ? Math.round(nearestSubway.distanceM) : null,
      walkMin: nearestSubway ? Math.ceil(nearestSubway.distanceM / WALK_SPEED_M_PER_MIN) : null,
      lineCount: new Set(subways.map((s) => s.line)).size,
      stationCount: subways.length,
    },
    education: {
      schoolCount: schools.length,
      nearestSchoolName: nearestSchool?.poi.name ?? null,
      distanceM: nearestSchool ? Math.round(nearestSchool.distanceM) : null,
    },
    nature: {
      parkCount: parks.length,
      mountainCount: mountains.length,
      nearestParkName: nearestPark?.poi.name ?? null,
      nearestParkDistanceM: nearestPark ? Math.round(nearestPark.distanceM) : null,
    },
    housing: {
      complexCount: residentials.length,
      totalHouseholds: residentials.reduce((sum, r) => sum + (r.units ?? 0), 0),
    },
    maintenance: {
      count: maintenanceSummary.count,
      boundaryConfirmedCount: maintenanceSummary.boundaryConfirmedCount,
      totalAreaSqm: maintenanceSummary.totalAreaSqm,
    },
  };
}

// ── 인사이트 카드 (Task 5 — 카테고리 지도 슬라이드 우측 라운드 검정 카드) ─────────────────────

/** buildCategoryInsight가 지원하는 카테고리 키. renderCategorySlide/addCategorySlide의 4개 호출부와 1:1 대응. */
export type CategoryInsightKey = "transit" | "education" | "nature" | "housing" | "maintenance";

/**
 * 카테고리별 인사이트 카드 문장(2-4줄)을 생성한다. 두 렌더러(ppt-canvas-renderer.ts/ppt-generator.ts)가
 * 이 함수를 공유해 "동일 수치" 요구를 소스 레벨에서 보장한다.
 * 반경 내 데이터가 0건이면 빈 배열을 반환 — 렌더러는 카드를 그리지 않고 기존 EMPTY_PANEL_TEXT 문법을 유지한다.
 */
export function buildCategoryInsight(category: CategoryInsightKey, summary: FactSummary): string[] {
  switch (category) {
    case "transit": {
      const t = summary.transit;
      if (t.stationCount === 0) return [];
      const lines: string[] = [];
      if (t.nearestStationName) {
        lines.push(`최근접 ${t.nearestStationName} 도보 ${t.walkMin}분(${t.distanceM}m)`);
      }
      lines.push(`반경 내 지하철역 ${t.stationCount}개 · ${t.lineCount}개 노선`);
      return lines;
    }
    case "education": {
      const e = summary.education;
      if (e.schoolCount === 0) return [];
      const lines: string[] = [];
      if (e.nearestSchoolName) {
        lines.push(`최근접 ${e.nearestSchoolName} ${e.distanceM}m`);
      }
      lines.push(`반경 내 학교 ${e.schoolCount}개`);
      return lines;
    }
    case "nature": {
      const n = summary.nature;
      if (n.parkCount === 0 && n.mountainCount === 0) return [];
      const lines: string[] = [];
      if (n.nearestParkName) {
        lines.push(`최근접 공원 ${n.nearestParkName} ${n.nearestParkDistanceM}m`);
      }
      lines.push(`공원 ${n.parkCount}개 · 산 ${n.mountainCount}개`);
      return lines;
    }
    case "housing": {
      const h = summary.housing;
      if (h.complexCount === 0) return [];
      return [
        `주거 단지 ${h.complexCount}개`,
        `총 ${h.totalHouseholds.toLocaleString()}세대`,
      ];
    }
    case "maintenance": {
      const m = summary.maintenance;
      if (m.count === 0) return [];
      const lines: string[] = [`정비사업 ${m.count}건 · 경계 확인 ${m.boundaryConfirmedCount}건`];
      if (m.totalAreaSqm > 0) lines.push(`총 면적 ${formatMaintenanceArea(m.totalAreaSqm)}`);
      return lines;
    }
    default:
      return [];
  }
}

// ── 팩트 시트 행 콘텐츠 (두 렌더러 공유 — "동일 수치" 요구를 소스 레벨에서 보장) ─────────────

/** 값 조각. accent=true면 렌더러가 accentRed로 강조해야 하는 핵심 수치. */
export interface FactSheetSegment {
  readonly text: string;
  readonly accent?: boolean;
}

export interface FactSheetRow {
  readonly label: string;
  readonly value: readonly FactSheetSegment[];
  readonly source: string;
}

/** 팩트 시트 슬라이드(Task 4)의 검정 헤더 표 행 데이터. config/summary만으로 결정되는 순수 함수. */
export function buildFactSheetRows(
  config: AnalysisConfig,
  summary: FactSummary,
  referenceDate: Date = new Date()
): FactSheetRow[] {
  const dateText = referenceDate.toLocaleDateString("ko-KR");
  const t = summary.transit;
  const e = summary.education;
  const n = summary.nature;
  const h = summary.housing;

  const transitValue: FactSheetSegment[] = t.nearestStationName
    ? [
        { text: t.nearestStationName },
        { text: " · " },
        { text: `${t.distanceM}m`, accent: true },
        { text: " · 도보 " },
        { text: `${t.walkMin}분`, accent: true },
      ]
    : [{ text: "반경 내 확인된 역 없음" }];

  const lineValue: FactSheetSegment[] = [
    { text: "역 " },
    { text: `${t.stationCount}개`, accent: true },
    { text: " · " },
    { text: `${t.lineCount}개 노선`, accent: true },
  ];

  const schoolValue: FactSheetSegment[] = e.schoolCount > 0
    ? [
        { text: `${e.schoolCount}개`, accent: true },
        { text: " · 최근접 " },
        { text: e.nearestSchoolName ?? "-" },
        { text: " " },
        { text: `${e.distanceM}m`, accent: true },
      ]
    : [{ text: "반경 내 확인된 학교 없음" }];

  const natureValue: FactSheetSegment[] = n.parkCount > 0 || n.mountainCount > 0
    ? [
        { text: "공원 " },
        { text: `${n.parkCount}개`, accent: true },
        { text: " · 산 " },
        { text: `${n.mountainCount}개`, accent: true },
        ...(n.nearestParkName
          ? [
              { text: " · 최근접 공원 " },
              { text: n.nearestParkName },
              { text: " " },
              { text: `${n.nearestParkDistanceM}m`, accent: true },
            ]
          : []),
      ]
    : [{ text: "반경 내 확인된 공원·산 없음" }];

  const housingValue: FactSheetSegment[] = h.complexCount > 0
    ? [
        { text: `${h.complexCount}개 단지`, accent: true },
        { text: " · 총 " },
        { text: `${h.totalHouseholds.toLocaleString()}세대`, accent: true },
      ]
    : [{ text: "반경 내 확인된 주거 단지 없음" }];

  return [
    { label: "분석 대상", value: [{ text: config.centerName }], source: "사용자 입력" },
    { label: "분석 반경", value: [{ text: `${config.radiusKm}km`, accent: true }], source: "사용자 입력" },
    { label: "분석일", value: [{ text: dateText }], source: "자동 생성" },
    { label: "최근접 역", value: transitValue, source: POI_SOURCE_LABELS.osm },
    { label: "반경 내 역·노선 수", value: lineValue, source: POI_SOURCE_LABELS.osm },
    { label: "학교 수·최근접", value: schoolValue, source: POI_SOURCE_LABELS.osm },
    { label: "공원·산", value: natureValue, source: `${POI_SOURCE_LABELS.park}·OSM` },
    { label: "주거 단지·세대수 합", value: housingValue, source: POI_SOURCE_LABELS.residential },
  ];
}

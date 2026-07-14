import type { Poi, PoiPosition, RadiusPosition } from "./types";
import { isRawPoiId } from "./poi-id-guard";

/**
 * 지도에 실제로 그려지는 POI 라벨 문자열 — 두 렌더러(ppt-canvas-renderer.ts/ppt-generator.ts)와
 * 레이아웃 폭 산정(layoutPoiLabels)이 모두 이 함수를 공유해 "표시 텍스트 = 폭 산정 텍스트"를 보장한다.
 * Task 5 — 지명 색 문법(산 초록 "+높이m") 중 고도 표기 부분. mountain은 elevation_m 실측 필드를 사용
 * (없는 데이터 발명 금지 원칙에 따라 다른 카테고리는 이름만 표기).
 */
export function poiLabelText(poi: Poi): string {
  if (poi.category === "mountain") return `${poi.name} ${poi.elevation_m}m`;
  return poi.name;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface PoiLabelPlacement {
  readonly poiId: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const LABEL_HEIGHT = 0.26;
const LABEL_GAP = 0.08;
const LABEL_MARGIN = 0.3;

/** 카테고리당 배지 개수 상한(P4R Task B-2) — 자연/교육 등 POI 밀집 카테고리에서 배지가 서로 겹쳐
 * 판독 불가해지는 문제(s6)를 줄인다. count/집계에는 영향 없음(표시 후보 선정에만 적용). */
const DEFAULT_MAX_LABELS_PER_CATEGORY = 8;

/** SITE 마커(중심 점+외곽 링+"SITE" 텍스트) 주변 배지 금지 반경(inch). ppt-canvas-renderer.ts/
 * ppt-generator.ts의 siteMarkerOuterSize(0.3in)·SITE_LABEL_OFFSET_Y(0.20in)보다 넉넉히 잡아
 * 배지가 대상지 마커를 덮지 않게 한다(s6: "아크로비스타 내 작은 공원" 배지가 SITE를 완전히 덮은 사례). */
const SITE_PROTECT_RADIUS = 0.42;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function overlaps(left: Rect, right: Rect): boolean {
  return !(
    left.x + left.w <= right.x ||
    right.x + right.w <= left.x ||
    left.y + left.h <= right.y ||
    right.y + right.h <= left.y
  );
}

export interface LabelLayoutOptions {
  /** 대상지(RadiusPosition) — 주어지면 (1) 배지 상한 선정 시 가까운 순으로 정렬하고
   * (2) SITE 마커 주변을 배지 금지 영역으로 등록한다. null/undefined면 두 동작 모두 생략(기존 동작). */
  readonly radiusPosition?: RadiusPosition | null;
  /** 카테고리당 배지 개수 상한. 기본 DEFAULT_MAX_LABELS_PER_CATEGORY(8). */
  readonly maxPerCategory?: number;
}

export function layoutPoiLabels(
  positions: readonly PoiPosition[],
  slideWidth: number,
  slideHeight: number,
  markerSize: number,
  options: LabelLayoutOptions = {}
): readonly PoiLabelPlacement[] {
  const { radiusPosition = null, maxPerCategory = DEFAULT_MAX_LABELS_PER_CATEGORY } = options;

  // P4R Task B-1: 원시 ID 이름(예: "school-4346679989")은 배지 후보에서 제외한다. 마커 자체는
  // 이 함수의 입력 범위가 아니므로(호출부가 마커는 filtered 전체로, 라벨만 이 함수에 넘김) 영향 없음.
  const displayable = positions.filter((position) => !isRawPoiId(position.poi.name));

  // P4R Task B-2: 카테고리당 배지 상한 — 대상지 중심에서 가까운 순으로 최대 maxPerCategory개만
  // 배지 후보로 남긴다(정규화 좌표(nx,ny) 기준 근사 거리 — 소축척 지도라 실거리 순위와 사실상 동일).
  const byCategory = new Map<string, PoiPosition[]>();
  for (const position of displayable) {
    const list = byCategory.get(position.poi.category);
    if (list) list.push(position);
    else byCategory.set(position.poi.category, [position]);
  }
  const capped: PoiPosition[] = [];
  byCategory.forEach((list) => {
    if (!radiusPosition || list.length <= maxPerCategory) {
      capped.push(...list.slice(0, maxPerCategory));
      return;
    }
    const sortedByDistance = [...list].sort((left, right) => {
      const dl = (left.nx - radiusPosition.centerNx) ** 2 + (left.ny - radiusPosition.centerNy) ** 2;
      const dr = (right.nx - radiusPosition.centerNx) ** 2 + (right.ny - radiusPosition.centerNy) ** 2;
      return dl - dr;
    });
    capped.push(...sortedByDistance.slice(0, maxPerCategory));
  });

  const occupiedRects: Rect[] = [];

  // P4R Task B-2: SITE 마커 보호 영역 — 배지 겹침 회피 루프가 시작부터 이 영역을 "이미 점유됨"으로
  // 취급하게 해 어떤 배지도 대상지 마커·중심 링을 덮지 못하게 한다.
  if (radiusPosition) {
    const siteX = radiusPosition.centerNx * slideWidth;
    const siteY = radiusPosition.centerNy * slideHeight;
    occupiedRects.push({
      x: siteX - SITE_PROTECT_RADIUS,
      y: siteY - SITE_PROTECT_RADIUS,
      w: SITE_PROTECT_RADIUS * 2,
      h: SITE_PROTECT_RADIUS * 2,
    });
  }

  const placements: PoiLabelPlacement[] = [];
  const sortedPositions = [...capped].sort((left, right) => left.ny - right.ny || left.nx - right.nx);

  sortedPositions.forEach((position) => {
    const markerX = position.nx * slideWidth;
    const markerY = position.ny * slideHeight;
    const labelWidth = clamp(poiLabelText(position.poi).length * 0.13 + 0.35, 0.9, 2.5);
    const preferredRightX = markerX + markerSize / 2 + LABEL_GAP;
    const preferredLeftX = markerX - labelWidth - markerSize / 2 - LABEL_GAP;
    const centeredY = markerY - LABEL_HEIGHT / 2;
    const raisedY = centeredY - LABEL_HEIGHT - 0.06;
    const loweredY = centeredY + LABEL_HEIGHT + 0.06;

    const candidateRects: Rect[] = [
      {
        x: clamp(preferredRightX, LABEL_MARGIN, slideWidth - labelWidth - LABEL_MARGIN),
        y: clamp(centeredY, LABEL_MARGIN, slideHeight - LABEL_HEIGHT - LABEL_MARGIN),
        w: labelWidth,
        h: LABEL_HEIGHT,
      },
      {
        x: clamp(preferredLeftX, LABEL_MARGIN, slideWidth - labelWidth - LABEL_MARGIN),
        y: clamp(centeredY, LABEL_MARGIN, slideHeight - LABEL_HEIGHT - LABEL_MARGIN),
        w: labelWidth,
        h: LABEL_HEIGHT,
      },
      {
        x: clamp(preferredRightX, LABEL_MARGIN, slideWidth - labelWidth - LABEL_MARGIN),
        y: clamp(raisedY, LABEL_MARGIN, slideHeight - LABEL_HEIGHT - LABEL_MARGIN),
        w: labelWidth,
        h: LABEL_HEIGHT,
      },
      {
        x: clamp(preferredLeftX, LABEL_MARGIN, slideWidth - labelWidth - LABEL_MARGIN),
        y: clamp(loweredY, LABEL_MARGIN, slideHeight - LABEL_HEIGHT - LABEL_MARGIN),
        w: labelWidth,
        h: LABEL_HEIGHT,
      },
    ];

    const availableRect = candidateRects.find(
      (candidate) => !occupiedRects.some((occupied) => overlaps(occupied, candidate))
    );

    if (!availableRect) {
      return;
    }

    occupiedRects.push({
      x: availableRect.x - 0.04,
      y: availableRect.y - 0.04,
      w: availableRect.w + 0.08,
      h: availableRect.h + 0.08,
    });

    placements.push({
      poiId: position.poi.id,
      x: availableRect.x,
      y: availableRect.y,
      w: availableRect.w,
      h: availableRect.h,
    });
  });

  return placements;
}

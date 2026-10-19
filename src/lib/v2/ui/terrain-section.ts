import type { TerrainSectionAxis, TerrainSectionCrossing, TerrainSections } from "../engine/tiles/terrain-section";
import { formatDistanceM, formatMetricValue } from "./tile-view";

export const TERRAIN_SECTION_LABELS = { A: "단면 A–A′ (동서)", B: "단면 B–B′ (남북)" } as const;
export const TERRAIN_SECTION_MAP_LABELS = { A: "A–A′", B: "B–B′" } as const;
export const TERRAIN_CROSSING_LABELS = { retaining: "옹벽", cut_fill: "절성토", fence: "울타리" } as const;
export const TERRAIN_CROSSING_LAYERS = { retaining: "retaining_wall", cut_fill: "cut_fill", fence: "fence" } as const;
export const TERRAIN_SECTION_TABLE_MAX_ROWS = 4;

export type TerrainSection = NonNullable<TerrainSections>["A"];
export type TerrainCrossingKind = keyof typeof TERRAIN_CROSSING_LABELS;

export const TERRAIN_SECTION_MARKER_HALF_HEIGHT = 8;

export type TerrainSectionMapStyle = {
  strokeWidth: number;
  opacity: number;
  dash?: string;
};

export type TerrainSectionRect = { x: number; y: number; w: number; h: number };

export type TerrainSectionBands = {
  header: TerrainSectionRect;
  plot: TerrainSectionRect;
  axis: TerrainSectionRect;
  table: TerrainSectionRect;
  footer: TerrainSectionRect;
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
  gapX: number;
  gapY: number;
};

/** preview/PPT가 공유하는 단면 도판의 비겹침 band 계약. */
export function terrainSectionBands(rect: TerrainSectionRect): TerrainSectionBands {
  const paddingX = Math.min(0.16, Math.max(0.06, rect.w * 0.04));
  const paddingTop = 0.1;
  const paddingBottom = 0.12;
  const gapX = Math.min(0.12, Math.max(0.04, rect.w * 0.03));
  const gapY = 0.06;
  const headerH = 0.24;
  const axisH = 0.18;
  const footerH = 0.18;
  const innerW = Math.max(0.4, rect.w - paddingX * 2);
  const tableW = Math.min(Math.max(0.2, innerW - gapX - 0.2), Math.max(1.45, innerW * 0.42));
  const plotW = Math.max(0.2, innerW - gapX - tableW);
  const header = { x: rect.x + paddingX, y: rect.y + paddingTop, w: innerW, h: headerH };
  const bodyY = header.y + header.h + gapY;
  const footer = { x: rect.x + paddingX, y: rect.y + rect.h - paddingBottom - footerH, w: innerW, h: footerH };
  const axis = { x: header.x, y: footer.y - gapY - axisH, w: plotW, h: axisH };
  const plot = { x: header.x, y: bodyY, w: plotW, h: Math.max(0.35, axis.y - bodyY - gapY) };
  const table = { x: header.x + plotW + gapX, y: bodyY, w: tableW, h: Math.max(0.35, axis.y + axis.h - bodyY) };
  return { header, plot, axis, table, footer, paddingX, paddingTop, paddingBottom, gapX, gapY };
}

/** 단면 도판이 요약 열을 차지할 때 낮은 우선순위 메모를 먼저 줄인다. */
export function reportSummaryNotes(view: { caveats: readonly string[]; notes: readonly string[] }, compactTerrain = false): string[] {
  const notes = [...view.caveats, ...view.notes];
  return compactTerrain ? notes.slice(0, 1) : notes.slice(0, 4);
}

/** 화면·미리보기 SVG에서 단차 표식을 프로파일 주변의 짧은 glyph로 제한한다. */
export function terrainSectionMarkerGeometry(x: number, y: number, halfHeight = TERRAIN_SECTION_MARKER_HALF_HEIGHT): { x: number; y1: number; y2: number } {
  const half = Number.isFinite(halfHeight) && halfHeight > 0 ? halfHeight : TERRAIN_SECTION_MARKER_HALF_HEIGHT;
  return { x, y1: y - half, y2: y + half };
}

/** 지도 단면선의 선택 상태는 색만이 아니라 두께·선 모양·불투명도로도 구분한다. */
export function terrainSectionMapStyle(section: "A" | "B", selected: "A" | "B"): TerrainSectionMapStyle {
  return section === selected
    ? { strokeWidth: 3, opacity: 1 }
    : { strokeWidth: 1.25, opacity: 0.45, dash: "7 5" };
}

/** 단면 레이블 지시선이 반경 원 안의 실제 선 위에 놓이도록 화면 좌표를 계산한다. */
export function terrainSectionLabelAnchor(
  points: readonly (readonly [number, number])[],
  center: readonly [number, number],
  radius: number,
  fraction = 0.8,
): [number, number] | null {
  const from = points[0];
  if (!from) return null;
  const dx = from[0] - center[0];
  const dy = from[1] - center[1];
  const distance = Math.hypot(dx, dy);
  if (!(distance > 0)) return [center[0], center[1]];
  const target = Math.min(distance, Math.max(0, radius) * Math.min(1, Math.max(0, fraction)));
  return [center[0] + (dx / distance) * target, center[1] + (dy / distance) * target];
}

export function terrainSectionTotal(section: TerrainSection): number {
  return Math.max(1, Math.hypot(section.to[0] - section.from[0], section.to[1] - section.from[1]));
}

export function terrainSectionDistanceFromCenter(section: TerrainSection, d: number): number {
  return Math.abs(d - terrainSectionTotal(section) / 2);
}

/** 좌표를 기준으로 단면의 양 끝 방향을 정한다. from/to 순서에 의존하지 않는다. */
export function terrainSectionPosition(section: TerrainSection, d: number): string {
  const total = terrainSectionTotal(section);
  const fraction = Math.max(0, Math.min(1, d / total));
  const coordinate: [number, number] = [
    section.from[0] + (section.to[0] - section.from[0]) * fraction,
    section.from[1] + (section.to[1] - section.from[1]) * fraction,
  ];
  const center: [number, number] = [(section.from[0] + section.to[0]) / 2, (section.from[1] + section.to[1]) / 2];
  const delta = section.axis === "EW" ? coordinate[0] - center[0] : coordinate[1] - center[1];
  const distance = terrainSectionDistanceFromCenter(section, d);
  if (distance < 0.5) return "대지 중심";
  const direction = section.axis === "EW"
    ? delta < 0 ? "서쪽" : "동쪽"
    : delta < 0 ? "남쪽" : "북쪽";
  return `${direction} ${formatDistanceM(distance)}`;
}

/** DEM 표본 사이를 선형 보간한다. 결측 구간을 건너뛰어 단차를 잘못 표식하지 않는다. */
export function terrainSectionElevationAt(section: TerrainSection, d: number): number | null {
  const valid = section.samples.filter((sample): sample is { d: number; z: number } => sample.z !== null && Number.isFinite(sample.z));
  const first = valid[0];
  const last = valid.at(-1);
  if (!first || !last) return null;
  if (d <= first.d) return first.z;
  if (d >= last.d) return last.z;
  for (let index = 1; index < section.samples.length; index += 1) {
    const before = section.samples[index - 1];
    const current = section.samples[index];
    if (before.z === null || current.z === null || d < before.d || d > current.d || current.d === before.d) continue;
    const fraction = (d - before.d) / (current.d - before.d);
    return before.z + (current.z - before.z) * fraction;
  }
  return null;
}

export function sortTerrainCrossings(section: TerrainSection): TerrainSectionCrossing[] {
  return section.crossings
    .map((crossing, index) => ({ crossing, index }))
    .sort((a, b) => terrainSectionDistanceFromCenter(section, a.crossing.d) - terrainSectionDistanceFromCenter(section, b.crossing.d) || a.index - b.index)
    .map(({ crossing }) => crossing);
}

export function terrainSectionAxisStops(section: TerrainSection): [string, string, string] {
  const total = terrainSectionTotal(section);
  const negative = section.axis === "EW"
    ? section.from[0] < section.to[0] ? "서" : "동"
    : section.from[1] < section.to[1] ? "남" : "북";
  const positive = section.axis === "EW"
    ? negative === "서" ? "동" : "서"
    : negative === "남" ? "북" : "남";
  const distance = formatDistanceM(total / 2);
  return [`${negative} ${distance}`, "대지", `${positive} ${distance}`];
}

export function terrainSectionAxisLabel(section: TerrainSection): string {
  return terrainSectionAxisStops(section).join(" · ");
}

export function terrainElevationLabel(value: number): string {
  return `${formatMetricValue(value, "m")}m`;
}

export function terrainCrossingLayer(kind: TerrainCrossingKind): string {
  return TERRAIN_CROSSING_LAYERS[kind];
}

export function terrainAxisForSection(axis: TerrainSectionAxis): "A" | "B" {
  return axis === "EW" ? "A" : "B";
}

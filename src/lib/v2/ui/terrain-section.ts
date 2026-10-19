import type { TerrainSectionAxis, TerrainSectionCrossing, TerrainSections } from "../engine/tiles/terrain-section";
import { formatDistanceM, formatMetricValue } from "./tile-view";

export const TERRAIN_SECTION_LABELS = { A: "단면 A–A′ (동서)", B: "단면 B–B′ (남북)" } as const;
export const TERRAIN_SECTION_MAP_LABELS = { A: "A–A′", B: "B–B′" } as const;
export const TERRAIN_CROSSING_LABELS = { retaining: "옹벽", cut_fill: "절성토", fence: "울타리" } as const;
export const TERRAIN_CROSSING_LAYERS = { retaining: "retaining_wall", cut_fill: "cut_fill", fence: "fence" } as const;

export type TerrainSection = NonNullable<TerrainSections>["A"];
export type TerrainCrossingKind = keyof typeof TERRAIN_CROSSING_LABELS;

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

export function sortTerrainCrossings(section: TerrainSection): TerrainSectionCrossing[] {
  return section.crossings
    .map((crossing, index) => ({ crossing, index }))
    .sort((a, b) => terrainSectionDistanceFromCenter(section, a.crossing.d) - terrainSectionDistanceFromCenter(section, b.crossing.d) || a.index - b.index)
    .map(({ crossing }) => crossing);
}

export function terrainSectionAxisLabel(section: TerrainSection): string {
  const total = terrainSectionTotal(section);
  const negative = section.axis === "EW"
    ? section.from[0] < section.to[0] ? "서" : "동"
    : section.from[1] < section.to[1] ? "남" : "북";
  const positive = section.axis === "EW"
    ? negative === "서" ? "동" : "서"
    : negative === "남" ? "북" : "남";
  const distance = formatDistanceM(total / 2);
  return `${negative} ${distance} · 대지 · ${positive} ${distance}`;
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

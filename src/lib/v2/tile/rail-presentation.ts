import type { FeatureHit } from "../data/features";
import { isPublicSubwayLineRef, subwayLineColor, subwayLineLabelText } from "../../osm-subway-overlay";

export const DEFAULT_RAIL_COLOR = "#1F5FA8";

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function hexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim() : null;
}

export function publicRailLine(ref: string | null, lineName: string | null): boolean {
  const label = subwayLineLabelText(ref ?? undefined, lineName ?? undefined);
  const numberRef = label.match(/^([1-9])호선$/u)?.[1];
  return isPublicSubwayLineRef(ref ?? undefined) || isPublicSubwayLineRef(numberRef) || isPublicSubwayLineRef(label);
}

export function railLineMemberships(hit: FeatureHit): Array<{ label: string; color: string }> {
  const refs = Array.isArray(hit.properties.lineRefs) ? hit.properties.lineRefs : [];
  const names = Array.isArray(hit.properties.lineNames) ? hit.properties.lineNames : [];
  const colors = Array.isArray(hit.properties.lineColors) ? hit.properties.lineColors : [];
  const memberships: Array<{ label: string; color: string }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < Math.max(refs.length, names.length); index += 1) {
    const ref = text(refs[index]) ?? text(names[index]);
    const lineName = text(names[index]);
    if (!publicRailLine(ref, lineName)) continue;
    const label = subwayLineLabelText(ref ?? undefined, lineName ?? undefined);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const color = hexColor(colors[index]);
    memberships.push({ label, color: color ? subwayLineColor(color) : DEFAULT_RAIL_COLOR });
  }
  return memberships;
}

/** 출구의 역명과 같은 역의 첫 공개 호선 색. 없으면 호출부의 레이어 기본색을 쓴다. */
export function railEntranceColor(entrance: FeatureHit, stations: readonly FeatureHit[]): string | null {
  const stationName = text(entrance.properties.stationName);
  if (!stationName) return null;
  const station = stations.find((hit) => text(hit.name) === stationName);
  return station ? railLineMemberships(station)[0]?.color ?? null : null;
}

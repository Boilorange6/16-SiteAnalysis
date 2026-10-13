import type { FeatureHit } from "../data/features";
import { isPublicSubwayLineRef } from "../../osm-subway-overlay";

/**
 * 화면에서 쓰는 서울권 운영 철도 색. OSM relation의 `colour`는 관계·방향·시점에
 * 따라 흔들리므로 지도 표현의 입력으로 사용하지 않는다.
 */
export const OFFICIAL_RAIL_LINE_COLORS: Readonly<Record<string, string>> = {
  "1호선": "#0052A4",
  "2호선": "#00A84D",
  "3호선": "#EF7C1C",
  "4호선": "#00A4E3",
  "5호선": "#996CAC",
  "6호선": "#CD7C2F",
  "7호선": "#747F00",
  "8호선": "#E6186C",
  "9호선": "#BDB092",
  수인분당: "#FABE00",
  신분당: "#D31145",
  경의중앙: "#77C4A3",
  공항철도: "#0090D2",
  경춘: "#178C72",
  우이신설: "#B7C450",
  신림: "#6789CA",
  김포골드: "#A17800",
  서해: "#8FC31F",
  "GTX-A": "#9A6292",
  경강: "#0054A6",
};

/** 공식표에서 찾지 못한 노선은 원천색을 재사용하지 않고 중립색으로 표시한다. */
export const DEFAULT_RAIL_COLOR = "#64748B";

const LIGHT_RAIL_LABELS = new Set(["우이신설", "신림", "김포골드", "의정부", "용인"]);
const NAMED_LINE_ALIASES: Readonly<Record<string, string>> = {
  경의중앙: "경의중앙",
  경의중앙선: "경의중앙",
  경춘: "경춘",
  경춘선: "경춘",
  수인분당: "수인분당",
  수인분당선: "수인분당",
  "수인·분당선": "수인분당",
  신분당: "신분당",
  신분당선: "신분당",
  공항: "공항철도",
  공항철도: "공항철도",
  인천국제공항철도: "공항철도",
  우이신설: "우이신설",
  우이신설선: "우이신설",
  신림: "신림",
  신림선: "신림",
  김포골드: "김포골드",
  김포골드라인: "김포골드",
  서해: "서해",
  서해선: "서해",
  "GTX-A": "GTX-A",
  경강: "경강",
  경강선: "경강",
  의정부: "의정부",
  의정부경전철: "의정부",
  용인: "용인",
  용인경전철: "용인",
  성수지선: "2호선",
  신정지선: "2호선",
  마천지선: "5호선",
  하남선: "5호선",
  별내선: "8호선",
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function compact(value: string): string {
  return value.replace(/[\s·・]/gu, "").toLowerCase();
}

function alias(value: string | null): string | null {
  if (!value) return null;
  const exact = NAMED_LINE_ALIASES[value];
  if (exact) return exact;
  const key = compact(value);
  const entry = Object.entries(NAMED_LINE_ALIASES).find(([name]) => compact(name) === key);
  return entry?.[1] ?? null;
}

/** OSM ref/name 변종을 보고서에서 표시할 한 호선명으로 정규화한다. */
export function canonicalRailLineLabel(ref: string | null | undefined, lineName: string | null | undefined): string {
  const rawRef = text(ref);
  const rawName = text(lineName);
  const refAlias = alias(rawRef);
  if (refAlias) return refAlias;
  const nameAlias = alias(rawName);
  if (nameAlias) return nameAlias;

  // 역축에 붙은 하남·마천·별내·지선 ref는 본선의 공식 색을 쓴다.
  const source = compact(`${rawRef ?? ""} ${rawName ?? ""}`);
  const embeddedAlias = Object.entries(NAMED_LINE_ALIASES)
    .filter(([name]) => name.length >= 2)
    .sort(([a], [b]) => b.length - a.length)
    .find(([name]) => source.includes(compact(name)))?.[1];
  if (embeddedAlias) return embeddedAlias;
  if (source.includes("별내선")) return "8호선";
  if (source.includes("마천지선") || source.includes("하남선")) return "5호선";
  if (source.includes("성수지선") || source.includes("신정지선")) return "2호선";

  if (rawRef && /^[1-9]$/u.test(rawRef)) return `${rawRef}호선`;
  if (rawRef && /^(?:[1-9])호선$/u.test(rawRef)) return rawRef;

  // ref가 없는 일부 way/relation은 이름에 수도권/서울 호선 번호만 남긴다.
  const number = rawName?.match(/(?:서울|수도권)\s*[^:]*?([1-9])호선/u)?.[1]
    ?? rawName?.match(/(?:^|\s)([1-9])호선(?:\s|:|$)/u)?.[1];
  const regionalName = /(?:부산|대구|대전|광주|인천)/u.test(source);
  if (number && !source.includes("공항") && !regionalName) return `${number}호선`;

  if (rawRef && /^(?:부산|대구|대전|광주|인천)[1-4]$/u.test(rawRef)) return `${rawRef}호선`;
  return rawRef ?? rawName?.replace(/수도권 전철\s*/u, "").replace(/:.*/u, "") ?? "철도";
}

export function hexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}

/** OSM 색은 의도적으로 무시하고 canonical label의 공식표 색만 반환한다. */
export function railLineColor(ref: string | null | undefined, lineName: string | null | undefined): string {
  const label = canonicalRailLineLabel(ref, lineName);
  return OFFICIAL_RAIL_LINE_COLORS[label] ?? DEFAULT_RAIL_COLOR;
}

/** 밝은 호선도 흰 배경에서 분리되도록 어두운 케이싱을 붙인다. */
export function railLineCasing(color: string): string {
  const hex = hexColor(color) ?? DEFAULT_RAIL_COLOR;
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  const yiq = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return yiq > 0.62 ? "#172033" : "#FFFFFF";
}

export function railLineIsLightRail(label: string): boolean {
  return LIGHT_RAIL_LABELS.has(label) || /(?:경전철|의정부|용인)/u.test(label);
}

export function railLineEmphasis(label: string): "major" | "minor" {
  return railLineIsLightRail(label) ? "minor" : "major";
}

export function railLineBadgeText(label: string): string {
  const number = label.match(/(\d+)호선/u);
  return number ? number[1] : label.replace(/선$/u, "").slice(0, 4);
}

/** 역·출구 원천이 `역` 접미사·공백·괄호 표기를 달리해도 같은 역으로 연결한다. */
export function railStationMatchKey(value: string): string {
  return value.trim().replace(/\s+/gu, "").replace(/\([^)]*\)/gu, "").replace(/역$/u, "");
}

export function publicRailLine(ref: string | null, lineName: string | null): boolean {
  const label = canonicalRailLineLabel(ref, lineName);
  return label in OFFICIAL_RAIL_LINE_COLORS
    || LIGHT_RAIL_LABELS.has(label)
    || isPublicSubwayLineRef(ref ?? undefined)
    || isPublicSubwayLineRef(label)
    || /^(?:부산[1-4]|대구[1-3]|대전1|광주1|인천[1-2])호선$/u.test(label);
}

export function railLineMemberships(hit: FeatureHit): Array<{ label: string; color: string }> {
  const refs = Array.isArray(hit.properties.lineRefs) ? hit.properties.lineRefs : [];
  const names = Array.isArray(hit.properties.lineNames) ? hit.properties.lineNames : [];
  const memberships: Array<{ label: string; color: string }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < Math.max(refs.length, names.length); index += 1) {
    const ref = text(refs[index]) ?? text(names[index]);
    const lineName = text(names[index]);
    if (!publicRailLine(ref, lineName)) continue;
    const label = canonicalRailLineLabel(ref, lineName);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    memberships.push({ label, color: railLineColor(ref, lineName) });
  }
  return memberships;
}

/** 출구의 역명과 같은 역의 첫 공개 호선 색. 없으면 호출부의 레이어 기본색을 쓴다. */
export function railEntranceColor(entrance: FeatureHit, stations: readonly FeatureHit[]): string | null {
  const stationName = text(entrance.properties.stationName);
  if (!stationName) return null;
  const key = railStationMatchKey(stationName);
  const station = stations.find((hit) => {
    const name = text(hit.name);
    return name !== null && railStationMatchKey(name) === key;
  });
  return station ? railLineMemberships(station)[0]?.color ?? null : null;
}

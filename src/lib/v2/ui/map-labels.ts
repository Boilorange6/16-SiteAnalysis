import { layerStyle } from "./map-layers";
import type { MapFeature, MapLine, MapPolygon } from "../tile-result";

export type MapLabelKind = "feature" | "polygon" | "line";
export type MapLabelItem = MapFeature | MapPolygon | MapLine;

const GEOMETRY_ONLY_LABELS = new Set(["점", "면", "선"]);

export function trimLabel(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function userText(value: string | null | undefined): string | null {
  const text = trimLabel(value);
  return text && text !== "미상" && !GEOMETRY_ONLY_LABELS.has(text) ? text : null;
}

function joinLabel(name: string, sublabel: string | null): string {
  return sublabel ? `${name} · ${sublabel}` : name;
}

function formatLabelDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters).toLocaleString("ko-KR")}m`;
  const km = meters / 1000;
  return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} km`;
}

/** 기존 W0 결과와의 호환용 값. W2b가 sublabel을 채우면 이 경로는 사용하지 않는다. */
function legacyFeatureValue(feature: MapFeature): string | null {
  if (feature.approvalYear !== null && feature.approvalYear !== undefined) return String(feature.approvalYear);
  if (feature.plannedMonth) {
    const match = /^(\d{4})-(\d{2})$/.exec(feature.plannedMonth);
    if (match) return `${match[1]}년 ${Number(match[2])}월`;
  }
  if (feature.distanceM !== null && feature.distanceM !== undefined) return `직선 ${formatLabelDistance(feature.distanceM)}`;
  if (feature.households !== null && feature.households !== undefined) return `${Math.round(feature.households).toLocaleString("ko-KR")}세대`;
  if (feature.floorsMax !== null && feature.floorsMax !== undefined) return `최고 ${Math.round(feature.floorsMax)}층`;
  if (feature.buildingCount !== null && feature.buildingCount !== undefined) return `${Math.round(feature.buildingCount)}동`;
  if (feature.parking !== null && feature.parking !== undefined) return `주차 ${Math.round(feature.parking).toLocaleString("ko-KR")}대`;
  return userText(feature.label);
}

function hasLabelContract(item: MapLabelItem): boolean {
  return item.labelPriority !== undefined || Object.prototype.hasOwnProperty.call(item, "sublabel");
}

/**
 * 자동 라벨과 호버/고정 라벨이 공유하는 사람이 읽는 문구.
 * 새 계약에서는 name 또는 범례명에 타일이 서식한 sublabel만 붙인다.
 */
export function mapLabelText(layer: string, kind: MapLabelKind, item: MapLabelItem): string {
  const legendName = layerStyle(layer).label;
  const name = userText(item.name);
  const sublabel = userText(item.sublabel);
  if (name) {
    if (hasLabelContract(item)) return joinLabel(name, sublabel);
    if (kind === "feature") {
      const legacyValue = legacyFeatureValue(item as MapFeature);
      return legacyValue && legacyValue !== name ? joinLabel(name, legacyValue) : name;
    }
    return name;
  }
  if (hasLabelContract(item)) return joinLabel(legendName, sublabel);
  if (kind === "feature") {
    const legacyValue = legacyFeatureValue(item as MapFeature);
    return legacyValue ? joinLabel(legendName, legacyValue) : legendName;
  }
  const legacy = userText(item.label);
  return legacy ?? legendName;
}

/**
 * 자동 노출 후보. labelPriority가 있는 새 결과는 name만 허용한다.
 * 계약 필드가 없는 결과(W2b 전 타일·이미 저장된 분석)는 이전 규칙 그대로: 명시 label(점은 name도)이 있거나 강조된 요소.
 */
export function automaticLabelText(layer: string, kind: MapLabelKind, item: MapLabelItem, highlighted = false): string | null {
  if (hasLabelContract(item)) return item.labelPriority !== undefined && item.labelPriority >= 1 ? userText(item.name) : null;
  const explicit = trimLabel(item.label) ?? (kind === "feature" ? trimLabel(item.name) : null);
  return explicit ?? (highlighted ? mapLabelText(layer, kind, item) : null);
}

/** 계약 필드가 없는 결과의 자동 라벨 순서: 강조 → 명시 라벨(이전 정렬과 같음). */
export function legacyLabelPriority(kind: MapLabelKind, item: MapLabelItem, highlighted: boolean): number | undefined {
  if (hasLabelContract(item)) return item.labelPriority;
  if (highlighted) return 2;
  return trimLabel(item.label) ?? (kind === "feature" ? trimLabel(item.name) : null) ? 1 : 0;
}

export type AutomaticLabelCandidate = {
  key: string;
  autoText: string | null;
  labelPriority?: number;
  order: number;
  [key: string]: unknown;
};

/** 밀집 지도용 순수 선정기: priority 2→1, 엔진 순서, 같은 문구 하나. */
export function selectAutomaticLabels<T extends AutomaticLabelCandidate>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...entries]
    .filter((entry) => !!entry.autoText)
    .sort((a, b) => (b.labelPriority ?? 0) - (a.labelPriority ?? 0) || a.order - b.order)
    .filter((entry) => {
      const text = entry.autoText!;
      if (seen.has(text)) return false;
      seen.add(text);
      return true;
    });
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** 작은 배지도 배경색만으로 의미를 전달하지 않고 4.5:1에 가까운 글자색을 고른다. */
export function badgeTextColor(color: string): "#111111" | "#FFFFFF" {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return "#111111";
  const hex = match[1]!;
  const luminance = 0.2126 * channel(Number.parseInt(hex.slice(0, 2), 16)) + 0.7152 * channel(Number.parseInt(hex.slice(2, 4), 16)) + 0.0722 * channel(Number.parseInt(hex.slice(4, 6), 16));
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? "#FFFFFF" : "#111111";
}

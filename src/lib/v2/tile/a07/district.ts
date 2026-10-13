import type { Geometry } from "geojson";
import type { LngLat } from "../../crs";
import type { FeatureHit } from "../../data/features";
import { polygonCandidate, type PolygonCandidate } from "../../engine/tiles/common";
import { clipToCircle, polygonArea } from "../../engine/tiles/geo";
import type { TileResult } from "../../tile-result";

export const MIN_DISTRICT_SAMPLE = 3;

export type DistrictArea = {
  code: string;
  name: string;
  geometry: Geometry;
  featureId: number;
};

export type DistrictMetric = {
  value: number | null;
  count: number;
};

export function legalEmdAreas(hits: readonly FeatureHit[]): DistrictArea[] {
  const byCode = new Map<string, DistrictArea>();
  for (const hit of hits) {
    const code = hit.legalCode?.slice(0, 8);
    if (!code || !/^\d{8}$/.test(code) || byCode.has(code)) continue;
    byCode.set(code, {
      code,
      name: hit.name?.trim() || code,
      geometry: hit.geometry,
      featureId: hit.featureId,
    });
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function legalEmdCode(locationId: string | null): string | null {
  const code = locationId?.slice(0, 8) ?? "";
  return /^\d{8}$/.test(code) ? code : null;
}

export function mean(values: readonly number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function equalIntervalBand(value: number, values: readonly number[]): 1 | 2 | 3 | 4 | 5 {
  const finite = values.filter((item) => Number.isFinite(item));
  if (finite.length === 0) return 3;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max <= min) return 3;
  return Math.min(5, Math.max(1, Math.floor(((value - min) / (max - min)) * 5) + 1)) as 1 | 2 | 3 | 4 | 5;
}

function intervalBounds(values: readonly number[]): number[] | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const step = (max - min) / 5;
  return Array.from({ length: 6 }, (_, index) => min + step * index);
}

export function districtLegend(
  values: readonly number[],
  labelPrefix: string,
): TileResult["presentation"]["legend"] {
  const bounds = intervalBounds(values);
  if (!bounds) return [];
  const used = new Set(values.map((value) => equalIntervalBand(value, values)));
  return [...used]
    .sort((a, b) => a - b)
    .map((band) => ({
      label: `${labelPrefix} ${band}단계`,
      min: band === 1 ? null : bounds[band - 1]!,
      max: band === 5 ? null : bounds[band]!,
    }));
}

export function districtPolygons(
  areas: readonly DistrictArea[],
  metrics: ReadonlyMap<string, DistrictMetric>,
  center: LngLat,
  radiusM: number,
  layerPrefix: string,
  insufficientLayer: string,
  labelPrefix: string,
  valueText: (value: number) => string,
): { polygons: PolygonCandidate[]; values: number[]; legend: TileResult["presentation"]["legend"] } {
  const areaCodes = new Set(areas.map((area) => area.code));
  const values = [...metrics.entries()]
    .filter(([code, metric]) => areaCodes.has(code) && metric.count >= MIN_DISTRICT_SAMPLE && metric.value !== null)
    .map(([, metric]) => metric.value!);
  const polygons: PolygonCandidate[] = [];

  for (const area of areas) {
    const metric = metrics.get(area.code);
    const usable = metric !== undefined && metric.count >= MIN_DISTRICT_SAMPLE && metric.value !== null;
    const layer = usable ? `${layerPrefix}${equalIntervalBand(metric.value!, values)}` : insufficientLayer;
    const sublabel = usable
      ? `평균 ${valueText(metric.value!)} · ${metric.count.toLocaleString("ko-KR")}건`
      : `자료 부족 · ${(metric?.count ?? 0).toLocaleString("ko-KR")}건`;
    const parts = clipToCircle(center, radiusM, area.geometry);
    if (parts === null) continue;
    parts.forEach((rings, partIndex) => {
      const candidate = polygonCandidate(
        area.featureId * 10_000 + partIndex,
        layer,
        rings,
        polygonArea(rings),
        area.name,
        {
          fid: `${area.code}:${partIndex}`,
          name: area.name,
          sublabel,
          labelPriority: 1,
        },
      );
      if (candidate) polygons.push(candidate);
    });
  }

  return { polygons, values, legend: districtLegend(values, labelPrefix) };
}

export function formatKoreanWon(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "금액 미상";
  const manwon = Math.max(0, Math.round(value / 10_000));
  const eok = Math.floor(manwon / 10_000);
  const remainder = manwon % 10_000;
  if (eok > 0 && remainder > 0) return `${eok.toLocaleString("ko-KR")}억 ${remainder.toLocaleString("ko-KR")}만원`;
  if (eok > 0) return `${eok.toLocaleString("ko-KR")}억원`;
  return `${manwon.toLocaleString("ko-KR")}만원`;
}

function formatArea(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "전용면적 미상" : `전용 ${Math.round(value * 10) / 10}㎡`;
}

function formatFloor(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "층 미상" : `${Math.round(value)}층`;
}

function formatDealMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(value);
  return match ? `${match[1]}년 ${Number(match[2])}월` : value;
}

export function formatTradeRecent(row: { price_krw: number | null; area_m2: number | null; floor: number | null; deal_date: string }): string {
  return `${formatKoreanWon(row.price_krw)} · ${formatArea(row.area_m2)} · ${formatFloor(row.floor)} · ${formatDealMonth(row.deal_date)}`;
}

export function formatRentRecent(row: {
  deposit_krw: number | null;
  rent_krw: number | null;
  area_m2: number | null;
  floor: number | null;
  deal_date: string;
  contract_type: "jeonse" | "monthly";
}): string {
  const amount = row.contract_type === "jeonse"
    ? `전세 ${formatKoreanWon(row.deposit_krw)}`
    : `보증금 ${formatKoreanWon(row.deposit_krw)} · 월세 ${formatKoreanWon(row.rent_krw)}`;
  return `${amount} · ${formatArea(row.area_m2)} · ${formatFloor(row.floor)} · ${formatDealMonth(row.deal_date)}`;
}

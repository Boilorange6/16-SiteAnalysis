/** 대지 요약. 면적은 대상 필지 도형에서 읽으며 공부면적과 구분한다. */
import type { TileResult } from "../tile-result";
import type { SiteSummary } from "../ui/tile-view";
import { siteParcelFromResults } from "../ui/site-parcel";

const metric = (results: TileResult[], code: string, id: string) => {
  const m = results.find((r) => r.tileCode === code)?.metrics.find((x) => x.id === id);
  return m && m.value !== null ? m.value : null;
};

const metricWithUnit = (results: TileResult[], code: string, ids: readonly string[]) => {
  const metrics = results.find((r) => r.tileCode === code)?.metrics ?? [];
  const found = ids.map((id) => metrics.find((x) => x.id === id && x.value !== null)).find((x) => x !== undefined);
  return found && found.value !== null ? { value: found.value, unit: found.unit } : null;
};

/** WGS84 필지 도형을 대상 위도에서 미터로 근사한다. 화면 요약의 출처 표기는 항상 도형 면적이다. */
function ringAreaM2(ring: readonly [number, number][]): number {
  if (ring.length < 3) return 0;
  const lat = (ring.reduce((sum, [, y]) => sum + y, 0) / ring.length) * (Math.PI / 180);
  const meterPerLng = 111_320 * Math.cos(lat);
  const meterPerLat = 110_574;
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    area += (x1 * meterPerLng) * (y2 * meterPerLat) - (x2 * meterPerLng) * (y1 * meterPerLat);
  }
  return Math.abs(area) / 2;
}

function siteParcelAreaM2(siteParcel: SiteSummary["siteParcel"]): number | null {
  if (!siteParcel || siteParcel.length === 0) return null;
  const area = siteParcel.reduce((sum, polygon) => {
    const [outer, ...holes] = polygon.rings;
    if (!outer) return sum;
    const holeArea = holes.reduce((holeSum, ring) => holeSum + ringAreaM2(ring), 0);
    return sum + Math.max(0, ringAreaM2(outer) - holeArea);
  }, 0);
  return area > 0 && Number.isFinite(area) ? Math.round(area) : null;
}

export function buildSummary(site: { address: string; jimok: string | null }, radiusM: number, results: TileResult[]): SiteSummary {
  const facts: string[] = [];
  const siteParcel = siteParcelFromResults(results);
  const areaMetric = results.find((result) => result.tileCode === "A12")?.metrics.find((candidate) => candidate.id === "parcel_area_m2" && candidate.value !== null) ?? null;
  const areaM2 = areaMetric?.value ?? siteParcelAreaM2(siteParcel);
  const areaSource = areaMetric
    ? areaMetric.status === "estimated" ? "교차 필지 비율 추정 · 공부면적 아님" : areaMetric.formulaVersion.includes("공부") ? "공부면적 합" : "도형 면적 · 공부면적 아님"
    : "도형 면적 · 공부면적 아님";
  const parcelCountMetric = metric(results, "A12", "site_parcels");
  const landPrice = metricWithUnit(results, "A12", ["land_price", "official_land_price"]);
  const bus = metric(results, "A01", "nearest_bus_m");
  const busCount = metric(results, "A01", "bus_stops");
  if (bus !== null) facts.push(`최근접 버스정류장 직선 ${bus}m, 반경 안 ${busCount ?? 0}곳`);
  else if (busCount === 0) facts.push("반경 안 버스 정류장 없음");
  const apts = metric(results, "A05", "apartment_complexes");
  const hh = metric(results, "A05", "households");
  if (apts !== null) facts.push(`아파트 ${apts}개 단지, 확인 세대 ${(hh ?? 0).toLocaleString("en-US")}세대`);
  const basic = metric(results, "A03", "basic_groups");
  if (basic !== null) facts.push(`기초 생활시설 4군 중 ${basic}군 확인`);
  // 대지 용도지역: A12가 중심점 강조점의 라벨로 남긴 값. 없으면 null(“용도지역 미확인”)
  const zoning = results.find((r) => r.tileCode === "A12")?.presentation.features?.find((f) => f.layer === "zoning_site")?.label ?? null;
  return { address: site.address, areaM2, areaSource, parcelCount: parcelCountMetric ?? siteParcel?.length ?? null, landPriceM2: landPrice?.value ?? null, landPriceUnit: landPrice?.unit, jimok: site.jimok, zoning, radiusM, facts: facts.slice(0, 3), siteParcel };
}

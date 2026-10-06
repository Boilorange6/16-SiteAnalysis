/** 대지 요약. 면적은 아직 적재되지 않아 null. 사실 문장은 타일 결과에서 만든다(고정 문구 없음). */
import type { TileResult } from "../tile-result";
import type { SiteSummary } from "../ui/tile-view";
import { siteParcelFromResults } from "../ui/site-parcel";

const metric = (results: TileResult[], code: string, id: string) => {
  const m = results.find((r) => r.tileCode === code)?.metrics.find((x) => x.id === id);
  return m && m.value !== null ? m.value : null;
};

export function buildSummary(site: { address: string; jimok: string | null }, radiusM: number, results: TileResult[]): SiteSummary {
  const facts: string[] = [];
  if (site.jimok) facts.push(`지목 ${site.jimok}`);
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
  return { address: site.address, areaM2: null, zoning, radiusM, facts: facts.slice(0, 3), siteParcel: siteParcelFromResults(results) };
}

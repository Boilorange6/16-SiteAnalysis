/**
 * 반경과 교차하는 시군구·읍면동 (spec §3.3). 기존 앱의 역지오코딩 21회를 대체한다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";
import { queryFeaturesInRadius } from "./features";

export interface LegalAreaRef {
  code: string;
  name: string;
}

export function legalAreasForCircle(core: BetterSqlite3.Database, center: LngLat, radiusM: number): { sigungu: LegalAreaRef[]; emd: LegalAreaRef[] } {
  const sigungu = new Map<string, string>();
  const emd = new Map<string, string>();
  for (const hit of queryFeaturesInRadius(core, center, radiusM, ["legal_sigungu", "legal_emd"])) {
    if (!hit.legalCode) continue;
    if (hit.kind === "legal_sigungu") sigungu.set(hit.legalCode.slice(0, 5), hit.name ?? "");
    else emd.set(hit.legalCode.slice(0, 8), hit.name ?? "");
  }
  const sorted = (m: Map<string, string>) => [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, name]) => ({ code, name }));
  return { sigungu: sorted(sigungu), emd: sorted(emd) };
}

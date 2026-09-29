/**
 * 좌표가 있는 CSV 원천 → point feature. 원천마다 필드 이름만 다르다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { MeasureRecord } from "../../a0/measure";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";

type Props = Record<string, unknown>;

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const positive = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return str(v) !== null && Number.isFinite(n) && n > 0 ? n : null;
};
const firstToken = (v: unknown): string | null => str(v)?.split(/\s+/)[0] ?? null;

export interface PointSourceSpec {
  sourceId: string;
  kind: string;
  lngField: string;
  latField: string;
  fillFields: string[];
  idOf(p: Props): string | null;
  nameOf(p: Props): string | null;
  legalCodeOf(p: Props): string | null;
  regionOf(p: Props): string;
  typeOf(p: Props): string;
  propsOf(p: Props): Record<string, unknown>;
}

export const STORE_SPEC: PointSourceSpec = {
  sourceId: "store",
  kind: "store",
  lngField: "경도",
  latField: "위도",
  fillFields: ["상권업종소분류코드", "층정보"],
  idOf: (p) => str(p["상가업소번호"]),
  nameOf: (p) => [str(p["상호명"]), str(p["지점명"])].filter(Boolean).join(" ") || null,
  legalCodeOf: (p) => (/^\d{10}$/.test(str(p["법정동코드"]) ?? "") ? str(p["법정동코드"]) : null),
  regionOf: (p) => str(p["시도코드"]) ?? "(미상)",
  typeOf: (p) => str(p["상권업종대분류명"]) ?? "(미상)",
  propsOf: (p) => ({
    majorCategory: str(p["상권업종대분류명"]),
    midCategory: str(p["상권업종중분류명"]),
    minorCategory: str(p["상권업종소분류명"]),
    categoryCode: str(p["상권업종소분류코드"]),
    floor: str(p["층정보"]),
    address: str(p["도로명주소"]),
  }),
};

export const BUS_STOP_SPEC: PointSourceSpec = {
  sourceId: "bus_stop",
  kind: "bus_stop",
  lngField: "경도",
  latField: "위도",
  fillFields: ["정류장명", "모바일단축번호"],
  idOf: (p) => (str(p["정류장번호"]) ? `${str(p["도시코드"]) ?? "0"}:${str(p["정류장번호"])}` : null),
  nameOf: (p) => str(p["정류장명"]),
  legalCodeOf: () => null,
  regionOf: (p) => str(p["도시명"]) ?? "(미상)",
  typeOf: () => "bus_stop",
  propsOf: (p) => ({ cityCode: str(p["도시코드"]), cityName: str(p["도시명"]), stopNo: str(p["정류장번호"]), mobileNo: str(p["모바일단축번호"]), collectedAt: str(p["정보수집일"]) }),
};

export const PARK_SPEC: PointSourceSpec = {
  sourceId: "park",
  kind: "park",
  lngField: "경도",
  latField: "위도",
  fillFields: ["공원면적", "지정고시일"],
  idOf: (p) => str(p["관리번호"]),
  nameOf: (p) => str(p["공원명"]),
  legalCodeOf: () => null,
  regionOf: (p) => firstToken(p["소재지지번주소"]) ?? firstToken(p["소재지도로명주소"]) ?? "(미상)",
  typeOf: (p) => str(p["공원구분"]) ?? "(미상)",
  propsOf: (p) => ({ parkType: str(p["공원구분"]), areaM2: positive(p["공원면적"]), designatedAt: str(p["지정고시일"]), jibunAddress: str(p["소재지지번주소"]), roadAddress: str(p["소재지도로명주소"]) }),
};

export async function buildPointSource(db: BetterSqlite3.Database, spec: PointSourceSpec, records: AsyncIterable<MeasureRecord>, releaseId: string): Promise<SourceStats> {
  const stats = new SourceStats(spec.sourceId, releaseId, spec.fillFields);
  const seen = new Set<string>();
  await batched(db, records, (r) => {
    stats.read();
    const p = r.properties;
    const id = spec.idOf(p);
    const lng = Number(str(p[spec.lngField]));
    const lat = Number(str(p[spec.latField]));
    if (!id || seen.has(id) || str(p[spec.lngField]) === null || !(lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39)) return stats.reject();
    seen.add(id);
    insertFeature(db, {
      stableId: `${spec.kind}:${id}`,
      kind: spec.kind,
      sourceKey: id,
      releaseId,
      geometry: { type: "Point", coordinates: [lng, lat] },
      name: spec.nameOf(p),
      legalCode: spec.legalCodeOf(p),
      properties: spec.propsOf(p),
    });
    stats.accept(p, spec.regionOf(p), spec.typeOf(p));
  });
  return stats;
}

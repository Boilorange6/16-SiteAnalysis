/** 한국교육시설안전원 학구도 SHP → reference school_zone_* feature. */
import { readFileSync } from "node:fs";
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { crsFromPrj, readShp, type ShpRecord } from "../shp";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";

type Db = BetterSqlite3.Database;
type Props = Record<string, unknown>;

export const SCHOOL_ZONE_SOURCE_ID = "school_zone";

export const SCHOOL_ZONE_LAYERS = [
  { key: "elem", fileKey: "elem", kind: "school_zone_elem", title: "초등학교 학구도" },
  { key: "middle", fileKey: "middle", kind: "school_zone_middle", title: "중학교 학교군" },
  { key: "high", fileKey: "high", kind: "school_zone_high", title: "고등학교 학교군" },
] as const;

export type SchoolZoneLayerKey = (typeof SCHOOL_ZONE_LAYERS)[number]["key"];

/** 원 제공기관의 공공데이터 이용조건을 릴리스에 기록한다. */
export const SCHOOL_ZONE_RIGHTS = {
  provider: "한국교육시설안전원",
  service: "학구도안내서비스 공공데이터(SHP)",
  license: "이용허락범위 제한 없음(공공데이터포털 15159265·15159264·15159263)",
  attribution: "한국교육시설안전원 학구도안내서비스",
  sourceUrl: "https://schoolzone.emac.kr/publicData/publicDataList.do",
} as const;

export interface SchoolZoneLayerInput {
  layer: SchoolZoneLayerKey;
  releaseId: string;
  records: Iterable<ShpRecord> | AsyncIterable<ShpRecord>;
}

const str = (value: unknown): string | null => {
  const text = String(value ?? "").replace(/\u0000/g, "").trim();
  return text === "" ? null : text;
};

function isPolygonGeometry(geometry: Geometry | null | undefined): geometry is Polygon | MultiPolygon {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

function asMultiPolygon(geometry: Polygon | MultiPolygon): MultiPolygon {
  return geometry.type === "Polygon" ? { type: "MultiPolygon", coordinates: [geometry.coordinates] } : geometry;
}

function mergeGeometry(first: Polygon | MultiPolygon, next: Polygon | MultiPolygon): MultiPolygon {
  return {
    type: "MultiPolygon",
    coordinates: [...asMultiPolygon(first).coordinates, ...asMultiPolygon(next).coordinates],
  };
}

function regionOf(props: Props): string {
  const code = str(props.sd_cd);
  return code && /^\d{2}$/.test(code) ? code : "(미상)";
}

function typeOf(props: Props): string {
  return str(props.hakgudo_gb) ?? "(미상)";
}

function isoDate(value: unknown): string | null {
  const text = str(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : text && /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : null;
}

function normalizedProps(layer: SchoolZoneLayerKey, props: Props, objectIds: string[]): Props {
  const hakgudoId = str(props.hakgudo_id)!;
  const hakgudoNm = str(props.hakgudo_nm);
  const sdCd = str(props.sd_cd);
  const sggCd = str(props.sgg_cd);
  const eduUpNm = str(props.edu_up_nm);
  const eduNm = str(props.edu_nm);
  const baseDt = isoDate(props.base_dt);
  return {
    layer,
    hakgudo_id: hakgudoId,
    objectid: str(props.objectid),
    objectids: objectIds,
    hakgudo_nm: hakgudoNm,
    hakgudo_gb: str(props.hakgudo_gb),
    sd_cd: sdCd,
    sgg_cd: sggCd,
    edu_up_cd: str(props.edu_up_cd),
    edu_up_nm: eduUpNm,
    edu_cd: str(props.edu_cd),
    edu_nm: eduNm,
    base_dt: baseDt,
    hakgudoId,
    objectId: str(props.objectid),
    hakgudoName: hakgudoNm,
    zoneType: str(props.hakgudo_gb),
    sidoCode: sdCd,
    sigunguCode: sggCd,
    eduOffice: eduUpNm,
    eduSupportOffice: eduNm,
    baseDate: baseDt,
  };
}

/** SHP 원천의 EPSG:5186을 WGS84로 변환한다. insertFeature가 이를 EPSG:5179로 저장한다. */
export function readSchoolZoneShp(file: string): AsyncGenerator<ShpRecord> {
  const crs = crsFromPrj(readFileSync(file.replace(/\.shp$/i, ".prj"), "utf8"));
  return readShp(file, { crs, encoding: "euc-kr" });
}

/** DBF 대문자와 기존 소문자 속성을 같은 계약으로 정규화한다. */
function lowerProps(props: Props): Props {
  return Object.fromEntries(Object.entries(props).map(([key, value]) => [key.toLowerCase(), value]));
}

/** 릴리스 ID와 source_as_of에 쓰는 전체 레이어의 가장 늦은 기준일. */
export async function schoolZoneBaseDate(records: AsyncIterable<ShpRecord>): Promise<string | null> {
  let latest: string | null = null;
  for await (const record of records) {
    const date = isoDate(lowerProps(record.properties).base_dt);
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}

/** 동일 hakgudo_id에 여러 objectid 도형이 있으면 하나의 MultiPolygon으로 합친다. */
export async function buildSchoolZones(db: Db, layers: readonly SchoolZoneLayerInput[]): Promise<SourceStats[]> {
  const out: SourceStats[] = [];
  const usedStableIds = new Set<string>();
  for (const input of layers) {
    const spec = SCHOOL_ZONE_LAYERS.find((layer) => layer.key === input.layer);
    if (!spec) throw new Error(`unknown school-zone layer ${input.layer}`);
    const stats = new SourceStats(SCHOOL_ZONE_SOURCE_ID, input.releaseId, ["hakgudo_id", "hakgudo_nm", "edu_up_nm", "base_dt"]);
    const groups = new Map<string, { geometry: Polygon | MultiPolygon; props: Props; objectIds: string[] }>();
    await batched(db, input.records, (record) => {
      stats.read();
      const props = lowerProps(record.properties ?? {});
      const id = str(props.hakgudo_id);
      const objectId = str(props.objectid);
      if (!id || !objectId || !isPolygonGeometry(record.geometry)) return stats.reject();
      const current = groups.get(id);
      if (current) {
        current.geometry = mergeGeometry(current.geometry, record.geometry);
        if (!current.objectIds.includes(objectId)) current.objectIds.push(objectId);
      } else {
        groups.set(id, { geometry: record.geometry, props, objectIds: [objectId] });
      }
      stats.accept(props, regionOf(props), typeOf(props));
    }, 1000);
    for (const [id, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const stableId = `school_zone:${id}`;
      if (usedStableIds.has(stableId)) throw new Error(`duplicate school-zone stable id across layers: ${stableId}`);
      usedStableIds.add(stableId);
      const props = normalizedProps(input.layer, group.props, group.objectIds);
      const sd = str(group.props.sd_cd);
      const sgg = str(group.props.sgg_cd);
      const legalCode = sd && sgg && /^\d{2}$/.test(sd) && /^\d{3}$/.test(sgg) ? `${sd}${sgg}00000` : null;
      insertFeature(db, {
        stableId,
        kind: spec.kind,
        sourceKey: id,
        releaseId: input.releaseId,
        geometry: group.geometry,
        name: str(group.props.hakgudo_nm),
        legalCode,
        properties: props,
        roundM: 0.1,
      });
    }
    out.push(stats);
  }
  return out;
}

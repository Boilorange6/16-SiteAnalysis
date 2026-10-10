/** VWorld Data API 학교 학구도·학교군 GeoJSON → reference school_zone_* feature. */
import { readFileSync } from "node:fs";
import type BetterSqlite3 from "better-sqlite3";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";

type Db = BetterSqlite3.Database;
type Props = Record<string, unknown>;

export const SCHOOL_ZONE_SOURCE_ID = "school_zone";

export const SCHOOL_ZONE_LAYERS = [
  { key: "elem", apiLayer: "LT_C_DESCH", kind: "school_zone_elem", title: "초등학교 학구도" },
  { key: "middle", apiLayer: "LT_C_DMSCH", kind: "school_zone_middle", title: "중학교 학교군" },
  { key: "high", apiLayer: "LT_C_DHSCH", kind: "school_zone_high", title: "고등학교 학교군" },
] as const;

export type SchoolZoneLayerKey = (typeof SCHOOL_ZONE_LAYERS)[number]["key"];

/** VWorld 레이어와 같은 내부 사용 권한으로 원천 릴리스에 남긴다. */
export const SCHOOL_ZONE_RIGHTS = {
  provider: "국토교통부 VWorld",
  service: "VWorld Data API",
  layers: SCHOOL_ZONE_LAYERS.map((layer) => ({ id: layer.apiLayer, title: layer.title })),
  permission: "기존 VWorld 공간정보 레이어와 동일한 내부 업무용 이용 근거",
  attribution: "VWorld(국토교통부)",
  sourceUrl: "https://api.vworld.kr/req/data",
} as const;

export interface SchoolZoneLayerInput {
  layer: SchoolZoneLayerKey;
  releaseId: string;
  records: Iterable<Feature> | AsyncIterable<Feature>;
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

/** GeoJSON 파일을 읽되, API 응답 외의 구조는 조용히 삼키지 않는다. */
export function readSchoolZoneGeoJson(file: string): Feature[] {
  const json = JSON.parse(readFileSync(file, "utf8")) as FeatureCollection;
  if (json?.type !== "FeatureCollection" || !Array.isArray(json.features)) throw new Error(`invalid school-zone GeoJSON: ${file}`);
  return json.features;
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
      const props = (record.properties ?? {}) as Props;
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

/**
 * VWorld 일별용도지역지구정보(dsId 24)의 Q1 확정 전 구역·지구 및 도시계획시설 적재기.
 *
 * D11/D12의 제목 목록은 아직 확정되지 않았으므로 레이어 표는 비워 둔다. Q1 후에는
 * DISTRICT_LAYERS에 { key, sourceId, title, kind, cls, fileTag }를 채우거나, data-build가
 * fileTag와 레이어 메타데이터를 함께 DistrictLayerInput으로 넘기면 된다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry } from "geojson";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";
import { latestShpPerSido, type SidoShpSet } from "../shp-parts";
import { ZONING_RIGHTS } from "./zoning";

type Db = BetterSqlite3.Database;

export type DistrictLayerKind = "district_area" | "plan_facility";
export type DistrictShapeKind = "polygon" | "line" | "point";

/** Q1 확정 후 채울 레이어 정의. fileTag는 파일 태그 기반 resolver를 쓸 때만 필요하다. */
export interface DistrictLayerDefinition {
  key: string;
  sourceId: string;
  title: string;
  kind: DistrictLayerKind;
  cls: string;
  fileTag?: string;
}

/**
 * 제목·분류가 정해지기 전에는 임의의 VWorld 레이어를 등록하지 않는다.
 * sourceId 규칙은 buildDistricts의 동적 resolver에도 적용된다.
 */
export const DISTRICT_LAYERS: readonly DistrictLayerDefinition[] = [];

/** Q1 전에는 파일 태그로 key를 공급하므로 string이어야 한다. */
export type DistrictLayerKey = string;

/** source_release.rights_json에 기록할 dsId 24 이용 근거. */
export const DISTRICT_RIGHTS = {
  ...ZONING_RIGHTS,
  note: "D11/D12 구역·지구·도시계획시설도 VWorld dsId=24의 같은 이용 근거로 적재",
} as const;

export interface DistrictLayerFileSpec {
  key: DistrictLayerKey;
  fileTag: string;
}

/**
 * 기존 zoning/mzone의 { layer, releaseId, records } 입력을 유지한다.
 * Q1 전에는 layer를 문자열 접두사(district_<key>/facility_<key>)로 주거나,
 * layer 객체 또는 선택적 kind/cls/sourceId를 함께 주면 된다.
 */
export interface DistrictLayerInput {
  layer: DistrictLayerKey | DistrictLayerDefinition;
  releaseId: string;
  records: AsyncIterable<ShpRecord>;
  kind?: DistrictLayerKind;
  cls?: string;
  sourceId?: string;
  title?: string;
  fileTag?: string;
}

/**
 * 압축을 푼 파일들에서 지정한 fileTag의 최신 SHP 세트를 시도별로 고른다.
 * AL_Dxxx_00_YYYYMMDD.shp 같은 전국 파일은 반환 Map의 "00"을 사용하고,
 * 시도 분할 파일은 모든 시도 키를 그대로 순회한다.
 *
 * 두 번째 인자를 레이어 사양 배열로 주면 zoningLayerFiles와 같은
 * key → 전국 SidoShpSet 카탈로그도 만들 수 있다. Q1 전에는 보통 문자열 form을 쓴다.
 */
export function districtLayerFiles(paths: readonly string[], fileTag: string): Map<string, SidoShpSet>;
export function districtLayerFiles(paths: readonly string[], specs?: readonly DistrictLayerFileSpec[]): Map<DistrictLayerKey, SidoShpSet>;
export function districtLayerFiles(paths: readonly string[], selector?: string | readonly DistrictLayerFileSpec[]): Map<string, SidoShpSet> {
  // 수동 추출본과 extractAll 결과가 같은 basename을 가질 수 있으므로 한 번만 읽는다.
  const unique = [...new Map(paths.map((path) => [path.split(/[\\/]/).pop()!, path])).values()];
  if (typeof selector === "string") return latestShpPerSido(unique, selector);

  const specs = selector ?? DISTRICT_LAYERS.flatMap((layer) => layer.fileTag ? [{ key: layer.key, fileTag: layer.fileTag }] : []);
  const out = new Map<string, SidoShpSet>();
  for (const spec of specs) {
    const set = latestShpPerSido(unique, spec.fileTag).get("00");
    if (set) out.set(spec.key, set);
  }
  return out;
}

/** A7 고시일을 ISO 날짜로 바꾸되, 원문은 announcedRaw에 남긴다. */
function announcedDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/) ?? raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null;
}

function text(value: unknown): string | null {
  const raw = typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return raw === "" ? null : raw;
}

function shapeKind(geometry: Geometry | null): DistrictShapeKind | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") return "polygon";
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") return "line";
  if (geometry.type === "Point" || geometry.type === "MultiPoint") return "point";
  return null;
}

interface ResolvedDistrictLayer {
  key: DistrictLayerKey;
  sourceId: string;
  title: string;
  kind: DistrictLayerKind;
  cls: string;
}

function resolveLayer(input: DistrictLayerInput): ResolvedDistrictLayer {
  const supplied = typeof input.layer === "string" ? null : input.layer;
  const rawKey = supplied?.key ?? (typeof input.layer === "string" ? input.layer : input.layer.key);
  const configured = DISTRICT_LAYERS.find((layer) => layer.key === rawKey);
  const prefix = /^(district|facility|plan_facility)[_:](.+)$/.exec(rawKey);
  const key = configured?.key ?? supplied?.key ?? prefix?.[2] ?? rawKey;
  const inferredKind: DistrictLayerKind = prefix?.[1] === "facility" || prefix?.[1] === "plan_facility" ? "plan_facility" : "district_area";
  const kind = input.kind ?? supplied?.kind ?? configured?.kind ?? inferredKind;
  const sourcePrefix = kind === "plan_facility" ? "facility" : "district";
  const sourceId = input.sourceId ?? supplied?.sourceId ?? configured?.sourceId ?? `${sourcePrefix}_${key}`;
  return {
    key,
    sourceId,
    title: input.title ?? supplied?.title ?? configured?.title ?? sourceId,
    kind,
    cls: input.cls ?? supplied?.cls ?? configured?.cls ?? key,
  };
}

export interface DistrictFeatureProperties extends Record<string, unknown> {
  cls: string;
  layer: DistrictLayerKey;
  typeCode: string | null;
  typeLabel: string | null;
  announcedDate: string | null;
  announcedRaw: string | null;
  sigungu: string;
  featureId: string;
  sourceUpdatedAt: string | null;
  remark: string[];
  remarkA8: string | null;
  remarkA9: string | null;
  shapeKind: DistrictShapeKind;
  geometryType: Geometry["type"];
}

/**
 * D11/D12 SHP 레코드를 reference feature로 저장한다.
 * 구역·지구는 면만, 시설은 면·선·점을 허용한다. 같은 A1이 여러 도형으로
 * 나오는 원천은 기존 zoning/mzone 관례대로 stable id 뒤에 #순번을 붙여 모두 보존한다.
 */
export async function buildDistricts(db: Db, layers: readonly DistrictLayerInput[]): Promise<SourceStats[]> {
  const seen = new Map<string, number>();
  const out: SourceStats[] = [];

  for (const input of layers) {
    const layer = resolveLayer(input);
    const stats = new SourceStats(layer.sourceId, input.releaseId, ["typeCode", "typeLabel", "announcedDate", "sigungu", "remark"]);
    await batched(db, input.records, (record) => {
      stats.read();
      const p = record.properties;
      const geometry = record.geometry;
      const id = text(p.A1);
      const sigungu = text(p.A4);
      const kind = shapeKind(geometry);
      if (!geometry || !id || !sigungu || !/^\d{5}$/.test(sigungu) || !kind || (layer.kind === "district_area" && kind !== "polygon")) return stats.reject();

      const typeCode = text(p.A5);
      const typeLabel = text(p.A6);
      const remarkA8 = text(p.A8);
      const remarkA9 = text(p.A9);
      const properties: DistrictFeatureProperties = {
        cls: layer.cls,
        layer: layer.key,
        typeCode,
        typeLabel,
        announcedDate: announcedDate(p.A7),
        announcedRaw: text(p.A7),
        sigungu,
        featureId: id,
        sourceUpdatedAt: text(p.A3),
        remark: [remarkA8, remarkA9].filter((value): value is string => value !== null),
        remarkA8,
        remarkA9,
        shapeKind: kind,
        geometryType: geometry.type,
      };
      const stable = `${layer.kind === "district_area" ? "district" : "facility"}:${layer.key}:${id}`;
      const n = seen.get(stable) ?? 0;
      seen.set(stable, n + 1);

      try {
        // 경계·선형 시설의 원천 정밀도를 보존하기 위해 좌표 반올림(roundM)을 하지 않는다.
        insertFeature(db, {
          stableId: n === 0 ? stable : `${stable}#${n}`,
          kind: layer.kind,
          sourceKey: id,
          releaseId: input.releaseId,
          geometry,
          name: typeLabel,
          legalCode: `${sigungu}00000`,
          properties,
        });
      } catch (error) {
        if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return stats.reject();
        throw error;
      }
      stats.accept(properties, sigungu.slice(0, 2), layer.cls);
    }, 1000);
    out.push(stats);
  }
  return out;
}

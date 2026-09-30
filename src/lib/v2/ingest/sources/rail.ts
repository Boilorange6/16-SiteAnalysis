/**
 * 철도 원천 → feature. 기존 앱이 이미 가진 두 파일을 읽는다.
 *  - public/data/osm-subway.json  (OSM 스냅샷: 역·출입구·노선·역축) → rail_station / rail_entrance / rail_line
 *  - public/data/rail/planned.json (계획 철도 공개 투영)             → planned_rail_line / planned_rail_station
 * 시도(2자리) 코드는 core의 시군구 경계에서 찾는다(regionOf). 못 찾으면 "(미상)".
 */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry } from "geojson";
import { insertFeature, queryFeaturesInRadius } from "../../data/features";
import { batched, SourceStats } from "../build";

type Db = BetterSqlite3.Database;
type Json = Record<string, unknown>;

/** 경위도 → 시군구 법정동코드(10자리) 또는 null */
export type LegalCodeOf = (lng: number, lat: number) => string | null;

export const UNKNOWN_REGION = "(미상)";

/** core의 legal_sigungu 경계로 좌표의 법정코드를 찾는다. core가 없으면 항상 null. */
export function legalCodeFromCore(core: Db | null, radiusM = 50): LegalCodeOf {
  return (lng, lat) => {
    if (!core) return null;
    const hit = queryFeaturesInRadius(core, [lng, lat], radiusM, ["legal_sigungu"])[0];
    return hit?.legalCode ?? null;
  };
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
const inKorea = (lng: unknown, lat: unknown): lng is number =>
  typeof lng === "number" && typeof lat === "number" && lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39;
const regionOf = (code: string | null) => (code ? code.slice(0, 2) : UNKNOWN_REGION);
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

/** 선형 대표 좌표: 첫 점 */
function firstPoint(g: unknown): [number, number] | null {
  let c: unknown = (g as { coordinates?: unknown } | null)?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && inKorea(c[0], c[1]) ? [c[0] as number, c[1] as number] : null;
}
const isLine = (g: unknown): g is Geometry => {
  const t = (g as { type?: string } | null)?.type;
  return (t === "LineString" || t === "MultiLineString") && firstPoint(g) !== null;
};

/** 운영 역·출입구·노선. 역의 노선은 station_axes(역-노선 연결)에서 온다. */
export async function buildOsmSubway(db: Db, snapshot: Json, releaseId: string, legalCodeOf: LegalCodeOf): Promise<SourceStats[]> {
  const stationStats = new SourceStats("rail_station", releaseId, ["lineNames"]);
  const entranceStats = new SourceStats("rail_entrance", releaseId, []);
  const lineStats = new SourceStats("rail_line", releaseId, ["color"]);

  const linesByStation = new Map<string, Map<string, { ref: string; name: string; color: string | null }>>();
  for (const a of list(snapshot.station_axes)) {
    const id = str(a.station_osm_id);
    const ref = str(a.line_ref);
    if (!id || !ref) continue;
    const m = linesByStation.get(id) ?? new Map();
    m.set(`${ref}|${str(a.line_name)}`, { ref, name: str(a.line_name) ?? ref, color: str(a.color) });
    linesByStation.set(id, m);
  }

  const seen = new Set<string>();
  const place = (stats: SourceStats, kind: string, key: string | null, lng: unknown, lat: unknown, geometry: Geometry | null, name: string | null, props: Json, type: string) => {
    stats.read();
    const id = key ? `${kind}:${key}` : null;
    if (!id || !geometry || seen.has(id)) return stats.reject();
    const p = geometry.type === "Point" ? [lng as number, lat as number] : (firstPoint(geometry) as [number, number]);
    const code = legalCodeOf(p[0], p[1]);
    seen.add(id);
    insertFeature(db, { stableId: id, kind, sourceKey: key!, releaseId, geometry, name, legalCode: code, properties: props });
    stats.accept(props, regionOf(code), type);
  };
  const point = (o: Json): Geometry | null => (inKorea(o.lng, o.lat) ? { type: "Point", coordinates: [o.lng as number, o.lat as number] } : null);

  await batched(db, list(snapshot.stations), (s) => {
    const id = str(s.osm_id);
    const lines = [...(id ? linesByStation.get(id)?.values() ?? [] : [])].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
    place(stationStats, "rail_station", id, s.lng, s.lat, point(s), str(s.station_name), {
      lineRefs: lines.map((l) => l.ref),
      lineNames: lines.map((l) => l.name),
      lineColors: lines.map((l) => l.color),
      operator: str(s.operator), // 스냅샷에 없으면 null
    }, "station");
  });
  await batched(db, list(snapshot.entrances), (e) => {
    // osm_id가 없는 출입구도 있다 — 역명·출입구명·좌표로 결정적 키를 만든다
    const key = str(e.osm_id) ?? (str(e.station_name) && inKorea(e.lng, e.lat) ? `${str(e.station_name)}|${str(e.entrance_ref) ?? str(e.entrance_name) ?? ""}|${e.lng},${e.lat}` : null);
    place(entranceStats, "rail_entrance", key, e.lng, e.lat, point(e), str(e.entrance_name), { stationName: str(e.station_name), entranceRef: str(e.entrance_ref) }, "entrance");
  });
  await batched(db, list(snapshot.lines), (l) => {
    place(lineStats, "rail_line", str(l.osm_id), null, null, isLine(l.geometry) ? l.geometry : null, str(l.line_name), { lineRef: str(l.line_ref), color: str(l.color) }, "line");
  });
  return [stationStats, entranceStats, lineStats];
}

/**
 * 계획 철도 공개 투영(planned.json 배열). 날짜는 원천 문자열 그대로 둔다 — 일이 없으면 만들지 않는다.
 * 역(stations)은 공개 투영에서 비어 있어야 하지만(운영역 격리) 있으면 planned_rail_station으로 적재한다.
 */
export async function buildPlannedRail(db: Db, projects: Json[], releaseId: string, legalCodeOf: LegalCodeOf): Promise<SourceStats[]> {
  const lineStats = new SourceStats("planned_rail_line", releaseId, ["lifecycleStatus"]);
  const stationStats = new SourceStats("planned_rail_station", releaseId, []);
  const seen = new Set<string>();

  await batched(db, projects, (p) => {
    const pid = str(p.projectId);
    const common = {
      projectId: pid,
      lineName: str(p.lineName),
      lifecycleStatus: str(p.lifecycleStatus),
      segments: p.segments ?? null,
      sourceType: str(p.sourceType),
      confidenceLabel: str(p.confidenceLabel),
      sourceUrl: str(p.sourceUrl),
      geometrySourceUrl: str(p.geometrySourceUrl),
      geometrySourceLabel: str(p.geometrySourceLabel),
      statusEvidence: p.statusEvidence ?? [],
      geometryEvidence: p.geometryEvidence ?? [],
      reviewStatus: str(p.reviewStatus),
      nextReviewAt: str(p.nextReviewAt),
      lastVerifiedAt: str(p.lastVerifiedAt),
    };
    lineStats.read();
    const lineId = pid ? `planned_rail_line:${pid}` : null;
    if (!lineId || !isLine(p.geometry) || seen.has(lineId)) lineStats.reject();
    else {
      seen.add(lineId);
      const [lng, lat] = firstPoint(p.geometry)!;
      const code = legalCodeOf(lng, lat);
      insertFeature(db, { stableId: lineId, kind: "planned_rail_line", sourceKey: pid!, releaseId, geometry: p.geometry, name: str(p.lineName), legalCode: code, properties: common });
      lineStats.accept(common, regionOf(code), str(p.lifecycleStatus) ?? "(미상)");
    }
    for (const s of list(p.stations)) {
      stationStats.read();
      const name = str(s.name);
      const id = pid && name ? `planned_rail_station:${pid}:${name}` : null;
      if (!id || !inKorea(s.lng, s.lat) || seen.has(id)) {
        stationStats.reject();
        continue;
      }
      seen.add(id);
      const code = legalCodeOf(s.lng as number, s.lat as number);
      insertFeature(db, { stableId: id, kind: "planned_rail_station", sourceKey: `${pid}:${name}`, releaseId, geometry: { type: "Point", coordinates: [s.lng as number, s.lat as number] }, name, legalCode: code, properties: { projectId: pid, lineName: str(p.lineName), lifecycleStatus: str(p.lifecycleStatus), lastVerifiedAt: str(p.lastVerifiedAt) } });
      stationStats.accept({}, regionOf(code), str(p.lifecycleStatus) ?? "(미상)");
    }
  });
  return [lineStats, stationStats];
}

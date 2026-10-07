/**
 * GIS 건물 도형을 연속지적도 필지에 공간 조인한다.
 *
 * 필지 전체를 메모리에 올리지 않고 parcels.sqlite의 R*Tree bbox 후보만
 * 읽는다. 후보가 하나면 point-on-surface를 우선 사용하고, 경계에 걸친
 * 건물은 실제 교차 면적이 가장 큰 필지를 선택한다. 동률은 보수적으로
 * 미매칭 처리한다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import { booleanPointInPolygon, feature, featureCollection, intersect, pointOnFeature } from "@turf/turf";
import { projectGeometry } from "../../data/features";

type Db = BetterSqlite3.Database;
type Areal = Polygon | MultiPolygon;

export interface ParcelSpatialMatch {
  pnu: string;
  method: "point_on_surface" | "max_intersection";
  parcelVersion: string;
  intersectionAreaM2: number | null;
}

interface ParcelSpatialLookup {
  match(geometry: Geometry): ParcelSpatialMatch | null;
}

function positions(geometry: Geometry): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      out.push([value[0], value[1]]);
      return;
    }
    for (const child of value) walk(child);
  };
  if (geometry.type !== "GeometryCollection") walk(geometry.coordinates);
  return out;
}

function bbox(geometry: Geometry): [number, number, number, number] | null {
  const points = positions(geometry);
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

function planarArea(geometry: Geometry): number {
  const ringArea = (ring: readonly Position[]): number => {
    let sum = 0;
    for (let i = 0; i + 1 < ring.length; i += 1) sum += ring[i][0]! * ring[i + 1][1]! - ring[i + 1][0]! * ring[i][1]!;
    return Math.abs(sum) / 2;
  };
  if (geometry.type === "Polygon") return geometry.coordinates.reduce((sum, ring, index) => sum + (index === 0 ? 1 : -1) * ringArea(ring), 0);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.reduce((sum, polygon) => sum + polygon.reduce((part, ring, index) => part + (index === 0 ? 1 : -1) * ringArea(ring), 0), 0);
  return 0;
}

function intersectionArea(building: Areal, parcel: Areal): number {
  try {
    const result = intersect(featureCollection([feature(building), feature(parcel)])) as Feature<Areal> | null;
    return result ? Math.max(0, planarArea(result.geometry)) : 0;
  } catch {
    return 0;
  }
}

function asAreal(geometry: Geometry): Areal | null {
  return geometry.type === "Polygon" || geometry.type === "MultiPolygon" ? geometry : null;
}

/** 같은 parcels.sqlite의 버전 문자열을 함께 보존하는 공간 조인기. */
export function createParcelSpatialLookup(db: Db | null | undefined, parcelVersion: string | null | undefined): ParcelSpatialLookup | null {
  if (!db || !parcelVersion) return null;
  // queryFeaturesInBboxes는 범용 API라 매 호출마다 FeatureHit의 properties를
  // JSON parse한다. 전국 건물 1,700만 건에서는 PNU·도형만 필요한 전용
  // prepared statement가 훨씬 작고 빠르다.
  const query = db.prepare(`SELECT f.pnu, f.geom_json
    FROM feature_rtree r CROSS JOIN feature f ON f.feature_id = r.feature_id
    WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ? AND f.kind = 'parcel'`);
  return {
    match: (sourceGeometry) => {
      const projected = projectGeometry(sourceGeometry, undefined);
      const building = asAreal(projected);
      const bounds = bbox(projected);
      if (!building || !bounds) return null;
      const candidates = (query.all(bounds[0], bounds[1], bounds[2], bounds[3]) as Array<{ pnu: string | null; geom_json: string }>)
        .filter((row) => /^\d{19}$/.test(row.pnu ?? ""))
        .map((row) => {
          try {
            return { pnu: row.pnu!, geometry: asAreal(JSON.parse(row.geom_json) as Geometry) };
          } catch {
            return { pnu: row.pnu!, geometry: null };
          }
        })
        .filter((candidate): candidate is { pnu: string; geometry: Areal } => candidate.geometry !== null);
      if (candidates.length === 0) return null;

      let surfacePoint: ReturnType<typeof pointOnFeature> | null = null;
      try {
        surfacePoint = pointOnFeature(feature(building));
      } catch {
        surfacePoint = null;
      }
      const pointCandidates = surfacePoint
        ? candidates.filter((candidate) => {
          try {
            return booleanPointInPolygon(surfacePoint!, feature(candidate.geometry));
          } catch {
            return false;
          }
        })
        : [];

      // 하나의 필지만 후보면 point-on-surface를 증거로 삼는다. 후보가
      // 여러 개면 대형 건물의 경계 걸침을 고려해 교차 면적으로 재판정한다.
      if (candidates.length === 1 && pointCandidates.length === 1) {
        return {
          pnu: candidates[0].pnu!,
          method: "point_on_surface",
          parcelVersion,
          intersectionAreaM2: intersectionArea(building, candidates[0].geometry),
        };
      }

      const scored = candidates
        .map((candidate) => ({ candidate, area: intersectionArea(building, candidate.geometry) }))
        .filter((entry) => entry.area > 0)
        .sort((a, b) => b.area - a.area);
      if (scored.length === 0) return null;
      const best = scored[0];
      const second = scored[1];
      // 부동소수점 오차보다 작은 차이는 동률로 본다. 틀린 PNU를 넣는
      // 비용이 높으므로 애매한 경계는 미상으로 남긴다.
      if (second && Math.abs(best.area - second.area) <= Math.max(0.01, best.area * 1e-9)) return null;
      return {
        pnu: best.candidate.pnu!,
        method: "max_intersection",
        parcelVersion,
        intersectionAreaM2: best.area,
      };
    },
  };
}

export type { ParcelSpatialLookup };

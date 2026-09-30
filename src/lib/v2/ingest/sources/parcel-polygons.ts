/** 연속지적도(VWorld AL_D002) → kind `parcel` 도형 feature. */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry } from "geojson";
import { insertFeature, projectGeometry } from "../../data/features";
import { polygonArea, polygonParts } from "../../engine/tiles/geo";
import { batched, SourceStats } from "../build";
import { jimokOf } from "./parcels";
import type { ShpRecord } from "../shp";

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

/** A5(지번+지목)에서 지번만 분리한다. 산지는 산 접두어를 유지한다. */
export function jibunOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = /^(산\s*)?([\d-]+)\s*[^\d\s-]+$/.exec(raw);
  return match ? `${match[1] ? "산" : ""}${match[2]}` : null;
}

function isPolygonal(geometry: Geometry | null): geometry is Geometry & ({ type: "Polygon" } | { type: "MultiPolygon" }) {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

function areaM2(geometry: Geometry): number | null {
  try {
    const projected = projectGeometry(geometry, 0.01);
    if (!isPolygonal(projected)) return null;
    const area = polygonParts(projected).reduce((sum, rings) => sum + polygonArea(rings), 0);
    return Number.isFinite(area) && area > 0 ? Math.round(area * 10) / 10 : null;
  } catch {
    return null;
  }
}

export interface ParcelPolygonProperties extends Record<string, unknown> {
  jimok: string | null;
  jibun: string | null;
  sigungu: string | null;
  areaM2: number;
  mountain: boolean;
}

export async function buildParcelPolygons(
  db: BetterSqlite3.Database,
  records: AsyncIterable<ShpRecord>,
  releaseId: string,
): Promise<SourceStats> {
  const stats = new SourceStats("parcel_polygon", releaseId, ["jimok", "jibun", "sigungu", "areaM2"]);

  await batched(db, records, (record) => {
    stats.read();
    const p = record.properties;
    const pnu = typeof p.A1 === "string" && /^\d{19}$/.test(p.A1) ? p.A1 : null;
    if (!pnu || !isPolygonal(record.geometry)) return stats.reject();

    const area = areaM2(record.geometry);
    if (area === null) return stats.reject();
    const name = text(p.A5);
    const properties: ParcelPolygonProperties = {
      jimok: jimokOf(p.A5),
      jibun: jibunOf(p.A5),
      sigungu: text(p.A7),
      areaM2: area,
      mountain: typeof p.A5 === "string" && /^산/.test(p.A5.trim()),
    };
    try {
      insertFeature(db, {
        stableId: `parcel:${pnu}`,
        kind: "parcel",
        sourceKey: pnu,
        releaseId,
        geometry: record.geometry,
        name,
        pnu,
        legalCode: text(p.A2),
        properties,
        roundM: 0.01,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return stats.reject();
      throw error;
    }
    stats.accept(properties, pnu.slice(0, 2), properties.jimok ?? "(미상)");
  });
  return stats;
}

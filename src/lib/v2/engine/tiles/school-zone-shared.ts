/** A02·D26 공통: 대지 중심에 포함되는 VWorld 학교 학구도·학교군과 학교 링크. */
import { booleanPointInPolygon } from "@turf/turf";
import { toUtmk } from "../../crs";
import type { FeatureHit } from "../../data/features";
import type { EngineContext } from "../context";

export const SCHOOL_ZONE_SOURCE = "school_zone";
export const SCHOOL_ZONE_KINDS = ["school_zone_elem", "school_zone_middle", "school_zone_high"] as const;
export type SchoolZoneKind = (typeof SCHOOL_ZONE_KINDS)[number];

const kindLevel: Record<SchoolZoneKind, "elem" | "middle" | "high"> = {
  school_zone_elem: "elem",
  school_zone_middle: "middle",
  school_zone_high: "high",
};

export function levelOf(kind: SchoolZoneKind): "elem" | "middle" | "high" {
  return kindLevel[kind];
}

export function schoolZoneSources(ctx: EngineContext) {
  return ctx.sources("reference", [SCHOOL_ZONE_SOURCE]);
}

function containsCenter(ctx: EngineContext, hit: FeatureHit): boolean {
  const xy = toUtmk(ctx.input.center);
  try {
    return booleanPointInPolygon(xy as [number, number], { type: "Feature", properties: {}, geometry: hit.geometry } as never);
  } catch {
    return false;
  }
}

/** 반경 50m 후보 중 중심점을 실제로 포함하는 학구도·학교군. */
export function siteZones(ctx: EngineContext): Map<SchoolZoneKind, FeatureHit[]> {
  return ctx.memo("school-zone:site:v1", () => {
    const byKind = new Map<SchoolZoneKind, FeatureHit[]>();
    for (const kind of SCHOOL_ZONE_KINDS) {
      byKind.set(kind, ctx.hits("reference", [kind], 50).filter((hit) => containsCenter(ctx, hit)));
    }
    return byKind;
  });
}

export function zoneName(hit: FeatureHit): string {
  return String(hit.properties.hakgudoName ?? hit.properties.hakgudo_nm ?? hit.name ?? "이름 없음");
}

export function zoneOffice(hit: FeatureHit): string {
  return String(hit.properties.eduOffice ?? hit.properties.edu_up_nm ?? "교육청 미상");
}

export function zoneSupportOffice(hit: FeatureHit): string {
  return String(hit.properties.eduSupportOffice ?? hit.properties.edu_nm ?? "");
}

export function zoneBaseDate(hit: FeatureHit | undefined): string | null {
  if (!hit) return null;
  const value = hit.properties.baseDate ?? hit.properties.base_dt;
  return typeof value === "string" && value !== "" ? value : null;
}

export function zoneLabel(hit: FeatureHit): string {
  return `${zoneName(hit)} · ${zoneOffice(hit)}`;
}

export interface AssignedSchool {
  stableId: string;
  name: string;
  level: string | null;
  operatingStatus: string | null;
}

/** school:<id> —serves_zone→ school_zone:<id> 링크를 읽는다. */
export function assignedSchools(ctx: EngineContext, zones: readonly FeatureHit[], level: "elem" | "middle" | "high" | null = null): AssignedSchool[] {
  const db = ctx.db("reference");
  if (!db || zones.length === 0) return [];
  const ids = [...new Set(zones.map((zone) => zone.stableId))];
  const rows = db.prepare(`
    SELECT f.stable_id, f.name, f.properties_json
    FROM feature_link l
    JOIN feature f ON f.stable_id = l.from_stable_id
    WHERE l.relation_type = 'serves_zone'
      AND f.kind = 'school'
      AND l.to_stable_id IN (${ids.map(() => "?").join(",")})
    ORDER BY f.feature_id
  `).all(...ids) as Array<{ stable_id: string; name: string | null; properties_json: string }>;
  const out: AssignedSchool[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.stable_id)) continue;
    const props = JSON.parse(row.properties_json) as Record<string, unknown>;
    const schoolLevel = typeof props.level === "string" ? props.level : null;
    if (level === "elem" && schoolLevel !== "초등학교") continue;
    if (level === "middle" && schoolLevel !== "중학교") continue;
    if (level === "high" && schoolLevel !== "고등학교") continue;
    if (props.operatingStatus !== "운영") continue;
    seen.add(row.stable_id);
    out.push({ stableId: row.stable_id, name: row.name ?? "학교명 미상", level: schoolLevel, operatingStatus: typeof props.operatingStatus === "string" ? props.operatingStatus : null });
  }
  return out;
}

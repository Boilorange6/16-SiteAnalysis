import { booleanPointInPolygon } from "@turf/turf";
import type { Geometry } from "geojson";
import { toLngLat, toUtmk } from "../../crs";
import type { FeatureHit } from "../../data/features";
import { sourceLineOf } from "../../ui/tile-view";
import { catalogEntry } from "../../ui/tile-catalog";
import type { DetailCard, DetailColumn, DetailRow, DetailSpec, DetailContext } from "./registry";
import { areaInCircle, polygonArea, lineLengthInCircle } from "../tiles/geo";
import { buildingRows, isCounted } from "../tiles/buildings-shared";
import { hitPoint } from "../tiles/common";
import { SCHOOL_ZONE_KINDS, schoolZoneSources, zoneBaseDate, zoneName, zoneOffice } from "../tiles/school-zone-shared";
import { collectMaintenance, collectMaintenanceRoster, maintenanceSources, STAGES, type Project } from "../../tile/a09/engine";
import { layerStyle } from "../../ui/map-layers";

const ZONING_SOURCES = ["zoning_urban", "zoning_management", "zoning_agri_forest", "zoning_nature", "zoning_other"] as const;
const ZONE_COLORS: Record<string, string> = {
  주거: "#2563EB",
  주거지역: "#2563EB",
  상업: "#EA580C",
  상업지역: "#EA580C",
  공업: "#64748B",
  녹지: "#15803D",
  녹지지역: "#15803D",
  관리: "#A16207",
  기타: "#6B7280",
};

export const ZONE_COLUMNS: DetailColumn[] = [
  { key: "name", label: "이름", kind: "text" },
  { key: "class", label: "분류", kind: "category" },
  { key: "area_m2", label: "틀 안 면적(㎡)", kind: "number" },
  { key: "share_pct", label: "비율(%)", kind: "number" },
  { key: "buildings", label: "건물 수", kind: "number" },
  { key: "pieces", label: "조각 수", kind: "number" },
  { key: "source", label: "자료", kind: "text", csvOnly: true },
  { key: "decision_area_m2", label: "결정 면적(㎡)", kind: "number", csvOnly: true },
  { key: "execution", label: "집행", kind: "text", csvOnly: true },
];

export const FACILITY_COLUMNS: DetailColumn[] = [
  ...ZONE_COLUMNS,
  { key: "shape", label: "형상", kind: "category", csvOnly: true },
  { key: "length_m", label: "길이(m)", kind: "number", csvOnly: true },
  { key: "count", label: "개수", kind: "number", csvOnly: true },
  { key: "remark", label: "비고", kind: "text", csvOnly: true },
];

export const SCHOOL_COLUMNS: DetailColumn[] = [
  { key: "name", label: "학구명", kind: "text" },
  { key: "level", label: "구분", kind: "category" },
  { key: "office", label: "교육청", kind: "text" },
  { key: "area_m2", label: "반경 교차면적(㎡)", kind: "number" },
  { key: "base_date", label: "기준일", kind: "date" },
];

export const POPULATION_COLUMNS: DetailColumn[] = [
  { key: "density_band", label: "밀도 구간", kind: "category" },
  { key: "population", label: "인구", kind: "number" },
  { key: "area_m2", label: "교차 면적(㎡)", kind: "number" },
  { key: "share_pct", label: "비율(%)", kind: "number" },
  { key: "data_year", label: "기준 연도", kind: "date" },
];

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceIdsWithPrefix(ctx: DetailContext, key: "reference" | "market", prefix: string): string[] {
  const db = ctx.db(key);
  if (!db) return [];
  const rows = db.prepare("SELECT source_id FROM source_release WHERE source_id LIKE ? ORDER BY source_id").all(`${prefix}%`) as Array<{ source_id: string }>;
  return rows.map((row) => row.source_id);
}

function sourceLine(ctx: DetailContext, key: "reference" | "market", ids: readonly string[]): string {
  return sourceLineOf(ctx.sources(key, ids));
}

function shapeParts(geometry: Geometry): number[][][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates as number[][][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as number[][][][];
  return [];
}

function pieceCount(geometry: Geometry): number {
  const parts = shapeParts(geometry);
  return parts.length || (geometry.type === "Polygon" ? 1 : 0);
}

function classOf(hit: FeatureHit): string {
  return text(hit.properties.zoningClass)
    ?? text(hit.properties.typeLabel)
    ?? text(hit.properties.class)
    ?? text(hit.properties.cls)
    ?? "기타";
}

function nameOf(hit: FeatureHit): string {
  return text(hit.properties.zoningName)
    ?? text(hit.properties.hakgudoName)
    ?? text(hit.properties.hakgudo_nm)
    ?? text(hit.name)
    ?? "이름 없음";
}

function pointInGeometry(lng: number, lat: number, geometry: Geometry): boolean {
  const [x, y] = toUtmk([lng, lat]);
  try {
    if (geometry.type === "Point") {
      const [px, py] = geometry.coordinates as number[];
      return Math.hypot(px - x, py - y) <= 1;
    }
    if (geometry.type === "LineString" || geometry.type === "MultiLineString") return false;
    return booleanPointInPolygon([x, y] as [number, number], { type: "Feature", properties: {}, geometry } as never);
  } catch {
    return false;
  }
}

function ringCentroid(ring: number[][]): { area: number; x: number; y: number } | null {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 1; index < ring.length; index++) {
    const [ax, ay] = ring[index - 1];
    const [bx, by] = ring[index];
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    x += (ax + bx) * cross;
    y += (ay + by) * cross;
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) < 1e-9) return null;
  return { area: Math.abs(twiceArea) / 2, x: x / (3 * twiceArea), y: y / (3 * twiceArea) };
}

/** 건물 수는 대표점(bbox 중심)이 아닌 실제 면적 중심을 구역에 대조한다. */
function buildingCentroid(hit: FeatureHit): [number, number] {
  const parts = shapeParts(hit.geometry);
  let areaTotal = 0;
  let xTotal = 0;
  let yTotal = 0;
  for (const rings of parts) {
    const outer = ringCentroid(rings[0] ?? []);
    if (!outer) continue;
    let area = outer.area;
    let x = outer.x * outer.area;
    let y = outer.y * outer.area;
    for (const hole of rings.slice(1)) {
      const inner = ringCentroid(hole);
      if (!inner) continue;
      area -= inner.area;
      x -= inner.x * inner.area;
      y -= inner.y * inner.area;
    }
    if (area > 0) {
      areaTotal += area;
      xTotal += x;
      yTotal += y;
    }
  }
  if (areaTotal > 0) return [...toLngLat([xTotal / areaTotal, yTotal / areaTotal])] as [number, number];
  return hitPoint(hit);
}

function buildingCount(ctx: DetailContext, geometry: Geometry): number | null {
  const rows = ctx.memo("detail:zone-building-rows", () => buildingRows(ctx))?.filter((row) => isCounted(ctx, row)) ?? null;
  if (rows === null) return null;
  let count = 0;
  for (const row of rows) {
    const [lng, lat] = buildingCentroid(row.hit);
    if (pointInGeometry(lng, lat, geometry)) count++;
  }
  return count;
}

function sourceIdOf(ctx: DetailContext, key: "reference" | "market", hit: FeatureHit): string {
  return ctx.memo(`detail:source-id:${key}:${hit.releaseId}`, () => {
    try {
      const row = ctx.db(key)?.prepare("SELECT source_id FROM source_release WHERE release_id = ?").get(hit.releaseId) as { source_id?: string } | undefined;
      return text(row?.source_id) ?? hit.releaseId;
    } catch {
      return hit.releaseId;
    }
  });
}

function rawZoneRow(ctx: DetailContext, hit: FeatureHit, sourceKey: "reference" | "market" = "reference"): DetailRow {
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
  const area = clipped?.areaM2 ?? 0;
  const [lng, lat] = hitPoint(hit);
  return {
    fid: String(hit.featureId),
    lng,
    lat,
    cells: {
      name: nameOf(hit),
      class: classOf(hit),
      area_m2: area,
      share_pct: circleArea > 0 ? (area / circleArea) * 100 : null,
      buildings: buildingCount(ctx, hit.geometry),
      pieces: pieceCount(hit.geometry),
      source: sourceIdOf(ctx, sourceKey, hit),
      decision_area_m2: number(hit.properties.decisionAreaM2) ?? number(hit.properties.decision_area_m2),
      execution: text(hit.properties.execution) ?? text(hit.properties.implementation),
    },
  };
}

interface ZoneGroup {
  name: string;
  sourceId: string;
  hits: FeatureHit[];
}

function zoneGroups(ctx: DetailContext, hits: readonly FeatureHit[], sourceKey: "reference" | "market"): ZoneGroup[] {
  const groups = new Map<string, ZoneGroup>();
  for (const hit of hits) {
    const name = nameOf(hit);
    const sourceId = sourceIdOf(ctx, sourceKey, hit);
    const key = `${sourceId}\u0000${name}`;
    const group = groups.get(key);
    if (group) group.hits.push(hit);
    else groups.set(key, { name, sourceId, hits: [hit] });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "ko-KR") || a.sourceId.localeCompare(b.sourceId, "en"));
}

function groupBuildings(ctx: DetailContext, hits: readonly FeatureHit[]): number | null {
  const rows = ctx.memo("detail:zone-building-rows", () => buildingRows(ctx))?.filter((row) => isCounted(ctx, row)) ?? null;
  if (rows === null) return null;
  let count = 0;
  for (const row of rows) {
    const [lng, lat] = buildingCentroid(row.hit);
    if (hits.some((hit) => pointInGeometry(lng, lat, hit.geometry))) count++;
  }
  return count;
}

function aggregateNumber(hits: readonly FeatureHit[], keys: readonly string[]): number | null {
  const values = hits.map((hit) => keys.map((key) => number(hit.properties[key])).find((value): value is number => value !== null)).filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

function aggregateText(hits: readonly FeatureHit[], keys: readonly string[]): string | null {
  const values = [...new Set(hits.flatMap((hit) => keys.map((key) => text(hit.properties[key]))).filter((value): value is string => value !== null))];
  return values.length > 0 ? values.join(" / ") : null;
}

function facilityCells(ctx: DetailContext, hits: readonly FeatureHit[]): Record<string, string | number | null> {
  const shapes = [...new Set(hits.map((hit) => hit.geometry.type === "Polygon" || hit.geometry.type === "MultiPolygon" ? "면" : hit.geometry.type.includes("Line") ? "선" : "점"))];
  const lengths = hits.map((hit) => hit.geometry.type.includes("Line") ? lineLengthInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry) : null).filter((value): value is number => value !== null);
  const pointCount = hits.filter((hit) => hit.geometry.type === "Point" || hit.geometry.type === "MultiPoint").length;
  return {
    shape: shapes.join(" / ") || null,
    length_m: lengths.length > 0 ? lengths.reduce((sum, value) => sum + value, 0) : null,
    count: pointCount > 0 ? pointCount : null,
    remark: aggregateText(hits, ["remark", "remarkA8", "remarkA9"]),
  };
}

function aggregateZoneRows(ctx: DetailContext, hits: readonly FeatureHit[], sourceKey: "reference" | "market", facility = false): DetailRow[] {
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  return zoneGroups(ctx, hits, sourceKey).map((group) => {
    const fids = group.hits.map((hit) => String(hit.featureId));
    const area = group.hits.reduce((sum, hit) => sum + (areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry)?.areaM2 ?? 0), 0);
    const classes = [...new Set(group.hits.map(classOf))];
    const cells: Record<string, string | number | null> = {
      name: group.name,
      class: classes.join(" / "),
      area_m2: area,
      share_pct: circleArea > 0 ? (area / circleArea) * 100 : null,
      buildings: groupBuildings(ctx, group.hits),
      pieces: group.hits.reduce((sum, hit) => sum + pieceCount(hit.geometry), 0),
      source: group.sourceId,
      decision_area_m2: aggregateNumber(group.hits, ["decisionAreaM2", "decision_area_m2"]),
      execution: aggregateText(group.hits, ["execution", "implementation"]),
    };
    if (facility) Object.assign(cells, facilityCells(ctx, group.hits));
    const [lng, lat] = hitPoint(group.hits[0]);
    return { fid: fids[0], fids, lng, lat, cells };
  });
}

function zoneCard(ctx: DetailContext, hit: FeatureHit, columns: DetailColumn[] = ZONE_COLUMNS, source = ""): DetailCard {
  const row = rawZoneRow(ctx, hit);
  const cells = row.cells;
  const missing = columns === FACILITY_COLUMNS
    ? [
      ...(cells.decision_area_m2 === null ? ["결정 면적"] : []),
      ...(cells.execution === null ? ["집행"] : []),
    ]
    : [];
  return {
    title: String(cells.name ?? "이름 없음"),
    subtitle: String(cells.class ?? "기타"),
    chip: { label: String(cells.class ?? "기타"), color: ZONE_COLORS[String(cells.class)] ?? ZONE_COLORS.기타 },
    fields: [
      { label: "틀 안 면적", value: typeof cells.area_m2 === "number" ? `${cells.area_m2}㎡` : null },
      { label: "비율", value: typeof cells.share_pct === "number" ? `${cells.share_pct}%` : null },
      { label: "건물", value: cells.buildings === null ? null : `${cells.buildings}동` },
      { label: "조각", value: cells.pieces === null ? null : `${cells.pieces}곳` },
    ],
    source: source || sourceLineOf([
      ...ctx.sources("reference", ZONING_SOURCES),
      ...ctx.sources("reference", sourceIdsWithPrefix(ctx, "reference", "district_")),
    ]),
    ...(missing.length > 0 ? { missing } : {}),
  };
}

function featureSpec(
  code: "A12" | "D11",
  hitsFor: (ctx: DetailContext) => FeatureHit[],
  sourcesFor: (ctx: DetailContext) => ReturnType<DetailContext["sources"]>,
): DetailSpec {
  return {
    columns: ZONE_COLUMNS,
    summary(ctx) {
      const hits = hitsFor(ctx);
      const rows = aggregateZoneRows(ctx, hits, "reference");
      const area = rows.reduce((sum, row) => sum + (number(row.cells.area_m2) ?? 0), 0);
      return {
        title: catalogEntry(code).title,
        subtitle: `${rows.length.toLocaleString("ko-KR")}곳`,
        fields: [
          { label: "틀 안 면적 합계", value: area > 0 ? `${Math.round(area)}㎡` : null },
          { label: "구역 수", value: `${rows.length.toLocaleString("ko-KR")}곳` },
        ],
        source: sourceLineOf(sourcesFor(ctx)),
      };
    },
    rows(ctx) {
      return aggregateZoneRows(ctx, hitsFor(ctx), "reference");
    },
    at(ctx, lng, lat) {
      const hits = hitsFor(ctx);
      const hit = hits.find((candidate) => pointInGeometry(lng, lat, candidate.geometry));
      if (!hit) return null;
      const group = zoneGroups(ctx, hits, "reference").find((candidate) => candidate.hits.some((piece) => piece.featureId === hit.featureId));
      return { card: zoneCard(ctx, hit, ZONE_COLUMNS, sourceLineOf(sourcesFor(ctx))), fid: String(hit.featureId), fids: group?.hits.map((piece) => String(piece.featureId)) ?? [String(hit.featureId)] };
    },
  };
}

function zoningHits(ctx: DetailContext): FeatureHit[] {
  // 우산 도형도 Sitedia의 용도지역 집계 한 줄로 노출한다. 세부 도형과의 겹침은 원천 그대로 보존한다.
  return ctx.hits("reference", ["zoning_area"]);
}

function districtHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("reference", ["district_area"]);
}

const MAINTENANCE_COLUMNS: DetailColumn[] = [
  { key: "name", label: "사업명", kind: "text" },
  { key: "type", label: "종류", kind: "category" },
  { key: "stage", label: "단계", kind: "category" },
  { key: "households", label: "예정 세대", kind: "number" },
  { key: "area_m2", label: "반경 안 면적(㎡)", kind: "number" },
  { key: "announced_date", label: "결정고시일", kind: "date", csvOnly: true },
  { key: "designated_at", label: "구역지정일", kind: "date", csvOnly: true },
  { key: "operator", label: "시행자", kind: "text", csvOnly: true },
  { key: "zone_area_m2", label: "구역 전체 면적(㎡)", kind: "number", csvOnly: true },
  { key: "raw_stage", label: "원천 단계", kind: "text", csvOnly: true },
  { key: "zone_type", label: "구역 레이어 유형 원문", kind: "text", csvOnly: true },
  { key: "linked", label: "명부 연결", kind: "category", csvOnly: true },
  { key: "source", label: "자료", kind: "text", csvOnly: true },
];

const MAINTENANCE_LAYERS: Record<string, string> = { zone: "정비구역", redevelopment: "재개발구역", promotion: "재정비촉진지구", planned: "정비계획을수립중인지역", improvement: "주거환경개선지구" };
const maintenanceName = (project: Project) => project.name ?? `이름 없는 정비구역${project.announcedDate ? ` · 고시 ${project.announcedDate}` : ""}`;

function maintenanceRows(ctx: DetailContext): DetailRow[] {
  const collection = collectMaintenance(ctx);
  if (!collection) return [];
  const source = sourceLineOf(maintenanceSources(ctx));
  return [...collection.projects.values()].map((project) => {
    const hits = collection.zones.filter((hit) => collection.zoneProject.get(hit.featureId) === project.key);
    const fids = hits.map((hit) => String(hit.featureId));
    const clipped = hits.map((hit) => areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry));
    const parts = hits.map((hit) => shapeParts(hit.geometry));
    const [lng, lat] = hitPoint(hits[0]);
    return { fid: fids[0], fids, lng, lat, cells: {
      name: maintenanceName(project), type: project.type, stage: project.stage, households: project.households,
      area_m2: clipped.every((value) => value !== null) ? clipped.reduce((sum, value) => sum + (value?.areaM2 ?? 0), 0) : null,
      announced_date: project.announcedDate, designated_at: project.designatedAt, operator: project.operator,
      zone_area_m2: parts.every((value) => value.length > 0) ? parts.flat().reduce((sum, rings) => sum + polygonArea(rings), 0) : null,
      raw_stage: project.rawStage,
      zone_type: [...new Set(hits.map((hit) => MAINTENANCE_LAYERS[String(hit.properties.layer)]).filter(Boolean))].join(" / ") || null,
      linked: project.linked ? "연결" : "미연결", source,
    } };
  });
}

function maintenanceSpec(): DetailSpec {
  return {
    columns: MAINTENANCE_COLUMNS,
    summary(ctx) {
      const collection = collectMaintenance(ctx);
      const projects = [...(collection?.projects.values() ?? [])];
      const stages = STAGES.map((stage) => [stage, projects.filter((p) => p.stage === stage).length] as const).filter(([, count]) => count > 0);
      const types = [...new Set(projects.map((p) => p.type))].sort().map((type) => [type, projects.filter((p) => p.type === type).length] as const);
      const known = projects.filter((p) => p.households !== null);
      const linkedIds = new Set(collection ? (ctx.db(collection.key)?.prepare("SELECT DISTINCT to_stable_id FROM feature_link WHERE relation_type = 'zone_of_project'").all() as Array<{ to_stable_id: string }> ?? []).map((row) => row.to_stable_id) : []);
      const unlocated = collectMaintenanceRoster(ctx).filter((p) => !linkedIds.has(p.key)).length;
      return { title: "정비사업", subtitle: `사업 ${projects.length}건 · 구역 ${collection?.zones.length ?? 0}곳`, fields: [
        { label: "단계별", value: stages.map(([stage, count]) => `${stage} ${count}`).join(" · ") || null },
        { label: "종류별", value: types.map(([type, count]) => `${type} ${count}`).join(" · ") || null },
        { label: "예정 세대 합", value: known.length ? `${known.reduce((sum, p) => sum + (p.households ?? 0), 0).toLocaleString("ko-KR")}세대 (알려진 ${known.length}건)` : null },
        { label: "위치 미확인 명부 사업", value: `${unlocated}건` },
      ], source: sourceLineOf(maintenanceSources(ctx)) };
    },
    rows: maintenanceRows,
    at(ctx, lng, lat) {
      const collection = collectMaintenance(ctx);
      const hit = collection?.zones.find((item) => pointInGeometry(lng, lat, item.geometry));
      if (!collection || !hit) return null;
      const row = maintenanceRows(ctx).find((item) => item.fids?.includes(String(hit.featureId)));
      if (!row) return null;
      const cells = row.cells;
      const fields = [
        { label: "종류", value: text(cells.type) }, { label: "단계", value: text(cells.stage) },
        { label: "결정고시일", value: text(cells.announced_date) }, { label: "구역지정일", value: text(cells.designated_at) },
        { label: "예정 세대", value: cells.households === null ? null : `${cells.households}세대` },
        { label: "시행자", value: text(cells.operator) },
        { label: "구역 전체 면적", value: cells.zone_area_m2 === null ? null : `${cells.zone_area_m2}㎡` },
        { label: "반경 안 면적", value: cells.area_m2 === null ? null : `${cells.area_m2}㎡` },
      ];
      return { fid: String(hit.featureId), fids: row.fids, card: { title: String(cells.name), subtitle: `${cells.type} · ${cells.stage}`, chip: { label: String(cells.stage), color: layerStyle(`maint_stage:${cells.stage}`).color }, fields, missing: fields.filter((field) => field.value === null).map((field) => field.label), source: sourceLineOf(maintenanceSources(ctx)) } };
    },
  };
}

function facilityHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("reference", ["plan_facility"]);
}

function facilitySpec(): DetailSpec {
  return {
    columns: FACILITY_COLUMNS,
    summary(ctx) {
      const rows = aggregateZoneRows(ctx, facilityHits(ctx), "reference", true);
      const area = rows.reduce((sum, row) => sum + (number(row.cells.area_m2) ?? 0), 0);
      return { title: catalogEntry("D12").title, subtitle: `${rows.length.toLocaleString("ko-KR")}곳`, fields: [{ label: "틀 안 면적 합계", value: area > 0 ? `${Math.round(area)}㎡` : null }, { label: "시설 구역 수", value: `${rows.length.toLocaleString("ko-KR")}곳` }], source: sourceLine(ctx, "reference", sourceIdsWithPrefix(ctx, "reference", "facility_")) };
    },
    rows(ctx) { return aggregateZoneRows(ctx, facilityHits(ctx), "reference", true); },
    at(ctx, lng, lat) {
      const hits = facilityHits(ctx);
      const hit = hits.find((candidate) => pointInGeometry(lng, lat, candidate.geometry));
      if (!hit) return null;
      const group = zoneGroups(ctx, hits, "reference").find((candidate) => candidate.hits.some((piece) => piece.featureId === hit.featureId));
      return { card: zoneCard(ctx, hit, FACILITY_COLUMNS, sourceLine(ctx, "reference", sourceIdsWithPrefix(ctx, "reference", "facility_"))), fid: String(hit.featureId), fids: group?.hits.map((piece) => String(piece.featureId)) ?? [String(hit.featureId)] };
    },
  };
}

function schoolHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("reference", [...SCHOOL_ZONE_KINDS]);
}

function schoolRows(ctx: DetailContext, hits: readonly FeatureHit[]): DetailRow[] {
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  const baseDate = schoolZoneSources(ctx).map((source) => source.sourceAsOf).filter((value): value is string => value !== null).sort().at(-1) ?? zoneBaseDate(hits[0]);
  return hits.map((hit) => {
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    const [lng, lat] = hitPoint(hit);
    return { fid: String(hit.featureId), lng, lat, cells: {
      name: zoneName(hit), level: zoneOffice(hit), office: zoneOffice(hit), area_m2: clipped?.areaM2 ?? 0,
      base_date: baseDate,
       share_pct: clipped && circleArea > 0 ? (clipped.areaM2 / circleArea) * 100 : null,
    } };
  });
}

function schoolSpec(): DetailSpec {
  return {
    columns: SCHOOL_COLUMNS,
    summary(ctx) { const rows = schoolRows(ctx, schoolHits(ctx)); return { title: catalogEntry("A02").title, subtitle: `${rows.length.toLocaleString("ko-KR")}곳`, fields: [{ label: "학구·학교군", value: `${rows.length.toLocaleString("ko-KR")}곳` }], source: sourceLineOf(schoolZoneSources(ctx)) }; },
    rows(ctx) { return schoolRows(ctx, schoolHits(ctx)); },
    at(ctx, lng, lat) { const hit = schoolHits(ctx).find((candidate) => pointInGeometry(lng, lat, candidate.geometry)); return hit ? { card: zoneCard(ctx, hit), fid: String(hit.featureId) } : null; },
  };
}

function populationHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("reference", ["pop_grid"], Math.min(5000, ctx.input.radiusM + 708));
}

function populationRows(ctx: DetailContext, hits: readonly FeatureHit[]): DetailRow[] {
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  return hits.map((hit) => {
    const props = hit.properties;
    const size = number(props.cellSizeM) ?? 1000;
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, {
      type: "Polygon",
      coordinates: [[
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] - size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] - size / 2 : 0],
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] + size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] - size / 2 : 0],
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] + size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] + size / 2 : 0],
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] - size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] + size / 2 : 0],
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] - size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] - size / 2 : 0],
      ]],
    });
    const population = (props.population as { total?: { v?: unknown; s?: string } } | undefined)?.total;
    const value = population?.s === "observed" ? number(population.v) : null;
    const density = value === null ? null : value / ((size * size) / 1e6);
    const band = density === null ? "값 없음" : density < 1000 ? "1,000명/㎢ 미만" : density < 5000 ? "1,000~5,000명/㎢" : density < 10000 ? "5,000~10,000명/㎢" : "10,000명/㎢ 이상";
    const [lng, lat] = hitPoint(hit);
    return { fid: String(hit.featureId), lng, lat, cells: { density_band: band, population: value, area_m2: clipped?.areaM2 ?? 0, share_pct: clipped && circleArea > 0 ? (clipped.areaM2 / circleArea) * 100 : null, data_year: text(props.dataYear) } };
  });
}

function populationSpec(): DetailSpec {
  return {
    columns: POPULATION_COLUMNS,
    summary(ctx) { const rows = populationRows(ctx, populationHits(ctx)); const total = rows.reduce((sum, row) => sum + (number(row.cells.population) ?? 0), 0); return { title: catalogEntry("A11").title, subtitle: `${rows.length.toLocaleString("ko-KR")}개 격자`, fields: [{ label: "공개 인구 합계", value: total > 0 ? `${Math.round(total)}명` : null }], source: sourceLine(ctx, "reference", ["sgis_grid"]) }; },
    rows(ctx) { return populationRows(ctx, populationHits(ctx)); },
    at(ctx, lng, lat) { const hit = populationHits(ctx).find((candidate) => pointInGeometry(lng, lat, candidate.geometry)); return hit ? { card: { title: "인구 격자", fields: [], source: sourceLine(ctx, "reference", ["sgis_grid"]) }, fid: String(hit.featureId) } : null; },
  };
}

export const ZONE_SPECS: Partial<Record<string, DetailSpec>> = {
  A12: featureSpec("A12", zoningHits, (ctx) => ctx.sources("reference", ZONING_SOURCES)),
  D11: featureSpec("D11", districtHits, (ctx) => ctx.sources("reference", sourceIdsWithPrefix(ctx, "reference", "district_"))),
  A09: maintenanceSpec(),
  D12: facilitySpec(),
  A02: schoolSpec(),
  A11: populationSpec(),
};

import type { DetailCard, DetailColumn, DetailRow, DetailSpec, DetailContext } from "./registry";
import type { FeatureHit } from "../../data/features";
import { toLngLat, toUtmk } from "../../crs";
import { sourceLineOf } from "../../ui/tile-view";
import { catalogEntry } from "../../ui/tile-catalog";
import { hitPoint } from "../tiles/common";
import { distanceToLineM, lineLengthInCircle } from "../tiles/geo";
import { walkField, walkMinutes } from "../tiles/walk-shared";

export const ROAD_COLUMNS: DetailColumn[] = [
  { key: "name", label: "도로명", kind: "text" },
  { key: "hierarchy", label: "위계", kind: "category" },
  { key: "width_m", label: "폭(m)", kind: "number" },
  { key: "length_m", label: "길이(m)", kind: "number" },
];

export const TRANSIT_COLUMNS: DetailColumn[] = [
  { key: "name", label: "이름", kind: "text" },
  { key: "type", label: "구분", kind: "category" },
  { key: "stop_no", label: "역·정류장 번호", kind: "text", csvOnly: true },
  { key: "straight_m", label: "직선(m)", kind: "number" },
  { key: "walk_min", label: "걸어서(분)", kind: "number" },
];

export const WALK_COLUMNS = TRANSIT_COLUMNS;

export const PLANNED_COLUMNS: DetailColumn[] = [
  { key: "name", label: "이름", kind: "text" },
  { key: "type", label: "구분", kind: "category" },
  { key: "stage", label: "단계", kind: "category" },
  { key: "length_m", label: "길이(m)", kind: "number" },
  { key: "project_id", label: "사업 ID", kind: "text", csvOnly: true },
  { key: "last_verified_at", label: "확인일", kind: "date", csvOnly: true },
];

export const TRADE_COLUMNS: DetailColumn[] = [
  { key: "deal_date", label: "계약일", kind: "date" },
  { key: "property_type", label: "유형", kind: "category" },
  { key: "contract_type", label: "계약", kind: "category" },
  { key: "price_krw", label: "거래금액(원)", kind: "number" },
  { key: "area_m2", label: "면적(㎡)", kind: "number" },
  { key: "floor", label: "층", kind: "number" },
  { key: "pnu", label: "PNU", kind: "text", csvOnly: true },
];

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result === "" ? null : result;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceLine(ctx: DetailContext, key: "reference" | "market", ids: readonly string[]): string {
  return sourceLineOf(ctx.sources(key, ids));
}

function roadHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("reference", ["road"]);
}

function roadRows(ctx: DetailContext, hits: readonly FeatureHit[]): DetailRow[] {
  return hits.map((hit) => {
    const [lng, lat] = hitPoint(hit);
    return { fid: String(hit.featureId), lng, lat, cells: {
      name: text(hit.properties.name) ?? hit.name,
      hierarchy: text(hit.properties.hierarchy) ?? "기타",
      width_m: number(hit.properties.widthM) ?? number(hit.properties.width_m) ?? number(hit.properties.width),
      length_m: lineLengthInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry),
    } };
  });
}

function nearestRoad(ctx: DetailContext, lng: number, lat: number): FeatureHit | null {
  const candidates = roadHits(ctx);
  let selected: { hit: FeatureHit; distance: number } | null = null;
  for (const hit of candidates) {
    const distance = distanceToLineM([lng, lat], hit.geometry);
    if (distance === null) continue;
    if (selected === null || distance < selected.distance || (distance === selected.distance && hit.featureId < selected.hit.featureId)) selected = { hit, distance };
  }
  return selected?.hit ?? null;
}

function roadSpec(): DetailSpec {
  return {
    columns: ROAD_COLUMNS,
    summary(ctx) { const rows = roadRows(ctx, roadHits(ctx)); return { title: catalogEntry("D13").title, subtitle: `${rows.length.toLocaleString("ko-KR")}개 중심선`, fields: [{ label: "도로 중심선", value: `${rows.length.toLocaleString("ko-KR")}개` }], source: sourceLine(ctx, "reference", ["osm_roads"]) }; },
    rows(ctx) { return roadRows(ctx, roadHits(ctx)); },
    at(ctx, lng, lat) { const hit = nearestRoad(ctx, lng, lat); return hit ? { card: { title: text(hit.properties.name) ?? hit.name ?? "도로", fields: [{ label: "위계", value: text(hit.properties.hierarchy) ?? "기타" }, { label: "폭", value: number(hit.properties.widthM) === null ? null : `${hit.properties.widthM}m` }], source: sourceLine(ctx, "reference", ["osm_roads"]) }, fid: String(hit.featureId) } : null; },
  };
}

function transitHits(ctx: DetailContext): FeatureHit[] {
  return [...ctx.hits("reference", ["bus_stop"]), ...ctx.hits("reference", ["rail_station"])].sort((a, b) => a.featureId - b.featureId);
}

function transitRows(ctx: DetailContext, hits: readonly FeatureHit[], withWalk: boolean): DetailRow[] {
  const field = withWalk ? walkField(ctx) : null;
  return hits.map((hit) => {
    const [lng, lat] = hitPoint(hit);
    const route = field ? field.distTo(toUtmk([lng, lat])) : null;
    return { fid: String(hit.featureId), lng, lat, cells: {
      name: hit.name,
      type: hit.kind === "rail_station" ? "철도역" : "버스 정류장",
      stop_no: text(hit.properties.stopNo) ?? text(hit.properties.stationCode) ?? text(hit.properties.stationName),
       straight_m: hit.distanceM,
      walk_min: route ? route.minutes : null,
    } };
  });
}

function transitSource(ctx: DetailContext): string {
  return sourceLineOf([...ctx.sources("reference", ["bus_stop"]), ...ctx.sources("reference", ["osm_subway"])]) || "출처 없음";
}

function transitCard(ctx: DetailContext, hit: FeatureHit, withWalk: boolean): DetailCard {
  const [lng, lat] = hitPoint(hit);
  const route = withWalk ? walkField(ctx)?.distTo(toUtmk([lng, lat])) : null;
  return { title: hit.name ?? "이름 없음", subtitle: hit.kind === "rail_station" ? "철도역" : "버스 정류장", fields: [
    { label: "직선", value: hit.distanceM === null ? null : `${Math.round(hit.distanceM)}m` },
    { label: "걸어서", value: route ? `${route.minutes}분 · ${Math.round(route.distanceM)}m` : null },
  ], source: transitSource(ctx) };
}

function transitSpec(code: "D14" | "D28"): DetailSpec {
  const withWalk = code === "D28";
  return {
    columns: withWalk ? WALK_COLUMNS : TRANSIT_COLUMNS,
    controls: withWalk ? undefined : undefined,
    summary(ctx) {
      const rows = transitRows(ctx, transitHits(ctx), withWalk);
      const stationCount = rows.filter((row) => row.cells.type === "철도역").length;
      return { title: catalogEntry(code).title, subtitle: `${stationCount}역 · ${rows.length - stationCount}정류장`, fields: [{ label: "지물 수", value: `${rows.length.toLocaleString("ko-KR")}개` }], source: transitSource(ctx) };
    },
    rows(ctx) { return transitRows(ctx, transitHits(ctx), withWalk); },
    at(ctx, lng, lat) {
      if (withWalk) {
        const field = walkField(ctx);
        if (!field) return null;
        const route = field.distTo(toUtmk([lng, lat]));
        if (!route) return null;
        return {
          card: { title: "이 지점", fields: [{ label: "걸어서", value: `${route.minutes}분 · 보행망 따라 ${Math.round(route.distanceM)}m` }], source: transitSource(ctx) },
          path: route.path.map(([x, y]) => toLngLat([x, y]) as [number, number]),
        };
      }
      let closest: { hit: FeatureHit; distance: number } | null = null;
      const [x, y] = toUtmk([lng, lat]);
      for (const hit of transitHits(ctx)) {
        const [hx, hy] = toUtmk(hitPoint(hit));
        const distance = Math.hypot(hx - x, hy - y);
        if (closest === null || distance < closest.distance) closest = { hit, distance };
      }
      return closest ? { card: transitCard(ctx, closest.hit, false), fid: String(closest.hit.featureId) } : null;
    },
  };
}

function plannedHits(ctx: DetailContext): FeatureHit[] {
  return [...ctx.hits("reference", ["planned_rail_line"]), ...ctx.hits("reference", ["planned_rail_station"])].sort((a, b) => a.featureId - b.featureId);
}

function plannedRows(ctx: DetailContext, hits: readonly FeatureHit[]): DetailRow[] {
  return hits.map((hit) => {
    const [lng, lat] = hitPoint(hit);
    return { fid: String(hit.featureId), lng, lat, cells: {
      name: hit.name,
      type: hit.kind === "planned_rail_line" ? "계획 선형" : "계획역",
      stage: text(hit.properties.lifecycleStatus) ?? "미확인",
      length_m: hit.kind === "planned_rail_line" ? lineLengthInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry) : null,
      project_id: text(hit.properties.projectId),
      last_verified_at: text(hit.properties.lastVerifiedAt),
    } };
  });
}

function plannedSpec(): DetailSpec {
  return {
    columns: PLANNED_COLUMNS,
    summary(ctx) { const rows = plannedRows(ctx, plannedHits(ctx)); return { title: catalogEntry("D24").title, subtitle: `${rows.length.toLocaleString("ko-KR")}개`, fields: [{ label: "계획 지물", value: `${rows.length.toLocaleString("ko-KR")}개` }], source: sourceLine(ctx, "reference", ["planned_rail"]) }; },
    rows(ctx) { return plannedRows(ctx, plannedHits(ctx)); },
    at(ctx, lng, lat) { const [x, y] = toUtmk([lng, lat]); let best: { hit: FeatureHit; distance: number } | null = null; for (const hit of plannedHits(ctx)) { const [hx, hy] = toUtmk(hitPoint(hit)); const distance = Math.hypot(hx - x, hy - y); if (!best || distance < best.distance) best = { hit, distance }; } return best ? { card: { title: best.hit.name ?? "계획 철도", fields: [{ label: "단계", value: text(best.hit.properties.lifecycleStatus) ?? "미확인" }], source: sourceLine(ctx, "reference", ["planned_rail"]) }, fid: String(best.hit.featureId) } : null; },
  };
}

function tradeRows(ctx: DetailContext): DetailRow[] {
  const db = ctx.db("market");
  const core = ctx.db("core");
  if (!db || !core) return [];
  try {
    const rows = db.prepare(`SELECT transaction_id, deal_date, property_type, contract_type, price_krw, area_m2, floor, location_id FROM property_transaction
      WHERE location_id IS NOT NULL AND deal_date > date(?) AND deal_date <= date(?) AND cancelled_at IS NULL ORDER BY deal_date DESC, transaction_id`).all(`${Number(ctx.input.analysisDate.slice(0, 4)) - 1}-${ctx.input.analysisDate.slice(5)}`, ctx.input.analysisDate) as Array<Record<string, unknown>>;
    const pointRows = core.prepare("SELECT pnu, lng, lat FROM parcel_point").all() as Array<{ pnu: string; lng: number; lat: number }>;
    const points = new Map(pointRows.map((row) => [row.pnu, row]));
    return rows.flatMap((row, index) => {
      const location = typeof row.location_id === "string" ? points.get(row.location_id) : undefined;
      if (!location) return [];
      const [x, y] = toUtmk([location.lng, location.lat]);
      const [cx, cy] = toUtmk(ctx.input.center);
      if (Math.hypot(x - cx, y - cy) > ctx.input.radiusM) return [];
      return [{ fid: String(row.transaction_id ?? index), lng: location.lng, lat: location.lat, cells: { deal_date: text(row.deal_date), property_type: text(row.property_type), contract_type: text(row.contract_type), price_krw: number(row.price_krw), area_m2: number(row.area_m2), floor: number(row.floor), pnu: text(row.location_id) } }];
    });
  } catch {
    return [];
  }
}

function tradeSpec(): DetailSpec {
  return {
    columns: TRADE_COLUMNS,
    summary(ctx) { const rows = tradeRows(ctx); return { title: catalogEntry("D25").title, subtitle: `${rows.length.toLocaleString("ko-KR")}건`, fields: [{ label: "위치 확인 거래", value: `${rows.length.toLocaleString("ko-KR")}건` }], source: sourceLine(ctx, "market", ["rtms_apt_trade"]) }; },
    rows: tradeRows,
    at(ctx, lng, lat) { const rows = tradeRows(ctx); let best: DetailRow | null = null; let distance = Number.POSITIVE_INFINITY; for (const row of rows) { const [x, y] = toUtmk([row.lng, row.lat]); const [tx, ty] = toUtmk([lng, lat]); const d = Math.hypot(x - tx, y - ty); if (d < distance) { distance = d; best = row; } } return best ? { card: { title: "실거래", fields: Object.entries(best.cells).slice(0, 5).map(([label, value]) => ({ label, value: value === null ? null : String(value) })), source: sourceLine(ctx, "market", ["rtms_apt_trade"]) }, fid: best.fid } : null; },
  };
}

export const NETWORK_SPECS: Partial<Record<"D13" | "D14" | "D24" | "D25" | "D28", DetailSpec>> = {
  D13: roadSpec(),
  D14: transitSpec("D14"),
  D24: plannedSpec(),
  D25: tradeSpec(),
  D28: transitSpec("D28"),
};

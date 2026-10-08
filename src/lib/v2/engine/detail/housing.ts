import { hitPoint } from "../tiles/common";
import { isApartment } from "../tiles/a05";
import { sourceLineOf } from "../../ui/tile-view";
import { SUPPLY_SOURCE } from "../../ui/callout-layout";
import { unitTypeSummary, unitTypesFromUnknown, UNIT_TYPE_BASIS } from "../../unit-types";
import type { FeatureHit } from "../../data/features";
import type { DetailCard, DetailColumn, DetailContext, DetailRow, DetailSpec } from "./registry";

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const STOCK_SOURCES = ["ledger_recap", "ledger_title", "ledger_exclusive_area", "kapt"] as const;
const SUPPLY_SOURCES = ["applyhome", "applyhome_types", "move_in"] as const;

export const A05_COLUMNS: DetailColumn[] = [
  { key: "name", label: "단지명", kind: "text" },
  { key: "type", label: "구분", kind: "category" },
  { key: "households", label: "세대·호실", kind: "number" },
  { key: "unit_types", label: `타입 (${UNIT_TYPE_BASIS})`, kind: "text" },
  { key: "approval_date", label: "준공", kind: "date" },
  { key: "distance_m", label: "직선거리(m)", kind: "number" },
  { key: "pnu", label: "PNU", kind: "text", csvOnly: true },
];

export const A06_COLUMNS: DetailColumn[] = [
  { key: "name", label: "단지명", kind: "text" },
  { key: "source", label: "원천", kind: "category" },
  { key: "units", label: "세대수", kind: "number" },
  { key: "unit_types", label: `타입 (${UNIT_TYPE_BASIS})`, kind: "text" },
  { key: "planned_month", label: "입주(예정)월", kind: "text" },
  { key: "address", label: "주소", kind: "text", csvOnly: true },
  { key: "distance_m", label: "직선거리(m)", kind: "number" },
];

function stockHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("core", ["housing_complex", "officetel"]).filter((hit) => hit.kind === "officetel" || (hit.properties.mainUse === "공동주택" && isApartment(hit.properties)));
}

function supplyHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("market", ["planned_supply"]).filter((hit) => hit.properties.source === "applyhome" || hit.properties.source === "move_in");
}

function stockSource(ctx: DetailContext): string {
  return sourceLineOf(ctx.sources("core", STOCK_SOURCES));
}

function supplySource(ctx: DetailContext): string {
  return sourceLineOf(ctx.sources("market", SUPPLY_SOURCES));
}

function stockRow(hit: FeatureHit): DetailRow {
  const types = unitTypesFromUnknown(hit.properties.unitTypes);
  const [lng, lat] = hitPoint(hit);
  return {
    fid: String(hit.featureId),
    lng,
    lat,
    cells: {
      name: hit.name,
      type: hit.kind === "officetel" ? "오피스텔" : "아파트",
      households: num(hit.properties.households) ?? num(hit.properties.units),
      unit_types: unitTypeSummary(types),
      approval_date: typeof hit.properties.approvalDate === "string" ? hit.properties.approvalDate : null,
      distance_m: hit.distanceM === null ? null : Math.round(hit.distanceM),
      pnu: hit.pnu,
    },
  };
}

function supplyRow(hit: FeatureHit): DetailRow {
  const types = unitTypesFromUnknown(hit.properties.unitTypes);
  const [lng, lat] = hitPoint(hit);
  const source = String(hit.properties.source ?? "");
  return {
    fid: String(hit.featureId),
    lng,
    lat,
    cells: {
      name: hit.name,
      source: SUPPLY_SOURCE[source] ?? source,
      units: num(hit.properties.units),
      unit_types: unitTypeSummary(types),
      planned_month: typeof hit.properties.plannedMonth === "string" ? hit.properties.plannedMonth : null,
      address: typeof hit.properties.address === "string" ? hit.properties.address : null,
      distance_m: hit.distanceM === null ? null : Math.round(hit.distanceM),
    },
  };
}

function distanceTo(hit: FeatureHit, lng: number, lat: number): number {
  const [x, y] = hitPoint(hit);
  return Math.hypot(x - lng, y - lat);
}

function stockSpec(code: "A05"): DetailSpec {
  return {
    columns: A05_COLUMNS,
    summary(ctx) {
      const rows = stockHits(ctx);
      const known = rows.filter((hit) => unitTypesFromUnknown(hit.properties.unitTypes).length > 0).length;
      return { title: "기존 주거 공급", subtitle: `단지·건물 ${rows.length.toLocaleString("ko-KR")}곳 · 타입 확인 ${known.toLocaleString("ko-KR")}곳`, fields: [{ label: "타입 기준", value: UNIT_TYPE_BASIS }], source: stockSource(ctx), ...(rows.length === 0 ? { missing: ["기존 주거 자료"] } : {}) };
    },
    rows(ctx) { return stockHits(ctx).map(stockRow); },
    at(ctx, lng, lat) {
      const selected = stockHits(ctx).sort((a, b) => distanceTo(a, lng, lat) - distanceTo(b, lng, lat))[0];
      if (!selected || distanceTo(selected, lng, lat) > 0.001) return null;
      const row = stockRow(selected);
      const types = unitTypesFromUnknown(selected.properties.unitTypes);
      return { card: { title: selected.name ?? "이름 확인필요", fields: [{ label: "구분", value: selected.kind === "officetel" ? "오피스텔" : "아파트" }, { label: "세대·호실", value: row.cells.households === null ? null : `${row.cells.households}` }, { label: "타입", value: unitTypeSummary(types) }], source: stockSource(ctx) }, fid: row.fid };
    },
  };
}

function supplySpec(code: "A06"): DetailSpec {
  return {
    columns: A06_COLUMNS,
    summary(ctx) {
      const rows = supplyHits(ctx);
      const known = rows.filter((hit) => unitTypesFromUnknown(hit.properties.unitTypes).length > 0).length;
      return { title: "분양·입주예정 공급", subtitle: `사업 ${rows.length.toLocaleString("ko-KR")}곳 · 타입 확인 ${known.toLocaleString("ko-KR")}곳`, fields: [{ label: "타입 기준", value: UNIT_TYPE_BASIS }], source: supplySource(ctx), ...(rows.length === 0 ? { missing: ["분양·입주예정 자료"] } : {}) };
    },
    rows(ctx) { return supplyHits(ctx).map(supplyRow); },
    at(ctx, lng, lat) {
      const selected = supplyHits(ctx).sort((a, b) => distanceTo(a, lng, lat) - distanceTo(b, lng, lat))[0];
      if (!selected || distanceTo(selected, lng, lat) > 0.001) return null;
      const row = supplyRow(selected);
      return { card: { title: selected.name ?? "이름 확인필요", fields: [{ label: "원천", value: row.cells.source as string | null }, { label: "세대수", value: row.cells.units === null ? null : `${row.cells.units}` }, { label: "타입", value: row.cells.unit_types as string }], source: supplySource(ctx) }, fid: row.fid };
    },
  };
}

export const HOUSING_SPECS: Partial<Record<"A05" | "A06", DetailSpec>> = {
  A05: stockSpec("A05"),
  A06: supplySpec("A06"),
};

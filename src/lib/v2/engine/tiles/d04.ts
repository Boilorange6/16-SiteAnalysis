/** D04 준공 연대 — 별도 buildings 파일의 건물별 사용승인일 분포. */
import type BetterSqlite3 from "better-sqlite3";
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { DECADE_LAYERS, decadeLayer } from "../../ui/callout-layout";
import { candidate, makeTile, missing, obs, polygonCandidate, type PolygonCandidate, type TileDraft } from "./common";
import { areaInCircle, polygonArea } from "./geo";
import { BUILDING_SOURCES, buildingRetirementLimitations, buildingRows, isCounted } from "./buildings-shared";
import { notProvided } from "./not-provided";

const FEATURE_COLUMNS = ["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"] as const;

const DECADES = [
  { id: "share_pre1980", label: "1979년 이하", layer: "bldg_pre1980" },
  { id: "share_1980s", label: "1980년대", layer: "bldg_1980s" },
  { id: "share_1990s", label: "1990년대", layer: "bldg_1990s" },
  { id: "share_2000s", label: "2000년대", layer: "bldg_2000s" },
  { id: "share_2010s", label: "2010년대", layer: "bldg_2010s" },
  { id: "share_2020s", label: "2020년 이상", layer: "bldg_2020s" },
] as const;

function columns(db: BetterSqlite3.Database, table: string): Set<string> {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
  } catch {
    return new Set();
  }
}

function approvalYear(value: unknown, analysisDate: string): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const year = Number(value.slice(0, 4));
  return year >= 1800 && year <= Number(analysisDate.slice(0, 4)) ? year : null;
}

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

export function d04(ctx: EngineContext): TileResult {
  const sources = ctx.sources("buildings", BUILDING_SOURCES);
  const db = ctx.db("buildings");
  if (sources.length === 0 || !db) return notProvided(ctx, "D04");
  const featureColumns = columns(db, "feature");
  const factColumns = columns(db, "building_fact");
  if (!FEATURE_COLUMNS.every((column) => featureColumns.has(column)) || !factColumns.has("feature_id") || !factColumns.has("approval_date")) return notProvided(ctx, "D04");

  const rows = buildingRows(ctx);
  if (rows === null) return notProvided(ctx, "D04");
  const allYears = new Map(rows.map((row) => [row.hit.featureId, approvalYear(row.approvalDate, ctx.input.analysisDate)]));
  const years = new Map(rows.filter((row) => isCounted(ctx, row)).map((row) => [row.hit.featureId, allYears.get(row.hit.featureId) ?? null])); // 동수·구성비는 중심점이 반경 안인 건물만, 그림은 교차 전부
  const ledgerBackfilled = rows.filter((row) => isCounted(ctx, row) && row.approvalDateSource === "core_ledger_pnu").length;
  const polygons: PolygonCandidate[] = [];
  let failedGeometry = 0;
  for (const row of rows) {
    const hit = row.hit;
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    if (clipped === null) {
      failedGeometry += 1;
      continue;
    }
    for (const rings of clipped.parts) {
      const polygon = polygonCandidate(hit.featureId, decadeLayer(allYears.get(hit.featureId) ?? null), rings, polygonArea(rings), hit.name);
      if (polygon) polygons.push(polygon);
    }
  }
  const total = years.size;
  const confirmed = [...years.values()].filter((year): year is number => year !== null).length;
  const byLayer = new Map<string, number>(DECADE_LAYERS.map((layer) => [layer, 0]));
  for (const year of years.values()) {
    const layer = decadeLayer(year);
    byLayer.set(layer, (byLayer.get(layer) ?? 0) + 1);
  }

  const metrics: TileDraft["metrics"] = [
    total === 0 ? missing("confirmed_share_pct", "사용승인일 확인 건물", "%", "d04-confirmed-share@1") : obs("confirmed_share_pct", "사용승인일 확인 건물", pct(confirmed, total), "%", "d04-confirmed-share@1", confirmed, total),
    ...DECADES.map((decade) => {
      const count = byLayer.get(decade.layer) ?? 0;
      return total === 0 ? missing(decade.id, decade.label, "%", "d04-decades@1") : obs(decade.id, decade.label, pct(count, total), "%", "d04-decades@1", count, total);
    }),
    total === 0 ? missing("share_unknown", "미상", "%", "d04-decades@1") : obs("share_unknown", "미상", pct(byLayer.get("bldg_unknown") ?? 0, total), "%", "d04-decades@1", byLayer.get("bldg_unknown") ?? 0, total),
  ];

  const coverage = ctx.coverage("buildings", BUILDING_SOURCES);
  const retirementLimitations = buildingRetirementLimitations(ctx);
  const status: TileResult["status"] = failedGeometry > 0 || retirementLimitations.length > 0 || coverage.some((l) => l.kind === "partial" || l.kind === "incomplete") ? "partial" : "complete";
  const sentence = total === 0
    ? "반경 안 건물이 확인되지 않아 준공 연대를 산출하지 못함 → 건물 자료와 현장 확인 필요"
    : `반경 안 건물 ${total.toLocaleString("en-US")}동 중 사용승인일 확인 ${pct(confirmed, total)}% → 확인된 건물의 준공 연대를 집계하고 미상은 별도로 표시 → 개별 건축물대장 확인 필요`;

  const limitations = [
    ...retirementLimitations,
    ...(ledgerBackfilled > 0 ? [{ kind: "estimated" as const, note: "도로명주소 보충 건물 " + ledgerBackfilled + "동은 PNU로 core 건축물대장 표제부·집계 자료의 사용승인일을 연결했습니다. 한 PNU에 여러 동이 있으면 가장 이른 승인일을 사용합니다." }] : []),
    ...coverage,
    ...(failedGeometry > 0 ? [{ kind: "partial" as const, note: `도형 오류로 지도에 표시하지 못한 ${failedGeometry}건은 발자국에서 빠졌습니다.` }] : []),
  ];
  return makeTile(ctx, {
    code: "D04",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D04-decades@1", basisMetricIds: ["confirmed_share_pct"], sentence, level: null, criteria: null },
    sources,
    layers: [...DECADE_LAYERS],
    map: rows.map((row) => candidate(row.hit, decadeLayer(allYears.get(row.hit.featureId) ?? null))),
    polygons,
    limitations,
  });
}

/**
 * A09 정비사업 — 두 방식 중 있는 자료로 답한다.
 *  1) 경계(feature kind maintenance_zone)가 적재돼 있으면: 반경과 교차하는 구역·사업을 단계·유형별로 센다.
 *  2) 명부(source_release.coverage_json.projects)만 있으면: 반경이 걸친 시군구의 사업 목록. 경계가 없어 반경 안 여부는 알 수 없다.
 * 사업이 많다고 호재로 판단하지 않고 등급도 없다. 예정 세대는 알려진 사업만 합산한다.
 */
import type { FeatureHit } from "../../data/features";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { bbox, feature, featureCollection, intersect } from "@turf/turf";
import type { TileResult } from "../../tile-result";
import type { EngineContext, FileKey, Limitation } from "../../engine/context";
import { fmt, makeTile, missing, obs, type TileDraft } from "../../engine/tiles/common";
import { notProvided } from "../../engine/tiles/not-provided";
import { polygonArea } from "../../engine/tiles/geo";

/** D23 단계 순서 (ingest/sources/maintenance.ts의 MAINT_STAGES와 같다 — 엔진이 적재 코드를 끌어오지 않도록 복사) */
export const STAGES = ["정비계획", "구역지정", "추진위", "조합", "사업시행", "관리처분", "착공", "준공", "미확인"] as const;
type Stage = (typeof STAGES)[number];
const stageOf = (v: unknown): Stage => (STAGES as readonly string[]).includes(String(v)) ? (v as Stage) : "미확인";
const SOURCES = ["maintenance_zone", "maintenance_integrated", "maintenance_std", "seoul_plan_zone"];
const KEYS: FileKey[] = ["market", "reference"];

function sourceIdsWithPrefix(ctx: EngineContext, key: FileKey, prefix: string): string[] {
  const db = ctx.db(key);
  if (!db) return [];
  return (db.prepare("SELECT source_id FROM source_release WHERE source_id GLOB ? ORDER BY source_id").all(`${prefix}*`) as Array<{ source_id: string }>).map((row) => row.source_id);
}

/** 정비구역의 실제 적재 원천(mzone_*)도 타일 provenance·coverage에 포함한다. */
export function maintenanceSourceIds(ctx: EngineContext, key: FileKey): string[] {
  return [...new Set([...SOURCES, ...sourceIdsWithPrefix(ctx, key, "mzone_")])];
}

export interface Project {
  key: string;
  /** 원천 구역명·사업명. 표시용 fallback은 여기서 만들지 않는다. */
  name: string | null;
  stage: Stage;
  type: string;
  households: number | null;
  operator: string | null;
  designatedAt: string | null;
  announcedDate: string | null;
  rawStage: string | null;
  linked: boolean;
  program: string | null;
  stageDetail: string | null;
  stageDate: string | null;
  areaKind: string | null;
  overview: MaintenanceOverview | null;
}

export interface MaintenanceOverview {
  bizAreaM2: number | null;
  floorAreaRatio: number | null;
  buildingCoverage: number | null;
  floors: string | null;
  heightM: number | null;
  saleUnits: number | null;
  rentUnits: number | null;
  zoningBefore: string | null;
  zoningAfter: string | null;
}

export interface MaintenanceCollection {
  zones: FeatureHit[];
  projects: Map<string, Project>;
  zoneProject: Map<number, string>;
  sources: ReturnType<EngineContext["sources"]>;
  linked: number;
  key: FileKey;
}

const posInt = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const compact = (s: string) => s.replace(/\s+/g, "");
const sourceName = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text !== "") return text;
  }
  return null;
};
const dateOf = (value: unknown): string | null => {
  const date = sourceName(value);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
};

function areaOf(geometry: Polygon | MultiPolygon): number {
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return parts.reduce((sum, rings) => sum + polygonArea(rings), 0);
}

function polygonGeometry(geometry: Geometry): geometry is Polygon | MultiPolygon {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

/** 서울의 기존 경계만 작은 면적의 절반 이상 겹칠 때 제외한다. */
function deduplicateZones(hits: FeatureHit[]): { zones: FeatureHit[]; dates: Map<number, string[]> } {
  const plans = hits.filter((hit) => hit.properties.layer === "seoul_plan" && polygonGeometry(hit.geometry)).map((hit) => ({ hit, bounds: bbox(feature(hit.geometry)), area: areaOf(hit.geometry as Polygon | MultiPolygon) }));
  const dates = new Map<number, string[]>();
  const zones = hits.filter((hit) => {
    if (hit.properties.layer === "seoul_plan" || !hit.legalCode?.startsWith("11") || !polygonGeometry(hit.geometry)) return true;
    const bounds = bbox(feature(hit.geometry));
    const area = areaOf(hit.geometry);
    if (area <= 0) return true;
    let best: { id: number; ratio: number } | null = null;
    for (const plan of plans) {
      if (plan.area <= 0 || bounds[0] > plan.bounds[2] || bounds[2] < plan.bounds[0] || bounds[1] > plan.bounds[3] || bounds[3] < plan.bounds[1]) continue;
      try {
        const overlap = intersect(featureCollection([feature(hit.geometry), feature(plan.hit.geometry as Polygon | MultiPolygon)]));
        const ratio = overlap ? areaOf(overlap.geometry) / Math.min(area, plan.area) : 0;
        if (ratio >= 0.5 && (!best || ratio > best.ratio)) best = { id: plan.hit.featureId, ratio };
      } catch { continue; }
    }
    if (!best) return true;
    const date = dateOf(hit.properties.announcedDate);
    if (date) dates.set(best.id, [...(dates.get(best.id) ?? []), date]);
    return false;
  });
  return { zones, dates };
}

/** 명부의 시군구명("수원시", "강동구")이 법정구역명("경기도 수원시 팔달구")에 걸리는지. 같은 시도 안에서만 비교한다. */
export function sigunguMatches(areaName: string, rosterName: string): boolean {
  const rest = compact(areaName.split(/\s+/).slice(1).join(""));
  const r = compact(rosterName);
  return r !== "" && rest !== "" && (rest.includes(r) || r.includes(rest));
}

export function maintenanceSources(ctx: EngineContext): ReturnType<EngineContext["sources"]> {
  return KEYS.flatMap((k) => ctx.sources(k, maintenanceSourceIds(ctx, k)));
}

function summarize(projects: Project[]) {
  const byStage = STAGES.map((s) => [s, projects.filter((p) => p.stage === s).length] as const).filter(([, n]) => n > 0);
  const types = [...new Set(projects.map((p) => p.type))].sort().map((t) => [t, projects.filter((p) => p.type === t).length] as const);
  const known = projects.filter((p) => p.households !== null);
  return { byStage, types, known: known.length, households: known.reduce((a, p) => a + (p.households as number), 0) };
}

function commonMetrics(projects: Project[], idPrefix: string): TileDraft["metrics"] {
  const s = summarize(projects);
  return [
    ...s.byStage.map(([stage, n]) => obs(`${idPrefix}stage_${STAGES.indexOf(stage)}`, `단계: ${stage}`, n, "건", "a09-stage@1:D23 단계별 고유 사업")),
    ...s.types.map(([t, n], i) => obs(`${idPrefix}type_${i + 1}`, `유형: ${t}`, n, "건", "a09-type@1:원천 사업 유형")),
    s.known === 0
      ? missing("planned_households", "예정 세대(알려진 사업만)", "세대", "a09-households@1:세대수가 있는 사업 없음")
      : obs("planned_households", "예정 세대(알려진 사업만)", s.households, "세대", "a09-households@1:세대수가 있는 사업만 합산, 반경 내부 배분값 아님", s.known, projects.length),
  ];
}

const stageText = (projects: Project[]) => summarize(projects).byStage.map(([s, n]) => `${s} ${n}건`).join(", ");
const hhText = (projects: Project[]) => {
  const s = summarize(projects);
  return s.known === 0 ? "예정 세대는 확인된 사업 없음" : `예정 세대는 알려진 ${s.known}건만 합쳐 ${fmt(s.households)}세대`;
};

export function a09(ctx: EngineContext): TileResult {
  const sources = maintenanceSources(ctx);
  const collection = collectMaintenance(ctx);
  if (sources.length === 0 && !collection) return notProvided(ctx, "A09");
  return collection ? withZones(ctx, collection) : rosterOnly(ctx, sources);
}

// ── 1) 경계가 있는 경우 ──
export function collectMaintenance(ctx: EngineContext): MaintenanceCollection | null {
  const sources = maintenanceSources(ctx);
  const key = KEYS.find((k) => ctx.db(k)?.prepare("SELECT 1 FROM feature WHERE kind = 'maintenance_zone' LIMIT 1").get() !== undefined);
  if (!key) return null;

  const { zones, dates } = deduplicateZones(ctx.hits(key, ["maintenance_zone"]));
  const zdb = ctx.db(key)!;
  const market = ctx.db("market");
  const link = zdb.prepare("SELECT to_stable_id FROM feature_link WHERE from_stable_id = ? AND relation_type = 'zone_of_project'").pluck();
  const events = market?.prepare("SELECT stage, units FROM development_event WHERE project_id = ? AND event_type = 'maintenance_stage'");
  const roster = new Map(rosterRows(ctx).map((row) => [row.id, row]));
  let linked = 0;

  const projects = new Map<string, Project>();
  const zoneProject = new Map<number, string>();
  // 같은 명부에 연결된 구역이 섞여도 서울플랜+ 속성을 사업의 기준으로 둔다.
  const ordered = [...zones].sort((a, b) => Number(b.properties.layer === "seoul_plan") - Number(a.properties.layer === "seoul_plan"));
  for (const z of ordered) {
    const to = link.get(z.stableId) as string | undefined;
    const p = z.properties;
    const isPlan = p.layer === "seoul_plan";
    let stage = stageOf(p.stage);
    let households = posInt(p.households) ?? posInt(p.units);
    if (to) {
      linked++;
      const ev = (events?.all(to) ?? []) as Array<{ stage: string; units: number | null }>;
      const best = ev.map((e) => stageOf(e.stage)).filter((s) => s !== "미확인").sort((a, b) => STAGES.indexOf(b) - STAGES.indexOf(a))[0];
      if (!isPlan && best) stage = best;
      if (!isPlan) households = ev.map((e) => posInt(e.units)).filter((u): u is number => u !== null).sort((a, b) => b - a)[0] ?? households;
    }
    const k = to ?? (isPlan ? sourceName(p.projectKey) : null) ?? z.stableId;
    zoneProject.set(z.featureId, k);
    const prev = projects.get(k);
    const row = to ? roster.get(to) : undefined;
    const name = isPlan ? sourceName(z.name) : sourceName(row?.name, z.name, p.name, p.altName, p.zoneName);
    const announcedDate = dateOf(p.announcedDate);
    // 한 사업의 구역이 여럿이면 단계·세대수는 처음 것을 유지하고, 이름은 원천값이 있는 쪽을 우선한다.
    projects.set(k, prev
      ? { ...prev, name: prev.name ?? name, announcedDate: [prev.announcedDate, announcedDate].filter((v): v is string => v !== null).sort()[0] ?? null,
        households: isPlan ? prev.households ?? households : prev.households, program: prev.program ?? (isPlan ? sourceName(p.program) : null),
        stageDetail: prev.stageDetail ?? (isPlan ? sourceName(p.stageName) : null), stageDate: prev.stageDate ?? (isPlan ? dateOf(p.stageDate) : null),
        areaKind: prev.areaKind ?? (isPlan ? sourceName(p.areaKind) : null),
        overview: prev.overview ?? (isPlan && p.overview && typeof p.overview === "object" && !Array.isArray(p.overview) ? p.overview as MaintenanceOverview : null) }
      : { key: k, name, stage, type: isPlan ? sourceName(p.projectType) ?? "종류 미확인" : sourceName(row?.type) && row?.type !== "미상" ? row!.type : typeOf(z), households,
        operator: sourceName(row?.operator), designatedAt: dateOf(row?.designatedAt), announcedDate, rawStage: sourceName(row?.rawStage), linked: Boolean(to),
        program: isPlan ? sourceName(p.program) : null, stageDetail: isPlan ? sourceName(p.stageName) : null, stageDate: isPlan ? dateOf(p.stageDate) : null,
        areaKind: isPlan ? sourceName(p.areaKind) : null, overview: isPlan && p.overview && typeof p.overview === "object" && !Array.isArray(p.overview) ? p.overview as MaintenanceOverview : null });
  }
  for (const [featureId, values] of dates) {
    const project = projects.get(zoneProject.get(featureId) ?? "");
    if (project && !project.announcedDate) project.announcedDate = values.sort()[0] ?? null;
  }
  return { zones, projects, zoneProject, sources, linked, key };
}

function withZones(ctx: EngineContext, collection: MaintenanceCollection): TileResult {
  const { zones, projects, zoneProject, sources, linked } = collection;
  const list = [...projects.values()];

  const metrics: TileDraft["metrics"] = [
    obs("zones_in_radius", "반경과 교차하는 정비구역", zones.length, "곳", "a09-zones@1:경계가 반경 원과 교차"),
    obs("projects_in_radius", "반경 관련 사업", list.length, "건", "a09-projects@1:구역을 사업 단위로 묶은 고유 건수"),
    ...commonMetrics(list, ""),
  ];
  const sentence =
    list.length === 0
      ? "반경과 교차하는 확인된 정비구역 없음 → 경계가 확보된 사업 기준이며 없다는 단정은 아님 → 최신 고시는 지자체 확인 필요"
      : `반경과 교차하는 정비구역 ${zones.length}곳(사업 ${list.length}건: ${summarize(list).types.map(([t, n]) => `${t} ${n}건`).join("·")} / ${stageText(list)}), ${hhText(list)} → 사업 수만으로 좋고 나쁨을 판단하지 않으며 단계는 원천 기준일 시점 → 단계·구역 경계는 고시 원문 확인 필요`;

  const limitations: Limitation[] = [
    { kind: "partial", note: "경계가 확보된 사업만 반경 안 여부를 판단합니다. 경계가 없는 사업은 세지 않았습니다." },
    { kind: "unknown", note: "예정 세대는 사업 전체 값이며 반경 안 배분값이 아닙니다." },
    ...(zones.length > 0 && linked < zones.length ? [{ kind: "unknown" as const, note: `사업 연결이 없는 구역 ${zones.length - linked}곳은 구역 속성만으로 단계·유형을 표시합니다.` }] : []),
    ...KEYS.filter((k) => ctx.sources(k, maintenanceSourceIds(ctx, k)).length > 0).flatMap((k) => ctx.coverage(k, maintenanceSourceIds(ctx, k))).filter((l, i, a) => a.findIndex((x) => x.note === l.note) === i),
  ];
  return makeTile(ctx, {
    code: "A09",
    status: "partial",
    metrics,
    judgment: { ruleId: "a09-maintenance@1", basisMetricIds: ["zones_in_radius", "projects_in_radius"], sentence, level: null, criteria: null },
    sources,
    // D23가 반경 절단·단계 레이어를 이미 제공하므로 A09의 원본 점·면은 중복하지 않는다.
    layers: [],
    limitations,
  });
}

function typeOf(hit: FeatureHit): string {
  // maintenance-zone.ts의 typeFromText와 같은 이름 판정 순서다.
  const name = [hit.name, hit.properties.name, hit.properties.altName].filter((v): v is string => typeof v === "string").join(" ");
  if (name.includes("재개발") || name.includes("도시환경정비")) return "재개발";
  if (name.includes("재건축")) return "재건축";
  if (name.includes("주거환경")) return "주거환경개선";
  const layers: Record<string, string> = { redevelopment: "재개발", improvement: "주거환경개선", promotion: "재정비촉진지구", planned: "정비예정구역" };
  return layers[String(hit.properties.layer)] ?? "종류 미확인";
}

// ── 2) 명부만 있는 경우 ──
interface RosterRow { id: string; sido: string; sigungu: string; name: string | null; type: string; stage: string; households: number | null; operator?: string | null; designatedAt?: string | null; rawStage?: string | null }

function rosterRows(ctx: EngineContext): RosterRow[] {
  const market = ctx.db("market");
  return (market
    ? (market.prepare("SELECT coverage_json FROM source_release WHERE source_id IN ('maintenance_integrated','maintenance_std') ORDER BY release_id").pluck().all() as Array<string | null>)
    : []
  ).flatMap((j) => (j ? ((JSON.parse(j) as { projects?: RosterRow[] }).projects ?? []) : []));
}

export function collectMaintenanceRoster(ctx: EngineContext): Project[] {
  const rows = rosterRows(ctx);
  const areas = ctx.sigungu();
  const seen = new Set<string>();
  const list: Project[] = [];
  for (const r of rows) {
    if (seen.has(r.id) || !areas.some((a) => a.code.startsWith(r.sido) && sigunguMatches(a.name, r.sigungu))) continue;
    seen.add(r.id);
    list.push({ key: r.id, name: sourceName(r.name), stage: stageOf(r.stage), type: r.type && r.type !== "미상" ? r.type : "종류 미확인", households: posInt(r.households), operator: sourceName(r.operator), designatedAt: dateOf(r.designatedAt), announcedDate: null, rawStage: sourceName(r.rawStage), linked: false, program: null, stageDetail: null, stageDate: null, areaKind: null, overview: null });
  }
  return list;
}

function rosterOnly(ctx: EngineContext, sources: ReturnType<EngineContext["sources"]>): TileResult {
  const list = collectMaintenanceRoster(ctx);
  const areas = ctx.sigungu();
  const metrics: TileDraft["metrics"] = [
    obs("roster_projects", "반경이 걸친 시군구의 정비사업(반경 내 여부 미확인)", list.length, "건", "a09-roster@1:시군구 단위 명부, 경계 없음"),
    ...commonMetrics(list, ""),
  ];
  const areaTxt = areas.map((a) => a.name).filter(Boolean).join("·") || "해당 시군구";
  const sentence =
    list.length === 0
      ? `${areaTxt} 명부에 정비사업 없음 → 경계가 없어 반경 안 여부는 원래 알 수 없고 명부가 일부일 수 있음 → 지자체 고시 확인 필요`
      : `${areaTxt} 정비사업 명부 ${list.length}건(${stageText(list)}), ${hhText(list)} → 경계가 없어 반경 안에 있는지는 확인되지 않은 시군구 단위 목록 → 구역 위치는 지자체 고시 확인 필요`;
  return makeTile(ctx, {
    code: "A09",
    status: "partial",
    metrics,
    judgment: { ruleId: "a09-maintenance-roster@1", basisMetricIds: ["roster_projects"], sentence, level: null, criteria: null },
    sources,
    layers: [],
    limitations: [
      { kind: "not_provided", note: "경계 없음 — 반경 내 여부 미확인, 시군구 단위 목록" },
      { kind: "unknown", note: "예정 세대는 사업 전체 값이며 반경 안 배분값이 아닙니다. 세대수가 없는 사업은 합산에서 빠집니다." },
      ...ctx.coverage("market", maintenanceSourceIds(ctx, "market")),
    ],
  });
}

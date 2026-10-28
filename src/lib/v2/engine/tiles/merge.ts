/** 흡수된 타일의 계산 결과를 남는 타일로 합친다. 원천·지도·지표를 버리지 않고 중복 id만 정리한다. */
import { MAX_D05_BUILDING_POLYGONS, MAX_MAP_FEATURES, MAX_MAP_LINES, MAX_MAP_POLYGONS, parseTileResult, type MapFeature, type MapLine, type MapPolygon, type TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { d05RepresentativeDistanceM } from "./common";

type Metric = TileResult["metrics"][number];

export interface MergeOptions {
  /** 양쪽 결과에 같은 지표 id가 있으면 추가 결과를 우선한다. */
  replaceMetricIds?: readonly string[];
  /** 병합 결과에서 양쪽 모두 제거할 지표 id. */
  dropMetricIds?: readonly string[];
  /** 판정을 기본 타일 그대로 둘지, 두 문장을 이어 붙일지. 기본값은 base. */
  judgment?: "base" | "concat";
  /** D05가 D06·D07을 흡수할 때만 건물 단위로 지도 cap을 적용한다. */
  d05BuildingPolygons?: boolean;
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** 상한 전(before)에 있던 센 지물(`counted: true`)이 상한 뒤(after)에 하나도 안 남았으면 true. 같은 key의 조각이 하나라도 남으면 남은 것이다. */
function lostCounted<T extends { counted?: boolean }>(before: readonly T[], after: readonly T[], key: (item: T) => string): boolean {
  const kept = new Set(after.map(key));
  return before.some((item) => item.counted === true && !kept.has(key(item)));
}

function metricKey(metric: Metric): string {
  return metric.id;
}

function featureKey(feature: MapFeature): string {
  return `${feature.fid ?? ""}|${feature.layer}|${feature.lng}|${feature.lat}`;
}

function polygonKey(polygon: MapPolygon): string {
  return `${polygon.fid ?? ""}|${polygon.layer}|${polygon.rings[0]?.[0]?.join(",") ?? ""}`;
}

function lineKey(line: MapLine): string {
  return `${line.fid ?? ""}|${line.layer}|${line.points[0]?.join(",") ?? ""}|${line.points.at(-1)?.join(",") ?? ""}`;
}

function d05BuildingKey(polygon: MapPolygon): string {
  const fid = polygon.fid?.trim() ?? "";
  if (/^-?\d+$/.test(fid)) return `feature:${Math.floor(Number(fid) / 1000)}`;
  return `fid:${fid || polygon.rings[0]?.[0]?.join(",") || polygonKey(polygon)}`;
}

function d05LayerRank(layer: string): number {
  if (layer.startsWith("floors_")) return 0;
  if (layer.startsWith("tall_")) return 1;
  if (layer.startsWith("low_")) return 2;
  return 3;
}

function d05LabelValue(polygon: MapPolygon): { kind: number; value: number } {
  const text = polygon.sublabel ?? "";
  const floor = text.match(/^(\d+(?:\.\d+)?)층$/);
  if (floor) return { kind: 2, value: Number(floor[1]) };
  const height = text.match(/^(\d+(?:\.\d+)?)m$/);
  if (height) return { kind: 1, value: Number(height[1]) };
  return { kind: 0, value: -1 };
}

/**
 * D05는 한 건물을 기본·고층·저층 보기에서 각각 한 면으로만 보존한다.
 * 같은 건물의 multipart/중복 조각은 보기(layer)별 첫 면으로 정리하고,
 * 먼저 분석 중심에서 가까운 건물 3,000동을 선택하고, 선택된 건물만 기존 층수 우선
 * 출력 순서로 정렬한다. 대표점은 WGS84 외곽 고리의 꼭짓점 평균이며, 같은 건물의
 * 기본·고층·저층 도형은 같은 footprint를 공유하므로 선택 기준으로 충분하다.
 */
function capD05BuildingPolygons(items: MapPolygon[], center: readonly [number, number]): MapPolygon[] {
  const byExactKey = new Map<string, MapPolygon>();
  for (const item of items) {
    const key = `${d05BuildingKey(item)}|${item.layer}`;
    if (!byExactKey.has(key)) byExactKey.set(key, item);
  }

  const groups = new Map<string, { items: MapPolygon[]; first: number; distanceM: number }>();
  [...byExactKey.values()].forEach((item, index) => {
    const key = d05BuildingKey(item);
    const group = groups.get(key);
    const distanceM = d05RepresentativeDistanceM(center, item);
    if (group) {
      group.items.push(item);
      group.distanceM = Math.min(group.distanceM, distanceM);
    } else groups.set(key, { items: [item], first: index, distanceM });
  });
  const nearestGroups = [...groups.values()].sort((a, b) => {
    return a.distanceM - b.distanceM || a.first - b.first;
  }).slice(0, MAX_MAP_POLYGONS);
  const orderedGroups = nearestGroups.sort((a, b) => {
    const aValue = a.items.map(d05LabelValue).sort((x, y) => y.kind - x.kind || y.value - x.value)[0]!;
    const bValue = b.items.map(d05LabelValue).sort((x, y) => y.kind - x.kind || y.value - x.value)[0]!;
    return bValue.kind - aValue.kind || bValue.value - aValue.value || a.first - b.first;
  });

  const output: MapPolygon[] = [];
  for (const group of orderedGroups) {
    const variants = [...group.items].sort((a, b) => d05LayerRank(a.layer) - d05LayerRank(b.layer));
    if (output.length + variants.length > MAX_D05_BUILDING_POLYGONS) break;
    output.push(...variants);
  }
  return output;
}

function sourceKey(source: TileResult["provenance"]["sources"][number]): string {
  return `${source.sourceId}|${source.releaseId}`;
}

function limitationKey(limitation: TileResult["limitations"][number]): string {
  return `${limitation.kind}|${limitation.note}`;
}

/** 이미 각 결과에서 상한 처리된 배열을 합칠 때도 최종 계약 상한을 지킨다. */
export function capByLayer<T extends { layer: string }>(items: T[], max: number, preferredLayers: readonly string[] = []): T[] {
  if (items.length <= max) return items;
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.layer, [...(groups.get(item.layer) ?? []), item]);
  const preferred = new Map(preferredLayers.map((layer, index) => [layer, index]));
  const layers = [...groups.keys()].sort((a, b) => {
    if (preferred.has(a) || preferred.has(b)) return (preferred.get(a) ?? Number.MAX_SAFE_INTEGER) - (preferred.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b);
    if (a === "parcel_site") return -1;
    if (b === "parcel_site") return 1;
    return a.localeCompare(b);
  });
  if (preferredLayers.length > 0) return layers.flatMap((layer) => groups.get(layer) ?? []).slice(0, max);
  const capped: T[] = [];
  for (let index = 0; capped.length < max; index++) {
    for (const layer of layers) {
      const item = groups.get(layer)?.[index];
      if (item) capped.push(item);
      if (capped.length >= max) break;
    }
  }
  return capped;
}

function capMergedFeatures(items: MapFeature[], preferredLayers: readonly string[] = []): MapFeature[] {
  if (items.length <= MAX_MAP_FEATURES) return items;
  const highlighted = items.filter((item) => item.highlight);
  const normal = items.filter((item) => !item.highlight);
  if (highlighted.length >= MAX_MAP_FEATURES) return highlighted.slice(0, MAX_MAP_FEATURES);
  return [...capByLayer(normal, MAX_MAP_FEATURES - highlighted.length, preferredLayers), ...highlighted];
}

function mergedStatus(base: TileResult["status"], extra: TileResult["status"]): TileResult["status"] {
  if (base === "pending" || base === "running" || base === "cancelled" || base === "failed") return base;
  if (extra === "pending" || extra === "running" || extra === "cancelled" || extra === "failed") return extra;
  if (base === "not_provided") return extra;
  if (extra === "not_provided" || extra === "no_data") return base;
  if (base === "no_data") return extra;
  if (base === "partial" || extra === "partial") return "partial";
  return "complete";
}

function sanitizeJudgment(judgment: TileResult["judgment"], metrics: Metric[]): TileResult["judgment"] {
  if (!judgment) return null;
  const ids = new Set(metrics.map((metric) => metric.id));
  const basisMetricIds = judgment.basisMetricIds.filter((id) => ids.has(id));
  const grades = judgment.grades?.filter((grade) => ids.has(grade.metricId));
  const validGrades = judgment.level !== null && basisMetricIds.length > 0 ? grades : undefined;
  return {
    ...judgment,
    basisMetricIds,
    level: basisMetricIds.length > 0 ? judgment.level : null,
    criteria: basisMetricIds.length > 0 ? judgment.criteria : null,
    ...(validGrades && validGrades.length > 0 ? { grades: validGrades } : {}),
  };
}

function mergeJudgment(base: TileResult, extra: TileResult, metrics: Metric[], mode: "base" | "concat"): TileResult["judgment"] {
  if (mode === "base") return sanitizeJudgment(base.judgment ?? extra.judgment, metrics);
  if (!base.judgment) return sanitizeJudgment(extra.judgment, metrics);
  if (!extra.judgment) return sanitizeJudgment(base.judgment, metrics);
  const baseJudgment = sanitizeJudgment(base.judgment, metrics)!;
  const extraJudgment = sanitizeJudgment(extra.judgment, metrics)!;
  const basisMetricIds = [...new Set([...baseJudgment.basisMetricIds, ...extraJudgment.basisMetricIds])];
  const sentence = baseJudgment.sentence === extraJudgment.sentence
    ? baseJudgment.sentence
    : `${baseJudgment.sentence} · ${extraJudgment.sentence}`;
  return {
    ...baseJudgment,
    basisMetricIds,
    sentence,
    ...(baseJudgment.grades ? { grades: baseJudgment.grades } : extraJudgment.grades ? { grades: extraJudgment.grades } : {}),
  };
}

function mergedTotal(baseTotal: number | undefined, baseDisplayed: number, extraTotal: number | undefined, extraDisplayed: number, mergedDisplayed: number): number {
  const baseHidden = Math.max(0, (baseTotal ?? baseDisplayed) - baseDisplayed);
  const extraHidden = Math.max(0, (extraTotal ?? extraDisplayed) - extraDisplayed);
  return baseHidden + extraHidden + mergedDisplayed;
}

/** 계산 모듈이 아직 옛 tileCode를 반환해도 저장·화면에는 흡수 대상의 코드로 기록한다. */
export function retargetTile(tile: TileResult, ctx: EngineContext, code: string): TileResult {
  return parseTileResult({ ...tile, tileId: `${ctx.analysisId}-${code}`, analysisId: ctx.analysisId, tileCode: code });
}

export function mergeTileResults(base: TileResult, extra: TileResult, options: MergeOptions = {}): TileResult {
  const replace = new Set(options.replaceMetricIds ?? []);
  const drop = new Set(options.dropMetricIds ?? []);
  const baseMetrics = base.metrics.filter((metric) => !replace.has(metric.id) && !drop.has(metric.id));
  const extraMetrics = extra.metrics.filter((metric) => !drop.has(metric.id));
  const metrics = dedupe([...baseMetrics, ...extraMetrics], metricKey);
  const baseFeatures = base.presentation.features ?? [];
  const extraFeatures = extra.presentation.features ?? [];
  const basePolygons = base.presentation.polygons ?? [];
  const extraPolygons = extra.presentation.polygons ?? [];
  const baseLines = base.presentation.lines ?? [];
  const extraLines = extra.presentation.lines ?? [];
  const preferredLayers = [...new Set([
    ...base.presentation.layers,
    ...baseFeatures.map((item) => item.layer),
    ...basePolygons.map((item) => item.layer),
    ...baseLines.map((item) => item.layer),
  ])];
  const allFeatures = dedupe([...baseFeatures, ...extraFeatures], featureKey);
  const allPolygons = dedupe([...basePolygons, ...extraPolygons], polygonKey);
  const allLines = dedupe([...baseLines, ...extraLines], lineKey);
  const features = capMergedFeatures(allFeatures, preferredLayers);
  const polygons = options.d05BuildingPolygons
    ? capD05BuildingPolygons(allPolygons, base.conditions.center)
    : capByLayer(allPolygons, MAX_MAP_POLYGONS, preferredLayers);
  const lines = capByLayer(allLines, MAX_MAP_LINES, preferredLayers);
  // 흡수한 쪽이 이미 센 지물을 잘랐거나, 이 병합 상한이 센 지물을 떨어뜨렸으면 표시를 단다.
  const countedCapped = !!(base.presentation.countedCapped || extra.presentation.countedCapped)
    || lostCounted(allFeatures, features, (item) => item.fid ?? featureKey(item))
    || lostCounted(allPolygons, polygons, options.d05BuildingPolygons ? d05BuildingKey : (item) => item.fid ?? polygonKey(item))
    || lostCounted(allLines, lines, (item) => item.fid ?? lineKey(item));
  const rasterRefs = dedupe([...(base.presentation.rasters ?? []), ...(extra.presentation.rasters ?? [])], (ref) => ref.name);
  const sourceRefs = dedupe([...base.provenance.sources, ...extra.provenance.sources], sourceKey);
  const limitations = dedupe([...base.limitations, ...extra.limitations], limitationKey);
  const legend = dedupe([...base.presentation.legend, ...extra.presentation.legend], (entry) => `${entry.label}|${entry.min ?? ""}|${entry.max ?? ""}`);
  const presentation = {
    ...base.presentation,
    legend,
    layers: [...new Set([...base.presentation.layers, ...extra.presentation.layers])],
    ...(features.length > 0 ? { features, featuresTotal: mergedTotal(base.presentation.featuresTotal, baseFeatures.length, extra.presentation.featuresTotal, extraFeatures.length, features.length) } : {}),
    ...(polygons.length > 0 ? { polygons, polygonsTotal: mergedTotal(base.presentation.polygonsTotal, basePolygons.length, extra.presentation.polygonsTotal, extraPolygons.length, polygons.length) } : {}),
    ...(lines.length > 0 ? { lines, linesTotal: mergedTotal(base.presentation.linesTotal, baseLines.length, extra.presentation.linesTotal, extraLines.length, lines.length) } : {}),
    ...(rasterRefs.length > 0 ? { rasters: rasterRefs } : {}),
    ...(countedCapped ? { countedCapped: true } : {}),
  };
  return parseTileResult({
    ...base,
    status: mergedStatus(base.status, extra.status),
    metrics,
    judgment: mergeJudgment(base, extra, metrics, options.judgment ?? "base"),
    presentation,
    provenance: { ...base.provenance, sources: sourceRefs },
    limitations,
  });
}

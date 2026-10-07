/** 흡수된 타일의 계산 결과를 남는 타일로 합친다. 원천·지도·지표를 버리지 않고 중복 id만 정리한다. */
import { MAX_MAP_FEATURES, MAX_MAP_LINES, MAX_MAP_POLYGONS, parseTileResult, type MapFeature, type MapLine, type MapPolygon, type TileResult } from "../../tile-result";
import type { EngineContext } from "../context";

type Metric = TileResult["metrics"][number];

export interface MergeOptions {
  /** 양쪽 결과에 같은 지표 id가 있으면 추가 결과를 우선한다. */
  replaceMetricIds?: readonly string[];
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

function sourceKey(source: TileResult["provenance"]["sources"][number]): string {
  return `${source.sourceId}|${source.releaseId}`;
}

function limitationKey(limitation: TileResult["limitations"][number]): string {
  return `${limitation.kind}|${limitation.note}`;
}

/** 이미 각 결과에서 상한 처리된 배열을 합칠 때도 최종 계약 상한을 지킨다. */
function capByLayer<T extends { layer: string }>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.layer, [...(groups.get(item.layer) ?? []), item]);
  const layers = [...groups.keys()].sort((a, b) => {
    if (a === "parcel_site") return -1;
    if (b === "parcel_site") return 1;
    return a.localeCompare(b);
  });
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

function capMergedFeatures(items: MapFeature[]): MapFeature[] {
  if (items.length <= MAX_MAP_FEATURES) return items;
  const highlighted = items.filter((item) => item.highlight);
  const normal = items.filter((item) => !item.highlight);
  if (highlighted.length >= MAX_MAP_FEATURES) return highlighted.slice(0, MAX_MAP_FEATURES);
  return [...capByLayer(normal, MAX_MAP_FEATURES - highlighted.length), ...highlighted];
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

function mergeJudgment(base: TileResult, extra: TileResult, metrics: Metric[]): TileResult["judgment"] {
  if (!base.judgment) return extra.judgment;
  if (!extra.judgment) return base.judgment;
  const ids = new Set(metrics.map((metric) => metric.id));
  const basisMetricIds = [...new Set([...base.judgment.basisMetricIds, ...extra.judgment.basisMetricIds])].filter((id) => ids.has(id));
  const sentence = base.judgment.sentence === extra.judgment.sentence
    ? base.judgment.sentence
    : `${base.judgment.sentence} · ${extra.judgment.sentence}`;
  return {
    ...base.judgment,
    basisMetricIds,
    sentence,
    ...(base.judgment.grades ? { grades: base.judgment.grades } : extra.judgment.grades ? { grades: extra.judgment.grades } : {}),
  };
}

/** 계산 모듈이 아직 옛 tileCode를 반환해도 저장·화면에는 흡수 대상의 코드로 기록한다. */
export function retargetTile(tile: TileResult, ctx: EngineContext, code: string): TileResult {
  return parseTileResult({ ...tile, tileId: `${ctx.analysisId}-${code}`, analysisId: ctx.analysisId, tileCode: code });
}

export function mergeTileResults(base: TileResult, extra: TileResult, options: MergeOptions = {}): TileResult {
  const replace = new Set(options.replaceMetricIds ?? []);
  const baseMetrics = base.metrics.filter((metric) => !replace.has(metric.id));
  const metrics = dedupe([...baseMetrics, ...extra.metrics], metricKey);
  const features = capMergedFeatures(dedupe([...(base.presentation.features ?? []), ...(extra.presentation.features ?? [])], featureKey));
  const polygons = capByLayer(dedupe([...(base.presentation.polygons ?? []), ...(extra.presentation.polygons ?? [])], polygonKey), MAX_MAP_POLYGONS);
  const lines = capByLayer(dedupe([...(base.presentation.lines ?? []), ...(extra.presentation.lines ?? [])], lineKey), MAX_MAP_LINES);
  const rasterRefs = dedupe([...(base.presentation.rasters ?? []), ...(extra.presentation.rasters ?? [])], (ref) => ref.name);
  const sourceRefs = dedupe([...base.provenance.sources, ...extra.provenance.sources], sourceKey);
  const limitations = dedupe([...base.limitations, ...extra.limitations], limitationKey);
  const legend = dedupe([...base.presentation.legend, ...extra.presentation.legend], (entry) => `${entry.label}|${entry.min ?? ""}|${entry.max ?? ""}`);
  const presentation = {
    ...base.presentation,
    legend,
    layers: [...new Set([...base.presentation.layers, ...extra.presentation.layers])],
    ...(features.length > 0 ? { features, featuresTotal: (base.presentation.featuresTotal ?? base.presentation.features?.length ?? 0) + (extra.presentation.featuresTotal ?? extra.presentation.features?.length ?? 0) } : {}),
    ...(polygons.length > 0 ? { polygons, polygonsTotal: (base.presentation.polygonsTotal ?? base.presentation.polygons?.length ?? 0) + (extra.presentation.polygonsTotal ?? extra.presentation.polygons?.length ?? 0) } : {}),
    ...(lines.length > 0 ? { lines, linesTotal: (base.presentation.linesTotal ?? base.presentation.lines?.length ?? 0) + (extra.presentation.linesTotal ?? extra.presentation.lines?.length ?? 0) } : {}),
    ...(rasterRefs.length > 0 ? { rasters: rasterRefs } : {}),
  };
  return parseTileResult({
    ...base,
    status: mergedStatus(base.status, extra.status),
    metrics,
    judgment: mergeJudgment(base, extra, metrics),
    presentation,
    provenance: { ...base.provenance, sources: sourceRefs },
    limitations,
  });
}

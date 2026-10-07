import type { MapModel } from "./map-layers";
import type { Badge, TileView } from "./tile-view";
import type { SourceRefLike } from "./source-details";

const unique = <T>(items: T[]): T[] => [...new Set(items)];

function sourceUnion(layers: TileView[]): string {
  const sources = unique(
    layers
      .flatMap((layer) => layer.sourceLine.split(" · "))
      .filter((source) => source && source !== "출처 없음"),
  );
  return sources.length > 0 ? sources.join(" · ") : "출처 없음";
}

function sourceRefsUnion(layers: TileView[]): SourceRefLike[] {
  const out = new Map<string, SourceRefLike>();
  for (const source of layers.flatMap((layer) => layer.sourceRefs)) {
    const key = `${source.sourceId}:${source.releaseId}`;
    if (!out.has(key)) out.set(key, source);
  }
  return [...out.values()];
}

function badgeUnion(layers: TileView[]): Badge[] {
  const out = new Map<string, Badge>();
  for (const badge of layers.flatMap((layer) => layer.badges)) {
    const previous = out.get(badge.text);
    if (!previous) out.set(badge.text, { ...badge });
    else if (badge.note && previous.note !== badge.note) previous.note = previous.note ? `${previous.note} / ${badge.note}` : badge.note;
  }
  return [...out.values()];
}

function mapUnion(layers: TileView[]): MapModel | null {
  const maps = layers.map((layer) => layer.map).filter((map): map is MapModel => map !== null);
  const first = maps[0] ?? layers[0]?.backdrop;
  if (!first) return null;
  return {
    center: first.center,
    radiusM: first.radiusM,
    features: maps.flatMap((map) => map.features),
    polygons: maps.flatMap((map) => map.polygons ?? []),
    siteParcel: maps.find((map) => map.siteParcel && map.siteParcel.length > 0)?.siteParcel ?? first.siteParcel ?? null,
    polygonsTotal: maps.reduce((sum, map) => sum + (map.polygonsTotal ?? map.polygons?.length ?? 0), 0),
    total: maps.reduce((sum, map) => sum + map.total, 0),
    notes: unique(maps.flatMap((map) => map.notes)),
  };
}

function statusOf(layers: TileView[]): TileView["status"] {
  if (layers.length === 0) return "not_provided";
  if (layers.every((layer) => layer.status === "not_provided")) return "not_provided";
  if (layers.some((layer) => layer.status !== "complete")) return "partial";
  return "complete";
}

/** 분석·도판 타일 여러 층을 화면·보고서용 하나의 순수 뷰로 합친다. */
export function stackView(id: string, layers: TileView[]): TileView {
  const titles = layers.map((layer) => layer.title);
  const first = layers[0];
  const map = mapUnion(layers);
  const backdrop = first?.backdrop ?? { center: [0, 0] as const, radiusM: 1, features: [], total: 0, notes: [] };
  const rows = unique(layers.flatMap((layer) => layer.rows).map((row) => row.label)).map((label) => {
    const row = layers.flatMap((layer) => layer.rows).find((candidate) => candidate.label === label)!;
    return row;
  });
  return {
    tileId: id,
    code: "STACK",
    title: "레이어 스택",
    color: first?.color ?? "#7A7E87",
    status: statusOf(layers),
    badges: badgeUnion(layers),
    headline: { value: `${layers.length}층`, label: titles.join(" + ") },
    headlineMetricId: null,
    rows,
    sentence: unique(layers.map((layer) => layer.sentence).filter((sentence): sentence is string => !!sentence)).join(" / ") || null,
    grade: null,
    grades: [],
    caveats: unique(layers.flatMap((layer) => layer.caveats)),
    notes: unique(titles),
    sourceLine: sourceUnion(layers),
    sourceRefs: sourceRefsUnion(layers),
    chart: null,
    hasFace: false,
    retryable: false,
    map,
    backdrop,
    kindLabel: "스택",
    callout: null,
    mass: null,
    stackLayers: unique(titles),
    sheetTiles: null,
    sheetGrid: null,
  };
}

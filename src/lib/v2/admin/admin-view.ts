import type { AdminOverview, AdminSource, AdminTile } from "./overview";
import type { TileRequestPin } from "./requests";

export type SourceRow = {
  key: string;
  label: string;
  sourceIds: string[];
  asOf: string | null;
  ageDays: number | null;
  license: string;
  warn: "stale" | "missing" | null;
  tileCodes: string[];
};

export const STALE_DAYS = 180;

function oldestSource(sources: readonly AdminSource[]): AdminSource | null {
  return [...sources].sort((left, right) => {
    const leftAge = left.ageDays ?? -1;
    const rightAge = right.ageDays ?? -1;
    return rightAge - leftAge || left.sourceId.localeCompare(right.sourceId);
  })[0] ?? null;
}

export function groupSources(sources: AdminSource[]): SourceRow[] {
  const groups = new Map<string, AdminSource[]>();
  for (const source of sources) {
    const key = source.group?.trim() || source.sourceId;
    const members = groups.get(key);
    if (members) members.push(source);
    else groups.set(key, [source]);
  }

  return [...groups.entries()].map(([key, members]) => {
    const oldest = oldestSource(members);
    const sourceIds = [...new Set(members.map((source) => source.sourceId))];
    const tileCodes = [...new Set(members.flatMap((source) => source.usedBy))].sort();
    const ageDays = oldest?.ageDays ?? null;
    return {
      key,
      label: members[0]?.group?.trim() || members[0]?.name || key,
      sourceIds,
      asOf: oldest?.asOf ?? null,
      ageDays,
      license: oldest?.license || "미기록",
      warn: ageDays === null ? "missing" : ageDays >= STALE_DAYS ? "stale" : null,
      tileCodes,
    };
  });
}

export type TileFilter = "all" | "analysis" | "diagram" | "simulation" | "mismatch" | "pending" | "requests";

const PENDING_RESULT_STATUSES = new Set(["pending", "running", "no_data", "failed"]);

export function filterTiles(tiles: AdminTile[], filter: TileFilter, pendingByTile: Record<string, number>): AdminTile[] {
  if (filter === "all") return tiles;
  if (filter === "analysis" || filter === "diagram" || filter === "simulation") {
    return tiles.filter((tile) => tile.kind === filter);
  }
  if (filter === "mismatch") return tiles.filter((tile) => tile.check.status === "mismatch");
  if (filter === "pending") return tiles.filter((tile) => tile.resultStatus === null || PENDING_RESULT_STATUSES.has(tile.resultStatus));
  return tiles.filter((tile) => (pendingByTile[tile.code] ?? 0) > 0);
}

export function sourceLinkForTile(row: SourceRow, tile: AdminTile): "used" | "missingFromCatalog" | "unusedInCatalog" | "none" {
  const sourceIds = new Set(row.sourceIds);
  const declared = tile.declaredSources.some((sourceId) => sourceIds.has(sourceId));
  const actual = tile.actualSources?.some((sourceId) => sourceIds.has(sourceId)) ?? false;
  if (actual && declared) return "used";
  if (actual) return "missingFromCatalog";
  if (declared && tile.actualSources !== null) return "unusedInCatalog";
  return "none";
}

export function tilesForSource(row: SourceRow, tiles: AdminTile[]): Set<string> {
  const sourceIds = new Set(row.sourceIds);
  return new Set(tiles
    .filter((tile) => tile.declaredSources.some((sourceId) => sourceIds.has(sourceId)) || tile.actualSources?.some((sourceId) => sourceIds.has(sourceId)))
    .map((tile) => tile.code));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function pinFromClick(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): TileRequestPin | null {
  if (![rect.left, rect.top, rect.width, rect.height, clientX, clientY].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  if (clientX < rect.left || clientX > rect.left + rect.width || clientY < rect.top || clientY > rect.top + rect.height) return null;
  return {
    x: round3((clientX - rect.left) / rect.width),
    y: round3((clientY - rect.top) / rect.height),
  };
}

export function requestContext(tile: AdminTile, overview: AdminOverview): Record<string, unknown> {
  return {
    tileCode: tile.code,
    title: tile.title,
    forms: tile.forms,
    declaredSources: tile.declaredSources,
    actualSources: tile.actualSources,
    check: tile.check,
    files: tile.files,
    cacheVersion: tile.cacheVersion,
    resultStatus: tile.resultStatus,
    analysisId: overview.analysis?.id ?? null,
    analysisDate: overview.analysis?.analysisDate ?? null,
    analysis: overview.analysis,
  };
}

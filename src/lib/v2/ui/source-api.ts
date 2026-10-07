export const MAX_SOURCE_IDS = 100;

export type SourceApiSource = {
  sourceId: string;
  releaseId: string;
  provider: string;
  sourceUrl: string;
  sourceAsOf: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  licenseCode: string;
  rights: Record<string, unknown>;
};

export type SourceApiSnapshot = {
  manifestVersion: string | null;
  manifestCreatedAt: string | null;
  rows: readonly SourceApiSource[];
};

export type SourceApiBody = {
  manifestVersion: string | null;
  manifestCreatedAt: string | null;
  sources: SourceApiSource[];
};

/** ids=a,b 형식과 ids=a&ids=b 형식을 모두 받으며 순서와 중복 제거를 보존한다. */
export function parseSourceIds(values: readonly string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const part of value.split(",")) {
      const id = part.trim();
      if (!id || !/^[A-Za-z0-9_.:@-]+$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= MAX_SOURCE_IDS) return ids;
    }
  }
  return ids;
}

function matchesRequested(row: SourceApiSource, requested: string): boolean {
  const separator = requested.indexOf(":");
  if (separator >= 0) return `${row.sourceId}:${row.releaseId}` === requested;
  return row.sourceId === requested;
}

/** sourceId 또는 sourceId:releaseId 요청에 해당하는 게시 메타만 선택한다. */
export function sourceRowsForIds(rows: readonly SourceApiSource[], requestedIds: readonly string[]): SourceApiSource[] {
  const selected: SourceApiSource[] = [];
  const seen = new Set<string>();
  for (const requested of parseSourceIds(requestedIds)) {
    for (const row of rows) {
      if (!matchesRequested(row, requested)) continue;
      const key = `${row.sourceId}:${row.releaseId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(row);
    }
  }
  return selected;
}

export function sourceApiBody(snapshot: SourceApiSnapshot, requestedIds: readonly string[]): SourceApiBody {
  return {
    manifestVersion: snapshot.manifestVersion,
    manifestCreatedAt: snapshot.manifestCreatedAt,
    sources: sourceRowsForIds(snapshot.rows, requestedIds),
  };
}

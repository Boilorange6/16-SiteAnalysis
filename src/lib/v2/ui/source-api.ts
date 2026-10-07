import type { SourceMeta } from "./source-details";

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

/** 화면의 provenance 참조를 API가 이해하는 sourceId:releaseId 요청으로 만든다. */
export function sourceIdsForRefs(refs: readonly { sourceId: string; releaseId: string }[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const id = `${ref.sourceId}:${ref.releaseId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_SOURCE_IDS) break;
  }
  return ids;
}

/** API 응답을 source-details가 읽는 키(sourceId:releaseId/sourceId)로 정규화한다. */
export function sourceMetaMap(rows: readonly SourceApiSource[]): Map<string, SourceMeta> {
  const meta = new Map<string, SourceMeta>();
  for (const row of rows) {
    const value = {
      sourceId: row.sourceId,
      releaseId: row.releaseId,
      provider: row.provider,
      sourceUrl: row.sourceUrl,
      sourceAsOf: row.sourceAsOf,
      licenseCode: row.licenseCode,
    } satisfies SourceMeta;
    meta.set(`${row.sourceId}:${row.releaseId}`, value);
    if (!meta.has(row.sourceId)) meta.set(row.sourceId, value);
  }
  return meta;
}

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

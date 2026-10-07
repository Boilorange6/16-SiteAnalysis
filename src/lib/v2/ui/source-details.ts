import { SOURCE_NAMES, catalogEntry, sourceName } from "./tile-catalog";

export const UNKNOWN_AS_OF = "기준일 미확인";

export type SourceDetailRole = "주 원천" | "보강" | "입력";

export type SourceMeta = {
  sourceId?: string;
  releaseId?: string;
  provider?: string | null;
  name?: string | null;
  sourceUrl?: string | null;
  url?: string | null;
  sourceAsOf?: string | null;
  asOf?: string | null;
  licenseCode?: string | null;
  license?: string | null;
};

export type SourceRefLike = {
  sourceId: string;
  releaseId: string;
  sourceAsOf: string | null;
  fetchedAt?: string;
};

export type SourceDetailTile = {
  code: string;
  tileType: string;
  provenance: { sources: readonly SourceRefLike[] };
};

export type SourceDetailRow = {
  sourceId: string;
  provider: string;
  name: string;
  role: SourceDetailRole;
  asOf: string;
  license: string;
  url: string;
  usedFor: string | null;
};

export type SourceDetails = {
  calcMethod: string | null;
  rows: SourceDetailRow[];
};

type SourceDefinition = {
  role?: "보강";
  usedFor: string | null;
};

/**
 * 원천의 역할과 사용처는 화면이나 엔진 곳곳에 흩뜨리지 않고 이 표에서만 정의한다.
 * 표에 없는 원천은 provenance 순서의 첫 원천을 주 원천으로, 나머지를 보강으로 본다.
 */
export const SOURCE_DETAIL_DEFINITIONS: Readonly<Record<string, SourceDefinition>> = {
  building: { usedFor: "건물 도형·사용승인일·높이" },
  building_juso: { role: "보강", usedFor: "GIS에 없는 건물과 층수·건물명 보강" },
  gis_bldg: { usedFor: "GIS건물통합정보 건물 도형·속성" },
  ledger_recap: { usedFor: "공동주택·오피스텔 단지·세대·준공 정보" },
  ledger_title: { role: "보강", usedFor: "총괄표제부에 없는 건물의 준공·층수·용도 보강" },
  kapt: { role: "보강", usedFor: "대장에 없는 단지 식별과 세대수 보강" },
  parcel_polygon: { usedFor: "대지·연속지적 도형과 지목" },
  land_price: { usedFor: "개별공시지가" },
  terrain_tiles: { usedFor: "DEM 표면고·지형·경사·하늘열림 보강" },
  asos: { usedFor: "최근접 ASOS 관측소의 풍향·기상" },
  osm_roads: { usedFor: "OSM 도로·보행망" },
  osm_landuse: { usedFor: "OSM 토지이용·녹지 면" },
  osm_water: { usedFor: "OSM 수계 면" },
  osm_subway: { usedFor: "OSM 철도역·노선" },
  browser_lbm: { role: "보강", usedFor: "브라우저 바람 흐름 계산" },
  fallback_d2q9: { role: "보강", usedFor: "바람 흐름 내장 보정 계산" },
};

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function metaFor(meta: ReadonlyMap<string, SourceMeta>, source: SourceRefLike): SourceMeta | undefined {
  return meta.get(`${source.sourceId}:${source.releaseId}`) ?? meta.get(source.sourceId);
}

function licenseOf(meta: SourceMeta | undefined): string {
  const raw = nonEmpty(meta?.licenseCode) ?? nonEmpty(meta?.license);
  if (!raw || /^(?:UNKNOWN|UNRECORDED|미기록)$/i.test(raw)) return "미기록";
  if (/^UNRESTRICTED$/i.test(raw)) return "이용허락범위 제한 없음";
  if (/^attribution$/i.test(raw)) return "출처 표시";
  return raw;
}

function nameOf(sourceId: string, meta: SourceMeta | undefined): string {
  return nonEmpty(meta?.name) ?? (SOURCE_NAMES[sourceId] ? sourceName(sourceId) : "자료명 미기록");
}

function isCalculationTile(tile: SourceDetailTile, calculation: string | null): boolean {
  return tile.tileType === "simulation" || calculation !== null;
}

/** 타일의 provenance에 실제 들어 있는 원천만 상세 행으로 변환한다. */
export function sourceDetailsFor(tile: SourceDetailTile, meta: ReadonlyMap<string, SourceMeta>): SourceDetails {
  const entry = catalogEntry(tile.code);
  const calcMethod = nonEmpty(entry.calculation) ?? (entry.kind === "simulation" ? nonEmpty(entry.description) : null);
  const calculationTile = isCalculationTile(tile, calcMethod);
  let primaryAssigned = false;

  const rows = tile.provenance.sources.map((source): SourceDetailRow => {
    const definition = SOURCE_DETAIL_DEFINITIONS[source.sourceId];
    const role: SourceDetailRole = calculationTile
      ? "입력"
      : definition?.role === "보강"
        ? "보강"
        : !primaryAssigned
          ? (primaryAssigned = true, "주 원천")
          : "보강";
    const sourceMeta = metaFor(meta, source);
    return {
      sourceId: source.sourceId,
      provider: nonEmpty(sourceMeta?.provider) ?? "제공처 미기록",
      name: nameOf(source.sourceId, sourceMeta),
      role,
      asOf: nonEmpty(source.sourceAsOf) ?? UNKNOWN_AS_OF,
      license: licenseOf(sourceMeta),
      url: nonEmpty(sourceMeta?.sourceUrl) ?? nonEmpty(sourceMeta?.url) ?? "",
      usedFor: definition?.usedFor ?? null,
    };
  });

  // 레이어별 sourceId가 달라도 화면에 보이는 원천(제공처·자료·기준일)이 같으면 한 행으로 합친다.
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    const key = `${row.provider}|${row.name}|${row.asOf}`;
    return !seen.has(key) && seen.add(key);
  });
  return { calcMethod, rows: unique };
}

/** 디자인 문서 §9-2의 한 줄 인용 형식. 분석일·게시일·fetchedAt은 포함하지 않는다. */
export function citationOf(row: Pick<SourceDetailRow, "provider" | "name" | "asOf" | "license" | "url">): string {
  const asOf = row.asOf === UNKNOWN_AS_OF ? UNKNOWN_AS_OF : `${row.asOf} 기준`;
  return `${row.provider}, 「${row.name}」(${asOf}), ${row.license || "미기록"}, ${row.url || "원문 URL 미기록"}`;
}

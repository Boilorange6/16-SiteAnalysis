import { SOURCE_NAMES, catalogEntry, sourceName } from "./tile-catalog";

export const UNKNOWN_AS_OF = "기준일 미확인";

export type SourceDetailRole = "주 원천" | "보강" | "입력";
export type SourceCollect = "수동 파일" | "수동 API 배치" | "기존 앱 적재본" | "수동 정리" | "실시간" | "사용자 업로드" | "앱 계산";

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
  notices?: readonly string[];
};

export type SourceDetails = {
  calcMethod: string | null;
  rows: SourceDetailRow[];
};

export type SourceDefinition = {
  role?: "보강";
  /** provider·sourceUrl·license는 게시 manifest 값보다 먼저 쓴다(`termsFor`). 이미 적재된 값이 틀렸거나 내부 말일 때의 표시 정정과 런타임 원천용이다. */
  provider?: string;
  name?: string;
  sourceUrl?: string;
  license?: string;
  /** 이 원천이 출처 장 표에 있으면 표 아래에 그대로 싣는 이용조건 고지문(라이선스가 고정 문구를 요구할 때). */
  notices?: readonly string[];
  asOf?: string;
  usedFor: string | null;
  collect: SourceCollect;
  cycle: string;
  group?: string;
};

const KOGL4_LABEL = "공공누리 제4유형(출처표시·상업적 이용금지·변경금지)";
const ODBL_LABEL = "ODbL 1.0(출처표시·동일조건)";

/** Copernicus WorldDEM-30 라이선스 제6조 고정 고지문: 가공물 문구와 무책임 문구(번역). 후원·승인으로 읽히는 표현은 쓰지 않는다. */
const COPERNICUS_NOTICES = [
  "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
  "Copernicus 프로그램을 법 또는 위임으로 관장하는 기관은 Copernicus WorldDEM-30의 어떠한 사용에 대해서도 책임을 지지 않습니다.",
] as const;

/**
 * 원천의 역할과 사용처는 화면이나 엔진 곳곳에 흩뜨리지 않고 이 표에서만 정의한다.
 * 표에 없는 원천은 provenance 순서의 첫 원천을 주 원천으로, 나머지를 보강으로 본다.
 */
export const SOURCE_DETAIL_DEFINITIONS: Readonly<Record<string, SourceDefinition>> = {
  legal_areas: { usedFor: null, collect: "수동 파일", cycle: "수시" },
  parcel: { usedFor: null, collect: "수동 파일", cycle: "월간", group: "연속지적도형정보" },
  parcel_polygon: { usedFor: "대지·연속지적 도형과 지목", collect: "수동 파일", cycle: "월간", group: "연속지적도형정보" },
  ledger_recap: { usedFor: "공동주택·오피스텔 단지·세대·준공 정보", collect: "수동 파일", cycle: "월간", group: "건축물대장 3종" },
  ledger_title: { role: "보강", usedFor: "총괄표제부에 없는 건물의 준공·층수·용도 보강", collect: "수동 파일", cycle: "월간", group: "건축물대장 3종" },
  ledger_exclusive_area: { role: "보강", usedFor: "호당 전유면적 합산과 전용면적 타입별 세대수", collect: "수동 파일", cycle: "월간", group: "건축물대장 3종" },
  kapt: { role: "보강", usedFor: "대장에 없는 단지 식별과 세대수 보강", collect: "수동 파일", cycle: "수시" },
  school: { usedFor: null, collect: "수동 파일", cycle: "반기", group: "학교·학구도 4종" },
  school_zone_link: { usedFor: null, collect: "수동 파일", cycle: "반기", group: "학교·학구도 4종" },
  school_zone_elem: { usedFor: null, collect: "수동 파일", cycle: "반기", group: "학교·학구도 4종" },
  school_zone: { provider: "한국교육시설안전원 학구도안내서비스", usedFor: null, collect: "수동 파일", cycle: "반기", group: "학교·학구도 4종" },
  osm_subway: { provider: "OpenStreetMap contributors(Overpass API)", sourceUrl: "https://www.openstreetmap.org/copyright", usedFor: "OSM 철도역·노선", collect: "수동 API 배치", cycle: "수시" },
  planned_rail: { provider: "서울특별시(공식 상태)·OpenStreetMap contributors(선형)", license: `${KOGL4_LABEL} · ODbL 1.0(선형)`, usedFor: null, collect: "수동 정리", cycle: "수시" },
  store: { usedFor: null, collect: "수동 파일", cycle: "분기" },
  bus_stop: { usedFor: null, collect: "수동 파일", cycle: "연간" },
  park: { usedFor: null, collect: "수동 파일", cycle: "연간" },
  sgis_grid: { usedFor: null, collect: "수동 파일", cycle: "연간" },
  osm_roads: { usedFor: "OSM 도로·보행망", collect: "수동 파일", cycle: "일별", group: "OSM(Geofabrik)" },
  osm_landuse: { usedFor: "OSM 토지이용·녹지 면", collect: "수동 파일", cycle: "일별", group: "OSM(Geofabrik)" },
  osm_water: { usedFor: "OSM 수계 면", collect: "수동 파일", cycle: "일별", group: "OSM(Geofabrik)" },
  zoning_urban: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "용도지역 5종" },
  zoning_management: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "용도지역 5종" },
  zoning_agri_forest: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "용도지역 5종" },
  zoning_nature: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "용도지역 5종" },
  zoning_other: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "용도지역 5종" },
  land_price: { usedFor: "개별공시지가", collect: "수동 파일", cycle: "연 1회" },
  mzone_zone: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "정비구역 5종" },
  mzone_redevelopment: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "정비구역 5종" },
  mzone_promotion: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "정비구역 5종" },
  mzone_planned: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "정비구역 5종" },
  mzone_improvement: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "정비구역 5종" },
  district_area: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "구역·지구 5종" },
  district_greenbelt: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "구역·지구 5종" },
  district_land_development: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "구역·지구 5종" },
  district_urban_development: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "구역·지구 5종" },
  district_industrial: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "구역·지구 5종" },
  facility_transport: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "도시계획시설 8종" },
  facility_space: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "도시계획시설 8종" },
  facility_distribution_supply: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "도시계획시설 8종" },
  facility_public_culture_sports: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "도시계획시설 8종" },
  facility_disaster_prevention: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "도시계획시설 8종" },
  facility_health_hygiene: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "도시계획시설 8종" },
  facility_environmental_basic: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "도시계획시설 8종" },
  facility_other_infrastructure: { usedFor: null, collect: "수동 파일", cycle: "일별", group: "도시계획시설 8종" },
  applyhome: { provider: "한국부동산원", usedFor: null, collect: "기존 앱 적재본", cycle: "일", group: "청약·입주예정" },
  applyhome_types: { role: "보강", usedFor: "청약홈 주택관리번호별 주택형과 일반·특별공급 세대수", collect: "수동 파일", cycle: "수시", group: "청약·입주예정" },
  move_in: { usedFor: null, collect: "수동 파일", cycle: "반기", group: "청약·입주예정" },
  maintenance_integrated: { usedFor: null, collect: "수동 파일", cycle: "연 1회", group: "정비사업 명부" },
  maintenance_std: { usedFor: null, collect: "수동 파일", cycle: "수시", group: "정비사업 명부" },
  seoul_plan_zone: { role: "보강", usedFor: "서울 정비·소규모정비 사업의 이름·종류·단계·단계일·개요", collect: "수동 API 배치", cycle: "반기(경계)·분기(현황)" },
  rtms_apt_trade: { usedFor: null, collect: "수동 API 배치", cycle: "수시 신고", group: "RTMS 아파트" },
  rtms_apt_rent: { sourceUrl: "https://www.data.go.kr/data/15126474/openapi.do", usedFor: null, collect: "수동 API 배치", cycle: "수시 신고", group: "RTMS 아파트" },
  rtms_offi_trade: { sourceUrl: "https://www.data.go.kr/data/15126464/openapi.do", usedFor: null, collect: "수동 API 배치", cycle: "수시 신고", group: "RTMS 오피스텔" },
  rtms_offi_rent: { usedFor: null, collect: "수동 API 배치", cycle: "수시 신고", group: "RTMS 오피스텔" },
  building: { usedFor: "건물 도형·사용승인일·높이", collect: "수동 파일", cycle: "수시" },
  building_juso: { role: "보강", usedFor: "GIS에 없는 건물과 층수·건물명 보강", collect: "수동 파일", cycle: "월간" },
  gis_bldg: { usedFor: "GIS건물통합정보 건물 도형·속성", collect: "수동 파일", cycle: "수시" },
  terrain_tiles: {
    provider: "Copernicus 프로그램(유럽연합·ESA)",
    sourceUrl: "https://registry.opendata.aws/copernicus-dem/",
    license: "Copernicus WorldDEM-30 라이선스(출처·가공 고지 필수)",
    notices: COPERNICUS_NOTICES,
    usedFor: "DEM 표면고·지형·경사·하늘열림 보강",
    collect: "수동 파일",
    cycle: "갱신 없음",
  },
  ngii_air: {
    provider: "국토지리정보원 국토정보플랫폼 오픈API(영상지도)",
    name: "국토지리정보원 국토정보플랫폼 오픈API 영상지도",
    sourceUrl: "https://map.ngii.go.kr/mi/openKey/openKeyInfo.do",
    license: "공공누리 제1유형(출처표시) · 국토정보플랫폼 오픈API 결과물",
    notices: ["국토포털(국토정보플랫폼) 오픈API의 결과물"],
    usedFor: "D10 수관 검출·S04 수목 그늘",
    collect: "실시간",
    cycle: "연 1회 촬영",
  },
  ngii_topo: {
    provider: "국토지리정보원",
    name: "연속수치지형도",
    sourceUrl: "https://map.ngii.go.kr",
    license: "이용조건 확인 필요",
    asOf: UNKNOWN_AS_OF,
    usedFor: "분석별 선택 추가 자료(지형·단차·도로·건물·수계)",
    collect: "사용자 업로드",
    cycle: "분석별",
  },
  asos: { provider: "기상청", usedFor: "최근접 ASOS 관측소의 풍향·기상", collect: "수동 API 배치", cycle: "시간(10년 집계)" },
  // 런타임 타일 원천이라 manifest release가 없다. 약관 제13조 9항: 지도 화면에는 오픈플랫폼을 이용해 만든 것임을 표기한다(`BASEMAP_ATTRIBUTION`).
  vworld_wmts: {
    provider: "국토교통부(VWorld 오픈플랫폼)",
    sourceUrl: "https://www.vworld.kr/dev/v4dv_wmtsguide_s001.do",
    license: "VWorld 이용약관(오픈플랫폼 이용 표기)",
    usedFor: null,
    collect: "실시간",
    cycle: "—",
  },
  browser_lbm: { role: "보강", usedFor: "브라우저 바람 흐름 계산", collect: "앱 계산", cycle: "—" },
  fallback_d2q9: { role: "보강", usedFor: "바람 흐름 내장 보정 계산", collect: "앱 계산", cycle: "—" },
};

export function sourceOps(sourceId: string): { collect: SourceCollect | null; cycle: string | null; group: string | null } {
  const definition = SOURCE_DETAIL_DEFINITIONS[sourceId];
  return {
    collect: definition?.collect ?? null,
    cycle: definition?.cycle ?? null,
    group: definition?.group ?? null,
  };
}

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function metaFor(meta: ReadonlyMap<string, SourceMeta>, source: SourceRefLike): SourceMeta | undefined {
  return meta.get(`${source.sourceId}:${source.releaseId}`) ?? meta.get(source.sourceId);
}

const LICENSE_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^UNRESTRICTED$/i, "이용허락범위 제한 없음"],
  [/^attribution$/i, "출처 표시"],
  [/^KOGL[-_]?1$/i, "공공누리 제1유형(출처표시)"],
  [/^KOGL[-_]?4$/i, KOGL4_LABEL],
  [/^CC[- ]BY$/i, "CC BY 2.0 KR(저작자표시)"],
  [/^ODbL(?:[- ]?1\.0)?$/i, ODBL_LABEL],
];

/** 적재된 라이선스 코드(`KOGL-1`·`ODbL-1.0` 등)를 사람이 읽는 말로 푼다. `A+B`는 둘을 ` · `로 잇고, 모르는 값은 그대로 둔다. */
export function licenseLabel(raw: string): string {
  return raw.split("+").map((part) => {
    const code = part.trim();
    return LICENSE_LABELS.find(([pattern]) => pattern.test(code))?.[1] ?? code;
  }).join(" · ");
}

/** 제공처·이용조건·원문 링크: 정의에 적힌 값(표시 정정)이 manifest 값보다 먼저다. guide 표와 출처 장이 같은 규칙을 쓴다. */
export function termsFor(sourceId: string, raw: { provider?: string | null; license?: string | null; sourceUrl?: string | null }): { provider: string | null; license: string | null; sourceUrl: string | null } {
  const definition = SOURCE_DETAIL_DEFINITIONS[sourceId];
  const license = definition?.license ?? nonEmpty(raw.license);
  return {
    provider: definition?.provider ?? nonEmpty(raw.provider),
    license: license && !/^(?:UNKNOWN|UNRECORDED|미기록)$/i.test(license) ? licenseLabel(license) : null,
    sourceUrl: definition?.sourceUrl ?? nonEmpty(raw.sourceUrl),
  };
}

function nameOf(sourceId: string, meta: SourceMeta | undefined, definition: SourceDefinition | undefined): string {
  return nonEmpty(meta?.name) ?? definition?.name ?? (SOURCE_NAMES[sourceId] ? sourceName(sourceId) : "자료명 미기록");
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
    const terms = termsFor(source.sourceId, {
      provider: sourceMeta?.provider,
      license: nonEmpty(sourceMeta?.licenseCode) ?? sourceMeta?.license,
      sourceUrl: nonEmpty(sourceMeta?.sourceUrl) ?? sourceMeta?.url,
    });
    return {
      sourceId: source.sourceId,
      provider: terms.provider ?? "제공처 미기록",
      name: nameOf(source.sourceId, sourceMeta, definition),
      role,
      asOf: definition?.asOf ?? nonEmpty(source.sourceAsOf) ?? UNKNOWN_AS_OF,
      license: terms.license ?? "미기록",
      url: terms.sourceUrl ?? "",
      usedFor: definition?.usedFor ?? null,
      ...(definition?.notices ? { notices: definition.notices } : {}),
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

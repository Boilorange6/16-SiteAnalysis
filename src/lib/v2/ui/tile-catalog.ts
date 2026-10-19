/** 타일 코드 → 화면용 제목·종류·설명·원천·색 (카탈로그 2026-09-29). */
export type TileKind = "analysis" | "diagram" | "simulation";
export type TileCatalogEntry = {
  title: string;
  kind: TileKind;
  description: string;
  /** 출처 상세의 "계산 방법" 한 줄. 없으면 계산 방법을 표시하지 않는다. */
  calculation?: string;
  sources: readonly string[];
  color: string;
  /** 지도 탐색용 줌 상한. maxAbsZoom은 Web Mercator 절대 줌이다. */
  mapZoom?: { maxDelta?: number; maxAbsZoom?: number; card?: boolean };
};

const BUILDING_SOURCES = ["building", "building_juso", "gis_bldg", "ngii_topo"] as const;
const ZONING_SOURCES = ["zoning_urban", "zoning_management", "zoning_agri_forest", "zoning_nature", "zoning_other"] as const;
const DISTRICT_SOURCES = ["district_area", "district_greenbelt", "district_land_development", "district_urban_development", "district_industrial"] as const;
const FACILITY_SOURCES = [
  "facility_transport",
  "facility_space",
  "facility_distribution_supply",
  "facility_public_culture_sports",
  "facility_disaster_prevention",
  "facility_health_hygiene",
  "facility_environmental_basic",
  "facility_other_infrastructure",
] as const;
const MAINTENANCE_SOURCES = ["maintenance_zone", "maintenance_integrated", "maintenance_std"] as const;

export const TILE_CATALOG = {
  A01: { title: "입지·대중교통", kind: "analysis", description: "지하철·버스·출입구·노선과 대지의 접근 거리를 같은 집계 기준으로 확인합니다.", calculation: "반경 내 운영역·출입구·철도 노선·버스정류장 원천 feature를 세고, 최근접 거리는 대표점·출입구 직선 기준으로 분리", sources: ["osm_subway", "bus_stop", "osm_roads"], color: "#6A50D3", mapZoom: { maxDelta: 3 } },
  A02: { title: "학교·통학구역", kind: "analysis", description: "학교 위치와 학구도·학교군, 학구 연계를 한 카드의 지도 레이어로 봅니다.", sources: ["school", "school_zone", "school_zone_link"], color: "#E5A11C", mapZoom: { maxDelta: 3 } },
  A03: { title: "생활편의·상가", kind: "analysis", description: "생활편의 업종을 유형별로 세어 일상 접근성을 봅니다.", sources: ["store"], color: "#3F9E6B", mapZoom: { maxDelta: 3 } },
  A04: { title: "공원·녹지", kind: "analysis", description: "공원 대표점·원천 면적·녹지·수면 도형과 보행 접근을 레이어별로 참고합니다.", sources: ["park", ...ZONING_SOURCES, "parcel_polygon", "osm_roads"], color: "#5C9A3C", mapZoom: { maxDelta: 3 } },
  A05: { title: "기존 주거 공급", kind: "analysis", description: "기존 공동주택의 단지·세대·준공·전용면적 타입 흐름을 원천별로 봅니다.", sources: ["ledger_recap", "ledger_title", "ledger_exclusive_area", "kapt"], color: "#8C6D5A", mapZoom: { maxDelta: 2 } },
  A06: { title: "분양·입주예정 공급", kind: "analysis", description: "분양·입주예정 물량과 전용면적 타입을 원천별로 나눠 중복 가능성을 남깁니다.", sources: ["applyhome", "applyhome_types", "move_in"], color: "#7A7E87", mapZoom: { maxDelta: 2 } },
  A07: { title: "매매 실거래", kind: "analysis", description: "아파트 매매 실거래의 위치·가격·기간과 위치 확인율을 함께 확인하며, 가격 구간 레이어로 위치를 읽습니다.", sources: ["rtms_apt_trade"], color: "#2F6FDB", mapZoom: { maxDelta: 2 } },
  A08: { title: "임대차 실거래", kind: "analysis", description: "아파트 전월세 실거래의 보증금·임대료 흐름을 확인합니다.", sources: ["rtms_apt_rent", "rtms_apt_trade"], color: "#2B6CB0", mapZoom: { maxDelta: 2 } },
  A09: { title: "정비사업", kind: "analysis", description: "정비구역·사업단계·시군구 명부를 지도·상세 레이어로 확인합니다.", sources: MAINTENANCE_SOURCES, color: "#D6478A", mapZoom: { maxDelta: 2 } },
  A10: { title: "계획 철도", kind: "analysis", description: "계획 철도의 노선·역·단계와 개략 여부를 레이어별로 표시합니다.", sources: ["planned_rail"], color: "#8A5BC7", mapZoom: { maxDelta: 2 } },
  A11: { title: "인구·가구", kind: "analysis", description: "SGIS 1 km 격자 인구·가구와 밀도 구간을 레이어별로 읽습니다.", sources: ["sgis_grid"], color: "#2B7A78", mapZoom: { maxDelta: 1 } },
  A12: { title: "토지·용도지역", kind: "analysis", description: "용도지역 고정 분류·원천 세분·개별공시지가를 함께 보며, 고정 분류 번호가 자료 유무에 따라 밀리지 않습니다.", calculation: "고정된 용도지역 분류 순서로 원천 도형의 교차면적을 집계하고 지목·공시지가를 별도 레이어로 표시", sources: [...ZONING_SOURCES, "land_price"], color: "#C9A227", mapZoom: { maxDelta: 2 } },
  D01: { title: "항공사진", kind: "diagram", description: "항공영상 배경에서 대지와 주변 형태를 확인합니다.", sources: ["vworld_wmts"], color: "#5A6B7B", mapZoom: { maxDelta: 3, maxAbsZoom: 19 } },
  D02: { title: "건물", kind: "diagram", description: "건물 발자국을 평면으로 봅니다.", sources: BUILDING_SOURCES, color: "#A0522D", mapZoom: { maxDelta: 3, maxAbsZoom: 19 } },
  D03: { title: "건축물 용도", kind: "diagram", description: "건축물 용도를 건물 단위 구성으로 봅니다.", sources: BUILDING_SOURCES, color: "#B05A3C", mapZoom: { maxDelta: 3, maxAbsZoom: 19 } },
  D04: { title: "준공 연대", kind: "diagram", description: "사용승인 연대별 건물 분포를 봅니다.", sources: BUILDING_SOURCES, color: "#A0522D", mapZoom: { maxDelta: 3, maxAbsZoom: 19 } },
  D05: { title: "건축물 높이", kind: "diagram", description: "층수 기본 보기에서 35 m·12 m 기준과 확인·추정·미상을 레이어로 전환합니다.", calculation: "층수 분포를 기본으로 35 m 이상·12 m 이하 높이 모드를 별도 레이어로 계산하며 층수×3 m 추정은 [추정]으로 분리", sources: BUILDING_SOURCES, color: "#A5673F", mapZoom: { maxDelta: 3, maxAbsZoom: 19 } },
  D10: { title: "수관·녹지", kind: "diagram", description: "항공사진 기반 수관과 OSM 녹지·수계를 함께 봅니다.", sources: ["vworld_wmts", "osm_landuse", "osm_water", "parcel_polygon", "ngii_topo"], color: "#3F7D4E", mapZoom: { maxDelta: 3, maxAbsZoom: 19 } },
  D11: { title: "구역·지구", kind: "diagram", description: "용도지구·구역 경계를 계층별로 확인합니다.", sources: DISTRICT_SOURCES, color: "#537A8F", mapZoom: { maxDelta: 2 } },
  D12: { title: "도시계획시설", kind: "diagram", description: "도시계획시설의 선·면·점을 유형별로 확인합니다.", sources: FACILITY_SOURCES, color: "#4E7599", mapZoom: { maxDelta: 2 } },
  D13: { title: "도로", kind: "diagram", description: "OSM 도로 중심선 길이와 위계를 확인합니다.", sources: ["osm_roads", "ngii_topo"], color: "#657B8D", mapZoom: { maxDelta: 2 } },
  D15: { title: "가구", kind: "diagram", description: "OSM 자동차 도로로 묶은 가구 형태를 참고합니다.", sources: ["osm_roads", "ngii_topo"], color: "#8A6A4A", mapZoom: { maxDelta: Math.log2(3) } },
  D16: { title: "건물 밀도", kind: "diagram", description: "건물 동수 기반 밀도 추정 분포를 봅니다.", sources: BUILDING_SOURCES, color: "#4F8A68", mapZoom: { maxDelta: 3, maxAbsZoom: 17 } },
  D17: { title: "지형·등고선", kind: "diagram", description: "DEM 표면고와 중심 상대 고도·등고선을 봅니다.", sources: ["terrain_tiles", "ngii_topo"], color: "#6B778D", mapZoom: { maxDelta: 3, maxAbsZoom: 17 } },
  D18: { title: "경사도", kind: "diagram", description: "DEM 30 m 격자 기반 경사도를 봅니다.", calculation: "DEM GLO-30 30 m 격자의 중앙 미분과 3×3 Horn 방식으로 경사도(°)를 계산", sources: ["terrain_tiles", "ngii_topo"], color: "#7C6CAB", mapZoom: { maxDelta: 3, maxAbsZoom: 17 } },
  D19: { title: "지적", kind: "diagram", description: "연속지적 도형을 지목·필지 규모 색 모드와 함께 참조용으로 봅니다.", sources: ["parcel_polygon"], color: "#8A6A4A", mapZoom: { maxDelta: Math.log2(6), maxAbsZoom: 18 } },
  D22: { title: "바람장미", kind: "diagram", description: "최근접 ASOS 관측소의 연간·계절 풍향을 봅니다.", sources: ["asos"], color: "#2B9CBF", mapZoom: { maxDelta: 0, card: false } },
  D28: { title: "도보권", kind: "diagram", description: "OSM 보행망과 80 m/분 기준의 도달 면적을 봅니다.", calculation: "OSM 보행망 최단거리를 80 m/분으로 환산해 5·10·15분 도달 면을 계산(5 m 격자 marching squares·smoothing)", sources: ["osm_roads"], color: "#7A5BA6", mapZoom: { maxDelta: 2 } },
  D29: { title: "개방감(하늘열림)", kind: "diagram", description: "건물·지형 기준 하늘열림(SVF)을 봅니다.", calculation: "건물·DEM으로 2 m 지면 DSM을 만들고 32방위·최대 300 m 시선으로 하늘열림(SVF)을 계산", sources: [...BUILDING_SOURCES, "terrain_tiles"], color: "#4C8FB8", mapZoom: { maxDelta: 3, maxAbsZoom: 19 } },
  S01: { title: "3D 매스", kind: "simulation", description: "공개 도형과 확보·추정 높이로 주변 매스를 확인합니다.", calculation: "건물 도형에 원천 높이와 층수 추정 높이를 적용해 주변 매스를 구성", sources: BUILDING_SOURCES, color: "#3E6FB0", mapZoom: { maxDelta: 0, card: false } },
  S02: { title: "일조·그림자", kind: "simulation", description: "동지 법정 기준을 기본으로 대표 날짜의 건물·지형 그림자를 계절 레이어별로 비교하며, 헤드라인과 요약 문장도 동지 기준으로 맞춥니다.", calculation: "춘·하·추·동지와 분석일에 건물·지형 그림자를 10분 간격으로 계산(반경 밖 400 m 장애물 포함; 동지 기본)", sources: [...BUILDING_SOURCES, "parcel_polygon"], color: "#F08A24", mapZoom: {} },
  S03: { title: "바람 흐름 탐색", kind: "simulation", description: "입력 풍향을 기준으로 바람 흐름을 설계 초기에 탐색합니다.", calculation: "ASOS 대표 풍향과 건물·지형 장애물을 4 m 격자로 구성해 보행층(6 m) 상대풍속을 LBM으로 계산", sources: ["asos", "browser_lbm", "fallback_d2q9", "ngii_topo"], color: "#2B9CBF", mapZoom: {} },
  S04: { title: "열쾌적(UTCI)", kind: "simulation", description: "대표 기상과 매스 조건에서 장소 간 열쾌적을 비교합니다.", calculation: "계절별 10·14·18시 대표 기상과 보행층 상대풍속을 2 m 격자에 결합해 일사·그늘·수관·UTCI를 계산", sources: ["asos", ...BUILDING_SOURCES], color: "#D9534F", mapZoom: { maxDelta: 3, maxAbsZoom: 19 } },
} as const satisfies Record<string, TileCatalogEntry>;

export type TileCode = keyof typeof TILE_CATALOG;
export const TILE_CODES = Object.keys(TILE_CATALOG) as TileCode[];

export const TILE_PRESETS = {
  all: {
    label: "전체",
    description: "계산된 전체 타일을 기존 순서로 보드에 담습니다.",
    codes: TILE_CODES,
  },
  "urban-redevelopment": {
    label: "도심재개발",
    description: "용도지역·정비·공급과 주변 도시 형태를 먼저 봅니다.",
    codes: [
      "A12", "A09", "A01", "A10", "A05", "A06", "A07", "A04",
      "D01", "D02", "D03", "D04", "D05", "D11", "D12", "D13", "D16", "D19", "D28", "S01", "S02",
    ],
  },
  "station-area": {
    label: "역세권",
    description: "역 접근·보행·생활편의와 계획철도 주변의 형태를 먼저 봅니다.",
    codes: [
      "A01", "D28", "A03", "A04", "A10", "A11", "A12",
      "D01", "D02", "D03", "D10", "D12", "D13", "D16", "D29", "S01", "S03", "S04",
    ],
  },
  residential: {
    label: "주거",
    description: "학교·생활편의와 주거 재고·공급·거래, 주거환경을 먼저 봅니다.",
    codes: [
      "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A11", "A12",
      "D01", "D02", "D03", "D04", "D05", "D16", "D17", "D28", "D29", "S01", "S02", "S04",
    ],
  },
} as const satisfies Record<string, { label: string; description: string; codes: readonly TileCode[] }>;

export type PresetId = keyof typeof TILE_PRESETS;
export const DEFAULT_PRESET_ID: PresetId = "all";
export const PRESET_IDS = Object.keys(TILE_PRESETS) as PresetId[];
export const isPresetId = (value: unknown): value is PresetId => typeof value === "string" && Object.prototype.hasOwnProperty.call(TILE_PRESETS, value);

/** 원천 id → 화면용 이름. 목록에 없는 id는 그대로 보인다. */
export const SOURCE_NAMES: Record<string, string> = {
  store: "소상공인 상가정보",
  bus_stop: "전국 버스정류장",
  park: "전국 도시공원",
  osm_subway: "OSM 철도(역·출입구·노선)",
  rail_station: "OSM 철도",
  planned_rail: "계획 철도 공개 목록",
  sgis_grid: "SGIS 인구·가구 1km 격자",
  school: "학교 위치",
  school_zone_link: "학구 연계표",
  school_zone: "VWorld 학교 학구도·학교군",
  ledger_recap: "건축물대장 총괄표제부",
  ledger_title: "건축물대장 표제부",
  ledger_exclusive_area: "건축물대장 전유공용면적(전유부)",
  building: "GIS건물통합정보",
  building_juso: "행정안전부 도로명주소 건물(CC BY-NC-ND)",
  gis_bldg: "GIS건물통합정보",
  applyhome: "청약홈",
  applyhome_types: "청약홈 APT 분양정보 주택형별 API",
  move_in: "입주예정",
  parcel: "연속지적도",
  parcel_polygon: "연속지적도(도형)",
  land_price: "개별공시지가",
  legal_areas: "법정구역",
  rtms_apt_trade: "국토부 아파트 매매 실거래",
  rtms_apt_rent: "국토부 아파트 전월세 실거래",
  maintenance_integrated: "정비사업 현황(통합)",
  maintenance_std: "정비사업 현황(표준데이터)",
  maintenance_zone: "정비구역 경계",
  osm_roads: "OSM 도로(Geofabrik)",
  osm_landuse: "OSM 토지이용·자연 면(Geofabrik)",
  osm_water: "OSM 수계 면(Geofabrik)",
  vworld_wmts: "VWorld 항공영상(WMTS)",
  browser_lbm: "브라우저 계산(WebGPU LBM)",
  terrain_tiles: "Copernicus DEM GLO-30 지표고",
  ngii_topo: "국토지리정보원 연속수치지형도",
  asos: "기상청 ASOS 시간자료",
  zoning_urban: "용도지역(도시지역)",
  zoning_management: "용도지역(관리지역)",
  zoning_agri_forest: "용도지역(농림지역)",
  zoning_nature: "용도지역(자연환경보전지역)",
  zoning_other: "용도지역(기타)",
  legal_sigungu: "법정구역",
  legal_emd: "법정구역",
  legal_ri: "법정구역",
  district_area: "국토교통부 VWorld 용도지구·구역",
  district_greenbelt: "국토교통부 VWorld 용도지구·구역",
  district_land_development: "국토교통부 VWorld 용도지구·구역",
  district_urban_development: "국토교통부 VWorld 용도지구·구역",
  district_industrial: "국토교통부 VWorld 용도지구·구역",
  facility_transport: "국토교통부 VWorld 도시계획시설",
  facility_space: "국토교통부 VWorld 도시계획시설",
  facility_distribution_supply: "국토교통부 VWorld 도시계획시설",
  facility_public_culture_sports: "국토교통부 VWorld 도시계획시설",
  facility_disaster_prevention: "국토교통부 VWorld 도시계획시설",
  facility_health_hygiene: "국토교통부 VWorld 도시계획시설",
  facility_environmental_basic: "국토교통부 VWorld 도시계획시설",
  facility_other_infrastructure: "국토교통부 VWorld 도시계획시설",
  kapt: "K-APT 공동주택 관리정보",
  molit_rtms: "국토부 아파트 실거래",
  redevelopment: "정비사업 현황",
  landuse: "OSM 토지이용·자연 면(Geofabrik)",
  rail: "OSM 철도(역·출입구·노선)",
  bus_stops: "전국 버스정류장",
  reference: "참조 데이터",
  legal: "법정구역",
  gis_building: "GIS건물통합정보",
  osm_buildings: "OSM 건물(Geofabrik)",
  school_zone_elem: "VWorld 학교 학구도·학교군",
  fallback_d2q9: "내장 보정 모델(D2Q9 LBM)",
  mzone_zone: "정비구역 경계",
  mzone_improvement: "정비사업 현황",
  mzone_planned: "정비사업 현황",
  mzone_promotion: "정비사업 현황",
  mzone_redevelopment: "정비사업 현황",
};
/** 내부 원천 파일명·코드는 사용자용 출처 문자열에 노출하지 않는다. */
export function cleanSourceText(value: string): string {
  return value
    .replace(/\bTL_[A-Z0-9_]+\b/gi, "")
    .replace(/\b[A-Z][A-Z0-9_]*\.(?:shp|dbf|shx|prj|zip|csv)\b/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([)·])/g, "$1")
    .trim();
}

export const sourceName = (id: string) => cleanSourceText(SOURCE_NAMES[id] ?? id);

export function catalogEntry(code: string): TileCatalogEntry {
  return (TILE_CATALOG as Record<string, TileCatalogEntry>)[code] ?? {
    title: code,
    kind: "analysis",
    description: "카탈로그에 설명이 등록되지 않았습니다.",
    sources: [],
    color: "#7A7E87",
  };
}

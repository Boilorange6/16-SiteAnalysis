/**
 * 예시 결과 (P1b 분석 엔진이 붙기 전 화면 검증용). 값은 실제 조회 결과가 아니다.
 * 화면은 TileResult 계약만 읽으므로, 실제 결과로 바꿔도 화면 코드는 바뀌지 않는다.
 */
import { parseTileResult, type TileResult } from "../../tile-result";

const HASH = "b".repeat(64);
type Status = TileResult["metrics"][number]["status"];
type Src = [sourceId: string, sourceAsOf: string | null];

const m = (id: string, label: string, value: number | null, unit: string, status: Status = "observed") => ({
  id,
  label,
  value,
  unit,
  formulaVersion: `${id}@1`,
  numerator: null,
  denominator: null,
  status,
});

function tile(
  code: string,
  type: TileResult["tileType"],
  status: TileResult["status"],
  metrics: TileResult["metrics"],
  sources: Src[],
  judgment: TileResult["judgment"],
  limitations: TileResult["limitations"] = [],
  outputFace: TileResult["presentation"]["outputFace"] = "front",
): TileResult {
  return parseTileResult({
    tileId: `t-${code}`,
    analysisId: "demo-godeok",
    tileType: type,
    tileCode: code,
    status,
    engineVersion: "v2-demo",
    conditions: {
      address: "서울특별시 강동구 고덕동 123 외 2필지",
      center: [127.1546, 37.5556],
      radiusM: 1000,
      analysisDate: "2026-09-30",
      timezone: "Asia/Seoul",
      filters: {},
      simulation: null,
      parcelSnapshotHash: null,
    },
    metrics,
    judgment,
    presentation: { legend: [], camera: null, layers: [], outputFace },
    provenance: {
      manifestHash: HASH,
      sources: sources.map(([sourceId, sourceAsOf]) => ({ sourceId, releaseId: `${sourceId}-demo`, sourceAsOf, fetchedAt: "2026-09-30T09:00:00+09:00" })),
    },
    limitations,
  });
}

const j = (ruleId: string, basis: string[], sentence: string, level: "good" | "fair" | "caution" | null = null, criteria: string | null = null) => ({
  ruleId,
  basisMetricIds: basis,
  sentence,
  level,
  criteria,
});

export const GODEOK_SUMMARY = {
  address: "서울특별시 강동구 고덕동 123 외 2필지",
  areaM2: 3480,
  zoning: "제2종일반주거지역",
  radiusM: 1000,
  facts: [
    "대지 면적 3,480㎡, 2필지 합산",
    "용적률 상한 250%, 인접 구역에 3종일반·상업 일부",
    "반경 1km 안에 지하철역 3곳, 직선 최근접 480m",
  ],
};

export const GODEOK_RESULTS: TileResult[] = [
  tile(
    "A01",
    "analysis",
    "complete",
    [
      m("nearest_station_m", "최근접 역 출입구", 480, "m"),
      m("stations_in_radius", "반경 내 운영역", 3, "개"),
      m("nearest_bus_m", "최근접 버스정류장", 210, "m"),
      m("bus_stops", "버스 정류장", 41, "개"),
      m("bus_routes", "경유 버스 노선", null, "개", "missing"),
    ],
    [["rail", "2026-09-01"], ["bus_stops", "2026-08-15"]],
    j("A01-rail-distance@1", ["nearest_station_m"], "최근접 역 출입구까지 직선 480m → 철도 접근은 가까운 편 → 실제 보행 경로 확인 필요", "good", "철도 직선거리 500m 이하 좋음 · 1,000m 이하 보통 · 초과 주의"),
    [{ kind: "unknown", note: "정류장별 경유 노선 연결 자료를 확보하지 못했습니다." }],
  ),
  tile(
    "A02",
    "analysis",
    "complete",
    [
      m("in_school_zone", "초등 통학구역 포함", 1, ""),
      m("nearest_elem_m", "최근접 초등학교", 480, "m"),
      m("elem_count", "반경 내 초등학교", 2, "개교"),
      m("middle_count", "반경 내 중학교", 2, "개교"),
    ],
    [["school", "2026-04-01"], ["school_zone", "2026-03-01"]],
    j("A02-zone-distance@1", ["nearest_elem_m"], "대지가 통학구역 안에 있음 → 연결 초등학교까지 직선 480m → 실제 배정은 교육청 확인 필요", "good", "연결 초등학교 직선거리 500m 이하 좋음 · 1,000m 이하 보통 · 초과 주의"),
  ),
  tile(
    "A05",
    "analysis",
    "partial",
    [
      m("households", "확인 세대", 4120, "세대"),
      m("complexes", "아파트 단지", 14, "개"),
      m("median_year", "준공연도 중앙값", 1998, "년"),
      m("aged_share_pct", "30년 이상 건물 비중", 38, "%", "estimated"),
      m("parking_per_household", "세대당 주차대수", null, "대", "missing"),
    ],
    [["gis_bldg", "2026-08-01"], ["kapt", null]],
    j("A05-stock@1", ["households"], "아파트 14개 단지 4,120세대 확인 → 재고는 아파트 중심이며 오래된 건물이 상당수 → 세대수 미상 단지 확인 필요"),
    [
      { kind: "incomplete", note: "K-APT에 없는 단지 3곳은 세대수를 알 수 없어 합계에서 제외했습니다." },
      { kind: "estimated", note: "30년 이상 비중은 분석 기준일 대비 경과연수로 추정한 값입니다." },
    ],
  ),
  tile(
    "A06",
    "analysis",
    "complete",
    [
      m("presale_units", "분양공고 세대", 820, "세대"),
      m("move_in_units", "입주예정 세대", 1100, "세대"),
      m("redevelop_units", "정비사업 예정세대", 540, "세대"),
      m("units_total", "합계", null, "세대", "missing"),
    ],
    [["applyhome", "2026-09-15"], ["movein_plan", "2026-09-01"], ["redevelopment", "2026-08-20"]],
    j("A06-schedule@1", ["presale_units", "move_in_units"], "원천별 예정 물량이 각각 확인됨 → 같은 사업이 겹쳐 잡혔을 수 있어 합계는 내지 않음 → 사업별 연결 확인 필요"),
    [{ kind: "partial", note: "청약홈·입주예정·정비사업에 같은 사업이 중복 등장할 수 있어 합계를 보류했습니다. 중복 제거는 다음 단계입니다." }],
  ),
  tile(
    "A07",
    "analysis",
    "complete",
    [
      m("txn_count", "유효 거래건수(12개월)", 214, "건"),
      m("median_price_m2", "㎡당 가격 중앙값", 1320, "만원/㎡"),
      m("median_change_pct", "전기 대비 중앙값 변화", 3.4, "%"),
      m("small_area_median", "소형 면적대 중앙값", null, "만원/㎡", "suppressed"),
    ],
    [["molit_rtms", "2026-09-20"]],
    j("A07-median@1", ["median_price_m2"], "최근 12개월 관측 거래 214건 → 단가 중앙값이 전기보다 3.4% 상승 → 거래 구성 변화와 표본 확인 필요"),
    [{ kind: "suppressed", note: "표본이 5건 미만인 구간은 비공개로 처리했습니다." }],
  ),
  tile(
    "A09",
    "analysis",
    "complete",
    [
      m("projects", "반경 관련 사업", 4, "곳"),
      m("demolition_started", "철거 착수 사업", 0, "곳"),
      m("zone_designated", "구역지정 단계", 2, "곳"),
      m("planned_units", "관련 사업 예정세대", 1650, "세대"),
    ],
    [["redevelopment", "2026-08-20"]],
    j("A09-stage@1", ["projects"], "반경 안 관련 사업 4곳, 철거 착수는 0곳 → 대부분 초기 단계 → 경계 미확인 사업 추가 확인 필요"),
  ),
  tile(
    "A12",
    "analysis",
    "complete",
    [
      m("far_limit_pct", "용적률 상한", 250, "%"),
      m("official_land_price", "공시지가", 2410, "만원/㎡"),
      m("mixed_zone_share_pct", "반경 내 3종일반·상업 비중", 31, "%"),
    ],
    [["landuse", "2026-07-01"], ["land_price", "2026-01-01"]],
    j("A12-zoning@1", ["mixed_zone_share_pct"], "인접 구역에 3종일반·상업 → 용도가 섞인 지역 → 지구단위계획 확인 필요"),
  ),
  tile(
    "D04",
    "diagram",
    "complete",
    [
      m("confirmed_share_pct", "사용승인일 확인 건물", 98, "%"),
      m("share_pre1980", "1979년 이하", 12, "%"),
      m("share_1980s", "1980년대", 24, "%"),
      m("share_1990s", "1990년대", 31, "%"),
      m("share_2000s", "2000년대", 18, "%"),
      m("share_2010s", "2010년대", 9, "%"),
      m("share_2020s", "2020년 이상", 4, "%"),
      m("share_unknown", "미상", 2, "%"),
    ],
    [["gis_bldg", "2026-08-01"]],
    j("D04-decades@1", ["confirmed_share_pct"], "확인된 건물 중 1990년대 이전 준공이 67% → 노후 건물이 넓게 분포 → 재건축 요건은 별도 확인 필요"),
    [],
    "front",
  ),
  tile("S02", "simulation", "not_provided", [], [], null, [{ kind: "not_provided", note: "일조 계산은 3D 시뮬레이션 단계에서 제공합니다." }]),
  tile("S03", "simulation", "failed", [], [], null, [{ kind: "unknown", note: "계산 영역 생성에 실패했습니다." }]),
];

/** 실패 타일 "다시 계산" 데모에서 쓰는 성공 결과. */
export const RECOVERED: Record<string, TileResult> = {
  S03: tile(
    "S03",
    "simulation",
    "complete",
    [m("rel_wind_median", "상대풍속 중앙값", 0.92, "U/Uref"), m("rel_wind_high_share", "상대풍속 1.2 이상 면적", 14, "%")],
    [["osm_buildings", "2026-08-01"]],
    j("S03-relative@1", ["rel_wind_median"], "대지 주변 상대풍속 중앙값 0.92 → 유입 풍속보다 약간 낮은 흐름 → 탐색용 값이므로 실측 확인 필요"),
  ),
};

/**
 * 예시 결과 (화면 검증용). 주소·대지·A01~A04·A06 등은 가상이고, A05 단지 점은 고덕역 실제 대장 결과에서 뽑았다.
 * 화면은 TileResult 계약만 읽으므로, 실제 결과로 바꿔도 화면 코드는 바뀌지 않는다.
 */
// 타입만 가져온다: tile-result의 런타임(zod·node:crypto)을 브라우저 번들에 넣지 않기 위해서다.
// 계약 검증(parseTileResult)은 test-v2-ui-view.mjs가 한다.
import type { TileResult } from "../../tile-result";

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
  const result: TileResult = {
    tileId: `t-${code}`,
    analysisId: "demo-godeok",
    tileType: type,
    tileCode: code,
    status,
    engineVersion: "v2-demo",
    conditions: {
      address: "서울특별시 강동구 고덕동 123 외 2필지",
      center: [CENTER[0], CENTER[1]],
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
  };
  return result;
}

const j = (ruleId: string, basis: string[], sentence: string, level: "good" | "fair" | "caution" | null = null, criteria: string | null = null) => ({
  ruleId,
  basisMetricIds: basis,
  sentence,
  level,
  criteria,
});

// ── 예시 지도 지물 (고덕동 주변의 그럴듯한 좌표. 실제 위치가 아니다) ──
type MapFeature = NonNullable<TileResult["presentation"]["features"]>[number];
const CENTER = [127.1542, 37.555] as const; // 고덕역 (A05 단지 점이 실제 위치라 중심도 맞춘다)
const M_LNG = 88_200; // 이 위도에서 경도 1도 ≈ m
const M_LAT = 111_320;
const at = (bearingDeg: number, distM: number): [number, number] => {
  const a = (bearingDeg * Math.PI) / 180;
  return [Math.round((CENTER[0] + (Math.sin(a) * distM) / M_LNG) * 1e6) / 1e6, Math.round((CENTER[1] + (Math.cos(a) * distM) / M_LAT) * 1e6) / 1e6];
};
/** 고정 시드 의사난수로 반경 안에 흩뿌린다 (실행마다 같다) */
function scatter(layer: string, n: number, seed: number, maxM: number, minM = 40, weight?: (i: number) => number | null, label?: (i: number) => string | null): MapFeature[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: n }, (_, i) => {
    const [lng, lat] = at(rnd() * 360, minM + Math.sqrt(rnd()) * (maxM - minM));
    return { layer, lng, lat, ...(weight ? { weight: weight(i) } : {}), ...(label ? { label: label(i) } : {}), counted: true };
  });
}
const dot = (layer: string, bearing: number, dist: number, weight: number | null, label: string | null = null): MapFeature => {
  const [lng, lat] = at(bearing, dist);
  return { layer, lng, lat, weight, label };
};
const pin = (layer: string, bearing: number, dist: number, label: string, weight?: number): MapFeature => {
  const [lng, lat] = at(bearing, dist);
  return { layer, lng, lat, highlight: true, label, ...(weight ? { weight } : {}) };
};
// ── A05 예시 단지: 고덕역 반경 1km 실제 대장 결과에서 뽑은 좌표·이름·값 (아파트 22 + 오피스텔 3 + 연립·다세대 점 30) ──
// 주소·대지 요약은 예시로 표시하지만, 단지 점은 실제 필지 대표점이라 베이스맵의 같은 이름 단지 위에 놓인다.
// 대표점은 베이스맵 글자 위치와 최대 100m 정도 어긋날 수 있다. 값이 비어 있는 칸은 실제로 대장에 없던 값이다.
type Housing = "apt" | "officetel";
type Row = [name: string | null, lng: number, lat: number, households: number | null, year: number | null, floors: number | null, bldgs: number | null, parking: number | null, distM: number, layer?: Housing];
const A05_ROWS: Row[] = [
  ["고덕그라시움", 127.162285, 37.558069, 4932, 2019, null, 58, 7167, 791],
  ["고덕아르테온", 127.164396, 37.555516, 4066, 2020, null, 45, 6458, 902],
  ["래미안힐스테이트 고덕", 127.146939, 37.558943, 3658, 2016, null, 52, 6140, 776],
  ["래미안 솔베뉴", 127.145295, 37.552575, 1900, 2019, null, 13, 2304, 831],
  ["삼익그린맨션", 127.148258, 37.553132, 1667, 1983, null, 12, 2300, 564],
  ["고덕주공아파트", 127.150756, 37.547889, 1320, null, null, 15, 674, 846],
  ["고덕 아이파크", 127.154971, 37.559075, 1142, 2011, null, 15, 2024, 457],
  ["아남아파트", 127.146029, 37.558029, 807, null, null, 10, 695, 796],
  ["고덕숲아이파크", 127.161276, 37.551397, 687, 2018, null, 14, 917, 742],
  ["삼익그린맨션아파트", 127.147894, 37.550994, 630, null, null, 6, null, 713],
  ["우성아파트", 127.151864, 37.551133, 572, null, null, 10, null, 476],
  ["신동아아파트", 127.151998, 37.553658, 570, null, null, 9, 491, 245],
  ["한양아파트", 127.155135, 37.55048, 540, null, null, 7, 347, 508],
  ["고덕현대아파트", 127.153544, 37.550518, 524, null, null, 8, 363, 501],
  ["현대아파트", 127.152067, 37.556539, 448, null, null, 3, 456, 254],
  [null, 127.159822, 37.550678, 410, null, null, 6, 185, 690],
  ["명일삼환아파트", 127.153824, 37.553694, 306, null, null, 3, 229, 149],
  ["현대아파트", 127.1488, 37.548515, 226, null, null, 3, 76, 863],
  ["삼익그린11차아파트", 127.15048, 37.552007, 152, 1986, null, 1, null, 467],
  ["삼익그린맨션아파트", 127.148383, 37.549864, 150, null, null, 2, null, 767],
  [null, 127.158162, 37.546699, 132, null, null, 12, null, 985],
  ["고덕아르테스미소지움", 127.157058, 37.549908, 100, 2022, null, 3, 120, 619],
  ["고덕역 대명벨리온", 127.155116, 37.554656, 592, 2021, 20, null, null, 89, "officetel"],
  ["고덕역 효성해링턴 타워 더퍼스트", 127.154626, 37.55464, 467, 2020, 20, null, null, 55, "officetel"],
  ["현대델리안오피스텔", 127.155952, 37.553311, 44, 2006, 20, null, null, 243, "officetel"],
];
/** 연립·다세대 등 기타 공동주택 실제 위치 30곳: 번호 없는 작은 회색 점 */
const A05_OTHER_XY: Array<[number, number]> = [
  [127.154778, 37.553236], [127.147112, 37.549394], [127.155425, 37.547454], [127.155178, 37.547337], [127.154644, 37.548436],
  [127.15302, 37.559486], [127.152279, 37.561474], [127.154546, 37.561716], [127.152381, 37.560202], [127.155423, 37.546595],
  [127.161522, 37.561392], [127.154646, 37.560569], [127.152597, 37.561358], [127.154751, 37.547024], [127.15286, 37.561019],
  [127.154576, 37.547009], [127.155612, 37.561023], [127.155278, 37.546611], [127.155207, 37.547928], [127.161026, 37.561039],
  [127.15318, 37.548514], [127.15421, 37.548439], [127.153662, 37.559812], [127.155954, 37.56087], [127.153872, 37.561908],
  [127.152049, 37.5603], [127.15327, 37.560104], [127.155062, 37.548558], [127.152425, 37.561495], [127.151645, 37.559939],
];
const A05_OTHERS = A05_OTHER_XY.map(([lng, lat]): MapFeature => ({ layer: "other_housing", lng, lat, counted: true }));
const A05_APTS = A05_ROWS.filter((r) => (r[9] ?? "apt") === "apt");
const A05_HH = A05_APTS.reduce((s, r) => s + (r[3] ?? 0), 0);
const A05_YEARS = A05_ROWS.map((r) => r[4]).filter((y): y is number => y !== null).sort((a, b) => a - b);
const A05_MEDIAN_YEAR = A05_YEARS[Math.floor((A05_YEARS.length - 1) / 2)];
const TYPE_TEXT = { apt: "아파트", officetel: "오피스텔" } as const;
const complexPin = ([name, lng, lat, households, year, floors, bldgs, parking, distM, layer = "apt"]: Row): MapFeature => {
  return { layer, lng, lat, weight: households, name, type: TYPE_TEXT[layer], households, approvalYear: year, floorsMax: floors, buildingCount: bldgs, distanceM: distM, parking, counted: true };
};

// ── A06 예시 사업: 고덕역 반경 3km 실제 분양·입주예정 결과(엔진 a06, 2026-09-30 기준)에서 뽑은 25곳 ──
// 반경 1km에는 1곳뿐이라 이 타일의 예시만 반경 3km다. 이름·좌표·세대수·월은 실제 값이고, 같은 좌표에 겹친 "더샵 강동센트럴시티" 오피스텔 4건은 뺐다.
// 청약홈·입주예정 양쪽에 있는 "고덕강일 대성베르힐"은 엔진이 중복 가능으로 표시한 쌍이다.
type Supply = [name: string, lng: number, lat: number, units: number, month: string, distM: number, source: "applyhome" | "move_in", type: string, overlap: boolean];
const A06_ROWS: Supply[] = [
  ["디 아테온(THE ATHEON)", 127.142397, 37.542982, 64, "2026-07", 1693, "applyhome", "아파트", false],
  ["고덕강일 대성베르힐", 127.179171, 37.552762, 613, "2027-10", 2220, "applyhome", "아파트", true],
  ["VIORR(비오르)", 127.125373, 37.541326, 53, "2026-05", 2964, "applyhome", "아파트", false],
  ["더샵 둔촌포레", 127.146387, 37.531782, 74, "2024-11", 2667, "applyhome", "아파트", false],
  ["에스아이팰리스 강동 센텀Ⅱ", 127.137492, 37.537912, 80, "2024-01", 2403, "applyhome", "아파트", false],
  ["e편한세상 강동 프레스티지원", 127.126706, 37.542692, 263, "2026-01", 2786, "applyhome", "아파트", false],
  ["천호역 마에스트로", 127.124719, 37.543144, 77, "2025-02", 2918, "applyhome", "아파트", false],
  ["더샵 강동센트럴시티", 127.128441, 37.539119, 168, "2025-12", 2878, "applyhome", "아파트", false],
  ["강동 중앙하이츠 시티", 127.137118, 37.537351, 36, "2024-04", 2472, "applyhome", "아파트", false],
  ["둔촌 현대수린나", 127.145585, 37.532837, 34, "2023-10", 2574, "applyhome", "아파트", false],
  ["강동 헤리티지 자이", 127.148697, 37.539149, 219, "2024-06", 1825, "applyhome", "아파트", false],
  ["더샵 파크솔레이유", 127.144725, 37.529953, 73, "2023-06", 2902, "applyhome", "아파트", false],
  ["e편한세상 강일 어반브릿지", 127.180947, 37.555526, 593, "2024-02", 2363, "applyhome", "아파트", false],
  ["고덕강일 제일풍경채", 127.16937, 37.562815, 780, "2024-01", 1596, "applyhome", "아파트", false],
  ["고덕 아르테스 미소지움", 127.156968, 37.549892, 37, "2022-02", 617, "applyhome", "아파트", false],
  ["힐데스하임 천호", 127.12592, 37.542079, 101, "2022-07", 2880, "applyhome", "아파트", false],
  ["강동 리버스시티", 127.130175, 37.539294, 18, "2026-05", 2746, "applyhome", "오피스텔", false],
  ["더샵 강동센트럴시티", 127.131731, 37.542259, 6, "2025-12", 2437, "applyhome", "오피스텔", false],
  ["강동역 SK Leaders VIEW", 127.136785, 37.536831, 378, "2026-08", 2536, "applyhome", "오피스텔", false],
  ["강동 중앙하이츠 시티", 127.137118, 37.537351, 81, "2024-04", 2472, "applyhome", "오피스텔", false],
  ["강동밀레니얼 중흥S-클래스", 127.126988, 37.541445, 147, "2024-10", 2835, "applyhome", "주거", false],
  ["고덕강일3단지", 127.169378, 37.572533, 1305, "2027-05", 2362, "move_in", "분양", false],
  ["고덕강일 대성베르힐", 127.179095, 37.552799, 613, "2027-10", 2212, "move_in", "분양", true],
  ["성내동(청년안심주택)", 127.133819, 37.533623, 281, "2027-08", 2978, "move_in", "임대", false],
  ["대명아파트가로주택정비사업", 127.135762, 37.555258, 94, "2027-04", 1629, "move_in", "분양", false],
];
const supplyPin = ([name, lng, lat, units, month, distM, source, type, overlap]: Supply): MapFeature => ({
  layer: source, lng, lat, weight: units, label: month, name, type, households: units, plannedMonth: month, distanceM: distM, overlap,
});
const A06_UNITS = (src: string) => A06_ROWS.filter((r) => r[6] === src).reduce((s, r) => s + r[3], 0);
const A06_COUNT = (src: string) => A06_ROWS.filter((r) => r[6] === src).length;

/** A06 예시만 반경 3km (1km 안에는 실제 사업이 1곳뿐) */
const withA06Radius = (t: TileResult): TileResult => ({ ...t, conditions: { ...t.conditions, radiusM: 3000 } });

const withMap = (t: TileResult, features: MapFeature[], total = features.length): TileResult => ({
  ...t,
  presentation: { ...t.presentation, features, featuresTotal: total },
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
  withMap(tile(
    "A01",
    "analysis",
    "complete",
    [
      m("nearest_rail_m", "최근접 역 출입구", 480, "m"),
      m("rail_stations", "반경 내 운영역", 3, "개"),
      m("nearest_bus_m", "최근접 버스정류장", 340, "m"),
      m("bus_stops", "버스 정류장", 41, "개"),
      m("bus_routes", "경유 버스 노선", null, "개", "missing"),
    ],
    [["rail", "2026-09-01"], ["bus_stops", "2026-08-15"]],
    {
      ...j("A01-rail-distance@1", ["nearest_rail_m", "nearest_bus_m"], "최근접 역 출입구까지 직선 480m, 정류장 340m → 철도 접근은 가까운 편, 버스는 보통 수준 → 실제 보행 경로 확인 필요", "fair", "철도 직선거리 500m 이하 좋음 · 1,000m 이하 보통 · 초과 주의"),
      grades: [
        { metricId: "nearest_rail_m", level: "good", criteria: "철도역 출입구 직선 500m 이하 좋음 · 1,000m 이하 보통 · 초과 주의" },
        { metricId: "nearest_bus_m", level: "fair", criteria: "버스정류장 직선 300m 이하 좋음 · 600m 이하 보통 · 초과 주의" },
      ],
    },
    [{ kind: "unknown", note: "정류장별 경유 노선 연결 자료를 확보하지 못했습니다." }],
  ), [...scatter("bus_stop", 40, 11, 1000), pin("bus_nearest", 40, 340, "직선 340m")], 41),
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
  withMap(tile(
    "A03",
    "analysis",
    "complete",
    [
      m("basic_groups", "기초 생활시설 확인 군(4군 중)", 4, "군"),
      m("stores", "반경 내 상가 전체", 214, "개"),
      m("nearest_grocery_m", "최근접 식료품", 130, "m"),
      m("nearest_pharmacy_m", "최근접 약국", 260, "m"),
      m("store_density", "상가 밀도", 68.1, "개/㎢"),
    ],
    [["store", "2026-06-30"]],
    j("a03-basic-groups@1", ["basic_groups"], "기초 생활시설 4군 중 4군 확인 → 반경 안에서 일상 시설 접근 가능 → 업소 214개의 영업 여부는 현장 확인"),
    [],
  ), [
    ...scatter("store:other", 81, 21, 1000),
    ...scatter("store:eatery", 60, 22, 900),
    ...scatter("store:life_service", 30, 23, 900),
    ...scatter("store:grocery", 17, 24, 900),
    ...scatter("store:clinic", 13, 25, 900),
    ...scatter("store:pharmacy", 8, 26, 900),
    pin("store:grocery", 200, 130, "식료품 130m"),
    pin("store:pharmacy", 300, 260, "약국 260m"),
    pin("store:clinic", 80, 330, "의원 330m"),
    pin("store:life_service", 150, 180, "생활서비스 180m"),
    pin("store:eatery", 250, 90, "음식·카페 90m"),
  ], 214),
  withMap(tile(
    "A04",
    "analysis",
    "partial",
    [
      m("parks", "반경 내 공원", 5, "곳"),
      m("nearest_park_point_m", "공원 대표점까지", 320, "m"),
      m("park_area_sum_m2", "반경 내 공원 원천 면적 합", 128400, "㎡"),
      m("park_area_in_radius_m2", "반경 안에 든 공원 면적", null, "㎡", "missing"),
    ],
    [["park", "2026-05-31"]],
    j("a04-park-points@1", ["parks"], "공원 5곳 확인, 대표점까지 직선 320m → 입구가 아닌 대표점 기준의 거리임 → 실제 입구와 경계 확인 필요"),
    [{ kind: "not_provided", note: "공원 경계·입구 자료를 확인하지 못해 반경 안 면적과 입구 거리는 계산하지 못했습니다." }],
  ), [
    pin("park_nearest", 320, 320, "대표점 320m", 9200),
    dot("park", 100, 640, 61000),
    dot("park", 210, 720, 28000),
    dot("park", 20, 880, 21000),
    dot("park", 160, 450, 9200),
  ]),
  withMap(tile(
    "A05",
    "analysis",
    "partial",
    [
      m("apartment_complexes", "아파트 단지", A05_APTS.length, "개"),
      m("households", "확인 세대", A05_HH, "세대"),
      m("other_residential", "기타 공동주택(연립·다세대 등)", 179, "개"),
      m("median_year", "준공연도 중앙값", A05_MEDIAN_YEAR, "년"),
      m("aged_share_pct", "30년 이상 건물 비중", 38, "%", "estimated"),
      m("parking_per_household", "세대당 주차대수", null, "대", "missing"),
    ],
    [["gis_bldg", "2026-08-01"], ["kapt", null]],
    j("A05-stock@1", ["households"], `아파트 ${A05_APTS.length}개 단지 ${A05_HH.toLocaleString("en-US")}세대 확인 → 재고는 아파트 중심이며 오래된 건물이 상당수 → 준공연도 미상 단지 확인 필요`),
    [
      { kind: "incomplete", note: `준공연도를 알 수 없는 아파트 ${A05_APTS.filter((r) => r[4] === null).length}곳은 연식 집계에서 제외했습니다.` },
      { kind: "estimated", note: "30년 이상 비중은 분석 기준일 대비 경과연수로 추정한 값입니다." },
    ],
  ), [...A05_ROWS.map(complexPin), ...A05_OTHERS]),
  withA06Radius(withMap(tile(
    "A06",
    "analysis",
    "complete",
    [
      m("applyhome_units", "청약홈 공급 세대", A06_UNITS("applyhome"), "세대"),
      m("move_in_units", "입주예정 세대", A06_UNITS("move_in"), "세대"),
      m("projects", "반경 안 사업", A06_ROWS.length, "곳"),
      m("units_total", "합계", null, "세대", "missing"),
    ],
    [["applyhome", "2026-09-15"], ["move_in", "2026-06-30"]],
    j("A06-schedule@1", ["applyhome_units", "move_in_units"], `청약홈 ${A06_UNITS("applyhome").toLocaleString("en-US")}세대, 입주예정 ${A06_UNITS("move_in").toLocaleString("en-US")}세대가 각각 확인됨 → 같은 사업이 겹쳐 잡혔을 수 있어 합계는 내지 않음 → 사업별 연결 확인 필요`),
    [{ kind: "partial", note: "청약홈·입주예정에 같은 사업이 중복 등장할 수 있어 합계를 보류했습니다. 이름·주소가 같은 쌍은 \"중복 가능\"으로 표시하지만 합치지는 않습니다." }],
  ), A06_ROWS.map(supplyPin))),
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
  withMap(tile(
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
  ), [
    ...scatter("bldg_pre1980", 14, 41, 950, 60),
    ...scatter("bldg_1980s", 28, 42, 950, 60),
    ...scatter("bldg_1990s", 37, 43, 950, 60),
    ...scatter("bldg_2000s", 22, 44, 950, 60),
    ...scatter("bldg_2010s", 11, 45, 950, 60),
    ...scatter("bldg_2020s", 5, 46, 950, 60),
    ...scatter("bldg_unknown", 3, 47, 950, 60),
  ]),
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

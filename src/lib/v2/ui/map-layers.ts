import type { MapFeature, MapLine, MapPolygon, RasterRef } from "../tile-result";
import type { BasemapChoice } from "./map-projection";

/** MapFigure가 그리는 입력. 카드·상세·PPT가 같은 것을 쓴다. */
export type MapModel = {
  center: readonly [number, number];
  radiusM: number;
  features: MapFeature[];
  /** 결과가 저장된 분석과 타일. 브라우저 래스터 조회 경로를 만들 때만 사용한다. */
  analysisId?: string;
  tileCode?: string;
  /** 결과가 지정한 고정 배경(D01은 Satellite). */
  basemap?: BasemapChoice;
  /** 지도에 겹칠 압축 래스터 참조. */
  rasters?: RasterRef[];
  /** 면 지물(WGS84). T2의 MapFigure가 점보다 먼저 그린다. */
  polygons?: MapPolygon[];
  /** 분석 단위로 한 번 전달하는 대상 필지(멀티파트·홀 포함). 일반 면 지물과 분리해 그린다. */
  siteParcel?: MapPolygon[] | null;
  /** 상한으로 잘리기 전 전체 면 지물 개수 */
  polygonsTotal?: number;
  /** 선 지물(WGS84) */
  lines?: MapLine[];
  /** 상한으로 잘리기 전 전체 선 지물 개수 */
  linesTotal?: number;
  /** 상한으로 잘리기 전 전체 개수 (features.length보다 크면 그림에 "표시 n / 전체 m"을 적는다) */
  total: number;
  /** 범례 밑에 적는 짧은 문구 */
  notes: string[];
};

/** 지도 레이어 id → 라벨·색·표현 (엔진의 legend 라벨과 MapFigure가 함께 쓴다). 색은 화면 쪽에서 정한다. */
export type LayerStyle = {
  label: string;
  /** 이름이 없는 지도 요소를 설명할 때 덧붙이는 사용자 대상 명사. */
  subject?: string;
  color: string;
  /** weight로 원 크기(√비례)를 정한다. 아니면 작은 점 */
  sizeBy?: "weight";
  /** 면 지물의 채움·테두리. 없으면 color를 둘 다 쓴다. */
  fill?: string;
  stroke?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  /** SVG stroke-dasharray, e.g. "6 4". */
  dash?: string;
  /** 선 아래에 까는 외곽선 색. 색약 환경에서 선을 분리한다. */
  casing?: string;
  /** 방향성이 있는 선에 화살표 끝을 붙인다. */
  arrow?: boolean;
  /** 미상 범주를 채움 대신 빗금으로 표시한다. */
  hatch?: boolean;
};

export type RasterStyle = {
  mode: "stepped" | "continuous" | "mask";
  colors: string[];
  /** continuous 팔레트의 데이터 도메인 stop. 색을 균등 분배하지 않을 때 쓴다. */
  stops?: number[];
  breaks?: number[];
  min?: number;
  max?: number;
  opacity?: number;
  label?: string;
  /** 숫자 범례에 표시할 tick(데이터 도메인 값). */
  legendTicks?: number[];
  /** 색상 선택 근거를 숫자 범례에 함께 적는 짧은 문구. */
  legendNote?: string;
  /** stepped 칸마다 붙이는 짧은 범주명(색에만 의존하지 않기 위한 글자 범례). colors와 같은 길이. */
  legendLabels?: string[];
};

/** 준공 연대 색 (지도 점과 구성비 차트가 같이 쓴다). 오래될수록 진하다 */
/**
 * D04 준공 연대용 순차 램프.
 *
 * 같은 명도 계열의 갈색·주황은 작은 점에서 구분이 무너져, 색각 이상에도
 * 비교적 안전한 viridis 순서를 쓴다. 인접 단계는 CIELAB ΔE 기준 12 이상이다
 * (미상은 순차값이 아니므로 별도 슬레이트 회색으로 둔다).
 */
export const STRIP_COLORS = ["#440154", "#414487", "#2A788E", "#22A884", "#7AD151", "#FDE725", "#94A3B8"];

const S = (label: string, color: string, sizeBy?: "weight", subject?: string): LayerStyle => ({ label, color, sizeBy, subject });

export const LAYER_STYLES: Record<string, LayerStyle> = {
  bus_stop: S("버스정류장", "#6A50D3", undefined, "버스정류장"),
  bus_nearest: S("최근접 정류장", "#6A50D3", undefined, "버스정류장"),
  "store:grocery": S("식료품", "#3F9E6B"),
  "store:clinic": S("의원", "#D6478A"),
  "store:pharmacy": S("약국", "#2F6FDB"),
  "store:life_service": S("생활서비스", "#E5A11C"),
  "store:eatery": S("음식·카페", "#E4703A"),
  "store:other": S("기타 업소", "#B9BDC6"),
  rail_station: S("철도역", "#1F5FA8", undefined, "철도역"),
  rail_entrance: S("역 출입구", "#4F8FD8", undefined, "역 출입구"),
  rail_line: { label: "철도 노선", color: "#1F5FA8", subject: "철도 노선", strokeWidth: 3.6, casing: "#FFFFFF" },
  rail_nearest: S("최근접 역", "#1F5FA8", undefined, "철도역"),
  school_elem: S("초등학교", "#E5A11C", undefined, "학교"),
  school_middle: S("중학교", "#D9822B", undefined, "학교"),
  school_high: S("고등학교", "#B5651D", undefined, "학교"),
  school_nearest: S("최근접 초등학교", "#E5A11C", undefined, "학교"),
  school_zone_elem: { ...S("초등 통학구역", "#F2B84B"), strokeWidth: 1, dash: "5 3" },
  school_zone_elem_site: { ...S("대상 초등 통학구역", "#C56A00"), strokeWidth: 2 },
  school_zone_middle: { ...S("중학교 학교군", "#E09A4E"), strokeWidth: 1, dash: "5 3" },
  school_zone_middle_site: { ...S("대상 중학교 학교군", "#A84C1A"), strokeWidth: 2 },
  school_zone_high: { ...S("고등학교 학교군", "#C77A3A"), strokeWidth: 1, dash: "5 3" },
  school_zone_high_site: { ...S("대상 고등학교 학교군", "#7D3615"), strokeWidth: 2 },
  planned_rail_line: { label: "계획 철도 선형", color: "#8A5BC7", strokeWidth: 2, dash: "7 5", casing: "#FFFFFF" },
  planned_rail_station: S("계획역", "#8A5BC7"),
  "road:고속도로": { label: "간선 이상", color: "#8D3B2F", strokeWidth: 3, casing: "#FFFFFF" },
  "road:간선": { label: "간선 이상", color: "#C45A36", strokeWidth: 3, casing: "#FFFFFF" },
  "road:보조간선": { label: "보조간선·집산", color: "#D88B38", strokeWidth: 2, casing: "#FFFFFF" },
  "road:집산": { label: "보조간선·집산", color: "#5F8F6A", strokeWidth: 1.5, casing: "#FFFFFF" },
  "road:국지": { label: "국지", color: "#7BA68A", strokeWidth: 1 },
  "road:보행·자전거": { label: "보행·자전거", color: "#4F8A9E", strokeWidth: 0.75, dash: "3 3" },
  "road:기타": { label: "도로 기타", color: "#9AA0AA", strokeWidth: 1 },
  pop_grid_na: S("인구 비공개 격자", "#B9BDC6"),
  park: S("공원", "#5C9A3C", "weight", "공원"),
  park_nearest: S("최근접 공원", "#2F7A1E", "weight", "공원"),
  apt: S("아파트 단지", "#8C6D5A", "weight"),
  other_housing: S("기타 공동주택", "#9AA0AA"),
  officetel: S("오피스텔", "#2B9CBF", "weight"),
  applyhome: S("청약홈", "#D6478A", "weight"),
  move_in: S("입주예정", "#2F6FDB", "weight"),
  trade_q1: S("㎡당 하위 20%", "#BFD7F5", "weight"),
  trade_q2: S("㎡당 20~40%", "#8FB8EC", "weight"),
  trade_q3: S("㎡당 40~60%", "#5C97E0", "weight"),
  trade_q4: S("㎡당 60~80%", "#2F6FDB", "weight"),
  trade_q5: S("㎡당 상위 20%", "#1B3F8F", "weight"),
  maint_zone: S("정비구역", "#D6478A"),
  maint_zone_center: S("정비구역", "#D6478A"),
  zoning_site: S("대지 용도지역", "#C9A227"),
  "jimok:대": S("지목 · 대지", "#C9A227"),
  "jimok:도로": S("지목 · 도로", "#8D8D8D"),
  "jimok:전답": S("지목 · 전·답", "#D9A441"),
  "jimok:임야": S("지목 · 임야", "#5C9A3C"),
  "jimok:하천·구거": S("지목 · 하천·구거", "#4F9DA6"),
  "jimok:기타": S("지목 · 기타", "#B9BDC6"),
  ...Object.fromEntries(
    (
      [["주거", "#F2C94C"], ["상업", "#E05A47"], ["공업", "#8E7CC3"], ["녹지", "#5FAE5B"], ["관리", "#A8C66C"], ["농림", "#7FB77E"], ["자연환경보전", "#2F7A4E"], ["기타", "#B9BDC6"]] as const
    ).flatMap(([c, color]) => [[`zone:${c}`, S(`${c}지역`, color)], [`zone_center:${c}`, S(`${c}지역`, color)]]),
  ),
  bldg_pre1980: S("1970년대 이전", STRIP_COLORS[0], undefined, "건물"),
  bldg_1980s: S("1980년대", STRIP_COLORS[1], undefined, "건물"),
  bldg_1990s: S("1990년대", STRIP_COLORS[2], undefined, "건물"),
  bldg_2000s: S("2000년대", STRIP_COLORS[3], undefined, "건물"),
  bldg_2010s: S("2010년대", STRIP_COLORS[4], undefined, "건물"),
  bldg_2020s: S("2020년 이후", STRIP_COLORS[5], undefined, "건물"),
  bldg_unknown: S("미상", STRIP_COLORS[6], undefined, "건물"),
  bldg_footprint: S("건물 발자국", "#8B5A3C", undefined, "건물"),
  bldg_point: S("건물(대표점)", "#A0522D", undefined, "건물"),
  svf_building: { label: "건물(계산 제외)", subject: "건물", color: "#64748B", fill: "#CBD5E1", stroke: "#64748B", fillOpacity: 0.86, strokeWidth: 0.75 },
  "use:주거": S("주거", "#D69E2E"),
  "use:근린생활": S("근린생활", "#E07A5F"),
  "use:업무": S("업무", "#6C8EBF"),
  "use:판매": S("판매", "#C76D8B"),
  "use:숙박": S("숙박", "#9B72AA"),
  "use:문화집회": S("문화집회", "#B7791F"),
  "use:교육복지": S("교육복지", "#4C956C"),
  "use:공업": S("공업", "#718096"),
  "use:기타": S("기타", "#A0AEC0"),
  "use:미상": { label: "용도 미상", color: "#CBD5E0", fill: "#F8FAFC", stroke: "#64748B", fillOpacity: 0.2, strokeWidth: 1, hatch: true },
  floors_1_4: S("1~4층", "#B8D8BA", undefined, "건물"),
  floors_5_8: S("5~8층", "#86BBD8", undefined, "건물"),
  floors_9_14: S("9~14층", "#5C80BC", undefined, "건물"),
  floors_15_25: S("15~25층", "#775DA6", undefined, "건물"),
  floors_26p: S("26층 이상", "#4A2545", undefined, "건물"),
  floors_unknown: S("층수 미상", "#B9BDC6", undefined, "건물"),
  floors_assumed_1f_est: S("1층 가정(추정)", "#B9BDC6", undefined, "건물"),
  tall_ge35: S("35m 이상", "#AA4465", undefined, "건물"),
  tall_ge35_est: S("[추정] 35m 이상", "#AA4465", undefined, "건물"),
  tall_assumed_1f_est: S("1층 가정(추정)", "#B9BDC6", undefined, "건물"),
  tall_lt35: S("35m 미만", "#CBD5E1", undefined, "건물"),
  tall_unknown: S("높이 미상", "#B9BDC6", undefined, "건물"),
  low_le12: S("12m 이하", "#4C956C", undefined, "건물"),
  low_le12_est: S("[추정] 12m 이하", "#4C956C", undefined, "건물"),
  low_assumed_1f_est: S("1층 가정(추정)", "#B9BDC6", undefined, "건물"),
  low_gt12: S("12m 초과", "#C76D8B", undefined, "건물"),
  low_unknown: S("높이 미상", "#B9BDC6", undefined, "건물"),
  bldg_assumed_1f: S("1층 가정(추정)", "#B9BDC6", undefined, "건물"),
  bldg_assumed_1f_est: S("1층 가정(추정)", "#B9BDC6", undefined, "건물"),
  green_zone: S("녹지지역", "#5FAE5B"),
  green_parcel: S("임야·공원 지목", "#7FB77E"),
  water_parcel: S("하천·구거·유지 지목", "#4F9DA6"),
  "district:지구단위계획": S("지구단위계획", "#7B61A8"),
  "district:개발제한": S("개발제한", "#C05640"),
  "district:택지·도시개발": S("택지·도시개발", "#D69E2E"),
  "district:산업단지": S("산업단지", "#667085"),
  "district:기타": S("구역·지구 기타", "#98A2B3"),
  "facility:교통": S("도시계획시설 · 교통", "#2F6FDB"),
  "facility:공간": S("도시계획시설 · 공간", "#4C956C"),
  "facility:유통공급": S("도시계획시설 · 유통공급", "#E5A11C"),
  "facility:공공문화체육": S("도시계획시설 · 공공문화체육", "#D6478A"),
  "facility:보건위생": S("도시계획시설 · 보건위생", "#2B9CBF"),
  "facility:환경기초": S("도시계획시설 · 환경기초", "#5C9A3C"),
  "facility:방재": S("도시계획시설 · 방재", "#C05640"),
  "facility:기타": S("도시계획시설 기타", "#B9BDC6"),
  parcel: S("필지", "#B07D4F"),
  /** 대지 지정 화면의 기본 필지. 분석 결과용 parcel 색을 재사용하지 않는다. */
  parcel_picker: { label: "필지", color: "#9aa0a8", fill: "#f7f7f3", stroke: "#a9adb5", fillOpacity: 0.24, strokeWidth: 0.8 },
  parcel_site: S("대상 필지", "#D1495B"),
  lot_lt100: S("100㎡ 미만", "#D9A441"),
  lot_100_300: S("100~300㎡", "#C47F3A"),
  lot_300_1000: S("300~1,000㎡", "#A95C3B"),
  lot_1000_3000: S("1,000~3,000㎡", "#814C5A"),
  lot_ge3000: S("3,000㎡ 이상", "#5B3A70"),
  lot_road_water: S("도로·하천 지목", "#4F9DA6"),
  // D19 지목 6그룹(사용자 결정 7). 녹지 계열 둘은 명도로 갈라 색각 이상에서도 구분된다.
  "jimok:site": S("지목 · 대지", "#E3B65C"),
  "jimok:road": S("지목 · 도로", "#8C939E"),
  "jimok:field": S("지목 · 전답", "#B5CF6B"),
  "jimok:forest": S("지목 · 임야", "#3F7D4E"),
  "jimok:water": S("지목 · 하천·구거", "#4F8FC9"),
  "jimok:other": S("지목 · 기타", "#C9C0D6"),
  "maint_stage:구역지정": S("정비사업 · 구역지정", "#D6478A"),
  "maint_stage:추진위": S("정비사업 · 추진위", "#C05A8A"),
  "maint_stage:조합": S("정비사업 · 조합", "#A84C7B"),
  "maint_stage:사업시행": S("정비사업 · 사업시행", "#8F3F6D"),
  "maint_stage:관리처분": S("정비사업 · 관리처분", "#77365F"),
  "maint_stage:착공": S("정비사업 · 착공", "#5F2E52"),
  "maint_stage:준공": S("정비사업 · 준공", "#4A2545"),
  "maint_stage:미확인": S("정비사업 · 미확인", "#B9BDC6"),
  pop_dens_0: S("0명/㎢", "#F0F4F8", "weight"),
  pop_dens_1: S("0 초과~1,000명/㎢", "#CFE8E6", "weight"),
  pop_dens_2: S("1,000~5,000명/㎢", "#9CCFCB", "weight"),
  pop_dens_3: S("5,000~10,000명/㎢", "#63B0AB", "weight"),
  pop_dens_4: S("10,000~20,000명/㎢", "#2B8C88", "weight"),
  pop_dens_5: S("20,000명/㎢ 이상", "#125C5A", "weight"),
  block_lt05: S("0.5ha 미만", "#F2C94C"),
  block_05_1: S("0.5~1ha", "#E5A11C"),
  block_1_2: S("1~2ha", "#D9822B"),
  block_2_5: S("2~5ha", "#C45A36"),
  block_ge5: S("5ha 이상", "#8D3B2F"),
  block_open: { label: "미폐합", color: "#9AA0AA", fill: "#FFFFFF", stroke: "#9AA0AA", fillOpacity: 0.04, strokeWidth: 0.8 },
  dens_0: { label: "0", color: "#F0F4F8", fill: "#FFFFFF", stroke: "#CBD5E1", fillOpacity: 0.04, strokeWidth: 0.6 },
  dens_q1: S("하위 20%", "#CFE8E6", "weight"),
  dens_q2: S("20~40%", "#9CCFCB", "weight"),
  dens_q3: S("40~60%", "#63B0AB", "weight"),
  dens_q4: S("60~80%", "#2B8C88", "weight"),
  dens_q5: S("상위 20%", "#125C5A", "weight"),
  relief_lt_m20: S("중심 대비 −20m 미만", "#6B4F3A"),
  relief_m20_m5: S("−20~−5m", "#9A6B46"),
  relief_m5_5: S("−5~5m", "#C7A66A"),
  relief_5_20: S("5~20m", "#8AA56F"),
  relief_ge20: S("20m 이상", "#4F7D58"),
  dem_nodata: S("지형 결측", "#B9BDC6"),
  contour: { label: "등고선", color: "#4B5563", strokeWidth: 1 },
  slope_0_5: S("경사 0~5°", "#E6E2F4"),
  slope_5_10: S("경사 5~10°", "#C4B9E4"),
  slope_10_15: S("경사 10~15°", "#9D8BC8"),
  slope_15_20: S("경사 15~20°", "#765EA8"),
  slope_ge20: S("경사 20° 이상", "#4A3575"),
  slope_nodata: S("경사 결측", "#B9BDC6"),
  sun_0: S("0시간", "#F0F4F8"),
  sun_0_2: S("0 초과~2시간", "#F9D976"),
  sun_2_4: S("2~4시간", "#F4BA45"),
  sun_4_6: S("4~6시간", "#EC8E2F"),
  sun_6_8: S("6~8시간", "#D85B2A"),
  sun_ge8: S("8시간 이상", "#A93D27"),
  sun_uncalc: S("미계산", "#B9BDC6"),
  sun_face: { label: "대지 일조", color: "#F08A24", fill: "#F08A24", stroke: "#B45309", fillOpacity: 0.35, strokeWidth: 1 },
  shadow_09: S("09:00 그림자", "#6D7580"),
  shadow_12: S("12:00 그림자", "#535A65"),
  shadow_15: S("15:00 그림자", "#383E48"),
  rent_jeonse: S("전세 거래 지점", "#2B6CB0", "weight"),
  rent_monthly: S("월세 거래 지점", "#63B3ED", "weight"),
  walk_route: S("보행 경로", "#7A5BA6"),
  canopy: S("수관", "#2E7D32"),
  osm_green: S("OSM 녹지", "#5FAE5B"),
  osm_water: S("OSM 수계", "#4F9DA6"),
  walk_5: S("도보 5분", "#4D9D7E"),
  walk_10: S("도보 10분", "#8FC9B3"),
  walk_15: S("도보 15분", "#CDE8DC"),
  walk_net: { label: "보행망", color: "#5AA88E", strokeWidth: 0.75 },
  wind_inflow: { label: "유입 방향", color: "#2B9CBF", strokeWidth: 2, arrow: true, casing: "#FFFFFF" },
};

/** 래스터의 값→색 규칙. 실제 픽셀화는 ui/raster-image.ts가 담당한다. */
export const RASTER_STYLES: Record<string, RasterStyle> = {
  sun_hours: {
    mode: "stepped",
    colors: ["#43566B", "#4E6478", "#5A7184", "#678095", "#748EA2", "#829CAF", "#91A9B7", "#A1B5B8", "#B1BDA9", "#C2BE93", "#D1B77B", "#DDA963", "#E19A4F", "#E28A43", "#DF793B", "#D76835"],
    breaks: Array.from({ length: 15 }, (_, i) => i + 1),
    label: "일조시간",
  },
  shade_mask: { mode: "mask", colors: ["#3D4A63"], opacity: 0.55, label: "그림자" },
  shade_flow: { mode: "continuous", colors: ["#22304C", "#586B89", "#B7C4D7"], min: 0, max: 1, label: "그림자 흐름" },
  wind_ratio: { mode: "stepped", colors: ["#440154", "#31688E", "#35B779", "#FDE725"], breaks: [0.5, 0.8, 1.2], min: 0, max: 1.5, legendTicks: [0, 0.5, 0.8, 1.2, 1.5], legendLabels: ["0~0.5", "0.5~0.8", "0.8~1.2", "1.2 이상"], label: "U/U유입" },
  // UTCI 표준 10개 열스트레스 범주(-40·-27·-13·0·9·26·32·38·46). 한랭은 청색, 쾌적은 녹색, 열 쪽은
  // 노랑→주황→빨강→암적색으로 색상·명도가 함께 달라진다. 열 범주(26 이상)는 범주 안을 2~3 °C 단위로 나눠
  // 같은 색 계열의 진하기를 단계적으로 바꿨다: 같은 범주 안의 양지(≈35)와 그늘(≈33)도 지도에서 구분된다.
  // 범례는 10개 범주의 첫 단계 색과 범주명을 보여 준다.
  utci: {
    mode: "stepped",
    colors: ["#26236B", "#3B4BA8", "#4F7FC4", "#7DB0DC", "#B9DCEE", "#5DB075", "#F9E27A", "#F5D13F", "#F8A94A", "#F28C28", "#E3731A", "#E5482F", "#D7301F", "#B3231A", "#6E0F1F"],
    breaks: [-40, -27, -13, 0, 9, 26, 29, 32, 34, 36, 38, 40, 43, 46],
    label: "UTCI (°C)",
    legendLabels: ["극한한랭", "매우한랭", "강한한랭", "중간한랭", "약한한랭", "열적쾌적", "중간열", "강한열", "매우열", "극한열"],
  },
  svf: {
    mode: "continuous",
    // CIELAB L*: 18.8 → 98.4. The upper half is deliberately split at
    // 0.65/0.75/0.85/0.92 because the real Godeok distribution is top-heavy.
    colors: ["#1b2b5a", "#203b80", "#245a93", "#477da5", "#6f9fc2", "#9fc5dc", "#d2e8f4", "#f7fbff"],
    stops: [0, 0.25, 0.5, 0.65, 0.75, 0.85, 0.92, 1],
    min: 0,
    max: 1,
    label: "하늘열림(SVF)",
    legendTicks: [0, 0.25, 0.5, 0.75, 1],
    legendNote: "색 stop: 0·25·50·65·75·85·92·100% · 낮음=닫힘, 높음=열림",
  },
  canopy: { mode: "mask", colors: ["#2E7D32"], opacity: 0.7, label: "수관" },
};
const FALLBACK: LayerStyle = S("기타", "#7A7E87");

/** 지물이 있는 레이어의 범례 항목 (정의된 순서) */
export const legendItems = (model: MapModel) => {
  const present = new Set([
    ...model.features.map((feature) => feature.layer).filter((layer) => !layer.endsWith("_nearest")),
    ...(model.polygons ?? []).map((polygon) => polygon.layer).filter((layer) => !layer.endsWith("_nearest")),
    ...(model.lines ?? []).map((line) => line.layer).filter((layer) => !layer.endsWith("_nearest")),
  ]);
  const highlightedLabels = new Set(
    model.features.filter((feature) => feature.highlight && !feature.layer.endsWith("_nearest")).map((feature) => layerStyle(feature.layer).label),
  );
  const seenLabels = new Set<string>();
  return Object.keys(LAYER_STYLES).flatMap((layer) => {
    if (!present.has(layer)) return [];
    const style = LAYER_STYLES[layer];
    if (seenLabels.has(style.label)) return [];
    seenLabels.add(style.label);
    return [{ layer, label: style.label, color: style.color, highlight: highlightedLabels.has(style.label) }];
  });
};

/** 카드 지도처럼 공간이 좁을 때, 실제로 가장 많이 그린 레이어만 남긴 미니 범례. */
export function compactLegendItems(model: MapModel, limit = 3) {
  const counts = new Map<string, number>();
  const add = (layer: string) => {
    if (layer.endsWith("_nearest")) return;
    const label = LAYER_STYLES[layer]?.label;
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  };
  for (const f of model.features) add(f.layer);
  for (const p of model.polygons ?? []) add(p.layer);
  for (const l of model.lines ?? []) add(l.layer);
  return legendItems(model)
    .map((item, order) => ({ ...item, count: counts.get(item.label) ?? 0, order }))
    .sort((a, b) => Number(b.highlight) - Number(a.highlight) || b.count - a.count || a.order - b.order)
    .slice(0, Math.max(0, limit));
}

export const layerStyle =(layer: string): LayerStyle => LAYER_STYLES[layer] ?? FALLBACK;

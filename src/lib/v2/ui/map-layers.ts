import type { MapFeature, MapLine, MapPolygon, RasterRef, TileResult } from "../tile-result";
import { railLineBadgeText } from "../tile/rail-presentation";
import type { MapBase } from "./basemap";
import { paletteLayerStyle, type DiagramPaletteRef } from "./map-palette";
import type { BasemapChoice } from "./map-projection";
import type { BaseThemeRef, BaseToggleLayer } from "./map-theme";

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
  /** 분석 장면에서 만든 벡터 바탕 자료. 같은 장면의 모든 타일이 같은 객체를 공유한다. */
  base?: MapBase | null;
  /** 지도에 겹칠 압축 래스터 참조. */
  rasters?: RasterRef[];
  /** 엔진이 계산한 범례 경계. 있으면 정적 레이어명보다 우선해 표시한다. */
  legend?: TileResult["presentation"]["legend"];
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
  /** 선택한 모드에 표시할 지물이 없을 때 지도 위에 보여 주는 안내 */
  emptyMessage?: string;
  /** 지도 바탕 테마. 없으면 기본 테마. */
  baseTheme?: BaseThemeRef;
  /** 다이어그램 팔레트. 없거나 `app`이면 레이어 원래 색. */
  palette?: DiagramPaletteRef;
  /** 끈 바탕 레이어. */
  baseHide?: BaseToggleLayer[];
  /** 지물 `value`의 뜻(그래프 축). 값을 싣는 타일만 있다. */
  valueAxis?: { label: string; unit: string; countUnit: string };
  /** 상한이 엔진이 센 지물을 떨어뜨렸다(없으면 false). 그러면 그래프 개수가 문장과 어긋나니 그래프를 내지 않는다. */
  countedCapped?: boolean;
};

/** 지도 레이어 id → 라벨·색·표현 (엔진의 legend 라벨과 MapFigure가 함께 쓴다). 색은 화면 쪽에서 정한다. */
export type LayerStyle = {
  label: string;
  color: string;
  /** 범례에서 함께 이동하는 순서형 레이어 묶음. */
  legendGroup?: string;
  /** 묶음 안에서의 정의 순서(낮음→높음). */
  legendOrder?: number;
  /** weight로 원 크기(√비례)를 정한다. 아니면 작은 점 */
  sizeBy?: "weight";
  /** 면 지물의 채움·테두리. 없으면 color를 둘 다 쓴다. */
  fill?: string;
  stroke?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  /** 선의 기본 불투명도. 색만 바꾸지 않고 선 위계의 시각적 무게를 조정한다. */
  opacity?: number;
  /** SVG stroke-dasharray, e.g. "6 4". */
  dash?: string;
  /** SVG stroke-linecap for line layers and their legend swatch. */
  lineCap?: "butt" | "round" | "square";
  /** Draw short perpendicular ticks for retaining-wall style consumers. */
  tickMarks?: boolean;
  /** Opt in to a geometry-faithful line swatch in the shared legend strip. */
  lineSwatch?: boolean;
  /** Explicit non-point geometry for consumers that cannot infer it from a feature. */
  legendSwatch?: "line" | "polygon";
  /** 선 아래에 까는 외곽선 색. 색약 환경에서 선을 분리한다. */
  casing?: string;
  /** 방향성이 있는 선에 화살표 끝을 붙인다. */
  arrow?: boolean;
  /** 미상 범주를 채움 대신 빗금으로 표시한다. */
  hatch?: boolean;
  /** 최근접 지물처럼 기본 nearest 제외 규칙을 넘어 범례에 표시한다. */
  showInLegend?: boolean;
};

/** 래스터가 실제로 그려졌을 때 건물 마스크에 쓰는 중립 스타일. */
export const NEUTRAL_BUILDING_STYLE = {
  fill: "#F8FAFC",
  stroke: "#475569",
  fillOpacity: 0.94,
  strokeWidth: 0.8,
} as const;

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

export const LEGEND_GROUPS = {
  tradeQuantiles: "trade:quantiles",
  tradeDistrict: "trade:district",
  rentJeonseQuantiles: "rent:quantiles:jeonse",
  rentMonthlyQuantiles: "rent:quantiles:monthly",
  rentJeonseDistrict: "rent:district:jeonse",
  rentMonthlyDistrict: "rent:district:monthly",
  d04CompletionYear: "d04:completion-year",
  d05Floors: "d05:floors",
  d16Density: "d16:density",
  d19Jimok: "d19:jimok",
  a04GreenSpace: "a04:green-space",
} as const;

const S = (
  label: string,
  color: string,
  sizeBy?: "weight",
  legendGroup?: string,
  legendOrder?: number,
): LayerStyle => ({
  label,
  color,
  sizeBy,
  ...(legendGroup === undefined ? {} : { legendGroup }),
  ...(legendOrder === undefined ? {} : { legendOrder }),
});

const flatPolygon = (
  label: string,
  color: string,
  sizeBy?: "weight",
  legendGroup?: string,
  legendOrder?: number,
): LayerStyle => ({
  ...S(label, color, sizeBy, legendGroup, legendOrder),
  fill: color,
  stroke: color,
  fillOpacity: 1,
  strokeWidth: 0,
});

const districtPolygon = (label: string, color: string, legendGroup: string, legendOrder: number): LayerStyle => ({
  ...S(label, color, undefined, legendGroup, legendOrder),
  fill: color,
  stroke: "#475569",
  fillOpacity: 0.72,
  strokeWidth: 1,
});

const districtMissingPolygon = (label: string, legendGroup: string, legendOrder: number): LayerStyle => ({
  ...districtPolygon(label, "#CBD5E1", legendGroup, legendOrder),
  hatch: true,
});

export const LAYER_STYLES: Record<string, LayerStyle> = {
  bus_stop: S("버스정류장", "#6A50D3"),
  bus_nearest: S("최근접 정류장", "#6A50D3"),
  "store:grocery": S("식료품", "#3F9E6B"),
  "store:clinic": S("의원", "#D6478A"),
  "store:pharmacy": S("약국", "#2F6FDB"),
  "store:life_service": S("생활서비스", "#E5A11C"),
  "store:eatery": S("음식·카페", "#E4703A"),
  "store:other": S("기타 업소", "#B9BDC6"),
  rail_station: S("철도역", "#1F5FA8"),
  rail_entrance: S("역 출입구", "#4F8FD8"),
  rail_line: { label: "철도 노선", color: "#1F5FA8", strokeWidth: 4.2, casing: "#FFFFFF" },
  rail_station_axis: { label: "철도 노선", color: "#1F5FA8", strokeWidth: 9, casing: "#FFFFFF" },
  rail_nearest: S("최근접 역", "#1F5FA8"),
  school_elem: S("초등학교", "#E5A11C"),
  school_middle: S("중학교", "#D9822B"),
  school_high: S("고등학교", "#B5651D"),
  school_nearest: S("최근접 초등학교", "#E5A11C"),
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
  "road:width:12+": { label: "수치지형도 도로 폭 12m 이상", color: "#7C2D12", strokeWidth: 4.5, casing: "#FFFFFF" },
  "road:width:8-12": { label: "수치지형도 도로 폭 8~12m", color: "#B45309", strokeWidth: 3.25, casing: "#FFFFFF" },
  "road:width:4-8": { label: "수치지형도 도로 폭 4~8m", color: "#D97706", strokeWidth: 2.25, casing: "#FFFFFF" },
  "road:width:<4": { label: "수치지형도 도로 폭 4m 미만·미상", color: "#65A30D", strokeWidth: 1.25, casing: "#FFFFFF" },
  pop_grid_na: S("인구 비공개 격자", "#B9BDC6"),
  park: flatPolygon("지정 공원", "#6CC24A", "weight", LEGEND_GROUPS.a04GreenSpace, 0),
  apt: S("아파트 단지", "#8C6D5A", "weight"),
  other_housing: S("기타 공동주택", "#9AA0AA"),
  officetel: S("오피스텔", "#2B9CBF", "weight"),
  applyhome: S("청약홈", "#D6478A", "weight"),
  move_in: S("입주예정", "#2F6FDB", "weight"),
  trade_q1: S("㎡당 하위 20%", "#BFD7F5", "weight", LEGEND_GROUPS.tradeQuantiles, 0),
  trade_q2: S("㎡당 20~40%", "#8FB8EC", "weight", LEGEND_GROUPS.tradeQuantiles, 1),
  trade_q3: S("㎡당 40~60%", "#5C97E0", "weight", LEGEND_GROUPS.tradeQuantiles, 2),
  trade_q4: S("㎡당 60~80%", "#2F6FDB", "weight", LEGEND_GROUPS.tradeQuantiles, 3),
  trade_q5: S("㎡당 상위 20%", "#1B3F8F", "weight", LEGEND_GROUPS.tradeQuantiles, 4),
  trade_district_q1: districtPolygon("법정동 평균 ㎡당 1단계", "#BFD7F5", LEGEND_GROUPS.tradeDistrict, 0),
  trade_district_q2: districtPolygon("법정동 평균 ㎡당 2단계", "#8FB8EC", LEGEND_GROUPS.tradeDistrict, 1),
  trade_district_q3: districtPolygon("법정동 평균 ㎡당 3단계", "#5C97E0", LEGEND_GROUPS.tradeDistrict, 2),
  trade_district_q4: districtPolygon("법정동 평균 ㎡당 4단계", "#2F6FDB", LEGEND_GROUPS.tradeDistrict, 3),
  trade_district_q5: districtPolygon("법정동 평균 ㎡당 5단계", "#1B3F8F", LEGEND_GROUPS.tradeDistrict, 4),
  trade_district_missing: districtMissingPolygon("법정동 자료 부족", LEGEND_GROUPS.tradeDistrict, 5),
  maint_zone: S("정비구역", "#D6478A"),
  maint_zone_center: S("정비구역", "#D6478A"),
  zoning_site: S("대지 용도지역", "#C9A227"),
  "jimok:대": S("지목 · 대지", "#C9A227", undefined, LEGEND_GROUPS.d19Jimok, 0),
  "jimok:도로": S("지목 · 도로", "#8D8D8D", undefined, LEGEND_GROUPS.d19Jimok, 1),
  "jimok:전답": S("지목 · 전·답", "#D9A441", undefined, LEGEND_GROUPS.d19Jimok, 2),
  "jimok:임야": S("지목 · 임야", "#5C9A3C", undefined, LEGEND_GROUPS.d19Jimok, 3),
  "jimok:하천·구거": S("지목 · 하천·구거", "#4F9DA6", undefined, LEGEND_GROUPS.d19Jimok, 4),
  "jimok:기타": S("지목 · 기타", "#B9BDC6", undefined, LEGEND_GROUPS.d19Jimok, 5),
  ...Object.fromEntries(
    (
      [["주거", "#F2C94C"], ["상업", "#E05A47"], ["공업", "#8E7CC3"], ["녹지", "#5FAE5B"], ["관리", "#A8C66C"], ["농림", "#7FB77E"], ["자연환경보전", "#2F7A4E"], ["기타", "#B9BDC6"]] as const
    ).flatMap(([c, color]) => [[`zone:${c}`, S(`${c}지역`, color)], [`zone_center:${c}`, S(`${c}지역`, color)]]),
  ),
  bldg_pre1980: S("1970년대 이전", STRIP_COLORS[0], undefined, LEGEND_GROUPS.d04CompletionYear, 0),
  bldg_1980s: S("1980년대", STRIP_COLORS[1], undefined, LEGEND_GROUPS.d04CompletionYear, 1),
  bldg_1990s: S("1990년대", STRIP_COLORS[2], undefined, LEGEND_GROUPS.d04CompletionYear, 2),
  bldg_2000s: S("2000년대", STRIP_COLORS[3], undefined, LEGEND_GROUPS.d04CompletionYear, 3),
  bldg_2010s: S("2010년대", STRIP_COLORS[4], undefined, LEGEND_GROUPS.d04CompletionYear, 4),
  bldg_2020s: S("2020년 이후", STRIP_COLORS[5], undefined, LEGEND_GROUPS.d04CompletionYear, 5),
  bldg_unknown: S("미상", STRIP_COLORS[6], undefined, LEGEND_GROUPS.d04CompletionYear, 6),
  bldg_footprint: S("건물 발자국", "#8B5A3C"),
  bldg_point: S("건물 도형 오류", "#A0522D"),
  svf_building: { label: "건물(계산 제외)", color: "#64748B", fill: "#CBD5E1", stroke: "#64748B", fillOpacity: 0.86, strokeWidth: 0.75 },
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
  floors_1_4: S("1~4층", "#B8D8BA", undefined, LEGEND_GROUPS.d05Floors, 0),
  floors_5_8: S("5~8층", "#86BBD8", undefined, LEGEND_GROUPS.d05Floors, 1),
  floors_9_14: S("9~14층", "#5C80BC", undefined, LEGEND_GROUPS.d05Floors, 2),
  floors_15_25: S("15~25층", "#775DA6", undefined, LEGEND_GROUPS.d05Floors, 3),
  floors_26p: S("26층 이상", "#4A2545", undefined, LEGEND_GROUPS.d05Floors, 4),
  floors_unknown: S("층수 미상", "#B9BDC6", undefined, LEGEND_GROUPS.d05Floors, 5),
  floors_assumed_1f_est: S("1층 가정(추정)", "#B9BDC6", undefined, LEGEND_GROUPS.d05Floors, 6),
  tall_ge35: S("35m 이상", "#AA4465"),
  tall_ge35_est: S("[추정] 35m 이상", "#AA4465"),
  tall_assumed_1f_est: S("1층 가정(추정)", "#B9BDC6"),
  tall_lt35: S("35m 미만", "#CBD5E1"),
  tall_unknown: S("높이 미상", "#B9BDC6"),
  low_le12: S("12m 이하", "#4C956C"),
  low_le12_est: S("[추정] 12m 이하", "#4C956C"),
  low_assumed_1f_est: S("1층 가정(추정)", "#B9BDC6"),
  low_gt12: S("12m 초과", "#C76D8B"),
  low_unknown: S("높이 미상", "#B9BDC6"),
  bldg_assumed_1f: S("1층 가정(추정)", "#B9BDC6"),
  bldg_assumed_1f_est: S("1층 가정(추정)", "#B9BDC6"),
  green_zone: flatPolygon("그 밖의 녹지", "#BFE3A5", undefined, LEGEND_GROUPS.a04GreenSpace, 1),
  green_parcel: flatPolygon("그 밖의 녹지", "#BFE3A5", undefined, LEGEND_GROUPS.a04GreenSpace, 1),
  water_parcel: flatPolygon("하천·수면", "#A8D5F0", undefined, LEGEND_GROUPS.a04GreenSpace, 2),
  park_nearest: {
    ...flatPolygon("최근접 공원", "#6CC24A", "weight", LEGEND_GROUPS.a04GreenSpace, 3),
    stroke: "#2F6B1F",
    strokeWidth: 2.4,
    showInLegend: true,
  },
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
  "jimok:site": S("지목 · 대지", "#E3B65C", undefined, LEGEND_GROUPS.d19Jimok, 0),
  "jimok:road": S("지목 · 도로", "#8C939E", undefined, LEGEND_GROUPS.d19Jimok, 1),
  "jimok:field": S("지목 · 전답", "#B5CF6B", undefined, LEGEND_GROUPS.d19Jimok, 2),
  "jimok:forest": S("지목 · 임야", "#3F7D4E", undefined, LEGEND_GROUPS.d19Jimok, 3),
  "jimok:water": S("지목 · 하천·구거", "#4F8FC9", undefined, LEGEND_GROUPS.d19Jimok, 4),
  "jimok:other": S("지목 · 기타", "#C9C0D6", undefined, LEGEND_GROUPS.d19Jimok, 5),
  "maint_stage:정비계획": { ...S("정비사업 · 정비계획", "#EBA3C4"), stroke: "#A6386C", strokeWidth: 1.5 },
  "maint_area:모아타운": { ...S("모아타운 관리지역", "#167A80"), fillOpacity: 0.06, stroke: "#167A80", strokeWidth: 1.8 },
  "maint_area:재정비촉진지구": { ...S("재정비촉진지구", "#986117"), fillOpacity: 0.06, stroke: "#986117", strokeWidth: 1.8 },
  "maint_stage:구역지정": S("정비사업 · 구역지정", "#D6478A"),
  "maint_stage:추진위": S("정비사업 · 추진위", "#C05A8A"),
  "maint_stage:조합": S("정비사업 · 조합", "#A84C7B"),
  "maint_stage:사업시행": S("정비사업 · 사업시행", "#8F3F6D"),
  "maint_stage:관리처분": S("정비사업 · 관리처분", "#77365F"),
  "maint_stage:착공": S("정비사업 · 착공", "#5F2E52"),
  "maint_stage:준공": S("정비사업 · 준공", "#4A2545"),
  // 회색 채움만으로는 바탕 지도의 단지와 구분되지 않아 정비구역 색 테두리로 형태를 보인다(화면·PPT 공통 stroke).
  "maint_stage:미확인": { ...S("정비사업 · 미확인", "#B9BDC6"), stroke: "#D6478A", strokeWidth: 1.5 },
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
  dens_0: { ...S("건물 없음", "#64748B", "weight", LEGEND_GROUPS.d16Density, 0), fill: "none", stroke: "#64748B", fillOpacity: 0, strokeWidth: 0.8 },
  dens_q1: S("하위 20%", "#CFE8E6", "weight", LEGEND_GROUPS.d16Density, 1),
  dens_q2: S("20~40%", "#9CCFCB", "weight", LEGEND_GROUPS.d16Density, 2),
  dens_q3: S("40~60%", "#63B0AB", "weight", LEGEND_GROUPS.d16Density, 3),
  dens_q4: S("60~80%", "#2B8C88", "weight", LEGEND_GROUPS.d16Density, 4),
  dens_q5: S("상위 20%", "#125C5A", "weight", LEGEND_GROUPS.d16Density, 5),
  relief_lt_m20: S("중심 대비 −20m 미만", "#6B4F3A"),
  relief_m20_m5: S("−20~−5m", "#9A6B46"),
  relief_m5_5: S("−5~5m", "#C7A66A"),
  relief_5_20: S("5~20m", "#8AA56F"),
  relief_ge20: S("20m 이상", "#4F7D58"),
  dem_nodata: S("지형 결측", "#B9BDC6"),
  contour: { label: "등고선", color: "#8a5a2e", strokeWidth: 1 },
  topo_coverage: { label: "수치지형도 범위 · 밖은 기존 자료", color: "#2350b8", fill: "none", stroke: "#2350b8", fillOpacity: 0, strokeWidth: 1.5, dash: "10 6", legendSwatch: "polygon" },
  // The casing is the second dark edge of the retaining-wall symbol; the map
  // renderer already draws it underneath the main stroke.
  retaining_wall: { label: "옹벽", color: "#3d3f45", strokeWidth: 3, casing: "#15171c", tickMarks: true, lineSwatch: true },
  cut_fill: { label: "절성토", color: "#b25a1e", strokeWidth: 1.5, dash: "6 3", lineSwatch: true },
  fence: { label: "울타리", color: "#2e6b3a", strokeWidth: 1.25, dash: "1 3", lineCap: "round", lineSwatch: true },
  terrain_section_a: { label: "단면 A–A′ (동서)", color: "#2350b8", strokeWidth: 2.25, lineSwatch: true },
  terrain_section_b: { label: "단면 B–B′ (남북)", color: "#2350b8", strokeWidth: 1.75, dash: "7 5", lineSwatch: true },
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
  rent_jeonse_q1: S("전세 ㎡당 하위 20%", "#BFD7F5", "weight", LEGEND_GROUPS.rentJeonseQuantiles, 0),
  rent_jeonse_q2: S("전세 ㎡당 20~40%", "#8FB8EC", "weight", LEGEND_GROUPS.rentJeonseQuantiles, 1),
  rent_jeonse_q3: S("전세 ㎡당 40~60%", "#5C97E0", "weight", LEGEND_GROUPS.rentJeonseQuantiles, 2),
  rent_jeonse_q4: S("전세 ㎡당 60~80%", "#2F6FDB", "weight", LEGEND_GROUPS.rentJeonseQuantiles, 3),
  rent_jeonse_q5: S("전세 ㎡당 상위 20%", "#1B3F8F", "weight", LEGEND_GROUPS.rentJeonseQuantiles, 4),
  rent_jeonse_missing: S("전세 자료 부족", "#94A3B8", "weight", LEGEND_GROUPS.rentJeonseQuantiles, 5),
  rent_monthly_q1: S("월세 하위 20%", "#BFD7F5", "weight", LEGEND_GROUPS.rentMonthlyQuantiles, 0),
  rent_monthly_q2: S("월세 20~40%", "#8FB8EC", "weight", LEGEND_GROUPS.rentMonthlyQuantiles, 1),
  rent_monthly_q3: S("월세 40~60%", "#5C97E0", "weight", LEGEND_GROUPS.rentMonthlyQuantiles, 2),
  rent_monthly_q4: S("월세 60~80%", "#2F6FDB", "weight", LEGEND_GROUPS.rentMonthlyQuantiles, 3),
  rent_monthly_q5: S("월세 상위 20%", "#1B3F8F", "weight", LEGEND_GROUPS.rentMonthlyQuantiles, 4),
  rent_monthly_missing: S("월세 자료 부족", "#94A3B8", "weight", LEGEND_GROUPS.rentMonthlyQuantiles, 5),
  rent_district_jeonse_q1: districtPolygon("전세 법정동 평균 ㎡당 1단계", "#BFD7F5", LEGEND_GROUPS.rentJeonseDistrict, 0),
  rent_district_jeonse_q2: districtPolygon("전세 법정동 평균 ㎡당 2단계", "#8FB8EC", LEGEND_GROUPS.rentJeonseDistrict, 1),
  rent_district_jeonse_q3: districtPolygon("전세 법정동 평균 ㎡당 3단계", "#5C97E0", LEGEND_GROUPS.rentJeonseDistrict, 2),
  rent_district_jeonse_q4: districtPolygon("전세 법정동 평균 ㎡당 4단계", "#2F6FDB", LEGEND_GROUPS.rentJeonseDistrict, 3),
  rent_district_jeonse_q5: districtPolygon("전세 법정동 평균 ㎡당 5단계", "#1B3F8F", LEGEND_GROUPS.rentJeonseDistrict, 4),
  rent_district_jeonse_missing: districtMissingPolygon("전세 법정동 자료 부족", LEGEND_GROUPS.rentJeonseDistrict, 5),
  rent_district_monthly_q1: districtPolygon("월세 법정동 평균 1단계", "#BFD7F5", LEGEND_GROUPS.rentMonthlyDistrict, 0),
  rent_district_monthly_q2: districtPolygon("월세 법정동 평균 2단계", "#8FB8EC", LEGEND_GROUPS.rentMonthlyDistrict, 1),
  rent_district_monthly_q3: districtPolygon("월세 법정동 평균 3단계", "#5C97E0", LEGEND_GROUPS.rentMonthlyDistrict, 2),
  rent_district_monthly_q4: districtPolygon("월세 법정동 평균 4단계", "#2F6FDB", LEGEND_GROUPS.rentMonthlyDistrict, 3),
  rent_district_monthly_q5: districtPolygon("월세 법정동 평균 5단계", "#1B3F8F", LEGEND_GROUPS.rentMonthlyDistrict, 4),
  rent_district_monthly_missing: districtMissingPolygon("월세 법정동 자료 부족", LEGEND_GROUPS.rentMonthlyDistrict, 5),
  walk_route: S("보행 경로", "#7A5BA6", undefined, LEGEND_GROUPS.a04GreenSpace, 4),
  canopy: S("수관", "#2E7D32"),
  osm_green: S("OSM 녹지", "#5FAE5B"),
  osm_water: S("OSM 수계", "#4F9DA6"),
  walk_5: S("도보 5분", "#4D9D7E"),
  walk_10: S("도보 10분", "#8FC9B3"),
  walk_15: S("도보 15분", "#CDE8DC"),
  walk_net: { label: "보행망", color: "#5AA88E", strokeWidth: 0.75, opacity: 0.55 },
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

const LEGEND_GROUP_STYLES = new Map<string, Array<{ layer: string; style: LayerStyle }>>();
for (const [layer, style] of Object.entries(LAYER_STYLES)) {
  if (!style.legendGroup) continue;
  const entries = LEGEND_GROUP_STYLES.get(style.legendGroup) ?? [];
  entries.push({ layer, style });
  LEGEND_GROUP_STYLES.set(style.legendGroup, entries);
}
for (const entries of LEGEND_GROUP_STYLES.values()) {
  entries.sort((a, b) => (a.style.legendOrder ?? Number.POSITIVE_INFINITY) - (b.style.legendOrder ?? Number.POSITIVE_INFINITY));
}

/** 지물이 있는 레이어의 범례 항목 (정의된 순서) */
export type MapLegendLayerItem = {
  layer: string;
  label: string;
  color: string;
  colors?: string[];
  badge?: string;
  symbol?: "rail-axis" | "rail-exit";
  legendSwatch?: "line" | "polygon";
  fill?: string;
  stroke?: string;
  fillOpacity?: number;
  lineSwatch?: boolean;
  strokeWidth?: number;
  dash?: string;
  lineCap?: "butt" | "round" | "square";
  tickMarks?: boolean;
  casing?: string;
  highlight: boolean;
};

const lineLegendStyle = (style: LayerStyle): Pick<MapLegendLayerItem, "legendSwatch" | "fill" | "stroke" | "fillOpacity" | "lineSwatch" | "strokeWidth" | "dash" | "lineCap" | "tickMarks" | "casing"> => {
  if (style.legendSwatch === "polygon") {
    return {
      legendSwatch: "polygon",
      ...(style.fill === undefined ? {} : { fill: style.fill }),
      ...(style.stroke === undefined ? {} : { stroke: style.stroke }),
      ...(style.fillOpacity === undefined ? {} : { fillOpacity: style.fillOpacity }),
      ...(style.strokeWidth === undefined ? {} : { strokeWidth: style.strokeWidth }),
      ...(style.dash === undefined ? {} : { dash: style.dash }),
    };
  }
  if (!style.lineSwatch) return {};
  return {
    lineSwatch: true,
    ...(style.strokeWidth === undefined ? {} : { strokeWidth: style.strokeWidth }),
    ...(style.dash === undefined ? {} : { dash: style.dash }),
    ...(style.lineCap === undefined ? {} : { lineCap: style.lineCap }),
    ...(style.tickMarks === undefined ? {} : { tickMarks: style.tickMarks }),
    ...(style.casing === undefined ? {} : { casing: style.casing }),
  };
};

const TOPO_STEP_LAYERS = new Set(["retaining_wall", "cut_fill", "fence"]);
const lineLegendStyleForModel = (style: LayerStyle, layer: string, model: MapModel): Pick<MapLegendLayerItem, "legendSwatch" | "fill" | "stroke" | "fillOpacity" | "lineSwatch" | "strokeWidth" | "dash" | "lineCap" | "tickMarks" | "casing"> => {
  const hasTopoSupplement = (model.lines ?? []).some((line) => TOPO_STEP_LAYERS.has(line.layer));
  if (layer === "contour" && hasTopoSupplement) return { lineSwatch: true, strokeWidth: style.strokeWidth ?? 1 };
  return lineLegendStyle(style);
};

export const legendItems = (model: MapModel): MapLegendLayerItem[] => {
  const present = new Set([
    ...model.features.map((feature) => feature.layer).filter((layer) => !layer.endsWith("_nearest") || LAYER_STYLES[layer]?.showInLegend === true),
    ...(model.polygons ?? []).map((polygon) => polygon.layer).filter((layer) => !layer.endsWith("_nearest") || LAYER_STYLES[layer]?.showInLegend === true),
    ...(model.lines ?? []).map((line) => line.layer).filter((layer) => !layer.endsWith("_nearest") || LAYER_STYLES[layer]?.showInLegend === true),
  ]);
  const highlightedLabels = new Set(
    model.features.filter((feature) => feature.highlight && !feature.layer.endsWith("_nearest")).map((feature) => layerStyle(feature.layer).label),
  );
  const lineColorsByLabel = new Map<string, string[]>();
  const dynamicRailItems: Array<{ layer: string; label: string; color: string; badge?: string; highlight: boolean; colors?: string[] }> = [];
  const dynamicRailLabels = new Set<string>();
  for (const line of model.lines ?? []) {
    if (!line.color || !/^#[0-9A-Fa-f]{6}$/.test(line.color)) continue;
    if (line.legendLabel && (line.layer === "rail_line" || line.layer === "rail_station_axis") && !dynamicRailLabels.has(line.legendLabel)) {
      dynamicRailLabels.add(line.legendLabel);
      // 범례 배지는 숫자 호선만 — 이름 호선은 옆 글자가 이미 이름이라 색 점으로 둔다.
      const badge = railLineBadgeText(line.legendLabel);
      dynamicRailItems.push({ layer: line.layer, label: line.legendLabel, color: line.color, ...(/^\d+$/.test(badge) ? { badge } : {}), highlight: false });
    }
    const label = layerStyle(line.layer).label;
    const colors = lineColorsByLabel.get(label) ?? [];
    if (!colors.includes(line.color)) colors.push(line.color);
    lineColorsByLabel.set(label, colors);
  }
  const seenLabels = new Set<string>();
  let dynamicRailInserted = false;
  return Object.keys(LAYER_STYLES).flatMap((layer) => {
    if (layer === "rail_line" && dynamicRailItems.length > 0) {
      dynamicRailInserted = true;
      return dynamicRailItems;
    }
    if (layer === "rail_station_axis" && dynamicRailInserted) return [];
    if (!present.has(layer)) return [];
    const style = modelLayerStyle(model, layer);
    if (seenLabels.has(style.label)) return [];
    seenLabels.add(style.label);
    const colors = lineColorsByLabel.get(style.label) ?? [];
    return [{
      layer,
      label: style.label,
      color: colors[0] ?? style.color,
      ...(colors.length > 0 ? { colors } : {}),
      ...(layer === "rail_station" || layer === "rail_nearest"
        ? { symbol: "rail-axis" as const }
        : layer === "rail_entrance" ? { symbol: "rail-exit" as const } : {}),
      ...lineLegendStyleForModel(style, layer, model),
      badge: undefined,
      highlight: highlightedLabels.has(style.label),
    }];
  });
};

const formatLegendNumber = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
};

/** A07처럼 엔진 라벨이 분위만 말하는 범례에 실제 단가 경계를 덧붙인다. */
export function presentationLegendLabel(entry: TileResult["presentation"]["legend"][number]): string {
  const label = entry.label.trim();
  const min = entry.min === null ? null : formatLegendNumber(entry.min);
  const max = entry.max === null ? null : formatLegendNumber(entry.max);
  if (label.startsWith("월세 ") && !label.includes("만원/월")) {
    const range = min === null && max !== null
      ? `~${max}만원/월`
      : min !== null && max === null
        ? `${min}만원/월 이상`
        : min !== null && max !== null
          ? `${min}~${max}만원/월`
          : null;
    return range ? `${label} · ${range}` : label;
  }
  if (!label.includes("㎡당") || label.includes("만원/㎡")) return label;
  const range = min === null && max !== null
    ? `~${max}만원/㎡`
    : min !== null && max === null
      ? `${min}만원/㎡ 이상`
      : min !== null && max !== null
        ? `${min}~${max}만원/㎡`
        : null;
  return range ? `${label} · ${range}` : label;
}

/** 엔진 범례와 화면 레이어를 같은 순서로 연결한 하단 띠용 항목. */
type PresentedLegendLayerItem = MapLegendLayerItem & { id: string; highlightLabel: string };

function reorderMappedLegendGroups(items: PresentedLegendLayerItem[]): PresentedLegendLayerItem[] {
  const indicesByGroup = new Map<string, number[]>();
  for (const [index, item] of items.entries()) {
    const group = LAYER_STYLES[item.layer]?.legendGroup;
    if (!group) continue;
    const indices = indicesByGroup.get(group) ?? [];
    indices.push(index);
    indicesByGroup.set(group, indices);
  }

  const reordered = [...items];
  for (const indices of indicesByGroup.values()) {
    const sorted = indices
      .map((index) => ({ index, item: items[index]! }))
      .sort((a, b) => (LAYER_STYLES[a.item.layer]?.legendOrder ?? Number.POSITIVE_INFINITY)
        - (LAYER_STYLES[b.item.layer]?.legendOrder ?? Number.POSITIVE_INFINITY)
        || a.index - b.index)
      .map(({ item }) => item);
    indices.forEach((index, position) => {
      reordered[index] = sorted[position]!;
    });
  }
  return reordered;
}

export function legendItemsForModel(model: MapModel, limit = Number.POSITIVE_INFINITY): MapLegendLayerItem[] {
  // 같은 표시명을 가진 벡터 면과 래스터(특히 D10 canopy)는 띠에서 한 칸으로 합친다.
  // 래스터 항목은 MapBox가 별도로 추가하므로 여기서는 정적 벡터 항목을 제외한다.
  const rasterLabels = new Set(
    (model.rasters ?? [])
      .map((raster) => RASTER_STYLES[raster.palette]?.label)
      .filter((label): label is string => typeof label === "string" && label.length > 0),
  );
  const staticItems = legendItems(model).filter((item) => !rasterLabels.has(item.label));
  const engineLegend = model.legend ?? [];
  const orderedStatic = compactLegendItems(model, Number.POSITIVE_INFINITY)
    .filter((item) => !rasterLabels.has(item.label))
    .map(({ count: _count, order: _order, ...item }) => item);
  if (engineLegend.length === 0 || staticItems.length === 0) return orderedStatic.slice(0, Math.max(0, limit));
  const staticByLabel = new Map(staticItems.map((item) => [item.label, item]));
  // D16처럼 순수 벡터 엔진이 단위를 덧붙인 경우에는 정의된 순서가
  // 유일한 연결 근거다. 정적 항목이 빠진 순서형 묶음도 LayerStyle 메타데이터로 복원한다.
  const allowIndexFallback = !model.rasters?.length && engineLegend.length === staticItems.length;
  const groupFallbacks = !model.rasters?.length
    ? [...LEGEND_GROUP_STYLES.values()].filter((entries) => entries.length === engineLegend.length
      && entries.some(({ layer }) => staticItems.some((item) => item.layer === layer))
      && staticItems.every((item) => LAYER_STYLES[item.layer]?.legendGroup === entries[0]?.style.legendGroup))
    : [];
  const orderedGroup = groupFallbacks.length === 1 ? groupFallbacks[0] : undefined;
  const itemForLayer = (layer: string): MapLegendLayerItem | undefined => {
    const existing = staticItems.find((item) => item.layer === layer);
    if (existing) return existing;
    const style = LAYER_STYLES[layer] ? modelLayerStyle(model, layer) : undefined;
    return style ? { layer, label: style.label, color: style.color, ...lineLegendStyleForModel(style, layer, model), highlight: false } : undefined;
  };
  const seenDisplayLabels = new Set<string>();
  const mapped: PresentedLegendLayerItem[] = engineLegend.flatMap((entry, index) => {
      // A07 엔진 라벨은 정적 분위 라벨과 일치한다. 그 밖의 경계 범례는
      // 엔진 배열 순서를 공용 레이어 순서와 맞추되, 표시 라벨과 강조 키를 분리한다.
      const displayLabel = presentationLegendLabel(entry);
      if (seenDisplayLabels.has(displayLabel)) return [];
      seenDisplayLabels.add(displayLabel);
      const item = staticByLabel.get(entry.label.trim())
        ?? (orderedGroup ? itemForLayer(orderedGroup[index]?.layer ?? "") : undefined)
        ?? (allowIndexFallback ? staticItems[index] : undefined);
      return item ? [{ ...item, id: `${item.layer}:legend-${index}`, label: displayLabel, highlightLabel: item.label }] : [];
    });
  const orderedMapped = reorderMappedLegendGroups(mapped);
  // 래스터 경계가 섞인 엔진 범례에서는 벡터 레이어를 배열 위치로 추측하지 않는다.
  // 매칭되지 않은 벡터 항목(예: S03의 유입 방향)은 뒤에 한 번만 남긴다.
  const remainder = orderedStatic.filter((item) => !orderedMapped.some((mappedItem) => mappedItem.highlightLabel === item.label));
  return [...orderedMapped, ...remainder].slice(0, Math.max(0, limit));
}

const legendKeyPart = (value: string): string => value.replace(/[|\r\n]/g, "-").slice(0, 90);

/** 보고서·미리보기에서 공유하는 범례 항목 키. 대지 표식은 지도 범례의 데이터 항목이 아니므로 제외한다. */
export function legendItemsOf(model: MapModel): Array<{ key: string; label: string }> {
  const code = legendKeyPart(model.tileCode?.trim() || "map");
  return legendItemsForModel(model).map((item) => ({ key: `legend-${code}-${legendKeyPart(item.label)}`, label: item.label }));
}

/** 저장된 legendFocus 키를 현재 지도에 표시할 범례 라벨로 해석한다. 라벨 자체도 호환한다. */
export function legendLabelOf(model: MapModel, key: string | null | undefined): string | null {
  if (!key) return null;
  return legendItemsOf(model).find((item) => item.key === key)?.label
    ?? legendItemsForModel(model).find((item) => item.label === key)?.label
    ?? null;
}

type LegendStripLabelItem = { label: string; highlightLabel?: string };
export type LegendStripLabelResult<T extends LegendStripLabelItem> = {
  /** MapLegendStrip.leadingLabel에 전달할 공통 접두. 없으면 null이다. */
  leadingLabel: string | null;
  /** 입력 항목을 복사해 접두를 제거한 값 라벨을 담는다. */
  items: T[];
};

function splitLegendStripLabel(label: string): { prefix: string; value: string } | null {
  // 라벨 계약은 `이름 · 값`(공백 포함)이다. `임야·공원`처럼 붙은 가운뎃점은 이름의 일부다.
  const trimmed = label.trim();
  const separator = trimmed.indexOf(" · ");
  if (separator <= 0) return null;
  const prefix = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 3).trim();
  return prefix && value ? { prefix, value } : null;
}

/** 범례 항목 일부에 반복되는 `접두 · 값`을 띠 제목과 값 라벨로 분리한다. */
export function normalizeLegendStripLabels<T extends LegendStripLabelItem>(items: readonly T[]): LegendStripLabelResult<T> {
  if (items.length < 2) return { leadingLabel: null, items: [...items] };
  const parts = items.map((item) => splitLegendStripLabel(item.label));
  const counts = new Map<string, { count: number; first: number }>();
  parts.forEach((part, index) => {
    if (!part) return;
    const current = counts.get(part.prefix);
    counts.set(part.prefix, { count: (current?.count ?? 0) + 1, first: current?.first ?? index });
  });
  const prefix = [...counts.entries()]
    .filter(([, value]) => value.count >= 2)
    .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)[0]?.[0];
  if (!prefix) return { leadingLabel: null, items: [...items] };
  return {
    leadingLabel: prefix,
    items: items.map((item, index) => ({
      ...item,
      ...(parts[index]?.prefix === prefix ? {
        label: parts[index]!.value,
        ...(item.highlightLabel === undefined ? { highlightLabel: item.label } : {}),
      } : {}),
    })),
  };
}

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
  const items = legendItems(model).map((item, order) => ({ ...item, count: counts.get(item.label) ?? 0, order }));
  const groupCount = new Map<string, number>();
  const groupOrder = new Map<string, number>();
  for (const item of items) {
    const group = LAYER_STYLES[item.layer]?.legendGroup ?? `layer:${item.layer}`;
    groupCount.set(group, Math.max(groupCount.get(group) ?? 0, item.count));
    const definedOrder = LAYER_STYLES[item.layer]?.legendOrder ?? item.order;
    groupOrder.set(group, Math.min(groupOrder.get(group) ?? Number.POSITIVE_INFINITY, definedOrder));
  }
  return items
    .sort((a, b) => Number(b.highlight) - Number(a.highlight)
      || groupCount.get(LAYER_STYLES[b.layer]?.legendGroup ?? `layer:${b.layer}`)! - groupCount.get(LAYER_STYLES[a.layer]?.legendGroup ?? `layer:${a.layer}`)!
      || groupOrder.get(LAYER_STYLES[a.layer]?.legendGroup ?? `layer:${a.layer}`)! - groupOrder.get(LAYER_STYLES[b.layer]?.legendGroup ?? `layer:${b.layer}`)!
      || (LAYER_STYLES[a.layer]?.legendOrder ?? a.order) - (LAYER_STYLES[b.layer]?.legendOrder ?? b.order))
    .slice(0, Math.max(0, limit));
}

export const layerStyle =(layer: string): LayerStyle => LAYER_STYLES[layer] ?? FALLBACK;

const hiddenLayer = (layer: string, hidden: readonly string[]): boolean => hidden.includes(layer) || hidden.includes(layerStyle(layer).label);

/** 보고서 쪽이 끈 레이어(id 또는 표시명)를 뺀 모델. 끈 것이 없으면 같은 모델. 화면·그래프 자료가 쪽이 실제로 그리는 지도를 같게 얻는다. */
export function modelWithHiddenLayers<M extends MapModel>(model: M, hidden: readonly string[]): M {
  if (hidden.length === 0) return model;
  return {
    ...model,
    features: model.features.filter((feature) => !hiddenLayer(feature.layer, hidden)),
    polygons: model.polygons?.filter((polygon) => !hiddenLayer(polygon.layer, hidden)),
    lines: model.lines?.filter((line) => !hiddenLayer(line.layer, hidden)),
  };
}

/** 모델의 다이어그램 팔레트를 입힌 레이어 스타일. 팔레트가 없으면 layerStyle과 같은 객체. */
export const modelLayerStyle = (model: Pick<MapModel, "palette"> | null | undefined, layer: string): LayerStyle =>
  paletteLayerStyle(layer, layerStyle(layer), model?.palette);

export const isBuildingLayer = (layer: string): boolean => layer === "building" || layer === "svf_building" || layer.startsWith("bldg_") || layer.includes("building");

/** 반경 원으로 자르지 않고 원래 형태 그대로 그리는 구역 경계 레이어(사용자 결정 2026-10-28). PPT는 원래 반경으로 자르지 않는다. */
export const isUnclippedZoneLayer = (layer: string): boolean => /^maint_(stage|area):/.test(layer);

/** 지도와 범례 견본이 같은 래스터 준비 조건·건물 중립 스타일을 공유한다. */
export function buildingStyleForRaster(layer: string, rasterDecoded: boolean): LayerStyle {
  const style = layerStyle(layer);
  return rasterDecoded && isBuildingLayer(layer) ? { ...style, ...NEUTRAL_BUILDING_STYLE } : style;
}

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
  color: string;
  /** weight로 원 크기(√비례)를 정한다. 아니면 작은 점 */
  sizeBy?: "weight";
  /** 면 지물의 채움·테두리. 없으면 color를 둘 다 쓴다. */
  fill?: string;
  stroke?: string;
  fillOpacity?: number;
  strokeWidth?: number;
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

const S = (label: string, color: string, sizeBy?: "weight"): LayerStyle => ({ label, color, sizeBy });

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
  rail_line: S("철도 노선", "#1F5FA8"),
  rail_nearest: S("최근접 역", "#1F5FA8"),
  school_elem: S("초등학교", "#E5A11C"),
  school_middle: S("중학교", "#D9822B"),
  school_high: S("고등학교", "#B5651D"),
  school_nearest: S("최근접 초등학교", "#E5A11C"),
  school_zone_elem: S("초등 통학구역", "#F2B84B"),
  school_zone_elem_site: S("대상 초등 통학구역", "#C56A00"),
  school_zone_middle: S("중학교 학교군", "#E09A4E"),
  school_zone_middle_site: S("대상 중학교 학교군", "#A84C1A"),
  school_zone_high: S("고등학교 학교군", "#C77A3A"),
  school_zone_high_site: S("대상 고등학교 학교군", "#7D3615"),
  planned_rail_line: S("계획 철도 선형(개략)", "#8A5BC7"),
  planned_rail_station: S("계획역", "#8A5BC7"),
  "road:고속도로": S("고속도로", "#8D3B2F"),
  "road:간선": S("간선", "#C45A36"),
  "road:보조간선": S("보조간선", "#D88B38"),
  "road:집산": S("집산", "#5F8F6A"),
  "road:국지": S("국지", "#7BA68A"),
  "road:보행·자전거": S("보행·자전거", "#4F8A9E"),
  "road:기타": S("도로 기타", "#9AA0AA"),
  pop_grid_q1: S("인구밀도 하위 20% 격자", "#CFE8E6", "weight"),
  pop_grid_q2: S("인구밀도 20~40% 격자", "#9CCFCB", "weight"),
  pop_grid_q3: S("인구밀도 40~60% 격자", "#63B0AB", "weight"),
  pop_grid_q4: S("인구밀도 60~80% 격자", "#2B8C88", "weight"),
  pop_grid_q5: S("인구밀도 상위 20% 격자", "#125C5A", "weight"),
  pop_grid_na: S("인구 비공개 격자", "#B9BDC6"),
  park: S("공원 대표점", "#5C9A3C", "weight"),
  park_nearest: S("최근접 공원", "#2F7A1E", "weight"),
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
  ...Object.fromEntries(
    (
      [["주거", "#F2C94C"], ["상업", "#E05A47"], ["공업", "#8E7CC3"], ["녹지", "#5FAE5B"], ["관리", "#A8C66C"], ["농림", "#7FB77E"], ["자연환경보전", "#2F7A4E"], ["기타", "#B9BDC6"]] as const
    ).flatMap(([c, color]) => [[`zone:${c}`, S(`${c}지역`, color)], [`zone_center:${c}`, S(`${c}지역`, color)]]),
  ),
  bldg_pre1980: S("1979년 이하", STRIP_COLORS[0]),
  bldg_1980s: S("1980년대", STRIP_COLORS[1]),
  bldg_1990s: S("1990년대", STRIP_COLORS[2]),
  bldg_2000s: S("2000년대", STRIP_COLORS[3]),
  bldg_2010s: S("2010년대", STRIP_COLORS[4]),
  bldg_2020s: S("2020년 이상", STRIP_COLORS[5]),
  bldg_unknown: S("미상", STRIP_COLORS[6]),
  bldg_footprint: S("건물 발자국", "#8B5A3C"),
  bldg_point: S("건물(대표점)", "#A0522D"),
  svf_building: { label: "건물 마스크", color: "#64748B", fill: "#CBD5E1", stroke: "#64748B", fillOpacity: 0.86, strokeWidth: 0.75 },
  "use:주거": S("주거", "#D69E2E"),
  "use:근린생활": S("근린생활", "#E07A5F"),
  "use:업무": S("업무", "#6C8EBF"),
  "use:판매": S("판매", "#C76D8B"),
  "use:숙박": S("숙박", "#9B72AA"),
  "use:문화집회": S("문화집회", "#B7791F"),
  "use:교육복지": S("교육복지", "#4C956C"),
  "use:공업": S("공업", "#718096"),
  "use:기타": S("기타", "#A0AEC0"),
  "use:미상": S("용도 미상", "#CBD5E0"),
  floors_1_4: S("1~4층", "#B8D8BA"),
  floors_5_8: S("5~8층", "#86BBD8"),
  floors_9_14: S("9~14층", "#5C80BC"),
  floors_15_25: S("15~25층", "#775DA6"),
  floors_26p: S("26층 이상", "#4A2545"),
  floors_unknown: S("층수 미상", "#B9BDC6"),
  tall_ge35: S("35m 이상", "#AA4465"),
  tall_ge35_est: S("[추정] 35m 이상", "#AA4465"),
  tall_lt35: S("35m 미만", "#6C8EBF"),
  tall_unknown: S("높이 미상", "#B9BDC6"),
  low_le12: S("12m 이하", "#4C956C"),
  low_le12_est: S("[추정] 12m 이하", "#4C956C"),
  low_gt12: S("12m 초과", "#C76D8B"),
  low_unknown: S("높이 미상", "#B9BDC6"),
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
  "facility:기타": S("도시계획시설 기타", "#B9BDC6"),
  parcel: S("필지", "#B07D4F"),
  parcel_site: S("대상 필지", "#D1495B"),
  lot_lt100: S("100㎡ 미만", "#D9A441"),
  lot_100_300: S("100~300㎡", "#C47F3A"),
  lot_300_1000: S("300~1,000㎡", "#A95C3B"),
  lot_1000_3000: S("1,000~3,000㎡", "#814C5A"),
  lot_ge3000: S("3,000㎡ 이상", "#5B3A70"),
  lot_road_water: S("도로·하천 지목", "#4F9DA6"),
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
  block_open: S("미폐합", "#9AA0AA"),
  dens_0: S("0", "#F0F4F8", "weight"),
  dens_q1: S("하위 20%", "#CFE8E6", "weight"),
  dens_q2: S("20~40%", "#9CCFCB", "weight"),
  dens_q3: S("40~60%", "#63B0AB", "weight"),
  dens_q4: S("60~80%", "#2B8C88", "weight"),
  dens_q5: S("상위 20%", "#125C5A", "weight"),
  relief_lt_m20: S("−20m 미만", "#6B4F3A"),
  relief_m20_m5: S("−20~−5m", "#9A6B46"),
  relief_m5_5: S("−5~5m", "#C7A66A"),
  relief_5_20: S("5~20m", "#8AA56F"),
  relief_ge20: S("20m 이상", "#4F7D58"),
  dem_nodata: S("지형 결측", "#B9BDC6"),
  contour: S("등고선", "#4B5563"),
  slope_0_5: S("0~5°", "#E6E2F4"),
  slope_5_10: S("5~10°", "#C4B9E4"),
  slope_10_15: S("10~15°", "#9D8BC8"),
  slope_15_20: S("15~20°", "#765EA8"),
  slope_ge20: S("20° 이상", "#4A3575"),
  slope_nodata: S("경사 결측", "#B9BDC6"),
  sun_0: S("0시간", "#F0F4F8"),
  sun_0_2: S("0 초과~2시간", "#F9D976"),
  sun_2_4: S("2~4시간", "#F4BA45"),
  sun_4_6: S("4~6시간", "#EC8E2F"),
  sun_6_8: S("6~8시간", "#D85B2A"),
  sun_ge8: S("8시간 이상", "#A93D27"),
  sun_uncalc: S("미계산", "#B9BDC6"),
  sun_face: S("수광면", "#F08A24"),
  shadow_09: S("09:00 그림자", "#6D7580"),
  shadow_12: S("12:00 그림자", "#535A65"),
  shadow_15: S("15:00 그림자", "#383E48"),
  rent_jeonse: S("전세 거래 지점", "#2B6CB0", "weight"),
  rent_monthly: S("월세 거래 지점", "#63B3ED", "weight"),
  walk_route: S("보행 경로", "#7A5BA6"),
  canopy: S("수관", "#2E7D32"),
  osm_green: S("OSM 녹지 면", "#5FAE5B"),
  osm_water: S("OSM 수계 면", "#4F9DA6"),
  walk_5: S("도보 5분", "#4D9D7E"),
  walk_10: S("도보 10분", "#8FC9B3"),
  walk_15: S("도보 15분", "#CDE8DC"),
  walk_net: S("보행망", "#5AA88E"),
  wind_inflow: S("유입 방향", "#2B9CBF"),
};

/** 래스터의 값→색 규칙. 실제 픽셀화는 ui/raster-image.ts가 담당한다. */
export const RASTER_STYLES: Record<string, RasterStyle> = {
  sun_hours: {
    mode: "stepped",
    colors: ["#18234C", "#243B70", "#31568D", "#4377A0", "#5E96A7", "#82B39C", "#B5C57C", "#D9C65E", "#F0B545", "#F39A31", "#F47A26", "#F05A21", "#E83D1D"],
    breaks: Array.from({ length: 12 }, (_, i) => i + 1),
    label: "일조시간",
  },
  shade_mask: { mode: "mask", colors: ["#3D4A63"], opacity: 0.55, label: "그림자" },
  shade_flow: { mode: "continuous", colors: ["#22304C", "#586B89", "#B7C4D7"], min: 0, max: 1, label: "그림자 흐름" },
  wind_ratio: { mode: "continuous", colors: ["#440154", "#31688E", "#35B779", "#FDE725"], min: 0, max: 1.2, label: "U/U유입" },
  utci: { mode: "stepped", colors: ["#313695", "#4575B4", "#74ADD1", "#ABD9E9", "#66BD63", "#1A9850", "#FEE08B", "#FDAE61", "#F46D43", "#D73027"], breaks: [9, 26, 32, 38, 46], label: "UTCI" },
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
    ...model.features.map((feature) => feature.layer),
    ...(model.polygons ?? []).map((polygon) => polygon.layer),
    ...(model.lines ?? []).map((line) => line.layer),
  ]);
  const seenLabels = new Set<string>();
  return Object.keys(LAYER_STYLES).flatMap((layer) => {
    if (!present.has(layer)) return [];
    const style = LAYER_STYLES[layer];
    if (seenLabels.has(style.label)) return [];
    seenLabels.add(style.label);
    return [{ layer, label: style.label, color: style.color }];
  });
};

/** 카드 지도처럼 공간이 좁을 때, 실제로 가장 많이 그린 레이어만 남긴 미니 범례. */
export function compactLegendItems(model: MapModel, limit = 3) {
  const counts = new Map<string, number>();
  const add = (layer: string) => {
    const label = LAYER_STYLES[layer]?.label;
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  };
  for (const f of model.features) add(f.layer);
  for (const p of model.polygons ?? []) add(p.layer);
  for (const l of model.lines ?? []) add(l.layer);
  return legendItems(model)
    .map((item, order) => ({ ...item, count: counts.get(item.label) ?? 0, order }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, Math.max(0, limit));
}

export const layerStyle =(layer: string): LayerStyle => LAYER_STYLES[layer] ?? FALLBACK;

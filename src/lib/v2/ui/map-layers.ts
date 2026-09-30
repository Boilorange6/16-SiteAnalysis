import type { MapFeature } from "../tile-result";

/** MapFigure가 그리는 입력. 카드·상세·PPT가 같은 것을 쓴다. */
export type MapModel = {
  center: readonly [number, number];
  radiusM: number;
  features: MapFeature[];
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
};

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
  planned_rail_line: S("계획 철도 선형(개략)", "#8A5BC7"),
  planned_rail_station: S("계획역", "#8A5BC7"),
  pop_grid_q1: S("인구밀도 하위 20% 격자", "#CFE8E6", "weight"),
  pop_grid_q2: S("인구밀도 20~40% 격자", "#9CCFCB", "weight"),
  pop_grid_q3: S("인구밀도 40~60% 격자", "#63B0AB", "weight"),
  pop_grid_q4: S("인구밀도 60~80% 격자", "#2B8C88", "weight"),
  pop_grid_q5: S("인구밀도 상위 20% 격자", "#125C5A", "weight"),
  pop_grid_na: S("인구 비공개 격자", "#B9BDC6"),
  park: S("공원 대표점", "#5C9A3C", "weight"),
  park_nearest: S("최근접 공원", "#2F7A1E", "weight"),
  apt: S("아파트 단지", "#8C6D5A", "weight"),
  other_housing: S("기타 주거", "#C9A227", "weight"),
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
};
const FALLBACK: LayerStyle = S("기타", "#7A7E87");

export const layerStyle = (layer: string): LayerStyle => LAYER_STYLES[layer] ?? FALLBACK;

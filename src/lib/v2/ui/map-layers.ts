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

/** 준공 연대 색 (지도 점과 구성비 차트가 같이 쓴다). 오래될수록 진하다 */
export const STRIP_COLORS = ["#5b2a12", "#8f4a1f", "#c26a26", "#e08f2e", "#f0b73a", "#f7d76a", "#a9adb6"];

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
  park: S("공원 대표점", "#5C9A3C", "weight"),
  park_nearest: S("최근접 공원", "#2F7A1E", "weight"),
  apt: S("아파트 단지", "#8C6D5A", "weight"),
  other_housing: S("기타 공동주택", "#9AA0AA"),
  officetel: S("오피스텔", "#2B9CBF", "weight"),
  applyhome: S("청약홈", "#D6478A", "weight"),
  move_in: S("입주예정", "#2F6FDB", "weight"),
  bldg_pre1980: S("1979년 이하", STRIP_COLORS[0]),
  bldg_1980s: S("1980년대", STRIP_COLORS[1]),
  bldg_1990s: S("1990년대", STRIP_COLORS[2]),
  bldg_2000s: S("2000년대", STRIP_COLORS[3]),
  bldg_2010s: S("2010년대", STRIP_COLORS[4]),
  bldg_2020s: S("2020년 이상", STRIP_COLORS[5]),
  bldg_unknown: S("미상", STRIP_COLORS[6]),
};
const FALLBACK: LayerStyle = S("기타", "#7A7E87");

/** 지물이 있는 레이어의 범례 항목 (정의된 순서) */
export const legendItems = (model: MapModel) =>
  Object.keys(LAYER_STYLES)
    .filter((k) => model.features.some((f) => f.layer === k))
    .map((k) => ({ layer: k, label: LAYER_STYLES[k].label, color: LAYER_STYLES[k].color }));

export const layerStyle =(layer: string): LayerStyle => LAYER_STYLES[layer] ?? FALLBACK;

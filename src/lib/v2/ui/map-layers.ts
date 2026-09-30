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
  park: S("공원 대표점", "#5C9A3C", "weight"),
  park_nearest: S("최근접 공원", "#2F7A1E", "weight"),
  apt: S("아파트 단지", "#8C6D5A", "weight"),
  other_housing: S("기타 주거", "#C9A227", "weight"),
  officetel: S("오피스텔", "#2B9CBF", "weight"),
  applyhome: S("청약홈", "#D6478A", "weight"),
  move_in: S("입주예정", "#2F6FDB", "weight"),
};
const FALLBACK: LayerStyle = S("기타", "#7A7E87");

export const layerStyle = (layer: string): LayerStyle => LAYER_STYLES[layer] ?? FALLBACK;

/** 벡터 바탕지도 테마 토큰(색·굵기). 순수 데이터 — React·컴포넌트를 가져오지 않는다. */
export type BaseThemeId = "warm" | "cool" | "paper";

export type BaseTheme = {
  id: BaseThemeId;
  /** 사용자 표시명 */
  name: string;
  bg: string;
  building: { fill: string; line: string; lineWidthPx: number };
  /** maxMPerPx보다 더 축소하면(m/px가 크면) 필지선을 생략한다. */
  parcel: { line: string; lineWidthPx: number; opacity: number; maxMPerPx: number };
  road: { fill: string; casing: string; casingM: number; widthScale: number; minWidthPx: number };
  green: { forest: string; park: string; grass: string };
  water: string;
  rail: { widthPx: number; dash: string; opacity: number };
  station: { fill: string; line: string; radiusPx: number };
  label: { road: string; place: string; park: string; station: string; halo: string; fontPx: number };
  site: { fill: string; fillOpacity: number; line: string; lineWidthPx: number; haloPx: number };
};

const COMMON = {
  buildingLineWidthPx: 0.4,
  parcel: { lineWidthPx: 0.6, opacity: 0.7, maxMPerPx: 2.5 },
  road: { casingM: 0.8, widthScale: 1, minWidthPx: 0.6 },
  rail: { widthPx: 1.5, dash: "6 5", opacity: 0.6 },
  station: { fill: "#ffffff", line: "#333333", radiusPx: 3.5 },
  // 라벨 글자색은 어느 테마 bg에서도 4.5:1 이상(디자인 언어 §8-1).
  label: { road: "#6b655b", place: "#736c60", park: "#557447", station: "#2b2b2b", fontPx: 11 },
  siteLineWidthPx: 2,
} as const;

function theme(
  id: BaseThemeId,
  name: string,
  bg: string,
  building: [string, string],
  parcelLine: string,
  road: [string, string],
  green: [string, string, string],
  water: string,
  site: [string, number, string, number],
): BaseTheme {
  return {
    id,
    name,
    bg,
    building: { fill: building[0], line: building[1], lineWidthPx: COMMON.buildingLineWidthPx },
    parcel: { line: parcelLine, ...COMMON.parcel },
    road: { fill: road[0], casing: road[1], ...COMMON.road },
    green: { forest: green[0], park: green[1], grass: green[2] },
    water,
    rail: { ...COMMON.rail },
    station: { ...COMMON.station },
    label: { ...COMMON.label, halo: bg },
    site: { fill: site[0], fillOpacity: site[1], line: site[2], lineWidthPx: COMMON.siteLineWidthPx, haloPx: site[3] },
  };
}

export const BASE_THEMES: Readonly<Record<BaseThemeId, BaseTheme>> = {
  warm: theme("warm", "따뜻한 베이지", "#f6f4ef", ["#e4ddd0", "#c2b9a8"], "#d6cebf", ["#ffffff", "#e4ded3"], ["#cddcbd", "#dfe8d2", "#e8eedd"], "#cfe1ea", ["#f2b6b8", 0.35, "#c9404a", 0]),
  cool: theme("cool", "차가운 회색", "#f2f3f5", ["#dcdfe4", "#b4b9c1"], "#d8dce1", ["#ffffff", "#dde1e6"], ["#cad9c4", "#dce6d8", "#e5ece2"], "#d2e0ea", ["#ffffff", 0, "#111111", 5]),
  paper: theme("paper", "흰 종이", "#ffffff", ["#e9e7e2", "#bdb8ae"], "#ebe8e2", ["#f0eee9", "#f0eee9"], ["#d6e2c8", "#e6eddc", "#eef3e7"], "#dde8ee", ["#ffd76a", 0.45, "#111111", 4]),
};

export const DEFAULT_BASE_THEME: BaseThemeId = "warm";

export const isBaseThemeId = (value: unknown): value is BaseThemeId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(BASE_THEMES, value);

/** 모르는 id·없음은 기본 테마. */
export function baseTheme(id?: string | null): BaseTheme {
  return BASE_THEMES[isBaseThemeId(id) ? id : DEFAULT_BASE_THEME];
}

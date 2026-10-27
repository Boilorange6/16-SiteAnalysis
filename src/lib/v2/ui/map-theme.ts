/** 벡터 바탕지도 테마 토큰(색·굵기). 순수 데이터 — React·컴포넌트를 가져오지 않는다. */
import { lum, shiftL } from "./map-color";

export type BaseThemeId = "warm" | "cool" | "paper" | "sage" | "sand" | "blue" | "mono" | "ink";

/** 사용자가 만든 바탕 색 7개(#rrggbb). 나머지 색은 여기서 계산한다. */
export type BaseThemeColors = { bg: string; building: string; parcel: string; road: string; green: string; water: string; site: string };
export type BaseThemeRef = BaseThemeId | { name: string; colors: BaseThemeColors };

export type BaseTheme = {
  /** 만든 색은 "custom" */
  id: BaseThemeId | "custom";
  /** 사용자 표시명 */
  name: string;
  bg: string;
  /** 어두운 바탕(라벨이 밝은 글자) */
  dark: boolean;
  /** 반경 원·대지 주변 선 색 */
  ring: string;
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

/** 어두운 바탕의 라벨 글자색(밝은 글자). */
const LABEL_DARK = { road: "#bdb7ac", place: "#cbc5ba", park: "#9cc28b", station: "#f2f2f2" };
/** 밝은 바탕의 반경 원 색 = 지도 그림의 잉크(map-figure INK). */
const RING_LIGHT = "#16181d";
const RING_DARK = "#cfcfcf";

function theme(
  id: BaseThemeId | "custom",
  name: string,
  bg: string,
  building: [string, string],
  parcelLine: string,
  road: [string, string],
  green: [string, string, string],
  water: string,
  site: [string, number, string, number],
  dark = false,
): BaseTheme {
  return {
    id,
    name,
    bg,
    dark,
    ring: dark ? RING_DARK : RING_LIGHT,
    building: { fill: building[0], line: building[1], lineWidthPx: COMMON.buildingLineWidthPx },
    parcel: { line: parcelLine, ...COMMON.parcel },
    road: { fill: road[0], casing: road[1], ...COMMON.road },
    green: { forest: green[0], park: green[1], grass: green[2] },
    water,
    rail: { ...COMMON.rail },
    station: { ...COMMON.station },
    label: { ...COMMON.label, ...(dark ? LABEL_DARK : {}), halo: bg },
    site: { fill: site[0], fillOpacity: site[1], line: site[2], lineWidthPx: COMMON.siteLineWidthPx, haloPx: site[3] },
  };
}

export const BASE_THEMES: Readonly<Record<BaseThemeId, BaseTheme>> = {
  warm: theme("warm", "따뜻한 베이지", "#f6f4ef", ["#e4ddd0", "#c2b9a8"], "#d6cebf", ["#ffffff", "#e4ded3"], ["#cddcbd", "#dfe8d2", "#e8eedd"], "#cfe1ea", ["#f2b6b8", 0.35, "#c9404a", 0]),
  cool: theme("cool", "차가운 회색", "#f2f3f5", ["#dcdfe4", "#b4b9c1"], "#d8dce1", ["#ffffff", "#dde1e6"], ["#cad9c4", "#dce6d8", "#e5ece2"], "#d2e0ea", ["#ffffff", 0, "#111111", 5]),
  paper: theme("paper", "흰 종이", "#ffffff", ["#e9e7e2", "#bdb8ae"], "#ebe8e2", ["#f0eee9", "#f0eee9"], ["#d6e2c8", "#e6eddc", "#eef3e7"], "#dde8ee", ["#ffd76a", 0.45, "#111111", 4]),
  sage: theme("sage", "세이지", "#eef1ea", ["#dde3d5", "#b3bea6"], "#d3dacb", ["#fbfcf9", "#dfe4d8"], ["#c3d4b2", "#d5e2c6", "#e2eadb"], "#c9dde0", ["#f2b6b8", 0.35, "#b8434d", 0]),
  sand: theme("sand", "모래", "#f4efe5", ["#e7ddcb", "#c7b79d"], "#ddd2bf", ["#fffdf8", "#e9e0cf"], ["#d3dbbb", "#e2e7cf", "#ebeedd"], "#d3e2e3", ["#f6c99a", 0.4, "#b5562b", 0]),
  blue: theme("blue", "청사진", "#eef3f8", ["#d9e3ee", "#a7b9cf"], "#d0dbe7", ["#ffffff", "#dbe4ee"], ["#cfe2d6", "#dceadf", "#e7f0e8"], "#c4d9ea", ["#ffffff", 0, "#1d3557", 5]),
  mono: theme("mono", "흑백", "#ffffff", ["#dedede", "#8f8f8f"], "#e3e3e3", ["#ffffff", "#d0d0d0"], ["#e6e6e6", "#eeeeee", "#f3f3f3"], "#e1e1e1", ["#111111", 0.08, "#111111", 0]),
  ink: theme("ink", "먹", "#22252a", ["#33373e", "#4a4f58"], "#2c3036", ["#3a3e45", "#2a2d33"], ["#263228", "#2b382d", "#2f3b31"], "#1f3242", ["#ff8a8a", 0.28, "#ff6b6b", 0], true),
};

export const BASE_THEME_IDS = Object.keys(BASE_THEMES) as readonly BaseThemeId[];

export const DEFAULT_BASE_THEME: BaseThemeId = "warm";

export const isBaseThemeId = (value: unknown): value is BaseThemeId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(BASE_THEMES, value);

const COLOR_KEYS: readonly (keyof BaseThemeColors)[] = ["bg", "building", "parcel", "road", "green", "water", "site"];
const HEX = /^#[0-9a-f]{6}$/i;

/** 프리셋 id이거나, 이름과 7색이 모두 #rrggbb인 만든 색. */
export function isBaseThemeRef(value: unknown): value is BaseThemeRef {
  if (isBaseThemeId(value)) return true;
  if (!value || typeof value !== "object") return false;
  const { name, colors } = value as { name?: unknown; colors?: unknown };
  if (typeof name !== "string" || !colors || typeof colors !== "object") return false;
  return COLOR_KEYS.every((k) => {
    const c = (colors as Record<string, unknown>)[k];
    return typeof c === "string" && HEX.test(c);
  });
}

/** 대지 색에 맞는 투명도·선·후광. 프리셋에서 쓰던 조합은 그대로, 그 밖은 색에서 계산한다. */
function siteStyle(c: string, dark: boolean): [string, number, string, number] {
  const known: Record<string, [number, string, number]> = {
    "#f2b6b8": [0.35, "#c9404a", 0],
    "#ffd76a": [0.45, "#111111", 4],
    "#ffffff": [0, "#111111", 5],
    "#f6c99a": [0.4, "#b5562b", 0],
    "#ff8a8a": [0.28, "#ff6b6b", 0],
  };
  const k = known[c.toLowerCase()];
  return k ? [c, k[0], k[1], k[2]] : [c, 0.35, shiftL(c, dark ? 12 : -35), 0];
}

/** 만든 색 7개에서 나머지 토큰(건물 선·도로 테두리·녹지 3단·대지 표식)을 계산한다. */
export function themeFromColors(name: string, c: BaseThemeColors): BaseTheme {
  const dark = lum(c.bg) < 0.2;
  return theme(
    "custom",
    name,
    c.bg,
    [c.building, shiftL(c.building, dark ? 10 : -16)],
    c.parcel,
    [c.road, shiftL(lum(c.road) > 0.98 ? c.bg : c.road, dark ? -4 : -6)],
    [shiftL(c.green, -5), c.green, shiftL(c.green, dark ? -3 : 5)],
    c.water,
    siteStyle(c.site, dark),
    dark,
  );
}

/** 프리셋 id·만든 색 객체를 받는다. 모르는 값·없음은 기본 테마. */
export function baseTheme(ref?: BaseThemeRef | string | null): BaseTheme {
  if (isBaseThemeId(ref)) return BASE_THEMES[ref];
  if (ref && typeof ref === "object" && isBaseThemeRef(ref)) return themeFromColors(ref.name, ref.colors);
  return BASE_THEMES[DEFAULT_BASE_THEME];
}

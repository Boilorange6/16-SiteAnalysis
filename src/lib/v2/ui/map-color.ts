/** 지도 색 계산(순수 함수): 대비·명도 이동, 만든 색 생성기, 바탕 테마 경고. */
import type { BaseTheme, BaseThemeColors } from "./map-theme";

export type Mood = "자동" | "부드럽게" | "선명하게" | "따뜻하게" | "차갑게" | "밝게" | "어둡게" | "파스텔";
export const MOODS: readonly Mood[] = ["자동", "부드럽게", "선명하게", "따뜻하게", "차갑게", "밝게", "어둡게", "파스텔"];

const h2r = (h: string): [number, number, number] => {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const r2h = (r: number[]) =>
  "#" + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

export function hsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return r2h([f(0) * 255, f(8) * 255, f(4) * 255]);
}

export function toHsl(hex: string): [number, number, number] {
  const r = h2r(hex).map((v) => v / 255);
  const mx = Math.max(...r);
  const mn = Math.min(...r);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r[0] ? ((r[1] - r[2]) / d) % 6 : mx === r[1] ? (r[2] - r[0]) / d + 2 : (r[0] - r[1]) / d + 4;
    h *= 60;
  }
  return [h < 0 ? h + 360 : h, s * 100, l * 100];
}

export function shiftL(hex: string, dl: number): string {
  const c = toHsl(hex);
  return hsl(c[0], c[1], c[2] + dl);
}

const lin = (v: number) => {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export function lum(hex: string): number {
  const r = h2r(hex);
  return 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
}
export function contrast(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

type Locks = Partial<Record<keyof BaseThemeColors, boolean>>;

/** 분위기에 맞춰 바탕 테마 색 7개를 만든다. 잠근 색·`only` 밖의 색은 current 그대로. */
export function generateBaseColors(
  mood: Mood,
  current: BaseThemeColors,
  locks: Locks,
  only?: keyof BaseThemeColors,
  rng: () => number = Math.random,
): BaseThemeColors {
  const rnd = (a: number, b: number) => a + rng() * (b - a);
  const warmH = rnd(28, 45);
  const coolH = rnd(200, 225);
  let h = mood === "따뜻하게" ? warmH : mood === "차갑게" ? coolH : rng() < 0.5 ? warmH : coolH;
  if (mood === "자동" && rng() < 0.3) h = rnd(70, 140);
  let s = mood === "선명하게" ? rnd(14, 22) : mood === "부드럽게" ? rnd(5, 9) : mood === "파스텔" ? rnd(12, 18) : rnd(4, 12);
  let dark = mood === "어둡게";
  let bgL = dark ? rnd(12, 16) : mood === "밝게" ? rnd(98, 100) : rnd(94.5, 97.5);
  if (locks.bg || (only && only !== "bg")) {
    const c0 = toHsl(current.bg);
    h = c0[0];
    s = Math.max(3, c0[1]);
    bgL = c0[2];
    dark = bgL < 30;
  }
  const c: BaseThemeColors = {
    bg: hsl(h, s, bgL),
    building: dark ? hsl(h, s, bgL + rnd(7, 10)) : hsl(h, s + 4, bgL - rnd(9, 13)),
    parcel: dark ? hsl(h, s, bgL + rnd(4, 6)) : hsl(h, s + 2, bgL - rnd(6, 9)),
    road: dark ? hsl(h, s * 0.6, bgL + rnd(10, 14)) : rng() < 0.6 ? "#ffffff" : hsl(h, s * 0.5, Math.min(100, bgL + 2.5)),
    green: "",
    water: "",
    site: "",
  };
  const gh = rnd(85, 120);
  c.green = dark ? hsl(gh, rnd(14, 22), rnd(22, 27)) : hsl(gh, mood === "선명하게" ? rnd(30, 40) : rnd(18, 30), rnd(78, 85));
  const wh = rnd(195, 212);
  c.water = dark ? hsl(wh, rnd(22, 32), rnd(20, 26)) : hsl(wh, mood === "선명하게" ? rnd(35, 45) : rnd(22, 35), rnd(83, 89));
  const sites = dark ? ["#ff8a8a", "#ffd76a"] : ["#f2b6b8", "#ffd76a", "#ffffff", "#f6c99a"];
  c.site = sites[Math.floor(rng() * sites.length)];
  const out = { ...current };
  for (const k of Object.keys(c) as (keyof BaseThemeColors)[]) {
    if (only ? k === only : !locks[k]) out[k] = c[k];
  }
  return out;
}

/** 바탕 테마 경고: 라벨 대비 4.5:1, 건물과 바탕이 거의 같은 색. */
export function baseThemeWarnings(theme: BaseTheme): { level: "bad" | "ok"; text: string }[] {
  const L = theme.label;
  const cr = Math.min(contrast(L.road, theme.bg), contrast(L.place, theme.bg), contrast(L.park, theme.bg));
  const w: { level: "bad" | "ok"; text: string }[] = [
    cr < 4.5
      ? { level: "bad", text: `라벨 글자 대비 ${cr.toFixed(1)}:1 · 4.5:1 미달` }
      : { level: "ok", text: `라벨 글자 대비 ${cr.toFixed(1)}:1` },
  ];
  const cb = contrast(theme.building.fill, theme.bg);
  if (cb < 1.12) w.push({ level: "bad", text: `건물이 바탕과 거의 같음 (${cb.toFixed(2)}:1)` });
  return w;
}

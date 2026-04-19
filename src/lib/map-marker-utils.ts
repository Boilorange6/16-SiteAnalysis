import type { Apartment, Poi, SubwayStation } from "./types";
import { CATEGORY_COLORS, THEME_COLORS } from "./types";

const ICON_SVG: Record<string, string> = {
  subway: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M14 14 h20 v16 a4 4 0 0 1 -4 4 h-12 a4 4 0 0 1 -4 -4 v-16 M18 38 l-4 4 M30 38 l4 4 M14 24 h20 M18 30 h12" stroke="white" stroke-width="2"/></svg>`,
  school: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M24 14 L10 22 L24 30 L38 22 Z M10 30 L10 38 L24 44 L38 38 L38 30 M38 22 L38 34" stroke="white" stroke-width="2"/></svg>`,
  park: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M24 36 L24 28 M18 28 C12 28 12 14 24 14 C36 14 36 28 30 28 Z" stroke="white" stroke-width="2"/></svg>`,
  mountain: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M10 34 L20 18 L28 28 L38 34 Z M24 24 L30 14 L36 26" stroke="white" stroke-width="2"/></svg>`,
  apartment: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M16 34 v-18 h16 v18 M16 34 h16 M20 22 h2 M26 22 h2 M20 28 h2 M26 28 h2" stroke="white" stroke-width="2"/></svg>`,
};

export function getPoiColor(poi: Poi): string {
  return poi.category === "subway" ? (poi as SubwayStation).lineColor : CATEGORY_COLORS[poi.category];
}

export function getClusterColor(pois: readonly Poi[]): string {
  if (pois.length === 0) {
    return THEME_COLORS.primaryNavy;
  }

  const categories = new Set(pois.map((poi) => poi.category));
  return categories.size === 1 ? getPoiColor(pois[0]) : THEME_COLORS.primaryNavy;
}

export function createIcon(category: string, color: string, L: typeof import("leaflet")) {
  const svg = ICON_SVG[category] ?? ICON_SVG.park;
  const html = `<div style="
    background:white;
    border-radius:50%;
    width:32px;
    height:32px;
    display:flex;
    align-items:center;
    justify-content:center;
    box-shadow:0 3px 8px rgba(0,0,0,0.5),0 1px 3px rgba(0,0,0,0.3);
  "><div style="
    background:${color};
    border-radius:50%;
    width:24px;
    height:24px;
    display:flex;
    align-items:center;
    justify-content:center;
  ">${svg.replace('width="24"', 'width="13"').replace('height="24"', 'height="13"')}</div></div>`;

  return L.divIcon({
    html,
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export function createClusterIcon(count: number, color: string, L: typeof import("leaflet")) {
  const size = count >= 20 ? 52 : count >= 10 ? 46 : 40;
  const badgeSize = size - 10;
  const fontSize = count >= 100 ? 13 : 14;
  const countLabel = count > 99 ? "99+" : count.toString();

  return L.divIcon({
    html: `<div style="
      width:${size}px;
      height:${size}px;
      display:flex;
      align-items:center;
      justify-content:center;
      border-radius:9999px;
      background:rgba(15,23,42,0.88);
      border:2px solid rgba(255,255,255,0.6);
      box-shadow:0 14px 28px rgba(15,23,42,0.35);
    "><div style="
      width:${badgeSize}px;
      height:${badgeSize}px;
      display:flex;
      align-items:center;
      justify-content:center;
      border-radius:9999px;
      background:${color};
      color:white;
      font-family:'Pretendard','Noto Sans KR',sans-serif;
      font-weight:800;
      font-size:${fontSize}px;
      letter-spacing:-0.02em;
    ">${countLabel}</div></div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function createLabel(name: string, extra: string) {
  return `<div style="
    background:${THEME_COLORS.overlayDark}cc;
    backdrop-filter:blur(8px);
    -webkit-backdrop-filter:blur(8px);
    color:#fff;
    padding:6px 10px;
    border-radius:6px;
    font-size:12px;
    font-family:'Pretendard','Noto Sans KR',sans-serif;
    white-space:nowrap;
    line-height:1.4;
    border:1px solid rgba(255,255,255,0.1);
    box-shadow:0 4px 12px rgba(0,0,0,0.3);
  "><strong style="color:${THEME_COLORS.secondaryNavy}">${name}</strong>${extra ? `<br/><span style="color:rgba(255,255,255,0.7);font-size:11px">${extra}</span>` : ""}</div>`;
}

export function getPoiExtra(poi: Poi): string {
  switch (poi.category) {
    case "subway":
      return (poi as SubwayStation).line;
    case "apartment": {
      const apartment = poi as Apartment;
      return `${apartment.units.toLocaleString()}세대 | ${apartment.price_per_pyeong.toLocaleString()}만/평`;
    }
    case "mountain":
      return `${poi.elevation_m}m`;
    default:
      return "";
  }
}

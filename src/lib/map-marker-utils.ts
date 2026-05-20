import type { Apartment, Officetel, MaintenanceProject, Park, Poi, ResidentialPoi, SubwayStation } from "./types";
import { formatAreaSqm, formatDistanceM } from "./park-analysis";
import { formatMaintenanceArea } from "./maintenance-analysis";
import { CATEGORY_COLORS, THEME_COLORS } from "./types";

const ICON_SVG: Record<string, string> = {
  subway: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M14 14 h20 v16 a4 4 0 0 1 -4 4 h-12 a4 4 0 0 1 -4 -4 v-16 M18 38 l-4 4 M30 38 l4 4 M14 24 h20 M18 30 h12" stroke="white" stroke-width="2"/></svg>`,
  school: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M24 14 L10 22 L24 30 L38 22 Z M10 30 L10 38 L24 44 L38 38 L38 30 M38 22 L38 34" stroke="white" stroke-width="2"/></svg>`,
  park: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M24 36 L24 28 M18 28 C12 28 12 14 24 14 C36 14 36 28 30 28 Z" stroke="white" stroke-width="2"/></svg>`,
  mountain: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M10 34 L20 18 L28 28 L38 34 Z M24 24 L30 14 L36 26" stroke="white" stroke-width="2"/></svg>`,
  apartment: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M16 34 v-18 h16 v18 M16 34 h16 M20 22 h2 M26 22 h2 M20 28 h2 M26 28 h2" stroke="white" stroke-width="2"/></svg>`,
  officetel: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M14 36 v-24 h20 v24 M14 36 h20 M18 18 h2 M24 18 h2 M30 18 h2 M18 24 h2 M24 24 h2 M30 24 h2 M18 30 h2 M24 30 h2 M30 30 h2" stroke="white" stroke-width="2"/></svg>`,
  residential: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M24 10 L10 22 v14 h28 v-14 Z M20 36 v-8 h8 v8" stroke="white" stroke-width="2"/></svg>`,
  maintenance: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M14 34 h20 M17 34 l2 -14 h10 l2 14 M20 20 l4 -6 l4 6 M24 14 v20" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

export type MarkerStyle = "default" | "naver";

export interface MarkerIconOptions {
  readonly scale?: number;
  readonly badgeLabel?: string;
}

export interface StationRouteMatch {
  angle: number;
  color: string;
  snapLat: number;
  snapLng: number;
}

/**
 * Find ALL routes passing through a station within threshold.
 * Returns one match per unique lineColor (deduplicated).
 * For transfer stations, returns multiple matches (one per line).
 */
export function findStationRoutes(
  station: SubwayStation,
  routes: readonly { line: string; lineColor: string; coordinates?: readonly [number, number][] }[],
): StationRouteMatch[] {
  const routesWithCoords = routes.filter(r => r.coordinates && r.coordinates.length >= 2);
  if (routesWithCoords.length === 0) return [];

  const cosLat = Math.cos(station.lat * Math.PI / 180);
  const THRESHOLD = (80 / 111000) ** 2; // ~80m

  const matches: StationRouteMatch[] = [];
  const seenColors = new Set<string>();

  for (const route of routesWithCoords) {
    const coords = route.coordinates!;
    let minDist = Infinity;
    let closestIdx = 0;

    for (let i = 0; i < coords.length; i++) {
      const dx = (coords[i][1] - station.lng) * cosLat;
      const dy = coords[i][0] - station.lat;
      const dist = dx * dx + dy * dy;
      if (dist < minDist) { minDist = dist; closestIdx = i; }
    }

    if (minDist > THRESHOLD) continue;
    // Deduplicate same line color (multiple route segments of same line)
    if (seenColors.has(route.lineColor)) continue;
    seenColors.add(route.lineColor);

    const span = Math.min(8, Math.floor(coords.length / 4));
    const prevIdx = Math.max(0, closestIdx - span);
    const nextIdx = Math.min(coords.length - 1, closestIdx + span);
    const dLng = coords[nextIdx][1] - coords[prevIdx][1];
    const dLat = coords[nextIdx][0] - coords[prevIdx][0];
    const angle = Math.atan2(dLng, dLat) * (180 / Math.PI);

    matches.push({
      angle,
      color: route.lineColor,
      snapLat: coords[closestIdx][0],
      snapLng: coords[closestIdx][1],
    });
  }

  return matches;
}

/**
 * Naver-style subway station marker.
 * Colored bar (station platform) aligned to the track direction. No label.
 */
export function createSubwayBadge(
  station: SubwayStation,
  L: typeof import("leaflet"),
  angleDeg: number = 0,
) {
  const color = station.lineColor;

  // Convert bearing (north=0 clockwise) to CSS rotation
  let rotation = angleDeg - 90;
  if (rotation > 90) rotation -= 180;
  if (rotation < -90) rotation += 180;

  const barW = 36;
  const barH = 7;

  const html = `<div style="
    width:${barW}px;
    height:${barH}px;
    transform:rotate(${rotation.toFixed(1)}deg);
    transform-origin:center center;
    background:${color};
    border-radius:1px;
    border:1.5px solid rgba(255,255,255,0.95);
    box-shadow:0 1px 4px rgba(0,0,0,0.5);
    pointer-events:auto;
  "></div>`;

  return L.divIcon({
    html,
    className: "",
    iconSize: [barW, barH],
    iconAnchor: [barW / 2, barH / 2],
  });
}

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

export function createIcon(
  category: string,
  color: string,
  L: typeof import("leaflet"),
  options: MarkerIconOptions = {}
) {
  const scale = options.scale ?? 1;
  const outerSize = Math.round(32 * scale);
  const innerSize = Math.round(24 * scale);
  const glyphSize = Math.max(10, Math.round(13 * scale));
  const svg = ICON_SVG[category] ?? ICON_SVG.park;
  const badgeLabel = options.badgeLabel ? escapeHtml(options.badgeLabel) : "";
  const html = `<div style="
    position:relative;
    background:white;
    border-radius:50%;
    width:${outerSize}px;
    height:${outerSize}px;
    display:flex;
    align-items:center;
    justify-content:center;
    box-shadow:0 3px 8px rgba(0,0,0,0.5),0 1px 3px rgba(0,0,0,0.3);
  "><div style="
    background:${color};
    border-radius:50%;
    width:${innerSize}px;
    height:${innerSize}px;
    display:flex;
    align-items:center;
    justify-content:center;
  ">${svg.replace('width="24"', `width="${glyphSize}"`).replace('height="24"', `height="${glyphSize}"`)}</div>${
    badgeLabel
      ? `<span style="
          position:absolute;
          left:50%;
          bottom:-7px;
          transform:translateX(-50%);
          border-radius:999px;
          background:#0F172A;
          color:#FFFFFF;
          border:1px solid rgba(255,255,255,0.85);
          font-family:'Pretendard','Noto Sans KR',sans-serif;
          font-size:${Math.max(8, Math.round(9 * scale))}px;
          font-weight:800;
          line-height:1;
          padding:2px 4px;
          white-space:nowrap;
          box-shadow:0 2px 6px rgba(0,0,0,0.35);
        ">${badgeLabel}</span>`
      : ""
  }</div>`;

  return L.divIcon({
    html,
    className: "",
    iconSize: [outerSize, outerSize],
    iconAnchor: [outerSize / 2, outerSize / 2],
  });
}

export function createClusterIcon(
  count: number,
  color: string,
  L: typeof import("leaflet"),
  options: MarkerIconOptions = {}
) {
  const scale = options.scale ?? 1;
  const baseSize = count >= 20 ? 52 : count >= 10 ? 46 : 40;
  const size = Math.round(baseSize * scale);
  const badgeSize = Math.max(24, size - Math.round(10 * scale));
  const fontSize = Math.max(11, Math.round((count >= 100 ? 13 : 14) * scale));
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function createLabel(name: string, extra: string) {
  const safeName = escapeHtml(name);
  const safeExtra = escapeHtml(extra);
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
  "><strong style="color:${THEME_COLORS.secondaryNavy}">${safeName}</strong>${safeExtra ? `<br/><span style="color:rgba(255,255,255,0.7);font-size:11px">${safeExtra}</span>` : ""}</div>`;
}

export function getPoiExtra(poi: Poi): string {
  switch (poi.category) {
    case "subway":
      return (poi as SubwayStation).line;
    case "apartment":
    case "officetel":
    case "residential": {
      const rp = poi as ResidentialPoi;
      const parts: string[] = [];
      if (rp.units > 0) parts.push(`${rp.units.toLocaleString()}세대`);
      if (rp.parking_count > 0) parts.push(`주차 ${rp.parking_count}대`);
      if (rp.max_floor && rp.max_floor > 0) parts.push(`최고 ${rp.max_floor}층`);
      if (rp.status === "planned") parts.unshift("분양예정");
      if (rp.move_in_month) parts.push(`입주 ${rp.move_in_month}`);
      else if (rp.sale_date) parts.push(rp.sale_date);
      const fallback = poi.category === "officetel" ? "오피스텔" : poi.category === "residential" ? "주거시설" : "아파트";
      return parts.join(" | ") || fallback;
    }
    case "park": {
      const park = poi as Park;
      const parts: string[] = [];
      if (park.park_type || park.type) parts.push(park.park_type ?? park.type);
      if (park.area_sqm > 0) parts.push(formatAreaSqm(park.area_sqm));
      if (park.access_distance_m != null) parts.push(`접근 ${formatDistanceM(park.access_distance_m)}`);
      return parts.join(" | ");
    }
    case "maintenance": {
      const project = poi as MaintenanceProject;
      const parts = [project.type, project.stage].filter(Boolean);
      if (project.area_sqm > 0) parts.push(formatMaintenanceArea(project.area_sqm));
      if (project.boundary_status === "unavailable") parts.push("경계 미확인");
      return parts.join(" | ");
    }
    case "mountain":
      return `${poi.elevation_m}m`;
    default:
      return "";
  }
}

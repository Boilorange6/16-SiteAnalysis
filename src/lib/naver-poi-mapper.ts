import type { NaverLocalItem } from "./naver-api";
import { stripHtml, naverCoordsToWgs84 } from "./naver-api";
import type { SubwayStation, School, Park, Mountain, Apartment, Poi } from "./types";

const LINE_COLORS: Record<string, string> = {
  "1호선": "#0052A4",
  "2호선": "#00A84D",
  "3호선": "#EF7C1C",
  "4호선": "#00A5DE",
  "5호선": "#996CAC",
  "6호선": "#CD7C2F",
  "7호선": "#747F00",
  "8호선": "#E6186C",
  "9호선": "#BDB092",
  "경의중앙선": "#77C4A3",
  "수인분당선": "#FABE00",
  "신분당선": "#D4003B",
  "우이신설선": "#B0CE18",
};

function inferSubwayLine(category: string): { line: string; lineColor: string } {
  const lineMatch = category.match(/(\d호선|경의중앙선|수인분당선|신분당선|우이신설선|[가-힣]+선)/);
  const lineName = lineMatch ? lineMatch[0] : "미확인";
  const color = LINE_COLORS[lineName] ?? "#888888";
  return { line: lineName, lineColor: color };
}

function inferSchoolLevel(title: string): "elementary" | "middle" | "high" {
  if (title.includes("초등")) return "elementary";
  if (title.includes("중학") || title.includes("중교")) return "middle";
  return "high";
}

export function mapToSubwayStation(item: NaverLocalItem, index: number): SubwayStation {
  const { lat, lng } = naverCoordsToWgs84(item.mapx, item.mapy);
  const { line, lineColor } = inferSubwayLine(item.category);
  return {
    id: `naver-subway-${index}-${item.mapx}`,
    name: stripHtml(item.title),
    lat,
    lng,
    category: "subway",
    line,
    lineColor,
  };
}

export function mapToSchool(item: NaverLocalItem, index: number): School {
  const { lat, lng } = naverCoordsToWgs84(item.mapx, item.mapy);
  const name = stripHtml(item.title);
  return {
    id: `naver-school-${index}-${item.mapx}`,
    name,
    lat,
    lng,
    category: "school",
    level: inferSchoolLevel(name),
  };
}

export function mapToPark(item: NaverLocalItem, index: number): Park {
  const { lat, lng } = naverCoordsToWgs84(item.mapx, item.mapy);
  return {
    id: `naver-park-${index}-${item.mapx}`,
    name: stripHtml(item.title),
    lat,
    lng,
    category: "park",
    area_sqm: 0,
    type: "공원",
  };
}

export function mapToMountain(item: NaverLocalItem, index: number): Mountain {
  const { lat, lng } = naverCoordsToWgs84(item.mapx, item.mapy);
  return {
    id: `naver-mountain-${index}-${item.mapx}`,
    name: stripHtml(item.title),
    lat,
    lng,
    category: "mountain",
    elevation_m: 0,
  };
}

export function mapToApartment(item: NaverLocalItem, index: number): Apartment {
  const { lat, lng } = naverCoordsToWgs84(item.mapx, item.mapy);
  return {
    id: `naver-apartment-${index}-${item.mapx}`,
    name: stripHtml(item.title),
    lat,
    lng,
    category: "apartment",
    units: 0,
    parking_count: 0,
    sale_date: "",
    distance_m: 0,
    status: "existing",
    source: "ledger",
  };
}

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function filterByRadius(pois: Poi[], centerLat: number, centerLng: number, radiusM: number): Poi[] {
  return pois.filter((poi) => haversineDistance(centerLat, centerLng, poi.lat, poi.lng) <= radiusM);
}

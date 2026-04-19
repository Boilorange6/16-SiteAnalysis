import type { KakaoKeywordDocument } from "./kakao-api";
import type { SubwayStation, School, Park, Mountain, Apartment, PoiBase } from "./types";

// Kakao 좌표계: x = 경도(lng), y = 위도(lat)
function parseCoords(doc: KakaoKeywordDocument): { lat: number; lng: number } {
  return {
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
  };
}

// 지하철역 호선 추론 (카테고리명에서)
function inferSubwayLine(categoryName: string): { line: string; lineColor: string } {
  const lineMatch = categoryName.match(/(\d호선|[가-힣]+선)/);
  const lineName = lineMatch ? lineMatch[0] : "미확인";

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

  const color = LINE_COLORS[lineName] ?? "#888888";
  return { line: lineName, lineColor: color };
}

// 학교 레벨 추론 (카테고리명에서)
function inferSchoolLevel(categoryName: string): "elementary" | "middle" | "high" {
  if (categoryName.includes("초등")) return "elementary";
  if (categoryName.includes("중학")) return "middle";
  return "high";
}

export function mapToSubwayStation(doc: KakaoKeywordDocument): SubwayStation {
  const { lat, lng } = parseCoords(doc);
  const { line, lineColor } = inferSubwayLine(doc.category_name);

  return {
    id: `kakao-subway-${doc.id}`,
    name: doc.place_name,
    lat,
    lng,
    category: "subway",
    line,
    lineColor,
  };
}

export function mapToSchool(doc: KakaoKeywordDocument): School {
  const { lat, lng } = parseCoords(doc);

  return {
    id: `kakao-school-${doc.id}`,
    name: doc.place_name,
    lat,
    lng,
    category: "school",
    level: inferSchoolLevel(doc.category_name),
  };
}

export function mapToPark(doc: KakaoKeywordDocument): Park {
  const { lat, lng } = parseCoords(doc);

  return {
    id: `kakao-park-${doc.id}`,
    name: doc.place_name,
    lat,
    lng,
    category: "park",
    area_sqm: 0,
    type: "공원",
  };
}

export function mapToMountain(doc: KakaoKeywordDocument): Mountain {
  const { lat, lng } = parseCoords(doc);

  return {
    id: `kakao-mountain-${doc.id}`,
    name: doc.place_name,
    lat,
    lng,
    category: "mountain",
    elevation_m: 0,
  };
}

export function mapToApartment(doc: KakaoKeywordDocument): Apartment {
  const { lat, lng } = parseCoords(doc);

  return {
    id: `kakao-apartment-${doc.id}`,
    name: doc.place_name,
    lat,
    lng,
    category: "apartment",
    units: 0,
    price_per_pyeong: 0,
    sale_date: "",
    distance_m: doc.distance ? parseInt(doc.distance, 10) : 0,
  };
}

export type PoiCategory = "subway" | "school" | "park" | "mountain" | "apartment";

export function mapToPoiBase(doc: KakaoKeywordDocument, category: PoiCategory): PoiBase {
  const { lat, lng } = parseCoords(doc);

  return {
    id: `kakao-${category}-${doc.id}`,
    name: doc.place_name,
    lat,
    lng,
    category,
  };
}

import { overpassFetch } from "./server/overpass-fetch";

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Fetches all POI categories within radiusM metres of (lat, lng)
 * using a single Overpass API call.
 */
export async function overpassPoiSearch(
  lat: number,
  lng: number,
  radiusM: number
): Promise<OverpassElement[]> {
  const r = radiusM;
  const query = `
[out:json][timeout:40];
(
  node["station"="subway"](around:${r},${lat},${lng});
  node["railway"="station"]["station"="subway"](around:${r},${lat},${lng});
  node["amenity"="school"](around:${r},${lat},${lng});
  way["amenity"="school"](around:${r},${lat},${lng});
  node["amenity"="university"](around:${r},${lat},${lng});
  way["amenity"="university"](around:${r},${lat},${lng});
  way["leisure"="park"](around:${r},${lat},${lng});
  node["leisure"="park"](around:${r},${lat},${lng});
  node["natural"="peak"](around:${r},${lat},${lng});
  way["building"="apartments"](around:${r},${lat},${lng});
  way["building"="residential"](around:${r},${lat},${lng});
  way["building"="commercial"](around:${r},${lat},${lng});
  node["building"="commercial"](around:${r},${lat},${lng});
);
out center tags;
`;

  const data = (await overpassFetch(query)) as { elements: OverpassElement[] };
  return data.elements;
}

export function getElementCoords(el: OverpassElement): { lat: number; lng: number } | null {
  if (el.type === "node" && el.lat != null && el.lon != null) {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

export type OverpassCategory = "subway" | "school" | "park" | "mountain" | "apartment" | "officetel" | "residential";

export function classifyElement(el: OverpassElement): OverpassCategory | null {
  const tags = el.tags ?? {};

  if (
    tags["station"] === "subway" ||
    (tags["railway"] === "station" && tags["station"] === "subway")
  ) {
    return "subway";
  }
  if (tags["amenity"] === "school" || tags["amenity"] === "university" || tags["amenity"] === "college") {
    return "school";
  }
  if (tags["leisure"] === "park" || tags["leisure"] === "garden") {
    return "park";
  }
  if (tags["natural"] === "peak") {
    return "mountain";
  }

  const building = tags["building"];
  if (building === "apartments" || building === "residential" || building === "commercial") {
    const name = tags["name:ko"] ?? tags["name"] ?? "";
    if (name.includes("오피스텔")) return "officetel";
    if (building === "apartments") return "apartment";
    // commercial buildings without "오피스텔" in name are not residential
    if (building === "commercial") return null;
    return "residential";
  }
  return null;
}

export function inferSchoolLevel(name: string): "elementary" | "middle" | "high" {
  if (name.includes("초등") || name.includes("초교")) return "elementary";
  if (name.includes("중학") || name.includes("중교")) return "middle";
  return "high";
}

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

// ref 번호 범위 → 호선 매핑 (서울 지하철)
const REF_LINE_MAP: [RegExp, string][] = [
  [/^1\d{2}$/, "1호선"],
  [/^2\d{2}$/, "2호선"],
  [/^3\d{2}$/, "3호선"],
  [/^4\d{2}$/, "4호선"],
  [/^5\d{2}$/, "5호선"],
  [/^6\d{2}$/, "6호선"],
  [/^7\d{2}$/, "7호선"],
  [/^8\d{2}$/, "8호선"],
  [/^9\d{2}$/, "9호선"],
  [/^K\d{3}$/i, "수인분당선"],
  [/^D\d{2}$/i, "신분당선"],
  [/^A\d{2}$/i, "경의중앙선"],
  [/^UI\d{2}$/i, "우이신설선"],
];

export function inferSubwayLine(nameHint: string, ref?: string): { line: string; lineColor: string } {
  // 1. Try ref tag first (most reliable)
  if (ref) {
    // ref can be "219" or "219/K215" (multi-line station)
    const refs = ref.split(/[\/;,]/).map(r => r.trim());
    for (const r of refs) {
      for (const [pattern, lineName] of REF_LINE_MAP) {
        if (pattern.test(r)) {
          return { line: lineName, lineColor: LINE_COLORS[lineName] ?? "#888888" };
        }
      }
    }
  }

  // 2. Try name/operator/network hint
  const m = nameHint.match(/(\d호선|경의중앙선|수인분당선|신분당선|우이신설선|[가-힣]+선)/);
  if (m) {
    const lineName = m[0];
    return { line: lineName, lineColor: LINE_COLORS[lineName] ?? "#888888" };
  }

  // 3. Try operator name
  if (nameHint.includes("9호선") || nameHint.includes("메트로9호선")) return { line: "9호선", lineColor: LINE_COLORS["9호선"] };

  return { line: "미확인", lineColor: "#888888" };
}

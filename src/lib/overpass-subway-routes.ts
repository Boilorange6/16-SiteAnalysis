import { inferSubwayLine } from "./overpass-api";
import type { SubwayRoute } from "./types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

type Coord = [number, number]; // [lat, lng]

interface WayMember {
  type: "way";
  ref: number;
  role: string;
  geometry: { lat: number; lon: number }[];
}

interface OverpassRelation {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members: ({ type: "node" | "relation"; ref: number; role: string } | WayMember)[];
}

function coordDist(a: Coord, b: Coord): number {
  const dlat = a[0] - b[0];
  const dlng = a[1] - b[1];
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

/**
 * Greedy chain-join: stitches unordered way segments into a single polyline.
 * Segments that are too far apart (> GAP threshold) stop the chain — gaps in
 * subway routes are silently accepted rather than creating long jump lines.
 */
function chainJoin(segments: Coord[][]): Coord[] {
  if (segments.length === 0) return [];
  if (segments.length === 1) return segments[0];

  const result: Coord[] = [...segments[0]];
  const pool = segments.slice(1).map((s) => [...s] as Coord[]);
  const GAP = 0.005; // ≈ 500 m in degrees — above this, stop chaining

  while (pool.length > 0) {
    const tail = result[result.length - 1];
    let bestIdx = -1;
    let reversed = false;
    let bestDist = Infinity;

    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      const df = coordDist(tail, s[0]);
      const dr = coordDist(tail, s[s.length - 1]);
      if (df < bestDist) { bestDist = df; bestIdx = i; reversed = false; }
      if (dr < bestDist) { bestDist = dr; bestIdx = i; reversed = true; }
    }

    if (bestIdx === -1 || bestDist > GAP) break;

    const seg = pool.splice(bestIdx, 1)[0];
    const pts = reversed ? seg.reverse() : seg;
    // Skip first point when it duplicates the current tail
    const skip = coordDist(tail, pts[0]) < 0.0001 ? 1 : 0;
    result.push(...pts.slice(skip));
  }

  return result;
}

/**
 * Fetches subway route relations within radiusM metres of (lat, lng) via
 * Overpass API with inline way geometry.
 *
 * Returns one SubwayRoute per OSM relation. Some lines (e.g. 5호선) have
 * multiple relations (western section, eastern section, branch lines), so
 * preserving each relation separately gives complete coverage. The map
 * renders each as a separate same-coloured polyline — visually seamless.
 *
 * Inbound/outbound relations for the same line draw on the same track, so
 * they overlap harmlessly rather than being deduplicated.
 */
export async function overpassSubwayRoutes(
  lat: number,
  lng: number,
  radiusM: number
): Promise<SubwayRoute[]> {
  const query = `
[out:json][timeout:60];
(
  relation["route"="subway"](around:${radiusM},${lat},${lng});
);
out geom;
`;

  const params = new URLSearchParams({ data: query });
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "*/*",
      "User-Agent": "SiteAnalysisApp/1.0",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(65_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Overpass API error [${res.status}]: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { elements: OverpassRelation[] };

  const routes: SubwayRoute[] = [];

  for (const el of data.elements) {
    if (el.type !== "relation") continue;

    const tags = el.tags ?? {};
    const hint = [tags["name"], tags["ref"], tags["network"], tags["operator"]]
      .filter(Boolean)
      .join(" ");
    const { line, lineColor } = inferSubwayLine(hint);
    if (line === "미확인") continue;

    // Only way members with role="" (track) that have inline geometry
    const trackSegments: Coord[][] = el.members
      .filter((m): m is WayMember =>
        m.type === "way" &&
        (m as WayMember).role === "" &&
        Array.isArray((m as WayMember).geometry) &&
        ((m as WayMember).geometry?.length ?? 0) >= 2
      )
      .map((m) => m.geometry.map(({ lat: la, lon }) => [la, lon] as Coord));

    if (trackSegments.length === 0) continue;

    const coordinates = chainJoin(trackSegments);
    if (coordinates.length < 2) continue;

    routes.push({
      line,
      lineColor,
      stationIds: [],
      coordinates: coordinates as [number, number][],
    });
  }

  return routes;
}

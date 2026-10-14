/**
 * OSM 운영 철도 스냅샷 생성기.
 *
 * Overpass의 route relation과 stop node를 한 번에 받아 역·출입구·노선·역축
 * 계약(public/data/osm-subway.json)으로 정규화한다. OSM 관계의 `ref`가 잘못
 * 재사용되는 경우를 막기 위해 최종 공개 노선 판정은 A01 canonicalizer와
 * 같은 rail-presentation 규칙을 사용한다.
 *
 * 실행:
 *   npx tsx src/scripts/v2/build-osm-subway-snapshot.mjs
 *   npx tsx src/scripts/v2/build-osm-subway-snapshot.mjs --output <candidate.json> --cache-dir <overpass-cache>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const { canonicalRailLineLabel, publicRailLine, railLineColor } = await import("../../lib/v2/tile/rail-presentation.ts");

const DEFAULT_OUTPUT = "public/data/osm-subway.json";
const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];
const BOXES = [
  // 대형 전역 요청은 공용 Overpass에서 504가 날 수 있어 동·서로 나눈다.
  // 겹치는 요소는 아래 elementsByKey에서 OSM id로 합친다.
  { name: "capital-west", south: 36.5, west: 124.5, north: 39.2, east: 127.0 },
  { name: "capital-east", south: 36.5, west: 127.0, north: 39.2, east: 129.3 },
  // 부산·대구·대전·광주 등 기존 전국 도시철도 보존.
  { name: "south-west", south: 34.5, west: 125.0, north: 36.8, east: 126.75 },
  { name: "south-midwest", south: 34.5, west: 126.75, north: 36.8, east: 128.0 },
  { name: "south-mideast", south: 34.5, west: 128.0, north: 36.8, east: 129.25 },
  { name: "south-east", south: 34.5, west: 129.25, north: 36.8, east: 130.5 },
];
const HEX = /^#[0-9a-f]{6}$/iu;
const ROUTE_STOP_ROLES = new Set(["stop", "platform", "stop_entry_only", "platform_entry_only", "station"]);
const METERS_PER_LAT = 111_320;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function bboxText(box) {
  return `${box.south},${box.west},${box.north},${box.east}`;
}

function queryFor(box) {
  const bbox = bboxText(box);
  return `[out:json][timeout:180];
(
  relation["route"="subway"](${bbox});
  relation["route"="light_rail"](${bbox});
  relation["route"="train"]["network"~"수도권 전철|수도권|서울"](${bbox});
  relation["route"="train"]["name"~"GTX|광역급행|경강|서해|공항철도"](${bbox});
)->.rail_routes;
(
  .rail_routes;
  node(r.rail_routes);
  node["railway"~"^(station|halt|tram_stop|subway_entrance)$"](${bbox});
  node["railway"="entrance"]["entrance"~"^(subway|exit)$"](${bbox});
);
out body geom;`;
}

async function fetchOverpass(query) {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await sleep(2500);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Accept: "*/*",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "SiteAnalysisApp/1.0 (OSM snapshot builder)",
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: AbortSignal.timeout(240_000),
        });
        const body = await response.text();
        if (!response.ok) throw new Error(`Overpass ${response.status}: ${body.slice(0, 180)}`);
        const data = JSON.parse(body);
        if (data.remark) throw new Error(`Overpass partial response: ${String(data.remark).slice(0, 180)}`);
        if (!Array.isArray(data.elements)) throw new Error("Overpass response has no elements array");
        return data.elements;
      } catch (error) {
        lastError = error;
        console.warn(`overpass retry ${endpoint} attempt=${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  throw lastError ?? new Error("Overpass request failed");
}

function tag(element, key) {
  const value = element?.tags?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function nameOf(element) {
  return tag(element, "name:ko") ?? tag(element, "name") ?? tag(element, "official_name:ko");
}

function lineRefOf(relation) {
  return tag(relation, "ref") ?? tag(relation, "route_ref") ?? "";
}

function lineNameOf(relation) {
  return nameOf(relation) ?? tag(relation, "network") ?? "";
}

function hexOrNull(value) {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim().toUpperCase() : null;
}

function lineColorOf(ref, name, relation) {
  return hexOrNull(tag(relation, "colour"))
    ?? hexOrNull(tag(relation, "color"))
    ?? railLineColor(ref, name);
}

function stationKey(value) {
  return String(value ?? "")
    .replace(/\([^)]*\)/gu, "")
    .replace(/[\s·・]/gu, "")
    .replace(/역$/u, "")
    .trim();
}

function pointOf(node) {
  return Number.isFinite(node?.lon) && Number.isFinite(node?.lat)
    ? { lng: Number(node.lon), lat: Number(node.lat) }
    : null;
}

function distanceM(a, b) {
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (a.lng - b.lng) * Math.cos(lat) * METERS_PER_LAT;
  const dy = (a.lat - b.lat) * METERS_PER_LAT;
  return Math.hypot(dx, dy);
}

function stationCandidate(node) {
  const railway = tag(node, "railway");
  const station = tag(node, "station");
  if (!nameOf(node) || !(railway === "station" || railway === "halt" || railway === "tram_stop" || station === "subway" || station === "train" || station === "light_rail")) return null;
  return {
    osm_id: `node/${node.id}`,
    station_name: nameOf(node),
    ...pointOf(node),
    _priority: railway === "station" ? 3 : station === "train" || station === "subway" ? 2 : 1,
    _ref: tag(node, "ref"),
  };
}

function relationSegments(relation) {
  return (relation.members ?? [])
    .filter((member) => member.type === "way" && Array.isArray(member.geometry) && member.geometry.length >= 2)
    .map((member) => member.geometry
      .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
      .map((point) => [Number(point.lon), Number(point.lat)]))
    .filter((segment) => segment.length >= 2);
}

function routeStopNodes(relation, nodesById) {
  const seen = new Set();
  const stops = [];
  for (const member of relation.members ?? []) {
    if (member.type !== "node" || !ROUTE_STOP_ROLES.has(member.role ?? "")) continue;
    const node = nodesById.get(String(member.ref));
    const name = node ? nameOf(node) : null;
    const point = node ? pointOf(node) : null;
    if (!node || !name || !point || seen.has(String(member.ref))) continue;
    seen.add(String(member.ref));
    stops.push({ id: `node/${member.ref}`, name, ...point });
  }
  return stops;
}

function projectPoint(point, start, end) {
  const lat = point.lat * Math.PI / 180;
  const scale = Math.cos(lat) * METERS_PER_LAT;
  const sx = start[0] * scale;
  const sy = start[1] * METERS_PER_LAT;
  const ex = end[0] * scale;
  const ey = end[1] * METERS_PER_LAT;
  const px = point.lng * scale;
  const py = point.lat * METERS_PER_LAT;
  const dx = ex - sx;
  const dy = ey - sy;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / denominator));
  const x = sx + dx * t;
  const y = sy + dy * t;
  return {
    t,
    distance: Math.hypot(px - x, py - y),
    direction: { x: dx, y: dy },
  };
}

function axisEndpoints(point, segments) {
  let best = null;
  for (const segment of segments) {
    for (let index = 1; index < segment.length; index += 1) {
      const projected = projectPoint(point, segment[index - 1], segment[index]);
      if (Math.hypot(projected.direction.x, projected.direction.y) < 1) continue;
      if (!best || projected.distance < best.distance) best = projected;
    }
  }
  if (!best || best.distance > 450) return null;
  const length = Math.hypot(best.direction.x, best.direction.y);
  const halfLengthM = 92;
  const dxLng = (best.direction.x / length) * halfLengthM / (Math.cos(point.lat * Math.PI / 180) * METERS_PER_LAT);
  const dyLat = (best.direction.y / length) * halfLengthM / METERS_PER_LAT;
  return [
    [point.lng - dxLng, point.lat - dyLat],
    [point.lng + dxLng, point.lat + dyLat],
  ];
}

function nearestSegmentDistance(point, segments) {
  let best = Infinity;
  for (const segment of segments) {
    for (let index = 1; index < segment.length; index += 1) {
      best = Math.min(best, projectPoint(point, segment[index - 1], segment[index]).distance);
    }
  }
  return best;
}

function lineCenter(segments) {
  const points = segments.flat();
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return { lng: (Math.min(...lngs) + Math.max(...lngs)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
}

function nearestStation(stations, stop, maxDistanceM = 650) {
  const key = stationKey(stop.name);
  return stations
    .filter((station) => stationKey(station.station_name) === key)
    .map((station) => ({ station, distance: distanceM(station, stop) }))
    .filter(({ distance }) => distance <= maxDistanceM)
    .sort((a, b) => (b.station._priority ?? 0) - (a.station._priority ?? 0) || a.distance - b.distance || a.station.osm_id.localeCompare(b.station.osm_id))[0]?.station ?? null;
}

function isEntrance(node) {
  const railway = tag(node, "railway");
  return railway === "subway_entrance" || (railway === "entrance" && ["subway", "exit"].includes(tag(node, "entrance") ?? ""));
}

function entranceRefOf(node) {
  return tag(node, "ref") ?? tag(node, "entrance_ref") ?? tag(node, "exit") ?? null;
}

const elementsByKey = new Map();
const cacheDirArg = arg("cache-dir", null);
const cacheDir = cacheDirArg ? resolve(cacheDirArg) : null;
if (cacheDir) mkdirSync(cacheDir, { recursive: true });
for (const box of BOXES) {
  const cacheFile = cacheDir ? resolve(cacheDir, `${box.name}.json`) : null;
  let elements = null;
  if (cacheFile) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (Array.isArray(cached)) elements = cached;
    } catch {
      // A partial or absent tile cache is regenerated below.
    }
  }
  if (!elements) {
    elements = await fetchOverpass(queryFor(box));
    if (cacheFile) writeFileSync(cacheFile, `${JSON.stringify(elements)}\n`, "utf8");
  }
  console.log(`${box.name}: ${elements.length} OSM elements${cacheFile ? ` (${cacheFile})` : ""}`);
  for (const element of elements) elementsByKey.set(`${element.type}/${element.id}`, element);
  await sleep(1000);
}

const elements = [...elementsByKey.values()];
const relations = elements.filter((element) => element.type === "relation");
const nodes = elements.filter((element) => element.type === "node");
const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
const publicRelations = relations
  .map((relation) => ({
    relation,
    ref: lineRefOf(relation),
    name: lineNameOf(relation),
    label: canonicalRailLineLabel(lineRefOf(relation), lineNameOf(relation)),
  }))
  .filter(({ ref, name }) => publicRailLine(ref, name));

const stationCandidates = nodes.map(stationCandidate).filter(Boolean);
const stationMap = new Map();
const axes = [];
const lines = [];
const lineSeen = new Set();
const axisSeen = new Set();

function addAxis(station, ref, name, color, segments, label, distance = 0) {
  const endpoints = axisEndpoints(station, segments);
  if (!endpoints) return;
  const key = `${station.osm_id}|${ref}|${name}`;
  if (axisSeen.has(key)) return;
  axisSeen.add(key);
  stationMap.set(station.osm_id, station);
  axes.push({
    station_osm_id: station.osm_id,
    station_name: station.station_name,
    line_ref: ref,
    line_name: name,
    color,
    lat: station.lat,
    lng: station.lng,
    distance_m: Math.round(distance * 10) / 10,
    endpoints,
    label,
  });
}

for (const { relation, ref, name, label } of publicRelations) {
  const segments = relationSegments(relation);
  if (segments.length === 0) continue;
  const stops = routeStopNodes(relation, nodesById);
  const lineId = `relation/${relation.id}`;
  const color = lineColorOf(ref, name, relation);
  const center = lineCenter(segments);
  if (!lineSeen.has(lineId)) {
    lines.push({
      osm_id: lineId,
      line_ref: ref,
      line_name: name,
      color,
      lat: center.lat,
      lng: center.lng,
      geometry: { type: "MultiLineString", coordinates: segments },
    });
    lineSeen.add(lineId);
  }
  for (const stop of stops) {
    let station = nearestStation(stationCandidates, stop);
    if (!station) {
      station = { osm_id: stop.id, station_name: stop.name, lat: stop.lat, lng: stop.lng, _priority: 0, _ref: null };
    }
    const endpoints = axisEndpoints(station, segments);
    if (!endpoints) continue;
    addAxis({ ...station, _ref: station._ref ?? null }, ref, name, color, segments, label, distanceM(station, stop));
  }
  // 일부 GTX-A 관계는 OSM route stop member가 구성·성남 등 전체 역을
  // 아직 포함하지 않는다. 역 후보가 선형에 실제로 붙어 있을 때만 보강해,
  // 성남역처럼 누락된 역이 노선에서 사라지는 것을 막는다.
  if (label === "GTX-A") {
    const nearby = new Map();
    for (const candidate of stationCandidates) {
      const distance = nearestSegmentDistance(candidate, segments);
      if (distance > 260) continue;
      const key = stationKey(candidate.station_name);
      const current = nearby.get(key);
      if (!current || (candidate._priority ?? 0) > (current.candidate._priority ?? 0) || distance < current.distance) {
        nearby.set(key, { candidate, distance });
      }
    }
    for (const { candidate, distance } of nearby.values()) {
      addAxis(candidate, ref, name, color, segments, label, distance);
    }
  }
}

const stations = [...stationMap.values()]
  .map(({ osm_id, station_name, lat, lng }) => ({ osm_id, station_name, lat, lng }))
  .sort((a, b) => a.station_name.localeCompare(b.station_name, "ko") || a.osm_id.localeCompare(b.osm_id));
const stationByName = new Map();
for (const station of stations) {
  const key = stationKey(station.station_name);
  const current = stationByName.get(key);
  if (!current || station.osm_id.localeCompare(current.osm_id) < 0) stationByName.set(key, station);
}

const entrances = [];
const entranceSeen = new Set();
for (const node of nodes.filter(isEntrance)) {
  const point = pointOf(node);
  if (!point) continue;
  const hintedName = tag(node, "station") ?? tag(node, "station_name") ?? tag(node, "station:name");
  let station = hintedName ? stationByName.get(stationKey(hintedName)) : null;
  if (!station) {
    station = stations
      .map((candidate) => ({ candidate, distance: distanceM(candidate, point) }))
      .filter(({ distance }) => distance <= 300)
      .sort((a, b) => a.distance - b.distance || a.candidate.osm_id.localeCompare(b.candidate.osm_id))[0]?.candidate ?? null;
  }
  if (!station || entranceSeen.has(`node/${node.id}`)) continue;
  entranceSeen.add(`node/${node.id}`);
  entrances.push({
    osm_id: `node/${node.id}`,
    station_name: station.station_name,
    ...(nameOf(node) ? { entrance_name: nameOf(node) } : {}),
    ...(entranceRefOf(node) ? { entrance_ref: entranceRefOf(node) } : {}),
    lat: point.lat,
    lng: point.lng,
  });
}

axes.sort((a, b) => a.station_name.localeCompare(b.station_name, "ko") || a.line_ref.localeCompare(b.line_ref) || a.line_name.localeCompare(b.line_name));
lines.sort((a, b) => canonicalRailLineLabel(a.line_ref, a.line_name).localeCompare(canonicalRailLineLabel(b.line_ref, b.line_name), "ko") || a.line_name.localeCompare(b.line_name, "ko") || a.osm_id.localeCompare(b.osm_id));
entrances.sort((a, b) => a.station_name.localeCompare(b.station_name, "ko") || (a.entrance_ref ?? "").localeCompare(b.entrance_ref ?? "", "ko") || a.osm_id.localeCompare(b.osm_id));

const output = resolve(arg("output", DEFAULT_OUTPUT));
const generatedAt = arg("generated-at", new Date().toISOString());
const snapshot = {
  source: "OpenStreetMap Overpass API",
  license: "ODbL-1.0; © OpenStreetMap contributors",
  generated_at: generatedAt,
  stations,
  entrances,
  lines,
  station_axes: axes.map(({ label, ...axis }) => axis),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`wrote ${output}`);
console.log(JSON.stringify({ stations: stations.length, entrances: entrances.length, lines: lines.length, station_axes: axes.length, axis_stations: new Set(axes.map((axis) => axis.station_osm_id)).size, line_refs: new Set(axes.map((axis) => axis.line_ref)).size }, null, 2));

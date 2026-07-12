// OSM 기반 지하철 오버레이(역사도식선·노선라벨·출입구 커넥터) 렌더링 모듈.
//
// 출처: codex/siteanalysis-subway-osm-coordinates 브랜치의 src/components/map-view.tsx
// (2026-05-27 집GPT[13-jipgpt-main] 표시 방식 이식본)에서 addOsmSubwayOverlay와 그 의존
// 함수들만 그대로 옮겨온 것이다. 로직·스타일 상수는 원본과 동일하게 유지한다.
//
// 원본에는 addOsmSubwayOverlay 외에도 SubwayRoute 기반의 구식 axisForStation/
// entrancesForAxis/addSubwayOverlay 경로가 있었으나, 이는 addOsmSubwayOverlay가
// 호출하지 않는 별도 폴백 구현이며 main의 실제 폴백(naver station bar)과는 무관하다.
// 이 모듈은 addOsmSubwayOverlay 실행에 필요한 함수만 옮긴다.

import type { AnalysisConfig } from "@/lib/types";
import { haversineDistance } from "@/lib/geo";

const METERS_PER_LAT = 111_320;
const SUBWAY_STATION_AXIS_BASE_HALF_LENGTH_M = 92;
const SUBWAY_STATION_AXIS_MAX_HALF_LENGTH_M = 260;
const SUBWAY_STATION_AXIS_GEOMETRY_MATCH_RADIUS_M = 190;
const SUBWAY_STATION_AXIS_ENTRANCE_STRETCH_RADIUS_M = 100;
const SUBWAY_ENTRANCE_CONNECTOR_MAX_DISTANCE_M = 60;

type LatLng = { readonly lat: number; readonly lng: number };
type LatLngTuple = [number, number];

export type SubwayMapStation = {
  readonly station_name: string;
  readonly lat: number;
  readonly lng: number;
};

export type SubwayMapEntrance = {
  readonly osm_id?: string;
  readonly station_name: string;
  readonly entrance_name?: string;
  readonly entrance_ref?: string;
  readonly lat: number;
  readonly lng: number;
};

export type SubwayMapLine = {
  readonly line_ref: string;
  readonly line_name: string;
  readonly color: string;
  readonly lat: number;
  readonly lng: number;
  readonly geometry: unknown;
};

export type SubwayStationAxis = {
  readonly station_osm_id?: string;
  readonly station_name: string;
  readonly line_ref: string;
  readonly line_name: string;
  readonly color: string;
  readonly lat: number;
  readonly lng: number;
  readonly distance_m?: number;
  readonly endpoints: [[number, number], [number, number]];
};

export type SubwayMapResponse = {
  readonly source: string;
  readonly license: string;
  readonly generated_at: string;
  readonly stations: SubwayMapStation[];
  readonly entrances: SubwayMapEntrance[];
  readonly lines: SubwayMapLine[];
  readonly station_axes: SubwayStationAxis[];
};

type SubwayLineProjection = {
  readonly lat: number;
  readonly lng: number;
  readonly distanceM: number;
  readonly offsetM: number;
  readonly totalLengthM: number;
  readonly line: [number, number][];
};

type RenderedSubwayAxis = {
  readonly axis: SubwayStationAxis;
  readonly latLngs: LatLngTuple[];
  readonly curveMatched: boolean;
};

type SubwayEntranceConnector = {
  readonly fromLat: number;
  readonly fromLng: number;
  readonly toLat: number;
  readonly toLng: number;
  readonly color: string;
};

type SubwayLineViewportScore = {
  readonly total: number;
  readonly visible: number;
  readonly crossing: number;
};

type SubwayLineAxisScore = {
  readonly matchCount: number;
  readonly averageDistanceM: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function subwayLineColor(value: string | undefined): string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value! : "#475569";
}

export function subwayLineLabelText(lineRef: string | undefined, lineName?: string | undefined): string {
  const ref = lineRef?.trim() ?? "";
  const name = lineName?.trim() ?? "";
  if (/^[1-9]$/u.test(ref)) {
    return `${ref}호선`;
  }
  const numberMatch = (name || ref).match(/(\d+)호선/u);
  if (numberMatch) {
    return `${numberMatch[1]}호선`;
  }

  return ref || name.replace(/수도권 전철\s*/u, "").replace(/:.*/u, "");
}

function subwayStationBadgeText(line: string): string {
  const trimmed = line.trim();
  const numberMatch = trimmed.match(/(\d+)호선/u);
  if (numberMatch) {
    return numberMatch[1];
  }

  return trimmed.replace(/선$/u, "").slice(0, 4);
}

function subwayStationBadgeTextColor(color: string | undefined): string {
  const hex = subwayLineColor(color).replace("#", "");
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#111827" : "#ffffff";
}

function subwayStationDisplayName(name: string): string {
  const trimmed = name.trim();
  return trimmed.endsWith("역") ? trimmed : `${trimmed}역`;
}

export function subwayStationIconHtml(stationName: string, line: string, color: string): string {
  const badgeText = subwayStationBadgeText(line);
  const badgeColor = subwayLineColor(color);
  const textColor = subwayStationBadgeTextColor(color);
  const badge = badgeText
    ? `<span class="site-subway-station-badge" style="--subway-color:${badgeColor};--subway-text:${textColor}">${escapeHtml(badgeText)}</span>`
    : "";

  return `<div class="site-subway-station">${badge}<span class="site-subway-station-name">${escapeHtml(subwayStationDisplayName(stationName))}</span></div>`;
}

function subwayEntranceIconHtml(refText: string): string {
  return `<div class="site-subway-entrance">${escapeHtml(refText)}</div>`;
}

function subwayEntranceLabel(entrance: SubwayMapEntrance): string {
  if (entrance.entrance_ref) {
    return `${entrance.station_name} ${entrance.entrance_ref}번 출구`;
  }
  return entrance.entrance_name || `${entrance.station_name} 출입구`;
}

export function normalizedSubwayStationName(value: string): string {
  return value.replace(/\s+/g, "").replace(/역$/u, "");
}

export function isPublicSubwayLineRef(value: string | undefined): boolean {
  const ref = value?.trim() ?? "";
  if (/^[1-9]$/u.test(ref)) {
    return true;
  }
  if (/^(?:부산[1-4]|대구[1-3]|대전1|광주1|인천[1-2])$/u.test(ref)) {
    return true;
  }

  return new Set([
    "경의중앙",
    "경춘",
    "수인분당",
    "신분당",
    "공항",
    "우이신설",
    "서해",
    "김포골드",
    "성수지선",
    "신정지선",
    "마천지선",
    "하남선",
    "별내선",
  ]).has(ref);
}

export function isPublicSubwayAxis(axis: SubwayStationAxis): boolean {
  return isPublicSubwayLineRef(axis.line_ref);
}

function subwayLineLabelHtml(label: string, color: string, angle: number): string {
  return `<span class="site-subway-line-label" style="--subway-color:${subwayLineColor(color)};--subway-angle:${angle.toFixed(1)}deg">${escapeHtml(label)}</span>`;
}

function metersPerLngAtLat(lat: number): number {
  return Math.max(1, Math.cos(lat * Math.PI / 180) * METERS_PER_LAT);
}

function latLngDistanceM(start: LatLng, end: LatLng): number {
  const metersPerLng = metersPerLngAtLat((start.lat + end.lat) / 2);
  const dx = (end.lng - start.lng) * metersPerLng;
  const dy = (end.lat - start.lat) * METERS_PER_LAT;
  return Math.hypot(dx, dy);
}

function nearestPointOnSegment(point: LatLng, start: LatLng, end: LatLng) {
  const metersPerLng = metersPerLngAtLat((point.lat + start.lat + end.lat) / 3);
  const startX = start.lng * metersPerLng;
  const startY = start.lat * METERS_PER_LAT;
  const endX = end.lng * metersPerLng;
  const endY = end.lat * METERS_PER_LAT;
  const pointX = point.lng * metersPerLng;
  const pointY = point.lat * METERS_PER_LAT;
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const rawT = lengthSquared === 0 ? 0 : ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const lat = start.lat + (end.lat - start.lat) * t;
  const lng = start.lng + (end.lng - start.lng) * t;

  return {
    lat,
    lng,
    t,
    distanceM: latLngDistanceM(point, { lat, lng }),
  };
}

function interpolateLatLng(start: LatLng, end: LatLng, t: number): LatLngTuple {
  return [start.lat + (end.lat - start.lat) * t, start.lng + (end.lng - start.lng) * t];
}

function subwayStationKeySet(stations: readonly SubwayMapStation[]): Set<string> {
  return new Set(
    stations
      .map((station) => normalizedSubwayStationName(station.station_name))
      .filter(Boolean)
  );
}

function subwayExplicitEntranceStationKey(
  entrance: SubwayMapEntrance,
  stationKeys: Set<string>
): string | null {
  const text = entrance.entrance_name ?? "";
  const candidates = Array.from(text.matchAll(/([가-힣A-Za-z0-9·().\-\s]{1,40})역(?=$|[^가-힣A-Za-z])/gu))
    .map((match) => normalizedSubwayStationName(match[1].replace(/\([^)]*\)/g, "")))
    .filter((key) => stationKeys.has(key));

  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

function subwayEntranceDisplayScore(
  entrance: SubwayMapEntrance,
  assignedStationKey: string,
  stationKeys: Set<string>
): number {
  const explicitStationKey = subwayExplicitEntranceStationKey(entrance, stationKeys);
  if (explicitStationKey === assignedStationKey) {
    return 0;
  }
  if (entrance.entrance_name?.includes(entrance.station_name)) {
    return 1;
  }
  return 2;
}

export function displayableSubwayEntrances(
  entrances: SubwayMapEntrance[],
  stations: readonly SubwayMapStation[]
): SubwayMapEntrance[] {
  const stationKeys = subwayStationKeySet(stations);
  const byStationRef = new Map<string, SubwayMapEntrance>();
  const result: SubwayMapEntrance[] = [];

  entrances.forEach((entrance) => {
    const assignedStationKey = normalizedSubwayStationName(entrance.station_name);
    const explicitStationKey = subwayExplicitEntranceStationKey(entrance, stationKeys);
    if (explicitStationKey && explicitStationKey !== assignedStationKey) {
      return;
    }

    const refText = entrance.entrance_ref?.trim();
    if (!refText) {
      result.push(entrance);
      return;
    }

    const key = `${assignedStationKey}|${refText}`;
    const current = byStationRef.get(key);
    if (
      !current ||
      subwayEntranceDisplayScore(entrance, assignedStationKey, stationKeys) <
        subwayEntranceDisplayScore(current, assignedStationKey, stationKeys)
    ) {
      byStationRef.set(key, entrance);
    }
  });

  result.push(...byStationRef.values());
  return result.sort(
    (a, b) =>
      normalizedSubwayStationName(a.station_name).localeCompare(normalizedSubwayStationName(b.station_name), "ko") ||
      (a.entrance_ref?.trim() || "9999").localeCompare(b.entrance_ref?.trim() || "9999", "ko", { numeric: true })
  );
}

function subwayAxisRenderKey(axis: SubwayStationAxis): string {
  return [
    normalizedSubwayStationName(axis.station_name),
    axis.line_ref.trim(),
    subwayLineColor(axis.color),
  ].join("|");
}

function subwayAxisDistance(axis: SubwayStationAxis): number {
  const value = Number(axis.distance_m);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function dedupeSubwayStationAxes(axes: SubwayStationAxis[]): SubwayStationAxis[] {
  const byKey = new Map<string, SubwayStationAxis>();
  axes.forEach((axis) => {
    const key = subwayAxisRenderKey(axis);
    const current = byKey.get(key);
    if (!current || subwayAxisDistance(axis) < subwayAxisDistance(current)) {
      byKey.set(key, axis);
    }
  });

  return Array.from(byKey.values());
}

export function axisLatLngs(axis: SubwayStationAxis): LatLngTuple[] {
  return axis.endpoints.map(([lng, lat]) => [lat, lng]);
}

export function subwayCoordToLatLng(coord: [number, number]): LatLng | null {
  const [lng, lat] = coord;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

function subwayProjectPointOnLngLatLine(point: LatLng, line: [number, number][]): SubwayLineProjection | null {
  let totalLengthM = 0;
  let best: SubwayLineProjection | null = null;

  for (let index = 0; index < line.length - 1; index += 1) {
    const start = subwayCoordToLatLng(line[index]);
    const end = subwayCoordToLatLng(line[index + 1]);
    if (!start || !end) {
      continue;
    }

    const segmentLengthM = latLngDistanceM(start, end);
    if (segmentLengthM <= 0) {
      continue;
    }

    const projection = nearestPointOnSegment(point, start, end);
    const candidate: SubwayLineProjection = {
      lat: projection.lat,
      lng: projection.lng,
      distanceM: projection.distanceM,
      offsetM: totalLengthM + segmentLengthM * projection.t,
      totalLengthM: 0,
      line,
    };
    if (!best || candidate.distanceM < best.distanceM) {
      best = candidate;
    }
    totalLengthM += segmentLengthM;
  }

  return best ? { ...best, totalLengthM } : null;
}

function subwayPushUniqueLatLng(points: LatLngTuple[], point: LatLngTuple): void {
  const previous = points[points.length - 1];
  if (!previous || latLngDistanceM({ lat: previous[0], lng: previous[1] }, { lat: point[0], lng: point[1] }) > 0.8) {
    points.push(point);
  }
}

function subwaySliceLngLatLine(
  line: [number, number][],
  startOffsetM: number,
  endOffsetM: number
): LatLngTuple[] {
  const points: LatLngTuple[] = [];
  let cursorM = 0;
  const startM = Math.max(0, startOffsetM);
  const endM = Math.max(startM, endOffsetM);

  for (let index = 0; index < line.length - 1; index += 1) {
    const start = subwayCoordToLatLng(line[index]);
    const end = subwayCoordToLatLng(line[index + 1]);
    if (!start || !end) {
      continue;
    }

    const segmentLengthM = latLngDistanceM(start, end);
    if (segmentLengthM <= 0) {
      continue;
    }

    const segmentStartM = cursorM;
    const segmentEndM = cursorM + segmentLengthM;
    if (segmentEndM >= startM && segmentStartM <= endM) {
      const localStart = Math.max(0, (startM - segmentStartM) / segmentLengthM);
      const localEnd = Math.min(1, (endM - segmentStartM) / segmentLengthM);
      subwayPushUniqueLatLng(points, interpolateLatLng(start, end, localStart));
      subwayPushUniqueLatLng(points, interpolateLatLng(start, end, localEnd));
    }

    cursorM = segmentEndM;
    if (cursorM > endM) {
      break;
    }
  }

  return points.length >= 2 ? points : [];
}

export function nearestPointOnAxis(point: LatLng, axis: SubwayStationAxis): LatLng & { readonly distanceSquared: number } {
  const [[lng1, lat1], [lng2, lat2]] = axis.endpoints;
  const dx = lng2 - lng1;
  const dy = lat2 - lat1;
  const lengthSquared = dx * dx + dy * dy;
  const rawT = lengthSquared === 0 ? 0 : ((point.lng - lng1) * dx + (point.lat - lat1) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const lng = lng1 + dx * t;
  const lat = lat1 + dy * t;

  return {
    lat,
    lng,
    distanceSquared: (point.lng - lng) ** 2 + (point.lat - lat) ** 2,
  };
}

export function stationAxesForStation(
  station: SubwayMapStation,
  axes: SubwayStationAxis[]
): SubwayStationAxis[] {
  const stationName = normalizedSubwayStationName(station.station_name);
  return axes
    .filter((axis) => normalizedSubwayStationName(axis.station_name) === stationName)
    .map((axis) => ({
      axis,
      distanceSquared: nearestPointOnAxis(station, axis).distanceSquared,
    }))
    .filter((item) => item.distanceSquared <= 0.000025)
    .sort((a, b) => a.distanceSquared - b.distanceSquared)
    .map((item) => item.axis);
}

function subwayNearestPointOnLatLngs(point: LatLng, latLngs: LatLngTuple[]): (LatLng & { readonly distanceM: number }) | null {
  let best: (LatLng & { readonly distanceM: number }) | null = null;

  for (let index = 0; index < latLngs.length - 1; index += 1) {
    const [startLat, startLng] = latLngs[index];
    const [endLat, endLng] = latLngs[index + 1];
    const projection = nearestPointOnSegment(point, { lat: startLat, lng: startLng }, { lat: endLat, lng: endLng });
    if (!best || projection.distanceM < best.distanceM) {
      best = {
        lat: projection.lat,
        lng: projection.lng,
        distanceM: projection.distanceM,
      };
    }
  }

  return best;
}

export function subwayEntranceConnector(
  entrance: SubwayMapEntrance,
  axes: RenderedSubwayAxis[]
): SubwayEntranceConnector | null {
  const stationName = normalizedSubwayStationName(entrance.station_name);
  const candidates = axes
    .filter(({ axis }) => normalizedSubwayStationName(axis.station_name) === stationName)
    .map((shape) => {
      const point = subwayNearestPointOnLatLngs(entrance, shape.latLngs);
      return point ? { shape, point } : null;
    })
    .filter((item): item is { shape: RenderedSubwayAxis; point: LatLng & { readonly distanceM: number } } => Boolean(item))
    .sort((a, b) => a.point.distanceM - b.point.distanceM);

  const best = candidates[0];
  if (!best || best.point.distanceM > SUBWAY_ENTRANCE_CONNECTOR_MAX_DISTANCE_M) {
    return null;
  }

  return {
    fromLat: best.point.lat,
    fromLng: best.point.lng,
    toLat: entrance.lat,
    toLng: entrance.lng,
    color: subwayLineColor(best.shape.axis.color),
  };
}

export function axisTouchesBounds(axis: SubwayStationAxis, bounds: import("leaflet").LatLngBounds): boolean {
  if (bounds.contains([axis.lat, axis.lng])) {
    return true;
  }

  return axisLatLngs(axis).some((latLng) => bounds.contains(latLng));
}

function subwaySegmentTouchesBounds(
  start: LatLng,
  end: LatLng,
  bounds: import("leaflet").LatLngBounds
): boolean {
  if (bounds.contains([start.lat, start.lng]) || bounds.contains([end.lat, end.lng])) {
    return true;
  }

  const midLat = (start.lat + end.lat) / 2;
  const midLng = (start.lng + end.lng) / 2;
  if (bounds.contains([midLat, midLng])) {
    return true;
  }

  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  return (
    Math.max(start.lat, end.lat) >= south &&
    Math.min(start.lat, end.lat) <= north &&
    Math.max(start.lng, end.lng) >= west &&
    Math.min(start.lng, end.lng) <= east
  );
}

function geometryTouchesBounds(geometry: unknown, bounds: import("leaflet").LatLngBounds): boolean {
  if (!geometry || typeof geometry !== "object") {
    return false;
  }

  const typed = geometry as { readonly type?: string; readonly coordinates?: unknown };
  const hasCoord = (coord: unknown): boolean => {
    if (!Array.isArray(coord) || coord.length < 2) {
      return false;
    }
    const [lng, lat] = coord;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return false;
    }
    return bounds.contains([lat, lng]);
  };
  const lineTouchesBounds = (line: unknown): boolean => {
    if (!Array.isArray(line)) {
      return false;
    }
    for (let index = 0; index < line.length - 1; index += 1) {
      const start = line[index];
      const end = line[index + 1];
      if (
        Array.isArray(start) &&
        Array.isArray(end) &&
        start.length >= 2 &&
        end.length >= 2 &&
        typeof start[0] === "number" &&
        typeof start[1] === "number" &&
        typeof end[0] === "number" &&
        typeof end[1] === "number" &&
        subwaySegmentTouchesBounds({ lat: start[1], lng: start[0] }, { lat: end[1], lng: end[0] }, bounds)
      ) {
        return true;
      }
    }
    return false;
  };

  if (typed.type === "LineString" && Array.isArray(typed.coordinates)) {
    return typed.coordinates.some(hasCoord) || lineTouchesBounds(typed.coordinates);
  }

  if (typed.type === "MultiLineString" && Array.isArray(typed.coordinates)) {
    return typed.coordinates.some((line) => Array.isArray(line) && (line.some(hasCoord) || lineTouchesBounds(line)));
  }

  return false;
}

function geometryPointStats(geometry: unknown, bounds: import("leaflet").LatLngBounds): SubwayLineViewportScore {
  if (!geometry || typeof geometry !== "object") {
    return { total: 0, visible: 0, crossing: 0 };
  }

  const typed = geometry as { readonly type?: string; readonly coordinates?: unknown };
  const lines: unknown[][] = [];
  if (typed.type === "LineString" && Array.isArray(typed.coordinates)) {
    lines.push(typed.coordinates);
  } else if (typed.type === "MultiLineString" && Array.isArray(typed.coordinates)) {
    typed.coordinates.forEach((line) => {
      if (Array.isArray(line)) {
        lines.push(line);
      }
    });
  }

  const coords = lines.flat();
  let visible = 0;
  let crossing = 0;
  coords.forEach((coord) => {
    if (!Array.isArray(coord) || coord.length < 2) {
      return;
    }
    const [lng, lat] = coord;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return;
    }
    if (bounds.contains([lat, lng])) {
      visible += 1;
    }
  });

  lines.forEach((line) => {
    for (let index = 0; index < line.length - 1; index += 1) {
      const start = line[index];
      const end = line[index + 1];
      if (
        Array.isArray(start) &&
        Array.isArray(end) &&
        start.length >= 2 &&
        end.length >= 2 &&
        typeof start[0] === "number" &&
        typeof start[1] === "number" &&
        typeof end[0] === "number" &&
        typeof end[1] === "number" &&
        subwaySegmentTouchesBounds({ lat: start[1], lng: start[0] }, { lat: end[1], lng: end[0] }, bounds)
      ) {
        crossing += 1;
      }
    }
  });

  return { total: coords.length, visible, crossing };
}

function subwayLineRenderGroup(line: SubwayMapLine): string {
  const ref = line.line_ref.trim();
  const compactName = line.line_name.replace(/\s+/g, "");
  const branch = ["성수지선", "신정지선", "마천", "하남", "별내"].find((name) => compactName.includes(name));
  return branch ? `${ref}:${branch}` : ref;
}

export function subwayGeometryLines(geometry: unknown): [number, number][][] {
  if (!geometry || typeof geometry !== "object") {
    return [];
  }

  const typed = geometry as { readonly type?: string; readonly coordinates?: unknown };
  if (typed.type === "LineString" && Array.isArray(typed.coordinates)) {
    return [typed.coordinates as [number, number][]];
  }
  if (typed.type === "MultiLineString" && Array.isArray(typed.coordinates)) {
    return typed.coordinates.filter(Array.isArray) as [number, number][][];
  }

  return [];
}

function subwayLineAxisDistanceScore(line: SubwayMapLine, axes: SubwayStationAxis[]): SubwayLineAxisScore {
  const lineRef = line.line_ref.trim();
  const distances: number[] = [];

  axes
    .filter((axis) => axis.line_ref.trim() === lineRef)
    .forEach((axis) => {
      let bestDistanceM = Number.POSITIVE_INFINITY;
      const axisPoint = { lat: axis.lat, lng: axis.lng };
      subwayGeometryLines(line.geometry).forEach((geometryLine) => {
        const projection = subwayProjectPointOnLngLatLine(axisPoint, geometryLine);
        if (projection) {
          bestDistanceM = Math.min(bestDistanceM, projection.distanceM);
        }
      });
      if (bestDistanceM <= SUBWAY_STATION_AXIS_GEOMETRY_MATCH_RADIUS_M) {
        distances.push(bestDistanceM);
      }
    });

  if (!distances.length) {
    return { matchCount: 0, averageDistanceM: Number.POSITIVE_INFINITY };
  }

  return {
    matchCount: distances.length,
    averageDistanceM: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
  };
}

export function representativeSubwayLines(
  lines: readonly SubwayMapLine[],
  bounds: import("leaflet").LatLngBounds,
  axes: SubwayStationAxis[] = []
): SubwayMapLine[] {
  const candidates = new Map<
    string,
    {
      readonly line: SubwayMapLine;
      readonly score: SubwayLineViewportScore;
      readonly axisScore: SubwayLineAxisScore;
      readonly routeLike: boolean;
    }
  >();
  const visibleAxes = axes.filter((axis) => axisTouchesBounds(axis, bounds));

  lines
    .filter((line) => isPublicSubwayLineRef(line.line_ref))
    .filter((line) => geometryTouchesBounds(line.geometry, bounds))
    .forEach((line) => {
      const key = subwayLineRenderGroup(line);
      const score = geometryPointStats(line.geometry, bounds);
      const axisScore = subwayLineAxisDistanceScore(line, visibleAxes);
      const routeLike = line.line_name.includes("→") || line.line_name.includes(":");
      const current = candidates.get(key);
      const axisDistanceComparable = Boolean(current && axisScore.matchCount > 0 && current.axisScore.matchCount > 0);
      const axisDistanceClose =
        !axisDistanceComparable || Math.abs(axisScore.averageDistanceM - current!.axisScore.averageDistanceM) <= 1;
      const viewportScore = score.visible + score.crossing;
      const currentViewportScore = current ? current.score.visible + current.score.crossing : -1;

      if (
        !current ||
        (routeLike && !current.routeLike) ||
        (routeLike === current.routeLike && axisScore.matchCount > current.axisScore.matchCount) ||
        (
          routeLike === current.routeLike &&
          axisScore.matchCount === current.axisScore.matchCount &&
          axisScore.matchCount > 0 &&
          axisScore.averageDistanceM + 1 < current.axisScore.averageDistanceM
        ) ||
        (
          routeLike === current.routeLike &&
          axisScore.matchCount === current.axisScore.matchCount &&
          axisDistanceClose &&
          viewportScore > currentViewportScore
        ) ||
        (
          routeLike === current.routeLike &&
          axisScore.matchCount === current.axisScore.matchCount &&
          axisDistanceClose &&
          score.visible === current.score.visible &&
          score.crossing === current.score.crossing &&
          score.total > current.score.total
        )
      ) {
        candidates.set(key, { line, score, axisScore, routeLike });
      }
    });

  return Array.from(candidates.values()).map(({ line }) => line);
}

export function subwayStationAxisShape(
  axis: SubwayStationAxis,
  lines: readonly SubwayMapLine[],
  entrances: readonly SubwayMapEntrance[]
): RenderedSubwayAxis {
  const axisPoint = { lat: axis.lat, lng: axis.lng };
  const axisRef = axis.line_ref.trim();
  let best: SubwayLineProjection | null = null;

  for (const line of lines) {
    if (line.line_ref.trim() !== axisRef || !isPublicSubwayLineRef(line.line_ref)) {
      continue;
    }
    for (const geometryLine of subwayGeometryLines(line.geometry)) {
      const projection = subwayProjectPointOnLngLatLine(axisPoint, geometryLine);
      if (!projection) {
        continue;
      }
      if (!best || projection.distanceM < best.distanceM) {
        best = projection;
      }
    }
  }

  if (!best || best.distanceM > SUBWAY_STATION_AXIS_GEOMETRY_MATCH_RADIUS_M) {
    return {
      axis,
      latLngs: axisLatLngs(axis),
      curveMatched: false,
    };
  }

  const stationName = normalizedSubwayStationName(axis.station_name);
  let startOffsetM = best.offsetM - SUBWAY_STATION_AXIS_BASE_HALF_LENGTH_M;
  let endOffsetM = best.offsetM + SUBWAY_STATION_AXIS_BASE_HALF_LENGTH_M;

  entrances
    .filter((entrance) => normalizedSubwayStationName(entrance.station_name) === stationName)
    .forEach((entrance) => {
      const entranceProjection = subwayProjectPointOnLngLatLine(entrance, best!.line);
      if (!entranceProjection) {
        return;
      }
      if (entranceProjection.distanceM > SUBWAY_STATION_AXIS_ENTRANCE_STRETCH_RADIUS_M) {
        return;
      }
      startOffsetM = Math.min(startOffsetM, entranceProjection.offsetM - 10);
      endOffsetM = Math.max(endOffsetM, entranceProjection.offsetM + 10);
    });

  startOffsetM = Math.max(best.offsetM - SUBWAY_STATION_AXIS_MAX_HALF_LENGTH_M, startOffsetM);
  endOffsetM = Math.min(best.offsetM + SUBWAY_STATION_AXIS_MAX_HALF_LENGTH_M, endOffsetM);

  const latLngs = subwaySliceLngLatLine(best.line, startOffsetM, endOffsetM);
  return {
    axis,
    latLngs: latLngs.length >= 2 ? latLngs : axisLatLngs(axis),
    curveMatched: latLngs.length >= 2,
  };
}

export function subwayAxisShapeTouchesBounds(
  shape: RenderedSubwayAxis,
  bounds: import("leaflet").LatLngBounds
): boolean {
  if (bounds.contains([shape.axis.lat, shape.axis.lng])) {
    return true;
  }
  return shape.latLngs.some((latLng) => bounds.contains(latLng));
}

export function osmSubwayLineLabelPlacement(
  geometry: unknown,
  bounds: import("leaflet").LatLngBounds,
  map: import("leaflet").Map
): { readonly lat: number; readonly lng: number; readonly angle: number } | null {
  const center = bounds.getCenter();
  const placements: Array<{ lat: number; lng: number; angle: number; score: number }> = [];

  subwayGeometryLines(geometry).forEach((line) => {
    for (let index = 0; index < line.length - 1; index += 1) {
      const [startLng, startLat] = line[index];
      const [endLng, endLat] = line[index + 1];
      if (![startLat, startLng, endLat, endLng].every(Number.isFinite)) {
        continue;
      }

      const midLat = (startLat + endLat) / 2;
      const midLng = (startLng + endLng) / 2;
      if (!bounds.contains([startLat, startLng]) && !bounds.contains([endLat, endLng]) && !bounds.contains([midLat, midLng])) {
        continue;
      }

      const startPoint = map.latLngToLayerPoint([startLat, startLng]);
      const endPoint = map.latLngToLayerPoint([endLat, endLng]);
      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      const pixelLength = Math.hypot(dx, dy);
      if (pixelLength < 42) {
        continue;
      }

      let angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (angle > 90) {
        angle -= 180;
      }
      if (angle < -90) {
        angle += 180;
      }

      const centerPenalty = Math.hypot((midLat - center.lat) * 111_000, (midLng - center.lng) * 88_000) / 90;
      placements.push({ lat: midLat, lng: midLng, angle, score: pixelLength - centerPenalty });
    }
  });

  const best = placements.sort((a, b) => b.score - a.score)[0];
  return best ? { lat: best.lat, lng: best.lng, angle: best.angle } : null;
}

/**
 * 집GPT식 OSM 지하철 오버레이(역사도식선·노선라벨·출입구 커넥터)를 subwayLayer에 그린다.
 * codex/siteanalysis-subway-osm-coordinates 브랜치의 addOsmSubwayOverlay(map-view.tsx 1219행)와
 * 로직·스타일 상수가 동일하다.
 */
export function addOsmSubwayOverlay(
  L: typeof import("leaflet"),
  map: import("leaflet").Map,
  subwayLayer: import("leaflet").LayerGroup,
  config: AnalysisConfig,
  data: SubwayMapResponse
) {
  const bounds = map.getBounds().pad(0.12);
  const radiusM = config.radiusKm * 1000;
  const publicStationAxes = dedupeSubwayStationAxes((data.station_axes ?? []).filter(isPublicSubwayAxis));
  const visibleSubwayLines = representativeSubwayLines(data.lines ?? [], bounds, publicStationAxes);
  const visibleStationKeys = new Set(
    (data.stations ?? [])
      .filter((station) => Number.isFinite(station.lat) && Number.isFinite(station.lng))
      .filter((station) => haversineDistance(config.centerLat, config.centerLng, station.lat, station.lng) <= radiusM)
      .map((station) => normalizedSubwayStationName(station.station_name))
  );
  const visibleEntrances = displayableSubwayEntrances(
    (data.entrances ?? [])
      .filter((entrance) => bounds.contains([entrance.lat, entrance.lng]))
      .filter((entrance) => visibleStationKeys.has(normalizedSubwayStationName(entrance.station_name)))
      .filter((entrance) => haversineDistance(config.centerLat, config.centerLng, entrance.lat, entrance.lng) <= radiusM + 220),
    data.stations ?? []
  ).slice(0, 180);
  const connectorStationNames = new Set(visibleEntrances.map((entrance) => normalizedSubwayStationName(entrance.station_name)));
  const stationAxisShapes = publicStationAxes
    .filter((axis) => {
      const stationName = normalizedSubwayStationName(axis.station_name);
      return visibleStationKeys.has(stationName) || connectorStationNames.has(stationName);
    })
    .filter((axis) => axisTouchesBounds(axis, bounds) || connectorStationNames.has(normalizedSubwayStationName(axis.station_name)))
    .map((axis) =>
      subwayStationAxisShape(
        axis,
        visibleSubwayLines.length ? visibleSubwayLines : data.lines ?? [],
        data.entrances ?? []
      )
    );
  const visibleStationAxisShapes = stationAxisShapes
    .filter((shape) => subwayAxisShapeTouchesBounds(shape, bounds))
    .slice(0, 110);

  const visibleLineSubset = visibleSubwayLines.slice(0, 80);
  visibleLineSubset.forEach((line) => {
    subwayGeometryLines(line.geometry).forEach((geometryLine) => {
      const latLngs = geometryLine
        .map(subwayCoordToLatLng)
        .filter((point): point is LatLng => point !== null)
        .map((point) => [point.lat, point.lng] as LatLngTuple);
      if (latLngs.length < 2) {
        return;
      }

      const hasRef = Boolean(line.line_ref);
      subwayLayer.addLayer(
        L.polyline(latLngs, {
          interactive: false,
          color: subwayLineColor(line.color),
          weight: hasRef ? 3.6 : 1.8,
          opacity: hasRef ? 0.66 : 0.22,
          lineCap: "round",
          lineJoin: "round",
        })
      );
    });
  });

  visibleLineSubset.forEach((line) => {
    const label = subwayLineLabelText(line.line_ref, line.line_name);
    const placement = osmSubwayLineLabelPlacement(line.geometry, bounds, map);
    if (!label || !placement) {
      return;
    }

    subwayLayer.addLayer(
      L.marker([placement.lat, placement.lng], {
        interactive: false,
        icon: L.divIcon({
          className: "site-subway-line-label-wrap",
          html: subwayLineLabelHtml(label, line.color, placement.angle),
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
      })
    );
  });

  visibleStationAxisShapes.forEach((shape) => {
    subwayLayer.addLayer(
      L.polyline(shape.latLngs, {
        interactive: false,
        color: "#ffffff",
        weight: 13.5,
        opacity: 0.86,
        lineCap: shape.curveMatched ? "round" : "butt",
        lineJoin: "round",
      })
    );
    subwayLayer.addLayer(
      L.polyline(shape.latLngs, {
        interactive: false,
        color: subwayLineColor(shape.axis.color),
        weight: 9,
        opacity: 0.96,
        lineCap: shape.curveMatched ? "round" : "butt",
        lineJoin: "round",
      })
    );
  });

  const stationGroups = new Map<
    string,
    {
      stationName: string;
      lineRef: string;
      lineName: string;
      color: string;
      lat: number;
      lng: number;
      count: number;
    }
  >();
  (data.stations ?? [])
    .filter((station) => bounds.contains([station.lat, station.lng]))
    .filter((station) => visibleStationKeys.has(normalizedSubwayStationName(station.station_name)))
    .forEach((station) => {
      const axes = stationAxesForStation(station, publicStationAxes);
      axes.forEach((axis) => {
        const axisKey = [
          normalizedSubwayStationName(station.station_name),
          axis.line_ref,
          subwayLineColor(axis.color),
        ].join("|");
        const group = stationGroups.get(axisKey) ?? {
          stationName: station.station_name,
          lineRef: axis.line_ref,
          lineName: axis.line_name,
          color: axis.color,
          lat: 0,
          lng: 0,
          count: 0,
        };
        group.lat += axis.lat;
        group.lng += axis.lng;
        group.count += 1;
        stationGroups.set(axisKey, group);
      });
    });

  Array.from(stationGroups.values())
    .slice(0, 80)
    .forEach((group) => {
      subwayLayer.addLayer(
        L.marker([group.lat / group.count, group.lng / group.count], {
          interactive: false,
          icon: L.divIcon({
            className: "site-subway-station-wrap",
            html: subwayStationIconHtml(group.stationName, group.lineRef || group.lineName, group.color),
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        })
      );
    });

  visibleEntrances.forEach((entrance) => {
    const connector = subwayEntranceConnector(entrance, stationAxisShapes);
    if (!connector) {
      return;
    }

    const latLngs: LatLngTuple[] = [
      [connector.fromLat, connector.fromLng],
      [connector.toLat, connector.toLng],
    ];
    subwayLayer.addLayer(
      L.polyline(latLngs, {
        interactive: false,
        color: "#ffffff",
        weight: 3.2,
        opacity: 0.78,
        lineCap: "round",
        lineJoin: "round",
      })
    );
    subwayLayer.addLayer(
      L.polyline(latLngs, {
        interactive: false,
        color: connector.color,
        weight: 1.2,
        opacity: 0.82,
        lineCap: "round",
        lineJoin: "round",
      })
    );
  });

  visibleEntrances.forEach((entrance) => {
    subwayLayer.addLayer(
      L.marker([entrance.lat, entrance.lng], {
        interactive: true,
        icon: L.divIcon({
          className: "site-subway-entrance-wrap",
          html: subwayEntranceIconHtml(entrance.entrance_ref?.trim() || "E"),
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).bindTooltip(subwayEntranceLabel(entrance), {
        direction: "top",
        opacity: 0.94,
      })
    );
  });
}

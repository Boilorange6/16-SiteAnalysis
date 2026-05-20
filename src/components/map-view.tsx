"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type {
  AnalysisConfig,
  Apartment,
  LayerVisibility,
  Poi,
  PoiPosition,
  RadiusPosition,
  ResidentialPoi,
  MaintenanceProject,
  Park,
  SubwayRoute,
  SubwayStation,
} from "@/lib/types";
import type { InsightOverlay } from "@/lib/analysis-engine";
import { THEME_COLORS } from "@/lib/types";
import { haversineDistance } from "@/lib/geo";
import { clusterPois } from "@/lib/poi-clusters";
import { formatAreaSqm, formatDistanceM } from "@/lib/park-analysis";
import { formatMaintenanceArea } from "@/lib/maintenance-analysis";
import {
  findStationRoutes,
  createClusterIcon,
  createIcon,
  createLabel,
  createSubwayBadge,
  getClusterColor,
  getPoiColor,
  getPoiExtra,
  type MarkerStyle,
} from "@/lib/map-marker-utils";
import { toJpeg } from "html-to-image";

interface MapViewProps {
  readonly config: AnalysisConfig;
  readonly pois: readonly Poi[];
  readonly layers: LayerVisibility;
  readonly subwayRoutes: readonly SubwayRoute[];
  readonly insightOverlays?: readonly InsightOverlay[];
  readonly visibleInsightOverlayIds?: readonly string[];
}

export interface MapViewHandle {
  captureImage(): Promise<string>;
  captureBaseMap(): Promise<string>;
  getPoiPositions(pois: readonly Poi[]): PoiPosition[];
  getRadiusPosition(): RadiusPosition | null;
  getRouteNormalizedPositions(routes: readonly SubwayRoute[]): { line: string; lineColor: string; points: { nx: number; ny: number }[] }[];
}

// ─── Map tile modes ────────────────────────────────────────────────────────

export type MapMode = "satellite" | "dark" | "voyager" | "positron" | "topo" | "osm";
type MarkerSizePreset = "small" | "medium" | "large";
type SubwayStationStyle = {
  readonly labelFontSizePx: number;
  readonly barHalfLengthM: number;
  readonly barWidthPx: number;
};

const TILE_CONFIGS: Record<MapMode, { url: string; label: string; overlay?: string; overlayOpacity?: number }> = {
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    overlay: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    overlayOpacity: 0.6,
    label: "위성",
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    label: "야간",
  },
  voyager: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    label: "컬러",
  },
  positron: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    label: "심플",
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    label: "지형",
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    label: "표준",
  },
};

const MARKER_SIZE_PRESETS: Record<MarkerSizePreset, { label: string; scale: number; clusterDistancePx: number }> = {
  small: { label: "작게", scale: 0.78, clusterDistancePx: 28 },
  medium: { label: "보통", scale: 1, clusterDistancePx: 42 },
  large: { label: "크게", scale: 1.18, clusterDistancePx: 52 },
};

const DEFAULT_SUBWAY_STATION_STYLE: SubwayStationStyle = {
  labelFontSizePx: 7,
  barHalfLengthM: 150,
  barWidthPx: 10,
};

// PPT export canvas: 1920×1080 (16:9 — matches SLIDE_W/SLIDE_H ratio in ppt-generator)
const EXPORT_W = 1920;
const EXPORT_H = 1080;

/**
 * 위도/경도 → PPT export 가상 캔버스(1920×1080) 정규화 좌표.
 * 현재 줌·중심을 기준으로 16:9 캔버스를 계산하므로 captureBaseMap 결과와 정렬됨.
 */
function latLngToExportNx(
  map: import("leaflet").Map,
  lat: number,
  lng: number,
): { nx: number; ny: number } {
  const zoom = map.getZoom();
  const centerPx = map.project(map.getCenter(), zoom);
  const poiPx = map.project([lat, lng], zoom);
  return {
    nx: (poiPx.x - (centerPx.x - EXPORT_W / 2)) / EXPORT_W,
    ny: (poiPx.y - (centerPx.y - EXPORT_H / 2)) / EXPORT_H,
  };
}

function setMarkerAccessibility(marker: import("leaflet").Marker, label: string) {
  const applyAttributes = () => {
    const element = marker.getElement();
    if (!element) {
      return;
    }

    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-label", label);
  };

  applyAttributes();
  marker.on("add", applyAttributes);
}

function zoomToCluster(map: import("leaflet").Map, L: typeof import("leaflet"), items: readonly Poi[]) {
  if (items.length === 0) {
    return;
  }

  if (items.length === 1) {
    map.setView([items[0].lat, items[0].lng], Math.max(map.getZoom(), 16));
    return;
  }

  const bounds = L.latLngBounds(items.map((item) => [item.lat, item.lng] as [number, number]));
  if (!bounds.isValid()) {
    return;
  }

  if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
    map.setView([items[0].lat, items[0].lng], Math.min(map.getZoom() + 2, 18));
    return;
  }

  map.fitBounds(bounds.pad(0.4), { maxZoom: 17 });
}

function escapePopupHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function buildResidentialPopupHtml(apt: ResidentialPoi): string {
  const row = (label: string, value: string) =>
    `<tr><td style="color:#64748b;padding:3px 12px 3px 0;font-size:12px;white-space:nowrap">${label}</td><td style="font-weight:600;font-size:12px">${value}</td></tr>`;
  const link = (href: string, label: string) => href
    ? `<a href="${escapePopupHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;font-weight:700">${label}</a>`
    : "";
  const floorplan = apt.floorplans?.[0];
  const floorplanBlock = floorplan
    ? `<div style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:8px">
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">평면도</div>
        ${
          floorplan.image_url
            ? `<img src="${escapePopupHtml(floorplan.image_url)}" alt="${escapePopupHtml(floorplan.housing_type)} 평면도" referrerpolicy="no-referrer" style="display:block;max-width:220px;max-height:120px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;margin-bottom:5px"/>`
            : ""
        }
        ${link(floorplan.source_url, `${escapePopupHtml(floorplan.housing_type)} 평면도 보기`)}
      </div>`
    : "";
  return `<div style="font-family:'Noto Sans KR',system-ui,sans-serif;min-width:175px">
    <div style="font-weight:700;font-size:13px;margin-bottom:4px;color:#1E3A8A;line-height:1.4">${escapePopupHtml(apt.name)}</div>
    ${apt.status === "planned" ? `<div style="display:inline-block;margin-bottom:7px;border-radius:999px;background:#0F172A;color:white;font-size:10px;font-weight:800;padding:3px 7px">분양예정</div>` : ""}
    <table style="width:100%;border-collapse:collapse">
      ${row("세대수", apt.units > 0 ? `${apt.units.toLocaleString()}세대` : "미확인")}
      ${row("주차대수", apt.parking_count > 0 ? `${apt.parking_count.toLocaleString()}대` : "미확인")}
      ${row("최고층수", apt.max_floor && apt.max_floor > 0 ? `${apt.max_floor.toLocaleString()}층` : "미확인")}
      ${row(apt.status === "planned" ? "입주예정월" : "첫입주일", apt.move_in_month || apt.sale_date || "미확인")}
      ${apt.homepage_url ? row("홈페이지", link(apt.homepage_url, "열기")) : ""}
      ${apt.notice_url ? row("모집공고", link(apt.notice_url, "열기")) : ""}
    </table>
    ${floorplanBlock}
  </div>`;
}

function buildParkPopupHtml(park: Park): string {
  const row = (label: string, value: string) =>
    `<tr><td style="color:#64748b;padding:3px 12px 3px 0;font-size:12px;white-space:nowrap">${label}</td><td style="font-weight:600;font-size:12px">${value}</td></tr>`;
  const facilities = park.facilities?.length ? park.facilities.slice(0, 5).join(", ") : "미확인";
  const sourceLabel = park.source === "official" ? "공식 도시공원 데이터" : "OSM 보조 데이터";
  return `<div style="font-family:'Noto Sans KR',system-ui,sans-serif;min-width:190px">
    <div style="font-weight:800;font-size:13px;margin-bottom:6px;color:#047857;line-height:1.4">${escapePopupHtml(park.name)}</div>
    <table style="width:100%;border-collapse:collapse">
      ${row("구분", escapePopupHtml(park.park_type ?? park.type ?? "공원"))}
      ${row("면적", park.area_sqm > 0 ? formatAreaSqm(park.area_sqm) : "미확인")}
      ${row("접근거리", park.access_distance_m != null ? formatDistanceM(park.access_distance_m) : "미확인")}
      ${row("보유시설", escapePopupHtml(facilities))}
      ${park.address ? row("주소", escapePopupHtml(park.address)) : ""}
      ${row("출처", sourceLabel)}
    </table>
  </div>`;
}

function buildMaintenancePopupHtml(project: MaintenanceProject): string {
  const row = (label: string, value: string) =>
    `<tr><td style="color:#64748b;padding:3px 12px 3px 0;font-size:12px;white-space:nowrap">${label}</td><td style="font-weight:600;font-size:12px">${value}</td></tr>`;
  const link = (href: string, label: string) =>
    `<a href="${escapePopupHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;font-weight:700">${label}</a>`;
  const sourceLabel = project.source === "seoul_open_data" ? "서울 열린데이터광장" : "부산 정비사업 API";
  const optionalRows = [
    project.planned_households ? row("계획세대수", `${project.planned_households.toLocaleString()}세대`) : "",
    project.floor_area_ratio ? row("용적률", `${project.floor_area_ratio}%`) : "",
    project.building_coverage_ratio ? row("건폐율", `${project.building_coverage_ratio}%`) : "",
    project.contractor ? row("시공자", escapePopupHtml(project.contractor)) : "",
    project.architect ? row("설계자", escapePopupHtml(project.architect)) : "",
  ].join("");
  return `<div style="font-family:'Noto Sans KR',system-ui,sans-serif;min-width:220px">
    <div style="font-weight:800;font-size:13px;margin-bottom:6px;color:#DB2777;line-height:1.4">${escapePopupHtml(project.name)}</div>
    <table style="width:100%;border-collapse:collapse">
      ${row("유형", escapePopupHtml(project.type || "정비사업"))}
      ${row("단계", escapePopupHtml(project.stage))}
      ${row("면적", project.area_sqm > 0 ? formatMaintenanceArea(project.area_sqm) : "미확인")}
      ${row("주소/위치", escapePopupHtml(project.address || "미확인"))}
      ${project.notice_code ? row("고시관리코드", escapePopupHtml(project.notice_code)) : ""}
      ${optionalRows}
      ${row("경계", project.boundary_status === "confirmed" ? "공식 경계 확인" : "경계 미확인")}
      ${row("출처", project.notice_url ? link(project.notice_url, sourceLabel) : sourceLabel)}
    </table>
  </div>`;
}

function getParkMarkerScale(park: Park): number {
  if (park.quality === "major" || park.area_sqm >= 100_000) return 1.26;
  if (park.quality === "neighborhood" || park.area_sqm >= 10_000) return 1.12;
  if (park.quality === "children") return 0.96;
  if (park.quality === "small") return 0.86;
  return 1;
}

function addSinglePoiMarker(
  L: typeof import("leaflet"),
  markersLayer: import("leaflet").LayerGroup,
  config: AnalysisConfig,
  poi: Poi,
  mStyle: MarkerStyle = "default",
  routes: readonly SubwayRoute[] = [],
  markerScale = 1,
) {
  // Naver-style subway badge with rotation
  const useNaverSubway = mStyle === "naver" && poi.category === "subway";
  // Naver style subway is drawn as polyline segments, skip marker creation
  if (useNaverSubway) return;

  const residentialPoi = (poi.category === "apartment" || poi.category === "officetel" || poi.category === "residential")
    ? poi as ResidentialPoi
    : null;
  const icon = createIcon(poi.category, getPoiColor(poi), L, {
    scale: poi.category === "park" ? markerScale * getParkMarkerScale(poi as Park) : markerScale,
    badgeLabel: residentialPoi?.status === "planned" ? "예정" : undefined,
  });
  const marker = L.marker([poi.lat, poi.lng], { icon, keyboard: true });
  const iconScale = poi.category === "park" ? markerScale * getParkMarkerScale(poi as Park) : markerScale;
  const tooltipOffsetY = -Math.round((32 * iconScale) / 2 + 2);

  if (!useNaverSubway) {
    marker.bindTooltip(createLabel(poi.name, getPoiExtra(poi)), {
      direction: "top",
      offset: [0, tooltipOffsetY],
      className: "poi-tooltip",
    });
  }

  if (residentialPoi) {
    marker.bindPopup(buildResidentialPopupHtml(residentialPoi), { maxWidth: 280 });
  }
  if (poi.category === "park") {
    marker.bindPopup(buildParkPopupHtml(poi as Park), { maxWidth: 300 });
  }
  if (poi.category === "maintenance") {
    marker.bindPopup(buildMaintenancePopupHtml(poi as MaintenanceProject), { maxWidth: 320 });
  }

  setMarkerAccessibility(marker, `${poi.name} 마커`);
  markersLayer.addLayer(marker);

  if (poi.category !== "apartment") {
    return;
  }

  const apartment = poi as Apartment;
  const dashLine = L.polyline(
    [
      [config.centerLat, config.centerLng],
      [apartment.lat, apartment.lng],
    ],
    { color: "#374151", weight: 1.5, opacity: 0.5, dashArray: "6 4" }
  );
  markersLayer.addLayer(dashLine);
}

function addClusterMarker(
  L: typeof import("leaflet"),
  map: import("leaflet").Map,
  markersLayer: import("leaflet").LayerGroup,
  items: readonly Poi[],
  lat: number,
  lng: number,
  markerScale = 1,
) {
  const marker = L.marker([lat, lng], {
    icon: createClusterIcon(items.length, getClusterColor(items), L, { scale: markerScale }),
    keyboard: true,
  });

  marker.bindTooltip(createLabel(`${items.length}개 POI`, "클릭하여 확대"), {
    direction: "top",
    offset: [0, -Math.round(24 * markerScale)],
    className: "poi-tooltip",
  });
  marker.on("click", () => zoomToCluster(map, L, items));
  setMarkerAccessibility(marker, `${items.length}개 POI 클러스터, 클릭하여 확대`);
  markersLayer.addLayer(marker);
}

function MapRangeControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-w-44 items-center gap-2 px-1 text-[10px] font-semibold text-white/70">
      <span className="w-14 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 flex-1 accent-blue-400"
      />
      <span className="w-11 shrink-0 text-right tabular-nums text-white/45">
        {value}{unit}
      </span>
    </label>
  );
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { config, pois, layers, subwayRoutes, insightOverlays = [], visibleInsightOverlayIds = [] },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<import("leaflet").LayerGroup | null>(null);
  const routeLinesRef = useRef<import("leaflet").LayerGroup | null>(null);
  const insightLayersRef = useRef<import("leaflet").LayerGroup | null>(null);
  const stationBarsRef = useRef<import("leaflet").LayerGroup | null>(null);
  const stationLabelsRef = useRef<import("leaflet").LayerGroup | null>(null);
  const circleRef = useRef<import("leaflet").Circle | null>(null);
  const centerMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const tileLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const overlayLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const lifecycleTokenRef = useRef(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>("satellite");
  const [markerStyle, setMarkerStyle] = useState<MarkerStyle>("default");
  const [markerSizePreset, setMarkerSizePreset] = useState<MarkerSizePreset>("medium");
  const [subwayStationStyle, setSubwayStationStyle] = useState<SubwayStationStyle>(DEFAULT_SUBWAY_STATION_STYLE);
  const [controlsOpen, setControlsOpen] = useState(true);

  useImperativeHandle(ref, () => ({
    async captureImage(): Promise<string> {
      if (!containerRef.current) {
        throw new Error("Map container not found");
      }
      return toJpeg(containerRef.current, { quality: 0.92, pixelRatio: 2 });
    },

    /**
     * 현재 선택된 지도 모드의 베이스맵 이미지를 반환.
     * - 위성 모드: ESRI 정적 API (고해상도 1920×1080)
     * - 기타 모드: 현재 화면에서 마커/오버레이를 숨기고 캡처
     * getPoiPositions / getRadiusPosition / getRouteNormalizedPositions 와 좌표계 동일.
     */
    async captureBaseMap(): Promise<string> {
      if (!mapRef.current) throw new Error("Map not ready");
      const map = mapRef.current;

      // 위성 모드: ESRI 정적 이미지 API (최고 품질)
      if (mapMode === "satellite") {
        const zoom = map.getZoom();
        const centerPx = map.project(map.getCenter(), zoom);
        const sw = map.unproject([centerPx.x - EXPORT_W / 2, centerPx.y + EXPORT_H / 2], zoom);
        const ne = map.unproject([centerPx.x + EXPORT_W / 2, centerPx.y - EXPORT_H / 2], zoom);
        const params = new URLSearchParams({
          bbox: `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`,
          bboxSR: "4326", imageSR: "3857",
          size: `${EXPORT_W},${EXPORT_H}`, format: "jpg", f: "image",
        });
        const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${params}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`위성 이미지 요청 실패: ${res.status}`);
        const blob = await res.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      // 비위성 모드: 모든 오버레이/마커/역사바 숨기고 타일만 캡처
      if (!containerRef.current) throw new Error("Map container not found");
      const mapInst = mapRef.current;
      const hiddenEls: HTMLElement[] = [];

      for (const paneName of ["overlayPane", "markerPane", "tooltipPane", "popupPane", "shadowPane", "stationBarsPane", "stationLabelsPane"] as const) {
        const pane = mapInst.getPane(paneName);
        if (pane) { pane.style.display = "none"; hiddenEls.push(pane); }
      }
      try {
        const dataUrl = await toJpeg(containerRef.current, { quality: 0.92, pixelRatio: 2 });
        return dataUrl;
      } finally {
        for (const el of hiddenEls) { el.style.display = ""; }
      }
    },

    getPoiPositions(selectedPois: readonly Poi[]): PoiPosition[] {
      if (!mapRef.current) return [];
      const map = mapRef.current;
      return selectedPois
        .map((poi) => ({ poi, ...latLngToExportNx(map, poi.lat, poi.lng) }))
        .filter(({ nx, ny }) => nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1);
    },

    getRadiusPosition(): RadiusPosition | null {
      if (!mapRef.current || !circleRef.current) return null;
      const map = mapRef.current;
      const center = circleRef.current.getLatLng();
      const bounds = circleRef.current.getBounds();
      const { nx: centerNx, ny: centerNy } = latLngToExportNx(map, center.lat, center.lng);
      const { nx: neNx, ny: neNy } = latLngToExportNx(map, bounds.getNorthEast().lat, bounds.getNorthEast().lng);
      const { nx: swNx, ny: swNy } = latLngToExportNx(map, bounds.getSouthWest().lat, bounds.getSouthWest().lng);
      return {
        centerNx,
        centerNy,
        radiusNx: (neNx - swNx) / 2,
        radiusNy: (swNy - neNy) / 2,
      };
    },

    getRouteNormalizedPositions(routes: readonly SubwayRoute[]) {
      if (!mapRef.current) return [];
      const map = mapRef.current;
      return routes
        .filter((route) => route.coordinates && route.coordinates.length >= 2)
        .map((route) => ({
          line: route.line,
          lineColor: route.lineColor,
          points: route.coordinates!.map(([lat, lng]) => latLngToExportNx(map, lat, lng)),
        }));
    },
  }));

  useEffect(() => {
    if (mapRef.current || !containerRef.current) {
      return;
    }

    let cancelled = false;
    const lifecycleToken = lifecycleTokenRef.current + 1;
    lifecycleTokenRef.current = lifecycleToken;

    (async () => {
      const L = (await import("leaflet")).default;

      if (cancelled || lifecycleTokenRef.current !== lifecycleToken || !containerRef.current) {
        return;
      }

      const map = L.map(containerRef.current, {
        center: [config.centerLat, config.centerLng],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
      });

      leafletRef.current = L;
      const tileConf = TILE_CONFIGS.satellite;
      tileLayerRef.current = L.tileLayer(tileConf.url, { maxZoom: 18 }).addTo(map);
      if (tileConf.overlay) {
        overlayLayerRef.current = L.tileLayer(tileConf.overlay, { maxZoom: 18, opacity: tileConf.overlayOpacity ?? 0.6 }).addTo(map);
      }

      if (cancelled || lifecycleTokenRef.current !== lifecycleToken) {
        map.remove();
        return;
      }

      mapRef.current = map;
      routeLinesRef.current = L.layerGroup().addTo(map);
      insightLayersRef.current = L.layerGroup().addTo(map);
      // Station bars go in a custom pane above overlayPane so they can be preserved during capture
      map.createPane("stationBarsPane");
      map.getPane("stationBarsPane")!.style.zIndex = "450";
      stationBarsRef.current = L.layerGroup([], { pane: "stationBarsPane" }).addTo(map);
      map.createPane("stationLabelsPane");
      map.getPane("stationLabelsPane")!.style.zIndex = "660";
      stationLabelsRef.current = L.layerGroup([], { pane: "stationLabelsPane" }).addTo(map);
      markersRef.current = L.layerGroup().addTo(map);
      circleRef.current = L.circle([config.centerLat, config.centerLng], {
        radius: config.radiusKm * 1000,
        color: "#0EA5E9",
        weight: 3,
        fillColor: "#0EA5E9",
        fillOpacity: 0.15,
        dashArray: "10 6",
      }).addTo(map);

      const centerMarker = L.marker([config.centerLat, config.centerLng], {
        icon: L.divIcon({
          html: `<div style="
            width:20px;
            height:20px;
            background:${THEME_COLORS.secondaryNavy};
            border:4px solid white;
            border-radius:50%;
            box-shadow:0 0 15px rgba(59,130,246,0.5);
          "></div>`,
          className: "",
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        keyboard: true,
      })
        .addTo(map)
        .bindTooltip(config.centerName, {
          permanent: true,
          direction: "top",
          offset: [0, -15],
          className: "center-tooltip",
        });

      setMarkerAccessibility(centerMarker, `${config.centerName} 중심 지점`);
      centerMarkerRef.current = centerMarker;
      setMapReady(true);
    })();

    return () => {
      cancelled = true;
      lifecycleTokenRef.current += 1;
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = null;
      routeLinesRef.current = null;
      insightLayersRef.current = null;
      stationBarsRef.current = null;
      stationLabelsRef.current = null;
      circleRef.current = null;
      centerMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const insightLayer = insightLayersRef.current;
    const L = leafletRef.current;
    if (!mapReady || !map || !insightLayer || !L) {
      return;
    }

    insightLayer.clearLayers();
    const visibleIds = new Set(visibleInsightOverlayIds);
    insightOverlays
      .filter((overlay) => visibleIds.has(overlay.id))
      .forEach((overlay) => {
        const circle = L.circle([config.centerLat, config.centerLng], {
          radius: overlay.radiusM,
          color: overlay.color,
          weight: 2,
          opacity: 0.82,
          fillColor: overlay.color,
          fillOpacity: 0.08,
          dashArray: "8 6",
          interactive: false,
        });
        insightLayer.addLayer(circle);
      });
  }, [config.centerLat, config.centerLng, insightOverlays, mapReady, visibleInsightOverlayIds]);

  useEffect(() => {
    if (!mapRef.current || !circleRef.current || !centerMarkerRef.current) {
      return;
    }

    mapRef.current.setView([config.centerLat, config.centerLng], mapRef.current.getZoom());
    circleRef.current.setLatLng([config.centerLat, config.centerLng]);
    circleRef.current.setRadius(config.radiusKm * 1000);
    centerMarkerRef.current.setLatLng([config.centerLat, config.centerLng]);
    centerMarkerRef.current.setTooltipContent(config.centerName);
  }, [config.centerLat, config.centerLng, config.centerName, config.radiusKm]);

  const updateMarkers = useCallback(async () => {
    const lifecycleToken = lifecycleTokenRef.current;
    const map = mapRef.current;
    const markersLayer = markersRef.current;
    const routeLinesLayer = routeLinesRef.current;
    const stationBarsLayer = stationBarsRef.current;
    const stationLabelsLayer = stationLabelsRef.current;
    if (!map || !markersLayer || !routeLinesLayer || !stationBarsLayer || !stationLabelsLayer) {
      return;
    }

    const L = (await import("leaflet")).default;
    if (
      lifecycleTokenRef.current !== lifecycleToken ||
      mapRef.current !== map ||
      markersRef.current !== markersLayer ||
      routeLinesRef.current !== routeLinesLayer ||
      stationBarsRef.current !== stationBarsLayer ||
      stationLabelsRef.current !== stationLabelsLayer
    ) {
      return;
    }

    markersLayer.clearLayers();
    stationBarsLayer.clearLayers();
    stationLabelsLayer.clearLayers();

    const visiblePois = pois.filter(
      (poi) =>
        layers[poi.category] &&
        haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng) <= config.radiusKm * 1000
    );

    routeLinesLayer.clearLayers();
    if (layers.subway) {
      const stationMap = new Map(
        visiblePois
          .filter((poi): poi is SubwayStation => poi.category === "subway")
          .map((station) => [station.id, station])
      );

      subwayRoutes.forEach((route) => {
        const coordinates: [number, number][] =
          route.coordinates && route.coordinates.length >= 2
            ? route.coordinates.map(([lat, lng]) => [lat, lng] as [number, number])
            : route.stationIds
                .map((stationId) => stationMap.get(stationId))
                .filter((station): station is SubwayStation => station !== undefined)
                .map((station) => [station.lat, station.lng]);

        if (coordinates.length < 2) {
          return;
        }

        routeLinesLayer.addLayer(
          L.polyline(coordinates, {
            color: route.lineColor,
            weight: 4,
            opacity: 0.85,
          })
        );
      });
    }

    // Naver style: draw thick polyline segments at station locations
    const naverSubway = markerStyle === "naver";
    const clusterablePois = naverSubway
      ? visiblePois.filter(p => p.category !== "subway")
      : visiblePois;
    const markerSize = MARKER_SIZE_PRESETS[markerSizePreset];
    const stationBarWidth = subwayStationStyle.barWidthPx;
    const stationBorderWidth = stationBarWidth + Math.max(4, Math.round(stationBarWidth * 0.4));

    if (naverSubway && layers.subway) {
      const stations = visiblePois.filter((p): p is SubwayStation => p.category === "subway");

      /** Haversine distance in meters between two lat/lng points */
      function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      const seenRouteStations = new Set<string>();

      for (const station of stations) {
        for (const route of subwayRoutes) {
          if (!route.coordinates || route.coordinates.length < 2) continue;
          const coords = route.coordinates;

          // Deduplicate: same route color + same station
          const dedupeKey = `${route.lineColor}:${station.id}`;
          if (seenRouteStations.has(dedupeKey)) continue;

          // Find closest point on this route
          let minDistSq = Infinity;
          let closestIdx = 0;
          const cosLat = Math.cos(station.lat * Math.PI / 180);
          for (let i = 0; i < coords.length; i++) {
            const dx = (coords[i][1] - station.lng) * cosLat;
            const dy = coords[i][0] - station.lat;
            const d = dx * dx + dy * dy;
            if (d < minDistSq) { minDistSq = d; closestIdx = i; }
          }

          // Skip if too far (~80m)
          const closestDistM = distM(station.lat, station.lng, coords[closestIdx][0], coords[closestIdx][1]);
          if (closestDistM > 80) continue;
          seenRouteStations.add(dedupeKey);

          /** Interpolate a point at exact distance along a polyline from a starting index */
          function interpPoint(fromIdx: number, direction: 1 | -1, targetM: number): [number, number] {
            let remaining = targetM;
            let idx = fromIdx;
            while (true) {
              const nextIdx = idx + direction;
              if (nextIdx < 0 || nextIdx >= coords.length) break;
              const segLen = distM(coords[idx][0], coords[idx][1], coords[nextIdx][0], coords[nextIdx][1]);
              if (segLen >= remaining && segLen > 0) {
                // Interpolate within this segment
                const t = remaining / segLen;
                return [
                  coords[idx][0] + (coords[nextIdx][0] - coords[idx][0]) * t,
                  coords[idx][1] + (coords[nextIdx][1] - coords[idx][1]) * t,
                ];
              }
              remaining -= segLen;
              idx = nextIdx;
            }
            // Ran out of coords — return last available point
            return [coords[idx][0], coords[idx][1]];
          }

          // Build segment: interpolated start → intermediate points → interpolated end
          const startPt = interpPoint(closestIdx, -1, subwayStationStyle.barHalfLengthM);
          const endPt = interpPoint(closestIdx, 1, subwayStationStyle.barHalfLengthM);

          // Collect intermediate route points between start and end
          const segment: [number, number][] = [startPt];

          // Walk backward to find which indices fall between startPt and closestIdx
          let walkIdx = closestIdx;
          const beforePts: [number, number][] = [];
          let acc = 0;
          while (walkIdx > 0) {
            const d = distM(coords[walkIdx][0], coords[walkIdx][1], coords[walkIdx - 1][0], coords[walkIdx - 1][1]);
            if (acc + d >= subwayStationStyle.barHalfLengthM) break;
            acc += d;
            walkIdx--;
            beforePts.unshift([coords[walkIdx][0], coords[walkIdx][1]]);
          }
          segment.push(...beforePts);
          segment.push([coords[closestIdx][0], coords[closestIdx][1]]);

          // Walk forward
          walkIdx = closestIdx;
          acc = 0;
          while (walkIdx < coords.length - 1) {
            const d = distM(coords[walkIdx][0], coords[walkIdx][1], coords[walkIdx + 1][0], coords[walkIdx + 1][1]);
            if (acc + d >= subwayStationStyle.barHalfLengthM) break;
            acc += d;
            walkIdx++;
            segment.push([coords[walkIdx][0], coords[walkIdx][1]]);
          }
          segment.push(endPt);
          if (segment.length < 2) continue;

          // White border
          stationBarsLayer.addLayer(
            L.polyline(segment, { color: "#ffffff", weight: stationBorderWidth, opacity: 0.9, lineCap: "butt", pane: "stationBarsPane" })
          );
          // Colored station bar
          stationBarsLayer.addLayer(
            L.polyline(segment, { color: route.lineColor, weight: stationBarWidth, opacity: 1, lineCap: "butt", pane: "stationBarsPane" })
          );

          // Station name label on top of bar (only once per station, on first matched route)
          if (!seenRouteStations.has(`label:${station.id}`)) {
            seenRouteStations.add(`label:${station.id}`);
            // Calculate angle and label offset in screen space so the label sits above the station bar.
            const startLayerPoint = map.latLngToLayerPoint(startPt);
            const endLayerPoint = map.latLngToLayerPoint(endPt);
            const centerLayerPoint = map.latLngToLayerPoint([coords[closestIdx][0], coords[closestIdx][1]]);
            const dx = endLayerPoint.x - startLayerPoint.x;
            const dy = endLayerPoint.y - startLayerPoint.y;
            const length = Math.sqrt(dx * dx + dy * dy) || 1;
            const normalA = { x: -dy / length, y: dx / length };
            const normalB = { x: dy / length, y: -dx / length };
            const normal = normalA.y <= normalB.y ? normalA : normalB;
            const labelOffsetPx = stationBarWidth / 2 + subwayStationStyle.labelFontSizePx * 0.75 + 4;
            const labelPoint = L.point(
              centerLayerPoint.x + normal.x * labelOffsetPx,
              centerLayerPoint.y + normal.y * labelOffsetPx,
            );
            const labelLatLng = map.layerPointToLatLng(labelPoint);
            let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
            if (angleDeg > 90) angleDeg -= 180;
            if (angleDeg < -90) angleDeg += 180;

            const safeName = station.name.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
            const labelIcon = L.divIcon({
              html: `<div style="
                position:absolute;
                left:50%;
                top:50%;
                transform:translate(-50%,-50%) rotate(${angleDeg.toFixed(1)}deg);
                color:white;
                font-size:${subwayStationStyle.labelFontSizePx}px;
                font-weight:700;
                font-family:'Pretendard','Noto Sans KR',sans-serif;
                white-space:nowrap;
                text-shadow:0 0 3px rgba(0,0,0,0.9),0 0 6px rgba(0,0,0,0.7);
                pointer-events:none;
                text-align:center;
              ">${safeName}</div>`,
              className: "",
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            });
            stationLabelsLayer.addLayer(
              L.marker(labelLatLng, { icon: labelIcon, interactive: false, pane: "stationLabelsPane" })
            );
          }
        }
      }
    }

    for (const park of visiblePois.filter((poi): poi is Park => poi.category === "park")) {
      if (park.area_sqm <= 0) continue;
      if (park.boundary && park.boundary.length >= 3) {
        markersLayer.addLayer(
          L.polygon(park.boundary.map(([lat, lng]) => [lat, lng] as [number, number]), {
            color: "#10B981",
            weight: park.quality === "major" ? 2 : 1,
            fillColor: "#10B981",
            fillOpacity: park.quality === "major" ? 0.16 : 0.09,
            opacity: 0.65,
            interactive: false,
          })
        );
        continue;
      }
      const estimatedRadius = Math.min(450, Math.max(35, Math.sqrt(park.area_sqm / Math.PI)));
      markersLayer.addLayer(
        L.circle([park.lat, park.lng], {
          radius: estimatedRadius,
          color: "#10B981",
          weight: park.quality === "major" ? 2 : 1,
          fillColor: "#10B981",
          fillOpacity: park.quality === "major" ? 0.16 : 0.09,
          opacity: 0.55,
          interactive: false,
        })
      );
    }

    for (const project of visiblePois.filter((poi): poi is MaintenanceProject => poi.category === "maintenance")) {
      if (!project.boundary || project.boundary.length < 3) continue;
      markersLayer.addLayer(
        L.polygon(project.boundary.map(([lat, lng]) => [lat, lng] as [number, number]), {
          color: "#EC4899",
          weight: 2,
          fillColor: "#EC4899",
          fillOpacity: 0.16,
          opacity: 0.75,
          dashArray: "6 4",
        }).bindPopup(buildMaintenancePopupHtml(project), { maxWidth: 320 })
      );
    }

    const clusters = clusterPois(
      clusterablePois.map((poi) => {
        const point = map.latLngToContainerPoint([poi.lat, poi.lng]);
        return { poi, x: point.x, y: point.y };
      }),
      markerSize.clusterDistancePx
    );

    clusters.forEach((cluster) => {
      if (cluster.items.length === 1) {
        addSinglePoiMarker(L, markersLayer, config, cluster.items[0], markerStyle, subwayRoutes, markerSize.scale);
        return;
      }

      addClusterMarker(L, map, markersLayer, cluster.items, cluster.lat, cluster.lng, markerSize.scale);
    });
  }, [config, layers, pois, subwayRoutes, markerStyle, markerSizePreset, subwayStationStyle]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      setControlsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!mapReady) {
      return;
    }

    updateMarkers();
  }, [mapReady, updateMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      return;
    }

    const handleRecluster = () => {
      void updateMarkers();
    };

    map.on("zoomend", handleRecluster);
    map.on("resize", handleRecluster);

    return () => {
      map.off("zoomend", handleRecluster);
      map.off("resize", handleRecluster);
    };
  }, [mapReady, updateMarkers]);

  // ─── Map mode switching ──────────────────────────────────────────────────
  const handleMapModeChange = useCallback((mode: MapMode) => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    // Remove old tiles
    if (tileLayerRef.current) { map.removeLayer(tileLayerRef.current); tileLayerRef.current = null; }
    if (overlayLayerRef.current) { map.removeLayer(overlayLayerRef.current); overlayLayerRef.current = null; }

    // Add new tiles (at bottom)
    const conf = TILE_CONFIGS[mode];
    tileLayerRef.current = L.tileLayer(conf.url, { maxZoom: 18 });
    tileLayerRef.current.addTo(map);
    tileLayerRef.current.bringToBack();

    if (conf.overlay) {
      overlayLayerRef.current = L.tileLayer(conf.overlay, { maxZoom: 18, opacity: conf.overlayOpacity ?? 0.6 });
      overlayLayerRef.current.addTo(map);
    }

    setMapMode(mode);
  }, []);

  const updateSubwayStationStyle = useCallback(<K extends keyof SubwayStationStyle>(
    key: K,
    value: SubwayStationStyle[K],
  ) => {
    setSubwayStationStyle((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <div className="relative min-h-full h-full w-full">
      <div ref={containerRef} className="min-h-full h-full w-full" />
      {mapReady && (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-[800] flex justify-end sm:left-auto">
          <div className="pointer-events-auto w-full max-w-[22rem] overflow-hidden rounded-2xl border border-white/15 bg-[#0F172A]/88 shadow-2xl shadow-black/30 backdrop-blur-md">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-100/75">지도 옵션</p>
                <p className="mt-0.5 truncate text-xs text-white/55">
                  {TILE_CONFIGS[mapMode].label} · {markerStyle === "naver" ? "역명 배지" : "기본 마커"} · {MARKER_SIZE_PRESETS[markerSizePreset].label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setControlsOpen((open) => !open)}
                aria-expanded={controlsOpen}
                className="shrink-0 rounded-xl border border-white/12 bg-white/8 px-3 py-1.5 text-xs font-bold text-white/80 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
              >
                {controlsOpen ? "접기" : "열기"}
              </button>
            </div>
            {controlsOpen && (
              <div className="space-y-3 border-t border-white/10 px-3 pb-3 pt-3">
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">지도</p>
                  <div className="grid grid-cols-3 gap-1">
                    {(Object.keys(TILE_CONFIGS) as MapMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => handleMapModeChange(mode)}
                        aria-pressed={mapMode === mode}
                        className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                          mapMode === mode
                            ? "bg-[#3B82F6] text-white shadow"
                            : "bg-white/[0.04] text-white/65 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        {TILE_CONFIGS[mode].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">마커</p>
                    <div className="grid grid-cols-1 gap-1">
                      {([["default", "기본 마커"], ["naver", "역명 배지"]] as const).map(([style, label]) => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => setMarkerStyle(style)}
                          aria-pressed={markerStyle === style}
                          className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                            markerStyle === style
                              ? "bg-[#3B82F6] text-white shadow"
                              : "bg-white/[0.04] text-white/65 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">크기</p>
                    <div className="grid grid-cols-1 gap-1">
                      {(Object.entries(MARKER_SIZE_PRESETS) as [MarkerSizePreset, (typeof MARKER_SIZE_PRESETS)[MarkerSizePreset]][]).map(
                        ([preset, { label }]) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setMarkerSizePreset(preset)}
                            aria-pressed={markerSizePreset === preset}
                            aria-label={`마커 크기 ${label}`}
                            className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                              markerSizePreset === preset
                                ? "bg-[#3B82F6] text-white shadow"
                                : "bg-white/[0.04] text-white/65 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            {label}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {markerStyle === "naver" && (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-2">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">역 표시</p>
                    <div className="space-y-1">
                      <MapRangeControl
                        label="역명"
                        value={subwayStationStyle.labelFontSizePx}
                        min={6}
                        max={14}
                        step={1}
                        unit="px"
                        onChange={(value) => updateSubwayStationStyle("labelFontSizePx", value)}
                      />
                      <MapRangeControl
                        label="역사 길이"
                        value={subwayStationStyle.barHalfLengthM}
                        min={80}
                        max={260}
                        step={10}
                        unit="m"
                        onChange={(value) => updateSubwayStationStyle("barHalfLengthM", value)}
                      />
                      <MapRangeControl
                        label="역사 두께"
                        value={subwayStationStyle.barWidthPx}
                        min={6}
                        max={18}
                        step={1}
                        unit="px"
                        onChange={(value) => updateSubwayStationStyle("barWidthPx", value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default MapView;

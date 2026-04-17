"use client";

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import type { Poi, AnalysisConfig, LayerVisibility, SubwayStation, Apartment, PoiPosition, RadiusPosition } from "@/lib/types";
import { CATEGORY_COLORS, THEME_COLORS } from "@/lib/types";
import { haversineDistance } from "@/lib/geo";

interface MapViewProps {
  readonly config: AnalysisConfig;
  readonly pois: readonly Poi[];
  readonly layers: LayerVisibility;
}

export interface MapViewHandle {
  captureImage(): Promise<string>;
  captureBaseMap(): Promise<string>;
  getPoiPositions(pois: readonly Poi[]): PoiPosition[];
  getRadiusPosition(): RadiusPosition | null;
}

const ICON_SVG: Record<string, string> = {
  subway: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M14 14 h20 v16 a4 4 0 0 1 -4 4 h-12 a4 4 0 0 1 -4 -4 v-16 M18 38 l-4 4 M30 38 l4 4 M14 24 h20 M18 30 h12" stroke="white" stroke-width="2"/></svg>`,
  school: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M24 14 L10 22 L24 30 L38 22 Z M10 30 L10 38 L24 44 L38 38 L38 30 M38 22 L38 34" stroke="white" stroke-width="2"/></svg>`,
  park: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M24 36 L24 28 M18 28 C12 28 12 14 24 14 C36 14 36 28 30 28 Z" stroke="white" stroke-width="2"/></svg>`,
  mountain: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M10 34 L20 18 L28 28 L38 34 Z M24 24 L30 14 L36 26" stroke="white" stroke-width="2"/></svg>`,
  apartment: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 48 48" fill="white"><path d="M16 34 v-18 h16 v18 M16 34 h16 M20 22 h2 M26 22 h2 M20 28 h2 M26 28 h2" stroke="white" stroke-width="2"/></svg>`,
};

function createIcon(category: string, color: string, L: typeof import("leaflet")) {
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

function createLabel(name: string, extra: string) {
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

function getPoiExtra(poi: Poi): string {
  switch (poi.category) {
    case "subway":
      return (poi as SubwayStation).line;
    case "apartment": {
      const apt = poi as Apartment;
      return `${apt.units.toLocaleString()}세대 | ${apt.price_per_pyeong.toLocaleString()}만/평`;
    }
    case "mountain":
      return `${(poi as { elevation_m: number }).elevation_m}m`;
    default:
      return "";
  }
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { config, pois, layers },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<import("leaflet").LayerGroup | null>(null);
  const circleRef = useRef<import("leaflet").Circle | null>(null);
  const centerMarkerRef = useRef<import("leaflet").Marker | null>(null);

  // Capture dimensions matching PPT map area ratio (MAP_W:SLIDE_H = 9.333:7.5)
  const CAPTURE_W = 1920;
  const CAPTURE_H = Math.round(1920 * 7.5 / 9.333); // ≈ 1543

  useImperativeHandle(ref, () => ({
    async captureImage(): Promise<string> {
      const { toJpeg } = await import("html-to-image");
      if (!containerRef.current) throw new Error("Map container not found");
      return toJpeg(containerRef.current, {
        quality: 0.92,
        width: CAPTURE_W,
        height: CAPTURE_H,
        pixelRatio: 2,
      });
    },
    async captureBaseMap(): Promise<string> {
      if (!markersRef.current || !containerRef.current)
        throw new Error("Map not ready");
      // Hide POI markers
      const savedLayers: import("leaflet").Layer[] = [];
      markersRef.current.eachLayer((layer) => savedLayers.push(layer));
      markersRef.current.clearLayers();
      // Hide radius circle and center marker (will be drawn as PPT shapes)
      if (circleRef.current) circleRef.current.removeFrom(mapRef.current!);
      if (centerMarkerRef.current) centerMarkerRef.current.removeFrom(mapRef.current!);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { toJpeg } = await import("html-to-image");
      const image = await toJpeg(containerRef.current, {
        quality: 0.92,
        width: CAPTURE_W,
        height: CAPTURE_H,
        pixelRatio: 2,
      });
      // Restore all hidden elements
      savedLayers.forEach((layer) => markersRef.current!.addLayer(layer));
      if (circleRef.current) circleRef.current.addTo(mapRef.current!);
      if (centerMarkerRef.current) centerMarkerRef.current.addTo(mapRef.current!);
      return image;
    },
    getPoiPositions(pois: readonly Poi[]): PoiPosition[] {
      if (!mapRef.current) return [];
      const size = mapRef.current.getSize();
      if (size.x === 0 || size.y === 0) return [];
      return pois
        .map((poi) => {
          const point = mapRef.current!.latLngToContainerPoint([
            poi.lat,
            poi.lng,
          ]);
          return { poi, nx: point.x / size.x, ny: point.y / size.y };
        })
        .filter((p) => p.nx >= 0 && p.nx <= 1 && p.ny >= 0 && p.ny <= 1);
    },
    getRadiusPosition(): RadiusPosition | null {
      if (!mapRef.current || !circleRef.current) return null;
      const size = mapRef.current.getSize();
      if (size.x === 0 || size.y === 0) return null;
      const center = circleRef.current.getLatLng();
      const bounds = circleRef.current.getBounds();
      const centerPt = mapRef.current.latLngToContainerPoint(center);
      const nePt = mapRef.current.latLngToContainerPoint(bounds.getNorthEast());
      const swPt = mapRef.current.latLngToContainerPoint(bounds.getSouthWest());
      return {
        centerNx: centerPt.x / size.x,
        centerNy: centerPt.y / size.y,
        radiusNx: (nePt.x - swPt.x) / 2 / size.x,
        radiusNy: (swPt.y - nePt.y) / 2 / size.y,
      };
    },
  }));

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;

      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [config.centerLat, config.centerLng],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 18 }
      ).addTo(map);

      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 18, opacity: 0.6 }
      ).addTo(map);

      mapRef.current = map;
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
            width: 20px; height: 20px;
            background: ${THEME_COLORS.secondaryNavy};
            border: 4px solid white;
            border-radius: 50%;
            box-shadow: 0 0 15px rgba(59,130,246,0.5);
          "></div>`,
          className: "",
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      })
        .addTo(map)
        .bindTooltip(config.centerName, {
          permanent: true,
          direction: "top",
          offset: [0, -15],
          className: "center-tooltip",
        });

      centerMarkerRef.current = centerMarker;
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersRef.current = null;
      circleRef.current = null;
      centerMarkerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update map center, circle, and center marker when config changes
  useEffect(() => {
    if (!mapRef.current || !circleRef.current || !centerMarkerRef.current) return;
    mapRef.current.setView([config.centerLat, config.centerLng], mapRef.current.getZoom());
    circleRef.current.setLatLng([config.centerLat, config.centerLng]);
    circleRef.current.setRadius(config.radiusKm * 1000);
    centerMarkerRef.current.setLatLng([config.centerLat, config.centerLng]);
    centerMarkerRef.current.setTooltipContent(config.centerName);
  }, [config.centerLat, config.centerLng, config.centerName, config.radiusKm]);

  const updateMarkers = useCallback(async () => {
    if (!markersRef.current || !mapRef.current) return;
    const L = (await import("leaflet")).default;
    markersRef.current.clearLayers();

    const visible = pois.filter(
      (p) => layers[p.category] && haversineDistance(config.centerLat, config.centerLng, p.lat, p.lng) <= config.radiusKm * 1000
    );

    visible.forEach((poi) => {
      const color = poi.category === "subway" ? (poi as SubwayStation).lineColor : CATEGORY_COLORS[poi.category];
      const marker = L.marker([poi.lat, poi.lng], {
        icon: createIcon(poi.category, color, L),
      });

      marker.bindTooltip(createLabel(poi.name, getPoiExtra(poi)), {
        direction: "top",
        offset: [0, -18],
        className: "poi-tooltip",
      });

      if (poi.category === "apartment") {
        const dashLine = L.polyline(
          [[config.centerLat, config.centerLng], [poi.lat, poi.lng]],
          { color: "#374151", weight: 1.5, opacity: 0.5, dashArray: "6 4" }
        );
        markersRef.current!.addLayer(dashLine);
      }

      markersRef.current!.addLayer(marker);
    });
  }, [pois, layers, config]);

  useEffect(() => {
    const timer = setTimeout(updateMarkers, 100);
    return () => clearTimeout(timer);
  }, [updateMarkers]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: "100%" }}
    />
  );
});

export default MapView;

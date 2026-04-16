"use client";

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import type { Poi, AnalysisConfig, LayerVisibility, SubwayStation, Apartment } from "@/lib/types";
import { CATEGORY_COLORS } from "@/lib/types";
import { haversineDistance } from "@/lib/geo";

interface MapViewProps {
  readonly config: AnalysisConfig;
  readonly pois: readonly Poi[];
  readonly layers: LayerVisibility;
}

export interface MapViewHandle {
  captureImage(): Promise<string>;
}

const ICON_SVG: Record<string, string> = {
  subway: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M4 11h16"/><circle cx="8" cy="21" r="1"/><circle cx="16" cy="21" r="1"/><path d="M8 17l-2 4"/><path d="M16 17l2 4"/></svg>`,
  school: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 6 3 9 0v-5"/></svg>`,
  park: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2a5 5 0 015 5c0 3-5 8-5 8s-5-5-5-8a5 5 0 015-5z"/><path d="M12 22v-7"/><path d="M9 17l3-2 3 2"/></svg>`,
  mountain: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M8 21l4-10 4 10"/><path d="M2 21h20"/><path d="M15 11l4 10"/><path d="M10 15l-4 6"/></svg>`,
  apartment: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 22V12h6v10"/><path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01"/></svg>`,
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
    background:rgba(0,0,0,0.55);
    backdrop-filter:blur(6px);
    -webkit-backdrop-filter:blur(6px);
    color:#fff;
    padding:4px 8px;
    border-radius:4px;
    font-size:11px;
    font-family:'맑은 고딕',sans-serif;
    white-space:nowrap;
    line-height:1.3;
  "><strong>${name}</strong>${extra ? `<br/><span style="color:#ccc;font-size:10px">${extra}</span>` : ""}</div>`;
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

  useImperativeHandle(ref, () => ({
    async captureImage(): Promise<string> {
      const { toJpeg } = await import("html-to-image");
      if (!containerRef.current) throw new Error("Map container not found");
      return toJpeg(containerRef.current, {
        quality: 0.92,
        width: 1920,
        height: 1080,
        pixelRatio: 2,
      });
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
        color: "#E94560",
        weight: 2,
        fillColor: "#E94560",
        fillOpacity: 0.08,
        dashArray: "8 4",
      }).addTo(map);

      const centerMarker = L.marker([config.centerLat, config.centerLng], {
        icon: L.divIcon({
          html: `<div style="
            width: 16px; height: 16px;
            background: #E94560;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 0 10px rgba(233,69,96,0.6);
          "></div>`,
          className: "",
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      })
        .addTo(map)
        .bindTooltip(config.centerName, {
          permanent: true,
          direction: "top",
          offset: [0, -12],
          className: "center-tooltip",
        });

      centerMarkerRef.current = centerMarker;
    })();

    return () => {
      cancelled = true;
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
          { color: "#FF7043", weight: 1, opacity: 0.4, dashArray: "6 4" }
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

"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type {
  AnalysisConfig,
  Apartment,
  LayerVisibility,
  Poi,
  PoiPosition,
  RadiusPosition,
  SubwayRoute,
  SubwayStation,
} from "@/lib/types";
import { THEME_COLORS } from "@/lib/types";
import { haversineDistance } from "@/lib/geo";
import { clusterPois } from "@/lib/poi-clusters";
import {
  createClusterIcon,
  createIcon,
  createLabel,
  getClusterColor,
  getPoiColor,
  getPoiExtra,
} from "@/lib/map-marker-utils";
import { toJpeg } from "html-to-image";

interface MapViewProps {
  readonly config: AnalysisConfig;
  readonly pois: readonly Poi[];
  readonly layers: LayerVisibility;
  readonly subwayRoutes: readonly SubwayRoute[];
}

export interface MapViewHandle {
  captureImage(): Promise<string>;
  captureBaseMap(): Promise<string>;
  getPoiPositions(pois: readonly Poi[]): PoiPosition[];
  getRadiusPosition(): RadiusPosition | null;
  getRouteNormalizedPositions(routes: readonly SubwayRoute[]): { line: string; lineColor: string; points: { nx: number; ny: number }[] }[];
}

const CAPTURE_W = 1920;
const CAPTURE_H = Math.round(1920 * 7.5 / 9.333);

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

function addSinglePoiMarker(
  L: typeof import("leaflet"),
  markersLayer: import("leaflet").LayerGroup,
  config: AnalysisConfig,
  poi: Poi
) {
  const marker = L.marker([poi.lat, poi.lng], {
    icon: createIcon(poi.category, getPoiColor(poi), L),
    keyboard: true,
  });

  marker.bindTooltip(createLabel(poi.name, getPoiExtra(poi)), {
    direction: "top",
    offset: [0, -18],
    className: "poi-tooltip",
  });
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
  lng: number
) {
  const marker = L.marker([lat, lng], {
    icon: createClusterIcon(items.length, getClusterColor(items), L),
    keyboard: true,
  });

  marker.bindTooltip(createLabel(`${items.length}개 POI`, "클릭하여 확대"), {
    direction: "top",
    offset: [0, -24],
    className: "poi-tooltip",
  });
  marker.on("click", () => zoomToCluster(map, L, items));
  setMarkerAccessibility(marker, `${items.length}개 POI 클러스터, 클릭하여 확대`);
  markersLayer.addLayer(marker);
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { config, pois, layers, subwayRoutes },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markersRef = useRef<import("leaflet").LayerGroup | null>(null);
  const routeLinesRef = useRef<import("leaflet").LayerGroup | null>(null);
  const circleRef = useRef<import("leaflet").Circle | null>(null);
  const centerMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useImperativeHandle(ref, () => ({
    async captureImage(): Promise<string> {
      if (!containerRef.current) {
        throw new Error("Map container not found");
      }

      return toJpeg(containerRef.current, {
        quality: 0.92,
        width: CAPTURE_W,
        height: CAPTURE_H,
        pixelRatio: 2,
      });
    },
    async captureBaseMap(): Promise<string> {
      if (!markersRef.current || !containerRef.current || !mapRef.current) {
        throw new Error("Map not ready");
      }

      const savedLayers: import("leaflet").Layer[] = [];
      markersRef.current.eachLayer((layer) => savedLayers.push(layer));
      markersRef.current.clearLayers();

      const savedRouteLines: import("leaflet").Layer[] = [];
      if (routeLinesRef.current) {
        routeLinesRef.current.eachLayer((layer) => savedRouteLines.push(layer));
        routeLinesRef.current.clearLayers();
      }

      circleRef.current?.removeFrom(mapRef.current);
      centerMarkerRef.current?.removeFrom(mapRef.current);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const image = await toJpeg(containerRef.current, {
        quality: 0.92,
        width: CAPTURE_W,
        height: CAPTURE_H,
        pixelRatio: 2,
      });

      savedLayers.forEach((layer) => markersRef.current?.addLayer(layer));
      savedRouteLines.forEach((layer) => routeLinesRef.current?.addLayer(layer));
      circleRef.current?.addTo(mapRef.current);
      centerMarkerRef.current?.addTo(mapRef.current);

      return image;
    },
    getPoiPositions(selectedPois: readonly Poi[]): PoiPosition[] {
      if (!mapRef.current) {
        return [];
      }

      const size = mapRef.current.getSize();
      if (size.x === 0 || size.y === 0) {
        return [];
      }

      return selectedPois
        .map((poi) => {
          const point = mapRef.current!.latLngToContainerPoint([poi.lat, poi.lng]);
          return { poi, nx: point.x / size.x, ny: point.y / size.y };
        })
        .filter((position) => position.nx >= 0 && position.nx <= 1 && position.ny >= 0 && position.ny <= 1);
    },
    getRadiusPosition(): RadiusPosition | null {
      if (!mapRef.current || !circleRef.current) {
        return null;
      }

      const size = mapRef.current.getSize();
      if (size.x === 0 || size.y === 0) {
        return null;
      }

      const center = circleRef.current.getLatLng();
      const bounds = circleRef.current.getBounds();
      const centerPoint = mapRef.current.latLngToContainerPoint(center);
      const northEastPoint = mapRef.current.latLngToContainerPoint(bounds.getNorthEast());
      const southWestPoint = mapRef.current.latLngToContainerPoint(bounds.getSouthWest());

      return {
        centerNx: centerPoint.x / size.x,
        centerNy: centerPoint.y / size.y,
        radiusNx: (northEastPoint.x - southWestPoint.x) / 2 / size.x,
        radiusNy: (southWestPoint.y - northEastPoint.y) / 2 / size.y,
      };
    },
    getRouteNormalizedPositions(routes: readonly SubwayRoute[]) {
      if (!mapRef.current) {
        return [];
      }

      const size = mapRef.current.getSize();
      if (size.x === 0 || size.y === 0) {
        return [];
      }

      return routes
        .filter((route) => route.coordinates && route.coordinates.length >= 2)
        .map((route) => ({
          line: route.line,
          lineColor: route.lineColor,
          points: route.coordinates!.map(([lat, lng]) => {
            const point = mapRef.current!.latLngToContainerPoint([lat, lng]);
            return { nx: point.x / size.x, ny: point.y / size.y };
          }),
        }));
    },
  }));

  useEffect(() => {
    if (mapRef.current || !containerRef.current) {
      return;
    }

    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;

      if (cancelled || !containerRef.current) {
        return;
      }

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
      routeLinesRef.current = L.layerGroup().addTo(map);
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
      setMapReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = null;
      routeLinesRef.current = null;
      circleRef.current = null;
      centerMarkerRef.current = null;
    };
  }, []);

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
    const map = mapRef.current;
    const markersLayer = markersRef.current;
    if (!map || !markersLayer) {
      return;
    }

    const L = (await import("leaflet")).default;
    markersLayer.clearLayers();

    const visiblePois = pois.filter(
      (poi) =>
        layers[poi.category] &&
        haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng) <= config.radiusKm * 1000
    );

    if (routeLinesRef.current) {
      routeLinesRef.current.clearLayers();
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

          routeLinesRef.current?.addLayer(
            L.polyline(coordinates, {
              color: route.lineColor,
              weight: 4,
              opacity: 0.85,
            })
          );
        });
      }
    }

    const clusters = clusterPois(
      visiblePois.map((poi) => {
        const point = map.latLngToContainerPoint([poi.lat, poi.lng]);
        return { poi, x: point.x, y: point.y };
      })
    );

    clusters.forEach((cluster) => {
      if (cluster.items.length === 1) {
        addSinglePoiMarker(L, markersLayer, config, cluster.items[0]);
        return;
      }

      addClusterMarker(L, map, markersLayer, cluster.items, cluster.lat, cluster.lng);
    });
  }, [config, layers, pois, subwayRoutes]);

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

  return <div ref={containerRef} className="min-h-full h-full w-full" />;
});

export default MapView;

"use client";

import { useState, useRef, useCallback } from "react";
import type { AnalysisConfig, LayerVisibility, Poi } from "@/lib/types";
import { THEME_COLORS } from "@/lib/types";
import type { MapViewHandle } from "./map-view";
import type { SlideSpec } from "@/lib/slide-spec";
import MapView from "./map-view";
import Sidebar from "./sidebar";
import ExportPreview from "./export-preview";
import {
  DEFAULT_CONFIG,
  SUBWAY_STATIONS,
  SCHOOLS,
  PARKS,
  MOUNTAINS,
  APARTMENTS,
  SUBWAY_ROUTES,
} from "@/lib/seed-data";

const ALL_POIS: readonly Poi[] = [
  ...SUBWAY_STATIONS,
  ...SCHOOLS,
  ...PARKS,
  ...MOUNTAINS,
  ...APARTMENTS,
];

export default function SiteAnalysisApp() {
  const mapRef = useRef<MapViewHandle>(null);
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [layers, setLayers] = useState<LayerVisibility>({
    subway: true,
    school: true,
    park: true,
    mountain: true,
    apartment: true,
  });
  const [exporting, setExporting] = useState(false);
  const [previewSpecs, setPreviewSpecs] = useState<readonly SlideSpec[] | null>(null);

  const handleToggleLayer = useCallback((category: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [category]: !prev[category] }));
  }, []);

  const handleConfigChange = useCallback((newConfig: AnalysisConfig) => {
    setConfig(newConfig);
  }, []);

  const handleExport = useCallback(async () => {
    if (!mapRef.current) return;
    setExporting(true);
    try {
      const radiusPosition = mapRef.current.getRadiusPosition();
      let baseMapImage = "";
      try {
        baseMapImage = await mapRef.current.captureBaseMap();
      } catch (err) {
        console.error("Base map capture failed:", err);
      }
      const visiblePois = ALL_POIS.filter((p) => layers[p.category]);
      const poiPositions = mapRef.current.getPoiPositions(visiblePois);
      const routePositions = mapRef.current.getRouteNormalizedPositions(SUBWAY_ROUTES);
      const { buildSlides } = await import("@/lib/slide-builder");
      setPreviewSpecs(
        buildSlides({
          config,
          pois: visiblePois,
          baseMapImage,
          poiPositions,
          radiusPosition,
          routePositions,
        })
      );
    } catch (err) {
      console.error("Slide build failed:", err);
    } finally {
      setExporting(false);
    }
  }, [layers, config]);

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden md:flex-row"
      style={{ backgroundColor: THEME_COLORS.overlayDark }}
    >
      <Sidebar
        config={config}
        layers={layers}
        pois={ALL_POIS}
        exporting={exporting}
        onToggleLayer={handleToggleLayer}
        onConfigChange={handleConfigChange}
        onExport={handleExport}
      />
      <main className="relative isolate min-h-0 flex-1">
        <MapView
          ref={mapRef}
          config={config}
          pois={ALL_POIS}
          layers={layers}
          subwayRoutes={SUBWAY_ROUTES}
        />
        {exporting && (
          <div className="absolute inset-0 bg-[#0F172A]/80 backdrop-blur-sm flex items-center justify-center z-[1100]">
            <div className="bg-[#1E3A8A] rounded-2xl p-10 text-center shadow-2xl border border-white/10">
              <div className="w-12 h-12 border-4 border-blue-400 border-t-white rounded-full animate-spin mx-auto mb-6" />
              <p className="text-white text-lg font-bold">미리보기 준비 중</p>
              <p className="text-blue-200/60 text-sm mt-2 font-medium">위성지도 캡처 및 슬라이드 구성 중...</p>
            </div>
          </div>
        )}
      </main>
      {previewSpecs && (
        <ExportPreview
          specs={previewSpecs}
          fileName={`${config.centerName}_사이트분석.pptx`}
          onClose={() => setPreviewSpecs(null)}
        />
      )}
    </div>
  );
}

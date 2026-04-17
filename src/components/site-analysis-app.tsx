"use client";

import { useState, useRef, useCallback } from "react";
import type { AnalysisConfig, LayerVisibility, Poi } from "@/lib/types";
import { THEME_COLORS } from "@/lib/types";
import type { MapViewHandle } from "./map-view";
import MapView from "./map-view";
import Sidebar from "./sidebar";
import {
  DEFAULT_CONFIG,
  SUBWAY_STATIONS,
  SCHOOLS,
  PARKS,
  MOUNTAINS,
  APARTMENTS,
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
      const baseMapImage = await mapRef.current.captureBaseMap();
      const visiblePois = ALL_POIS.filter((p) => layers[p.category]);
      const poiPositions = mapRef.current.getPoiPositions(visiblePois);
      const { generateSiteAnalysisPpt } = await import("@/lib/ppt-generator");
      await generateSiteAnalysisPpt(config, visiblePois, baseMapImage, poiPositions, radiusPosition);
    } catch (err) {
      console.error("PPT generation failed:", err);
    } finally {
      setExporting(false);
    }
  }, [layers, config]);

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ backgroundColor: THEME_COLORS.overlayDark }}>
      <Sidebar
        config={config}
        layers={layers}
        pois={ALL_POIS}
        exporting={exporting}
        onToggleLayer={handleToggleLayer}
        onConfigChange={handleConfigChange}
        onExport={handleExport}
      />
      <main className="flex-1 relative">
        <MapView
          ref={mapRef}
          config={config}
          pois={ALL_POIS}
          layers={layers}
        />
        {exporting && (
          <div className="absolute inset-0 bg-[#0F172A]/80 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#1E3A8A] rounded-2xl p-10 text-center shadow-2xl border border-white/10">
              <div className="w-12 h-12 border-4 border-blue-400 border-t-white rounded-full animate-spin mx-auto mb-6" />
              <p className="text-white text-lg font-bold">PPT 리포트 생성 중</p>
              <p className="text-blue-200/60 text-sm mt-2 font-medium">위성지도 캡처 및 데이터 분석 중...</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

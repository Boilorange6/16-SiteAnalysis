"use client";

import { useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import type { AnalysisConfig, LayerVisibility, Poi } from "@/lib/types";
import type { MapViewHandle } from "./map-view";
import Sidebar from "./sidebar";
import {
  DEFAULT_CONFIG,
  SUBWAY_STATIONS,
  SCHOOLS,
  PARKS,
  MOUNTAINS,
  APARTMENTS,
} from "@/lib/seed-data";

const MapView = dynamic(() => import("./map-view"), { ssr: false });

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
      const mapImage = await mapRef.current.captureImage();
      const { generateSiteAnalysisPpt } = await import("@/lib/ppt-generator");
      const visiblePois = ALL_POIS.filter((p) => layers[p.category]);
      await generateSiteAnalysisPpt(config, visiblePois, mapImage);
    } catch (err) {
      console.error("PPT generation failed:", err);
    } finally {
      setExporting(false);
    }
  }, [layers, config]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0F0F23]">
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
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-[#1A1A2E] rounded-xl p-8 text-center shadow-2xl">
              <div className="w-12 h-12 border-4 border-[#E94560] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-white font-medium">PPT 생성 중...</p>
              <p className="text-gray-400 text-sm mt-1">지도 캡처 및 슬라이드 생성</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

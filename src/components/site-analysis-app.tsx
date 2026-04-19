"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type {
  AnalysisConfig,
  LayerVisibility,
  Poi,
  RegionData,
  RegionMetadata,
} from "@/lib/types";
import type { MapViewHandle } from "./map-view";
import MapView from "./map-view";
import Sidebar from "./sidebar";
import { DEFAULT_CONFIG, DEFAULT_REGION_CODE } from "@/lib/seed-data";
import {
  loadRegion,
  getAvailableRegions,
  loadDynamicRegion,
  type AddressSearchResult,
} from "@/lib/data-provider";
import { haversineDistance } from "@/lib/geo";

export default function SiteAnalysisApp() {
  const mapRef = useRef<MapViewHandle>(null);
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [regionCode, setRegionCode] = useState(DEFAULT_REGION_CODE);
  const [regionData, setRegionData] = useState<RegionData | null>(null);
  const [dynamicAddress, setDynamicAddress] = useState<AddressSearchResult | null>(null);
  const [availableRegions, setAvailableRegions] = useState<readonly RegionMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>({
    subway: true,
    school: true,
    park: true,
    mountain: true,
    apartment: true,
  });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getAvailableRegions()
      .then((regions) => {
        if (cancelled) {
          return;
        }

        setAvailableRegions(regions);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("검색 가능한 분석 지역 목록을 불러오지 못했습니다.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (dynamicAddress) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadRegion(regionCode)
      .then((data) => {
        if (cancelled) {
          return;
        }

        setRegionData(data);
        setConfig(data.defaultConfig);
      })
      .catch(() => {
        if (!cancelled) {
          setRegionData(null);
          setLoadError("선택한 지역의 POI 데이터를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dynamicAddress, regionCode]);

  useEffect(() => {
    if (!dynamicAddress) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    loadDynamicRegion(config, dynamicAddress.address)
      .then((data) => {
        if (!cancelled) {
          setRegionData(data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "실시간 POI 데이터를 불러오지 못했습니다.";
          setRegionData(null);
          setLoadError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config.centerLat, config.centerLng, config.radiusKm, dynamicAddress]);

  const allPois: readonly Poi[] = regionData
    ? [
        ...regionData.subwayStations,
        ...regionData.schools,
        ...regionData.parks,
        ...regionData.mountains,
        ...regionData.apartments,
      ]
    : [];
  const poisInRange = allPois.filter(
    (poi) => haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng) <= config.radiusKm * 1000
  );

  const subwayRoutes = regionData?.subwayRoutes ?? [];

  const handleToggleLayer = useCallback((category: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [category]: !prev[category] }));
  }, []);

  const handleConfigChange = useCallback((newConfig: AnalysisConfig) => {
    setConfig(newConfig);
  }, []);

  const handleRegionSelect = useCallback((region: RegionMetadata) => {
    setDynamicAddress(null);
    setConfig(region.defaultConfig);
    setRegionCode(region.regionCode);
  }, []);

  const handleAddressSelect = useCallback((result: AddressSearchResult) => {
    setDynamicAddress(result);
    setConfig((previous) => ({
      centerName: result.name,
      centerLat: result.lat,
      centerLng: result.lng,
      radiusKm: previous.radiusKm,
    }));
  }, []);

  const handleExport = useCallback(async () => {
    if (!mapRef.current) return;
    setExporting(true);
    try {
      const radiusPosition = mapRef.current.getRadiusPosition();
      const baseMapImage = await mapRef.current.captureBaseMap();
      const visiblePois = allPois.filter(
        (poi) =>
          layers[poi.category] &&
          haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng) <= config.radiusKm * 1000
      );
      const poiPositions = mapRef.current.getPoiPositions(visiblePois);
      const routePositions = mapRef.current.getRouteNormalizedPositions(subwayRoutes);
      const { generateSiteAnalysisPpt } = await import("@/lib/ppt-generator");
      await generateSiteAnalysisPpt(config, visiblePois, baseMapImage, poiPositions, radiusPosition, routePositions);
    } catch (err) {
      console.error("PPT generation failed:", err);
    } finally {
      setExporting(false);
    }
  }, [allPois, layers, config, subwayRoutes]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#0F172A]">
      <Sidebar
        config={config}
        layers={layers}
        pois={poisInRange}
        exporting={exporting}
        loading={loading}
        regionCode={regionCode}
        availableRegions={availableRegions}
        onToggleLayer={handleToggleLayer}
        onConfigChange={handleConfigChange}
        onRegionSelect={handleRegionSelect}
        onSelectAddress={handleAddressSelect}
        onExport={handleExport}
      />
      <main className="relative min-h-0 flex-1">
        {loading ? (
          <div
            className="absolute inset-0 z-[900] flex items-center justify-center bg-[#0F172A]"
            role="status"
            aria-live="polite"
          >
            <div className="bg-[#1E3A8A] rounded-2xl p-10 text-center shadow-2xl border border-white/10">
              <div className="w-12 h-12 border-4 border-blue-400 border-t-white rounded-full animate-spin mx-auto mb-6" />
              <p className="text-white text-lg font-bold">데이터 로딩 중</p>
              <p className="text-blue-200/60 text-sm mt-2 font-medium">지역 POI 데이터를 불러오고 있습니다...</p>
            </div>
          </div>
        ) : loadError ? (
          <div
            className="absolute inset-0 z-[900] flex items-center justify-center bg-[#0F172A]"
            role="alert"
            aria-live="assertive"
          >
            <div className="max-w-md rounded-2xl border border-red-400/20 bg-[#1E293B] p-8 text-center shadow-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.28em] text-red-200/70">Load Error</p>
              <p className="mt-3 text-lg font-bold text-white">{loadError}</p>
              <p className="mt-2 text-sm text-slate-300">
                주소 검색에서 다른 지역을 선택하거나 새로고침 후 다시 시도해 주세요.
              </p>
            </div>
          </div>
        ) : (
          <MapView
            ref={mapRef}
            config={config}
            pois={allPois}
            layers={layers}
            subwayRoutes={subwayRoutes}
          />
        )}
        {exporting && (
          <div
            className="absolute inset-0 z-[950] flex items-center justify-center bg-[#0F172A]/80 backdrop-blur-sm"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
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

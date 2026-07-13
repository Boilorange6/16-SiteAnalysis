"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type {
  AnalysisConfig,
  Apartment,
  LayerVisibility,
  MaintenanceProject,
  Mountain,
  Officetel,
  Park,
  Poi,
  PoiCategory,
  PoiSourceId,
  RegionData,
  ResidentialOther,
  School,
  SubwayStation,
} from "@/lib/types";
import { POI_SOURCE_CATEGORIES } from "@/lib/types";
import type { MapViewHandle } from "./map-view";
import MapView from "./map-view";
import Sidebar, { type ApartmentFilter } from "./sidebar";
import {
  deleteAnalysisProject,
  getApiKeyStatus,
  listAnalysisProjects,
  loadDynamicRegion,
  loadAnalysisProject,
  reloadSource,
  saveAnalysisProject,
  type AddressSearchResult,
} from "@/lib/data-provider";
import { haversineDistance } from "@/lib/geo";
import {
  buildInsightOverlays,
  computeAnalysisScores,
  generateAnalysisNarrative,
} from "@/lib/analysis-engine";
import type { PptDesignConfig } from "@/lib/ppt-design-config";
import type { SlideRenderInput } from "@/lib/ppt-canvas-renderer";
import PptPreviewModal from "./ppt-preview-modal";
import type { AnalysisProjectSummary, ApiKeyStatusResponse } from "@/lib/project-types";

const INITIAL_CONFIG: AnalysisConfig = {
  centerName: "",
  centerLat: 37.5665,
  centerLng: 126.9780,
  radiusKm: 3,
};

export default function SiteAnalysisApp() {
  const mapRef = useRef<MapViewHandle>(null);
  const [config, setConfig] = useState<AnalysisConfig>(INITIAL_CONFIG);
  const [regionData, setRegionData] = useState<RegionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>({
    subway: true,
    school: true,
    park: true,
    mountain: true,
    apartment: true,
    officetel: true,
    residential: true,
    maintenance: true,
  });
  const [exporting, setExporting] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewInput, setPreviewInput] = useState<SlideRenderInput | null>(null);
  const [apartmentFilter, setApartmentFilter] = useState<ApartmentFilter>({ enabled: false, minYear: 2013 });
  const [manualPois, setManualPois] = useState<Poi[]>([]);
  const [visibleInsightOverlayIds, setVisibleInsightOverlayIds] = useState<string[]>(["station-500", "park-500"]);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatusResponse | null>(null);
  const [projects, setProjects] = useState<readonly AnalysisProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<number | undefined>(undefined);
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectMessage, setProjectMessage] = useState("");
  // 1단계 데이터 신뢰성: 소스 단독 재시도 진행 상태 + 전체 새로 수집 강제 플래그
  const [retryingSource, setRetryingSource] = useState<PoiSourceId | null>(null);
  const forceRefreshRef = useRef(false);
  // 재시도 fetch가 진행되는 동안(await 중) config가 바뀔 수 있으므로 병합 시점의 "현재" 좌표를
  // 확인하기 위한 ref — useCallback 클로저 안의 config는 fetch 시작 시점 값에 고정되어 있어 사용 불가
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (!hasSearched) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    // handleForceRefresh가 설정한 강제 새로고침 플래그를 읽고 즉시 리셋(useEffect 의존성에는 넣지 않음)
    const forceRefresh = forceRefreshRef.current;
    forceRefreshRef.current = false;

    // Geo-based search via Overpass API — no area prefix needed
    loadDynamicRegion(config.centerLat, config.centerLng, config.radiusKm, { forceRefresh })
      .then((data) => {
        if (!cancelled) {
          setRegionData(data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "POI 데이터를 불러오지 못했습니다.";
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
  }, [config.centerLat, config.centerLng, config.radiusKm, hasSearched, reloadNonce]);

  const yearFilter = (poi: { sale_date: string; move_in_month?: string; status?: string }) => {
    if (!apartmentFilter.enabled) return true;
    const year = parseInt(poi.sale_date || poi.move_in_month || "");
    if (poi.status === "planned" && isNaN(year)) return true;
    if (isNaN(year)) return false;
    return year >= apartmentFilter.minYear;
  };

  const filteredApartments = regionData ? regionData.apartments.filter(yearFilter) : [];
  const filteredOfficetels = regionData ? regionData.officetels.filter(yearFilter) : [];
  const filteredResidentials = regionData ? regionData.residentialOthers.filter(yearFilter) : [];

  const allPois: readonly Poi[] = [
    ...(regionData
      ? [
        ...regionData.subwayStations,
        ...regionData.schools,
        ...regionData.parks,
        ...regionData.mountains,
        ...filteredApartments,
        ...filteredOfficetels,
        ...filteredResidentials,
        ...regionData.maintenanceProjects,
      ]
      : []),
    ...manualPois,
  ];
  const poisInRange = allPois.filter(
    (poi) => haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng) <= config.radiusKm * 1000
  );

  const subwayRoutes = regionData?.subwayRoutes ?? [];
  const displayedPois = loading ? [] : allPois;
  const displayedSubwayRoutes = loading ? [] : subwayRoutes;
  const canExport = hasSearched && !loading && !loadError && regionData !== null;
  const exportDisabledReason = !hasSearched
    ? "주소 검색 후 PPT를 만들 수 있습니다."
    : loading
      ? "데이터를 불러오는 중입니다."
      : loadError
        ? "데이터 로딩 오류를 해결한 뒤 다시 시도해 주세요."
        : undefined;

  const handleToggleLayer = useCallback((category: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [category]: !prev[category] }));
  }, []);

  const insightOverlays = useMemo(
    () => buildInsightOverlays(config, poisInRange),
    [config, poisInRange],
  );
  const analysisScores = useMemo(
    () => computeAnalysisScores(config, poisInRange),
    [config, poisInRange],
  );
  const insightNarrative = useMemo(
    () => generateAnalysisNarrative(config, poisInRange),
    [config, poisInRange],
  );
  useEffect(() => {
    let cancelled = false;
    Promise.all([getApiKeyStatus(), listAnalysisProjects()])
      .then(([status, projectList]) => {
        if (!cancelled) {
          setApiKeyStatus(status);
          setProjects(projectList);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiKeyStatus(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfigChange = useCallback((newConfig: AnalysisConfig) => {
    setConfig(newConfig);
    setHasSearched(true);
  }, []);

  const handleAddressSelect = useCallback((result: AddressSearchResult) => {
    setConfig((previous) => ({
      centerName: result.name,
      centerLat: result.lat,
      centerLng: result.lng,
      radiusKm: previous.radiusKm,
    }));
    setHasSearched(true);
  }, []);

  const handleRetryLoad = useCallback(() => {
    if (!hasSearched) return;
    setLoadError(null);
    setRegionData(null);
    setReloadNonce((value) => value + 1);
  }, [hasSearched]);

  // 1단계 데이터 신뢰성: 전체 데이터 강제 새로 수집(모든 소스 캐시 무시)
  const handleForceRefresh = useCallback(() => {
    forceRefreshRef.current = true;
    setReloadNonce((value) => value + 1);
  }, []);

  // 1단계 데이터 신뢰성: 실패한(또는 임의의) 소스 하나만 골라 재시도 — 해당 카테고리 POI만 교체
  const handleRetrySource = useCallback(async (source: PoiSourceId) => {
    if (!regionData) return;
    // fetch 시작 시점의 좌표를 캡처 — 재시도 중 사용자가 다른 주소를 분석하면(config 변경)
    // 병합 직전 비교로 걸러내어 옛 지역 데이터가 새 지역에 섞이는 것을 방지
    const fetchCenterLat = config.centerLat;
    const fetchCenterLng = config.centerLng;
    const fetchRadiusKm = config.radiusKm;
    setRetryingSource(source);
    try {
      const r = await reloadSource(fetchCenterLat, fetchCenterLng, fetchRadiusKm, source);

      // 경쟁 조건 가드: fetch가 끝난 시점의 "현재" config와 시작 시점 좌표가 다르면
      // 이미 다른 지역을 분석 중인 것이므로 병합을 건너뛴다
      const current = configRef.current;
      if (
        current.centerLat !== fetchCenterLat ||
        current.centerLng !== fetchCenterLng ||
        current.radiusKm !== fetchRadiusKm
      ) {
        return;
      }

      setRegionData((prev) => {
        if (!prev) return prev;

        // allSources가 있으면(poi-search 경로) 응답에 포함된 소스들을 모두 갱신 — residential과
        // planned-residential은 카테고리를 공유해 함께 재수집되므로 두 상태 모두 최신화해야 함.
        // 없으면(subway-routes 경로) 해당 소스 하나만 갱신.
        const sourceStatuses = r.allSources
          ? prev.sourceStatuses.map((s) => r.allSources!.find((rs) => rs.source === s.source) ?? s)
          : prev.sourceStatuses.map((s) => (s.source === source ? r.status : s));

        if (source === "subway-routes") {
          return {
            ...prev,
            subwayRoutes: r.routes ?? prev.subwayRoutes,
            sourceStatuses,
          };
        }

        const cats = POI_SOURCE_CATEGORIES[source];
        return {
          ...prev,
          subwayStations: cats.includes("subway")
            ? r.pois.filter((p): p is SubwayStation => p.category === "subway")
            : prev.subwayStations,
          schools: cats.includes("school")
            ? r.pois.filter((p): p is School => p.category === "school")
            : prev.schools,
          parks: cats.includes("park")
            ? r.pois.filter((p): p is Park => p.category === "park")
            : prev.parks,
          mountains: cats.includes("mountain")
            ? r.pois.filter((p): p is Mountain => p.category === "mountain")
            : prev.mountains,
          apartments: cats.includes("apartment")
            ? r.pois.filter((p): p is Apartment => p.category === "apartment")
            : prev.apartments,
          officetels: cats.includes("officetel")
            ? r.pois.filter((p): p is Officetel => p.category === "officetel")
            : prev.officetels,
          residentialOthers: cats.includes("residential")
            ? r.pois.filter((p): p is ResidentialOther => p.category === "residential")
            : prev.residentialOthers,
          maintenanceProjects: cats.includes("maintenance")
            ? r.pois.filter((p): p is MaintenanceProject => p.category === "maintenance")
            : prev.maintenanceProjects,
          sourceStatuses,
        };
      });
    } catch (error) {
      // 재시도 실패 — 해당 소스 상태는 이미 "failed"이므로 별도 갱신 없이 콘솔 경고만 남긴다
      // (unhandled rejection 방지, 사용자에게는 배지가 계속 ⚠️로 남는 것으로 충분)
      console.warn(`[handleRetrySource] 소스 재시도 실패: ${source}`, error);
    } finally {
      setRetryingSource(null);
    }
  }, [regionData, config]);

  const createManualPoi = useCallback((
    category: PoiCategory,
    name: string,
    lat: number,
    lng: number,
  ): Poi => {
    const id = `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = { id, name, lat, lng, category };
    switch (category) {
      case "subway":
        return { ...base, category, line: "수동 등록", lineColor: "#F59E0B" };
      case "school":
        return { ...base, category, level: "elementary" };
      case "park":
        return { ...base, category, area_sqm: 0, type: "수동 등록", source: "official", quality: "unknown" };
      case "mountain":
        return { ...base, category, elevation_m: 0 };
      case "maintenance":
        return {
          ...base,
          category,
          type: "수동 등록",
          stage: "미확인",
          address: "",
          area_sqm: 0,
          source: "seoul_open_data",
          boundary_status: "unavailable",
        };
      case "officetel":
      case "residential":
      case "apartment":
        return {
          ...base,
          category,
          units: 0,
          parking_count: 0,
          sale_date: "",
          distance_m: haversineDistance(config.centerLat, config.centerLng, lat, lng),
          status: "existing",
          source: "ledger",
        };
      default:
        return { ...base, category: "park", area_sqm: 0, type: "수동 등록" };
    }
  }, [config.centerLat, config.centerLng]);

  const handleAddManualPoi = useCallback((category: PoiCategory, name: string, lat: number, lng: number) => {
    setManualPois((previous) => [...previous, createManualPoi(category, name, lat, lng)]);
  }, [createManualPoi]);

  const handleUpdateManualPoi = useCallback((id: string, patch: { name: string; lat: number; lng: number }) => {
    if (!Number.isFinite(patch.lat) || !Number.isFinite(patch.lng)) {
      return;
    }
    setManualPois((previous) =>
      previous.map((poi) =>
        poi.id === id
          ? ({ ...poi, name: patch.name, lat: patch.lat, lng: patch.lng } as Poi)
          : poi
      )
    );
  }, []);

  const handleRemoveManualPoi = useCallback((id: string) => {
    setManualPois((previous) => previous.filter((poi) => poi.id !== id));
  }, []);

  const toggleInsightOverlay = useCallback((id: string) => {
    setVisibleInsightOverlayIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
    );
  }, []);

  const refreshProjects = useCallback(async () => {
    const projectList = await listAnalysisProjects();
    setProjects(projectList);
  }, []);

  const handleSaveProject = useCallback(async () => {
    setProjectSaving(true);
    setProjectMessage("");
    try {
      const title = config.centerName ? `${config.centerName} ${config.radiusKm}km 분석` : "새 입지 분석";
      const project = await saveAnalysisProject(
        title,
        { config, layers, manualPois, apartmentFilter },
        currentProjectId,
      );
      setCurrentProjectId(project.id);
      await refreshProjects();
      setProjectMessage("프로젝트가 저장되었습니다.");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "프로젝트 저장에 실패했습니다.");
    } finally {
      setProjectSaving(false);
    }
  }, [apartmentFilter, config, currentProjectId, layers, manualPois, refreshProjects]);

  const handleLoadProject = useCallback(async (id: number) => {
    setProjectSaving(true);
    setProjectMessage("");
    try {
      const project = await loadAnalysisProject(id);
      setConfig(project.payload.config);
      setLayers(project.payload.layers);
      setManualPois([...project.payload.manualPois]);
      setApartmentFilter(project.payload.apartmentFilter);
      setCurrentProjectId(project.id);
      setHasSearched(true);
      setProjectMessage("저장된 프로젝트를 불러왔습니다.");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "프로젝트를 불러오지 못했습니다.");
    } finally {
      setProjectSaving(false);
    }
  }, []);

  const handleDeleteProject = useCallback(async (id: number) => {
    setProjectSaving(true);
    setProjectMessage("");
    try {
      await deleteAnalysisProject(id);
      if (currentProjectId === id) {
        setCurrentProjectId(undefined);
      }
      await refreshProjects();
      setProjectMessage("프로젝트를 삭제했습니다.");
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "프로젝트 삭제에 실패했습니다.");
    } finally {
      setProjectSaving(false);
    }
  }, [currentProjectId, refreshProjects]);

  const collectExportData = useCallback(async () => {
    if (!mapRef.current) return null;
    const visiblePois = allPois.filter(
      (poi) =>
        layers[poi.category] &&
        haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng) <= config.radiusKm * 1000
    );
    // PPT 지도 표준 프레이밍: 반경 링 지름 = 프레임 높이 80%가 되도록 캡처 시점에만 일시
    // 재프레이밍하고, 완료 후 사용자 화면의 원래 줌·중심으로 자동 복구된다(map-view.tsx).
    const framed = await mapRef.current.captureStandardFramedExport(visiblePois, subwayRoutes);
    if (!framed) return null;
    return {
      config,
      allPois: visiblePois,
      baseMapImage: framed.baseMapImage,
      poiPositions: framed.poiPositions,
      radiusPosition: framed.radiusPosition,
      routePositions: framed.routePositions,
      sourceStatuses: regionData?.sourceStatuses ?? [],
    };
  }, [allPois, layers, config, subwayRoutes, regionData]);

  const handlePreview = useCallback(async () => {
    if (!mapRef.current || !canExport) return;
    setExporting(true);
    try {
      const data = await collectExportData();
      if (!data) return;
      setPreviewInput(data);
      setPreviewOpen(true);
    } catch (err) {
      console.error("Preview preparation failed:", err);
    } finally {
      setExporting(false);
    }
  }, [canExport, collectExportData]);

  const handleDownloadWithDesign = useCallback(async (designConfig: PptDesignConfig, includeScoreDashboard: boolean) => {
    if (!previewInput) return;
    const { generateSiteAnalysisPpt } = await import("@/lib/ppt-generator");
    await generateSiteAnalysisPpt(
      previewInput.config,
      previewInput.allPois,
      previewInput.baseMapImage,
      previewInput.poiPositions,
      previewInput.radiusPosition,
      previewInput.routePositions,
      designConfig,
      previewInput.sourceStatuses ?? [],
      includeScoreDashboard
    );
  }, [previewInput]);

  const handleExport = useCallback(async () => {
    if (!mapRef.current || !canExport) return;
    setExporting(true);
    try {
      const data = await collectExportData();
      if (!data) return;
      const { generateSiteAnalysisPpt } = await import("@/lib/ppt-generator");
      await generateSiteAnalysisPpt(
        data.config, data.allPois, data.baseMapImage,
        data.poiPositions, data.radiusPosition, data.routePositions,
        undefined, data.sourceStatuses
      );
    } catch (err) {
      console.error("PPT generation failed:", err);
    } finally {
      setExporting(false);
    }
  }, [canExport, collectExportData]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#0F172A]">
      <Sidebar
        config={config}
        layers={layers}
        pois={poisInRange}
        apartmentFilter={apartmentFilter}
        exporting={exporting}
        loading={loading}
        hasSearched={hasSearched}
        loadError={loadError}
        canExport={canExport}
        exportDisabledReason={exportDisabledReason}
        analysisScores={analysisScores}
        insightNarrative={insightNarrative}
        insightOverlays={insightOverlays}
        visibleInsightOverlayIds={visibleInsightOverlayIds}
        manualPois={manualPois}
        apiKeyStatus={apiKeyStatus}
        projects={projects}
        currentProjectId={currentProjectId}
        projectSaving={projectSaving}
        projectMessage={projectMessage}
        sourceStatuses={regionData?.sourceStatuses ?? []}
        retryingSource={retryingSource}
        onToggleLayer={handleToggleLayer}
        onToggleInsightOverlay={toggleInsightOverlay}
        onConfigChange={handleConfigChange}
        onSelectAddress={handleAddressSelect}
        onRetryLoad={handleRetryLoad}
        onRetrySource={handleRetrySource}
        onForceRefresh={handleForceRefresh}
        onApartmentFilterChange={setApartmentFilter}
        onAddManualPoi={handleAddManualPoi}
        onUpdateManualPoi={handleUpdateManualPoi}
        onRemoveManualPoi={handleRemoveManualPoi}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProject}
        onDeleteProject={handleDeleteProject}
        onExport={handleExport}
        onPreview={handlePreview}
      />
      <main className="relative min-h-0 flex-1">
        <MapView
          ref={mapRef}
          config={config}
          pois={displayedPois}
          layers={layers}
          subwayRoutes={displayedSubwayRoutes}
          insightOverlays={insightOverlays}
          visibleInsightOverlayIds={visibleInsightOverlayIds}
        />
        {!hasSearched && !loading && (
          <div
            className="absolute inset-0 z-[900] flex items-center justify-center bg-[#0F172A]/80"
            role="status"
          >
            <div className="max-w-md rounded-2xl border border-white/10 bg-[#1E3A8A] p-10 text-center shadow-2xl">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="mx-auto mb-6 text-blue-300">
                <path d="M21 21L16.65 16.65M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className="text-xl font-bold text-white">분석할 장소를 검색하세요</p>
              <p className="mt-3 text-sm text-blue-200/60">
                좌측 패널에서 주소를 입력하면 주변 지하철역, 학교, 공원, 산, 아파트를 자동으로 분석합니다.
              </p>
            </div>
          </div>
        )}
        {loading && (
          <div
            className="absolute inset-0 z-[900] flex items-center justify-center bg-[#0F172A]"
            role="status"
            aria-live="polite"
          >
            <div className="bg-[#1E3A8A] rounded-2xl p-10 text-center shadow-2xl border border-white/10">
              <div className="w-12 h-12 border-4 border-blue-400 border-t-white rounded-full animate-spin mx-auto mb-6" />
              <p className="text-white text-lg font-bold">데이터 로딩 중</p>
              <p className="text-blue-200/60 text-sm mt-2 font-medium">주변 POI 데이터를 불러오고 있습니다...</p>
            </div>
          </div>
        )}
        {loadError && !loading && (
          <div
            className="absolute inset-0 z-[900] flex items-center justify-center bg-[#0F172A]"
            role="alert"
            aria-live="assertive"
          >
            <div className="max-w-md rounded-2xl border border-red-300/25 bg-[#111827]/95 p-8 text-center shadow-2xl backdrop-blur">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-red-200/75">데이터 로딩 실패</p>
              <p className="mt-3 text-lg font-bold text-white">{loadError}</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                외부 데이터 일부가 응답하지 않았습니다. 동일 조건으로 다시 조회하거나 다른 주소를 선택해 주세요.
              </p>
              <button
                type="button"
                onClick={handleRetryLoad}
                className="mt-5 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
              >
                다시 조회
              </button>
            </div>
          </div>
        )}
        {previewInput && (
          <PptPreviewModal
            open={previewOpen}
            input={previewInput}
            onClose={() => setPreviewOpen(false)}
            onDownload={handleDownloadWithDesign}
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

"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type { AddressSearchResult } from "@/lib/data-provider";
import type {
  AnalysisConfig,
  LayerVisibility,
  MaintenanceProject,
  Park,
  Poi,
  PoiCategory,
  PoiSourceId,
  ResidentialPoi,
  SourceStatus,
} from "@/lib/types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/types";
import { formatAreaSqm, formatDistanceM, summarizeParks } from "@/lib/park-analysis";
import { formatMaintenanceArea, summarizeMaintenanceProjects } from "@/lib/maintenance-analysis";
import type { AnalysisScores, InsightNarrative, InsightOverlay } from "@/lib/analysis-engine";
import type { AnalysisProjectSummary, ApiKeyStatusResponse } from "@/lib/project-types";
import AddressSearchInput from "./address-search-input";
import UserMenu from "./user-menu";

export interface ApartmentFilter {
  readonly enabled: boolean;
  readonly minYear: number;
}

type SidebarPanel = "setup" | "analysis" | "layers" | "manual";

interface SidebarProps {
  readonly config: AnalysisConfig;
  readonly layers: LayerVisibility;
  readonly pois: readonly Poi[];
  readonly apartmentFilter: ApartmentFilter;
  readonly exporting: boolean;
  readonly loading: boolean;
  readonly hasSearched: boolean;
  readonly loadError?: string | null;
  readonly canExport: boolean;
  readonly exportDisabledReason?: string;
  readonly analysisScores: AnalysisScores;
  readonly insightNarrative: InsightNarrative;
  readonly insightOverlays: readonly InsightOverlay[];
  readonly visibleInsightOverlayIds: readonly string[];
  readonly manualPois: readonly Poi[];
  readonly apiKeyStatus: ApiKeyStatusResponse | null;
  readonly projects: readonly AnalysisProjectSummary[];
  readonly currentProjectId?: number;
  readonly projectSaving: boolean;
  readonly projectMessage: string;
  /** 1단계 데이터 신뢰성: 소스별 수집 상태 — Task 6에서 사이드바 UI로 렌더링 예정, 이번 태스크는 배선만 */
  readonly sourceStatuses: readonly SourceStatus[];
  /** 1단계 데이터 신뢰성: 재시도 진행 중인 소스(없으면 null) — Task 6에서 사용 예정 */
  readonly retryingSource: PoiSourceId | null;
  readonly onToggleLayer: (category: keyof LayerVisibility) => void;
  readonly onToggleInsightOverlay: (id: string) => void;
  readonly onConfigChange: (config: AnalysisConfig) => void;
  readonly onSelectAddress: (result: AddressSearchResult) => void;
  readonly onRetryLoad: () => void;
  /** 1단계 데이터 신뢰성: 소스 단독 재시도 — Task 6에서 사용 예정 */
  readonly onRetrySource: (source: PoiSourceId) => void;
  /** 1단계 데이터 신뢰성: 전체 강제 새로 수집 — Task 6에서 사용 예정 */
  readonly onForceRefresh: () => void;
  readonly onApartmentFilterChange: (filter: ApartmentFilter) => void;
  readonly onAddManualPoi: (category: PoiCategory, name: string, lat: number, lng: number) => void;
  readonly onUpdateManualPoi: (id: string, patch: { name: string; lat: number; lng: number }) => void;
  readonly onRemoveManualPoi: (id: string) => void;
  readonly onSaveProject: () => void;
  readonly onLoadProject: (id: number) => void;
  readonly onDeleteProject: (id: number) => void;
  readonly onExport: () => void;
  readonly onPreview: () => void;
}

const PANEL_TABS: readonly { id: SidebarPanel; label: string; meta: string }[] = [
  { id: "setup", label: "설정", meta: "주소" },
  { id: "analysis", label: "분석", meta: "점수" },
  { id: "layers", label: "레이어", meta: "표시" },
  { id: "manual", label: "보정", meta: "POI" },
];

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function PanelCard({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cx("rounded-2xl border border-white/10 bg-[#0F172A]/30 p-4 shadow-inner shadow-black/10", className)}>
      {children}
    </section>
  );
}

function SectionHeader({
  title,
  eyebrow,
  aside,
}: {
  readonly title: string;
  readonly eyebrow?: string;
  readonly aside?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/60">{eyebrow}</p>}
        <h2 className="mt-1 text-sm font-bold text-white">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = "text-white",
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly tone?: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.06] p-3 text-center">
      <p className={cx("truncate text-lg font-black leading-none", tone)}>{value}</p>
      <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-white/45">{label}</p>
    </div>
  );
}

export default function Sidebar({
  config,
  layers,
  pois,
  apartmentFilter,
  exporting,
  loading,
  hasSearched,
  loadError,
  canExport,
  exportDisabledReason,
  analysisScores,
  insightNarrative,
  insightOverlays,
  visibleInsightOverlayIds,
  manualPois,
  apiKeyStatus,
  projects,
  currentProjectId,
  projectSaving,
  projectMessage,
  sourceStatuses: _sourceStatuses, // Task 6에서 사이드바 UI로 렌더링 예정 — 이번 태스크는 배선만
  retryingSource: _retryingSource, // Task 6에서 사용 예정
  onToggleLayer,
  onToggleInsightOverlay,
  onConfigChange,
  onSelectAddress,
  onRetryLoad,
  onRetrySource: _onRetrySource, // Task 6에서 사용 예정
  onForceRefresh: _onForceRefresh, // Task 6에서 사용 예정
  onApartmentFilterChange,
  onAddManualPoi,
  onUpdateManualPoi,
  onRemoveManualPoi,
  onSaveProject,
  onLoadProject,
  onDeleteProject,
  onExport,
  onPreview,
}: SidebarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<SidebarPanel>("setup");
  const [form, setForm] = useState({
    centerName: config.centerName,
    centerLat: config.centerLat.toString(),
    centerLng: config.centerLng.toString(),
    radiusKm: config.radiusKm.toString(),
  });
  const [manualForm, setManualForm] = useState({
    category: "apartment" as PoiCategory,
    name: "",
    lat: config.centerLat.toString(),
    lng: config.centerLng.toString(),
  });

  const idPrefix = useId();
  const panelId = `${idPrefix}-controls-panel`;
  const panelTitleId = `${idPrefix}-panel-title`;
  const centerNameId = `${idPrefix}-center-name`;
  const latitudeId = `${idPrefix}-latitude`;
  const longitudeId = `${idPrefix}-longitude`;
  const radiusInputId = `${idPrefix}-radius`;
  const aptFilterId = `${idPrefix}-apt-filter`;

  useEffect(() => {
    setForm({
      centerName: config.centerName,
      centerLat: config.centerLat.toString(),
      centerLng: config.centerLng.toString(),
      radiusKm: config.radiusKm.toString(),
    });
  }, [config.centerLat, config.centerLng, config.centerName, config.radiusKm]);

  useEffect(() => {
    setManualForm((previous) => ({
      ...previous,
      lat: config.centerLat.toString(),
      lng: config.centerLng.toString(),
    }));
  }, [config.centerLat, config.centerLng]);

  useEffect(() => {
    if (!isMobileOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileOpen]);

  const counts = useMemo<Record<keyof LayerVisibility, number>>(() => ({
    subway: pois.filter((poi) => poi.category === "subway").length,
    school: pois.filter((poi) => poi.category === "school").length,
    park: pois.filter((poi) => poi.category === "park").length,
    mountain: pois.filter((poi) => poi.category === "mountain").length,
    apartment: pois.filter((poi) => poi.category === "apartment").length,
    officetel: pois.filter((poi) => poi.category === "officetel").length,
    residential: pois.filter((poi) => poi.category === "residential").length,
    maintenance: pois.filter((poi) => poi.category === "maintenance").length,
  }), [pois]);

  const allResidential = pois.filter(
    (poi): poi is ResidentialPoi =>
      poi.category === "apartment" || poi.category === "officetel" || poi.category === "residential"
  );
  const totalUnits = allResidential.reduce((sum, r) => sum + r.units, 0);
  const datedCount = allResidential.filter((a) => a.sale_date).length;
  const plannedCount = allResidential.filter((a) => a.status === "planned").length;
  const parks = pois.filter((poi): poi is Park => poi.category === "park");
  const parkSummary = summarizeParks(parks);
  const maintenanceProjects = pois.filter((poi): poi is MaintenanceProject => poi.category === "maintenance");
  const maintenanceSummary = summarizeMaintenanceProjects(maintenanceProjects);
  const totalPoiCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const hasAnalysisContext = hasSearched || loading || Boolean(loadError);
  const hasAnalysisResult = hasAnalysisContext && canExport;
  const scorePercent = hasAnalysisResult ? Math.max(0, Math.min(100, analysisScores.total)) : 0;
  const scoreDisplay = loading ? "..." : hasAnalysisResult ? analysisScores.total.toString() : "-";
  const analysisHeadline = !hasAnalysisContext
    ? "주소를 검색하면 입지 점수와 POI 요약이 이곳에 표시됩니다."
    : loading
      ? "데이터를 불러오는 중입니다."
      : loadError
        ? "데이터 로딩을 다시 시도해 주세요."
        : analysisScores.headline;
  const apiReady = apiKeyStatus?.ready ?? false;

  const focusRingClass =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1E3A8A]";
  const inputClass = `mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/35 ${focusRingClass}`;
  const selectClass = `rounded-xl border border-white/15 bg-[#111827] px-3 py-2.5 text-sm text-white ${focusRingClass}`;
  const panelContentClass = isMobileOpen ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 lg:flex lg:flex-col";
  const exportDisabled = exporting || loading || !canExport;

  function closeMobileSheet() {
    setIsMobileOpen(false);
  }

  function handleApply() {
    const centerLat = Number.parseFloat(form.centerLat);
    const centerLng = Number.parseFloat(form.centerLng);
    const radiusKm = Number.parseFloat(form.radiusKm);

    if (!form.centerName.trim() || Number.isNaN(centerLat) || Number.isNaN(centerLng) || Number.isNaN(radiusKm) || radiusKm <= 0) {
      return;
    }

    onConfigChange({
      centerName: form.centerName.trim(),
      centerLat,
      centerLng,
      radiusKm,
    });

    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      closeMobileSheet();
    }
  }

  function handleSampleRun() {
    const sample = {
      id: "sample-cheongwadae",
      name: "청와대",
      address: "서울특별시 종로구 청와대로 1",
      lat: 37.5866,
      lng: 126.9748,
    };
    onSelectAddress(sample);
    onConfigChange({ centerName: sample.name, centerLat: sample.lat, centerLng: sample.lng, radiusKm: 3 });
  }

  function handleAddManualPoi() {
    const lat = Number.parseFloat(manualForm.lat);
    const lng = Number.parseFloat(manualForm.lng);
    if (!manualForm.name.trim() || Number.isNaN(lat) || Number.isNaN(lng)) {
      return;
    }
    onAddManualPoi(manualForm.category, manualForm.name.trim(), lat, lng);
    setManualForm((previous) => ({ ...previous, name: "" }));
  }

  const renderSetupPanel = () => (
    <div className="space-y-5">
      <PanelCard>
        <SectionHeader title="분석 대상" eyebrow="Location" aside={<UserMenu />} />
        <div className="space-y-4">
          <div>
            <label htmlFor={centerNameId} className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/65">
              분석 중심 주소
            </label>
            <AddressSearchInput
              id={centerNameId}
              value={form.centerName}
              loading={loading}
              inputClassName={inputClass}
              onChange={(value) => setForm((previous) => ({ ...previous, centerName: value }))}
              onSelect={(result) => {
                setForm((previous) => ({
                  ...previous,
                  centerName: result.name,
                  centerLat: result.lat.toString(),
                  centerLng: result.lng.toString(),
                }));
                onSelectAddress(result);
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={latitudeId} className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/65">
                위도
              </label>
              <input
                id={latitudeId}
                type="number"
                step="0.0001"
                value={form.centerLat}
                onChange={(event) => setForm((previous) => ({ ...previous, centerLat: event.target.value }))}
                aria-label="분석 중심 위도 입력"
                data-testid="center-latitude-input"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={longitudeId} className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/65">
                경도
              </label>
              <input
                id={longitudeId}
                type="number"
                step="0.0001"
                value={form.centerLng}
                onChange={(event) => setForm((previous) => ({ ...previous, centerLng: event.target.value }))}
                aria-label="분석 중심 경도 입력"
                data-testid="center-longitude-input"
                className={inputClass}
              />
            </div>
          </div>

          <fieldset>
            <legend className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/65">
              분석 반경
            </legend>
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="분석 반경 선택">
              {[1, 2, 3].map((radius) => {
                const selected = config.radiusKm === radius;
                return (
                  <button
                    key={radius}
                    type="button"
                    onClick={() => {
                      setForm((previous) => ({ ...previous, radiusKm: radius.toString() }));
                      onConfigChange({ ...config, radiusKm: radius });
                    }}
                    aria-pressed={selected}
                    aria-label={`${radius}km 반경 선택`}
                    data-testid={`radius-option-${radius}`}
                    className={cx(
                      `rounded-xl border px-3 py-2 text-xs font-semibold transition ${focusRingClass}`,
                      selected
                        ? "border-[#60A5FA] bg-[#3B82F6] text-white shadow-lg shadow-blue-950/40"
                        : "border-white/12 bg-white/5 text-white/75 hover:bg-white/10"
                    )}
                  >
                    {radius}km
                  </button>
                );
              })}
              <input
                id={radiusInputId}
                type="number"
                min="0.5"
                step="0.5"
                value={form.radiusKm}
                onChange={(event) => setForm((previous) => ({ ...previous, radiusKm: event.target.value }))}
                aria-label="사용자 지정 반경 입력"
                data-testid="radius-custom-input"
                className={`text-center ${inputClass}`}
              />
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleApply}
              className={`rounded-xl bg-[#3B82F6] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#2563EB] active:scale-[0.99] ${focusRingClass}`}
              data-testid="config-apply-button"
            >
              분석 실행
            </button>
            <button
              type="button"
              onClick={handleSampleRun}
              className={`rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white/85 transition hover:bg-white/15 ${focusRingClass}`}
            >
              샘플 실행
            </button>
          </div>
        </div>
      </PanelCard>

      <PanelCard>
        <SectionHeader
          title="작업 상태"
          eyebrow="Workspace"
          aside={
            <span className={cx("rounded-full px-2.5 py-1 text-[10px] font-bold", apiReady ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-300/15 text-amber-100")}>
              {apiReady ? "Ready" : "Setup"}
            </span>
          }
        />
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-white/80">API 연결</p>
              <p className="text-[11px] text-white/55">
                {apiKeyStatus ? `${apiKeyStatus.configuredCount}/${apiKeyStatus.totalCount}` : "확인 중"}
              </p>
            </div>
            <div className="space-y-1.5">
              {(apiKeyStatus?.items ?? []).map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate text-white/60">{item.label}</span>
                  <span className={item.configured ? "text-emerald-200" : "text-amber-100"}>
                    {item.configured ? item.masked : "미설정"}
                  </span>
                </div>
              ))}
              {!apiKeyStatus && <p className="text-[11px] text-white/50">연결 상태를 불러오는 중입니다.</p>}
            </div>
            {apiKeyStatus && !apiReady && (
              <Link
                href="/mypage"
                className={`mt-3 flex items-center justify-center rounded-xl bg-amber-300 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-amber-200 ${focusRingClass}`}
              >
                API 키 설정
              </Link>
            )}
          </div>

          <button
            type="button"
            onClick={onSaveProject}
            disabled={projectSaving}
            className={`w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-50 ${focusRingClass}`}
          >
            {projectSaving ? "저장 중..." : currentProjectId ? "현재 프로젝트 저장" : "새 프로젝트 저장"}
          </button>

          {projectMessage && (
            <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/75">
              {projectMessage}
            </p>
          )}

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/65">
              저장된 분석
            </p>
            {projects.length === 0 ? (
              <p className="rounded-xl bg-white/[0.06] px-3 py-2 text-[11px] text-white/55">
                저장된 프로젝트가 없습니다.
              </p>
            ) : (
              projects.slice(0, 5).map((project) => (
                <div key={project.id} className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.06] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onLoadProject(project.id)}
                    className={`min-w-0 flex-1 text-left ${focusRingClass}`}
                  >
                    <p className="truncate text-[11px] font-bold text-white/85">{project.title}</p>
                    <p className="text-[10px] text-white/45">{project.radiusKm}km · 수동 {project.manualPoiCount}개</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteProject(project.id)}
                    className={`rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/55 hover:bg-white/10 hover:text-white ${focusRingClass}`}
                    aria-label={`${project.title} 삭제`}
                  >
                    삭제
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </PanelCard>
    </div>
  );

  const renderAnalysisPanel = () => (
    <div className="space-y-5">
      <PanelCard>
        <SectionHeader
          title="입지 점수"
          eyebrow="Score"
          aside={
            <div className="text-right">
              <p className="text-3xl font-black leading-none text-white">{analysisScores.total}</p>
              <p className="text-[10px] font-bold text-blue-200/70">{analysisScores.grade} 등급</p>
            </div>
          }
        />
        <p className="mb-4 text-sm leading-6 text-white/70">{analysisScores.headline}</p>
        <div className="space-y-3">
          {analysisScores.items.map((item) => (
            <div key={item.key}>
              <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                <span className="font-bold text-white/80">{item.label}</span>
                <span className="font-mono text-white/55">{item.score}/{item.max}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#3B82F6]"
                  style={{ width: `${Math.min(100, Math.max(0, (item.score / Math.max(1, item.max)) * 100))}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] leading-4 text-white/50">{item.detail}</p>
            </div>
          ))}
        </div>
      </PanelCard>

      <PanelCard>
        <SectionHeader title="핵심 판단" eyebrow="Insight" />
        <p className="text-sm leading-6 text-white/75">{insightNarrative.summary}</p>
        <div className="mt-4 grid gap-3">
          {insightNarrative.bullets.slice(0, 3).map((bullet) => (
            <p key={bullet} className="rounded-xl bg-white/[0.06] px-3 py-2 text-[12px] leading-5 text-white/70">
              {bullet}
            </p>
          ))}
        </div>
      </PanelCard>

      <PanelCard>
        <SectionHeader title="공원 접근성" eyebrow="Park" />
        <div className="grid grid-cols-2 gap-2">
          <MetricTile label="공원" value={parkSummary.count} tone="text-[#10B981]" />
          <MetricTile label="총 면적" value={formatAreaSqm(parkSummary.totalAreaSqm)} tone="text-[#10B981]" />
          <MetricTile label="500m 내" value={parkSummary.nearby500Count} tone="text-[#10B981]" />
          <MetricTile label="접근성" value={parkSummary.accessibilityScore} tone="text-[#10B981]" />
        </div>
        <div className="mt-3 space-y-1 text-[11px] leading-5 text-white/60">
          <p>
            최근접: {parkSummary.nearestPark
              ? `${parkSummary.nearestPark.name} (${formatDistanceM(parkSummary.nearestPark.access_distance_m ?? parkSummary.nearestPark.distance_m ?? 0)})`
              : "미확인"}
          </p>
          <p>
            최대: {parkSummary.largestPark
              ? `${parkSummary.largestPark.name} (${formatAreaSqm(parkSummary.largestPark.area_sqm)})`
              : "미확인"}
          </p>
          <p>대형공원 {parkSummary.majorCount}개 / 어린이공원 {parkSummary.qualityCounts.children}개</p>
        </div>
      </PanelCard>

      <PanelCard>
        <SectionHeader title="개발/정비사업" eyebrow="Pipeline" />
        <div className="grid grid-cols-3 gap-2">
          <MetricTile label="사업" value={maintenanceSummary.count} tone="text-[#EC4899]" />
          <MetricTile label="총 면적" value={formatMaintenanceArea(maintenanceSummary.totalAreaSqm)} tone="text-[#EC4899]" />
          <MetricTile label="경계확인" value={maintenanceSummary.boundaryConfirmedCount} tone="text-[#EC4899]" />
        </div>
        <div className="mt-3 space-y-1 text-[11px] leading-5 text-white/60">
          {maintenanceSummary.topProjects.length > 0 ? (
            maintenanceSummary.topProjects.slice(0, 3).map((project) => (
              <p key={project.id} className="truncate">
                {project.name} · {project.stage} · {project.boundary_status === "confirmed" ? "경계확인" : "경계미확인"}
              </p>
            ))
          ) : (
            <p>반경 내 정비사업 미확인</p>
          )}
        </div>
      </PanelCard>

      <PanelCard>
        <SectionHeader title="주거시설" eyebrow="Residential" />
        <div className="grid grid-cols-4 gap-2">
          <MetricTile label="단지" value={allResidential.length} tone="text-[#EF4444]" />
          <MetricTile label="총 세대" value={totalUnits > 0 ? `${Math.round(totalUnits / 100) / 10}k` : "-"} tone="text-[#EF4444]" />
          <MetricTile label="입주일" value={datedCount} />
          <MetricTile label="예정" value={plannedCount} tone="text-blue-200" />
        </div>
      </PanelCard>
    </div>
  );

  const renderLayersPanel = () => (
    <div className="space-y-5">
      <PanelCard>
        <SectionHeader title="인사이트 레이어" eyebrow="Overlay" />
        <div className="space-y-2">
          {insightOverlays.map((overlay) => {
            const selected = visibleInsightOverlayIds.includes(overlay.id);
            return (
              <button
                key={overlay.id}
                type="button"
                onClick={() => onToggleInsightOverlay(overlay.id)}
                aria-pressed={selected}
                className={cx(
                  `flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition ${focusRingClass}`,
                  selected ? "border-white/12 bg-white/10 text-white" : "border-white/8 bg-white/[0.04] text-white/70 hover:bg-white/10"
                )}
              >
                <span
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-full border"
                  style={{
                    borderColor: overlay.color,
                    backgroundColor: selected ? overlay.color : "transparent",
                  }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{overlay.label}</span>
                  <span className="mt-1 block text-[11px] leading-4 text-white/50">{overlay.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </PanelCard>

      <PanelCard>
        <SectionHeader title="데이터 레이어" eyebrow="POI" />
        <div className="space-y-2">
          {(Object.keys(CATEGORY_LABELS) as Array<keyof LayerVisibility>).map((key) => (
            <div key={key}>
              <button
                type="button"
                onClick={() => onToggleLayer(key)}
                role="switch"
                aria-checked={layers[key]}
                aria-label={`${CATEGORY_LABELS[key]} 레이어 ${layers[key] ? "숨기기" : "보이기"}`}
                data-testid={`layer-toggle-${key}`}
                className={cx(
                  `flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${focusRingClass}`,
                  layers[key] ? "border-white/12 bg-white/10 text-white" : "border-white/8 bg-white/[0.04] text-white/70 hover:bg-white/10"
                )}
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                  style={{
                    backgroundColor: layers[key] ? CATEGORY_COLORS[key] : "transparent",
                    border: `1.5px solid ${layers[key] ? CATEGORY_COLORS[key] : "rgba(255,255,255,0.35)"}`,
                  }}
                  aria-hidden="true"
                >
                  {layers[key] && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="flex-1 text-sm font-semibold">{CATEGORY_LABELS[key]}</span>
                <span className="rounded-md bg-black/25 px-1.5 py-0.5 font-mono text-[10px] text-white/55">
                  {counts[key].toString().padStart(2, "0")}
                </span>
              </button>

              {key === "residential" && (layers.apartment || layers.officetel || layers.residential) && (
                <div className="ml-2 mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <input
                    type="checkbox"
                    id={aptFilterId}
                    checked={apartmentFilter.enabled}
                    onChange={(e) => onApartmentFilterChange({ ...apartmentFilter, enabled: e.target.checked })}
                    className="h-3.5 w-3.5 cursor-pointer accent-blue-400"
                  />
                  <label htmlFor={aptFilterId} className="cursor-pointer select-none text-[11px] text-white/75">
                    입주연도 필터
                  </label>
                  <input
                    type="number"
                    min="1990"
                    max="2030"
                    value={apartmentFilter.minYear}
                    disabled={!apartmentFilter.enabled}
                    onChange={(e) =>
                      onApartmentFilterChange({ ...apartmentFilter, minYear: Number(e.target.value) })
                    }
                    aria-label="최소 입주 연도"
                    className={`w-16 rounded-lg border border-white/15 bg-white/10 px-2 py-0.5 text-center text-xs text-white transition ${focusRingClass} disabled:opacity-35`}
                  />
                  <span className="text-[11px] text-white/50">년 이후</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </PanelCard>
    </div>
  );

  const renderManualPanel = () => (
    <PanelCard>
      <SectionHeader title="수동 POI 보정" eyebrow="Manual" />
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={manualForm.category}
            onChange={(event) => setManualForm((previous) => ({ ...previous, category: event.target.value as PoiCategory }))}
            aria-label="수동 POI 카테고리"
            className={selectClass}
          >
            {(Object.keys(CATEGORY_LABELS) as PoiCategory[]).map((category) => (
              <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
            ))}
          </select>
          <input
            type="text"
            value={manualForm.name}
            onChange={(event) => setManualForm((previous) => ({ ...previous, name: event.target.value }))}
            placeholder="POI 이름"
            aria-label="수동 POI 이름"
            className={`rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/35 ${focusRingClass}`}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            step="0.0001"
            value={manualForm.lat}
            onChange={(event) => setManualForm((previous) => ({ ...previous, lat: event.target.value }))}
            aria-label="수동 POI 위도"
            className={`rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white ${focusRingClass}`}
          />
          <input
            type="number"
            step="0.0001"
            value={manualForm.lng}
            onChange={(event) => setManualForm((previous) => ({ ...previous, lng: event.target.value }))}
            aria-label="수동 POI 경도"
            className={`rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white ${focusRingClass}`}
          />
        </div>
        <button
          type="button"
          onClick={handleAddManualPoi}
          className={`w-full rounded-xl bg-[#3B82F6] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#2563EB] ${focusRingClass}`}
        >
          수동 POI 추가
        </button>

        {manualPois.length === 0 ? (
          <p className="rounded-xl border border-white/8 bg-white/[0.05] px-3 py-3 text-[12px] text-white/55">
            추가된 수동 POI가 없습니다.
          </p>
        ) : (
          <div className="space-y-2">
            {manualPois.map((poi) => (
              <div key={poi.id} className="rounded-xl border border-white/8 bg-white/[0.05] p-2">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={poi.name}
                    onChange={(event) => onUpdateManualPoi(poi.id, { name: event.target.value, lat: poi.lat, lng: poi.lng })}
                    aria-label={`${poi.name} 이름 수정`}
                    className={`min-w-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white ${focusRingClass}`}
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveManualPoi(poi.id)}
                    className={`rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/55 hover:bg-white/10 hover:text-white ${focusRingClass}`}
                  >
                    제거
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-white/45">
                  {CATEGORY_LABELS[poi.category]} · {poi.lat.toFixed(4)}, {poi.lng.toFixed(4)}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    step="0.0001"
                    value={poi.lat}
                    onChange={(event) =>
                      onUpdateManualPoi(poi.id, {
                        name: poi.name,
                        lat: Number(event.target.value),
                        lng: poi.lng,
                      })
                    }
                    aria-label={`${poi.name} 위도 수정`}
                    className={`rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white ${focusRingClass}`}
                  />
                  <input
                    type="number"
                    step="0.0001"
                    value={poi.lng}
                    onChange={(event) =>
                      onUpdateManualPoi(poi.id, {
                        name: poi.name,
                        lat: poi.lat,
                        lng: Number(event.target.value),
                      })
                    }
                    aria-label={`${poi.name} 경도 수정`}
                    className={`rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white ${focusRingClass}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PanelCard>
  );

  return (
    <>
      {isMobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[980] bg-[#020617]/60 backdrop-blur-[2px] lg:hidden"
          aria-label="분석 패널 닫기"
          onClick={closeMobileSheet}
        />
      )}

      <aside
        id={panelId}
        aria-labelledby={panelTitleId}
        className={cx(
          "fixed inset-x-0 bottom-0 z-[1000] flex flex-col overflow-hidden rounded-t-[2rem] border border-white/10 bg-[#1E3A8A]/95 shadow-[0_-20px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl transition-[max-height] duration-300 ease-out lg:relative lg:inset-auto lg:z-auto lg:h-full lg:w-[360px] lg:max-h-none lg:rounded-none lg:border-x-0 lg:border-b-0 lg:border-r lg:bg-[#1E3A8A] xl:w-[380px]",
          isMobileOpen ? "max-h-[88dvh]" : "max-h-[4.75rem]"
        )}
      >
        <button
          type="button"
          onClick={() => setIsMobileOpen((open) => !open)}
          aria-expanded={isMobileOpen}
          aria-controls={panelId}
          aria-label={isMobileOpen ? "분석 패널 접기" : "분석 패널 펼치기"}
          className={`flex items-center justify-center px-5 py-2 text-white lg:hidden ${focusRingClass}`}
          data-testid="controls-sheet-toggle"
        >
          <span className="h-1.5 w-16 rounded-full bg-white/25 transition-colors hover:bg-white/40" />
        </button>

        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 pb-3 pt-1 lg:items-start lg:px-6 lg:pb-5 lg:pt-6">
          <div className="min-w-0">
            <h1 id={panelTitleId} className="truncate text-lg font-bold tracking-tight text-white lg:text-xl">
              Site Analysis
            </h1>
            <p className={cx("mt-1 text-xs font-semibold uppercase tracking-[0.3em] text-blue-200/70", isMobileOpen ? "block" : "hidden", "lg:block")}>
              Report Generator
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileOpen((open) => !open)}
            className={`shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/85 transition hover:bg-white/10 hover:text-white lg:hidden ${focusRingClass}`}
            aria-label={isMobileOpen ? "분석 패널 접기" : "분석 패널 펼치기"}
          >
            {isMobileOpen ? "접기" : "열기"}
          </button>
        </div>

        <div className={panelContentClass}>
          <div className="border-b border-white/10 bg-black/10 px-5 py-4 lg:px-6">
            <div className="rounded-2xl border border-white/10 bg-[#0F172A]/35 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/65">현재 분석</p>
                  <p className="mt-1 truncate text-sm font-bold text-white">{config.centerName || "주소 미설정"}</p>
                  <p className="mt-1 text-[11px] text-white/55">
                    {hasAnalysisContext ? `${config.radiusKm}km · POI ${totalPoiCount}개` : "검색 전"}
                  </p>
                </div>
                <div className="h-16 w-16 shrink-0 rounded-full border border-white/15 bg-white/[0.06] p-1">
                  <div
                    className={cx("flex h-full w-full items-center justify-center rounded-full text-base font-black", hasAnalysisResult ? "text-white" : "text-white/55")}
                    style={{
                      background: `conic-gradient(#3B82F6 ${scorePercent}%, rgba(255,255,255,0.12) ${scorePercent}% 100%)`,
                    }}
                  >
                    {scoreDisplay}
                  </div>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-white/65">{analysisHeadline}</p>
            </div>

            {loadError && (
              <div className="mt-3 rounded-2xl border border-red-300/25 bg-red-500/12 p-3">
                <p className="text-xs font-bold text-red-100">데이터 로딩 실패</p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-red-100/75">{loadError}</p>
                <button
                  type="button"
                  onClick={onRetryLoad}
                  className={`mt-2 rounded-lg bg-red-400 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-red-300 ${focusRingClass}`}
                >
                  다시 조회
                </button>
              </div>
            )}

            <div className="mt-4 grid grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-black/20 p-1" role="tablist" aria-label="사이드바 패널">
              {PANEL_TABS.map((tab) => {
                const selected = activePanel === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActivePanel(tab.id)}
                    className={cx(
                      `rounded-xl px-2 py-2 text-center transition ${focusRingClass}`,
                      selected ? "bg-white text-[#1E3A8A] shadow" : "text-white/65 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <span className="block text-xs font-black">{tab.label}</span>
                    <span className="mt-0.5 block text-[9px] font-bold opacity-70">{tab.meta}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5 lg:px-6 lg:py-6">
            {activePanel === "setup" && renderSetupPanel()}
            {activePanel === "analysis" && (hasAnalysisContext ? renderAnalysisPanel() : (
              <PanelCard>
                <SectionHeader title="분석 대기" eyebrow="Score" />
                <p className="text-sm leading-6 text-white/70">
                  설정 탭에서 주소를 검색하거나 샘플 실행을 선택하면 점수, 핵심 판단, 공원/정비/주거 요약이 채워집니다.
                </p>
                <button
                  type="button"
                  onClick={() => setActivePanel("setup")}
                  className={`mt-4 rounded-xl bg-[#3B82F6] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#2563EB] ${focusRingClass}`}
                >
                  설정으로 이동
                </button>
              </PanelCard>
            ))}
            {activePanel === "layers" && renderLayersPanel()}
            {activePanel === "manual" && renderManualPanel()}
          </div>

          <div className="space-y-3 border-t border-white/10 bg-black/10 p-5 lg:p-6">
            {!canExport && exportDisabledReason && (
              <p className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-center text-xs leading-5 text-blue-100/75">
                {exportDisabledReason}
              </p>
            )}
            <button
              type="button"
              onClick={onPreview}
              disabled={exportDisabled}
              title={exportDisabledReason}
              className={cx(
                `flex w-full items-center justify-center gap-2 rounded-2xl border px-6 py-3 text-sm font-semibold transition active:scale-[0.99] ${focusRingClass}`,
                canExport
                  ? "border-white/20 bg-white/10 text-white hover:bg-white/20"
                  : "border-white/10 bg-white/[0.05] text-white/45 disabled:cursor-not-allowed"
              )}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span>PPT 미리보기</span>
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={exportDisabled}
              aria-busy={exporting}
              title={exportDisabledReason}
              data-testid="ppt-export-button"
              className={cx(
                `flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-base font-bold transition active:scale-[0.99] ${focusRingClass}`,
                canExport
                  ? "bg-[#3B82F6] text-white shadow-xl shadow-blue-950/40 hover:bg-[#2563EB]"
                  : "border border-white/10 bg-white/[0.06] text-white/45 disabled:cursor-not-allowed"
              )}
            >
              {exporting ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  <span>PPT 생성 중...</span>
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 15L12 3M12 15L8 11M12 15L16 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 17L2.621 19.485C2.847 20.39 3.654 21 4.588 21H19.412C20.346 21 21.153 20.39 21.379 19.485L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>PPT 보고서 다운로드</span>
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

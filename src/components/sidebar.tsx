"use client";

import { useEffect, useId, useState } from "react";
import type { AddressSearchResult } from "@/lib/data-provider";
import type { AnalysisConfig, Apartment, LayerVisibility, Poi, RegionMetadata } from "@/lib/types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/types";
import AddressSearch from "./address-search";
import AddressSearchInput from "./address-search-input";

interface SidebarProps {
  readonly config: AnalysisConfig;
  readonly layers: LayerVisibility;
  readonly pois: readonly Poi[];
  readonly exporting: boolean;
  readonly loading: boolean;
  readonly regionCode: string;
  readonly availableRegions: readonly RegionMetadata[];
  readonly onToggleLayer: (category: keyof LayerVisibility) => void;
  readonly onConfigChange: (config: AnalysisConfig) => void;
  readonly onRegionSelect: (region: RegionMetadata) => void;
  readonly onSelectAddress: (result: AddressSearchResult) => void;
  readonly onExport: () => void;
}

export default function Sidebar({
  config,
  layers,
  pois,
  exporting,
  loading,
  regionCode,
  availableRegions,
  onToggleLayer,
  onConfigChange,
  onRegionSelect,
  onSelectAddress,
  onExport,
}: SidebarProps) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [form, setForm] = useState({
    centerName: config.centerName,
    centerLat: config.centerLat.toString(),
    centerLng: config.centerLng.toString(),
    radiusKm: config.radiusKm.toString(),
  });

  const idPrefix = useId();
  const panelId = `${idPrefix}-controls-panel`;
  const panelTitleId = `${idPrefix}-panel-title`;
  const centerNameId = `${idPrefix}-center-name`;
  const latitudeId = `${idPrefix}-latitude`;
  const longitudeId = `${idPrefix}-longitude`;
  const radiusInputId = `${idPrefix}-radius`;

  useEffect(() => {
    setForm({
      centerName: config.centerName,
      centerLat: config.centerLat.toString(),
      centerLng: config.centerLng.toString(),
      radiusKm: config.radiusKm.toString(),
    });
  }, [config.centerLat, config.centerLng, config.centerName, config.radiusKm]);

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMobileOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileOpen]);

  const counts = {
    subway: pois.filter((poi) => poi.category === "subway").length,
    school: pois.filter((poi) => poi.category === "school").length,
    park: pois.filter((poi) => poi.category === "park").length,
    mountain: pois.filter((poi) => poi.category === "mountain").length,
    apartment: pois.filter((poi) => poi.category === "apartment").length,
  };

  const apartments = pois.filter((poi): poi is Apartment => poi.category === "apartment");
  const totalUnits = apartments.reduce((sum, apartment) => sum + apartment.units, 0);
  const averagePrice =
    apartments.length > 0
      ? Math.round(apartments.reduce((sum, apartment) => sum + apartment.price_per_pyeong, 0) / apartments.length)
      : 0;

  const focusRingClass =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#93C5FD] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1E3A8A]";
  const inputClass = `mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/35 ${focusRingClass}`;
  const panelContentClass = isMobileOpen ? "flex min-h-0 flex-1 flex-col" : "hidden min-h-0 flex-1 lg:flex lg:flex-col";

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
        className={`fixed inset-x-0 bottom-0 z-[1000] flex flex-col overflow-hidden rounded-t-[2rem] border border-white/10 bg-[#1E3A8A]/95 shadow-[0_-20px_60px_rgba(2,6,23,0.45)] backdrop-blur-xl transition-[max-height] duration-300 ease-out lg:relative lg:inset-auto lg:z-auto lg:h-full lg:w-80 lg:max-h-none lg:rounded-none lg:border-x-0 lg:border-b-0 lg:border-r lg:bg-[#1E3A8A] ${
          isMobileOpen ? "max-h-[85dvh]" : "max-h-[5.75rem]"
        }`}
      >
        <button
          type="button"
          onClick={() => setIsMobileOpen((open) => !open)}
          aria-expanded={isMobileOpen}
          aria-controls={panelId}
          aria-label={isMobileOpen ? "분석 패널 접기" : "분석 패널 펼치기"}
          className={`flex items-center justify-center px-5 pt-3 text-white lg:hidden ${focusRingClass}`}
          data-testid="controls-sheet-toggle"
        >
          <span className="h-1.5 w-16 rounded-full bg-white/25 transition-colors hover:bg-white/40" />
        </button>

        <div className="flex items-start justify-between border-b border-white/10 px-5 pb-5 pt-3 lg:px-6 lg:pb-6 lg:pt-6">
          <div>
            <h1 id={panelTitleId} className="text-xl font-bold tracking-tight text-white">
              Site Analysis
            </h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.3em] text-blue-200/65">
              Report Generator
            </p>
          </div>
          <button
            type="button"
            onClick={closeMobileSheet}
            className={`rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white lg:hidden ${focusRingClass}`}
            aria-label="분석 패널 접기"
          >
            접기
          </button>
        </div>

        <div className={panelContentClass}>
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 lg:px-6 lg:py-6">
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-blue-200/80">
                분석 대상 설정
              </h2>
              <div className="space-y-4">
                <AddressSearch
                  regions={availableRegions}
                  selectedRegionCode={regionCode}
                  loading={loading}
                  inputClassName={inputClass}
                  focusRingClassName={focusRingClass}
                  onSelectRegion={onRegionSelect}
                />

                <div>
                  <label htmlFor={centerNameId} className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/55">
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
                  <p className="mt-2 text-[11px] text-white/55">주소를 선택하면 중심 좌표와 반경 내 POI가 자동으로 갱신됩니다.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={latitudeId} className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/55">
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
                    <label htmlFor={longitudeId} className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/55">
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
                  <legend className="mb-2 block text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/55">
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
                          className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${focusRingClass} ${
                            selected
                              ? "border-[#3B82F6] bg-[#3B82F6] text-white shadow-lg shadow-blue-950/40"
                              : "border-white/12 bg-white/5 text-white/70 hover:bg-white/10"
                          }`}
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

                <button
                  type="button"
                  onClick={handleApply}
                  className={`w-full rounded-xl border border-white/12 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.99] ${focusRingClass}`}
                  data-testid="config-apply-button"
                >
                  설정 업데이트
                </button>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-blue-200/80">
                반경 내 데이터 레이어
              </h2>
              <div className="space-y-2">
                {(Object.keys(CATEGORY_LABELS) as Array<keyof LayerVisibility>).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onToggleLayer(key)}
                    role="switch"
                    aria-checked={layers[key]}
                    aria-label={`${CATEGORY_LABELS[key]} 레이어 ${layers[key] ? "숨기기" : "보이기"}`}
                    data-testid={`layer-toggle-${key}`}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${focusRingClass} ${
                      layers[key]
                        ? "border-white/10 bg-white/10 text-white"
                        : "border-white/6 bg-white/[0.04] text-white/65 hover:bg-white/10"
                    }`}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                      style={{
                        backgroundColor: layers[key] ? CATEGORY_COLORS[key] : "transparent",
                        border: `1.5px solid ${layers[key] ? CATEGORY_COLORS[key] : "rgba(255,255,255,0.3)"}`,
                      }}
                      aria-hidden="true"
                    >
                      {layers[key] && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1 text-sm font-medium">{CATEGORY_LABELS[key]}</span>
                    <span className="rounded-md bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-white/45">
                      {counts[key].toString().padStart(2, "0")}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <h2 className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.24em] text-blue-200/45">
                반경 내 분양 시장 요약
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <p className="text-xl font-black leading-none text-[#EF4444]">{apartments.length}</p>
                  <p className="mt-1 text-[9px] font-bold uppercase text-white/40">단지</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-black leading-none text-[#EF4444]">
                    {Math.round(totalUnits / 100) / 10}k
                  </p>
                  <p className="mt-1 text-[9px] font-bold uppercase text-white/40">총 세대</p>
                </div>
                <div className="col-span-2 border-t border-white/6 pt-2 text-center">
                  <p className="text-lg font-black leading-none text-white">
                    {averagePrice.toLocaleString()} <span className="text-xs font-normal text-white/45">만원/평</span>
                  </p>
                  <p className="mt-1 text-[9px] font-bold uppercase text-white/40">평균 분양가</p>
                </div>
              </div>
            </section>
          </div>

          <div className="border-t border-white/10 bg-black/10 p-5 lg:p-6">
            <button
              type="button"
              onClick={onExport}
              disabled={exporting || loading}
              aria-busy={exporting}
              data-testid="ppt-export-button"
              className={`flex w-full items-center justify-center gap-3 rounded-2xl bg-[#3B82F6] px-6 py-4 text-base font-bold text-white shadow-xl shadow-blue-950/40 transition hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:bg-slate-600 active:scale-[0.99] ${focusRingClass}`}
            >
              {exporting ? (
                <>
                  <div className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
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

"use client";

import { useState } from "react";
import type { AnalysisConfig, LayerVisibility, Poi, Apartment } from "@/lib/types";
import { CATEGORY_COLORS, CATEGORY_LABELS, THEME_COLORS } from "@/lib/types";

interface SidebarProps {
  readonly config: AnalysisConfig;
  readonly layers: LayerVisibility;
  readonly pois: readonly Poi[];
  readonly exporting: boolean;
  readonly onToggleLayer: (category: keyof LayerVisibility) => void;
  readonly onConfigChange: (config: AnalysisConfig) => void;
  readonly onExport: () => void;
}

export default function Sidebar({
  config,
  layers,
  pois,
  exporting,
  onToggleLayer,
  onConfigChange,
  onExport,
}: SidebarProps) {
  const [form, setForm] = useState({
    centerName: config.centerName,
    centerLat: config.centerLat.toString(),
    centerLng: config.centerLng.toString(),
    radiusKm: config.radiusKm.toString(),
  });

  const counts = {
    subway: pois.filter((p) => p.category === "subway").length,
    school: pois.filter((p) => p.category === "school").length,
    park: pois.filter((p) => p.category === "park").length,
    mountain: pois.filter((p) => p.category === "mountain").length,
    apartment: pois.filter((p) => p.category === "apartment").length,
  };

  const apartments = pois.filter((p): p is Apartment => p.category === "apartment");
  const totalUnits = apartments.reduce((s, a) => s + a.units, 0);
  const avgPrice =
    apartments.length > 0
      ? Math.round(apartments.reduce((s, a) => s + a.price_per_pyeong, 0) / apartments.length)
      : 0;

  function handleApply() {
    const lat = parseFloat(form.centerLat);
    const lng = parseFloat(form.centerLng);
    const radius = parseFloat(form.radiusKm);
    if (!form.centerName.trim() || isNaN(lat) || isNaN(lng) || isNaN(radius) || radius <= 0) return;
    onConfigChange({
      centerName: form.centerName.trim(),
      centerLat: lat,
      centerLng: lng,
      radiusKm: radius,
    });
  }

  const inputClass =
    "w-full mt-1 px-3 py-2 bg-white/10 text-white text-sm rounded border border-white/20 focus:border-[#3B82F6] focus:outline-none placeholder-white/30";

  return (
    <aside 
      className="w-80 text-white flex flex-col overflow-y-auto"
      style={{ backgroundColor: THEME_COLORS.sidebarBg }}
    >
      <div className="p-6 border-b border-white/10">
        <h1 className="text-xl font-bold tracking-tight">Site Analysis</h1>
        <p className="text-xs text-blue-200/60 mt-1 uppercase tracking-wider font-semibold">Report Generator</p>
      </div>

      <div className="p-6 space-y-6 flex-1">
        {/* Address Search / Config */}
        <section>
          <h2 className="text-xs font-bold mb-3 text-blue-200/80 uppercase tracking-widest">분석 대상 설정</h2>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-blue-200/50 uppercase">주소 또는 프로젝트명</label>
              <input
                type="text"
                placeholder="ex. 서울시 종로구 세종로 1"
                value={form.centerName}
                onChange={(e) => setForm((prev) => ({ ...prev, centerName: e.target.value }))}
                className={inputClass}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-blue-200/50 uppercase">위도 (Lat)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={form.centerLat}
                  onChange={(e) => setForm((prev) => ({ ...prev, centerLat: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-blue-200/50 uppercase">경도 (Lng)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={form.centerLng}
                  onChange={(e) => setForm((prev) => ({ ...prev, centerLng: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-blue-200/50 uppercase mb-2 block">분석 반경 (Radius)</label>
              <div className="flex gap-2">
                {[1, 2, 3].map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setForm(prev => ({ ...prev, radiusKm: r.toString() }));
                      onConfigChange({ ...config, radiusKm: r });
                    }}
                    className={`flex-1 py-1.5 text-xs rounded transition-all border ${
                      config.radiusKm === r 
                      ? "bg-[#3B82F6] border-[#3B82F6] text-white font-bold shadow-lg shadow-blue-500/20" 
                      : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {r}km
                  </button>
                ))}
                <div className="flex-1 relative">
                  <input
                    type="number"
                    value={form.radiusKm}
                    onChange={(e) => setForm(prev => ({ ...prev, radiusKm: e.target.value }))}
                    className="w-full h-full bg-white/5 border border-white/10 rounded px-2 text-xs text-center focus:outline-none focus:border-[#3B82F6]"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleApply}
              className="w-full py-2.5 px-4 rounded font-bold text-sm bg-white/10 hover:bg-white/20 text-white transition-all border border-white/10 active:scale-[0.98]"
            >
              설정 업데이트
            </button>
          </div>
        </section>

        {/* Layer Controls */}
        <section>
          <h2 className="text-xs font-bold mb-3 text-blue-200/80 uppercase tracking-widest">데이터 레이어</h2>
          <div className="space-y-1">
            {(Object.keys(CATEGORY_LABELS) as Array<keyof LayerVisibility>).map((key) => (
              <label
                key={key}
                className={`flex items-center gap-3 p-2.5 rounded transition-all cursor-pointer ${
                  layers[key] ? "bg-white/10" : "hover:bg-white/5 opacity-60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={() => onToggleLayer(key)}
                  className="sr-only"
                />
                <div 
                  className="w-4 h-4 rounded-sm flex items-center justify-center transition-all"
                  style={{ 
                    backgroundColor: layers[key] ? CATEGORY_COLORS[key] : "transparent",
                    border: `1.5px solid ${layers[key] ? CATEGORY_COLORS[key] : "rgba(255,255,255,0.3)"}` 
                  }}
                >
                  {layers[key] && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <span className={`text-sm flex-1 font-medium ${layers[key] ? "text-white" : "text-white/60"}`}>
                  {CATEGORY_LABELS[key]}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/20 text-white/40 font-mono">
                  {counts[key].toString().padStart(2, '0')}
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* Apt Summary */}
        <section className="bg-black/20 rounded-xl p-4 border border-white/5">
          <h2 className="text-[10px] font-bold mb-3 text-blue-200/40 uppercase tracking-widest text-center">주변 분양 시장 요약</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <p className="text-xl font-black text-[#EF4444] leading-none">{apartments.length}</p>
              <p className="text-[9px] text-white/40 mt-1 uppercase font-bold">단지</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-black text-[#EF4444] leading-none">
                {Math.round(totalUnits / 100) / 10}k
              </p>
              <p className="text-[9px] text-white/40 mt-1 uppercase font-bold">총 세대</p>
            </div>
            <div className="col-span-2 pt-2 border-t border-white/5 text-center">
              <p className="text-lg font-black text-white leading-none">
                {avgPrice.toLocaleString()} <span className="text-xs font-normal text-white/40">만원/평</span>
              </p>
              <p className="text-[9px] text-white/40 mt-1 uppercase font-bold">평균 분양가</p>
            </div>
          </div>
        </section>
      </div>

      <div className="p-6 bg-black/10">
        <button
          onClick={onExport}
          disabled={exporting}
          className="w-full py-4 px-6 rounded-xl font-bold text-base transition-all
            bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-gray-600
            text-white shadow-xl shadow-blue-900/40 
            flex items-center justify-center gap-3 active:scale-[0.98]"
        >
          {exporting ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>PPT 생성 중...</span>
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 15L12 3M12 15L8 11M12 15L16 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17L2.621 19.485C2.847 20.39 3.654 21 4.588 21H19.412C20.346 21 21.153 20.39 21.379 19.485L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>PPT 보고서 다운로드</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

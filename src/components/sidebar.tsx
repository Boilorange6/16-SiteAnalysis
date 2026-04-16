"use client";

import { useState } from "react";
import type { AnalysisConfig, LayerVisibility, Poi, Apartment } from "@/lib/types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/lib/types";

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
    "w-full mt-1 px-2 py-1.5 bg-white/5 text-white text-sm rounded border border-white/10 focus:border-[#E94560] focus:outline-none";

  return (
    <aside className="w-80 bg-[#1A1A2E] text-white flex flex-col overflow-y-auto">
      <div className="p-5 border-b border-white/10">
        <h1 className="text-lg font-bold mb-1">Site Analysis</h1>
        <p className="text-xs text-gray-400">사이트 분석 보고서 생성기</p>
      </div>

      <div className="p-5 border-b border-white/10">
        <h2 className="text-sm font-semibold mb-3 text-gray-300">분석 대상</h2>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-gray-400">중심지명</label>
            <input
              type="text"
              value={form.centerName}
              onChange={(e) => setForm((prev) => ({ ...prev, centerName: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-400">위도</label>
              <input
                type="number"
                step="0.0001"
                value={form.centerLat}
                onChange={(e) => setForm((prev) => ({ ...prev, centerLat: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">경도</label>
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
            <label className="text-xs text-gray-400">반경 (km)</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="20"
              value={form.radiusKm}
              onChange={(e) => setForm((prev) => ({ ...prev, radiusKm: e.target.value }))}
              className={inputClass}
            />
          </div>
          <button
            onClick={handleApply}
            className="w-full py-1.5 px-3 rounded text-sm font-medium bg-white/10 hover:bg-white/15 text-white transition-colors"
          >
            적용
          </button>
        </div>
      </div>

      <div className="p-5 border-b border-white/10">
        <h2 className="text-sm font-semibold mb-3 text-gray-300">레이어 제어</h2>
        <div className="space-y-2">
          {(Object.keys(CATEGORY_LABELS) as Array<keyof LayerVisibility>).map((key) => (
            <label
              key={key}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => onToggleLayer(key)}
                className="sr-only"
              />
              <span
                className="w-4 h-4 rounded flex items-center justify-center text-[10px]"
                style={{
                  backgroundColor: layers[key] ? CATEGORY_COLORS[key] : "transparent",
                  border: `2px solid ${CATEGORY_COLORS[key]}`,
                }}
              >
                {layers[key] ? "\u2713" : ""}
              </span>
              <span className="text-sm flex-1">{CATEGORY_LABELS[key]}</span>
              <span className="text-xs text-gray-400">{counts[key]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="p-5 border-b border-white/10">
        <h2 className="text-sm font-semibold mb-3 text-gray-300">분양 요약</h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#EF4444]">{apartments.length}</p>
            <p className="text-[10px] text-gray-400 mt-1">단지</p>
          </div>
          <div className="bg-white/5 rounded-lg p-3 text-center">
            <p className="text-xl font-bold text-[#EF4444]">
              {totalUnits.toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">총 세대</p>
          </div>
          <div className="col-span-2 bg-white/5 rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-[#EF4444]">
              {avgPrice.toLocaleString()}만원/평
            </p>
            <p className="text-[10px] text-gray-400 mt-1">평균 분양가</p>
          </div>
        </div>
      </div>

      <div className="p-5 mt-auto">
        <button
          onClick={onExport}
          disabled={exporting}
          className="w-full py-3 px-4 rounded-lg font-semibold text-sm transition-all
            bg-gradient-to-r from-[#E94560] to-[#EF4444]
            hover:from-[#d63b54] hover:to-[#dc2626]
            disabled:opacity-50 disabled:cursor-not-allowed
            shadow-lg shadow-[#E94560]/20"
        >
          {exporting ? "PPT 생성 중..." : "PPT 다운로드"}
        </button>
      </div>
    </aside>
  );
}

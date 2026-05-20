"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { PptDesignConfig, PptLegendPosition, PptLineDash } from "@/lib/ppt-design-config";
import { DEFAULT_PPT_DESIGN } from "@/lib/ppt-design-config";
import type { PoiCategory } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import type { SlideRenderInput, RenderedSlide } from "@/lib/ppt-canvas-renderer";

// ── Sub-components ────────────────────────────────────────────────────────────

type MobilePanel = "slides" | "style";
type EditorTab = "theme" | "layout" | "objects" | "text" | "export";

function StyleSlider({
  label, value, min, max, step, unit, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[10px] text-white/60">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 accent-blue-400"
      />
      <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-white/40">
        {value}{unit}
      </span>
    </div>
  );
}

function NumberField({
  label, value, min, max, step, unit, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[10px] text-white/60">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 rounded border border-white/15 bg-white/8 px-2 py-1 text-[11px] text-white outline-none focus:border-blue-300"
      />
      <span className="w-8 shrink-0 text-[10px] text-white/35">{unit}</span>
    </label>
  );
}

function ColorRow({
  label, color, onChange,
}: {
  label: string;
  color: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-5 shrink-0 cursor-pointer rounded border border-white/20 bg-transparent"
      />
      <span className="text-[10px] text-white/70">{label}</span>
    </div>
  );
}

function SelectRow<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[10px] text-white/60">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="min-w-0 flex-1 rounded border border-white/15 bg-[#111827] px-2 py-1 text-[11px] text-white outline-none focus:border-blue-300"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-widest text-blue-200/50">{title}</p>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface PptPreviewModalProps {
  readonly open: boolean;
  readonly input: SlideRenderInput;
  readonly onClose: () => void;
  readonly onDownload: (designConfig: PptDesignConfig) => Promise<void>;
}

export default function PptPreviewModal({ open, input, onClose, onDownload }: PptPreviewModalProps) {
  const [designConfig, setDesignConfig] = useState<PptDesignConfig>(DEFAULT_PPT_DESIGN);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slides, setSlides] = useState<RenderedSlide[]>([]);
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("slides");
  const [editorTab, setEditorTab] = useState<EditorTab>("theme");
  const [zoom, setZoom] = useState(100);
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Initial render when modal opens
  useEffect(() => {
    if (!open) return;
    setCurrentSlide(0);
    setMobilePanel("slides");
    setDesignConfig(DEFAULT_PPT_DESIGN);
    setRendering(true);
    (async () => {
      const { renderAllSlides, preloadBaseImage } = await import("@/lib/ppt-canvas-renderer");
      const img = await preloadBaseImage(input.baseMapImage);
      baseImageRef.current = img;
      const rendered = await renderAllSlides(input, DEFAULT_PPT_DESIGN);
      setSlides(rendered);
      setRendering(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-render on designConfig change
  useEffect(() => {
    if (!open || slides.length === 0) return;

    // Immediately re-render the current slide
    (async () => {
      const { renderSingleSlide } = await import("@/lib/ppt-canvas-renderer");
      const updated = await renderSingleSlide(currentSlide, input, designConfig, baseImageRef.current ?? undefined);
      setSlides(prev => prev.map((s, i) => i === currentSlide ? updated : s));
    })();

    // Debounced full re-render for thumbnails
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const { renderAllSlides } = await import("@/lib/ppt-canvas-renderer");
      const rendered = await renderAllSlides(input, designConfig);
      setSlides(rendered);
    }, 250);

    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designConfig]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setCurrentSlide(prev => Math.max(0, prev - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setCurrentSlide(prev => Math.min(slides.length - 1, prev + 1));
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, slides.length, onClose]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      await onDownload(designConfig);
    } finally {
      setDownloading(false);
    }
  }, [onDownload, designConfig]);

  const updateConfig = useCallback(<K extends keyof PptDesignConfig>(
    key: K, value: PptDesignConfig[K]
  ) => {
    setDesignConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const updateColor = useCallback((category: PoiCategory, hex: string) => {
    setDesignConfig(prev => ({
      ...prev,
      categoryColors: { ...prev.categoryColors, [category]: hex },
    }));
  }, []);

  if (!open) return null;

  const currentDataUrl = slides[currentSlide]?.imageDataUrl;
  const focusCls = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-stretch justify-stretch bg-black/70 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="PPT 미리보기"
    >
      <div className="flex h-dvh w-screen max-w-7xl flex-col overflow-hidden border border-white/10 bg-[#0F172A] shadow-2xl sm:h-[94dvh] sm:w-[98vw] sm:rounded-2xl">

        {/* Header */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">PPT 미리보기</p>
            <p className="text-[10px] text-white/40">도형, 텍스트, 범례, 패널을 편집 가능한 PowerPoint 요소로 내보냅니다</p>
          </div>
          <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <div className="flex gap-1 rounded-full border border-white/15 bg-white/5 p-0.5 lg:hidden" aria-label="모바일 미리보기 패널 선택">
              {([["slides", "슬라이드"], ["style", "스타일"]] as const).map(([panel, label]) => (
                <button
                  key={panel}
                  type="button"
                  onClick={() => setMobilePanel(panel)}
                  aria-pressed={mobilePanel === panel}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${focusCls} ${
                    mobilePanel === panel ? "bg-[#3B82F6] text-white" : "text-white/55 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 ${focusCls}`}
            >
              닫기
            </button>
          </div>
        </div>

        {/* Body: thumbnails | main view | editor */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">

          {/* Left: slide thumbnails */}
          <div className={`${mobilePanel === "slides" ? "flex" : "hidden"} order-2 h-24 w-full shrink-0 flex-row gap-1.5 overflow-x-auto border-t border-white/10 p-2 lg:order-none lg:flex lg:h-auto lg:w-28 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:border-r lg:border-t-0`}>
            {rendering
              ? Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="aspect-video h-full min-w-28 animate-pulse rounded bg-white/10 lg:h-auto lg:min-w-0 lg:w-full" />
                ))
              : slides.map((slide, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentSlide(i)}
                    className={`group relative h-full min-w-28 overflow-hidden rounded border-2 transition lg:h-auto lg:min-w-0 lg:w-full ${focusCls} ${
                      i === currentSlide ? "border-blue-400" : "border-transparent hover:border-white/30"
                    }`}
                    aria-label={`슬라이드 ${i + 1}: ${slide.title}`}
                    aria-pressed={i === currentSlide}
                  >
                    <img
                      src={slide.imageDataUrl}
                      alt={slide.title}
                      className="aspect-video w-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                      <p className="truncate text-[8px] text-white/80">{slide.title}</p>
                    </div>
                  </button>
                ))
            }
          </div>

          {/* Center: main view */}
          <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center bg-black/30 p-3 sm:p-4 lg:order-none">
            {rendering ? (
              <div className="flex flex-col items-center gap-4">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-400 border-t-white" />
                <p className="text-sm text-white/60">슬라이드 렌더링 중...</p>
              </div>
            ) : currentDataUrl ? (
              <img
                src={currentDataUrl}
                alt={slides[currentSlide]?.title}
                className="max-h-full max-w-full rounded object-contain shadow-2xl"
                style={{ aspectRatio: "16/9", transform: `scale(${zoom / 100})`, transformOrigin: "center" }}
              />
            ) : null}
          </div>

          {/* Right: style editor */}
          <div className={`${mobilePanel === "style" ? "flex" : "hidden"} order-3 h-56 w-full shrink-0 flex-col overflow-y-auto border-t border-white/10 bg-black/20 p-4 lg:order-none lg:flex lg:h-auto lg:w-60 lg:border-l lg:border-t-0`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-white/85">PowerPoint 편집</p>
                <p className="text-[9px] text-white/35">모든 값은 미리보기와 PPTX export에 동시 적용</p>
              </div>
              <button
                onClick={() => setDesignConfig(DEFAULT_PPT_DESIGN)}
                className={`rounded border border-white/15 px-2 py-1 text-[10px] text-white/50 hover:bg-white/10 hover:text-white/80 ${focusCls}`}
              >
                초기화
              </button>
            </div>

            <div className="mb-4 grid grid-cols-5 gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              {([
                ["theme", "테마"],
                ["layout", "레이아웃"],
                ["objects", "도형"],
                ["text", "텍스트"],
                ["export", "내보내기"],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setEditorTab(tab)}
                  aria-pressed={editorTab === tab}
                  className={`rounded-lg px-1 py-1.5 text-[9px] font-semibold transition ${focusCls} ${
                    editorTab === tab ? "bg-blue-500 text-white" : "text-white/45 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-5">
              {editorTab === "theme" && (
                <>
                  <EditorSection title="테마 색상">
                    <ColorRow label="기본색" color={designConfig.primaryColor} onChange={(hex) => updateConfig("primaryColor", hex)} />
                    <ColorRow label="오버레이" color={designConfig.overlayColor} onChange={(hex) => updateConfig("overlayColor", hex)} />
                    <ColorRow label="본문" color={designConfig.textColor} onChange={(hex) => updateConfig("textColor", hex)} />
                    <ColorRow label="보조" color={designConfig.mutedTextColor} onChange={(hex) => updateConfig("mutedTextColor", hex)} />
                    <ColorRow label="지도 억제색" color={designConfig.mapOverlayColor} onChange={(hex) => updateConfig("mapOverlayColor", hex)} />
                    <StyleSlider label="지도 억제" value={designConfig.mapOverlayTransparency} min={0} max={100} step={5} unit="%"
                      onChange={(v) => updateConfig("mapOverlayTransparency", v)} />
                  </EditorSection>
                  <EditorSection title="카테고리 색상">
                    {(Object.keys(CATEGORY_LABELS) as PoiCategory[]).map((cat) => (
                      <ColorRow key={cat} label={CATEGORY_LABELS[cat]} color={designConfig.categoryColors[cat]} onChange={(hex) => updateColor(cat, hex)} />
                    ))}
                  </EditorSection>
                </>
              )}

              {editorTab === "layout" && (
                <>
                  <EditorSection title="제목 상자">
                    <NumberField label="X" value={designConfig.titleChipX} min={0} max={10} step={0.1} unit="in" onChange={(v) => updateConfig("titleChipX", v)} />
                    <NumberField label="Y" value={designConfig.titleChipY} min={0} max={5} step={0.1} unit="in" onChange={(v) => updateConfig("titleChipY", v)} />
                    <StyleSlider label="높이" value={designConfig.titleChipHeight} min={0.28} max={0.8} step={0.02} unit="in" onChange={(v) => updateConfig("titleChipHeight", v)} />
                    <StyleSlider label="최대폭" value={designConfig.titleChipMaxWidth} min={2.5} max={8} step={0.1} unit="in" onChange={(v) => updateConfig("titleChipMaxWidth", v)} />
                    <StyleSlider label="둥글기" value={designConfig.titleChipRadius} min={0} max={0.8} step={0.05} unit="" onChange={(v) => updateConfig("titleChipRadius", v)} />
                    <StyleSlider label="투명도" value={designConfig.titleChipTransparency} min={0} max={80} step={5} unit="%" onChange={(v) => updateConfig("titleChipTransparency", v)} />
                  </EditorSection>
                  <EditorSection title="범례">
                    <SelectRow<PptLegendPosition>
                      label="위치"
                      value={designConfig.legendPosition}
                      options={[
                        { value: "bottom-left", label: "왼쪽 아래" },
                        { value: "bottom-right", label: "오른쪽 아래" },
                        { value: "top-left", label: "왼쪽 위" },
                        { value: "top-right", label: "오른쪽 위" },
                      ]}
                      onChange={(v) => updateConfig("legendPosition", v)}
                    />
                    <StyleSlider label="배경" value={designConfig.legendTransparency} min={0} max={90} step={5} unit="%" onChange={(v) => updateConfig("legendTransparency", v)} />
                    <StyleSlider label="테두리" value={designConfig.legendBorderTransparency} min={0} max={100} step={5} unit="%" onChange={(v) => updateConfig("legendBorderTransparency", v)} />
                  </EditorSection>
                  <EditorSection title="데이터 패널">
                    <NumberField label="X" value={designConfig.panelX} min={0} max={9} step={0.1} unit="in" onChange={(v) => updateConfig("panelX", v)} />
                    <NumberField label="Y" value={designConfig.panelY} min={0} max={6} step={0.1} unit="in" onChange={(v) => updateConfig("panelY", v)} />
                    <StyleSlider label="폭" value={designConfig.panelWidth} min={2.4} max={6} step={0.1} unit="in" onChange={(v) => updateConfig("panelWidth", v)} />
                    <StyleSlider label="투명도" value={designConfig.panelTransparency} min={0} max={80} step={5} unit="%" onChange={(v) => updateConfig("panelTransparency", v)} />
                  </EditorSection>
                </>
              )}

              {editorTab === "objects" && (
                <>
                  <EditorSection title="마커">
                    <StyleSlider label="크기" value={designConfig.markerSize} min={0.04} max={0.18} step={0.01} unit="in" onChange={(v) => updateConfig("markerSize", v)} />
                    <StyleSlider label="작은 크기" value={designConfig.markerSizeSm} min={0.03} max={0.12} step={0.01} unit="in" onChange={(v) => updateConfig("markerSizeSm", v)} />
                    <StyleSlider label="투명도" value={designConfig.markerTransparency} min={0} max={80} step={5} unit="%" onChange={(v) => updateConfig("markerTransparency", v)} />
                    <StyleSlider label="테두리" value={designConfig.markerBorderWidth} min={0} max={3} step={0.25} unit="pt" onChange={(v) => updateConfig("markerBorderWidth", v)} />
                    <ColorRow label="테두리색" color={designConfig.markerBorderColor} onChange={(hex) => updateConfig("markerBorderColor", hex)} />
                  </EditorSection>
                  <EditorSection title="반경 링">
                    <SelectRow<PptLineDash>
                      label="선 모양"
                      value={designConfig.ringDash}
                      options={[
                        { value: "solid", label: "실선" },
                        { value: "dash", label: "파선" },
                        { value: "dot", label: "점선" },
                      ]}
                      onChange={(v) => updateConfig("ringDash", v)}
                    />
                    <StyleSlider label="선 두께" value={designConfig.ringLineWidth} min={0.5} max={4} step={0.1} unit="pt" onChange={(v) => updateConfig("ringLineWidth", v)} />
                    <StyleSlider label="외곽선" value={designConfig.ringOuterLineWidth} min={0.5} max={5} step={0.1} unit="pt" onChange={(v) => updateConfig("ringOuterLineWidth", v)} />
                    <StyleSlider label="투명도" value={designConfig.ringTransparency} min={0} max={90} step={5} unit="%" onChange={(v) => updateConfig("ringTransparency", v)} />
                  </EditorSection>
                  <EditorSection title="지하철/콜아웃">
                    <StyleSlider label="노선선" value={designConfig.subwayLineWidth} min={1} max={7} step={0.5} unit="pt" onChange={(v) => updateConfig("subwayLineWidth", v)} />
                    <StyleSlider label="역사 길이" value={designConfig.stationBarHalfLengthM} min={60} max={320} step={10} unit="m" onChange={(v) => updateConfig("stationBarHalfLengthM", v)} />
                    <StyleSlider label="역사 두께" value={designConfig.stationBarWidth} min={3} max={14} step={0.5} unit="pt" onChange={(v) => updateConfig("stationBarWidth", v)} />
                    <StyleSlider label="연결선" value={designConfig.leaderLineWidth} min={0.25} max={2.5} step={0.25} unit="pt" onChange={(v) => updateConfig("leaderLineWidth", v)} />
                    <StyleSlider label="카드폭" value={designConfig.calloutWidth} min={1.8} max={3.5} step={0.1} unit="in" onChange={(v) => updateConfig("calloutWidth", v)} />
                  </EditorSection>
                </>
              )}

              {editorTab === "text" && (
                <>
                  <EditorSection title="표지">
                    <StyleSlider label="제목" value={designConfig.coverTitleFontSize} min={28} max={64} step={1} unit="pt" onChange={(v) => updateConfig("coverTitleFontSize", v)} />
                    <StyleSlider label="부제" value={designConfig.coverSubtitleFontSize} min={14} max={36} step={1} unit="pt" onChange={(v) => updateConfig("coverSubtitleFontSize", v)} />
                    <StyleSlider label="날짜" value={designConfig.coverMetaFontSize} min={10} max={24} step={1} unit="pt" onChange={(v) => updateConfig("coverMetaFontSize", v)} />
                  </EditorSection>
                  <EditorSection title="슬라이드 텍스트">
                    <StyleSlider label="제목" value={designConfig.titleFontSize} min={10} max={26} step={1} unit="pt" onChange={(v) => updateConfig("titleFontSize", v)} />
                    <StyleSlider label="부제" value={designConfig.subtitleFontSize} min={7} max={16} step={0.5} unit="pt" onChange={(v) => updateConfig("subtitleFontSize", v)} />
                    <StyleSlider label="레이블" value={designConfig.labelFontSize} min={7} max={16} step={0.5} unit="pt" onChange={(v) => updateConfig("labelFontSize", v)} />
                    <StyleSlider label="범례" value={designConfig.legendFontSize} min={6} max={14} step={0.5} unit="pt" onChange={(v) => updateConfig("legendFontSize", v)} />
                    <StyleSlider label="상세" value={designConfig.detailFontSize} min={8} max={18} step={0.5} unit="pt" onChange={(v) => updateConfig("detailFontSize", v)} />
                    <StyleSlider label="요약" value={designConfig.summaryFontSize} min={10} max={22} step={0.5} unit="pt" onChange={(v) => updateConfig("summaryFontSize", v)} />
                  </EditorSection>
                  <EditorSection title="주거시설 카드">
                    <StyleSlider label="단지명" value={designConfig.calloutFontSize} min={7} max={16} step={0.5} unit="pt" onChange={(v) => updateConfig("calloutFontSize", v)} />
                    <StyleSlider label="정보" value={designConfig.calloutDetailFontSize} min={6} max={12} step={0.5} unit="pt" onChange={(v) => updateConfig("calloutDetailFontSize", v)} />
                    <StyleSlider label="역명" value={designConfig.stationLabelFontSize} min={6} max={16} step={0.5} unit="pt" onChange={(v) => updateConfig("stationLabelFontSize", v)} />
                  </EditorSection>
                </>
              )}

              {editorTab === "export" && (
                <>
                  <EditorSection title="편집 가능한 PPTX">
                    <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-[11px] leading-5 text-emerald-50/80">
                      지도 이미지는 배경 이미지로, 마커/링/노선/범례/텍스트/패널은 PowerPoint에서 선택 가능한 도형과 텍스트 상자로 내보냅니다.
                    </div>
                  </EditorSection>
                  <EditorSection title="미리보기 확대">
                    <StyleSlider label="줌" value={zoom} min={60} max={160} step={10} unit="%" onChange={setZoom} />
                  </EditorSection>
                  <EditorSection title="투명도 세부">
                    <StyleSlider label="표지 지도 억제" value={designConfig.coverOverlayTransparency} min={0} max={90} step={5} unit="%" onChange={(v) => updateConfig("coverOverlayTransparency", v)} />
                    <StyleSlider label="레이블 배경" value={designConfig.labelBgTransparency} min={0} max={90} step={5} unit="%" onChange={(v) => updateConfig("labelBgTransparency", v)} />
                    <StyleSlider label="콜아웃 배경" value={designConfig.calloutTransparency} min={0} max={90} step={5} unit="%" onChange={(v) => updateConfig("calloutTransparency", v)} />
                    <StyleSlider label="연결선" value={designConfig.leaderLineTransparency} min={0} max={90} step={5} unit="%" onChange={(v) => updateConfig("leaderLineTransparency", v)} />
                  </EditorSection>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer: navigation + download */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
              disabled={currentSlide === 0}
              className={`rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-30 ${focusCls}`}
            >
              ← 이전
            </button>
            <span className="min-w-12 text-center text-xs text-white/50">
              {slides.length > 0 ? `${currentSlide + 1} / ${slides.length}` : "—"}
            </span>
            <button
              onClick={() => setCurrentSlide(prev => Math.min(slides.length - 1, prev + 1))}
              disabled={currentSlide >= slides.length - 1}
              className={`rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-30 ${focusCls}`}
            >
              다음 →
            </button>
          </div>

          <button
            onClick={handleDownload}
            disabled={downloading || rendering}
            className={`flex w-full items-center justify-center gap-2 rounded-xl bg-[#3B82F6] px-5 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-[#2563EB] disabled:cursor-not-allowed disabled:bg-slate-600 sm:w-auto ${focusCls}`}
          >
            {downloading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span>PPT 생성 중...</span>
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 15L12 3M12 15L8 11M12 15L16 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 17L2.621 19.485C2.847 20.39 3.654 21 4.588 21H19.412C20.346 21 21.153 20.39 21.379 19.485L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>PPT 다운로드</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

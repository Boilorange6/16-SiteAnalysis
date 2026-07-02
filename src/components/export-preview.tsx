"use client";

import { useCallback, useEffect, useState } from "react";
import type { SlideSpec } from "@/lib/slide-spec";
import SlideRenderer from "./slide-renderer";
import { generatePptFromSlides } from "@/lib/ppt-generator";

interface ExportPreviewProps {
  readonly specs: readonly SlideSpec[];
  readonly fileName: string;
  readonly onClose: () => void;
}

export default function ExportPreview({ specs, fileName, onClose }: ExportPreviewProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(specs.map((s) => s.id)));
  const [activeId, setActiveId] = useState(specs[0]?.id);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = specs.find((s) => s.id === activeId) ?? specs[0];
  const selectedSpecs = specs.filter((s) => selected.has(s.id));

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const move = useCallback(
    (dir: 1 | -1) => {
      const idx = specs.findIndex((s) => s.id === activeId);
      const next = specs[idx + dir];
      if (next) setActiveId(next.id);
    },
    [specs, activeId]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, onClose]);

  async function handleDownload() {
    setGenerating(true);
    setError(null);
    try {
      await generatePptFromSlides(selectedSpecs, fileName);
    } catch (err) {
      console.error("PPT generation failed:", err);
      setError("PPT 생성에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0F172A]/95">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <h2 className="text-white text-lg font-bold">PPT 내보내기 미리보기</h2>
          <p className="text-blue-200/50 text-xs mt-0.5">슬라이드를 확인하고 포함할 장을 선택하세요</p>
        </div>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="text-white/60 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10 transition-all text-sm font-medium"
        >
          닫기
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* 썸네일 레일 */}
        <div className="w-56 shrink-0 overflow-y-auto p-4 space-y-3 border-r border-white/10">
          {specs.map((spec, i) => (
            <div key={spec.id} className="relative">
              <button
                data-testid={`thumb-${spec.id}`}
                onClick={() => setActiveId(spec.id)}
                className={`block w-full rounded-lg overflow-hidden border-2 transition-all ${
                  spec.id === active?.id ? "border-[#3B82F6]" : "border-white/10 hover:border-white/30"
                } ${selected.has(spec.id) ? "" : "opacity-40"}`}
              >
                <SlideRenderer spec={spec} width={192} />
              </button>
              <div className="flex items-center gap-2 mt-1.5 px-1">
                <input
                  type="checkbox"
                  data-testid={`thumb-check-${spec.id}`}
                  checked={selected.has(spec.id)}
                  onChange={() => toggle(spec.id)}
                  className="w-3.5 h-3.5 accent-[#3B82F6]"
                />
                <span className="text-[11px] text-white/70 font-medium truncate">
                  {String(i + 1).padStart(2, "0")} {spec.title}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 메인 미리보기 */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 min-w-0">
          {active?.warning && (
            <div className="mb-3 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium">
              ⚠ {active.warning}
            </div>
          )}
          <div data-testid="main-slide" className="rounded-xl overflow-hidden shadow-2xl max-w-full">
            <SlideRenderer spec={active} width={880} />
          </div>
          <div className="flex items-center gap-4 mt-4">
            <button onClick={() => move(-1)} aria-label="이전 슬라이드" className="text-white/50 hover:text-white text-xl px-3 py-1 rounded hover:bg-white/10">←</button>
            <span className="text-white/50 text-sm font-mono">
              {specs.findIndex((s) => s.id === active?.id) + 1} / {specs.length}
            </span>
            <button onClick={() => move(1)} aria-label="다음 슬라이드" className="text-white/50 hover:text-white text-xl px-3 py-1 rounded hover:bg-white/10">→</button>
          </div>
        </div>
      </div>

      {/* 푸터 */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
        <p className="text-xs text-white/40">{error ?? `${selectedSpecs.length}장 선택됨 · 지도만 이미지, 나머지는 PPT에서 편집 가능`}</p>
        <button
          onClick={handleDownload}
          disabled={generating || selectedSpecs.length === 0}
          className="py-3 px-8 rounded-xl font-bold text-sm bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-gray-600 disabled:cursor-not-allowed text-white shadow-xl shadow-blue-900/40 flex items-center gap-2 transition-all active:scale-[0.98]"
        >
          {generating ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              생성 중...
            </>
          ) : (
            `PPT 다운로드 (${selectedSpecs.length}장)`
          )}
        </button>
      </div>
    </div>
  );
}

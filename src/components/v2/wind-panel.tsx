"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DemoPhase } from "@/lib/v2/ui/board-state";
import {
  requestWindFallback,
  runWindUpload,
  WIND_LAYER_HEIGHTS,
  WIND_SEASONS,
  windDirectionFromView,
  windDirectionLabel,
  windRasterName,
  type WindSeason,
  type WindUploadProgress,
} from "@/lib/v2/ui/wind-upload";
import { webgpuAvailable, type WebGpuAvailability } from "@/lib/v2/sim/lbm3d/gpu";
import type { TileView } from "@/lib/v2/ui/tile-view";

type Props = {
  view: TileView;
  compact?: boolean;
  phase?: DemoPhase | null;
  layerZ?: number;
  onLayerZ?: (layerZ: number) => void;
  onUploaded?: () => void;
};

type RangeChoice = "annual" | "all";
type PanelStatus = "idle" | "running" | "cancelled" | "done" | "fallback" | "error";
type ProgressState = WindUploadProgress & { season: WindSeason; index: number; total: number };

const SURFACE = "rgba(255,255,255,.94)";
const INK = "#172033";
const MUTED = "#536174";
const LINE = "#cbd4df";
const BLUE = "#1559a6";
const DARK = "#1b2638";

function secondsLeft(progress: ProgressState | null): string {
  if (!progress || !progress.step || !progress.steps || !progress.elapsedMs || progress.step <= 0) return "남은 시간 계산 중";
  const remaining = (progress.elapsedMs / progress.step) * Math.max(0, progress.steps - progress.step);
  return remaining < 1000 ? "곧 완료" : `약 ${Math.ceil(remaining / 1000)}초 남음`;
}

function seasonLabel(season: WindSeason): string {
  return { annual: "연간", spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" }[season];
}

function mapOptions(view: TileView): Array<{ name: string; z: number }> {
  const refs = (view.map as (NonNullable<TileView["map"]> & { rasterOptions?: Array<{ name: string }> }) | null)?.rasterOptions ?? view.map?.rasters ?? [];
  return WIND_LAYER_HEIGHTS.flatMap((z) => {
    const name = refs.find((ref) => ref.name === windRasterName(view, z))?.name;
    return name ? [{ name, z }] : [];
  });
}

export default function WindPanel({ view, compact = false, phase = null, layerZ = 6, onLayerZ, onUploaded }: Props) {
  const [availability, setAvailability] = useState<WebGpuAvailability | null>(null);
  const [range, setRange] = useState<RangeChoice>("annual");
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const options = useMemo(() => mapOptions(view), [view]);
  const selectedOption = options.find((option) => option.z === layerZ) ?? options[0] ?? null;
  const activeZ = selectedOption?.z ?? layerZ;
  const analysisId = view.map?.analysisId ?? null;
  const selectedSeason: WindSeason = range === "annual" ? "annual" : "annual";
  const direction = windDirectionFromView(view, selectedSeason);
  const running = status === "running" || phase === "running";
  const waiting = view.status === "pending" || view.status === "running" || phase === "pending" || phase === "running";
  const canUseAnalysis = !!analysisId;
  const canChooseLayer = options.length > 0 && !running;

  useEffect(() => {
    let alive = true;
    void webgpuAvailable().then((next) => {
      if (alive) setAvailability(next);
    }).catch((reason: unknown) => {
      if (alive) setAvailability({ ok: false, reason: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => {
      alive = false;
      controllerRef.current?.abort();
    };
  }, []);

  const runGpu = async () => {
    if (!analysisId || running || !availability?.ok) return;
    const seasons = range === "annual" ? ["annual" as const] : [...WIND_SEASONS];
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("running");
    setError(null);
    try {
      for (let index = 0; index < seasons.length; index += 1) {
        const season = seasons[index]!;
        const result = await runWindUpload({
          view,
          season,
          availability,
          signal: controller.signal,
          onProgress: (next) => setProgress({ ...next, season, index: index + 1, total: seasons.length }),
        });
        setProgress({ phase: "upload", season, index: index + 1, total: seasons.length, step: result.field.steps, steps: result.field.steps, mlups: result.field.mlups, elapsedMs: result.field.elapsedMs });
        onUploaded?.();
      }
      setStatus("done");
    } catch (reason: unknown) {
      if (reason instanceof Error && reason.name === "AbortError") {
        setStatus("cancelled");
      } else {
        setStatus("error");
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      controllerRef.current = null;
    }
  };

  const runFallback = async () => {
    if (!analysisId || running) return;
    setStatus("running");
    setError(null);
    try {
      await requestWindFallback(analysisId, availability?.reason ?? "WebGPU 미지원");
      setStatus("fallback");
      onUploaded?.();
    } catch (reason: unknown) {
      setStatus("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const cancel = () => {
    controllerRef.current?.abort();
    setStatus("cancelled");
  };

  const progressValue = progress?.steps && progress.step ? Math.min(100, Math.round((progress.step / progress.steps) * 100)) : 0;
  const headline = `주풍향 ${windDirectionLabel(direction)} · 4 m 격자 LBM(LES) · 높이 ${activeZ} m`;
  const titleId = `wind-panel-${view.tileId}`;
  const statusText = status === "done"
    ? "업로드 완료 · 결과를 화면에 반영하는 중"
    : status === "fallback"
      ? "2D 대체 계산을 요청했습니다 · 화면이 자동으로 갱신됩니다"
      : status === "cancelled"
        ? "계산을 취소했습니다"
        : status === "error"
          ? "계산 또는 업로드에 실패했습니다"
          : waiting
            ? "계산 대기"
            : view.status === "complete" || view.status === "partial"
              ? "업로드된 바람장"
              : "바람 계산 준비";

  return (
    <section
      data-wind-panel
      aria-labelledby={titleId}
      style={{
        width: "100%",
        maxWidth: compact ? 320 : undefined,
        display: "grid",
        gap: compact ? 7 : 10,
        padding: compact ? "10px 11px" : "13px 14px",
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        background: SURFACE,
        color: INK,
        boxShadow: "0 6px 18px rgba(19,32,51,.12)",
        fontSize: compact ? 11 : 13,
        lineHeight: 1.35,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h4 id={titleId} style={{ margin: 0, fontSize: compact ? 12 : 14, lineHeight: 1.3, fontWeight: 800 }}>{headline}</h4>
        <span data-wind-status style={{ flex: "none", color: status === "error" ? "#8d2618" : MUTED, fontWeight: 700 }}>{statusText}</span>
      </div>

      {!compact && <p style={{ margin: 0, color: MUTED }}>건물 사이 가속·후류 정체를 LIC 유선 질감과 U/U유입 색띠로 표시합니다.</p>}

      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "minmax(0,1fr) auto", gap: 8, alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4, fontWeight: 700 }}>
          <span>계산 범위</span>
          <select
            value={range}
            onChange={(event) => setRange(event.target.value === "all" ? "all" : "annual")}
            disabled={running}
            aria-label="바람 계산 범위"
            style={{ minHeight: 44, border: `1px solid ${LINE}`, borderRadius: 8, padding: "0 9px", background: "#fff", color: INK, font: "inherit" }}
          >
            <option value="annual">연간 1계절</option>
            <option value="all">전체 5계절</option>
          </select>
        </label>
        {!compact && <span style={{ color: MUTED, fontSize: 11 }}>계절별 약 2분 · 백그라운드가 아닌 브라우저 GPU 실행</span>}
      </div>

      <label style={{ display: "grid", gap: 4, fontWeight: 700 }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>높이 슬라이더</span>
          <output data-wind-height>{activeZ} m</output>
        </span>
        <input
          type="range"
          min={0}
          max={WIND_LAYER_HEIGHTS.length - 1}
          step={1}
          value={Math.max(0, WIND_LAYER_HEIGHTS.indexOf(activeZ as (typeof WIND_LAYER_HEIGHTS)[number]))}
          onChange={(event) => onLayerZ?.(WIND_LAYER_HEIGHTS[Number(event.target.value)] ?? activeZ)}
          disabled={!canChooseLayer}
          aria-label="바람장 표시 높이"
          aria-valuetext={`${activeZ} m`}
          style={{ width: "100%", minHeight: 44, accentColor: BLUE, touchAction: "manipulation" }}
        />
        <span style={{ display: "flex", justifyContent: "space-between", color: MUTED, fontSize: 10 }} aria-hidden="true">
          {WIND_LAYER_HEIGHTS.map((height) => <span key={height}>{height}m</span>)}
        </span>
      </label>

      {availability && !availability.ok && (
        <div data-wind-fallback style={{ display: "grid", gap: 6, padding: "8px 9px", borderRadius: 8, background: "#fff4df", color: "#6b3d08", border: "1px solid #e7c78b" }}>
          <b>이 브라우저는 WebGPU를 지원하지 않습니다 — 2D 대체 계산</b>
          <span style={{ fontSize: 11 }}>{availability.reason ?? "어댑터를 찾지 못했습니다"}</span>
        </div>
      )}

      {status === "running" && progress && (
        <div style={{ display: "grid", gap: 5 }}>
          <div role="progressbar" aria-label="바람 계산 진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue} style={{ height: 8, overflow: "hidden", borderRadius: 99, background: "#e4e9f0" }}>
            <div style={{ width: `${progressValue}%`, height: "100%", background: BLUE, transition: "width .2s linear" }} />
          </div>
          <div aria-live="polite" aria-atomic="true" style={{ display: "flex", flexWrap: "wrap", gap: "4px 8px", color: MUTED, fontVariantNumeric: "tabular-nums" }}>
            <span>{seasonLabel(progress.season)} {progress.index}/{progress.total}</span>
            {progress.step !== undefined && progress.steps !== undefined && <span>{progress.step.toLocaleString("ko-KR")}/{progress.steps.toLocaleString("ko-KR")} step</span>}
            {progress.mlups !== undefined && <span>{progress.mlups.toFixed(1)} MLUPS</span>}
            <span>{secondsLeft(progress)}</span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {availability === null && <button type="button" disabled style={{ minHeight: 44, padding: "0 13px", border: 0, borderRadius: 8, background: "#d9e0ea", color: MUTED, fontWeight: 800 }}>GPU 확인 중…</button>}
        {availability?.ok && (
          <button type="button" onClick={() => void runGpu()} disabled={!canUseAnalysis || running} aria-busy={running} style={{ minHeight: 44, padding: "0 13px", border: 0, borderRadius: 8, background: DARK, color: "#fff", fontWeight: 800, cursor: canUseAnalysis && !running ? "pointer" : "not-allowed", opacity: canUseAnalysis && !running ? 1 : 0.55 }}>
            {view.status === "complete" || view.status === "partial" ? "계절 추가 계산(GPU)" : "바람 계산(GPU, 약 2분/계절)"}
          </button>
        )}
        {availability && !availability.ok && (
          <button type="button" onClick={() => void runFallback()} disabled={!canUseAnalysis || running} style={{ minHeight: 44, padding: "0 13px", border: `1px solid ${DARK}`, borderRadius: 8, background: "#fff", color: DARK, fontWeight: 800, cursor: canUseAnalysis && !running ? "pointer" : "not-allowed", opacity: canUseAnalysis && !running ? 1 : 0.55 }}>
            2D 대체 계산 요청
          </button>
        )}
        {running && status === "running" && availability?.ok && (
          <button type="button" onClick={cancel} style={{ minHeight: 44, padding: "0 13px", border: `1px solid ${LINE}`, borderRadius: 8, background: "#fff", color: INK, fontWeight: 800 }}>
            취소
          </button>
        )}
      </div>

      {!canUseAnalysis && <p style={{ margin: 0, color: MUTED, fontSize: 11 }}>실제 분석 결과를 연 뒤 실행할 수 있습니다.</p>}
      {error && <p role="alert" style={{ margin: 0, color: "#8d2618", fontWeight: 700, overflowWrap: "anywhere" }}>{error}</p>}
      <p style={{ margin: 0, color: MUTED, fontSize: 10.5 }}>조기설계 참고용 — 풍동·검증 CFD 아님 · 주풍향 1방향 · 지형·수목 미포함 · 실제 풍속·보행 안전·인허가 판단에 쓰지 않음</p>
    </section>
  );
}

"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { RASTER_STYLES } from "@/lib/v2/ui/map-layers";
import { inflateRaster, paintRaster } from "@/lib/v2/ui/raster-image";
import { detailApiUrl, detailListApiUrl, filterDetailRows, formatDetailCardValue, normalizeDetailPayload, sanitizeDetailText, sortDetailRows, tableColumns, type DetailAt, type DetailCard, type DetailControl, type DetailPayload, type DetailRow } from "@/lib/v2/ui/detail-state";
import MapFigure, { type MapFigurePick } from "./map-figure";
import DetailTable from "./detail-table";

type LoadState = "loading" | "ready" | "error";

export type DetailWindowProps = {
  view: TileView;
  onClose: () => void;
};

const DETAIL_WINDOW_CSS = `
.detail-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 5vh 5vw; background: rgba(21, 24, 31, .46); }
.detail-modal { width: min(1320px, 100%); height: min(90vh, 900px); min-height: 600px; display: grid; grid-template-rows: 64px minmax(0, 1fr); overflow: hidden; border: 1px solid rgba(255,255,255,.82); border-radius: 18px; background: #f7f8f9; color: #16181d; box-shadow: 0 24px 70px rgba(20,24,32,.28); font-family: var(--font-noto-kr, "Noto Sans KR", "Malgun Gothic", sans-serif); font-size: 14px; line-height: 1.45; }
.detail-modal *, .detail-modal *::before, .detail-modal *::after { box-sizing: border-box; }
.detail-modal button, .detail-modal input { font: inherit; color: inherit; }
.detail-modal button, .detail-modal a { -webkit-tap-highlight-color: transparent; }
.detail-modal button { cursor: pointer; }
.detail-modal button:focus-visible, .detail-modal input:focus-visible, .detail-modal a:focus-visible, .detail-modal [tabindex="0"]:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
.detail-header { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 0 18px 0 22px; border-bottom: 1px solid #dfe2e7; background: rgba(255,255,255,.94); }
.detail-header-code { flex: none; color: #657083; font-size: 13px; font-weight: 700; letter-spacing: .02em; }
.detail-header h2 { min-width: 0; margin: 0; overflow: hidden; color: #15171c; font-size: clamp(20px, 2vw, 27px); font-weight: 700; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
.detail-header-meta { min-width: 0; overflow: hidden; color: #676c76; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.detail-header-spacer { flex: 1 1 auto; min-width: 8px; }
.detail-close { flex: none; min-width: 44px; min-height: 44px; border: 1px solid #d5d9e1; border-radius: 10px; background: #fff; font-size: 14px; font-weight: 700; }
.detail-close:hover { background: #f0f2f5; }
.detail-body { display: grid; grid-template-columns: minmax(0, 1.28fr) minmax(430px, .72fr); min-height: 0; }
.detail-map-panel { position: relative; min-width: 0; min-height: 0; padding: 16px; background: #f2f3f4; }
.detail-map-viewport { position: relative; width: 100%; height: 100%; min-height: 320px; overflow: hidden; border: 1px solid #d5dae1; border-radius: 12px; background: #f2f2ef; touch-action: none; }
.detail-map-viewport:fullscreen { border: 0; border-radius: 0; }
.detail-map-canvas { position: absolute; inset: 0; transform-origin: 50% 50%; will-change: transform; }
.detail-map-canvas svg { width: 100%; height: 100%; }
.detail-map-hint { position: absolute; z-index: 4; bottom: 14px; left: 14px; max-width: min(280px, calc(100% - 110px)); padding: 8px 10px; border: 1px solid rgba(214,218,224,.82); border-radius: 8px; background: rgba(255,255,255,.9); color: #454a55; font-size: 12px; line-height: 1.35; pointer-events: none; }
.detail-map-controls { position: absolute; z-index: 5; top: 14px; right: 14px; display: grid; gap: 8px; }
.detail-map-controls button { display: grid; width: 44px; height: 44px; place-items: center; border: 1px solid #d5d9e1; border-radius: 9px; background: rgba(255,255,255,.94); box-shadow: 0 2px 8px rgba(30,36,46,.1); font-size: 22px; line-height: 1; }
.detail-map-controls button:hover { background: #fff; }
.detail-map-status { position: absolute; z-index: 5; right: 14px; bottom: 14px; max-width: calc(100% - 28px); padding: 6px 9px; border-radius: 999px; background: rgba(255,255,255,.94); color: #5b6472; font-size: 11px; }
.detail-panel { min-width: 0; min-height: 0; overflow: auto; padding: 16px; border-left: 1px solid #e0e3e8; background: #f7f8f9; }
.detail-card { flex: none; padding: 17px 18px 15px; border: 1px solid #d8dce3; border-radius: 14px; background: #fff; box-shadow: 0 2px 7px rgba(24,29,39,.04); }
.detail-card-kicker { display: flex; align-items: center; gap: 7px; min-width: 0; margin-bottom: 3px; color: #596474; font-size: 12px; font-weight: 700; }
.detail-card-kicker strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-card h3 { margin: 0; overflow-wrap: anywhere; color: #15171c; font-size: clamp(21px, 2vw, 27px); line-height: 1.18; }
.detail-card-subtitle { margin: 4px 0 12px; color: #677181; font-size: 13px; }
.detail-chip { display: inline-flex; flex: none; align-items: center; border-radius: 999px; padding: 3px 8px; font-size: 11px; font-weight: 700; }
.detail-card-divider { height: 1px; margin: 10px 0 12px; background: #e0e3e8; }
.detail-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin: 0; }
.detail-field { min-width: 0; }
.detail-field dt { margin-bottom: 2px; color: #737c89; font-size: 12px; }
.detail-field dd { margin: 0; overflow-wrap: anywhere; color: #20242c; font-size: 15px; font-variant-numeric: tabular-nums; font-weight: 700; }
.detail-missing { margin: 13px 0 0; padding: 9px 10px; border-left: 3px solid #d99820; background: #fff8e7; color: #634b1b; font-size: 12px; }
.detail-source { margin: 13px 0 0; color: #6c7480; font-size: 11.5px; line-height: 1.4; }
.detail-control-list { display: flex; flex-wrap: wrap; gap: 8px 10px; margin: 12px 0 0; }
.detail-control-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 5px; min-width: 0; }
.detail-control-label { color: #606a78; font-size: 12px; font-weight: 700; }
.detail-control-options { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 3px; border: 1px solid #d7dce3; border-radius: 9px; background: #f2f4f6; }
.detail-control-options button { min-height: 44px; border: 0; border-radius: 6px; padding: 4px 9px; background: transparent; color: #535d6b; font-size: 12px; white-space: nowrap; }
.detail-control-options button[aria-pressed="true"] { background: #16181d; color: #fff; }
.detail-selection-note { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 12px 0 0; padding: 8px 10px; border-radius: 8px; background: #edf4ff; color: #1e4d87; font-size: 12px; }
.detail-selection-note button { flex: none; min-height: 44px; border: 1px solid #b6cce9; border-radius: 6px; background: #fff; color: #1e4d87; font-size: 11px; font-weight: 700; }
.detail-table-card { margin-top: 12px; overflow: hidden; border: 1px solid #d8dce3; border-radius: 14px; background: #fff; }
.detail-table-toolbar { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 12px 12px 10px; }
.detail-table-count { flex: none; color: #1a1d24; font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
.detail-search { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 170px; height: 44px; padding: 0 10px; border: 1px solid #d3d8e0; border-radius: 8px; background: #fff; }
.detail-search span { color: #697381; font-size: 15px; }
.detail-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 13px; }
.detail-csv { display: inline-flex; flex: none; align-items: center; justify-content: center; min-width: 64px; min-height: 44px; border: 1px solid #d3d8e0; border-radius: 8px; background: #fff; color: #222832; font-size: 12px; font-weight: 800; text-decoration: none; }
.detail-csv:hover { background: #f2f4f6; }
.detail-table-root { position: relative; }
.detail-table-desktop { max-height: 49vh; overflow: auto; border-top: 1px solid #e0e3e8; border-bottom: 1px solid #e0e3e8; }
.detail-table { width: 100%; border-collapse: collapse; table-layout: auto; color: #2a2e37; font-size: 12px; font-variant-numeric: tabular-nums; }
.detail-table thead { position: sticky; z-index: 2; top: 0; background: #fff; }
.detail-table th { height: 44px; padding: 0 8px; border-bottom: 1px solid #dfe3e8; color: #596474; font-size: 11px; font-weight: 800; text-align: left; white-space: nowrap; }
.detail-table td { height: 32px; max-width: 220px; padding: 0 8px; overflow: hidden; border-bottom: 1px solid #edf0f3; text-overflow: ellipsis; white-space: nowrap; }
.detail-table .detail-virtual-spacer td { height: 0; padding: 0; border: 0; }
.detail-table .detail-cell-number { text-align: right; }
.detail-sort { display: inline-flex; align-items: center; gap: 3px; min-height: 44px; border: 0; background: transparent; color: inherit; font-size: inherit; font-weight: inherit; white-space: nowrap; }
.detail-sort-icon { color: #7d8794; font-size: 11px; }
.detail-row { cursor: pointer; }
.detail-row:hover { background: #f4f7fb; }
.detail-row-selected { background: #eaf2ff; }
.detail-row:focus-visible { position: relative; z-index: 1; outline: 2px solid #1d4ed8; outline-offset: -2px; }
.detail-table-mobile { display: none; }
.detail-table-empty { margin: 0; padding: 34px 16px; color: #687382; text-align: center; }
.detail-table-footer { padding: 8px 12px 10px; color: #737c89; font-size: 11px; }
.detail-state { display: grid; min-height: 180px; place-items: center; padding: 24px; border: 1px dashed #cbd1da; border-radius: 12px; background: #fff; color: #66707e; text-align: center; }
.detail-state strong { display: block; margin-bottom: 5px; color: #252a33; }
.detail-state button { min-height: 44px; margin-top: 12px; border: 1px solid #bcc4d0; border-radius: 8px; background: #fff; padding: 0 14px; font-size: 12px; font-weight: 700; }
.detail-loading { display: grid; gap: 9px; }
.detail-loading-text { color: #677181; font-size: 12px; }
.detail-skeleton { height: 12px; border-radius: 5px; background: linear-gradient(90deg, #edf0f3 25%, #f7f8f9 50%, #edf0f3 75%); background-size: 200% 100%; animation: detail-shimmer 1.2s ease-in-out infinite; }
.detail-skeleton-wide { width: 82%; height: 25px; }
@keyframes detail-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.detail-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .detail-skeleton { animation: none; } }
@media (max-width: 900px) { .detail-body { grid-template-columns: minmax(0, 1.05fr) minmax(360px, .95fr); } .detail-fields { gap: 8px 12px; } }
@media (max-width: 720px) {
  .detail-backdrop { padding: 0; place-items: stretch; }
  .detail-modal { width: 100%; height: 100dvh; min-height: 0; border: 0; border-radius: 0; grid-template-rows: 58px minmax(0, 1fr); }
  .detail-header { gap: 8px; padding: 0 10px 0 14px; }
  .detail-header h2 { font-size: 19px; }
  .detail-header-meta { display: none; }
  .detail-body { display: grid; grid-template-rows: minmax(250px, 42%) minmax(0, 58%); grid-template-columns: 1fr; }
  .detail-map-panel { padding: 8px 8px 6px; }
  .detail-map-viewport { min-height: 0; border-radius: 10px; }
  .detail-map-hint { top: auto; bottom: 10px; left: 10px; max-width: 190px; padding: 6px 8px; font-size: 11px; }
  .detail-map-controls { top: 10px; right: 10px; gap: 6px; }
  .detail-map-controls button { width: 42px; height: 42px; }
  .detail-panel { padding: 8px; border-top: 1px solid #dfe2e7; border-left: 0; }
  .detail-card { padding: 14px 14px 13px; border-radius: 12px; }
  .detail-card h3 { font-size: 21px; }
  .detail-fields { gap: 8px 12px; }
  .detail-field dd { font-size: 14px; }
  .detail-table-card { border-radius: 12px; }
  .detail-table-toolbar { flex-wrap: wrap; padding: 10px 10px 8px; }
  .detail-table-count { flex: 1 1 auto; }
  .detail-search { order: 3; flex-basis: calc(100% - 72px); }
  .detail-csv { order: 2; min-width: 64px; }
  .detail-table-desktop { display: none; }
  .detail-table-mobile { display: grid; gap: 0; max-height: none; overflow: visible; border-top: 1px solid #e0e3e8; border-bottom: 1px solid #e0e3e8; }
  .detail-mobile-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 76px; padding: 10px 12px; border: 0; border-bottom: 1px solid #edf0f3; background: #fff; text-align: left; }
  .detail-mobile-card:hover { background: #f4f7fb; }
  .detail-mobile-card-selected { background: #eaf2ff; }
  .detail-mobile-card-copy { display: grid; min-width: 0; gap: 2px; }
  .detail-mobile-card-copy strong { overflow: hidden; color: #20242c; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .detail-mobile-card-copy small { overflow: hidden; color: #747d89; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .detail-mobile-card-values { display: flex; flex-wrap: wrap; gap: 3px 12px; color: #454d5a; font-size: 11px; font-variant-numeric: tabular-nums; }
  .detail-mobile-card-values em { color: #7a8491; font-style: normal; }
  .detail-mobile-chevron { flex: none; color: #8791a0; font-size: 24px; line-height: 1; }
  .detail-table-footer { padding-bottom: 14px; }
}
@media (max-width: 380px) { .detail-header h2 { max-width: 145px; } .detail-header-code { font-size: 11px; } .detail-map-hint { max-width: 155px; } }
`;

const DETAIL_REQUEST_TIMEOUT_MS = 30_000;

function controlsToRecord(controls: DetailControl[], requested: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(controls.map((control) => [control.key, control.options.some((option) => option.value === requested[control.key]) ? requested[control.key] : control.default]));
}

function radiusLabel(radiusM: number): string {
  return radiusM >= 1000 ? `${radiusM / 1000}km` : `${radiusM}m`;
}

function useMeasuredMap(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean): { width: number; height: number } {
  const [size, setSize] = useState({ width: 960, height: 620 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const width = Math.max(1, Math.round(element.clientWidth));
      const height = Math.max(1, Math.round(element.clientHeight));
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, ref]);
  return size;
}

function CardView({ card, code, selected, busy }: { card: DetailCard; code: string; selected: boolean; busy: boolean }) {
  return (
    <section className="detail-card" aria-label={`${card.title} ${selected ? "선택 정보" : "요약"}`}>
      <div className="detail-card-kicker">
        <span>{code} · {selected ? "지물 선택" : "선택 없음"}</span>
        {card.chip && <span className="detail-chip" style={{ background: `${card.chip.color}1c`, color: card.chip.color }}>{sanitizeDetailText(card.chip.label)}</span>}
        {busy && <span aria-live="polite">불러오는 중…</span>}
      </div>
      <h3>{sanitizeDetailText(card.title)}</h3>
      {card.subtitle && <p className="detail-card-subtitle">{sanitizeDetailText(card.subtitle)}</p>}
      <div className="detail-card-divider" />
      <dl className="detail-fields">
        {card.fields.map((field) => (
          <div className="detail-field" key={field.label}>
            <dt>{sanitizeDetailText(field.label)}</dt>
            <dd>{formatDetailCardValue(field.value)}</dd>
          </div>
        ))}
      </dl>
      {(card.missing?.length ?? 0) > 0 && <p className="detail-missing">값 없음 · {card.missing!.map((item) => sanitizeDetailText(item)).join(" · ")}</p>}
      <p className="detail-source">출처 · {sanitizeDetailText(card.source)}</p>
    </section>
  );
}

function LoadingCard({ code }: { code: string }) {
  return (
    <section className="detail-card" aria-busy="true" aria-label={`${code} 상세 불러오는 중`}>
      <div className="detail-loading"><span className="detail-loading-text" aria-live="polite">상세 자료를 불러오는 중…</span><div className="detail-skeleton detail-skeleton-wide" /><div className="detail-skeleton" /><div className="detail-skeleton" /><div className="detail-skeleton" /></div>
    </section>
  );
}

export default function DetailWindow({ view, onClose }: DetailWindowProps) {
  const model = view.map ?? view.backdrop;
  const analysisId = view.map?.analysisId ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("analysis") : null);
  const code = view.code;
  const dialogRef = useRef<HTMLElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [mounted, setMounted] = useState(false);
  const mapSize = useMeasuredMap(mapViewportRef, mounted);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<DetailPayload | null>(null);
  const [controls, setControls] = useState<Record<string, string>>({});
  const [card, setCard] = useState<DetailCard | null>(null);
  const [selectedFids, setSelectedFids] = useState<string[]>([]);
  const [path, setPath] = useState<Array<[number, number]>>([]);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressMapClickRef = useRef(false);
  const [rasterHrefs, setRasterHrefs] = useState<Record<string, string>>({});

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousFocusRef.current = previous;
    const page = document.querySelector<HTMLElement>(".page");
    const pageWasInert = page?.hasAttribute("inert") ?? false;
    page?.setAttribute("inert", "");
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const focusables = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button, input, a[href], [tabindex]:not([tabindex='-1'])") ?? []).filter((element) => !element.hasAttribute("disabled"));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (!pageWasInert) page?.removeAttribute("inert");
      document.body.style.overflow = bodyOverflow;
      const opener = previousFocusRef.current;
      if (opener?.isConnected) requestAnimationFrame(() => opener.focus());
    };
  }, [mounted]);

  const loadDetail = useCallback(async (requestedControls: Readonly<Record<string, string>>) => {
    if (!analysisId) {
      setLoadState("error");
      setError("실제 분석 결과에서 열 수 있는 상세 자료가 없습니다.");
      return;
    }
    setLoadState("loading");
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DETAIL_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(detailListApiUrl(analysisId, code, requestedControls), { credentials: "same-origin", signal: controller.signal });
      const body = await response.json().catch(() => ({})) as Partial<DetailPayload> & { error?: string };
      if (!response.ok || !body.card || !Array.isArray(body.rows) || !Array.isArray(body.columns)) throw new Error(body.error ?? "상세 자료를 불러오지 못했습니다.");
      const nextPayload = normalizeDetailPayload(body as DetailPayload, model.features, model.radiusM);
      const nextControls = controlsToRecord(nextPayload.controls ?? [], requestedControls);
      setControls(nextControls);
      setPayload(nextPayload);
      setCard(nextPayload.card);
      setSelectedFids([]);
      setPath([]);
      setSelectionError(null);
      setLoadState("ready");
    } catch (caught) {
      setLoadState("error");
      setError(caught instanceof DOMException && caught.name === "AbortError" ? "상세 자료 계산 시간이 초과되었습니다. 다시 시도해 주세요." : caught instanceof Error ? caught.message : "상세 자료를 불러오지 못했습니다.");
    } finally {
      window.clearTimeout(timeout);
    }
  }, [analysisId, code, model.features, model.radiusM]);

  useEffect(() => {
    if (!mounted) return;
    void loadDetail({});
  }, [loadDetail, mounted]);

  useEffect(() => {
    let alive = true;
    const rasters = model.rasters ?? [];
    setRasterHrefs({});
    if (!analysisId || !model.tileCode || rasters.length === 0) return () => { alive = false; };
    void Promise.all(rasters.map(async (raster) => {
      const style = RASTER_STYLES[raster.palette];
      if (!style) return null;
      try {
        const response = await fetch(`/site/api/v2/analyses/${encodeURIComponent(analysisId)}/tiles/${encodeURIComponent(model.tileCode!)}/rasters/${encodeURIComponent(raster.name)}`, { credentials: "same-origin" });
        if (!response.ok) return null;
        const values = await inflateRaster(raster, await response.arrayBuffer());
        return [raster.name, paintRaster(raster, values, style)] as const;
      } catch {
        return null;
      }
    })).then((items) => {
      if (alive) setRasterHrefs(Object.fromEntries(items.filter((item): item is readonly [string, string] => item !== null)));
    });
    return () => { alive = false; };
  }, [analysisId, model.rasters, model.tileCode]);

  const columns = useMemo(() => payload ? tableColumns(payload) : [], [payload]);
  const visibleRows = useMemo(() => {
    if (!payload) return [];
    const filtered = filterDetailRows(payload.rows, columns, query);
    return sortDetailRows(filtered, sortKey ? columns.find((column) => column.key === sortKey) : undefined, sortDirection);
  }, [columns, payload, query, sortDirection, sortKey]);
  const csvUrl = payload && analysisId ? detailApiUrl(analysisId, code, "/csv", controls) : "#";
  const displayCard = card ?? payload?.card ?? null;
  const radius = radiusLabel(model.radiusM);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const handleControl = (control: DetailControl, value: string) => {
    const next = { ...controls, [control.key]: value };
    setControls(next);
    void loadDetail(next);
  };

  const detailAt = async (lng: number, lat: number, fallbackFids: string[] = []) => {
    if (!analysisId) return;
    setSelectionBusy(true);
    setSelectionError(null);
    setSelectedFids(fallbackFids);
    setPath([]);
    try {
      const base = detailApiUrl(analysisId, code, "/at", controls);
      const separator = base.includes("?") ? "&" : "?";
      const response = await fetch(`${base}${separator}lng=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}`, { credentials: "same-origin" });
      const body = await response.json().catch(() => ({})) as DetailAt & { error?: string };
      if (!response.ok || !body.card) throw new Error(body.error ?? "선택한 지물을 찾을 수 없습니다.");
      setCard(body.card);
      setSelectedFids(body.fids?.length ? body.fids : body.fid ? [body.fid] : fallbackFids);
      setPath(Array.isArray(body.path) ? body.path.filter((point): point is [number, number] => Array.isArray(point) && point.length === 2 && point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) : []);
    } catch (caught) {
      setSelectionError(caught instanceof Error ? caught.message : "선택한 지물을 찾을 수 없습니다.");
    } finally {
      setSelectionBusy(false);
    }
  };

  const selectRow = (row: DetailRow) => void detailAt(row.lng, row.lat, row.fids?.length ? row.fids : [row.fid]);
  const selectFeature = (feature: MapFigurePick) => void detailAt(feature.lng, feature.lat, feature.fid ? [feature.fid] : []);
  const selectMapPoint = (coordinate: { lng: number; lat: number }) => {
    if (suppressMapClickRef.current) {
      suppressMapClickRef.current = false;
      return;
    }
    void detailAt(coordinate.lng, coordinate.lat);
  };

  const resetMap = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const clampPan = (x: number, y: number, nextZoom = zoom) => {
    const maxX = Math.max(0, ((nextZoom - 1) * mapSize.width) / 2 + 72);
    const maxY = Math.max(0, ((nextZoom - 1) * mapSize.height) / 2 + 72);
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextZoom = Math.max(1, Math.min(3, zoom + (event.deltaY < 0 ? 0.15 : -0.15)));
    setZoom(nextZoom);
    setPan((current) => clampPan(current.x, current.y, nextZoom));
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("[data-map-feature]")) return;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    setPan(clampPan(drag.panX + dx, drag.panY + dy));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.moved) suppressMapClickRef.current = true;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) await mapViewportRef.current?.requestFullscreen?.();
    else await document.exitFullscreen?.();
  };

  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === mapViewportRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  if (!mounted) return null;
  const activeLayer = model.basemap ?? "white";
  const mapTransform: CSSProperties = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` };
  const content = (
    <>
      <style>{DETAIL_WINDOW_CSS}</style>
      <div className="detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={dialogRef} className="detail-modal" role="dialog" aria-modal="true" aria-labelledby={`detail-title-${view.tileId}`} tabIndex={-1}>
          <header className="detail-header">
            <span className="detail-header-code">{code}</span>
            <h2 id={`detail-title-${view.tileId}`}>{sanitizeDetailText(view.title)}</h2>
            <span className="detail-header-meta">반경 {radius} · 지도에서 지물을 선택하면 카드가 갱신됩니다</span>
            <span className="detail-header-spacer" />
            <button type="button" className="detail-close" onClick={onClose} aria-label="상세 창 닫기">닫기 ×</button>
          </header>
          <div className="detail-body">
            <section className="detail-map-panel" aria-label={`${view.title} 상세 지도`}>
              <div ref={mapViewportRef} className="detail-map-viewport" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                <div className="detail-map-canvas" style={mapTransform}>
                  <MapFigure
                    model={model}
                    width={mapSize.width}
                    height={mapSize.height}
                    label={`${view.title} 상세 지도`}
                    layer={activeLayer}
                    tileHref={activeLayer === "Satellite" ? (url) => url.includes("/Hybrid/") ? undefined : url : undefined}
                    rasterHref={(raster) => rasterHrefs[raster.name] ?? null}
                    legend
                    selectedFids={selectedFids}
                    path={path}
                    onFeatureClick={selectFeature}
                    onMapClick={selectMapPoint}
                  />
                </div>
                <p className="detail-map-hint">지물을 선택하면 선택 카드와 지도가 함께 갱신됩니다.<br />휠 확대 · 드래그 이동</p>
                <div className="detail-map-controls" aria-label="지도 조작">
                  <button type="button" onClick={() => { const nextZoom = Math.min(3, zoom + .2); setZoom(nextZoom); setPan((current) => clampPan(current.x, current.y, nextZoom)); }} aria-label="지도 확대">＋</button>
                  <button type="button" onClick={() => { const nextZoom = Math.max(1, zoom - .2); setZoom(nextZoom); setPan((current) => clampPan(current.x, current.y, nextZoom)); }} aria-label="지도 축소">−</button>
                  <button type="button" onClick={resetMap} aria-label="지도 전체 보기">⌗</button>
                  <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "전체화면 닫기" : "지도 전체화면"}>{fullscreen ? "↙" : "↗"}</button>
                </div>
                {path.length >= 2 && <span className="detail-map-status" role="status">선택 경로 · 보행망 결과</span>}
              </div>
            </section>

            <aside className="detail-panel" aria-label={`${view.title} 선택 정보와 목록`}>
              {loadState === "loading" && !payload && <LoadingCard code={code} />}
              {loadState === "error" && !payload && (
                <div className="detail-state" role="alert"><div><strong>상세 자료를 불러오지 못했습니다</strong><span>{sanitizeDetailText(error ?? "잠시 후 다시 시도해 주세요.")}</span><br /><button type="button" onClick={() => void loadDetail(controls)}>다시 시도</button></div></div>
              )}
              {displayCard && <CardView card={displayCard} code={code} selected={selectedFids.length > 0 || !!path.length} busy={selectionBusy || loadState === "loading"} />}
              {selectionError && <p className="detail-selection-note" role="alert"><span>{sanitizeDetailText(selectionError)}</span><button type="button" onClick={() => setSelectionError(null)}>닫기</button></p>}
              {selectedFids.length > 0 && <div className="detail-selection-note"><span>지도에서 선택한 지물을 강조했습니다.</span><button type="button" onClick={() => { setSelectedFids([]); setPath([]); setCard(payload?.card ?? null); setSelectionError(null); }}>선택 해제</button></div>}
              {(payload?.controls?.length ?? 0) > 0 && (
                <div className="detail-control-list" aria-label="상세 지표 조절">
                  {payload!.controls.map((control) => (
                    <div className="detail-control-group" key={control.key}>
                      <span className="detail-control-label">{sanitizeDetailText(control.label)}</span>
                      <span className="detail-control-options" role="group" aria-label={control.label}>
                        {control.options.map((option) => <button key={option.value} type="button" aria-pressed={controls[control.key] === option.value} onClick={() => handleControl(control, option.value)}>{sanitizeDetailText(option.label)}</button>)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {payload && (
                <section className="detail-table-card" aria-label={`${view.title} 목록`}>
                  <div className="detail-table-toolbar">
                    <strong className="detail-table-count">{visibleRows.length.toLocaleString("ko-KR")}개{query ? ` / 전체 ${(payload.rowCount ?? payload.rows.length).toLocaleString("ko-KR")}개` : ""}</strong>
                    <label className="detail-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름 · 주소 찾기" aria-label="이름 또는 주소 찾기" /></label>
                    <a className="detail-csv" href={csvUrl} download={payload.exportFileName} aria-label="상세 CSV 다운로드">↓ CSV</a>
                  </div>
                  <DetailTable payload={payload} rows={visibleRows} selectedFids={selectedFids} onSelectRow={selectRow} sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
                  <div className="detail-table-footer">행을 Enter로 선택 · 숫자는 원값 기준 · CSV에는 전체 열과 원값을 담습니다.</div>
                </section>
              )}
            </aside>
          </div>
        </section>
      </div>
    </>
  );
  return createPortal(content, document.body);
}

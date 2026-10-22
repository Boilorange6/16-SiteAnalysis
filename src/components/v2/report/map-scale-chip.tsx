"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { MapFrameState, ReportFormat } from "@/lib/v2/report/report-doc";
import type { MapModel } from "@/lib/v2/ui/map-layers";
import { formatScaleDenominator } from "@/lib/v2/ui/report-scale";
import styles from "./report-mode.module.css";

type ChipPlacement = "above" | "below" | "inside";
type ChipPosition = { left: number; top: number; placement: ChipPlacement };
type PopoverPosition = { left: number; top: number; side: "right" | "left" };

export type MapScaleChipProps = {
  stageRef: RefObject<HTMLElement | null>;
  format: ReportFormat;
  frame: MapFrameState;
  mapModel: MapModel;
  mapCell?: number;
  scale: number;
  mapEditing: boolean;
  settingsOpen: boolean;
  lockAttention: boolean;
  onZoom: (delta: number) => void;
  onFit: () => void;
  onToggleLock: () => void;
  onEnterMapMove: () => void;
  onOpenMapSettings: () => void;
  onDone: () => void;
  /** Static contract tests can render the menu without browser APIs. */
  initialOpen?: boolean;
};

const POPOVER_WIDTH = 232;
const STAGE_GAP = 8;
const VIEWPORT_GAP = 8;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default function MapScaleChip({
  stageRef,
  format,
  frame,
  mapModel,
  mapCell,
  scale,
  mapEditing,
  settingsOpen,
  lockAttention,
  onZoom,
  onFit,
  onToggleLock,
  onEnterMapMove,
  onOpenMapSettings,
  onDone,
  initialOpen = false,
}: MapScaleChipProps) {
  const [popoverOpen, setPopoverOpen] = useState(initialOpen);
  const [popoverMounted, setPopoverMounted] = useState(initialOpen);
  const [chipPosition, setChipPosition] = useState<ChipPosition | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
  const chipLayerRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closePopover = useCallback((restoreFocus = false) => {
    clearCloseTimer();
    setPopoverOpen(false);
    const unmount = () => {
      setPopoverMounted(false);
      setPopoverPosition(null);
      closeTimerRef.current = null;
    };
    if (typeof window === "undefined" || prefersReducedMotion()) unmount();
    else closeTimerRef.current = window.setTimeout(unmount, 120);
    if (restoreFocus && typeof window !== "undefined") {
      window.requestAnimationFrame(() => chipRef.current?.focus());
    }
  }, [clearCloseTimer]);

  useEffect(() => () => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  useEffect(() => {
    if (settingsOpen && (popoverOpen || popoverMounted)) closePopover();
  }, [closePopover, popoverMounted, popoverOpen, settingsOpen]);

  const findMapSurface = useCallback(() => {
    const stage = stageRef.current;
    const canvas = stage?.querySelector<HTMLElement>('[data-slide-canvas][data-map-selected="true"]');
    if (!stage || !canvas) return null;
    if (mapCell !== undefined) {
      return canvas.querySelector<HTMLElement>(`[data-surface-map="true"][data-map-cell-index="${mapCell}"]`);
    }
    return canvas.querySelector<HTMLElement>('[data-surface-map="true"]');
  }, [mapCell, stageRef]);

  const measureChip = useCallback(() => {
    const stage = stageRef.current;
    const mapSurface = findMapSurface();
    const layer = chipLayerRef.current;
    if (!stage || !mapSurface || !layer) {
      setChipPosition(null);
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    const mapRect = mapSurface.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0 || layerRect.width <= 0 || layerRect.height <= 0) {
      setChipPosition(null);
      return;
    }
    const width = layerRect.width;
    const height = layerRect.height;
    const leftAtRight = clamp(mapRect.right - stageRect.left - width, 0, Math.max(0, stageRect.width - width));
    const topSpace = mapRect.top - stageRect.top;
    const bottomSpace = stageRect.bottom - mapRect.bottom;
    const position: ChipPosition = topSpace >= height + STAGE_GAP
      ? { left: leftAtRight, top: mapRect.top - stageRect.top - height - STAGE_GAP, placement: "above" }
      : bottomSpace >= height + STAGE_GAP
        ? { left: leftAtRight, top: mapRect.bottom - stageRect.top + STAGE_GAP, placement: "below" }
        : {
            left: clamp(mapRect.right - stageRect.left - width - STAGE_GAP, 0, Math.max(0, stageRect.width - width)),
            top: clamp(mapRect.top - stageRect.top + STAGE_GAP, 0, Math.max(0, stageRect.height - height)),
            placement: "inside",
          };
    setChipPosition(position);
  }, [findMapSurface, stageRef]);

  const measurePopover = useCallback(() => {
    if (!popoverOpen) {
      return;
    }
    const chip = chipRef.current;
    const popover = popoverRef.current;
    if (!chip || !popover || typeof window === "undefined") return;
    const chipRect = chip.getBoundingClientRect();
    const popoverHeight = popover.getBoundingClientRect().height || 280;
    const rightLeft = chipRect.right + VIEWPORT_GAP;
    const fitsRight = rightLeft + POPOVER_WIDTH <= window.innerWidth - VIEWPORT_GAP;
    const side = fitsRight ? "right" : "left";
    const preferredLeft = fitsRight ? rightLeft : chipRect.left - POPOVER_WIDTH - VIEWPORT_GAP;
    const left = clamp(preferredLeft, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, window.innerWidth - POPOVER_WIDTH - VIEWPORT_GAP));
    const preferredTop = chipRect.bottom + VIEWPORT_GAP;
    const top = preferredTop + popoverHeight <= window.innerHeight - VIEWPORT_GAP
      ? preferredTop
      : clamp(chipRect.top - popoverHeight - VIEWPORT_GAP, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, window.innerHeight - popoverHeight - VIEWPORT_GAP));
    setPopoverPosition({ left, top, side });
  }, [popoverOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const measure = () => {
      measureChip();
      measurePopover();
    };
    const frameId = window.requestAnimationFrame(measure);
    const stage = stageRef.current;
    const mapSurface = findMapSurface();
    const layer = chipLayerRef.current;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (stage) observer?.observe(stage);
    if (mapSurface) observer?.observe(mapSurface);
    if (layer) observer?.observe(layer);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [findMapSurface, format, frame, mapModel, mapCell, mapEditing, measureChip, measurePopover, popoverOpen, stageRef]);

  useEffect(() => {
    if (!popoverOpen || !popoverMounted) return;
    const frameId = window.requestAnimationFrame(() => menuItemRefs.current.find((item) => !item?.disabled)?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [popoverMounted, popoverOpen]);

  useEffect(() => {
    if (!popoverOpen || !popoverMounted) return;
    const frameId = window.requestAnimationFrame(measurePopover);
    return () => window.cancelAnimationFrame(frameId);
  }, [chipPosition, measurePopover, popoverMounted, popoverOpen]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (chipRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return;
      closePopover();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closePopover, popoverOpen]);

  const openPopover = () => {
    clearCloseTimer();
    setPopoverPosition(null);
    setPopoverMounted(true);
    setPopoverOpen(true);
  };

  const togglePopover = () => {
    if (popoverOpen) closePopover(true);
    else openPopover();
  };

  const runAndClose = (action: () => void) => {
    closePopover();
    action();
  };

  const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePopover(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const items = menuItemRefs.current;
    const current = items.findIndex((item) => item === document.activeElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    for (let step = 1; step <= items.length; step += 1) {
      const next = (current + direction * step + items.length) % items.length;
      if (!items[next]?.disabled) {
        items[next]?.focus();
        return;
      }
    }
  };

  const chipLabel = `1:${formatScaleDenominator(scale)}${frame.locked ? " · 고정" : ""}`;
  const chipStyle: CSSProperties | undefined = chipPosition ? { left: chipPosition.left, top: chipPosition.top } : undefined;
  const popoverStyle: CSSProperties = {
    left: popoverPosition?.left ?? 0,
    top: popoverPosition?.top ?? 0,
    visibility: popoverPosition ? "visible" : "hidden",
  };
  const popover = popoverMounted ? (
    <div
      ref={popoverRef}
      id="report-map-scale-menu"
      className={`${styles.floatCard} ${styles.mapScalePopover}`}
      data-state={popoverOpen ? "open" : "closing"}
      data-positioned={popoverPosition ? "true" : "false"}
      role="menu"
      aria-label="지도 조작"
      style={popoverStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={moveMenuFocus}
    >
      <div className={styles.mapScaleZoomRow} role="group" aria-label="축척">
        <button ref={(element) => { menuItemRefs.current[0] = element; }} type="button" className={styles.mapScaleZoomButton} role="menuitem" aria-label="축척 줄이기" title="축척 줄이기" disabled={frame.locked} onClick={() => onZoom(-0.25)}>−</button>
        <span className={styles.mapScaleCurrent} aria-live="polite">{chipLabel}</span>
        <button ref={(element) => { menuItemRefs.current[1] = element; }} type="button" className={styles.mapScaleZoomButton} role="menuitem" aria-label="축척 키우기" title="축척 키우기" disabled={frame.locked} onClick={() => onZoom(0.25)}>＋</button>
      </div>
      <button ref={(element) => { menuItemRefs.current[2] = element; }} type="button" className={styles.mapScaleMenuButton} role="menuitem" aria-label="대지 맞춤" title="대지 맞춤" disabled={frame.locked} onClick={() => runAndClose(onFit)}>대지 맞춤</button>
      <button ref={(element) => { menuItemRefs.current[3] = element; }} type="button" className={styles.mapScaleMenuButton} role="menuitem" aria-label="지도 위치 고정" title={frame.locked ? "지도 위치 고정 해제" : "지도 위치 고정"} aria-pressed={frame.locked} onClick={() => runAndClose(onToggleLock)}>지도 위치 고정</button>
      <button ref={(element) => { menuItemRefs.current[4] = element; }} type="button" className={styles.mapScaleMenuButton} role="menuitem" aria-label="지도 편집" title="지도 편집" disabled={mapEditing} onClick={() => runAndClose(onEnterMapMove)}><span>지도 편집</span><small>두 번 누르기</small></button>
      <div className={styles.mapScaleDivider} role="separator" />
      <button ref={(element) => { menuItemRefs.current[5] = element; }} type="button" className={styles.mapScaleMenuButton} role="menuitem" aria-label="지도 설정" title="지도 설정" onClick={() => runAndClose(onOpenMapSettings)}>지도 설정…</button>
    </div>
  ) : null;

  return (
    <>
      <div
        ref={chipLayerRef}
        className={styles.mapScaleChipLayer}
        data-positioned={chipPosition ? "true" : "false"}
        data-placement={chipPosition?.placement}
        style={chipStyle}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          ref={chipRef}
          type="button"
          className={styles.mapScaleChip}
          data-map-scale-chip="true"
          data-open={popoverOpen ? "true" : "false"}
          data-attention={lockAttention ? "true" : undefined}
          aria-haspopup="menu"
          aria-expanded={popoverOpen}
          aria-controls={popoverOpen ? "report-map-scale-menu" : undefined}
          aria-label={`지도 축척 ${chipLabel}`}
          title="지도 축척 조작"
          onClick={togglePopover}
        >
          <span>{chipLabel}</span><span aria-hidden="true">▾</span>
        </button>
        {mapEditing && <button type="button" className={styles.mapScaleChipDone} aria-label="지도 편집 끝내기 (Esc)" title="지도 편집 끝내기 (Esc)" onClick={() => runAndClose(onDone)}>완료</button>}
      </div>
      {typeof document === "undefined" ? popover : popover ? createPortal(popover, document.body) : null}
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { applyView, clampView, metersPerPixel, worldPx, type MapView, type Viewport } from "@/lib/v2/ui/map-projection";

export type MapWheelMode = "plain" | "modifier" | "off";
export type MapTouchPan = "one" | "two";

export type MapViewOptions = {
  baseViewport?: Viewport;
  radiusM: number;
  /** 절대 Web Mercator 줌 상한. baseViewport.zoom보다 작으면 기본 뷰만 허용한다. */
  maxZoom: number;
  enabled?: boolean;
  wheel?: MapWheelMode;
  touchPan?: MapTouchPan;
  /** 사이트·반경·분석 결과가 바뀔 때만 기본 시점으로 되돌리는 키. */
  resetKey?: string;
};

export type MapViewBinding = {
  ref: (element: HTMLElement | null) => void;
  tabIndex: 0;
  "aria-label": string;
  style: CSSProperties;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
};

export type MapViewController = {
  view: MapView;
  previewTransform: CSSProperties | undefined;
  dragging: boolean;
  bind: MapViewBinding;
  reset: () => void;
  zoomBy: (delta: number) => void;
  isDefault: boolean;
};

type Pointer = { x: number; y: number; pointerType: string };
type Gesture = {
  startView: MapView;
  startX: number;
  startY: number;
  startDistance: number;
  startMidX: number;
  startMidY: number;
  moved: boolean;
};

const ZERO_VIEW: MapView = { zoomDelta: 0, offsetM: [0, 0] };
const DRAG_THRESHOLD = 4;
const COMMIT_DELAY = 150;

function distance(a: Pointer, b: Pointer): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Pointer, b: Pointer): [number, number] {
  return [(a.x + b.x) / 2, (a.y + b.y) / 2];
}

function sameView(a: MapView, b: MapView): boolean {
  return a.zoomDelta === b.zoomDelta && a.offsetM[0] === b.offsetM[0] && a.offsetM[1] === b.offsetM[1];
}

export function useMapView({ baseViewport, radiusM, maxZoom, enabled = true, wheel = "plain", touchPan = "one", resetKey = "" }: MapViewOptions): MapViewController {
  const [view, setView] = useState<MapView>(ZERO_VIEW);
  const [gestureView, setGestureView] = useState<MapView | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previewOrigin, setPreviewOrigin] = useState<[number, number] | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const viewRef = useRef(view);
  const gestureRef = useRef<Gesture | null>(null);
  const gestureViewRef = useRef<MapView | null>(null);
  const pointersRef = useRef(new Map<number, Pointer>());
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { gestureViewRef.current = gestureView; }, [gestureView]);

  const clamp = useCallback((candidate: MapView): MapView => {
    const baseZoom = baseViewport?.zoom ?? 0;
    // clampView accepts the permitted zoom delta; maxZoomFor intentionally returns
    // an absolute zoom so the conversion belongs at this UI boundary.
    return clampView(candidate, Math.max(0, radiusM), Math.max(0, maxZoom - baseZoom));
  }, [baseViewport?.zoom, maxZoom, radiusM]);

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);

  const commit = useCallback((candidate?: MapView) => {
    clearCommitTimer();
    const next = clamp(candidate ?? gestureViewRef.current ?? viewRef.current);
    setView(next);
    viewRef.current = next;
    gestureViewRef.current = null;
    setGestureView(null);
    setPreviewOrigin(null);
    setDragging(false);
  }, [clearCommitTimer, clamp]);

  const scheduleCommit = useCallback((candidate: MapView) => {
    clearCommitTimer();
    commitTimerRef.current = setTimeout(() => commit(candidate), COMMIT_DELAY);
  }, [clearCommitTimer, commit]);

  useEffect(() => () => clearCommitTimer(), [clearCommitTimer]);

  useEffect(() => {
    clearCommitTimer();
    gestureRef.current = null;
    gestureViewRef.current = null;
    pointersRef.current.clear();
    viewRef.current = ZERO_VIEW;
    setView(ZERO_VIEW);
    setGestureView(null);
    setPreviewOrigin(null);
    setDragging(false);
  }, [clearCommitTimer, resetKey]);

  useEffect(() => {
    const next = clamp(viewRef.current);
    if (!sameView(next, viewRef.current)) {
      viewRef.current = next;
      setView(next);
    }
  }, [clamp]);

  const updateGesture = useCallback((candidate: MapView, origin?: [number, number] | null, moved = true) => {
    const next = clamp(candidate);
    gestureViewRef.current = next;
    setGestureView(next);
    if (origin !== undefined) setPreviewOrigin(origin);
    if (moved) setDragging(true);
    scheduleCommit(next);
  }, [clamp, scheduleCommit]);

  const currentBase = useCallback((): Viewport | null => {
    if (baseViewport) return baseViewport;
    const element = elementRef.current;
    if (!element) return null;
    return {
      center: [0, 0],
      zoom: 0,
      width: element.clientWidth,
      height: element.clientHeight,
    };
  }, [baseViewport]);

  const viewAtZoomPoint = useCallback((delta: number, clientX?: number, clientY?: number): MapView => {
    const base = currentBase();
    const current = gestureViewRef.current ?? viewRef.current;
    if (!base || !elementRef.current || !baseViewport) return clamp({ ...current, zoomDelta: current.zoomDelta + delta });
    const rect = elementRef.current.getBoundingClientRect();
    const px = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const py = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    const maxDelta = Math.max(0, maxZoom - base.zoom);
    const nextZoomDelta = Math.max(0, Math.min(maxDelta, current.zoomDelta + delta));
    const currentViewport = applyView(base, base.center[1], current);
    const nextZoom = base.zoom + nextZoomDelta;
    const [currentWorldX, currentWorldY] = worldPx(currentViewport.center[0], currentViewport.center[1], currentViewport.zoom);
    const nextMpp = metersPerPixel(base.center[1], nextZoom);
    const worldAtPointer = [currentWorldX + px - rect.width / 2, currentWorldY + py - rect.height / 2] as const;
    const nextWorldX = worldAtPointer[0] - px + rect.width / 2;
    const nextWorldY = worldAtPointer[1] - py + rect.height / 2;
    const [baseWorldX, baseWorldY] = worldPx(base.center[0], base.center[1], nextZoom);
    const eastM = (nextWorldX - baseWorldX) * nextMpp;
    const northM = (baseWorldY - nextWorldY) * nextMpp;
    return { zoomDelta: nextZoomDelta, offsetM: [eastM, northM] };
  }, [baseViewport, clamp, currentBase, maxZoom]);

  const zoomAt = useCallback((delta: number, clientX?: number, clientY?: number) => {
    if (!enabled) return;
    const rect = elementRef.current?.getBoundingClientRect();
    const origin: [number, number] = rect
      ? [clientX === undefined ? rect.width / 2 : clientX - rect.left, clientY === undefined ? rect.height / 2 : clientY - rect.top]
      : [0, 0];
    updateGesture(viewAtZoomPoint(delta, clientX, clientY), origin, false);
  }, [enabled, updateGesture, viewAtZoomPoint]);

  const zoomBy = useCallback((delta: number) => zoomAt(delta), [zoomAt]);

  const reset = useCallback(() => {
    if (!enabled) return;
    commit(ZERO_VIEW);
  }, [commit, enabled]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, pointerType: event.pointerType });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* older WebKit */ }
    const pointers = [...pointersRef.current.values()];
    if (pointers.length >= 2 && touchPan === "two") {
      const [a, b] = pointers;
      const [midX, midY] = midpoint(a!, b!);
      gestureRef.current = { startView: gestureViewRef.current ?? viewRef.current, startX: midX, startY: midY, startDistance: Math.max(1, distance(a!, b!)), startMidX: midX, startMidY: midY, moved: false };
      return;
    }
    if (event.pointerType === "touch" && touchPan === "two") return;
    gestureRef.current = { startView: gestureViewRef.current ?? viewRef.current, startX: event.clientX, startY: event.clientY, startDistance: 0, startMidX: event.clientX, startMidY: event.clientY, moved: false };
  }, [enabled, touchPan]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const existing = pointersRef.current.get(event.pointerId);
    if (!existing) return;
    existing.x = event.clientX;
    existing.y = event.clientY;
    const gesture = gestureRef.current;
    if (!gesture) return;
    const pointers = [...pointersRef.current.values()];
    if (pointers.length >= 2 && touchPan === "two") {
      const [a, b] = pointers;
      const [midX, midY] = midpoint(a!, b!);
      const zoomDelta = gesture.startView.zoomDelta + Math.log2(Math.max(1, distance(a!, b!)) / gesture.startDistance);
      const zoom = baseViewport ? baseViewport.zoom + zoomDelta : 0;
      const mpp = baseViewport ? metersPerPixel(baseViewport.center[1], zoom) : 1;
      const next: MapView = { zoomDelta, offsetM: [gesture.startView.offsetM[0] - (midX - gesture.startMidX) * mpp, gesture.startView.offsetM[1] + (midY - gesture.startMidY) * mpp] };
      if (Math.hypot(midX - gesture.startMidX, midY - gesture.startMidY) > DRAG_THRESHOLD || Math.abs(zoomDelta - gesture.startView.zoomDelta) > 0.01) gesture.moved = true;
      updateGesture(next, [midX - (elementRef.current?.getBoundingClientRect().left ?? 0), midY - (elementRef.current?.getBoundingClientRect().top ?? 0)], gesture.moved);
      return;
    }
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    gesture.moved = true;
    const zoom = baseViewport ? baseViewport.zoom + gesture.startView.zoomDelta : 0;
    const mpp = baseViewport ? metersPerPixel(baseViewport.center[1], zoom) : 1;
    updateGesture({ zoomDelta: gesture.startView.zoomDelta, offsetM: [gesture.startView.offsetM[0] - dx * mpp, gesture.startView.offsetM[1] + dy * mpp] }, null, true);
  }, [baseViewport, touchPan, updateGesture]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.moved) suppressClickRef.current = true;
    pointersRef.current.delete(event.pointerId);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch { /* older WebKit */ }
    if (pointersRef.current.size < 2) gestureRef.current = null;
    if (gesture?.moved) commit();
  }, [commit]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!enabled) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(0.5); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomBy(-0.5); }
    else if (event.key === "0") { event.preventDefault(); reset(); }
  }, [enabled, reset, zoomBy]);

  const ref = useCallback((element: HTMLElement | null) => { elementRef.current = element; }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled || wheel === "off") return;
    const onWheel = (event: WheelEvent) => {
      if (wheel === "modifier" && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.35 : -0.35;
      zoomAt(delta, event.clientX, event.clientY);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [enabled, wheel, zoomAt]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const previewTransform = useMemo<CSSProperties | undefined>(() => {
    const active = gestureView;
    if (!active || !baseViewport || sameView(active, view)) return undefined;
    const scale = 2 ** (active.zoomDelta - view.zoomDelta);
    const baseMpp = metersPerPixel(baseViewport.center[1], baseViewport.zoom + view.zoomDelta);
    const dx = -(active.offsetM[0] - view.offsetM[0]) / baseMpp;
    const dy = (active.offsetM[1] - view.offsetM[1]) / baseMpp;
    return {
      transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
      transformOrigin: previewOrigin ? `${previewOrigin[0]}px ${previewOrigin[1]}px` : "50% 50%",
      willChange: "transform",
    };
  }, [baseViewport, gestureView, previewOrigin, view]);

  const bind = useMemo<MapViewBinding>(() => ({
    ref,
    tabIndex: 0,
    "aria-label": "지도",
    style: { touchAction: enabled ? (wheel === "plain" || touchPan === "one" ? "none" : "pan-y") : undefined, outline: "none" },
    onKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onClickCapture,
  }), [enabled, onClickCapture, onKeyDown, onPointerDown, onPointerMove, onPointerUp, ref, touchPan, wheel]);

  return { view, previewTransform, dragging, bind, reset, zoomBy, isDefault: sameView(view, ZERO_VIEW) };
}

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type KeyboardEventHandler,
  type PointerEvent as ReactPointerEvent,
  type PointerEventHandler,
} from "react";

export type TileSize = 1 | 2 | 4;
export type ResizeSide = "left" | "right";

/** 시각 크기와 독립된 조작 영역. 카드 통합 시 이 값을 min-width/min-height에 사용한다. */
export const TILE_RESIZE_HANDLE_MIN_SIZE = 44;

export type SizeFromDragInput = {
  dx: number;
  dy: number;
  side: ResizeSide;
  cellW: number;
  rowH: number;
  start: TileSize;
};

/**
 * 포인터 이동량을 보드의 1·2·4칸 크기로 변환한다.
 *
 * 오른쪽 핸들은 +dx가 바깥쪽 확장이고, 왼쪽 핸들은 반대 방향이므로
 * 수평 이동량만 정규화한다. 세로 축소는 4→2, 가로 축소는 2→1로
 * 해석하며, 두 축을 동시에 줄이면 4→1이 된다.
 */
export function sizeFromDrag({ dx, dy, side, cellW, rowH, start }: SizeFromDragInput): TileSize {
  const horizontal = side === "left" ? -dx : dx;
  const expandsWidth = horizontal >= cellW / 2;
  const expandsHeight = dy >= rowH / 2;
  const shrinksWidth = horizontal <= -cellW / 2;
  const shrinksHeight = dy <= -rowH / 2;

  if (start === 4 && shrinksWidth && shrinksHeight) return 1;
  if (start === 4 && shrinksHeight) return 2;
  if (start === 2 && shrinksWidth) return 1;
  if (expandsWidth && expandsHeight) return 4;
  if (expandsWidth) return start === 4 ? 4 : 2;
  return start;
}

export type TileResizePreview = {
  size: TileSize;
  side: ResizeSide;
  pointerId: number;
};

export type TileResizePointerCapture = {
  pointerId: number;
  side: ResizeSide;
};

export type UseTileResizeOptions = {
  /** 포인터 드래그가 시작될 때의 현재 보드 크기. */
  size: TileSize;
  cellW: number;
  rowH: number;
  /** 변경된 크기를 board-state의 resize action으로 연결한다. */
  onCommit: (size: TileSize) => void;
  /** Esc 또는 pointercancel/lostpointercapture로 취소했을 때 호출한다. */
  onCancel?: () => void;
};

export type TileResizeHandleProps = {
  type: "button";
  "aria-label": string;
  "aria-keyshortcuts": string;
  style: CSSProperties;
  onPointerDown: PointerEventHandler<HTMLButtonElement>;
  onPointerMove: PointerEventHandler<HTMLButtonElement>;
  onPointerUp: PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onLostPointerCapture: PointerEventHandler<HTMLButtonElement>;
  onKeyDown: KeyboardEventHandler<HTMLButtonElement>;
};

export type UseTileResizeResult = {
  /** 드래그 중인 카드가 그릴 미리보기. 드래그가 없으면 null이다. */
  preview: TileResizePreview | null;
  /** 현재 pointer capture의 식별자와 핸들 방향. 드래그가 없으면 null이다. */
  pointerCapture: TileResizePointerCapture | null;
  isResizing: boolean;
  /** 카드의 좌하단/우하단 버튼에 그대로 spread할 수 있는 접근성·이벤트 계약. */
  handleProps: (side: ResizeSide) => TileResizeHandleProps;
  /** 활성 드래그를 커밋하지 않고 종료한다. */
  cancel: () => void;
};

type ActiveResize = {
  side: ResizeSide;
  start: TileSize;
  cellW: number;
  rowH: number;
  pointerId: number;
  originX: number;
  originY: number;
  target: HTMLButtonElement;
};

const KEYBOARD_SHORTCUTS = "ArrowLeft ArrowRight ArrowUp ArrowDown Escape";

function nextKeyboardSize(size: TileSize, direction: -1 | 1): TileSize {
  if (direction < 0) return size === 4 ? 2 : size === 2 ? 1 : 1;
  return size === 1 ? 2 : size === 2 ? 4 : 4;
}

export function useTileResize({ size, cellW, rowH, onCommit, onCancel }: UseTileResizeOptions): UseTileResizeResult {
  const [preview, setPreview] = useState<TileResizePreview | null>(null);
  const [pointerCapture, setPointerCapture] = useState<TileResizePointerCapture | null>(null);
  const activeRef = useRef<ActiveResize | null>(null);
  const sizeRef = useRef(size);
  const metricsRef = useRef({ cellW, rowH });
  const commitRef = useRef(onCommit);
  const cancelRef = useRef(onCancel);
  sizeRef.current = size;
  metricsRef.current = { cellW, rowH };
  commitRef.current = onCommit;
  cancelRef.current = onCancel;

  const finish = useCallback((notifyCancel: boolean): ActiveResize | null => {
    const active = activeRef.current;
    if (!active) return null;
    activeRef.current = null;
    setPreview(null);
    setPointerCapture(null);
    try {
      if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
    } catch {
      // Pointer capture can already be gone when the browser dispatches cancel/unmount.
    }
    if (notifyCancel) cancelRef.current?.();
    return active;
  }, []);

  const cancel = useCallback(() => {
    finish(true);
  }, [finish]);

  const begin = useCallback((side: ResizeSide) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || activeRef.current) return;
    const { cellW: startCellW, rowH: startRowH } = metricsRef.current;
    if (!(startCellW > 0) || !(startRowH > 0)) return;

    const target = event.currentTarget;
    const active: ActiveResize = {
      side,
      start: sizeRef.current,
      cellW: startCellW,
      rowH: startRowH,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      target,
    };
    event.preventDefault();
    target.focus({ preventScroll: true });
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may have ended between pointerdown and capture; handlers remain safe.
    }
    activeRef.current = active;
    setPreview({ size: active.start, side, pointerId: active.pointerId });
    setPointerCapture({ pointerId: active.pointerId, side });
  }, []);

  const move = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = activeRef.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const next = sizeFromDrag({
      dx: event.clientX - active.originX,
      dy: event.clientY - active.originY,
      side: active.side,
      cellW: active.cellW,
      rowH: active.rowH,
      start: active.start,
    });
    setPreview({ size: next, side: active.side, pointerId: active.pointerId });
  }, []);

  const up = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = activeRef.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const next = sizeFromDrag({
      dx: event.clientX - active.originX,
      dy: event.clientY - active.originY,
      side: active.side,
      cellW: active.cellW,
      rowH: active.rowH,
      start: active.start,
    });
    finish(false);
    if (next !== active.start) commitRef.current(next);
  }, [finish]);

  const pointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = activeRef.current;
    if (active && event.pointerId === active.pointerId) cancel();
  }, [cancel]);

  const lostPointerCapture = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = activeRef.current;
    if (active && event.pointerId === active.pointerId) cancel();
  }, [cancel]);

  const keyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      if (!activeRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }

    let direction: -1 | 1 | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") direction = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") direction = 1;
    if (direction === null) return;
    event.preventDefault();
    const next = nextKeyboardSize(sizeRef.current, direction);
    if (next !== sizeRef.current) commitRef.current(next);
  }, [cancel]);

  const active = preview !== null;
  useEffect(() => {
    if (!active) return;
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [active, cancel]);

  const handleProps = useCallback((side: ResizeSide): TileResizeHandleProps => ({
    type: "button",
    "aria-label": `크기 조정, ${side === "left" ? "왼쪽" : "오른쪽"} 핸들, 현재 ${size}칸`,
    "aria-keyshortcuts": KEYBOARD_SHORTCUTS,
    style: { minWidth: TILE_RESIZE_HANDLE_MIN_SIZE, minHeight: TILE_RESIZE_HANDLE_MIN_SIZE, touchAction: "none" },
    onPointerDown: begin(side),
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: pointerCancel,
    onLostPointerCapture: lostPointerCapture,
    onKeyDown: keyDown,
  }), [begin, keyDown, lostPointerCapture, move, pointerCancel, size, up]);

  return { preview, pointerCapture, isResizing: active, handleProps, cancel };
}

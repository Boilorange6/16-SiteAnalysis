"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/**
 * 포인터(마우스·터치·펜)로 타일 순서 끌어 놓기. 포인터 추적만 하고 순서 계산은 onDrop 쪽 reducer가 한다.
 * 끄는 동안 preview가 자리 표시자를 넣은 순서를 돌려주고, Esc·pointercancel은 취소한다.
 */
type Drag = { id: string; from: number; to: number; x: number; y: number; w: number; h: number; dx: number; dy: number };

export function previewOrder(order: string[], from: number, to: number): string[] {
  const next = [...order];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function useTileDrag(order: string[], gridRef: RefObject<HTMLElement | null>, onDrop: (id: string, from: number, to: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const ref = useRef<Drag | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const startHandlers = useRef(new Map<string, (e: ReactPointerEvent<HTMLElement>) => void>());
  const active = drag !== null;
  const drop = useRef(onDrop);
  useEffect(() => {
    drop.current = onDrop;
  });
  const set = useCallback((d: Drag | null) => {
    ref.current = d;
    setDrag(d);
  }, []);

  useEffect(() => {
    if (!active) return;
    const move = (e: PointerEvent) => {
      const d = ref.current;
      if (!d) return;
      let to = d.to;
      const cur = previewOrder(order, d.from, d.to);
      for (const el of gridRef.current?.querySelectorAll<HTMLElement>("[data-tile-id]") ?? []) {
        const tid = el.dataset.tileId!;
        if (tid === d.id) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          to = cur.indexOf(tid);
          break;
        }
      }
      // ponytail: 가장자리 자동 스크롤은 이동 이벤트 때만(타이머 없음). 긴 목록에서 답답하면 rAF 루프로.
      const sc = gridRef.current?.closest("main");
      if (sc) sc.scrollTop += e.clientY < 60 ? -18 : e.clientY > window.innerHeight - 60 ? 18 : 0;
      set({ ...d, to, x: e.clientX - d.dx, y: e.clientY - d.dy });
    };
    const up = () => {
      const d = ref.current;
      set(null);
      if (d && d.from !== d.to) drop.current(d.id, d.from, d.to);
    };
    const cancel = () => set(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && cancel();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [active, order, gridRef, set]);

  const start = useCallback((id: string) => {
    const existing = startHandlers.current.get(id);
    if (existing) return existing;
    const handler = (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || ref.current) return;
      const from = orderRef.current.indexOf(id);
      const tile = (e.currentTarget.closest("[data-tile-id]") as HTMLElement | null)?.getBoundingClientRect();
      if (from < 0 || !tile) return;
      e.preventDefault(); // 마우스로 끌 때 글자 선택 방지
      set({ id, from, to: from, x: tile.left, y: tile.top, w: tile.width, h: tile.height, dx: e.clientX - tile.left, dy: e.clientY - tile.top });
    };
    startHandlers.current.set(id, handler);
    return handler;
  }, [set]);

  const floatStyle = useCallback((id: string): CSSProperties | undefined =>
    drag?.id === id ? { position: "fixed", left: drag.x, top: drag.y, width: drag.w, height: drag.h, zIndex: 40, pointerEvents: "none" } : undefined, [drag]);

  return { drag, order: drag ? previewOrder(order, drag.from, drag.to) : order, start, floatStyle };
}

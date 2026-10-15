"use client";

import { useEffect, useRef, type RefObject } from "react";

type FocusTrapOptions = {
  ref: RefObject<HTMLElement | null>;
  active?: boolean;
  onClose?: () => void;
  /** Return true when Escape was handled without closing the dialog. */
  onEscape?: (event: KeyboardEvent) => boolean | void;
  restoreFocus?: boolean;
  /** Stable fallback when the element that opened the dialog is removed on open. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
};

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function isVisibleAndEnabled(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true" || element.getAttribute("aria-disabled") === "true") return false;
  if (element.matches(":disabled")) return false;
  if (element.closest("[hidden], [inert], [aria-hidden=\"true\"]")) return false;
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return true;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisibleAndEnabled);
  // Keep ordinary dialog controls together so the first control is stable;
  // interactive SVG map features remain in the same trap after them.
  return [
    ...elements.filter((element) => !(element instanceof SVGElement)),
    ...elements.filter((element) => element instanceof SVGElement),
  ];
}

function focusWithoutScroll(element: HTMLElement): void {
  element.focus({ preventScroll: true });
}

export function useFocusTrap({ ref, active = true, onClose, onEscape, restoreFocus = true, restoreFocusRef }: FocusTrapOptions): void {
  const onCloseRef = useRef(onClose);
  const onEscapeRef = useRef(onEscape);
  onCloseRef.current = onClose;
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement && !root.contains(document.activeElement) ? document.activeElement : null;
    const initialFrame = window.requestAnimationFrame(() => {
      const focusables = focusableElements(root);
      // Map figures expose SVG points with tabindex=0. Start on the first
      // ordinary dialog control; SVG points remain in the trap's tab order.
      const first = focusables.find((element) => !(element instanceof SVGElement)) ?? focusables[0];
      focusWithoutScroll(first ?? root);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !root.contains(event.target)) return;
      if (event.key === "Escape") {
        if (onEscapeRef.current?.(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = focusableElements(root);
      event.preventDefault();
      if (focusables.length === 0) {
        focusWithoutScroll(root);
        return;
      }
      const current = document.activeElement instanceof HTMLElement ? focusables.indexOf(document.activeElement) : -1;
      const next = event.shiftKey
        ? current <= 0 ? focusables.length - 1 : current - 1
        : current < 0 || current === focusables.length - 1 ? 0 : current + 1;
      focusWithoutScroll(focusables[next]!);
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      if (!restoreFocus) return;
      const connectedOpener = opener?.isConnected ? opener : restoreFocusRef?.current;
      // 연 버튼이 닫힌 <details> 메뉴 안에 있으면 보이지 않아 포커스를 못 받으므로 그 메뉴의 summary로 돌린다.
      const closedMenu = connectedOpener?.closest("details:not([open])");
      const restoreTarget = closedMenu?.querySelector<HTMLElement>(":scope > summary") ?? connectedOpener;
      if (!restoreTarget?.isConnected) return;
      let attempts = 0;
      const restore = () => {
        if (!restoreTarget.isConnected) return;
        if (!restoreTarget.closest("[inert]")) {
          focusWithoutScroll(restoreTarget);
          return;
        }
        if (attempts < 2) {
          attempts += 1;
          window.requestAnimationFrame(restore);
        }
      };
      window.requestAnimationFrame(restore);
    };
  }, [active, ref, restoreFocus, restoreFocusRef]);
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

const CONTROL_SELECTOR = "a[href],button,input,select,textarea,[contenteditable=\"true\"],[tabindex]";

function cardControls(card: HTMLElement | null): HTMLElement[] {
  if (!card) return [];
  return Array.from(card.querySelectorAll<HTMLElement>(CONTROL_SELECTOR));
}

function visibleControls(card: HTMLElement | null): HTMLElement[] {
  return cardControls(card).filter((element) => {
    if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true" || element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest("[hidden], [inert], [aria-hidden=\"true\"]")) return false;
    if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return true;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  });
}

/** Keep card internals out of the board tab sequence until Enter enters the card. */
export function useCardRoving(cardRef: RefObject<HTMLElement | null>) {
  const [controlsEntered, setControlsEntered] = useState(false);

  const syncControls = useCallback((entered: boolean) => {
    for (const element of cardControls(cardRef.current)) {
      if (entered) {
        const hadTabIndex = element.dataset.v2RovingHadTabindex === "true";
        if (hadTabIndex) {
          element.setAttribute("tabindex", element.dataset.v2RovingTabindex ?? "0");
        } else if (element.dataset.v2RovingHadTabindex === "false") {
          element.removeAttribute("tabindex");
        }
        delete element.dataset.v2RovingHadTabindex;
        delete element.dataset.v2RovingTabindex;
      } else if (!element.dataset.v2RovingHadTabindex) {
        element.dataset.v2RovingHadTabindex = element.hasAttribute("tabindex") ? "true" : "false";
        element.dataset.v2RovingTabindex = element.getAttribute("tabindex") ?? "";
        element.tabIndex = -1;
      }
    }
  }, [cardRef]);

  useLayoutEffect(() => {
    syncControls(controlsEntered);
  }, [controlsEntered, syncControls]);

  useEffect(() => {
    if (!cardRef.current || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => syncControls(controlsEntered));
    observer.observe(cardRef.current, { attributes: true, attributeFilter: ["data-on", "inert", "aria-hidden"], childList: true, subtree: true });
    return () => observer.disconnect();
  }, [cardRef, controlsEntered, syncControls]);

  const enterControls = useCallback(() => {
    const first = visibleControls(cardRef.current)[0];
    if (!first) return false;
    setControlsEntered(true);
    window.requestAnimationFrame(() => first.focus());
    return true;
  }, [cardRef]);

  const returnToCard = useCallback(() => {
    setControlsEntered(false);
    window.requestAnimationFrame(() => cardRef.current?.focus());
  }, [cardRef]);

  const onBlur = useCallback((event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setControlsEntered(false);
  }, []);

  const onKeyDownCapture = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.target === event.currentTarget) return;
    // Child menus/tooltips may close themselves and stop propagation. Refocus
    // the card on the next frame so those existing cleanups still run first.
    window.requestAnimationFrame(() => {
      setControlsEntered(false);
      cardRef.current?.focus();
    });
  }, [cardRef]);

  return { controlsEntered, enterControls, returnToCard, onBlur, onKeyDownCapture };
}

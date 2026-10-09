"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { activeLegendLabel, legendScrollState, legendWheelScrollTarget } from "@/lib/v2/ui/map-legend";
import styles from "./board.module.css";

export type LegendSwatchKind = "point" | "line" | "polygon" | "site";

export type MapLegendItem = {
  layer: string;
  /** 엔진 범례가 같은 레이어에 여러 값 구간을 낼 때 쓰는 표시 항목 키. */
  id?: string;
  label: string;
  color: string;
  count?: number;
  site?: boolean;
  swatch?: LegendSwatchKind;
  hollow?: boolean;
  /** 화면에 표시하는 값 범례와 지도 요소 강조에 쓰는 공용 레이어명을 분리한다. */
  highlightLabel?: string;
};

function LegendSwatch({ item }: { item: MapLegendItem }) {
  const kind = item.site ? "site" : (item.swatch ?? "point");
  if (kind === "site") {
    return (
      <svg className={styles.mapLegendSwatchSvg} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <rect x="2.2" y="2.2" width="7.6" height="7.6" fill="#fff" stroke="#111" strokeWidth="1" transform="rotate(45 6 6)" />
        <circle cx="6" cy="6" r="1.3" fill="#111" />
      </svg>
    );
  }
  return (
    <span
      className={styles.mapLegendSwatch}
      data-kind={kind}
      aria-hidden="true"
      style={{ "--map-legend-color": item.color, background: item.hollow ? "transparent" : undefined } as CSSProperties}
    />
  );
}

function LegendEntry({
  item,
  active,
  pinned,
  pointerTypeRef,
  onToggle,
  onHover,
}: {
  item: MapLegendItem;
  active: boolean;
  pinned: boolean;
  pointerTypeRef: { current: string | null };
  onToggle: (label: string) => void;
  onHover: (label: string | null) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const focusAndReveal = () => {
    window.requestAnimationFrame(() => buttonRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };
  const content = (
    <>
      <LegendSwatch item={item} />
      <span className={styles.mapLegendLabel}>{item.label}</span>
      {typeof item.count === "number" && <span className={styles.mapLegendCount}>{item.count}</span>}
    </>
  );
  if (item.site) return <span className={styles.mapLegendStatic}>{content}</span>;
  const interactionLabel = item.highlightLabel ?? item.label;
  return (
    <button
      ref={buttonRef}
      type="button"
      data-map-legend={item.label}
      data-active={active ? "true" : undefined}
      className={styles.mapLegendButton}
      aria-label={`${item.label} 범례 강조`}
      aria-pressed={pinned}
      onClick={() => onToggle(interactionLabel)}
      onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => { pointerTypeRef.current = event.pointerType; }}
      onPointerEnter={(event: ReactPointerEvent<HTMLButtonElement>) => { pointerTypeRef.current = event.pointerType; if (event.pointerType !== "touch") onHover(interactionLabel); }}
      onPointerLeave={() => { pointerTypeRef.current = null; onHover(null); }}
      onFocus={() => { focusAndReveal(); if (pointerTypeRef.current !== "touch") onHover(interactionLabel); }}
      onBlur={() => { pointerTypeRef.current = null; onHover(null); }}
    >
      {content}
    </button>
  );
}

export function MapLegendStrip({
  items,
  hoverLabel,
  pinnedLabel,
  onHover,
  onToggle,
  leadingLabel,
  trailingLabel,
  ariaLabel = "지도 범례",
}: {
  items: readonly MapLegendItem[];
  hoverLabel: string | null;
  pinnedLabel: string | null;
  onHover: (label: string | null) => void;
  onToggle: (label: string) => void;
  leadingLabel?: string | null;
  trailingLabel?: string | null;
  ariaLabel?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pointerTypeRef = useRef<string | null>(null);
  const [scrollState, setScrollState] = useState(() => legendScrollState({ scrollLeft: 0, clientWidth: 0, scrollWidth: 0 }));
  const syncScrollState = () => {
    const element = scrollRef.current;
    if (!element) return;
    setScrollState(legendScrollState({ scrollLeft: element.scrollLeft, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    syncScrollState();
    element.addEventListener("scroll", syncScrollState, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncScrollState);
    resizeObserver?.observe(element);
    return () => {
      element.removeEventListener("scroll", syncScrollState);
      resizeObserver?.disconnect();
    };
  }, [items.length]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const target = legendWheelScrollTarget({
        scrollLeft: element.scrollLeft,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
      if (target === null) return;
      event.preventDefault();
      element.scrollLeft = target;
      syncScrollState();
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [items.length]);

  const activeLabel = activeLegendLabel(hoverLabel, pinnedLabel);
  return (
    <div
      className={styles.mapLegendStrip}
      role="group"
      aria-label={ariaLabel}
      data-scroll-start={!scrollState.atStart ? "true" : undefined}
      data-scroll-end={!scrollState.atEnd ? "true" : undefined}
      data-scroll-overflow={scrollState.overflowing ? "true" : undefined}
    >
      <div ref={scrollRef} className={styles.mapLegendScroll}>
        {leadingLabel && <span className={styles.mapLegendMeta}>{leadingLabel}</span>}
        {items.map((item) => (
          <LegendEntry
            key={item.id ?? item.layer}
            item={item}
            active={activeLabel === (item.highlightLabel ?? item.label)}
            pinned={pinnedLabel === (item.highlightLabel ?? item.label)}
            pointerTypeRef={pointerTypeRef}
            onToggle={onToggle}
            onHover={onHover}
          />
        ))}
        {trailingLabel && <span className={styles.mapLegendMeta}>{trailingLabel}</span>}
      </div>
    </div>
  );
}

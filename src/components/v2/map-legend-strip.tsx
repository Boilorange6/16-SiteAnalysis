"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { activeLegendLabel, legendScrollState, legendWheelScrollTarget } from "@/lib/v2/ui/map-legend";
import { badgeTextColor } from "@/lib/v2/ui/map-labels";
import styles from "./board.module.css";

export type LegendSwatchKind = "point" | "line" | "polygon" | "site" | "raster" | "rail-axis" | "rail-exit";

export type MapLegendItem = {
  layer: string;
  /** 엔진 범례가 같은 레이어에 여러 값 구간을 낼 때 쓰는 표시 항목 키. */
  id?: string;
  label: string;
  color: string;
  /** 철도처럼 짧은 호선 배지를 함께 보여주는 항목. */
  badge?: string;
  /** 실제 지도 표현을 그대로 보여주는 역사 막대·출구 기호. */
  symbol?: "rail-axis" | "rail-exit";
  /** 여러 원천 색을 쓰는 선(예: 철도 노선)·연속 래스터의 띠 견본. */
  colors?: readonly string[];
  count?: number;
  site?: boolean;
  /** 지도에서 강조할 수 없는 설명용 래스터/메타 항목. */
  static?: boolean;
  swatch?: LegendSwatchKind;
  legendSwatch?: "line" | "polygon";
  hollow?: boolean;
  /** 면 레이어의 실제 채움·테두리·빗금 표현. 지도와 같은 원천 스타일을 범례 견본에도 쓴다. */
  fill?: string;
  stroke?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  /** Geometry-faithful line style metadata from map-layers.ts. */
  lineSwatch?: boolean;
  dash?: string;
  lineCap?: "butt" | "round" | "square";
  tickMarks?: boolean;
  casing?: string;
  hatch?: boolean;
  /** 화면에 표시하는 값 범례와 지도 요소 강조에 쓰는 공용 레이어명을 분리한다. */
  highlightLabel?: string;
};

export function LegendSwatch({ item }: { item: MapLegendItem }) {
  const swatchId = useId().replace(/:/g, "");
  const kind = item.site ? "site" : (item.symbol ?? item.swatch ?? (item.lineSwatch ? "line" : item.legendSwatch ?? "point"));
  if (kind === "site") {
    return (
      <svg className={styles.mapLegendSwatchSvg} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <rect x="2.2" y="2.2" width="7.6" height="7.6" fill="#fff" stroke="#111" strokeWidth="1" transform="rotate(45 6 6)" />
        <circle cx="6" cy="6" r="1.3" fill="#111" />
      </svg>
    );
  }
  if (kind === "rail-axis") {
    return (
      <svg className={styles.mapLegendSwatchSvg} data-kind={kind} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <line x1="1" y1="8" x2="15" y2="8" stroke="#172033" strokeWidth="6" strokeLinecap="round" />
        <line x1="1" y1="8" x2="15" y2="8" stroke={item.color} strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "rail-exit") {
    return (
      <svg className={styles.mapLegendSwatchSvg} data-kind={kind} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="5.2" fill="#FFD200" stroke="#172033" strokeWidth="0.9" />
      </svg>
    );
  }
  if (item.badge) {
    return (
      <svg className={styles.mapLegendSwatchSvg} data-kind={kind} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="7" fill={item.color} stroke="#fff" strokeWidth="1" />
        <text x="8" y="11" textAnchor="middle" fontSize="8" fontWeight="700" fill={badgeTextColor(item.color)}>{item.badge}</text>
      </svg>
    );
  }
  if (kind === "polygon" && (item.fill || item.stroke || item.hatch)) {
    const fill = item.hollow ? "transparent" : item.fill ?? item.color;
    const stroke = item.stroke ?? item.color;
    const patternId = `map-legend-hatch-${swatchId}`;
    return (
      <svg className={styles.mapLegendSwatchSvg} data-kind={kind} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        {item.hatch && (
          <defs>
            <pattern id={patternId} patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
              <rect width="10" height="10" fill={fill} fillOpacity={item.fillOpacity ?? 1} />
              <path d="M0 0V10" stroke={item.color} strokeWidth="1.2" strokeOpacity="0.75" />
            </pattern>
          </defs>
        )}
        <rect
          x="0.5"
          y="0.5"
          width="9"
          height="9"
          rx="1.5"
          fill={item.hatch ? `url(#${patternId})` : fill}
          fillOpacity={item.hatch ? 1 : item.fillOpacity ?? 1}
          stroke={stroke}
          strokeWidth={item.strokeWidth ?? 1}
          strokeDasharray={item.dash}
        />
      </svg>
    );
  }
  if (kind === "line" && item.lineSwatch) {
    const strokeWidth = Math.max(1, item.strokeWidth ?? 1.5);
    const lineCap = item.lineCap ?? "butt";
    return (
      <svg className={styles.mapLegendSwatchSvg} data-kind={kind} width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false">
        {item.casing && <line x1="1" y1="6" x2="19" y2="6" stroke={item.casing} strokeWidth={strokeWidth + 2.4} strokeDasharray={item.dash} strokeLinecap={lineCap} strokeLinejoin="round" />}
        <line x1="1" y1="6" x2="19" y2="6" stroke={item.color} strokeWidth={strokeWidth} strokeDasharray={item.dash} strokeLinecap={lineCap} strokeLinejoin="round" />
        {item.tickMarks && [4, 8, 12, 16].map((x) => <line key={x} x1={x} y1="3" x2={x} y2="9" stroke={item.color} strokeWidth="1" strokeLinecap="round" />)}
      </svg>
    );
  }
  const colors = item.colors?.filter((color) => /^#[0-9A-Fa-f]{6}$/.test(color)) ?? [];
  const gradient = colors.length > 1
    ? `linear-gradient(90deg, ${colors.flatMap((color, index) => {
        const start = (index * 100) / colors.length;
        const end = ((index + 1) * 100) / colors.length;
        return [`${color} ${start}%`, `${color} ${end}%`];
      }).join(", ")})`
    : undefined;
  return (
    <span
      className={styles.mapLegendSwatch}
      data-kind={kind}
      aria-hidden="true"
      style={{
        "--map-legend-color": item.color,
        "--map-legend-gradient": gradient,
        background: item.hollow ? "transparent" : undefined,
      } as CSSProperties}
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
  if (item.site || item.static) return <span className={styles.mapLegendStatic}>{content}</span>;
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

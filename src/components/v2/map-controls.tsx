"use client";

import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { MapViewController } from "./use-map-view";
import styles from "./board.module.css";

type MapControlsProps = {
  controller: MapViewController;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
  resetVariant?: "icon" | "label";
  style?: CSSProperties;
};

function ResetViewIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
    </svg>
  );
}

export function MapControls({ controller, disabled = false, className, children, resetVariant = "icon", style }: MapControlsProps) {
  if (disabled && !children) return null;
  const stopCardClick = (event: ReactMouseEvent<HTMLButtonElement>) => event.stopPropagation();
  return (
    <div className={`${styles.mapControls} ${className ?? ""}`.trim()} style={style} aria-label="지도 조작" data-map-controls="true" onPointerDown={(event) => event.stopPropagation()}>
      {!disabled && <>
        <button type="button" className={styles.mapControlButton} onClick={(event) => { stopCardClick(event); controller.zoomBy(0.5); }} aria-label="지도 확대" title="지도 확대"><span aria-hidden="true">＋</span></button>
        <button type="button" className={styles.mapControlButton} onClick={(event) => { stopCardClick(event); controller.zoomBy(-0.5); }} aria-label="지도 축소" title="지도 축소"><span aria-hidden="true">−</span></button>
        {!controller.isDefault && <button type="button" className={`${styles.mapControlButton} ${resetVariant === "label" ? styles.mapControlResetButton : ""}`.trim()} onClick={(event) => { stopCardClick(event); controller.reset(); }} aria-label="지도 시점 초기화" title="지도 시점 초기화" data-map-control="reset"><span aria-hidden="true">{resetVariant === "label" ? "시점 초기화" : <ResetViewIcon />}</span></button>}
      </>}
      {children}
    </div>
  );
}

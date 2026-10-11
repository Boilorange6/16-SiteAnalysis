"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { MapViewController } from "./use-map-view";
import styles from "./board.module.css";

export function MapControls({ controller, disabled = false, className, children }: { controller: MapViewController; disabled?: boolean; className?: string; children?: ReactNode }) {
  if (disabled && !children) return null;
  const stopCardClick = (event: ReactMouseEvent<HTMLButtonElement>) => event.stopPropagation();
  return (
    <div className={`${styles.mapControls} ${className ?? ""}`.trim()} aria-label="지도 조작">
      {!disabled && <>
        <button type="button" className={styles.mapControlButton} onClick={(event) => { stopCardClick(event); controller.zoomBy(0.5); }} aria-label="지도 확대" title="지도 확대"><span aria-hidden="true">＋</span></button>
        <button type="button" className={styles.mapControlButton} onClick={(event) => { stopCardClick(event); controller.zoomBy(-0.5); }} aria-label="지도 축소" title="지도 축소"><span aria-hidden="true">−</span></button>
        {!controller.isDefault && <button type="button" className={styles.mapControlButton} onClick={(event) => { stopCardClick(event); controller.reset(); }} aria-label="지도 시점 초기화" title="지도 시점 초기화"><span aria-hidden="true">⌗</span></button>}
      </>}
      {children}
    </div>
  );
}

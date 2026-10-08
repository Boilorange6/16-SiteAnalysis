"use client";

import { CAMERA_PRESETS } from "@/lib/v2/ui/mass-projection";
import type { TileDialogPanelProps } from "../component-types";
import styles from "@/components/v2/board.module.css";

export function MassDialogPanel({ camera, onCamera }: TileDialogPanelProps) {
  if (!camera || !onCamera) return null;
  return (
    <div className={styles.seg} role="group" aria-label="카메라">
      <span>카메라</span>
      <label>
        방위
        <select
          aria-label="카메라 방위"
          value={camera.azimuthDeg}
          onChange={(event) => onCamera({ azimuthDeg: Number(event.target.value), elevationDeg: camera.elevationDeg })}
        >
          {CAMERA_PRESETS.azimuth.map((azimuthDeg, index) => (
            <option key={azimuthDeg} value={azimuthDeg}>
              {["북동 상공", "남동 상공", "남서 상공", "북서 상공"][index]}
            </option>
          ))}
        </select>
      </label>
      <label>
        앙각
        <select
          aria-label="카메라 앙각"
          value={camera.elevationDeg}
          onChange={(event) => onCamera({ azimuthDeg: camera.azimuthDeg, elevationDeg: Number(event.target.value) })}
        >
          {CAMERA_PRESETS.elevation.map((elevationDeg) => (
            <option key={elevationDeg} value={elevationDeg}>
              {elevationDeg}°
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export const s01DialogRegistration = {
  codes: ["S01"] as const,
  Component: MassDialogPanel,
};

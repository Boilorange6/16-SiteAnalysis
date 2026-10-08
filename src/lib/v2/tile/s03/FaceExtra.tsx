"use client";

import WindPanel, { mapOptions } from "@/components/v2/wind-panel";
import { WIND_LAYER_HEIGHTS } from "@/lib/v2/ui/wind-upload";
import type { TileFaceExtraProps } from "../component-types";
import styles from "@/components/v2/board.module.css";

function nextCut(cut: TileFaceExtraProps["cut"], layerZ: number) {
  return {
    tile: "S03" as const,
    mode: cut?.tile === "S03" ? cut.mode : "single" as const,
    layerZ,
    season: cut?.tile === "S03" ? cut.season : "annual" as const,
  };
}

function WindStrip({ view, layerZ, onLayerZ, onOpen }: { view: TileFaceExtraProps["view"]; layerZ: number; onLayerZ: (z: number) => void; onOpen: () => void }) {
  const options = mapOptions(view);
  const z = options.find((option) => option.z === layerZ)?.z ?? options[0]?.z ?? layerZ;
  return (
    <div className={styles.mfWind} data-wind-strip>
      <label className={styles.mfWindLabel}>
        <span>높이</span>
        <input
          type="range"
          min={0}
          max={WIND_LAYER_HEIGHTS.length - 1}
          step={1}
          value={Math.max(0, WIND_LAYER_HEIGHTS.indexOf(z as (typeof WIND_LAYER_HEIGHTS)[number]))}
          onChange={(event) => onLayerZ(WIND_LAYER_HEIGHTS[Number(event.target.value)] ?? z)}
          disabled={options.length === 0}
          aria-label="바람장 표시 높이"
          aria-valuetext={`${z} m`}
        />
        <output data-wind-height>{z} m</output>
      </label>
      <button type="button" className={styles.mfWindBtn} onClick={onOpen} title="바람 계산·업로드는 펼침에서">
        계산·설정 ↗
      </button>
    </div>
  );
}

export function WindFaceExtra({ view, cut, state, placement, onCut, onOpen, phase, onWindUploaded }: TileFaceExtraProps) {
  if (placement === "controls" && !state) {
    const layerZ = cut?.tile === "S03" ? cut.layerZ : 6;
    return <WindStrip view={view} layerZ={layerZ} onLayerZ={(nextLayer) => onCut(nextCut(cut, nextLayer))} onOpen={onOpen} />;
  }
  if (placement === "summary" && state && (view.status === "pending" || view.status === "running")) {
    return (
      <>
        <div className={styles.windCompact}>
          <WindPanel view={view} compact phase={phase} onUploaded={onWindUploaded} />
        </div>
        <button type="button" className={styles.windOpenBtn} onClick={onOpen} title="바람 계산·업로드는 펼침에서">
          계산·설정 ↗
        </button>
      </>
    );
  }
  return null;
}

export const s03FaceExtraRegistration = {
  codes: ["S03"] as const,
  Component: WindFaceExtra,
};

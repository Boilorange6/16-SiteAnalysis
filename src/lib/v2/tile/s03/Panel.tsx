"use client";

import WindPanel from "@/components/v2/wind-panel";
import type { TileDialogPanelProps } from "../component-types";

export function WindDialogPanel({ view, cut, onCut, onWindUploaded }: TileDialogPanelProps) {
  const layerZ = cut?.tile === "S03" ? cut.layerZ : 6;
  return (
    <WindPanel
      view={view}
      layerZ={layerZ}
      onLayerZ={onCut ? (nextLayer) => onCut({ tile: "S03", mode: cut?.tile === "S03" ? cut.mode : "single", layerZ: nextLayer, season: cut?.tile === "S03" ? cut.season : "annual" }) : undefined}
      onUploaded={onWindUploaded}
    />
  );
}

export const s03DialogRegistration = {
  codes: ["S03"] as const,
  Component: WindDialogPanel,
};

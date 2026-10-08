import type { Scene } from "../../scene";
import type { TileResult } from "../../tile-result";
import type { MassModel } from "../../ui/mass-projection";
import type { TileClientModule } from "../types";
import { s01CutModule } from "./cut";

function massOfS01(result: TileResult, scene: Scene | null | undefined): MassModel | null {
  if (!result.presentation.camera) return null;
  const camera = result.presentation.camera;
  if (typeof camera.azimuthDeg !== "number" || typeof camera.elevationDeg !== "number") return null;
  return {
    scene: scene ?? null,
    camera: {
      azimuthDeg: camera.azimuthDeg,
      elevationDeg: camera.elevationDeg,
      radiusM: typeof camera.radiusM === "number" ? camera.radiusM : result.conditions.radiusM,
    },
  };
}

export const s01ClientModule = {
  code: "S01",
  headline: { ids: ["height_median_m", "height_known_pct", "buildings"] },
  mass: massOfS01,
  cut: s01CutModule,
} satisfies TileClientModule;

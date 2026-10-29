"use client";

import Mass3D from "@/components/v2/mass-3d";
import type { TileStageProps } from "../component-types";

export function MassStage({ displayView, frame, label }: TileStageProps) {
  const mass = displayView.mass;
  if (!mass) return null;
  const card = frame === "card";
  return (
    <Mass3D
      scene={mass.scene}
      camera={mass.camera}
      width={960}
      height={540}
      label={label}
      quality={card ? "card" : "detail"}
      mode={card ? "image" : "live"}
      exploded={mass.exploded}
      palette={mass.palette}
    />
  );
}

export const s01StageRegistration = {
  codes: ["S01"] as const,
  Component: MassStage,
  when: (view: TileStageProps["view"]) => !!view.mass,
};

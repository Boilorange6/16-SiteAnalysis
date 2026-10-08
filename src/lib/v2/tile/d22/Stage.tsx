"use client";

import WindRoseFigure from "@/components/v2/wind-rose-figure";
import type { TileStageProps } from "../component-types";

export function WindRoseStage({ view, displayView, cut, roseSeason = "annual", label }: TileStageProps) {
  const displayRoseSeason = cut?.tile === "D22" && cut.mode === "annual" ? "annual" : roseSeason;
  const seasonalRose = displayView.roses?.[displayRoseSeason];
  const model = seasonalRose ?? displayView.rose;
  if (!model) return null;
  return <WindRoseFigure model={model} width={960} height={540} label={label} season={seasonalRose ? displayRoseSeason : "annual"} />;
}

export const d22StageRegistration = {
  codes: ["D22"] as const,
  Component: WindRoseStage,
  when: (view: TileStageProps["view"]) => !!view.rose || !!view.roses,
};

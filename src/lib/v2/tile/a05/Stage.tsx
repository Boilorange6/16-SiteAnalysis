"use client";

import CalloutMap, { type CalloutMapProps } from "@/components/v2/callout-map";
import type { TileStageProps as SharedTileStageProps } from "../component-types";

/** A05 and A06 share one callout ownership unit; the existing callout files remain there. */
export type TileStageProps = SharedTileStageProps;

export function CalloutStage({ view, frame, page, onPage, label }: TileStageProps) {
  if (!view.callout) return null;
  const props: CalloutMapProps = { model: view.callout, kind: frame, page, onPage, label };
  return <CalloutMap {...props} />;
}

export const a05StageRegistration = {
  codes: ["A05", "A06"] as const,
  Component: CalloutStage,
  when: (view: TileStageProps["view"]) => !!view.callout,
};

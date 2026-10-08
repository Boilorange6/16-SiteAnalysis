"use client";

import CalloutMap, { type CalloutMapProps } from "@/components/v2/callout-map";

/** A05 and A06 share one callout ownership unit; the existing callout files remain there. */
export type TileStageProps = CalloutMapProps;

export function CalloutStage(props: TileStageProps) {
  return <CalloutMap {...props} />;
}

export const a05StageRegistration = {
  codes: ["A05", "A06"] as const,
  Component: CalloutStage,
};

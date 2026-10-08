"use client";

import type { ComponentType } from "react";
import { a05StageRegistration, type TileStageProps } from "./a05/Stage";
import { a05DialogRegistration, type A05DialogPanelProps } from "./a05/Panel";

type StageRegistration = {
  codes: readonly string[];
  Component: ComponentType<TileStageProps>;
};

type DialogRegistration = {
  codes: readonly string[];
  Component: ComponentType<A05DialogPanelProps>;
};

const STAGE_MODULES: readonly StageRegistration[] = [a05StageRegistration];
const DIALOG_MODULES: readonly DialogRegistration[] = [a05DialogRegistration];

export function stageFor(code: string): ComponentType<TileStageProps> | undefined {
  return STAGE_MODULES.find((entry) => entry.codes.includes(code))?.Component;
}

export function dialogPanelFor(code: string): ComponentType<A05DialogPanelProps> | undefined {
  return DIALOG_MODULES.find((entry) => entry.codes.includes(code))?.Component;
}

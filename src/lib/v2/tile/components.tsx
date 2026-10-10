"use client";

import type { ComponentType } from "react";
import type { TileView } from "../ui/tile-view";
import type { TileDialogPanelProps, TileFaceExtraProps, TileStageProps } from "./component-types";
import { a05StageRegistration } from "./a05/Stage";
import { a05DialogRegistration } from "./a05/Panel";
import { s01StageRegistration } from "./s01/Stage";
import { s01FaceExtraRegistration } from "./s01/FaceExtra";
import { s01DialogRegistration } from "./s01/Panel";
import { d22StageRegistration } from "./d22/Stage";
import { s03FaceExtraRegistration } from "./s03/FaceExtra";
import { s03DialogRegistration } from "./s03/Panel";

type StageRegistration = {
  codes: readonly string[];
  Component: ComponentType<TileStageProps>;
  when?: (view: TileView) => boolean;
};

type DialogRegistration = {
  codes: readonly string[];
  Component: ComponentType<TileDialogPanelProps>;
};

type FaceExtraRegistration = {
  codes: readonly string[];
  Component: ComponentType<TileFaceExtraProps>;
};

const STAGE_MODULES: readonly StageRegistration[] = [a05StageRegistration, s01StageRegistration, d22StageRegistration];
const FACE_EXTRA_MODULES: readonly FaceExtraRegistration[] = [s01FaceExtraRegistration, s03FaceExtraRegistration];
const DIALOG_MODULES: readonly DialogRegistration[] = [a05DialogRegistration, s01DialogRegistration, s03DialogRegistration];

export function stageFor(code: string, view?: TileView): ComponentType<TileStageProps> | undefined {
  const entry = STAGE_MODULES.find((candidate) => candidate.codes.includes(code) && (!candidate.when || !view || candidate.when(view)));
  return entry?.Component;
}

export function faceExtraFor(code: string): ComponentType<TileFaceExtraProps> | undefined {
  return FACE_EXTRA_MODULES.find((entry) => entry.codes.includes(code))?.Component;
}

export function dialogPanelFor(code: string): ComponentType<TileDialogPanelProps> | undefined {
  return DIALOG_MODULES.find((entry) => entry.codes.includes(code))?.Component;
}

"use client";

import type { TileFaceExtraProps } from "../component-types";
import styles from "@/components/v2/board.module.css";

export function MassFaceExtra({ view, cut, state, placement, onCut }: TileFaceExtraProps) {
  if (placement !== "header" || state || !view.mass) return null;
  const exploded = cut?.tile === "S01" && cut.mode === "exploded";
  return (
    <button
      type="button"
      className={`${styles.mfWindBtn} ${exploded ? styles.mfBtnOn : ""}`}
      aria-pressed={exploded}
      onClick={() => onCut({ tile: "S01", mode: exploded ? "mass" : "exploded" })}
    >
      {exploded ? "기본 매스" : "분해"}
    </button>
  );
}

export const s01FaceExtraRegistration = {
  codes: ["S01"] as const,
  Component: MassFaceExtra,
};

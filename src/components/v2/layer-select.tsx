"use client";

import type { ReactNode } from "react";
import type { TileView } from "@/lib/v2/ui/tile-view";
import styles from "./board.module.css";

export type SegmentedOption = { id: string; label: ReactNode };

/** S01 매스 보기와 지도 레이어가 공유하는 키보드·터치 세그먼트. */
export function SegmentedControl({
  label,
  ariaLabel,
  options,
  value,
  onChange,
  className,
}: {
  label?: ReactNode;
  ariaLabel: string;
  options: readonly SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  if (options.length === 0) return null;
  return (
    <div className={[styles.seg, className].filter(Boolean).join(" ")} role="group" aria-label={ariaLabel}>
      {label}
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LayerSelect({ view, value, onChange }: { view: TileView; value: string; onChange: (layer: string) => void }) {
  if (view.layerOptions.length < 2) return null;
  const selected = view.layerOptions.some((option) => option.id === value) ? value : view.defaultLayer;
  return (
    <SegmentedControl
      label={<span>표현</span>}
      ariaLabel={`${view.title} 지도 레이어`}
      options={view.layerOptions}
      value={selected}
      onChange={onChange}
    />
  );
}

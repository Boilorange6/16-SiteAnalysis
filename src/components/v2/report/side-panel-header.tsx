"use client";

import styles from "./report-mode.module.css";

export const SIDE_PANEL_OPACITY_MIN = 40;
export const SIDE_PANEL_OPACITY_MAX = 100;
export const SIDE_PANEL_OPACITY_STEP = 5;

export type SidePanelHeaderProps = {
  title: string;
  context?: string;
  opacity: number;
  onOpacityChange: (value: number) => void;
  onClose: () => void;
  closeLabel?: string;
};

function OpacityIcon() {
  return (
    <svg className={styles.opacityIcon} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export default function SidePanelHeader({ title, context, opacity, onOpacityChange, onClose, closeLabel = "창 닫기" }: SidePanelHeaderProps) {
  const value = Math.max(SIDE_PANEL_OPACITY_MIN, Math.min(SIDE_PANEL_OPACITY_MAX, Math.round(opacity / SIDE_PANEL_OPACITY_STEP) * SIDE_PANEL_OPACITY_STEP));
  return (
    <>
      <div className={styles.sidePanelHeader}>
        <div className={styles.sidePanelTitleGroup}>
          <h2>{title}</h2>
          {context && <span className={styles.selectionPill}>{context}</span>}
        </div>
        <button type="button" className={styles.sidePanelClose} onClick={onClose} aria-label={closeLabel}><CloseIcon /></button>
      </div>
      <label className={styles.opacityControl}>
        <OpacityIcon />
        <span className={styles.srOnly}>창 투명도</span>
        <input type="range" min={SIDE_PANEL_OPACITY_MIN} max={SIDE_PANEL_OPACITY_MAX} step={SIDE_PANEL_OPACITY_STEP} value={value} aria-label="창 투명도" onChange={(event) => onOpacityChange(Number(event.target.value))} />
        <b>{value}%</b>
      </label>
    </>
  );
}

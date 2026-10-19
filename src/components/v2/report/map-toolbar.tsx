"use client";

import styles from "./report-mode.module.css";

type MapToolbarProps = {
  scale: number;
  locked: boolean;
  mapActive: boolean;
  onZoom: (delta: number) => void;
  onFit: () => void;
  onToggleMove: () => void;
  onToggleLock: () => void;
  onOpen: () => void;
};

export default function MapToolbar({ scale, locked, mapActive, onZoom, onFit, onToggleMove, onToggleLock, onOpen }: MapToolbarProps) {
  return (
    <div className={styles.mapToolbar} role="toolbar" aria-label="지도 편집 도구">
      <button type="button" className={styles.mapToolButton} onClick={() => onZoom(-0.25)} disabled={locked} aria-label="축소" title="축소">−</button>
      <span className={styles.mapScale}>1:{scale.toLocaleString("ko-KR")}</span>
      <button type="button" className={styles.mapToolButton} onClick={() => onZoom(0.25)} disabled={locked} aria-label="확대" title="확대">＋</button>
      <button type="button" className={styles.mapToolButtonWide} onClick={onFit} disabled={locked}>대지 맞춤</button>
      <button type="button" className={`${styles.mapToolButtonWide} ${mapActive ? styles.mapToolButtonActive : ""}`} onClick={onToggleMove} disabled={locked} aria-pressed={mapActive} title={locked ? "지도 잠금을 해제하면 이동할 수 있습니다" : undefined}>{mapActive ? "지도 이동 중 · 끝내기" : "지도 이동"}</button>
      {locked && <span className={styles.mapToolbarReason}>잠금 해제 후 이동 가능</span>}
      <button type="button" className={`${styles.mapToolButtonWide} ${locked ? styles.mapToolButtonActive : ""}`} onClick={onToggleLock} aria-pressed={locked}>{locked ? "잠금 해제" : "지도 잠금"}</button>
      <button type="button" className={styles.mapToolButton} onClick={onOpen} aria-label="지도 설정 더 보기" title="지도 설정">…</button>
    </div>
  );
}

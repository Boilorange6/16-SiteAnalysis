"use client";

import styles from "./report-mode.module.css";

type MapToolbarProps = {
  scale: number;
  locked: boolean;
  editing: boolean;
  settingsOpen: boolean;
  lockAttention: boolean;
  onZoom: (delta: number) => void;
  onFit: () => void;
  onToggleLock: () => void;
  onToggleSettings: () => void;
  onDone: () => void;
};

export default function MapToolbar({ scale, locked, editing, settingsOpen, lockAttention, onZoom, onFit, onToggleLock, onToggleSettings, onDone }: MapToolbarProps) {
  return (
    <div className={styles.mapToolbar} data-map-toolbar="true" data-editing={editing ? "true" : "false"} role="toolbar" aria-label="지도 편집 도구">
      <button type="button" className={styles.mapToolButton} onClick={() => onZoom(-0.25)} disabled={locked} aria-label="축척 줄이기" title="축척 줄이기">−</button>
      <span className={styles.mapScale}>1:{scale.toLocaleString("ko-KR")}</span>
      <button type="button" className={styles.mapToolButton} onClick={() => onZoom(0.25)} disabled={locked} aria-label="축척 키우기" title="축척 키우기">＋</button>
      {editing ? (
        <button type="button" className={`${styles.mapToolButtonWide} ${styles.mapToolButtonActive}`} onClick={onDone} aria-label="지도 편집 끝내기 (Esc)" title="지도 편집 끝내기 (Esc)">완료</button>
      ) : (
        <>
          <button type="button" className={styles.mapToolButtonWide} onClick={onFit} disabled={locked} aria-label="대지 맞춤" title="대지 맞춤">맞춤</button>
          <button type="button" className={`${styles.mapToolButtonWide} ${locked ? styles.mapToolButtonActive : ""}`} onClick={onToggleLock} aria-pressed={locked} data-attention={lockAttention ? "true" : undefined} aria-label="지도 위치 고정" title={locked ? "지도 위치 고정 해제" : "지도 위치 고정"}>{locked ? "해제" : "고정"}</button>
          <button type="button" className={`${styles.mapToolButtonWide} ${settingsOpen ? styles.mapToolButtonActive : ""}`} onClick={onToggleSettings} aria-pressed={settingsOpen} aria-label="지도 설정" title="지도 설정">설정</button>
        </>
      )}
    </div>
  );
}

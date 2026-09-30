"use client";

import { useEffect, useRef, useState } from "react";
import { faceLabel, type OutputFace, type TileView } from "@/lib/v2/ui/tile-view";
import { BadgeList, FaceSelect, Headline, RowList, Strip } from "./tile-card";
import MapBox from "./map-box";
import styles from "./board.module.css";

type Props = {
  view: TileView;
  included: boolean;
  face: OutputFace;
  onInclude: (v: boolean) => void;
  onFace: (f: OutputFace) => void;
  onClose: () => void;
};

/** 상세 대화상자: Esc로 닫고, 닫으면 열기 전 초점으로 돌아간다. */
export default function TileDialog({ view, included, face, onInclude, onFace, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [back, setBack] = useState(false);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titleId = `dlg-${view.tileId}`;
  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`${styles.dialog} ${view.map ? styles.dialogWide : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className={styles.dialogHead}>
          <span className={styles.dot} style={{ background: view.color }} />
          <h2 id={titleId}>{view.title}</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="닫기">
            닫기 ×
          </button>
        </div>
        <div className={view.map ? styles.dialogSplit : undefined}>
          {view.map && (
            <div className={styles.dialogMap}>
              <MapBox model={view.map} label={`${view.title} 지도`} />
            </div>
          )}
          <div className={styles.dialogInfo}>
        <BadgeList badges={view.badges} />
        {view.sentence && <p style={{ margin: 0 }}>{view.sentence}</p>}
        {view.grade && (
          <div className={styles.grade}>
            <b>{view.grade.label}</b>
            {view.grade.criteria}
          </div>
        )}
        {view.caveats.map((c) => (
          <p key={c} className={styles.caveat}>
            {c}
          </p>
        ))}
        {view.headline && !view.hasFace && (
          <div className={styles.stat}>
            <Headline view={view} />
          </div>
        )}
        {view.hasFace && (
          <>
            <div className={styles.seg} role="group" aria-label="보기">
              보기
              <button type="button" aria-pressed={!back} onClick={() => setBack(false)}>
                도판
              </button>
              <button type="button" aria-pressed={back} onClick={() => setBack(true)}>
                구성비
              </button>
            </div>
            {back ? null : <Strip view={view} />}
          </>
        )}
        {view.rows.length > 0 && (!view.hasFace || back) && <RowList rows={view.rows} className={styles.list} />}
        {view.notes.length > 0 && (
          <ul className={styles.notes}>
            {view.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <div className={styles.source}>출처 · {view.sourceLine}</div>
          </div>
        </div>
        <div className={styles.dialogFoot}>
          <div>
            <strong>보고서 {view.title}</strong>
            {view.hasFace && <div className={styles.sub}>출력 면: {faceLabel(face)}</div>}
          </div>
          {view.hasFace && <FaceSelect view={view} value={face} onChange={onFace} />}
          <label className={styles.check}>
            <input type="checkbox" checked={included} onChange={(e) => onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
            포함
          </label>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { detailSiteX, OV } from "@/lib/v2/ui/overlay-layout";
import { faceLabel, type OutputFace, type TileView } from "@/lib/v2/ui/tile-view";
import { BadgeList, FaceSelect, Headline, RowList, SourceStrip, Stage, StatusPlate, TitleChip } from "./tile-card";
import { BASEMAPS, BasemapContext, SetBasemapContext } from "./map-box";
import styles from "./board.module.css";

type Props = {
  view: TileView;
  included: boolean;
  face: OutputFace;
  onInclude: (v: boolean) => void;
  onFace: (f: OutputFace) => void;
  onClose: () => void;
};

const PANEL_W = 360;
const insetOf = (w: number) => (w <= 720 ? 0 : PANEL_W + 2 * OV.edge);

/** 펼침: 화면 거의 전체가 지도. 오른쪽에 떠 있는 정보 판. Esc로 닫고, 닫으면 열기 전 초점으로 돌아간다. */
export default function TileDialog({ view, included, face, onInclude, onFace, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [back, setBack] = useState(false);
  const [more, setMore] = useState(false); // 모바일 시트 확장
  const basemap = useContext(BasemapContext);
  const setBasemap = useContext(SetBasemapContext);

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

  const state = view.headline === null;
  const titleId = `dlg-${view.tileId}`;
  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className={styles.stage}>
          <Stage view={view} state={state} chart={view.hasFace && back && !state} frame="detail" siteX={detailSiteX} rightInset={insetOf} legendY={OV.edge + 38 + 8} />
        </div>

        {state && <StatusPlate view={view} phase={null} />}
        <TitleChip view={view} as="h2" headingId={titleId} />

        <div className={styles.dlgTop}>
          <span className={`${styles.plate} ${styles.seg}`} role="group" aria-label="배경지도">
            {BASEMAPS.map((b) => (
              <button key={b.id} type="button" aria-pressed={basemap === b.id} onClick={() => setBasemap(b.id)}>
                {b.label}
              </button>
            ))}
          </span>
          <button type="button" className={`${styles.plate} ${styles.closeBtn}`} onClick={onClose} aria-label="닫기">
            닫기 ×
          </button>
        </div>

        <aside className={`${styles.plate} ${styles.dlgPanel} ${more ? styles.dlgPanelOpen : ""}`} aria-label={`${view.title} 정보`}>
          <BadgeList badges={view.badges} />
          {view.headline && (
            <div className={styles.stat}>
              <Headline view={view} />
            </div>
          )}
          {view.sentence && <p className={styles.dlgSentence}>{view.sentence}</p>}
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
          {view.hasFace && (
            <div className={styles.seg} role="group" aria-label="보기">
              보기
              <button type="button" aria-pressed={!back} onClick={() => setBack(false)}>
                도판
              </button>
              <button type="button" aria-pressed={back} onClick={() => setBack(true)}>
                구성비
              </button>
            </div>
          )}
          {view.rows.length > 0 && <RowList rows={view.rows} className={styles.list} />}
          {view.notes.length > 0 && (
            <ul className={styles.notes}>
              {view.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <div className={styles.source}>출처 · {view.sourceLine}</div>
          <div className={styles.dlgReport}>
            <strong>보고서 {view.title}</strong>
            {view.hasFace && <div className={styles.sub}>출력 면: {faceLabel(face)}</div>}
            {view.hasFace && <FaceSelect view={view} value={face} onChange={onFace} />}
            <label className={styles.check}>
              <input type="checkbox" checked={included} onChange={(e) => onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
              포함
            </label>
          </div>
          <button type="button" className={styles.moreBtn} onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? "접기" : "더 보기"}
          </button>
        </aside>

        <SourceStrip view={view} />
      </div>
    </div>
  );
}

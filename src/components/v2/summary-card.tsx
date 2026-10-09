"use client";

import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SUMMARY_ID, type CardFace } from "@/lib/v2/ui/board-state";
import type { SummaryView } from "@/lib/v2/ui/tile-view";
import { OV } from "@/lib/v2/ui/overlay-layout";
import MapBox from "./map-box";
import styles from "./board.module.css";
import { useCardRoving } from "./use-card-roving";

/**
 * 대지 요약. 기본은 지도 없는 요약면(주소 · 칩 · 사실 3줄 · 기준일/불완전), 뒤집으면 칸 전체가 분석 반경 지도(보드에서 가장 큰 지도).
 * 글자는 지도면에서도 같은 반투명 판 위에만 둔다.
 */
function SummaryCard({ view, face, onFace, rovingTabIndex, onRovingFocus, onRovingMove }: { view: SummaryView; face: CardFace; onFace: (f: CardFace) => void; rovingTabIndex: number; onRovingFocus: (id: string) => void; onRovingMove: (id: string, key: string, event: KeyboardEvent<HTMLElement>) => void }) {
  const [seen, setSeen] = useState(false);
  const summaryRef = useRef<HTMLElement>(null);
  const focusFace = useRef<CardFace | null>(null);
  const roving = useCardRoving(summaryRef);
  useEffect(() => {
    if (face === "map") setSeen(true);
  }, [face]);
  useEffect(() => {
    if (focusFace.current !== face) return;
    const buttonFace = face === "map" ? "summary" : "map";
    summaryRef.current?.querySelector<HTMLButtonElement>(`[data-on="true"] [data-card-face-button="${buttonFace}"]`)?.focus();
    focusFace.current = null;
  }, [face]);
  const changeFace = (next: CardFace) => {
    focusFace.current = next;
    onFace(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      roving.enterControls();
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) onRovingMove(SUMMARY_ID, event.key, event);
  };
  const asOf = (
    <>
      <span>{view.asOfLine}</span>
      {view.incomplete && (
        <span className={`${styles.badge} ${styles.badgeLimit}`} title="일부 타일이 실패했거나 자료가 불완전합니다.">
          일부 자료 불완전 · 타일 {view.incompleteCount}개
        </span>
      )}
    </>
  );
  const body = (
    <>
      <div className={styles.summaryKicker}>대지 요약</div>
      <h2 className={`${styles.display} ${styles.summaryAddr}`}>{view.address}</h2>
      <div className={styles.chips}>
        <span className={styles.chip}>면적: {view.area}</span>
        <span className={styles.chip}>{view.areaSource}</span>
        <span className={styles.chip}>{view.landPrice}</span>
        <span className={styles.chip}>{view.jimok}</span>
        <span className={styles.chip}>{view.zoning}</span>
        <span className={styles.chip}>{view.radius}</span>
        {view.siteMode && <span className={styles.chip}>{view.siteMode}</span>}
      </div>
      <ul className={styles.facts}>
        {view.facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </>
  );
  return (
    <section
      ref={summaryRef}
      className={styles.summary}
      aria-label="대지 요약"
      data-tile="summary"
      data-v2-roving-id={SUMMARY_ID}
      data-v2-roving-card
      tabIndex={roving.controlsEntered ? -1 : rovingTabIndex}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onRovingFocus(SUMMARY_ID);
      }}
      onBlur={roving.onBlur}
      onKeyDownCapture={roving.onKeyDownCapture}
      onKeyDown={onKeyDown}
    >
      <div className={styles.flipInner} data-face={face}>
        <div className={`${styles.face} ${styles.faceSummary} ${styles.sumFront}`} data-on={face === "summary"} inert={face !== "summary"}>
          <div className={styles.sumBody}>{body}</div>
          <div className={styles.sfLine}>
            <div className={styles.sumAsOf}>{asOf}</div>
            {view.map && (
              <button type="button" className={styles.flipBtn} data-card-face-button="map" onClick={() => changeFace("map")} aria-pressed={false} aria-label="대지 요약 지도 보기">
                지도 ↻
              </button>
            )}
          </div>
        </div>
        <div className={`${styles.face} ${styles.faceMap}`} data-on={face === "map"} inert={face !== "map"}>
          {view.map && (face === "map" || seen) && (
            <div className={styles.mf}>
              <header className={styles.mfHead}>
                <span className={styles.dot} style={{ background: "#16181d" }} />
                <h2 className={styles.mfTitle} style={{ flex: "none" }}>대지 요약</h2>
                <span className={styles.mfKey} style={{ flex: "0 1 auto" }} title={view.address}>
                  <b>{view.address}</b>
                </span>
                <span style={{ marginLeft: "auto" }} />
                <button type="button" className={styles.mfBtn} data-card-face-button="summary" onClick={() => changeFace("summary")} aria-pressed aria-label="대지 요약 보기" title="요약 보기">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
                    <path d="M3 12a9 9 0 1 0 3-6.7" />
                    <path d="M3 4v5h5" />
                  </svg>
                </button>
              </header>
              <div className={styles.mfMap}>
                <div className={styles.stage} aria-hidden>
                  <MapBox model={view.map} bare legend={false} north={22} credit={false} pad={7} />
                </div>
              </div>
              <footer className={styles.mfFoot} title={`${view.asOfLine} · 배경지도 ${OV.sourceCredit}`}>
                <span>
                  {view.asOfLine}
                  {view.incomplete ? ` · 일부 자료 불완전 (타일 ${view.incompleteCount}개)` : ""} · 배경지도 {OV.sourceCredit}
                </span>
              </footer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default memo(SummaryCard);

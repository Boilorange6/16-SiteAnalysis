"use client";

import { useEffect, useState } from "react";
import type { CardFace } from "@/lib/v2/ui/board-state";
import type { SummaryView } from "@/lib/v2/ui/tile-view";
import { OV } from "@/lib/v2/ui/overlay-layout";
import MapBox from "./map-box";
import styles from "./board.module.css";

/**
 * 대지 요약. 기본은 지도 없는 요약면(주소 · 칩 · 사실 3줄 · 기준일/불완전), 뒤집으면 칸 전체가 분석 반경 지도(보드에서 가장 큰 지도).
 * 글자는 지도면에서도 같은 반투명 판 위에만 둔다.
 */
export default function SummaryCard({ view, face, onFace }: { view: SummaryView; face: CardFace; onFace: (f: CardFace) => void }) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (face === "map") setSeen(true);
  }, [face]);
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
        <span className={styles.chip}>{view.area}</span>
        <span className={styles.chip}>{view.zoning}</span>
        <span className={styles.chip}>{view.radius}</span>
      </div>
      <ul className={styles.facts}>
        {view.facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </>
  );
  return (
    <section className={styles.summary} aria-label="대지 요약" data-tile="summary">
      <div className={styles.flipInner} data-face={face}>
        <div className={`${styles.face} ${styles.faceSummary} ${styles.sumFront}`} data-on={face === "summary"} inert={face !== "summary"}>
          <div className={styles.sumBody}>{body}</div>
          <div className={styles.sfLine}>
            <div className={styles.sumAsOf}>{asOf}</div>
            {view.map && (
              <button type="button" className={styles.flipBtn} onClick={() => onFace("map")} aria-pressed={false} aria-label="대지 요약 지도 보기">
                지도 ↻
              </button>
            )}
          </div>
        </div>
        <div className={`${styles.face} ${styles.faceMap}`} data-on={face === "map"} inert={face !== "map"}>
          {view.map && (face === "map" || seen) && (
            <>
              <div className={styles.stage} aria-hidden>
                <MapBox model={view.map} bare legend={false} north={OV.edge + 34 + 8 + 13} credit={false} bottomInset={OV.stripH} />
              </div>
              <div className={`${styles.plate} ${styles.summaryPanel}`}>{body}</div>
              <div className={styles.ovBL}>
                <div className={`${styles.plate} ${styles.summaryAsOf}`}>{asOf}</div>
              </div>
              <div className={styles.ovTR}>
                <button type="button" className={`${styles.plate} ${styles.flipIcon} ${styles.flipIconPlate}`} onClick={() => onFace("summary")} aria-pressed aria-label="대지 요약 보기" title="요약 보기">
                  ↺
                </button>
              </div>
              <div className={styles.srcStrip}>배경지도 {OV.sourceCredit}</div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

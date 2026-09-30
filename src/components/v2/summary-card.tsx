import type { SummaryView } from "@/lib/v2/ui/tile-view";
import MapBox from "./map-box";
import styles from "./board.module.css";

/** 대지 요약: 칸 전체가 분석 반경 지도. 글자는 왼쪽 위 반투명 판 위에 둔다. */
export default function SummaryCard({ view }: { view: SummaryView }) {
  return (
    <section className={styles.summary} aria-label="대지 요약">
      {view.map && (
        <div className={styles.summaryMap} aria-hidden>
          <MapBox model={view.map} bare />
        </div>
      )}
      <div className={styles.summaryPanel}>
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
      </div>
      <div className={styles.summaryFoot}>
        <span>{view.asOfLine}</span>
        {view.incomplete && (
          <span className={`${styles.badge} ${styles.badgeLimit}`} title="일부 타일이 실패했거나 자료가 불완전합니다.">
            일부 자료 불완전 · 타일 {view.incompleteCount}개
          </span>
        )}
      </div>
    </section>
  );
}

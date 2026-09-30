import type { SummaryView } from "@/lib/v2/ui/tile-view";
import styles from "./board.module.css";

/** 대지 요약: 종합 점수 대신 주소·면적·용도지역·사실 3줄·자료 기준일·불완전 배지. */
export default function SummaryCard({ view }: { view: SummaryView }) {
  return (
    <section className={styles.summary} aria-label="대지 요약">
      <div className={styles.summaryMap} aria-hidden />
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

"use client";

import type { ReportLayout } from "@/lib/v2/report/report-doc";
import styles from "./report-mode.module.css";

type LayoutSwitcherProps = { value: ReportLayout; onChange: (layout: ReportLayout) => void; compact?: boolean; pageNumber?: number };
const OPTIONS: Array<{ value: ReportLayout; label: string }> = [
  { value: "map-full", label: "지도 크게" },
  { value: "map-summary", label: "지도 + 요약" },
  { value: "numbers-first", label: "숫자 먼저" },
  { value: "side-by-side", label: "다른 타일과 나란히" },
];

function LayoutPreview({ layout }: { layout: ReportLayout }) {
  return (
    <svg className={styles.layoutPreview} viewBox="0 0 100 56" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="94" height="50" rx="2" fill="#f7f8fa" stroke="currentColor" />
      {layout === "map-full" && <><rect x="8" y="14" width="84" height="32" rx="1" fill="#d9e0ea" /><path d="M8 9h34" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
      {layout === "map-summary" && <><rect x="8" y="14" width="57" height="32" rx="1" fill="#d9e0ea" /><path d="M72 18h17M72 25h13M72 32h16M8 9h28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
      {layout === "numbers-first" && <><rect x="8" y="8" width="25" height="10" rx="1" fill="#d9e0ea" /><rect x="38" y="8" width="25" height="10" rx="1" fill="#d9e0ea" /><rect x="68" y="8" width="24" height="10" rx="1" fill="#d9e0ea" /><rect x="8" y="24" width="84" height="22" rx="1" fill="#d9e0ea" /></>}
      {layout === "side-by-side" && <><rect x="8" y="14" width="39" height="32" rx="1" fill="#d9e0ea" /><rect x="53" y="14" width="39" height="32" rx="1" fill="#d9e0ea" /><path d="M8 9h22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
    </svg>
  );
}

export default function LayoutSwitcher({ value, onChange, compact = false, pageNumber }: LayoutSwitcherProps) {
  return (
    <section className={`${styles.layoutSwitcher} ${compact ? styles.layoutSwitcherCompact : ""}`} aria-label="페이지 레이아웃">
      {pageNumber !== undefined ? <div className={styles.popoverHeader}><h2>레이아웃 · {pageNumber}쪽</h2></div> : !compact && <>
        <div className={styles.drawerHeader}><div><p className={styles.eyebrow}>페이지 배치</p><h2>레이아웃</h2></div></div>
      </>}
      <div className={styles.layoutOptions}>
        {OPTIONS.map((option) => <button key={option.value} type="button" className={value === option.value ? styles.layoutOptionActive : styles.layoutOption} aria-pressed={value === option.value} onClick={() => onChange(option.value)}><LayoutPreview layout={option.value} /><span>{option.label}</span></button>)}
      </div>
    </section>
  );
}

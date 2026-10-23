"use client";

import type { ReportLayout } from "@/lib/v2/report/report-doc";
import styles from "./report-mode.module.css";
import SidePanelHeader from "./side-panel-header";

type LayoutSwitcherProps = { value: ReportLayout; onChange: (layout: ReportLayout) => void; compact?: boolean; pageNumber?: number; opacity: number; onOpacityChange: (value: number) => void; onClose: () => void };
const OPTIONS: Array<{ value: ReportLayout; label: string }> = [
  { value: "map-full", label: "지도 크게" },
  { value: "map-summary", label: "지도 + 요약" },
  { value: "numbers-first", label: "숫자 먼저" },
  { value: "side-by-side", label: "다른 타일과 나란히" },
];

function LayoutPreview({ layout }: { layout: ReportLayout }) {
  return (
    <svg className={styles.layoutPreview} viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="114" height="84" rx="2" fill="#f7f8fa" stroke="currentColor" />
      {layout === "map-full" && <><rect x="8" y="22" width="104" height="57" rx="1" fill="#d9e0ea" /><path d="M8 14h42" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
      {layout === "map-summary" && <><rect x="8" y="22" width="70" height="57" rx="1" fill="#d9e0ea" /><path d="M88 28h20M88 38h16M88 48h19M8 14h35" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
      {layout === "numbers-first" && <><rect x="8" y="10" width="29" height="15" rx="1" fill="#d9e0ea" /><rect x="45" y="10" width="29" height="15" rx="1" fill="#d9e0ea" /><rect x="82" y="10" width="30" height="15" rx="1" fill="#d9e0ea" /><rect x="8" y="34" width="104" height="45" rx="1" fill="#d9e0ea" /></>}
      {layout === "side-by-side" && <><rect x="8" y="22" width="49" height="57" rx="1" fill="#d9e0ea" /><rect x="63" y="22" width="49" height="57" rx="1" fill="#d9e0ea" /><path d="M8 14h27" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
    </svg>
  );
}

export default function LayoutSwitcher({ value, onChange, compact = false, pageNumber, opacity, onOpacityChange, onClose }: LayoutSwitcherProps) {
  return (
    <section className={`${styles.layoutSwitcher} ${compact ? styles.layoutSwitcherCompact : ""}`} aria-label="페이지 레이아웃">
      <SidePanelHeader title="레이아웃" context={pageNumber ? `${pageNumber}쪽` : undefined} opacity={opacity} onOpacityChange={onOpacityChange} onClose={onClose} closeLabel="레이아웃 창 닫기" />
      <div className={`${styles.layoutOptions} ${styles.sidePanelContent}`}>
        {OPTIONS.map((option) => <button key={option.value} type="button" className={value === option.value ? styles.layoutOptionActive : styles.layoutOption} aria-pressed={value === option.value} onClick={() => onChange(option.value)}><span className={styles.layoutOptionThumb}><LayoutPreview layout={option.value} /></span><span className={styles.layoutOptionName}>{option.label}</span></button>)}
      </div>
    </section>
  );
}

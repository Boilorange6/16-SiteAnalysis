"use client";

import type { ReportLayout } from "@/lib/v2/report/report-doc";
import styles from "./report-mode.module.css";

type LayoutSwitcherProps = { value: ReportLayout; onChange: (layout: ReportLayout) => void };
const OPTIONS: Array<{ value: ReportLayout; label: string; icon: string }> = [
  { value: "map-full", label: "지도 크게", icon: "▰" },
  { value: "map-summary", label: "지도 + 요약", icon: "▤" },
  { value: "numbers-first", label: "숫자 먼저", icon: "▥" },
  { value: "side-by-side", label: "다른 타일과 나란히", icon: "▦" },
];

export default function LayoutSwitcher({ value, onChange }: LayoutSwitcherProps) {
  return (
    <section className={styles.layoutSwitcher} aria-label="페이지 레이아웃">
      <div className={styles.drawerHeader}><div><p className={styles.eyebrow}>페이지 배치</p><h2>레이아웃</h2></div></div>
      <p className={styles.helper}>지도 위치와 확대는 그대로 두고 배치만 바꿉니다.</p>
      <div className={styles.layoutOptions}>
        {OPTIONS.map((option) => <button key={option.value} type="button" className={value === option.value ? styles.layoutOptionActive : styles.layoutOption} aria-pressed={value === option.value} onClick={() => onChange(option.value)}><span className={styles.layoutIcon} aria-hidden="true">{option.icon}</span><span>{option.label}</span></button>)}
      </div>
    </section>
  );
}

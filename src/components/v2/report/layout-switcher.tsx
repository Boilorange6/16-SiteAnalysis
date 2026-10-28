"use client";

import type { ReportLayout } from "@/lib/v2/report/report-doc";
import { reportGridChoices, reportLayoutDecision, type ReportGrid, type ReportLayoutPageKind } from "@/lib/v2/report/report-layout";
import styles from "./report-mode.module.css";
import SidePanelHeader from "./side-panel-header";

export type DeletedLayoutItem = { id: string; label: string; onRestore: () => void };

type LayoutSwitcherProps = {
  value: ReportLayout;
  onChange: (layout: ReportLayout) => void;
  compact?: boolean;
  pageNumber?: number;
  opacity: number;
  onOpacityChange: (value: number) => void;
  onClose: () => void;
  pageKind?: ReportLayoutPageKind;
  hasMap?: boolean;
  hasSummary?: boolean;
  hasCharts?: boolean;
  grid?: ReportGrid;
  onGridChange?: (grid: ReportGrid) => void;
  renderSignatures?: Partial<Record<ReportLayout, string>>;
  deletedItems?: readonly DeletedLayoutItem[];
};

function LayoutPreview({ layout, grid }: { layout: ReportLayout; grid?: ReportGrid }) {
  if (grid) {
    const columns = grid === "3x1" ? 3 : 2;
    const rows = grid === "3x2" ? 3 : grid === "3x1" ? 1 : 2;
    return <svg className={styles.layoutPreview} viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="114" height="84" rx="2" fill="#f7f8fa" stroke="currentColor" />
      {Array.from({ length: columns * rows }, (_, index) => { const x = 8 + (index % columns) * (104 / columns); const y = 10 + Math.floor(index / columns) * (70 / rows); return <rect key={index} x={x} y={y} width={100 / columns} height={62 / rows} rx="1" fill="#d9e0ea" />; })}
    </svg>;
  }
  return (
    <svg className={styles.layoutPreview} viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="114" height="84" rx="2" fill="#f7f8fa" stroke="currentColor" />
      {layout === "map-full" && <><rect x="8" y="22" width="104" height="57" rx="1" fill="#d9e0ea" /><path d="M8 14h42" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
      {layout === "map-summary" && <><rect x="8" y="22" width="70" height="57" rx="1" fill="#d9e0ea" /><path d="M88 28h20M88 38h16M88 48h19M8 14h35" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
      {layout === "map-charts" && <><rect x="8" y="22" width="70" height="57" rx="1" fill="#d9e0ea" /><rect x="88" y="30" width="8" height="30" rx="1" fill="#9db3d4" /><rect x="100" y="42" width="8" height="18" rx="1" fill="#9db3d4" /><path d="M86 66h24M8 14h35" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></>}
      {layout === "numbers-first" && <><rect x="8" y="10" width="29" height="15" rx="1" fill="#d9e0ea" /><rect x="45" y="10" width="29" height="15" rx="1" fill="#d9e0ea" /><rect x="82" y="10" width="30" height="15" rx="1" fill="#d9e0ea" /><rect x="8" y="34" width="104" height="45" rx="1" fill="#d9e0ea" /></>}
    </svg>
  );
}

export default function LayoutSwitcher({ value, onChange, compact = false, pageNumber, opacity, onOpacityChange, onClose, pageKind = "tile", hasMap = true, hasSummary = true, hasCharts = false, grid = "2x2", onGridChange, renderSignatures, deletedItems = [] }: LayoutSwitcherProps) {
  const decision = reportLayoutDecision({ pageKind, hasMap, hasSummary, hasCharts, renderSignatures });
  // 그래프 자료를 잃은 map-charts 쪽은 「지도 + 요약」 내용으로 그려지므로 그 버튼이 눌린 것으로 보인다.
  const activeLayout = value === "side-by-side" || (value === "map-charts" && !hasCharts) ? "map-summary" : value;
  const gridChoices = decision.gridChoices.length > 0 ? decision.gridChoices : reportGridChoices();
  return (
    <section className={`${styles.layoutSwitcher} ${compact ? styles.layoutSwitcherCompact : ""}`} aria-label="페이지 레이아웃">
      <SidePanelHeader title="레이아웃" context={pageNumber ? `${pageNumber}쪽` : undefined} opacity={opacity} onOpacityChange={onOpacityChange} onClose={onClose} closeLabel="레이아웃 창 닫기" />
      <div className={styles.layoutPageKind} aria-label="페이지 종류"><span>페이지 종류</span><strong>{decision.pageLabel}</strong></div>
      {decision.gridChoices.length > 0 ? (
        <div className={`${styles.layoutOptions} ${styles.sidePanelContent}`} aria-label="조판 칸 수">
          {gridChoices.map((option) => <button key={option.value} type="button" className={grid === option.value ? styles.layoutOptionActive : styles.layoutOption} aria-pressed={grid === option.value} onClick={() => onGridChange?.(option.value)}><span className={styles.layoutOptionThumb}><LayoutPreview layout="map-summary" grid={option.value} /></span><span className={styles.layoutOptionName}>{option.label}</span></button>)}
        </div>
      ) : (
        <div className={`${styles.layoutOptions} ${styles.sidePanelContent}`}>
          {decision.choices.map((option) => <button key={option.value} type="button" className={activeLayout === option.value ? styles.layoutOptionActive : styles.layoutOption} aria-pressed={activeLayout === option.value} disabled={option.disabled} title={option.tooltip} onClick={() => onChange(option.value)}><span className={styles.layoutOptionThumb}><LayoutPreview layout={option.value} /></span><span className={styles.layoutOptionName}>{option.label}</span></button>)}
        </div>
      )}
      {deletedItems.length > 0 && <div className={styles.deletedElementsRow} aria-label="지운 요소"><span className={styles.deletedElementsLabel}>지운 요소</span><div className={styles.deletedElementsList}>{deletedItems.map((item) => <button key={item.id} type="button" className={styles.deletedElementsRestore} onClick={item.onRestore} title={`${item.label} 되살리기`}>{item.label} 되살리기</button>)}</div></div>}
    </section>
  );
}

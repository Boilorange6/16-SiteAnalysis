"use client";

import type { ReportLayout } from "@/lib/v2/report/report-doc";
import { reportGridChoices, reportLayoutDecision, resolveReportLayout, type ReportGrid, type ReportLayoutPageKind } from "@/lib/v2/report/report-layout";
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
  figure?: boolean;
  hasCharts?: boolean;
  grid?: ReportGrid;
  onGridChange?: (grid: ReportGrid) => void;
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
      {/* ① 지도 + 숫자: 전체 폭 지도 + 왼쪽 위 제목 칩과 숫자 카드, 맨 아래 각주 띠 */}
      {layout === "map-key" && <><rect x="8" y="10" width="104" height="66" rx="1" fill="#d9e0ea" /><rect x="12" y="13" width="30" height="7" rx="2" fill="#fff" stroke="currentColor" strokeWidth=".8" /><rect x="12" y="24" width="34" height="27" rx="2" fill="#fff" stroke="currentColor" strokeWidth=".8" /><path d="M16 31h16M16 38h22M16 45h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><rect x="8" y="79" width="104" height="4" rx="1" fill="#c9ced6" /></>}
      {/* ② 지도 + 그래프: 지도 틀 + 오른쪽 분석 열(숫자 카드 · 그래프 카드 둘 · 해석 한 줄) */}
      {layout === "map-charts" && <><rect x="8" y="10" width="70" height="66" rx="1" fill="#d9e0ea" /><rect x="78" y="10" width="34" height="66" fill="#ece9e1" /><rect x="12" y="13" width="26" height="7" rx="2" fill="#fff" stroke="currentColor" strokeWidth=".8" /><rect x="81" y="13" width="28" height="15" rx="2" fill="#fff" stroke="currentColor" strokeWidth=".8" /><path d="M84 19h14M84 24h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><rect x="81" y="31" width="28" height="18" rx="2" fill="#fff" stroke="currentColor" strokeWidth=".8" /><path d="M84 37h12M84 42h18M84 46h8" stroke="#9db3d4" strokeWidth="2.4" strokeLinecap="round" /><rect x="81" y="52" width="28" height="15" rx="2" fill="#fff" stroke="currentColor" strokeWidth=".8" /><path d="M85 64v-4M89 64v-8M93 64v-6M97 64v-10" stroke="#9db3d4" strokeWidth="3" /><path d="M81 71h28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><rect x="8" y="79" width="104" height="4" rx="1" fill="#c9ced6" /></>}
      {layout === "numbers-first" && <><rect x="8" y="10" width="29" height="15" rx="1" fill="#d9e0ea" /><rect x="45" y="10" width="29" height="15" rx="1" fill="#d9e0ea" /><rect x="82" y="10" width="30" height="15" rx="1" fill="#d9e0ea" /><rect x="8" y="34" width="104" height="45" rx="1" fill="#d9e0ea" /></>}
    </svg>
  );
}

export default function LayoutSwitcher({ value, onChange, compact = false, pageNumber, opacity, onOpacityChange, onClose, pageKind = "tile", hasMap = true, figure = false, hasCharts = false, grid = "2x2", onGridChange, deletedItems = [] }: LayoutSwitcherProps) {
  const decision = reportLayoutDecision({ pageKind, hasMap, figure, hasCharts });
  // 그리는 단계와 같은 판정: 그래프 자료를 잃은 map-charts·옛 값은 「지도 + 숫자」로 그려지므로 그 버튼이 눌린 것으로 보인다.
  const activeLayout = pageKind === "tile" ? resolveReportLayout(value, { hasMap, figure, hasCharts }) : value;
  const gridChoices = decision.gridChoices.length > 0 ? decision.gridChoices : reportGridChoices();
  return (
    <section className={`${styles.layoutSwitcher} ${compact ? styles.layoutSwitcherCompact : ""}`} aria-label="페이지 레이아웃">
      <SidePanelHeader title="레이아웃" context={pageNumber ? `${pageNumber}쪽` : undefined} opacity={opacity} onOpacityChange={onOpacityChange} onClose={onClose} closeLabel="레이아웃 창 닫기" />
      <div className={styles.layoutPageKind} aria-label="페이지 종류"><span>페이지 종류</span><strong>{decision.pageLabel}</strong></div>
      {decision.gridChoices.length > 0 ? (
        <div className={`${styles.layoutOptions} ${styles.sidePanelContent}`} aria-label="조판 칸 수">
          {gridChoices.map((option) => <button key={option.value} type="button" className={grid === option.value ? styles.layoutOptionActive : styles.layoutOption} aria-pressed={grid === option.value} onClick={() => onGridChange?.(option.value)}><span className={styles.layoutOptionThumb}><LayoutPreview layout="map-key" grid={option.value} /></span><span className={styles.layoutOptionName}>{option.label}</span></button>)}
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

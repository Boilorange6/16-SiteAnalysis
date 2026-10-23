"use client";

import styles from "./report-mode.module.css";
import SidePanelHeader from "./side-panel-header";

export type PageAddKind = "cover" | "tile" | "compare" | "sources" | "blank";

type DrawerPagesProps = {
  open: boolean;
  afterPage: number | null;
  hasLegacy: boolean;
  onAdd: (kind: PageAddKind) => void;
  onRecommended: () => void;
  onLegacy: () => void;
  onClose: () => void;
  opacity: number;
  onOpacityChange: (value: number) => void;
};

const PAGE_CARDS: Array<{ kind: PageAddKind; title: string }> = [
  { kind: "cover", title: "표지" },
  { kind: "tile", title: "분석 타일 한 장" },
  { kind: "compare", title: "여러 타일 비교" },
  { kind: "sources", title: "출처·기준일" },
  { kind: "blank", title: "빈 페이지" },
];

function PageCardIcon({ kind }: { kind: PageAddKind }) {
  const stroke = "#676c76";
  const cell = "#d9dce2";
  return (
    <svg viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      {kind === "cover" && <>
        <rect x="5" y="5" width="110" height="80" rx="4" fill={cell} stroke={stroke} />
        <path d="M18 61h64M18 70h42" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === "tile" && <>
        <rect x="5" y="5" width="66" height="80" rx="3" fill={cell} stroke={stroke} />
        <path d="M82 20h25M82 32h19M82 44h23" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === "compare" && <>
        {[0, 1, 2, 3].map((index) => <rect key={index} x={5 + (index % 2) * 56} y={5 + Math.floor(index / 2) * 42} width="50" height="36" rx="2" fill={cell} stroke={stroke} />)}
      </>}
      {kind === "sources" && <>
        <path d="M15 23h90M15 42h90M15 61h58" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        <circle cx="96" cy="61" r="7" fill={cell} stroke={stroke} />
      </>}
      {kind === "blank" && <rect x="5" y="5" width="110" height="80" rx="4" fill="none" stroke={stroke} strokeDasharray="7 5" />}
    </svg>
  );
}

function RestartIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></svg>;
}

function ImportIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></svg>;
}

export default function DrawerPages({ open, afterPage, hasLegacy, onAdd, onRecommended, onLegacy, onClose, opacity, onOpacityChange }: DrawerPagesProps) {
  if (!open) return null;
  return (
    <section className={styles.drawer} aria-label="페이지 추가">
      <SidePanelHeader title="페이지 추가" context={afterPage ? `${afterPage}쪽 뒤에` : "맨 뒤에"} opacity={opacity} onOpacityChange={onOpacityChange} onClose={onClose} closeLabel="페이지 추가 창 닫기" />
      <div className={`${styles.pageCardGrid} ${styles.sidePanelContent}`}>
        {PAGE_CARDS.map((card) => (
          <button key={card.kind} type="button" className={`${styles.pageCard} ${card.kind === "blank" ? styles.pageCardBlank : ""}`} onClick={() => onAdd(card.kind)} aria-label={`${card.title} 추가`}>
            <span className={styles.pageCardIcon}><PageCardIcon kind={card.kind} /></span>
            <strong className={styles.pageCardCopy}>{card.title}</strong>
          </button>
        ))}
      </div>
      <div className={styles.drawerFooter}>
        <button type="button" className={styles.secondaryAction} onClick={onRecommended}><RestartIcon />추천 구성으로 다시 시작</button>
        {hasLegacy && <button type="button" className={styles.secondaryAction} onClick={onLegacy}><ImportIcon />이전 보고서 불러오기</button>}
      </div>
    </section>
  );
}

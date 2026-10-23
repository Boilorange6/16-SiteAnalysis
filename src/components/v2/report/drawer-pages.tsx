"use client";

import styles from "./report-mode.module.css";

export type PageAddKind = "cover" | "tile" | "compare" | "sources" | "blank";

type DrawerPagesProps = {
  open: boolean;
  afterPage: number | null;
  hasLegacy: boolean;
  onAdd: (kind: PageAddKind) => void;
  onRecommended: () => void;
  onLegacy: () => void;
  onClose: () => void;
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
    <svg viewBox="0 0 160 90" aria-hidden="true" focusable="false">
      {kind === "cover" && <>
        <rect x="5" y="5" width="150" height="80" rx="4" fill={cell} stroke={stroke} />
        <path d="M20 61h88M20 70h58" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === "tile" && <>
        <rect x="5" y="5" width="94" height="80" rx="3" fill={cell} stroke={stroke} />
        <path d="M113 20h30M113 32h22M113 44h28" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
      </>}
      {kind === "compare" && <>
        {[0, 1, 2, 3].map((index) => <rect key={index} x={5 + (index % 2) * 78} y={5 + Math.floor(index / 2) * 42} width="72" height="36" rx="2" fill={cell} stroke={stroke} />)}
      </>}
      {kind === "sources" && <>
        <path d="M18 23h124M18 42h124M18 61h82" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
        <circle cx="128" cy="61" r="7" fill={cell} stroke={stroke} />
      </>}
      {kind === "blank" && <rect x="5" y="5" width="150" height="80" rx="4" fill="none" stroke={stroke} strokeDasharray="7 5" />}
    </svg>
  );
}

export default function DrawerPages({ open, afterPage, hasLegacy, onAdd, onRecommended, onLegacy, onClose }: DrawerPagesProps) {
  if (!open) return null;
  return (
    <section className={styles.drawer} aria-label="페이지 추가">
      <div className={styles.drawerHeader}>
        <div className={styles.drawerHeaderTitle}><h2>페이지 추가</h2><span className={styles.selectionPill}>{afterPage ? `${afterPage}쪽 뒤에` : "맨 뒤에"}</span></div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="서랍 닫기">×</button>
      </div>
      <div className={styles.pageCardGrid}>
        {PAGE_CARDS.map((card) => (
          <button key={card.kind} type="button" className={`${styles.pageCard} ${card.kind === "blank" ? styles.pageCardBlank : ""}`} onClick={() => onAdd(card.kind)}>
            <span className={styles.pageCardIcon}><PageCardIcon kind={card.kind} /></span>
            <strong className={styles.pageCardCopy}>{card.title}</strong>
          </button>
        ))}
      </div>
      <div className={styles.drawerSection}>
        <button type="button" className={styles.drawerLinkAction} onClick={onRecommended}>추천 구성으로 다시 시작</button>
        {hasLegacy && <button type="button" className={styles.drawerLinkAction} onClick={onLegacy}>이전 보고서 불러오기</button>}
      </div>
    </section>
  );
}

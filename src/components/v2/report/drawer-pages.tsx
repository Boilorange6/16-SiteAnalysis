"use client";

import styles from "./report-mode.module.css";

export type PageAddKind = "cover" | "tile" | "compare" | "sources" | "blank";

type DrawerPagesProps = {
  open: boolean;
  hasLegacy: boolean;
  onAdd: (kind: PageAddKind) => void;
  onRecommended: () => void;
  onLegacy: () => void;
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
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {kind === "cover" && <>
        <rect x="5" y="5" width="22" height="22" rx="2" fill={cell} stroke={stroke} />
        <path d="M8 20h16M8 23h10" fill="none" stroke={stroke} strokeLinecap="round" />
      </>}
      {kind === "tile" && <>
        <rect x="5" y="5" width="9" height="9" fill={cell} stroke={stroke} />
        <rect x="18" y="5" width="9" height="9" fill={cell} stroke={stroke} />
        <rect x="5" y="18" width="9" height="9" fill={cell} stroke={stroke} />
        <rect x="18" y="18" width="9" height="9" fill={cell} stroke={stroke} />
      </>}
      {kind === "compare" && <>
        <rect x="5" y="5" width="6" height="9" fill={cell} stroke={stroke} />
        <rect x="13" y="5" width="6" height="9" fill={cell} stroke={stroke} />
        <rect x="21" y="5" width="6" height="9" fill={cell} stroke={stroke} />
        <rect x="5" y="18" width="6" height="9" fill={cell} stroke={stroke} />
        <rect x="13" y="18" width="6" height="9" fill={cell} stroke={stroke} />
        <rect x="21" y="18" width="6" height="9" fill={cell} stroke={stroke} />
      </>}
      {kind === "sources" && <>
        <path d="M7 8h18M7 15h18M7 22h12" fill="none" stroke={stroke} strokeLinecap="round" />
        <circle cx="25" cy="22" r="2" fill={cell} stroke={stroke} />
      </>}
      {kind === "blank" && <rect x="6" y="4" width="20" height="24" rx="2" fill="none" stroke={stroke} />}
    </svg>
  );
}

export default function DrawerPages({ open, hasLegacy, onAdd, onRecommended, onLegacy }: DrawerPagesProps) {
  if (!open) return null;
  return (
    <section className={styles.drawer} aria-label="페이지 추가">
      <div className={styles.drawerHeader}>
        <div>
          <h2>페이지</h2>
        </div>
        <span className={styles.drawerHint}>선택한 페이지 뒤에 추가</span>
      </div>
      <div className={styles.pageCardGrid}>
        {PAGE_CARDS.map((card) => (
          <button key={card.kind} type="button" className={styles.pageCard} onClick={() => onAdd(card.kind)}>
            <span className={styles.pageCardIcon}><PageCardIcon kind={card.kind} /></span>
            <span className={styles.pageCardCopy}>
              <strong>{card.title}</strong>
            </span>
            <span className={styles.pageCardPlus} aria-hidden="true">＋</span>
          </button>
        ))}
      </div>
      <div className={styles.drawerSection}>
        <p className={styles.sectionLabel}>빠르게 시작</p>
        <button type="button" className={styles.drawerAction} onClick={onRecommended}>추천 구성으로 시작 <span>→</span></button>
        {hasLegacy && <button type="button" className={styles.drawerAction} onClick={onLegacy}>이전 보고서 불러오기 <span>↥</span></button>}
      </div>
    </section>
  );
}

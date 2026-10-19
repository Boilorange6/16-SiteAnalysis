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

const PAGE_CARDS: Array<{ kind: PageAddKind; title: string; description: string; icon: string }> = [
  { kind: "cover", title: "표지", description: "주소·면적·분석일을 보여 줍니다", icon: "▱" },
  { kind: "tile", title: "분석 타일 한 장", description: "한 타일을 크게 배치합니다", icon: "▦" },
  { kind: "compare", title: "여러 타일 비교", description: "2×2·3×2·3×1로 나란히 봅니다", icon: "▥" },
  { kind: "sources", title: "출처·기준일", description: "사용한 자료와 기준일을 정리합니다", icon: "≡" },
  { kind: "blank", title: "빈 페이지", description: "직접 구성할 빈 페이지입니다", icon: "□" },
];

export default function DrawerPages({ open, hasLegacy, onAdd, onRecommended, onLegacy }: DrawerPagesProps) {
  if (!open) return null;
  return (
    <section className={styles.drawer} aria-label="페이지 추가">
      <div className={styles.drawerHeader}>
        <div>
          <p className={styles.eyebrow}>보고서 구성</p>
          <h2>페이지</h2>
        </div>
        <span className={styles.drawerHint}>선택한 페이지 뒤에 추가</span>
      </div>
      <div className={styles.pageCardGrid}>
        {PAGE_CARDS.map((card) => (
          <button key={card.kind} type="button" className={styles.pageCard} onClick={() => onAdd(card.kind)}>
            <span className={styles.pageCardIcon} aria-hidden="true">{card.icon}</span>
            <span className={styles.pageCardCopy}>
              <strong>{card.title}</strong>
              <span>{card.description}</span>
            </span>
            <span className={styles.pageCardPlus} aria-hidden="true">＋</span>
          </button>
        ))}
      </div>
      <div className={styles.drawerSection}>
        <p className={styles.sectionLabel}>빠르게 시작</p>
        <button type="button" className={styles.drawerAction} onClick={onRecommended}>추천 구성으로 시작 <span>→</span></button>
        {hasLegacy && <button type="button" className={styles.drawerAction} onClick={onLegacy}>이전 보고서 구성 불러오기 <span>↥</span></button>}
      </div>
    </section>
  );
}

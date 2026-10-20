"use client";

import { useMemo, useState } from "react";
import type { ReportDoc } from "@/lib/v2/report/report-doc";
import { pagesUsingTile } from "@/lib/v2/ui/report-mode-logic";
import type { TileView } from "@/lib/v2/ui/tile-view";
import styles from "./report-mode.module.css";

type DrawerTilesProps = {
  open: boolean;
  doc: ReportDoc;
  views: ReadonlyMap<string, TileView>;
  mode: "single" | "compare";
  compareGrid: "2x2" | "3x2" | "3x1";
  compareSelected: readonly string[];
  onCompareGrid: (grid: "2x2" | "3x2" | "3x1") => void;
  onAdd: (tileId: string) => void;
  onToggleCompare: (tileId: string) => void;
  onCreateCompare: () => void;
  onCancelCompare: () => void;
};

const CATEGORIES = ["전체", "분석", "도판", "시뮬레이션"] as const;

export default function DrawerTiles({ open, doc, views, mode, compareGrid, compareSelected, onCompareGrid, onAdd, onToggleCompare, onCreateCompare, onCancelCompare }: DrawerTilesProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("전체");
  const items = useMemo(() => [...views.values()]
    .filter((view) => view.tileId && view.code !== "STACK" && view.code !== "SHEET")
    .filter((view) => category === "전체" || view.kindLabel === category)
    .filter((view) => `${view.title} ${view.code}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => a.code.localeCompare(b.code, "ko")), [category, query, views]);
  const compareLimit = compareGrid === "3x2" ? 6 : compareGrid === "3x1" ? 3 : 4;
  const canCreateCompare = compareSelected.length >= 2 && compareSelected.length <= compareLimit;
  if (!open) return null;
  return (
    <section className={styles.drawer} aria-label="분석 타일 추가">
      <div className={styles.drawerHeader}>
        <div>
          <h2>분석 타일</h2>
        </div>
        {mode === "compare" && <span className={styles.selectionPill}>{compareSelected.length}개 선택</span>}
      </div>
      <label className={styles.searchBox}>
        <span className={styles.srOnly}>타일 검색</span>
        <span aria-hidden="true">⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="타일 이름이나 코드 검색" />
      </label>
      <div className={styles.chipRow} aria-label="타일 분류">
        {CATEGORIES.map((item) => <button key={item} type="button" className={`${styles.filterChip} ${category === item ? styles.filterChipActive : ""}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      {mode === "compare" && <div className={styles.compareGridChoices} aria-label="비교 칸 구성"><span className={styles.sectionLabel}>칸 구성</span>{([{ value: "2x2", label: "2×2 · 4칸" }, { value: "3x2", label: "3×2 · 6칸" }, { value: "3x1", label: "3×1 · 3칸" }] as const).map((option) => <button key={option.value} type="button" className={compareGrid === option.value ? styles.filterChipActive : styles.filterChip} aria-pressed={compareGrid === option.value} onClick={() => onCompareGrid(option.value)}>{option.label}</button>)}</div>}
      <div className={styles.tileList}>
        {items.map((view) => {
          const used = pagesUsingTile(doc, view.tileId);
          const checked = compareSelected.includes(view.tileId);
          return (
            <div
              className={`${styles.tileRow} ${checked ? styles.tileRowSelected : ""}`}
              key={view.tileId}
              draggable={mode === "single"}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("text/report-tile", view.tileId);
              }}
            >
              <span className={styles.tileDot} style={{ background: view.color }} aria-hidden="true" />
              {mode === "compare" ? (
                <label className={styles.tileRowButton} title={view.title}>
                  <input type="checkbox" checked={checked} aria-label={`${view.title} 비교에 포함`} disabled={!checked && compareSelected.length >= compareLimit} onChange={() => onToggleCompare(view.tileId)} />
                  <span className={styles.tileRowCopy}><strong>{view.title}</strong><span>{view.code} · {view.kindLabel}</span></span>
                </label>
              ) : (
                <button type="button" className={styles.tileRowButton} title={view.title} aria-label={`${view.title} 추가`} onClick={() => onAdd(view.tileId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onAdd(view.tileId); } }}>
                  <span className={styles.tileRowCopy}><strong>{view.title}</strong><span>{view.code} · {view.kindLabel}</span></span>
                  <span className={styles.tileMetric}>{view.headline?.value ?? "결과 없음"}</span>
                  <span className={styles.tileAdd} aria-hidden="true">＋</span>
                </button>
              )}
              {used.length > 0 && <span className={styles.tileUsed}>{used.join("·")}쪽에 있음</span>}
            </div>
          );
        })}
        {items.length === 0 && <p className={styles.emptyHint}>조건에 맞는 타일이 없습니다.</p>}
      </div>
      {mode === "compare" && (
        <div className={styles.compareActions}>
          <button type="button" className={styles.secondaryButton} onClick={onCancelCompare}>취소</button>
          <button type="button" className={styles.primaryButton} onClick={onCreateCompare} disabled={!canCreateCompare}>비교 페이지 만들기 · {compareSelected.length}/{compareLimit}</button>
        </div>
      )}
    </section>
  );
}

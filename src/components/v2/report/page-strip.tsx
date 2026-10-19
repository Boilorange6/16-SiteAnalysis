"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReportPage } from "@/lib/v2/report/report-doc";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import { SlideSurface } from "./slide-surface";
import styles from "./report-mode.module.css";

export type PageStripItem = {
  page: ReportPage;
  slide?: PlannedSlide;
  printedCount: number;
};

type PageStripProps = {
  items: readonly PageStripItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, key: "ArrowLeft" | "ArrowRight" | "Home" | "End") => void;
  onDropMove: (id: string, targetIndex: number) => void;
  onAddPage: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  classMap: Record<string, string>;
  exportSelectionMode?: boolean;
  exportPageIds?: ReadonlySet<string>;
  onToggleExportPage?: (id: string) => void;
};

function pageLabel(page: ReportPage, slide?: PlannedSlide): string {
  if (slide?.kind === "tile" || slide?.kind === "sheet") return slide.view.title;
  if (page.kind === "cover") return "표지";
  if (page.kind === "sources") return "출처·기준일";
  if (page.kind === "blank") return "빈 페이지";
  if (page.kind === "compare") return "여러 타일 비교";
  return page.part.type === "single" ? "분석 타일 한 장" : "분석 타일";
}

export default function PageStrip({ items, selectedId, onSelect, onMove, onDropMove, onAddPage, onDuplicate, onDelete, classMap, exportSelectionMode = false, exportPageIds = new Set(), onToggleExportPage }: PageStripProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!openMenuId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const id = openMenuId;
      setOpenMenuId(null);
      window.requestAnimationFrame(() => menuButtonRefs.current.get(id)?.focus());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openMenuId]);

  return (
    <ol className={styles.pageStrip} aria-label="보고서 페이지 순서">
      {items.map((item, index) => {
        const selected = item.page.id === selectedId;
        const slide = item.slide;
        const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            onMove(item.page.id, event.key);
          }
        };
        return (
          <li
            className={styles.pageStripItem}
            key={item.page.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/report-page", item.page.id);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId = event.dataTransfer.getData("text/report-page");
              if (sourceId && sourceId !== item.page.id) onDropMove(sourceId, index);
            }}
          >
            <button
              type="button"
              className={`${styles.pageThumb} ${selected ? styles.pageThumbSelected : ""}`}
              aria-current={selected ? "page" : undefined}
              aria-selected={selected}
              aria-label={`${index + 1}쪽 ${pageLabel(item.page, slide)}`}
              onClick={() => { setOpenMenuId(null); onSelect(item.page.id); }}
              onKeyDown={onKeyDown}
            >
              <span className={styles.pageThumbCanvas}>
                {slide ? <SlideSurface slide={slide} basemap="white" mode="thumb" classMap={classMap} /> : <span className={styles.pageThumbPlaceholder}>미리보기 준비 중</span>}
              </span>
              <span className={styles.pageThumbMeta}>
                <span className={styles.pageNumber}>{index + 1}</span>
                <span className={styles.pageLabel}>{pageLabel(item.page, slide)}</span>
                {item.printedCount > 1 && <span className={styles.pageOverflow}>+{item.printedCount - 1}</span>}
              </span>
            </button>
            {exportSelectionMode && <button
              type="button"
              role="checkbox"
              aria-checked={exportPageIds.has(item.page.id)}
              className={styles.pageExportToggle}
              aria-label={`${index + 1}쪽 내보내기 포함`}
              onClick={(event) => { event.stopPropagation(); onToggleExportPage?.(item.page.id); }}
            >{exportPageIds.has(item.page.id) ? "✓" : ""}</button>}
            {selected && <div className={styles.pageMenuRoot}>
              <button
                type="button"
                className={styles.pageThumbMenuButton}
                ref={(element) => {
                  if (element) menuButtonRefs.current.set(item.page.id, element);
                  else menuButtonRefs.current.delete(item.page.id);
                }}
                aria-label={`${index + 1}쪽 메뉴`}
                aria-haspopup="menu"
                aria-expanded={openMenuId === item.page.id}
                aria-controls={`page-menu-${item.page.id}`}
                title="페이지 메뉴"
                onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === item.page.id ? null : item.page.id); }}
              >⋯</button>
              {openMenuId === item.page.id && <div id={`page-menu-${item.page.id}`} className={styles.pageMenu} role="menu" aria-label={`${index + 1}쪽 작업`}>
                <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); onDuplicate(item.page.id); window.requestAnimationFrame(() => menuButtonRefs.current.get(item.page.id)?.focus()); }}>복제</button>
                <button type="button" role="menuitem" disabled={index === 0} onClick={() => { setOpenMenuId(null); onMove(item.page.id, "ArrowLeft"); window.requestAnimationFrame(() => menuButtonRefs.current.get(item.page.id)?.focus()); }}>앞으로</button>
                <button type="button" role="menuitem" disabled={index === items.length - 1} onClick={() => { setOpenMenuId(null); onMove(item.page.id, "ArrowRight"); window.requestAnimationFrame(() => menuButtonRefs.current.get(item.page.id)?.focus()); }}>뒤로</button>
                <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); onDelete(item.page.id); }}>삭제</button>
              </div>}
            </div>}
          </li>
        );
      })}
      {items.length === 0 && <li className={styles.pageStripEmpty}><button type="button" className={styles.pageStripAdd} onClick={onAddPage}>＋ 페이지</button></li>}
    </ol>
  );
}

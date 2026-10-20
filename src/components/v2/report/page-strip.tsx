"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { pageStripItems, pageStripLabel, type ReportPageStripItem } from "@/lib/v2/report/report-page-strip";
import { SlideSurface } from "./slide-surface";
import styles from "./report-mode.module.css";

export type PageStripItem = ReportPageStripItem;

type PageStripProps = {
  items: readonly PageStripItem[];
  selectedId: string | null;
  selectedSlideKey: string | null;
  onSelect: (id: string, slideKey: string) => void;
  onMove: (id: string, key: "ArrowLeft" | "ArrowRight" | "Home" | "End") => void;
  onDropMove: (id: string, targetId: string) => void;
  onAddPage: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  classMap: Record<string, string>;
  exportSelectionMode?: boolean;
  exportPageIds?: ReadonlySet<string>;
  onToggleExportPage?: (id: string) => void;
};

export { pageStripItems };

export default function PageStrip({ items, selectedId, selectedSlideKey, onSelect, onMove, onDropMove, onAddPage, onDuplicate, onDelete, classMap, exportSelectionMode = false, exportPageIds = new Set(), onToggleExportPage }: PageStripProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastPageIndex = items.reduce((last, item) => Math.max(last, item.pageIndex), -1);

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
      {items.map((item) => {
        const selected = item.page.id === selectedId && (selectedSlideKey ? item.slide.key === selectedSlideKey : item.continuationIndex === 1);
        const slide = item.slide;
        const groupSelected = item.page.id === selectedId;
        const label = pageStripLabel(item);
        const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            onMove(item.page.id, event.key);
          }
        };
        return (
          <li
            className={`${styles.pageStripItem} ${item.continuationIndex > 1 ? styles.pageStripItemContinuation : ""}`}
            key={item.slide.key}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/report-page", item.page.id);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId = event.dataTransfer.getData("text/report-page");
              if (sourceId && sourceId !== item.page.id) onDropMove(sourceId, item.page.id);
            }}
          >
            <button
              type="button"
              className={`${styles.pageThumb} ${selected ? styles.pageThumbSelected : ""}`}
              aria-current={selected ? "page" : undefined}
              aria-selected={selected}
              aria-label={`${item.outputIndex}쪽 ${label}`}
              onClick={() => { setOpenMenuId(null); onSelect(item.page.id, item.slide.key); }}
              onKeyDown={onKeyDown}
            >
              <span className={styles.pageThumbCanvas}>
                {slide ? <SlideSurface slide={slide} basemap="white" mode="thumb" classMap={classMap} /> : <span className={styles.pageThumbPlaceholder}>미리보기 준비 중</span>}
              </span>
              <span className={styles.pageThumbMeta}>
                <span className={styles.pageNumber}>{item.outputIndex}</span>
                <span className={styles.pageLabel}>{label}</span>
              </span>
            </button>
            {exportSelectionMode && <button
              type="button"
              role="checkbox"
              aria-checked={exportPageIds.has(item.page.id)}
              className={styles.pageExportToggle}
              aria-label={`${item.outputIndex}쪽 내보내기 포함`}
              onClick={(event) => { event.stopPropagation(); onToggleExportPage?.(item.page.id); }}
            >{exportPageIds.has(item.page.id) ? "✓" : ""}</button>}
            {groupSelected && item.continuationIndex === 1 && <div className={styles.pageMenuRoot}>
              <button
                type="button"
                className={styles.pageThumbMenuButton}
                ref={(element) => {
                  if (element) menuButtonRefs.current.set(item.page.id, element);
                  else menuButtonRefs.current.delete(item.page.id);
                }}
                aria-label={`${item.outputIndex}쪽 메뉴`}
                aria-haspopup="menu"
                aria-expanded={openMenuId === item.page.id}
                aria-controls={`page-menu-${item.page.id}`}
                title="페이지 메뉴"
                onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === item.page.id ? null : item.page.id); }}
              >⋯</button>
              {openMenuId === item.page.id && <div id={`page-menu-${item.page.id}`} className={styles.pageMenu} role="menu" aria-label={`${item.outputIndex}쪽 작업`}>
                <button type="button" role="menuitem" onClick={() => { setOpenMenuId(null); onDuplicate(item.page.id); window.requestAnimationFrame(() => menuButtonRefs.current.get(item.page.id)?.focus()); }}>복제</button>
                <button type="button" role="menuitem" disabled={item.pageIndex === 0} onClick={() => { setOpenMenuId(null); onMove(item.page.id, "ArrowLeft"); window.requestAnimationFrame(() => menuButtonRefs.current.get(item.page.id)?.focus()); }}>앞으로</button>
                <button type="button" role="menuitem" disabled={item.pageIndex === lastPageIndex} onClick={() => { setOpenMenuId(null); onMove(item.page.id, "ArrowRight"); window.requestAnimationFrame(() => menuButtonRefs.current.get(item.page.id)?.focus()); }}>뒤로</button>
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

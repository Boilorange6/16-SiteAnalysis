"use client";

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { pageStripItems, pageStripLabel, type ReportPageStripItem } from "@/lib/v2/report/report-page-strip";
import { dropMoveIndex, stripKeyIntent, stripNavIndex } from "@/lib/v2/ui/report-mode-logic";
import { SlideSurface } from "./slide-surface";
import styles from "./report-mode.module.css";

export type PageStripItem = ReportPageStripItem;

type PageStripProps = {
  items: readonly PageStripItem[];
  selectedId: string | null;
  selectedSlideKey: string | null;
  onSelect: (id: string, slideKey: string) => void;
  onNavigate: (index: number) => void;
  onReorder: (id: string, key: "ArrowLeft" | "ArrowRight") => void;
  onDropMove: (sourceId: string, to: number) => void;
  onAddPage: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  classMap: Record<string, string>;
  exportSelectionMode?: boolean;
  exportPageIds?: ReadonlySet<string>;
  onToggleExportPage?: (id: string) => void;
};

export { pageStripItems };

type DropAt = { overId: string; side: "before" | "after" };

function dropSide(element: HTMLElement, clientX: number): DropAt["side"] {
  const rect = element.getBoundingClientRect();
  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}

function isPageDrag(event: { dataTransfer: DataTransfer }): boolean {
  return Array.from(event.dataTransfer.types).includes("text/report-page");
}

export default function PageStrip({ items, selectedId, selectedSlideKey, onSelect, onNavigate, onReorder, onDropMove, onAddPage, onDuplicate, onDelete, classMap, exportSelectionMode = false, exportPageIds = new Set(), onToggleExportPage }: PageStripProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<DropAt | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const draggingPageId = useRef<string | null>(null);
  const menuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pageButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastPageIndex = items.reduce((last, item) => Math.max(last, item.pageIndex), -1);
  const pageIds = Array.from(new Set(items.map((item) => item.page.id)));
  const selectedIndex = items.findIndex((item) => item.page.id === selectedId && (selectedSlideKey ? item.slide.key === selectedSlideKey : item.continuationIndex === 1));

  const onStripDragOver = (event: ReactDragEvent<HTMLOListElement>) => {
    if (!isPageDrag(event)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left + 48) event.currentTarget.scrollBy({ left: -16 });
    else if (event.clientX > rect.right - 48) event.currentTarget.scrollBy({ left: 16 });
  };

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
    <ol className={styles.pageStrip} aria-label="보고서 페이지" onDragOver={onStripDragOver} onDragLeave={(event) => {
      if (!isPageDrag(event)) return;
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropAt(null);
    }}>
      {items.map((item) => {
        const selected = item.page.id === selectedId && (selectedSlideKey ? item.slide.key === selectedSlideKey : item.continuationIndex === 1);
        const slide = item.slide;
        const groupSelected = item.page.id === selectedId;
        const label = pageStripLabel(item);
        const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
          const intent = stripKeyIntent(event);
          if (!intent) return;
          event.preventDefault();
          if (intent.kind === "reorder") {
            onReorder(item.page.id, intent.key);
            window.requestAnimationFrame(() => pageButtonRefs.current.get(item.slide.key)?.focus());
            return;
          }
          const nextIndex = stripNavIndex(items.length, selectedIndex, intent.key);
          if (nextIndex === null) return;
          const nextItem = items[nextIndex];
          if (!nextItem) return;
          onNavigate(nextIndex);
          window.requestAnimationFrame(() => pageButtonRefs.current.get(nextItem.slide.key)?.focus());
        };
        return (
          <li
            className={`${styles.pageStripItem} ${item.continuationIndex > 1 ? styles.pageStripItemContinuation : ""}`}
            key={item.slide.key}
            data-dragging={draggingKey === item.slide.key ? "true" : undefined}
            draggable
            onDragStart={(event) => {
              draggingPageId.current = item.page.id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/report-page", item.page.id);
              setDraggingKey(item.slide.key);
            }}
            onDragEnd={() => {
              draggingPageId.current = null;
              setDraggingKey(null);
              setDropAt(null);
            }}
            onDragOver={(event) => {
              if (!isPageDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const sourceId = draggingPageId.current;
              if (!sourceId || sourceId === item.page.id) {
                setDropAt(null);
                return;
              }
              setDropAt({ overId: item.page.id, side: dropSide(event.currentTarget, event.clientX) });
            }}
            onDragLeave={(event) => {
              if (!isPageDrag(event)) return;
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropAt(null);
            }}
            onDrop={(event) => {
              if (!isPageDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              const sourceId = draggingPageId.current;
              const side = dropAt?.overId === item.page.id ? dropAt.side : dropSide(event.currentTarget, event.clientX);
              const to = sourceId ? dropMoveIndex(pageIds, sourceId, item.page.id, side) : null;
              if (sourceId && to !== null) onDropMove(sourceId, to);
              draggingPageId.current = null;
              setDraggingKey(null);
              setDropAt(null);
            }}
          >
            {dropAt?.overId === item.page.id && dropAt.side === "before" && <span className={`${styles.pageDropIndicator} ${styles.pageDropIndicatorBefore}`} aria-hidden="true" />}
            <button
              type="button"
              className={`${styles.pageThumb} ${selected ? styles.pageThumbSelected : ""}`}
              aria-current={selected ? "page" : undefined}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              aria-label={`${item.outputIndex}쪽 ${label}`}
              ref={(element) => {
                if (element) pageButtonRefs.current.set(item.slide.key, element);
                else pageButtonRefs.current.delete(item.slide.key);
              }}
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
            {dropAt?.overId === item.page.id && dropAt.side === "after" && <span className={`${styles.pageDropIndicator} ${styles.pageDropIndicatorAfter}`} aria-hidden="true" />}
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
                <button type="button" role="menuitem" disabled={item.pageIndex === 0} onClick={() => { setOpenMenuId(null); onReorder(item.page.id, "ArrowLeft"); window.requestAnimationFrame(() => menuButtonRefs.current.get(item.page.id)?.focus()); }}>앞으로</button>
                <button type="button" role="menuitem" disabled={item.pageIndex === lastPageIndex} onClick={() => { setOpenMenuId(null); onReorder(item.page.id, "ArrowRight"); window.requestAnimationFrame(() => menuButtonRefs.current.get(item.page.id)?.focus()); }}>뒤로</button>
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

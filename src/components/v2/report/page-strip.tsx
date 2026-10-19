"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
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
};

function pageLabel(page: ReportPage, slide?: PlannedSlide): string {
  if (slide?.kind === "tile" || slide?.kind === "sheet") return slide.view.title;
  if (page.kind === "cover") return "표지";
  if (page.kind === "sources") return "출처·기준일";
  if (page.kind === "blank") return "빈 페이지";
  if (page.kind === "compare") return "여러 타일 비교";
  return page.part.type === "single" ? "분석 타일 한 장" : "분석 타일";
}

export default function PageStrip({ items, selectedId, onSelect, onMove, onDropMove, onAddPage, onDuplicate, onDelete, classMap }: PageStripProps) {
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
              onClick={() => onSelect(item.page.id)}
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
            {selected && (
              <div className={styles.pageActions} aria-label={`${index + 1}쪽 작업`}>
                <button type="button" className={styles.iconButton} onClick={() => onDuplicate(item.page.id)} aria-label="페이지 복제" title="복제">＋</button>
                <button type="button" className={styles.iconButton} onClick={() => onMove(item.page.id, "ArrowLeft")} disabled={index === 0} aria-label="앞으로 보내기" title="앞으로">←</button>
                <button type="button" className={styles.iconButton} onClick={() => onMove(item.page.id, "ArrowRight")} disabled={index === items.length - 1} aria-label="뒤로 보내기" title="뒤로">→</button>
                <button type="button" className={styles.iconButton} onClick={() => onDelete(item.page.id)} aria-label="페이지 삭제" title="삭제">×</button>
              </div>
            )}
          </li>
        );
      })}
      {items.length === 0 && <li className={styles.pageStripEmpty}><button type="button" className={styles.pageStripAdd} onClick={onAddPage}>＋ 페이지</button></li>}
    </ol>
  );
}

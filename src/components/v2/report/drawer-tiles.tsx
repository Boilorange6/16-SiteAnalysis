"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { slideViewport } from "@/lib/v2/ui/map-projection";
import MapFigure from "../map-figure";
import type { ReportDoc } from "@/lib/v2/report/report-doc";
import { pagesUsingTile } from "@/lib/v2/ui/report-mode-logic";
import type { TileView } from "@/lib/v2/ui/tile-view";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import styles from "./report-mode.module.css";
import { SlideSurface } from "./slide-surface";
import SidePanelHeader from "./side-panel-header";

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
  onClose: () => void;
  opacity: number;
  onOpacityChange: (value: number) => void;
  getThumbnailSlide: (tileId: string) => PlannedSlide | undefined;
  classMap: Record<string, string>;
};

const CATEGORIES = ["전체", "분석", "도판", "시뮬레이션"] as const;

const THUMB_W = 160;
const THUMB_H = 120;

/** 지도만 그린다(패널·범례·라벨·배경 타일 없음). 지도가 없는 타일만 슬라이드 축소판으로 대신한다. */
const TileThumbnail = memo(function TileThumbnail({ view, getThumbnailSlide, classMap }: { view: TileView; getThumbnailSlide: (tileId: string) => PlannedSlide | undefined; classMap: Record<string, string> }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const root = host.closest("[data-tile-scroll]");
    // 한 번 보이면 계속 그려 둔다. 스크롤로 벗어날 때마다 지웠다 다시 그리지 않는다.
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting !== true) return;
      setVisible(true);
      observer.disconnect();
    }, { root: root instanceof Element ? root : null, rootMargin: "80px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const [slide, setSlide] = useState<PlannedSlide | undefined>();
  useEffect(() => {
    if (visible && !view.map && !slide) setSlide(getThumbnailSlide(view.tileId));
  }, [getThumbnailSlide, slide, view.map, view.tileId, visible]);
  const map = view.map ?? (slide?.kind === "tile" ? slide.map : null);
  const viewport = useMemo(() => map ? slideViewport(map, undefined, { width: THUMB_W, height: THUMB_H, siteX: 0.5, siteY: 0.5, fill: 0.92 }) : undefined, [map]);
  return <span ref={hostRef} className={styles.tilePreview} data-preview-thumbnail={visible ? "true" : "false"} aria-hidden="true">
    {visible && map && viewport
      ? <MapFigure model={map} width={THUMB_W} height={THUMB_H} basemap="none" layer="white" legend={false} north={false} scale={false} credit={false} showAutomaticLabels={false} viewport={viewport} />
      : slide ? <SlideSurface slide={slide} basemap="white" mode="thumb" classMap={classMap} /> : <span className={styles.tilePreviewPlaceholder} />}
  </span>;
});

export default function DrawerTiles({ open, doc, views, mode, compareGrid, compareSelected, onCompareGrid, onAdd, onToggleCompare, onCreateCompare, onCancelCompare, onClose, opacity, onOpacityChange, getThumbnailSlide, classMap }: DrawerTilesProps) {
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
    <section className={`${styles.drawer} ${styles.tileDrawer}`} aria-label="분석 타일 추가">
      <SidePanelHeader title="분석 타일" context={mode === "compare" ? `${compareSelected.length}개` : `${items.length}`} opacity={opacity} onOpacityChange={onOpacityChange} onClose={onClose} closeLabel="분석 타일 창 닫기" />
      <label className={styles.searchBox}>
        <span className={styles.srOnly}>타일 검색</span>
        <span aria-hidden="true">⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="타일 이름 검색" />
      </label>
      <div className={styles.chipRow} aria-label="타일 분류">
        {CATEGORIES.map((item) => <button key={item} type="button" className={`${styles.filterChip} ${category === item ? styles.filterChipActive : ""}`} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      {mode === "compare" && <div className={styles.compareGridChoices} aria-label="비교 칸 구성"><span className={styles.sectionLabel}>칸 구성</span>{([{ value: "2x2", label: "2×2 · 4칸" }, { value: "3x2", label: "3×2 · 6칸" }, { value: "3x1", label: "3×1 · 3칸" }] as const).map((option) => <button key={option.value} type="button" className={`${styles.filterChip} ${compareGrid === option.value ? styles.filterChipActive : ""}`} aria-pressed={compareGrid === option.value} onClick={() => onCompareGrid(option.value)}>{option.label}</button>)}</div>}
      <div className={`${styles.tileList} ${styles.sidePanelContent}`} data-tile-scroll>
        {items.map((view) => {
          const used = pagesUsingTile(doc, view.tileId);
          const checked = compareSelected.includes(view.tileId);
          return (
            <div
              className={`${styles.tileCard} ${checked ? styles.tileCardSelected : ""}`}
              key={view.tileId}
              draggable={mode === "single"}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("text/report-tile", view.tileId);
              }}
            >
              <button type="button" className={styles.tileCardButton} title={view.title} aria-label={`${view.title} 추가`} onClick={() => mode === "single" ? onAdd(view.tileId) : onToggleCompare(view.tileId)} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && mode === "single") { event.preventDefault(); onAdd(view.tileId); } }}>
                <TileThumbnail view={view} getThumbnailSlide={getThumbnailSlide} classMap={classMap} />
                <span className={styles.tileCardMeta}>
                  <span className={styles.tileCardName}>{view.title}</span>
                  {used.length > 0 && <span className={styles.tileUsedBadge}>{used.map((page) => `${page}쪽`).join("·")}</span>}
                </span>
              </button>
              {mode === "compare" && <label className={styles.tileCompareToggle} title={`${view.title} 비교에 포함`}><input type="checkbox" checked={checked} aria-label={`${view.title} 비교에 포함`} disabled={!checked && compareSelected.length >= compareLimit} onChange={() => onToggleCompare(view.tileId)} /></label>}
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

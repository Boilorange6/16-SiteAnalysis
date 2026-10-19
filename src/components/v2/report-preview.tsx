"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type Dispatch, type RefObject } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { useFocusTrap } from "./use-focus-trap";
import { SlideSurface } from "./report/slide-surface";
import { extraPageKey, type BoardAction, type BoardState, type PageKey, type PageStyle } from "@/lib/v2/ui/board-state";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { sheetCapacity, type SheetGrid } from "@/lib/v2/ui/sheet";
import { mixedValue, movePageSelection, neighborPageKey, nextExtraPageId, pageKeyAfterInsertion, selectPageKeys, type PageNavigationKey, type PageSelectionModifiers } from "@/lib/v2/ui/report-preview-logic";
import styles from "./report-preview.module.css";

type PreviewStylePatch = Partial<PageStyle>;

const SHEET_GRID_OPTIONS: readonly { grid: SheetGrid; label: string }[] = [
  { grid: "2x2", label: "2×2 · 4칸" },
  { grid: "3x2", label: "3×2 · 6칸" },
  { grid: "3x1", label: "3×1 · 3칸" },
];

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mixedField<T>(slides: readonly PlannedSlide[], read: (slide: PlannedSlide) => T, fallback: T): { value: T; mixed: boolean } {
  if (slides.length === 0) return { value: fallback, mixed: false };
  const value = mixedValue(slides.map(read), fallback);
  return value === undefined ? { value: fallback, mixed: true } : { value, mixed: false };
}

function formatZoom(value: number): string {
  const normalized = Math.round(value * 10) / 10;
  return (normalized > 0 ? "+" : "") + String(normalized).replace(/\.0$/, "");
}

type InlineIconName = "close" | "grid" | "plus" | "chevronDown" | "chevronLeft" | "chevronRight" | "zoomOut" | "zoomIn" | "center" | "summary";

function InlineIcon({ name, size }: { name: InlineIconName; size?: number }) {
  let content: React.ReactNode;
  switch (name) {
    case "close": content = <path d="M6 6l12 12M18 6 6 18" />; break;
    case "grid": content = <><rect x="4" y="4" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" /></>; break;
    case "plus": content = <path d="M12 5v14M5 12h14" />; break;
    case "chevronDown": content = <path d="m7 9 5 5 5-5" />; break;
    case "chevronLeft": content = <path d="m14.5 5-7 7 7 7" />; break;
    case "chevronRight": content = <path d="m9.5 5 7 7-7 7" />; break;
    case "zoomOut": content = <><circle cx="10.5" cy="10.5" r="5.75" /><path d="m15 15 4.25 4.25M8 10.5h5" /></>; break;
    case "zoomIn": content = <><circle cx="10.5" cy="10.5" r="5.75" /><path d="m15 15 4.25 4.25M8 10.5h5M10.5 8v5" /></>; break;
    case "center": content = <><circle cx="12" cy="12" r="3.5" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></>; break;
    case "summary": content = <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M7.5 9h9M7.5 12h6M7.5 15h8" /></>; break;
  }
  return <svg className={styles.iconSvg} style={size ? { width: size, height: size } : undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content}</svg>;
}

function slideTitle(slide: PlannedSlide): string {
  if (slide.kind === "cover") return slide.address;
  if (slide.kind === "sources") return "출처·기준일";
  return slide.view.title;
}

function mapForSlide(slide: PlannedSlide): NonNullable<Extract<PlannedSlide, { kind: "tile" | "cover" | "sources" }>['map']> | null {
  return slide.kind === "tile" || slide.kind === "cover" || slide.kind === "sources" ? slide.map : null;
}

type PageToolbarProps = {
  selectedSlides: PlannedSlide[];
  current: PlannedSlide | null;
  applyPatch: (patch: PreviewStylePatch) => void;
  resetScales: () => void;
  resetLabels: () => void;
  exportStatusRef: RefObject<HTMLParagraphElement | null>;
  exportEnabled: boolean;
  exporting: boolean;
  makingKind: string | null;
  exportProblem: string | null;
  onExport: () => void;
};

function PageToolbar({ selectedSlides, current, applyPatch, resetScales, resetLabels, exportStatusRef, exportEnabled, exporting, makingKind, exportProblem, onExport }: PageToolbarProps) {
  const resetMenuRef = useRef<HTMLDivElement>(null);
  const resetMenuId = useId().replace(/:/g, "");
  const [resetMenuOpen, setResetMenuOpen] = useState(false);
  const targets = selectedSlides.length > 0 ? selectedSlides : current ? [current] : [];
  const mapEnabled = !!(current && mapForSlide(current));
  const summaryEnabled = current?.kind === "tile" && !(current.callout && current.callout.page > 0);
  const zoom = mixedField(targets, (slide) => slide.style.zoomDelta ?? 0, 0);
  const summary = mixedField(targets, (slide) => slide.style.summary !== false, true);

  useEffect(() => {
    if (!resetMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && resetMenuRef.current?.contains(target)) return;
      setResetMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [resetMenuOpen]);

  return (
    <div className={styles.pageToolbar} role="toolbar" aria-label="페이지 직접 조작 도구">
      {targets.length > 1 && <div className={styles.toolbarContext}><strong className={styles.selectionChip}>{targets.length}장에 적용</strong></div>}
      <div className={styles.toolbarActions}>
        <div className={styles.toolbarGroup} aria-label="지도 확대">
          <button type="button" className={styles.smallButton + " " + styles.toolbarIconButton} disabled={!mapEnabled || targets.length === 0} onClick={() => applyPatch({ zoomDelta: clampNumber((zoom.mixed ? 0 : zoom.value) - 0.5, -3, 3) })} aria-label="지도 축소" title="지도 축소" data-tooltip="지도 축소"><InlineIcon name="zoomOut" /></button>
          <span className={styles.toolbarLabel}>{zoom.mixed ? "—" : formatZoom(zoom.value)}</span>
          <button type="button" className={styles.smallButton + " " + styles.toolbarIconButton} disabled={!mapEnabled || targets.length === 0} onClick={() => applyPatch({ zoomDelta: clampNumber((zoom.mixed ? 0 : zoom.value) + 0.5, -3, 3) })} aria-label="지도 확대" title="지도 확대" data-tooltip="지도 확대"><InlineIcon name="zoomIn" /></button>
          <button type="button" className={styles.centerButton + " " + styles.toolbarIconButton} disabled={!mapEnabled || targets.length === 0} onClick={() => applyPatch({ offsetM: [0, 0] })} aria-label="대지 중앙 정렬" title="대지 중앙 정렬" data-tooltip="대지 중앙 정렬"><InlineIcon name="center" /></button>
        </div>
        <button type="button" className={styles.toolbarToggle + " " + styles.toolbarIconButton} disabled={!summaryEnabled || targets.length === 0} aria-pressed={summary.value} aria-label={summary.value ? "요약 탭 숨기기" : "요약 탭 켜기"} title={summary.value ? "요약 탭 숨기기" : "요약 탭 켜기"} data-tooltip={summary.value ? "요약 탭 숨기기" : "요약 탭 켜기"} onClick={() => applyPatch({ summary: !summary.value })}><InlineIcon name="summary" /></button>
        <div ref={resetMenuRef} className={styles.toolbarResetWrap}>
          <button type="button" className={styles.toolbarReset} disabled={targets.length === 0} aria-haspopup="menu" aria-expanded={resetMenuOpen} aria-controls={resetMenuId} onClick={() => setResetMenuOpen((open) => !open)}>초기화 <InlineIcon name="chevronDown" size={14} /></button>
          {resetMenuOpen && <div id={resetMenuId} className={styles.toolbarResetMenu} role="menu" aria-label="초기화">
            <button type="button" role="menuitem" className={styles.toolbarResetMenuItem} disabled={targets.length === 0} onClick={() => { resetScales(); setResetMenuOpen(false); }}>탭 배치 초기화</button>
            <button type="button" role="menuitem" className={styles.toolbarResetMenuItem} disabled={!mapEnabled || !current} onClick={() => { resetLabels(); setResetMenuOpen(false); }}>라벨 초기화</button>
          </div>}
        </div>
        <button type="button" className={styles.toolbarExport} disabled={!exportEnabled || exporting} aria-busy={exporting} onClick={onExport}>내보내기</button>
      </div>
      <p ref={exportStatusRef} className={styles.toolbarStatus + (exportProblem ? " " + styles.footerError : "")} role={exportProblem ? "alert" : "status"} aria-live="polite" aria-busy={exporting} tabIndex={-1}>{exportProblem ?? (exporting ? (makingKind ?? "PPT") + " 내보내는 중…" : "")}</p>
    </div>
  );
}

type Props = {
  board: BoardState;
  dispatch: Dispatch<BoardAction>;
  views: ReadonlyMap<string, TileView>;
  plan: PlannedSlide[];
  basemap: BasemapChoice;
  onClose: () => void;
  onExport: () => void | Promise<void>;
  exportEnabled: boolean;
  exporting: boolean;
  makingKind: string | null;
  exportProblem: string | null;
};

export default function ReportPreview({ board, dispatch, views, plan, basemap, onClose, onExport, exportEnabled, exporting, makingKind, exportProblem }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const thumbnailRefs = useRef(new Map<PageKey, HTMLButtonElement>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addPopoverRef = useRef<HTMLDivElement>(null);
  const sheetCellPopoverRef = useRef<HTMLDivElement>(null);
  const sheetCellFocusRef = useRef<number | null>(null);
  const pendingAddedPageRef = useRef<PageKey | null>(null);
  const addAfterKeyRef = useRef<PageKey | null>(null);
  const sheetCellIndexRef = useRef<number | null>(null);
  const exportStatusRef = useRef<HTMLParagraphElement>(null);
  const exportFocusRequestedRef = useRef(false);
  const headingId = useId().replace(/:/g, "");
  const addPopoverId = useId().replace(/:/g, "");
  const sheetCellPopoverId = useId().replace(/:/g, "");
  const [activeKey, setActiveKey] = useState<PageKey | null>(plan[0]?.key ?? null);
  const [selectedKeys, setSelectedKeys] = useState<PageKey[]>(plan[0]?.key ? [plan[0].key] : []);
  const [anchorKey, setAnchorKey] = useState<PageKey | null>(plan[0]?.key ?? null);
  const [filmstripOpen, setFilmstripOpen] = useState(false);
  const [addAfterKey, setAddAfterKey] = useState<PageKey | null>(null);
  const [addPopoverStyle, setAddPopoverStyle] = useState<CSSProperties | null>(null);
  const [addSearch, setAddSearch] = useState("");
  const [thumbnailMenuKey, setThumbnailMenuKey] = useState<PageKey | null>(null);
  const [sheetCellIndex, setSheetCellIndex] = useState<number | null>(null);
  const [sheetCellPopoverStyle, setSheetCellPopoverStyle] = useState<CSSProperties | null>(null);
  const [sheetCellSearch, setSheetCellSearch] = useState("");
  addAfterKeyRef.current = addAfterKey;
  sheetCellIndexRef.current = sheetCellIndex;

  const closeAddPopover = useCallback((restoreFocus = false) => {
    setAddAfterKey(null);
    setAddPopoverStyle(null);
    setAddSearch("");
    if (restoreFocus) addButtonRef.current?.focus({ preventScroll: true });
  }, []);

  const closeSheetCellPopover = useCallback((restoreFocus = false) => {
    const focusIndex = sheetCellFocusRef.current;
    setSheetCellIndex(null);
    setSheetCellPopoverStyle(null);
    setSheetCellSearch("");
    sheetCellFocusRef.current = null;
    if (restoreFocus) window.requestAnimationFrame(() => {
      if (focusIndex === null) return;
      dialogRef.current?.querySelector<HTMLElement>(`[data-sheet-cell-index="${focusIndex}"]`)?.focus({ preventScroll: true });
    });
  }, []);

  const updateSheetCellPopoverPosition = useCallback(() => {
    if (sheetCellIndex === null) return;
    const anchor = dialogRef.current?.querySelector<HTMLElement>(`[data-sheet-cell-index="${sheetCellIndex}"]`);
    const popover = sheetCellPopoverRef.current;
    if (!anchor || !popover) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
    const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    const margin = 12;
    const left = Math.max(margin, Math.min(anchorRect.left, viewportWidth - popoverRect.width - margin));
    let top = anchorRect.bottom + 8;
    if (top + popoverRect.height > viewportHeight - margin) top = anchorRect.top - popoverRect.height - 8;
    top = Math.max(margin, Math.min(top, viewportHeight - popoverRect.height - margin));
    setSheetCellPopoverStyle((currentStyle) => currentStyle?.left === left && currentStyle?.top === top ? currentStyle : { left, top });
  }, [sheetCellIndex]);

  useEffect(() => {
    if (sheetCellIndex === null) {
      setSheetCellPopoverStyle(null);
      return;
    }
    const frame = window.requestAnimationFrame(updateSheetCellPopoverPosition);
    const onViewportChange = () => window.requestAnimationFrame(updateSheetCellPopoverPosition);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [sheetCellIndex, updateSheetCellPopoverPosition]);

  const updateAddPopoverPosition = useCallback(() => {
    if (!addAfterKey) return;
    const anchor = addButtonRef.current;
    const popover = addPopoverRef.current;
    if (!anchor || !popover) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
    const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    const margin = 12;
    const left = Math.max(margin, Math.min(anchorRect.right + 8, viewportWidth - popoverRect.width - margin));
    let top = anchorRect.bottom + 8;
    if (top + popoverRect.height > viewportHeight - margin) top = anchorRect.top - popoverRect.height - 8;
    top = Math.max(margin, Math.min(top, viewportHeight - popoverRect.height - margin));
    setAddPopoverStyle((current) => current?.left === left && current?.top === top ? current : { left, top });
  }, [addAfterKey]);

  useEffect(() => {
    if (!addAfterKey) {
      setAddPopoverStyle(null);
      return;
    }
    const frame = window.requestAnimationFrame(updateAddPopoverPosition);
    const onViewportChange = () => window.requestAnimationFrame(updateAddPopoverPosition);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [addAfterKey, updateAddPopoverPosition]);

  useFocusTrap({
    ref: dialogRef,
    onClose,
    onEscape: () => {
      if (sheetCellIndexRef.current !== null) {
        closeSheetCellPopover(true);
        return true;
      }
      if (addAfterKeyRef.current !== null) {
        closeAddPopover(true);
        return true;
      }
      const resetMenu = dialogRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"][aria-expanded="true"]');
      if (resetMenu) {
        resetMenu.click();
        return true;
      }
      const selectedPanel = dialogRef.current?.querySelector<HTMLElement>('[data-panel-selected="true"]');
      if (selectedPanel) {
        selectedPanel.dispatchEvent(new Event("v2-preview-deselect-panel", { bubbles: true }));
        return true;
      }
      return false;
    },
  });

  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof Node && dialogRef.current?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (addAfterKeyRef.current !== null) closeAddPopover(true);
      else onClose();
    };
    document.addEventListener("keydown", onDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", onDocumentKeyDown, true);
  }, [closeAddPopover, onClose]);

  const planKeys = useMemo(() => plan.map((slide) => slide.key), [plan]);
  useEffect(() => {
    const available = new Set(planKeys);
    setActiveKey((key) => key && available.has(key) ? key : planKeys[0] ?? null);
    setSelectedKeys((keys) => {
      const kept = keys.filter((key) => available.has(key));
      return kept.length > 0 ? kept : (planKeys[0] ? [planKeys[0]] : []);
    });
    setAnchorKey((key) => key && available.has(key) ? key : planKeys[0] ?? null);
    setAddAfterKey((key) => key && available.has(key) ? key : null);
    setThumbnailMenuKey((key) => key && available.has(key) ? key : null);
  }, [planKeys]);

  useEffect(() => {
    const key = pendingAddedPageRef.current;
    if (!key || !planKeys.includes(key)) return;
    pendingAddedPageRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const element = thumbnailRefs.current.get(key);
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
      element?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [planKeys]);

  const current = plan.find((slide) => slide.key === activeKey) ?? plan[0] ?? null;
  const previousPageKey = neighborPageKey(planKeys, current?.key ?? "", "ArrowLeft");
  const nextPageKey = neighborPageKey(planKeys, current?.key ?? "", "ArrowRight");
  const selectedSlides = plan.filter((slide) => selectedKeys.includes(slide.key));
  const applyPatch = useCallback((patch: PreviewStylePatch) => {
    const keys = selectedKeys.length > 0 ? selectedKeys : (current ? [current.key] : []);
    if (keys.length > 0) dispatch({ type: "pageStyle", keys, patch });
  }, [current, dispatch, selectedKeys]);
  const select = useCallback((key: PageKey, modifiers: PageSelectionModifiers = {}) => {
    const next = selectPageKeys(planKeys, anchorKey, key, { ...modifiers, selectedKeys });
    setActiveKey(key);
    setSelectedKeys(next);
    if (!modifiers.shiftKey) setAnchorKey(key);
  }, [anchorKey, planKeys, selectedKeys]);
  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable || target.getAttribute("role") === "textbox") return;
    if (target.closest("[data-preview-map]")) return;
    if (target.closest("[data-panel-selected=\"true\"]")) return;
    if (target.closest("[role=\"menu\"], [role=\"listbox\"], [role=\"region\"], [aria-haspopup=\"menu\"][aria-expanded=\"true\"]")) return;
    if (addAfterKey !== null || sheetCellIndex !== null || thumbnailMenuKey !== null) return;
    if (!(event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End")) return;
    const currentKey = current?.key ?? planKeys[0] ?? "";
    const nextKey = neighborPageKey(planKeys, currentKey, event.key as PageNavigationKey);
    if (!nextKey || nextKey === currentKey) return;
    event.preventDefault();
    select(nextKey);
  };
  const onThumbnailKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, key: PageKey) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const anchorForMove = anchorKey;
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const currentIndex = planKeys.indexOf(key);
      const nextIndex = Math.max(0, Math.min(planKeys.length - 1, currentIndex + direction));
      const nextActiveKey = planKeys[nextIndex] ?? key;
      const nextSelectedKeys = movePageSelection(planKeys, anchorForMove, key, direction, event.shiftKey);
      setActiveKey(nextActiveKey);
      setSelectedKeys(nextSelectedKeys);
      setAnchorKey(event.shiftKey ? (anchorForMove ?? nextActiveKey) : nextActiveKey);
      window.requestAnimationFrame(() => thumbnailRefs.current.get(nextActiveKey)?.focus({ preventScroll: false }));
    } else if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      setActiveKey(key);
      setSelectedKeys((keys) => keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key]);
      setAnchorKey(key);
    }
  };
  const addOptions = [...new Set([...board.order, ...Array.from(views.keys())])]
    .map((id) => ({ id, view: views.get(id) }))
    .filter((entry): entry is { id: string; view: TileView } => !!entry.view);
  const filteredAddOptions = addOptions.filter(({ id, view }) => {
    const query = addSearch.trim().toLocaleLowerCase();
    return !query || [id, view.code, view.title, view.kindLabel].some((value) => value.toLocaleLowerCase().includes(query));
  });
  const addGroups = [...new Map(filteredAddOptions.map((entry) => [entry.view.kindLabel, filteredAddOptions.filter((candidate) => candidate.view.kindLabel === entry.view.kindLabel)])).entries()];
  const filteredSheetOptions = addOptions.filter(({ id, view }) => {
    const query = sheetCellSearch.trim().toLocaleLowerCase();
    return !query || [id, view.code, view.title, view.kindLabel].some((value) => value.toLocaleLowerCase().includes(query));
  });
  const openAddPopover = (key: PageKey) => {
    closeSheetCellPopover();
    setThumbnailMenuKey(null);
    setAddSearch("");
    setAddPopoverStyle(null);
    setAddAfterKey((currentKey) => currentKey === key ? null : key);
  };
  const addSheetPage = (grid: SheetGrid) => {
    if (!addAfterKey) return;
    const id = nextExtraPageId(board.report.extra.map((page) => page.id), `sheet-${grid}`);
    const after = pageKeyAfterInsertion(planKeys, addAfterKey);
    dispatch({ type: "addPage", id, after, tileId: "", face: "front", sheet: { grid, tiles: Array.from({ length: sheetCapacity(grid) }, () => "") } });
    const key = extraPageKey(id);
    pendingAddedPageRef.current = key;
    setActiveKey(key);
    setSelectedKeys([key]);
    setAnchorKey(key);
    closeAddPopover();
  };
  const addPage = (tileId: string, face: "front" | "back") => {
    if (!addAfterKey) return;
    const id = nextExtraPageId(board.report.extra.map((page) => page.id), tileId);
    const after = pageKeyAfterInsertion(planKeys, addAfterKey);
    dispatch({ type: "addPage", id, after, tileId, face });
    const key = extraPageKey(id);
    pendingAddedPageRef.current = key;
    setActiveKey(key);
    setSelectedKeys([key]);
    setAnchorKey(key);
    closeAddPopover();
  };
  const openSheetCellPopover = (index: number) => {
    if (current?.kind !== "sheet") return;
    sheetCellFocusRef.current = index;
    closeAddPopover();
    setThumbnailMenuKey(null);
    setSheetCellSearch("");
    setSheetCellPopoverStyle(null);
    setSheetCellIndex(index);
  };
  const setSheetCell = (tileId: string) => {
    if (!current?.key.startsWith("extra:") || sheetCellIndex === null) return;
    dispatch({ type: "setSheetCell", id: current.key.slice("extra:".length), index: sheetCellIndex, tileId });
    closeSheetCellPopover(true);
  };

  const handleExport = useCallback(() => {
    if (!exportEnabled || exporting) return;
    exportFocusRequestedRef.current = true;
    exportStatusRef.current?.focus({ preventScroll: true });
    void onExport();
  }, [exportEnabled, exporting, onExport]);

  useEffect(() => {
    if (!exportFocusRequestedRef.current) return;
    exportStatusRef.current?.focus({ preventScroll: true });
  }, [exportProblem, exporting]);
  const removeExtra = (key: PageKey) => {
    if (!key.startsWith("extra:")) return;
    dispatch({ type: "removePage", id: key.slice("extra:".length) });
  };
  const onLargeMapPatch = (patch: PreviewStylePatch) => {
    const keys = selectedKeys.includes(current?.key ?? "") ? selectedKeys : (current ? [current.key] : []);
    if (keys.length > 0) dispatch({ type: "pageStyle", keys, patch });
  };
  const onDirectPagePatch = useCallback((patch: PreviewStylePatch) => {
    if (current) dispatch({ type: "pageStyle", keys: [current.key], patch });
  }, [current, dispatch]);
  const resetScales = useCallback(() => {
    applyPatch({ titleScale: undefined, summaryScale: undefined, legendScale: undefined, panels: undefined } as unknown as PreviewStylePatch);
  }, [applyPatch]);
  const resetLabels = useCallback(() => {
    onDirectPagePatch({ pinnedKeys: undefined, hiddenKeys: undefined });
  }, [onDirectPagePatch]);

  return (
    <div className={styles.backdrop}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onKeyDown={onDialogKeyDown}>
        <h1 id={headingId} className={styles.visuallyHidden}>페이지 미리보기</h1>
        <button type="button" className={styles.dialogClose} aria-label="미리보기 닫기" title="미리보기 닫기" onClick={onClose}><InlineIcon name="close" /></button>
        <div className={styles.body + (!filmstripOpen ? " " + styles.bodyFilmstripCollapsed : "")}>
          <nav className={styles.thumbRail + (!filmstripOpen ? " " + styles.thumbRailCollapsed : "")} aria-label="보고서 페이지 목록">
            <div className={styles.railHeading}>
              <h2>페이지</h2>
              <span className={styles.railHint + " " + styles.filmstripCount}>{current?.no ?? 0} / {plan.length}</span>
              <button type="button" className={styles.filmstripToggle} aria-label="페이지 목록 펼치기/접기" title="페이지 목록 펼치기/접기" aria-expanded={filmstripOpen} onClick={() => setFilmstripOpen((open) => !open)}><InlineIcon name="grid" /></button>
            </div>
            {filmstripOpen && <ol className={styles.thumbList} data-thumbnail-scroll="true">
              {plan.map((slide) => {
                const selected = selectedKeys.includes(slide.key);
                const extra = slide.key.startsWith("extra:");
                return (
                  <li className={styles.thumbItem} key={slide.key}>
                    <button type="button" ref={(element) => {
                      if (element) thumbnailRefs.current.set(slide.key, element);
                      else thumbnailRefs.current.delete(slide.key);
                    }} className={styles.thumbButton} aria-current={activeKey === slide.key ? "true" : undefined} aria-selected={selected} onClick={(event) => select(slide.key, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })} onKeyDown={(event) => onThumbnailKeyDown(event, slide.key)}>
                       <SlideSurface slide={slide} basemap={basemap} mode="thumb" classMap={styles} />
                       <span className={styles.thumbCopy}><span className={styles.thumbNumber}>{slide.no} / {slide.total}</span><span className={styles.thumbTitle}>{slideTitle(slide)}{extra && <span className={styles.extraBadge}>추가</span>}</span><span className={styles.thumbKind}>{slide.kind === "tile" ? slide.view.kindLabel : slide.kind === "sheet" ? "타일 조판" : slide.kind === "sources" ? "출처" : "표지"}</span></span>
                     </button>
                     <button type="button" className={styles.thumbMenuButton} aria-label={slideTitle(slide) + " 페이지 메뉴"} aria-expanded={thumbnailMenuKey === slide.key} onClick={(event) => { event.stopPropagation(); setThumbnailMenuKey((key) => key === slide.key ? null : slide.key); }} title="페이지 메뉴">⋯</button>
                     {thumbnailMenuKey === slide.key && <div className={styles.thumbMenu} role="menu" aria-label={slideTitle(slide) + " 페이지 메뉴"}>
                       <button type="button" role="menuitem" onClick={() => openAddPopover(slide.key)}>이 페이지 뒤에 추가</button>
                       {extra && <button type="button" role="menuitem" className={styles.thumbMenuDanger} onClick={() => { setThumbnailMenuKey(null); removeExtra(slide.key); }}>페이지 삭제</button>}
                     </div>}
                   </li>
                 );
               })}
             </ol>}
             <button ref={addButtonRef} type="button" className={styles.addPageButton} disabled={!current} aria-label="현재 페이지 뒤에 페이지 추가" title="현재 페이지 뒤에 페이지 추가" aria-expanded={!!addAfterKey} aria-controls={addAfterKey ? addPopoverId : undefined} onClick={() => current && openAddPopover(current.key)}><InlineIcon name="plus" /></button>
           </nav>
           {addAfterKey && <div ref={addPopoverRef} id={addPopoverId} className={styles.addPopover} style={addPopoverStyle ?? undefined} role="region" aria-label="페이지 추가">
             <p className={styles.addPopoverHeading}>현재 페이지 뒤에 추가{plan.find((slide) => slide.key === addAfterKey) ? ` · ${slideTitle(plan.find((slide) => slide.key === addAfterKey)!)}` : ""}</p>
             <label className={styles.addSearchLabel}>타일 검색<input type="search" value={addSearch} onChange={(event) => setAddSearch(event.target.value)} placeholder="타일 이름·코드·분류" aria-label="추가할 타일 검색" /></label>
             <section className={styles.sheetGridOptions} aria-label="여러 타일 페이지">
               <h3>여러 타일 페이지</h3>
               <div className={styles.sheetGridOptionList}>
                 {SHEET_GRID_OPTIONS.map((option) => <button key={option.grid} type="button" className={styles.sheetGridOption} onClick={() => addSheetPage(option.grid)} aria-label={`${option.label} 페이지 추가`}>{option.label}</button>)}
               </div>
             </section>
             <div className={styles.addTileList}>
               {addGroups.map(([group, entries]) => <section className={styles.addTileGroup} key={group}>
                 <h3>{group}</h3>
                 {entries.map((entry) => <div className={styles.addTileButton} key={entry.id}>
                   <span className={styles.addTileName}><b>{entry.view.code}</b> · {entry.view.title}</span>
                   <span className={styles.faceOptions}>
                     <button type="button" className={styles.faceButton} aria-label={`${entry.view.title} 앞면 지도 추가`} onClick={() => addPage(entry.id, "front")}>앞면 · 지도</button>
                     {entry.view.hasFace && <button type="button" className={styles.faceButton} aria-label={`${entry.view.title} 뒷면 요약 추가`} onClick={() => addPage(entry.id, "back")}>뒷면 · 요약</button>}
                   </span>
                 </div>)}
               </section>)}
               {addGroups.length === 0 && <p className={styles.addEmpty}>검색 결과가 없습니다.</p>}
             </div>
           </div>}
           {sheetCellIndex !== null && <div ref={sheetCellPopoverRef} id={sheetCellPopoverId} className={styles.sheetCellPicker} style={sheetCellPopoverStyle ?? undefined} role="region" aria-label="타일 선택">
             <div className={styles.sheetCellPickerHeading}>타일 선택</div>
             <label className={styles.addSearchLabel}>검색<input type="search" value={sheetCellSearch} onChange={(event) => setSheetCellSearch(event.target.value)} placeholder="타일 이름·코드" aria-label="타일 검색" /></label>
             <div className={styles.sheetCellPickerList}>
               {filteredSheetOptions.map((entry) => <button key={entry.id} type="button" className={styles.sheetCellPickerOption} onClick={() => setSheetCell(entry.id)} aria-label={`${entry.view.code} ${entry.view.title} 선택`}><b>{entry.view.code}</b><span>{entry.view.title}</span></button>)}
               {filteredSheetOptions.length === 0 && <p className={styles.addEmpty}>검색 결과가 없습니다.</p>}
             </div>
             <button type="button" className={styles.sheetCellClear} onClick={() => setSheetCell("")}>칸 비우기</button>
           </div>}
           <main className={styles.stageColumn} aria-label="현재 페이지 미리보기">
             {current ? <>
               <PageToolbar selectedSlides={selectedSlides} current={current} applyPatch={applyPatch} resetScales={resetScales} resetLabels={resetLabels} exportStatusRef={exportStatusRef} exportEnabled={exportEnabled} exporting={exporting} makingKind={makingKind} exportProblem={exportProblem} onExport={handleExport} />
               <div className={styles.pageStage}>
                 <button type="button" className={styles.toolbarIconButton + " " + styles.pageNavButton + " " + styles.pageNavPrevious} disabled={!previousPageKey || previousPageKey === current.key} aria-label="이전 페이지" title="이전 페이지" data-tooltip="이전 페이지" onClick={() => previousPageKey && select(previousPageKey)}><InlineIcon name="chevronLeft" /></button>
                 <SlideSurface slide={current} basemap={basemap} mode="edit" classMap={styles} onSheetCellActivate={current.kind === "sheet" && current.key.startsWith("extra:") ? openSheetCellPopover : undefined} onStylePatch={applyPatch} onMapStylePatch={onLargeMapPatch} onDirectStylePatch={onDirectPagePatch} />
                 <button type="button" className={styles.toolbarIconButton + " " + styles.pageNavButton + " " + styles.pageNavNext} disabled={!nextPageKey || nextPageKey === current.key} aria-label="다음 페이지" title="다음 페이지" data-tooltip="다음 페이지" onClick={() => nextPageKey && select(nextPageKey)}><InlineIcon name="chevronRight" /></button>
               </div>
             </> : <p className={styles.emptyState}>표시할 페이지가 없습니다.</p>}
           </main>
         </div>
       </div>
    </div>
  );
}

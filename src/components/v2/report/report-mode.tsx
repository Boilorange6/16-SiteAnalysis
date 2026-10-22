"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { Dispatch } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { defaultFrame, EMPTY_REPORT_DOC, newPageId, reportDocReducer, SITE_FIT_PATCH, type MapFrameState, type PagePanels, type ReportDoc, type ReportDocAction, type ReportFontScale, type ReportFormat, type ReportPage, type TextBox } from "@/lib/v2/report/report-doc";
import { mapFrameScaleOptions, scaleForFrame } from "@/lib/v2/ui/report-scale";
import { SLIDE_OVERVIEW_FILL } from "@/lib/v2/ui/callout-layout";
import { slideGeometry, slideSiteX } from "@/lib/v2/ui/overlay-layout";
import { importLegacyReport, hasLegacyReport, pagesForTile, planReportDoc, recommendedPages } from "@/lib/v2/report/report-doc-plan";
import { pageStripItems } from "@/lib/v2/report/report-page-strip";
import { reportFileName, tileReportSettingsFromBoard, type PlannedSlide } from "@/lib/v2/report/report-plan";
import { dismissMapEditHint, readMapEditHintDismissed } from "@/lib/v2/ui/map-edit-hint";
import type { ExportPageScope } from "@/lib/v2/report/export-runner";
import { initialReportRail, insertIndexAfter, isTypingTarget, moveByKey, reorderMessage, reportPageMapSelectable, stripNavIndex, transitionMapInteraction, type ReportRailKey } from "@/lib/v2/ui/report-mode-logic";
import type { BoardAction, BoardState } from "@/lib/v2/ui/board-state";
import type { SummaryView, TileView } from "@/lib/v2/ui/tile-view";
import { useFocusTrap } from "../use-focus-trap";
import { SlideSurface, type SurfaceSelection } from "./slide-surface";
import DrawerPages, { type PageAddKind } from "./drawer-pages";
import DrawerTiles from "./drawer-tiles";
import PageStrip, { type PageStripItem } from "./page-strip";
import DrawerMap from "./drawer-map";
import LayoutSwitcher from "./layout-switcher";
import MapToolbar from "./map-toolbar";
import NotesField from "./notes-field";
import ExportPanel from "./export-panel";
import styles from "./report-mode.module.css";
import legacySurfaceStyles from "../report-surface.module.css";
import localSurfaceStyles from "./slide-surface.module.css";

type ReportHistory = { past: ReportDoc[]; present: ReportDoc; future: ReportDoc[] };
type RailKey = ReportRailKey;
const surfaceClassMap = { ...legacySurfaceStyles, ...localSurfaceStyles };

type RailIconName = "pages" | "tiles" | "textbox" | "theme";

function RailIcon({ name }: { name: RailIconName }) {
  return (
    <svg className={styles.railIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {name === "pages" && <><rect x="4" y="3" width="10" height="13" rx="1" /><path d="M7 6h4M7 9h4M7 12h3" /><path d="M6 16h9a1 1 0 0 0 1-1V5" /></>}
      {name === "tiles" && <><path d="m10 3 6 4-6 4-6-4 6-4Z" /><path d="m4 10 6 4 6-4M4 13l6 4 6-4" /></>}
      {name === "textbox" && <><path d="M4 4h12M10 4v12" /><path d="M7 16h6" /></>}
      {name === "theme" && <><circle cx="10" cy="10" r="5.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /></>}
    </svg>
  );
}

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export type ReportModeProps = {
  board: BoardState;
  dispatch: Dispatch<BoardAction>;
  views: ReadonlyMap<string, TileView>;
  summary: SummaryView;
  analysisDate: string;
  basemap: BasemapChoice;
  dirty: boolean;
  demo?: boolean;
  busy?: boolean;
  onPresentation: () => void;
};

function simplePage(doc: ReportDoc, kind: "cover" | "sources" | "blank"): ReportPage {
  return {
    id: newPageId(doc),
    layout: "map-summary",
    panels: {},
    textBoxes: [],
    notes: "",
    kind,
  };
}

function pageTypeLabel(page: ReportPage): string {
  if (page.kind === "cover") return "표지";
  if (page.kind === "sources") return "출처·기준일";
  if (page.kind === "compare") return "여러 타일 비교";
  if (page.kind === "blank") return "빈 페이지";
  return "분석 타일";
}

function formatLabel(format: ReportFormat): string {
  return format === "wide" ? "와이드 16:9" : format === "a3" ? "A3 가로" : "A4 가로";
}

function ThemeDrawer({ doc, onFormat, onFontScale, onClose }: { doc: ReportDoc; onFormat: (format: ReportFormat) => void; onFontScale: (scale: ReportFontScale) => void; onClose: () => void }) {
  return (
    <section className={styles.drawer} aria-label="테마 설정">
      <div className={styles.drawerHeader}>
        <div><p className={styles.eyebrow}>보고서 설정</p><h2>테마</h2></div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label="테마 닫기">×</button>
      </div>
      <label className={styles.fieldLabel}>
        <span>판형</span>
        <select value={doc.format} onChange={(event) => onFormat(event.target.value as ReportFormat)}>
          <option value="wide">{formatLabel("wide")}</option>
          <option value="a3">{formatLabel("a3")}</option>
          <option value="a4">{formatLabel("a4")}</option>
        </select>
      </label>
      <div className={styles.themeScaleField}>
        <span className={styles.fieldLabelText}>제목·본문 글자 크기</span>
        <div className={styles.themeScaleOptions} role="radiogroup" aria-label="글자 크기 배율">
          {([0.85, 1, 1.15] as const).map((scale) => <button key={scale} type="button" className={styles.themeScaleOption} role="radio" aria-checked={(doc.fontScale ?? 1) === scale} onClick={() => onFontScale(scale)}>{scale}×</button>)}
        </div>
      </div>
      <div className={styles.themeSample}>
        <span className={styles.themeTitle}>제목 크기</span>
        <span className={styles.themeBody}>본문은 제목의 85% 비율로 맞춥니다.</span>
      </div>
      <p className={styles.helper}>보고서의 모든 페이지가 같은 판형으로 바뀝니다. 지도 위치와 페이지 내용은 보존됩니다.</p>
    </section>
  );
}

function TextBoxDrawer({ onAdd }: { onAdd: () => void }) {
  return (
    <section className={styles.drawer} aria-label="글상자 추가">
      <div className={styles.drawerHeader}><div><p className={styles.eyebrow}>요소 추가</p><h2>글상자</h2></div></div>
      <p className={styles.helper}>페이지 가운데에 글상자를 추가한 뒤 바로 입력하세요. 선택한 글상자는 Delete로 지울 수 있습니다.</p>
      <button type="button" className={styles.primaryButton} onClick={onAdd}>＋ 글상자 추가</button>
    </section>
  );
}

function pageTitleForToast(page: ReportPage, views: ReadonlyMap<string, TileView>): string {
  if (page.kind === "tile") return page.titleOverride ?? views.get(page.tileId)?.title ?? "분석 타일";
  if (page.kind === "compare") return "여러 타일 비교";
  return pageTypeLabel(page);
}

export default function ReportMode({ board, dispatch, views, summary, analysisDate, basemap, dirty, demo = false, busy = false, onPresentation }: ReportModeProps) {
  const [history, setHistory] = useState<ReportHistory>({ past: [], present: board.reportDoc, future: [] });
  const [selectedId, setSelectedId] = useState<string | null>(board.reportDoc.pages[0]?.id ?? null);
  const [selectedSlideKey, setSelectedSlideKey] = useState<string | null>(null);
  const [rail, setRail] = useState<RailKey | null>(() => initialReportRail(board.reportDoc.pages.length > 0));
  const [compareMode, setCompareMode] = useState(false);
  const [compareGrid, setCompareGrid] = useState<"2x2" | "3x2" | "3x1">("2x2");
  const [compareSelected, setCompareSelected] = useState<string[]>([]);
  const [selection, setSelection] = useState<SurfaceSelection>(null);
  const [mapMoveActive, setMapMoveActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lockAttention, setLockAttention] = useState(false);
  const [mapEditHintDismissed, setMapEditHintDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPageScope, setExportPageScope] = useState<ExportPageScope | null>(null);
  const [exportPageIds, setExportPageIds] = useState<Set<string>>(new Set());
  const [layoutPopoverOpen, setLayoutPopoverOpen] = useState(false);
  const [notesPopoverOpen, setNotesPopoverOpen] = useState(false);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const layoutTriggerRef = useRef<HTMLButtonElement>(null);
  const notesTriggerRef = useRef<HTMLButtonElement>(null);
  const layoutPopoverRef = useRef<HTMLDivElement>(null);
  const notesPopoverRef = useRef<HTMLDivElement>(null);
  const [mobileViewport, setMobileViewport] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const settingsRef = useRef<HTMLElement>(null);
  const drawerOpenerRef = useRef<HTMLElement | null>(null);
  const lockAttentionTimerRef = useRef<number | null>(null);
  const [reportActionsTarget, setReportActionsTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setReportActionsTarget(document.getElementById("v2-report-actions"));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const syncViewport = () => {
      setMobileViewport(media.matches);
    };
    syncViewport();
    media.addEventListener?.("change", syncViewport);
    return () => media.removeEventListener?.("change", syncViewport);
  }, []);

  useEffect(() => {
    setMapEditHintDismissed(readMapEditHintDismissed(safeLocalStorage()));
  }, []);

  useEffect(() => () => {
    if (lockAttentionTimerRef.current !== null) window.clearTimeout(lockAttentionTimerRef.current);
  }, []);

  useEffect(() => {
    if (history.present === board.reportDoc) return;
    setHistory({ past: [], present: board.reportDoc, future: [] });
  }, [board.reportDoc, history.present]);

  useEffect(() => {
    if (selectedId && history.present.pages.some((page) => page.id === selectedId)) return;
    setSelectedId(history.present.pages[0]?.id ?? null);
    setSelectedSlideKey(null);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
  }, [history.present.pages, selectedId]);

  const planContext = useMemo(() => ({ summary, analysisDate, views }), [analysisDate, summary, views]);
  const plan = useMemo(() => planReportDoc(history.present, views, planContext), [history.present, planContext, views]);
  const stripItems = useMemo<PageStripItem[]>(() => pageStripItems(history.present.pages, plan), [history.present.pages, plan]);
  const selectStripItem = useCallback((id: string, slideKey: string) => {
    setSelectedId(id);
    setSelectedSlideKey(slideKey);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
    setLayoutPopoverOpen(false);
    setNotesPopoverOpen(false);
  }, []);
  const navigateStrip = useCallback((index: number) => {
    const item = stripItems[index];
    if (!item) return;
    selectStripItem(item.page.id, item.slide.key);
  }, [selectStripItem, stripItems]);
  const selectedSlide = useMemo<PlannedSlide | undefined>(() => {
    if (!selectedId) return undefined;
    return plan.find((slide) => slide.page?.id === selectedId && slide.key === selectedSlideKey)
      ?? plan.find((slide) => slide.page?.id === selectedId);
  }, [plan, selectedId, selectedSlideKey]);

  useEffect(() => {
    const current = selectedId && selectedSlideKey
      ? plan.find((slide) => slide.page?.id === selectedId && slide.key === selectedSlideKey)
      : undefined;
    const fallback = current ?? plan.find((slide) => slide.page?.id === selectedId) ?? plan[0];
    if (!fallback) {
      setSelectedId(null);
      setSelectedSlideKey(null);
      return;
    }
    if (selectedId !== fallback.page?.id) setSelectedId(fallback.page?.id ?? null);
    if (selectedSlideKey !== fallback.key) setSelectedSlideKey(fallback.key);
  }, [plan, selectedId, selectedSlideKey]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? null : current), 5000);
  }, []);

  const closeLayoutPopover = useCallback((restoreFocus = false) => {
    setLayoutPopoverOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => layoutTriggerRef.current?.focus());
  }, []);

  const closeNotesPopover = useCallback((restoreFocus = false) => {
    setNotesPopoverOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => notesTriggerRef.current?.focus());
  }, []);

  const toggleLayoutPopover = useCallback(() => {
    setRail(null);
    setNotesPopoverOpen(false);
    setLayoutPopoverOpen((current) => !current);
  }, []);

  const toggleNotesPopover = useCallback(() => {
    setRail(null);
    setLayoutPopoverOpen(false);
    setNotesPopoverOpen((current) => !current);
  }, []);

  useEffect(() => {
    if (!layoutPopoverOpen && !notesPopoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (layoutPopoverRef.current?.contains(event.target) || layoutTriggerRef.current?.contains(event.target)) return;
      if (notesPopoverRef.current?.contains(event.target) || notesTriggerRef.current?.contains(event.target)) return;
      closeLayoutPopover();
      closeNotesPopover();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closeLayoutPopover, closeNotesPopover, layoutPopoverOpen, notesPopoverOpen]);

  const commitDoc = useCallback((next: ReportDoc, message?: string) => {
    setHistory((current) => {
      if (current.present === next) return current;
      return { past: [...current.past.slice(-99), current.present], present: next, future: [] };
    });
    dispatch({ type: "reportDoc", doc: next });
    if (message) showToast(message);
  }, [dispatch, showToast]);

  const apply = useCallback((action: ReportDocAction, message?: string) => {
    const next = reportDocReducer(history.present, action);
    commitDoc(next, message);
  }, [commitDoc, history.present]);

  const undo = useCallback(() => {
    const previous = history.past[history.past.length - 1];
    if (!previous) return;
    setHistory({ past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] });
    dispatch({ type: "reportDoc", doc: previous });
  }, [dispatch, history]);

  const redo = useCallback(() => {
    const next = history.future[0];
    if (!next) return;
    setHistory({ past: [...history.past, history.present], present: next, future: history.future.slice(1) });
    dispatch({ type: "reportDoc", doc: next });
  }, [dispatch, history]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (layoutPopoverOpen || notesPopoverOpen) {
          event.preventDefault();
          if (layoutPopoverOpen) closeLayoutPopover(true);
          if (notesPopoverOpen) closeNotesPopover(true);
          return;
        }
        const current = { selected: selection?.kind === "map", moveActive: mapMoveActive, settingsOpen };
        const transitioned = transitionMapInteraction(current, "escape");
        if (current.moveActive || current.settingsOpen || current.selected) {
          event.preventDefault();
          setMapMoveActive(transitioned.moveActive);
          setSettingsOpen(transitioned.settingsOpen);
          if (!transitioned.selected) setSelection(null);
        }
        return;
      }
      if (event.key === "PageUp" || event.key === "PageDown") {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const keyTarget = document.activeElement instanceof HTMLElement ? document.activeElement : event.target instanceof HTMLElement ? event.target : null;
        if (keyTarget?.closest("#report-drawer, [role=\"dialog\"], [role=\"menu\"]") || isTypingTarget(keyTarget) || mapMoveActive) return;
        const current = stripItems.findIndex((item) => item.page.id === selectedId && (selectedSlideKey ? item.slide.key === selectedSlideKey : item.continuationIndex === 1));
        const next = stripNavIndex(stripItems.length, current, event.key);
        if (next === null) return;
        event.preventDefault();
        navigateStrip(next);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeLayoutPopover, closeNotesPopover, layoutPopoverOpen, mapMoveActive, navigateStrip, notesPopoverOpen, redo, selectedId, selectedSlideKey, selection, settingsOpen, stripItems, undo]);

  const addPages = useCallback((pages: ReportPage[], message?: string) => {
    if (pages.length === 0) return;
    const index = insertIndexAfter(history.present, selectedId);
    const first = pages[0]!;
    apply({ type: "add", pages, index }, message ?? `${pageTypeLabel(first)} 페이지를 ${index + 1}쪽에 추가했습니다.`);
    setSelectedId(pages[0].id);
    setSelectedSlideKey(null);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
  }, [apply, history.present, selectedId]);

  const addPage = useCallback((kind: PageAddKind) => {
    if (kind === "tile") {
      setCompareMode(false);
      setRail("tiles");
      return;
    }
    if (kind === "compare") {
      setCompareSelected([]);
      setCompareGrid("2x2");
      setCompareMode(true);
      setRail("tiles");
      return;
    }
    const page = simplePage(history.present, kind);
    addPages([page]);
  }, [addPages, history.present]);

  const addTile = useCallback((tileId: string) => {
    const view = views.get(tileId);
    if (!view) return;
    const pages = pagesForTile(history.present, tileId, view, tileReportSettingsFromBoard(board, tileId), planContext);
    const index = insertIndexAfter(history.present, selectedId);
    addPages(pages, `${view.title} 페이지를 ${index + 1}쪽에 추가했습니다.`);
  }, [addPages, board, history.present, planContext, selectedId, views]);

  const startRecommended = useCallback(() => {
    const empty = { ...EMPTY_REPORT_DOC, pages: [] };
    const pages = recommendedPages(empty, views, board, planContext);
    const next: ReportDoc = { ...history.present, pages };
    commitDoc(next, "추천 구성으로 시작했습니다.");
    setRail(null);
    setSelectedId(pages[0]?.id ?? null);
    setSelectedSlideKey(null);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
  }, [board, commitDoc, history.present, planContext, views]);

  const importLegacy = useCallback(() => {
    const empty = { ...EMPTY_REPORT_DOC, pages: [] };
    const pages = importLegacyReport(empty, board, views, planContext);
    commitDoc({ ...history.present, pages }, "이전 보고서 구성을 불러왔습니다.");
    setSelectedId(pages[0]?.id ?? null);
    setSelectedSlideKey(null);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
  }, [board, commitDoc, history.present, planContext, views]);

  const dropMovePage = useCallback((id: string, to: number) => {
    const from = history.present.pages.findIndex((page) => page.id === id);
    if (from < 0 || to < 0 || to >= history.present.pages.length || to === from) return;
    apply({ type: "move", id, to }, reorderMessage(from, to));
  }, [apply, history.present.pages]);

  const reorderPage = useCallback((id: string, key: "ArrowLeft" | "ArrowRight") => {
    const action = moveByKey(history.present, id, key);
    if (!action) return;
    const from = history.present.pages.findIndex((page) => page.id === id);
    if (from < 0) return;
    apply(action, reorderMessage(from, action.to));
  }, [apply, history.present]);

  const deletePage = useCallback((id: string) => {
    const index = history.present.pages.findIndex((page) => page.id === id);
    const page = history.present.pages[index];
    apply({ type: "remove", id }, `${page ? pageTitleForToast(page, views) : "페이지"} 페이지를 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.`);
    if (selectedId === id) {
      setSelectedId(history.present.pages[Math.max(0, index - 1)]?.id ?? history.present.pages[index + 1]?.id ?? null);
      setSelectedSlideKey(null);
      setSelection(null);
      setMapMoveActive(false);
      setSettingsOpen(false);
    }
  }, [apply, history.present.pages, selectedId, views]);

  const duplicatePage = useCallback((id: string) => {
    apply({ type: "duplicate", id }, "페이지를 복제했습니다.");
  }, [apply]);

  const addComparePage = useCallback(() => {
    if (compareSelected.length < 2) return;
    const cells = compareSelected.map((tileId) => ({ tileId, settings: tileReportSettingsFromBoard(board, tileId), frame: defaultFrame() }));
    const page: ReportPage = {
      id: newPageId(history.present),
      layout: "side-by-side",
      panels: {},
      textBoxes: [],
      notes: "",
      kind: "compare",
      grid: compareGrid,
      sameExtent: true,
      cells,
    };
    addPages([page]);
    setCompareSelected([]);
    setCompareMode(false);
    setRail("pages");
  }, [addPages, board, compareGrid, compareSelected, history.present]);

  const addTextBox = useCallback(() => {
    if (!selectedId) return;
    const page = history.present.pages.find((candidate) => candidate.id === selectedId);
    if (!page) return;
    const box: TextBox = { id: `text-${Date.now().toString(36)}`, x: 4.4, y: 3.1, w: 4.4, h: 0.72, text: "", pt: 16 };
    apply({ type: "textBox", id: selectedId, box }, "글상자를 추가했습니다.");
    setSelection({ kind: "textBox", id: box.id });
  }, [apply, history.present.pages, selectedId]);

  const applyTextBox = useCallback((box: TextBox | { id: string; remove: true }) => {
    if (!selectedId) return;
    apply({ type: "textBox", id: selectedId, box });
  }, [apply, selectedId]);

  const editPanelText = useCallback((kind: "title" | "summary") => {
    if (!selectedId) return;
    const page = history.present.pages.find((candidate) => candidate.id === selectedId);
    if (!page || page.kind !== "tile") return;
    const view = views.get(page.tileId);
    const current = kind === "title" ? page.titleOverride ?? view?.title ?? "" : page.summaryOverride ?? view?.sentence ?? "";
    const next = window.prompt(kind === "title" ? "페이지 제목" : "페이지 요약", current);
    if (next === null) return;
    apply({ type: "text", id: selectedId, ...(kind === "title" ? { title: next } : { summary: next }) });
  }, [apply, history.present.pages, selectedId, views]);

  const applyFrame = useCallback((cell: number | undefined, patch: Partial<ReturnType<typeof defaultFrame>>) => {
    if (!selectedId) return;
    const page = history.present.pages.find((candidate) => candidate.id === selectedId);
    if (!page) return;
    if (page.kind === "compare" && page.sameExtent && cell !== undefined && (patch.zoomDelta !== undefined || patch.offsetM !== undefined || patch.scaleDenominator !== undefined)) {
      let next = history.present;
      page.cells.forEach((_candidate, index) => {
        next = reportDocReducer(next, { type: "frame", id: selectedId, cell: index, patch });
      });
      commitDoc(next);
      return;
    }
    apply({ type: "frame", id: selectedId, cell, patch });
  }, [apply, commitDoc, history.present, selectedId]);

  const applyPanels = useCallback((panels: PagePanels) => {
    if (selectedId) apply({ type: "panels", id: selectedId, panels });
  }, [apply, selectedId]);

  const rememberDrawerOpener = useCallback((opener?: HTMLElement | null) => {
    if (opener) {
      drawerOpenerRef.current = opener;
      return;
    }
    if (document.activeElement instanceof HTMLElement) drawerOpenerRef.current = document.activeElement;
  }, []);
  const handleSurfaceSelect = useCallback((next: SurfaceSelection) => {
    const current = { selected: selection?.kind === "map", moveActive: mapMoveActive, settingsOpen };
    if (next?.kind === "map") {
      const page = history.present.pages.find((candidate) => candidate.id === selectedId);
      if (!reportPageMapSelectable(page)) return;
      rememberDrawerOpener();
      const transitioned = transitionMapInteraction(current, "select");
      setLayoutPopoverOpen(false);
      setNotesPopoverOpen(false);
      setSelection(next);
      setMapMoveActive(transitioned.moveActive);
      setSettingsOpen(transitioned.settingsOpen);
      setRail(null);
      return;
    }
    if (next === null) {
      const transitioned = transitionMapInteraction(current, "outside-slide");
      setMapMoveActive(transitioned.moveActive);
      setSettingsOpen(transitioned.settingsOpen);
      if (!transitioned.selected) setSelection(null);
      return;
    }
    setMapMoveActive(false);
    setSettingsOpen(false);
    setSelection(next);
  }, [history.present.pages, mapMoveActive, rememberDrawerOpener, selectedId, selection, settingsOpen]);
  const toggleRail = useCallback((next: RailKey, opener?: HTMLElement | null) => {
    rememberDrawerOpener(opener);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
    setLayoutPopoverOpen(false);
    setNotesPopoverOpen(false);
    setRail((current) => current === next ? null : next);
  }, [rememberDrawerOpener]);
  const addTextBoxFromRail = useCallback((opener?: HTMLElement | null) => {
    rememberDrawerOpener(opener);
    const opening = rail !== "textbox";
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
    setLayoutPopoverOpen(false);
    setNotesPopoverOpen(false);
    setRail(opening ? "textbox" : null);
    if (opening) addTextBox();
  }, [addTextBox, rail, rememberDrawerOpener]);
  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    const tileId = event.dataTransfer.getData("text/report-tile");
    if (!tileId) return;
    event.preventDefault();
    addTile(tileId);
  }, [addTile]);
  const toggleCompareTile = useCallback((tileId: string) => {
    const max = compareGrid === "3x2" ? 6 : compareGrid === "3x1" ? 3 : 4;
    setCompareSelected((current) => current.includes(tileId)
      ? current.filter((id) => id !== tileId)
      : current.length < max ? [...current, tileId] : current);
  }, [compareGrid]);

  const selectedPage = selectedId ? history.present.pages.find((page) => page.id === selectedId) : undefined;
  const selectedPageMapSelectable = reportPageMapSelectable(selectedPage);
  const editableMapPage = selectedPage?.kind === "tile" || selectedPage?.kind === "compare" ? selectedPage : null;
  const mapCell = selectedPage?.kind === "compare" ? (selection?.kind === "map" && selection.cell !== undefined ? selection.cell : 0) : undefined;
  const mapFrame = selectedPage?.kind === "tile"
    ? selectedPage.frame
    : selectedPage?.kind === "compare"
      ? selectedPage.cells[mapCell ?? 0]?.frame
      : undefined;
  const mapTileId = selectedPage?.kind === "tile"
    ? selectedPage.tileId
    : selectedPage?.kind === "compare"
      ? selectedPage.cells[mapCell ?? 0]?.tileId
      : undefined;
  const mapView = mapTileId ? views.get(mapTileId) ?? null : null;
  const mapModel = mapView?.map ?? mapView?.backdrop ?? null;
  const mapScaleOptions = selectedPage ? mapFrameScaleOptions(history.present.format, selectedPage.layout, {
    siteX: slideSiteX(selectedSlide?.style, selectedPage.layout !== "side-by-side", history.present.format),
    fill: selectedSlide?.kind === "tile" && selectedSlide.callout?.page === 0 ? SLIDE_OVERVIEW_FILL : 0.8,
  }) : null;
  const mapScale = mapFrame && mapModel && mapScaleOptions ? scaleForFrame(mapModel, mapFrame, mapScaleOptions) : 1000;
  const mapEditing = !!mapFrame && !!mapModel && !!editableMapPage && selection?.kind === "map" && mapMoveActive;
  const stageSize = slideGeometry(history.present.format);
  const legacyAvailable = hasLegacyReport(board);
  const mapSelection = useCallback((cell = mapCell): SurfaceSelection => ({ kind: "map", ...(cell === undefined ? {} : { cell }) }), [mapCell]);
  const signalLockAttention = useCallback(() => {
    setLockAttention(true);
    if (lockAttentionTimerRef.current !== null) window.clearTimeout(lockAttentionTimerRef.current);
    lockAttentionTimerRef.current = window.setTimeout(() => {
      setLockAttention(false);
      lockAttentionTimerRef.current = null;
    }, 600);
  }, []);
  const dismissMapEditHintOnce = useCallback(() => {
    setMapEditHintDismissed(true);
    dismissMapEditHint(safeLocalStorage());
  }, []);
  const enterMapMove = useCallback(() => {
    if (!selectedPageMapSelectable) return;
    const current = { selected: selection?.kind === "map", moveActive: mapMoveActive, settingsOpen };
    const transitioned = transitionMapInteraction(current, "enter-move", mapFrame?.locked === true);
    if (mapFrame?.locked) {
      signalLockAttention();
      return;
    }
    rememberDrawerOpener();
    setSelection((current) => current?.kind === "map" ? current : mapSelection());
    setRail(null);
    setSettingsOpen(transitioned.settingsOpen);
    setMapMoveActive(transitioned.moveActive);
    if (transitioned.moveActive) dismissMapEditHintOnce();
  }, [dismissMapEditHintOnce, mapFrame?.locked, mapMoveActive, mapSelection, rememberDrawerOpener, selectedPageMapSelectable, selection, settingsOpen, signalLockAttention]);
  const setMapMoveFromSurface = useCallback((active: boolean) => {
    if (active) enterMapMove();
    else {
      const transitioned = transitionMapInteraction({ selected: selection?.kind === "map", moveActive: mapMoveActive, settingsOpen }, "end-move");
      setMapMoveActive(transitioned.moveActive);
      setSettingsOpen(transitioned.settingsOpen);
    }
  }, [enterMapMove, mapMoveActive, selection, settingsOpen]);
  const openMapSettings = useCallback(() => {
    if (!selectedPageMapSelectable) return;
    if (!settingsOpen) rememberDrawerOpener();
    const transitioned = transitionMapInteraction({ selected: true, moveActive: mapMoveActive, settingsOpen }, settingsOpen ? "close-settings" : "open-settings");
    setSelection((current) => current?.kind === "map" ? current : mapSelection());
    setRail(null);
    setMapMoveActive(transitioned.moveActive);
    setSettingsOpen(transitioned.settingsOpen);
  }, [mapMoveActive, mapSelection, rememberDrawerOpener, selectedPageMapSelectable, settingsOpen]);
  const closeMapSettings = useCallback(() => {
    const transitioned = transitionMapInteraction({ selected: selection?.kind === "map", moveActive: mapMoveActive, settingsOpen }, "close-settings");
    setMapMoveActive(transitioned.moveActive);
    setSettingsOpen(transitioned.settingsOpen);
  }, [mapMoveActive, selection, settingsOpen]);
  const endMapMove = useCallback(() => {
    const transitioned = transitionMapInteraction({ selected: selection?.kind === "map", moveActive: mapMoveActive, settingsOpen }, "end-move");
    setMapMoveActive(transitioned.moveActive);
    setSettingsOpen(transitioned.settingsOpen);
  }, [mapMoveActive, selection, settingsOpen]);
  const toggleMapLock = useCallback(() => {
    if (!mapFrame) return;
    if (!mapFrame.locked) setMapMoveActive(false);
    applyFrame(mapCell, { locked: !mapFrame.locked });
  }, [applyFrame, mapCell, mapFrame]);

  const closeDrawer = useCallback(() => {
    setRail(null);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
    setLayoutPopoverOpen(false);
    setNotesPopoverOpen(false);
  }, []);
  const drawerOpen = rail !== null;
  const modalContentInert = exportOpen || (mobileViewport && (drawerOpen || settingsOpen));
  useFocusTrap({ ref: drawerRef, active: mobileViewport && drawerOpen, onClose: closeDrawer, restoreFocusRef: drawerOpenerRef });
  useFocusTrap({ ref: settingsRef, active: mobileViewport && settingsOpen, onClose: closeMapSettings, restoreFocusRef: drawerOpenerRef });

  const closeExport = useCallback(() => {
    setExportOpen(false);
    setExportPageScope(null);
    setExportPageIds(new Set());
  }, []);
  const handleExportScopeChange = useCallback((scope: ExportPageScope | null) => {
    setExportPageScope(scope);
    if (scope !== "selected") setExportPageIds(new Set());
  }, []);
  const enterSelectedExportPages = useCallback(() => {
    const id = selectedId ?? history.present.pages[0]?.id;
    setExportPageIds(id ? new Set([id]) : new Set());
  }, [history.present.pages, selectedId]);
  const toggleExportPage = useCallback((id: string) => {
    setExportPageIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const viewExportPage = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedSlideKey(plan.find((slide) => slide.page?.id === id)?.key ?? null);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
  }, [plan]);

  const handleMapEscapeCapture = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || layoutPopoverOpen || notesPopoverOpen) return;
    const current = { selected: selection?.kind === "map", moveActive: mapMoveActive, settingsOpen };
    if (!current.moveActive && !current.settingsOpen && !current.selected) return;
    const transitioned = transitionMapInteraction(current, "escape");
    event.preventDefault();
    event.stopPropagation();
    setMapMoveActive(transitioned.moveActive);
    setSettingsOpen(transitioned.settingsOpen);
    if (!transitioned.selected) setSelection(null);
  };

  return (
    <section className={styles.reportRoot} data-report-root aria-label="보고서 모드" onKeyDownCapture={handleMapEscapeCapture} onPointerDownCapture={(event) => {
      if (!mapMoveActive || selection?.kind !== "map") return;
      const target = event.target as HTMLElement;
      if (!target.closest("[data-preview-map]") && !target.closest("[data-map-toolbar]")) setMapMoveActive(false);
    }}>
      <h1 className={styles.srOnly}>{summary.address} 보고서</h1>
      {reportActionsTarget && createPortal(
        <div className={styles.reportHeaderActions} inert={modalContentInert || undefined}>
          <span className={styles.saveState} data-dirty={dirty ? "true" : "false"}>{dirty ? "저장 안 됨" : "저장됨"}</span>
          <button type="button" className={styles.iconButton} onClick={undo} disabled={history.past.length === 0} aria-label="되돌리기" title="되돌리기">↶</button>
          <button type="button" className={styles.iconButton} onClick={redo} disabled={history.future.length === 0} aria-label="다시 실행" title="다시 실행">↷</button>
          <label className={styles.headerFormat}>
            <span className={styles.srOnly}>보고서 판형</span>
            <select value={history.present.format} onChange={(event) => { const format = event.target.value as ReportFormat; apply({ type: "format", format }, `${formatLabel(format)} 판형으로 바꿨습니다.`); }} aria-label="보고서 판형">
              <option value="wide">{formatLabel("wide")}</option>
              <option value="a3">{formatLabel("a3")}</option>
              <option value="a4">{formatLabel("a4")}</option>
            </select>
          </label>
          <button type="button" className={styles.secondaryButton} onClick={onPresentation} disabled={demo || busy || history.present.pages.length === 0} aria-label="발표 미리보기">발표 미리보기</button>
          <button ref={exportTriggerRef} type="button" className={styles.primaryDarkButton} onClick={() => setExportOpen(true)} disabled={demo || busy || history.present.pages.length === 0} aria-haspopup="dialog" aria-expanded={exportOpen} aria-controls={exportOpen ? "report-export-panel" : undefined}>내보내기</button>
        </div>,
        reportActionsTarget,
      )}
      {exportOpen && <ExportPanel
        plan={plan}
        format={history.present.format}
        basemap={basemap}
        currentPageId={selectedId}
        selectedPageIds={exportPageIds}
        defaultFileName={reportFileName(summary.address, analysisDate)}
        dialogRef={exportDialogRef}
        restoreFocusRef={exportTriggerRef}
        onClose={closeExport}
        onPageScopeChange={handleExportScopeChange}
        onEnterSelectedPages={enterSelectedExportPages}
        onToggleSelectedPage={toggleExportPage}
        onViewPage={viewExportPage}
      />}
      <div className={styles.reportBody} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <main
          className={styles.reportStage}
          data-drawer-open={drawerOpen ? "true" : "false"}
          data-settings-open={settingsOpen ? "true" : "false"}
        >
          <div
            className={styles.stageFit}
            data-report-stage
            data-slide-format={history.present.format}
            style={{ "--stage-slide-width": stageSize.w, "--stage-slide-height": stageSize.h } as CSSProperties}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              handleSurfaceSelect(null);
            }}
            inert={modalContentInert || undefined}
          >
            {history.present.pages.length === 0 ? (
              <div className={styles.emptyReport}>
                <div className={styles.emptyCanvas}><span className={styles.emptyCanvasMark} aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 5v14M5 12h14" /></svg></span><strong>페이지를 추가하세요</strong><span>보고서의 첫 장을 선택해 작업을 시작합니다.</span></div>
                <div className={styles.emptyActions}><button type="button" className={styles.primaryButton} onClick={() => addPage("blank")}>＋ 페이지 추가</button><button type="button" className={styles.secondaryButton} onClick={startRecommended}>추천 구성으로 시작</button>{legacyAvailable && <button type="button" className={styles.linkButton} onClick={importLegacy}>이전 보고서 구성 불러오기</button>}</div>
              </div>
            ) : selectedSlide ? (
              <>
                <div className={styles.stageSlide}>
                  <SlideSurface slide={selectedSlide} basemap={basemap} mode="edit" selection={selection} onSelect={handleSurfaceSelect} onMapMoveActive={setMapMoveFromSurface} onFrame={applyFrame} onPanels={applyPanels} onTextBox={applyTextBox} onText={editPanelText} onSheetCellActivate={(index) => { handleSurfaceSelect({ kind: "map", cell: index }); setMapMoveActive(false); }} mapActive={mapEditing} classMap={surfaceClassMap} />
                </div>
              </>
            ) : <div className={styles.emptyCanvas}>이 페이지는 아직 미리보기를 준비하고 있습니다.</div>}
          </div>

          {selection?.kind === "map" && editableMapPage && mapFrame && mapScaleOptions && <aside
            ref={settingsRef}
            id="report-map-settings"
            className={`${styles.floatCard} ${styles.settingsCard}`}
            data-settings-open={settingsOpen ? "true" : "false"}
            data-mobile-sheet={mobileViewport && settingsOpen ? "open" : "closed"}
            role={mobileViewport && settingsOpen ? "dialog" : undefined}
            aria-modal={mobileViewport && settingsOpen ? true : undefined}
            aria-hidden={settingsOpen ? undefined : true}
            inert={exportOpen || !settingsOpen ? true : undefined}
            aria-label="지도 설정"
          >
            {mobileViewport && settingsOpen && <button type="button" className={styles.sheetClose} onClick={closeMapSettings} aria-label="지도 설정 닫기">닫기</button>}
            {settingsOpen && <DrawerMap page={editableMapPage} frame={mapFrame} view={mapView} cell={mapCell} scaleOptions={mapScaleOptions} sameExtent={editableMapPage.kind === "compare" ? editableMapPage.sameExtent : undefined} onSameExtent={editableMapPage.kind === "compare" ? (value) => apply({ type: "sameExtent", id: editableMapPage.id, value }) : undefined} onFrame={(patch: Partial<MapFrameState>) => { if (patch.locked === true) setMapMoveActive(false); applyFrame(mapCell, patch); }} />}
          </aside>}

          <nav className={`${styles.floatCard} ${styles.toolPill}`} aria-label="보고서 요소" inert={modalContentInert || undefined}>
            <button type="button" className={`${styles.railButton} ${rail === "pages" ? styles.railButtonActive : ""}`} aria-pressed={rail === "pages"} aria-expanded={rail === "pages" && drawerOpen} aria-controls="report-drawer" onClick={(event) => toggleRail("pages", event.currentTarget)}><span aria-hidden="true"><RailIcon name="pages" /></span><span>페이지</span></button>
            <button type="button" className={`${styles.railButton} ${rail === "tiles" ? styles.railButtonActive : ""}`} aria-pressed={rail === "tiles"} aria-expanded={rail === "tiles" && drawerOpen} aria-controls="report-drawer" onClick={(event) => toggleRail("tiles", event.currentTarget)}><span aria-hidden="true"><RailIcon name="tiles" /></span><span>분석 타일</span></button>
            <button type="button" className={`${styles.railButton} ${rail === "textbox" ? styles.railButtonActive : ""}`} aria-pressed={rail === "textbox"} aria-expanded={rail === "textbox" && drawerOpen} aria-controls="report-drawer" onClick={(event) => addTextBoxFromRail(event.currentTarget)}><span aria-hidden="true"><RailIcon name="textbox" /></span><span>글상자</span></button>
            <button type="button" className={`${styles.railButton} ${rail === "theme" ? styles.railButtonActive : ""}`} aria-pressed={rail === "theme"} aria-expanded={rail === "theme" && drawerOpen} aria-controls="report-drawer" onClick={(event) => toggleRail("theme", event.currentTarget)}><span aria-hidden="true"><RailIcon name="theme" /></span><span>테마</span></button>
          </nav>

          <aside
            ref={drawerRef}
            id="report-drawer"
            className={`${styles.floatCard} ${styles.drawerCard}`}
            data-drawer-open={drawerOpen ? "true" : "false"}
            data-mobile-sheet={mobileViewport && drawerOpen ? "open" : "closed"}
            role={mobileViewport && drawerOpen ? "dialog" : undefined}
            aria-modal={mobileViewport && drawerOpen ? true : undefined}
            aria-hidden={drawerOpen ? undefined : true}
            inert={exportOpen || !drawerOpen ? true : undefined}
            aria-label={rail === "tiles" ? "분석 타일 추가" : rail === "textbox" ? "글상자 추가" : rail === "theme" ? "테마 설정" : rail === "layout" ? "페이지 레이아웃" : "페이지 추가"}
          >
            {mobileViewport && drawerOpen && <button type="button" className={styles.sheetClose} onClick={closeDrawer}>닫기</button>}
            {rail === "pages" && <DrawerPages open hasLegacy={legacyAvailable} onAdd={addPage} onRecommended={startRecommended} onLegacy={importLegacy} />}
            {rail === "tiles" && <DrawerTiles open doc={history.present} views={views} mode={compareMode ? "compare" : "single"} compareGrid={compareGrid} compareSelected={compareSelected} onCompareGrid={setCompareGrid} onAdd={addTile} onToggleCompare={toggleCompareTile} onCreateCompare={addComparePage} onCancelCompare={() => { setCompareSelected([]); setCompareMode(false); }} />}
            {rail === "textbox" && <TextBoxDrawer onAdd={addTextBox} />}
            {rail === "theme" && <ThemeDrawer doc={history.present} onFormat={(format) => apply({ type: "format", format }, `${formatLabel(format)} 판형으로 바꿨습니다.`)} onFontScale={(fontScale) => apply({ type: "theme", fontScale }, `${fontScale}배 글자 크기를 적용했습니다.`)} onClose={() => mobileViewport ? closeDrawer() : setRail("pages")} />}
            {rail === "layout" && selectedPage && <div className={styles.drawer}><LayoutSwitcher value={selectedPage.layout} onChange={(layout) => apply({ type: "layout", id: selectedPage.id, layout })} /></div>}
          </aside>

          <div className={`${styles.floatCard} ${styles.pageDock}`} inert={modalContentInert || undefined}>
            <div className={`${styles.dockLead} ${selection?.kind === "map" ? styles.mapDockLead : ""}`} data-dock-lead="true">
              {selection?.kind === "map" && mapFrame && mapModel ? (
                <>
                  <MapToolbar
                    scale={mapScale}
                    locked={mapFrame.locked}
                    editing={mapEditing}
                    settingsOpen={settingsOpen}
                    lockAttention={lockAttention}
                    onZoom={(delta) => applyFrame(mapCell, { zoomDelta: mapFrame.zoomDelta + delta, scaleDenominator: null })}
                    onFit={() => applyFrame(mapCell, SITE_FIT_PATCH)}
                    onToggleLock={toggleMapLock}
                    onToggleSettings={openMapSettings}
                    onDone={endMapMove}
                  />
                  {!mapEditHintDismissed && <div className={styles.mapEditHint} role="status">
                    <span>두 번 눌러 지도 편집</span>
                    <button type="button" onClick={dismissMapEditHintOnce} aria-label="지도 편집 안내 닫기" title="지도 편집 안내 닫기">×</button>
                  </div>}
                </>
              ) : (
                <>
              <div className={styles.dockPopoverRoot}>
                <button ref={layoutTriggerRef} type="button" className={styles.dockButton} aria-haspopup="dialog" aria-expanded={layoutPopoverOpen} aria-controls={layoutPopoverOpen ? "report-layout-menu" : undefined} aria-label="페이지 레이아웃 메뉴" onClick={toggleLayoutPopover} disabled={!selectedPage}>
                  <span aria-hidden="true">▥</span><span>레이아웃</span>
                </button>
                {layoutPopoverOpen && selectedPage && <div ref={layoutPopoverRef} id="report-layout-menu" className={`${styles.floatCard} ${styles.dockPopover}`} role="dialog" aria-label="페이지 레이아웃">
                  <LayoutSwitcher compact value={selectedPage.layout} onChange={(layout) => apply({ type: "layout", id: selectedPage.id, layout })} />
                </div>}
              </div>
              <div className={styles.dockPopoverRoot}>
                <button ref={notesTriggerRef} type="button" className={styles.dockButton} aria-haspopup="dialog" aria-expanded={notesPopoverOpen} aria-controls={notesPopoverOpen ? "report-notes-popover" : undefined} aria-label={selectedPage?.notes.trim() ? "발표 메모 있음" : "발표 메모"} data-has-notes={selectedPage?.notes.trim() ? "true" : "false"} onClick={toggleNotesPopover} disabled={!selectedPage}>
                  <span aria-hidden="true">✎</span><span>메모</span>{selectedPage?.notes.trim() && <span className={styles.noteDot} aria-hidden="true" />}
                </button>
                {notesPopoverOpen && selectedPage && <div ref={notesPopoverRef} id="report-notes-popover" className={`${styles.floatCard} ${styles.dockPopover} ${styles.notesPopover}`} role="dialog" aria-label="발표 메모">
                  <NotesField compact pageId={selectedPage.id} value={selectedPage.notes} onChange={(notes) => apply({ type: "notes", id: selectedPage.id, notes })} />
                </div>}
              </div>
                </>
              )}
            </div>
            <PageStrip items={stripItems} selectedId={selectedId} selectedSlideKey={selectedSlideKey} onSelect={selectStripItem} onNavigate={navigateStrip} onReorder={reorderPage} onDropMove={dropMovePage} onAddPage={() => { setRail("pages"); setSelection(null); setMapMoveActive(false); setSettingsOpen(false); addPage("blank"); }} onDuplicate={duplicatePage} onDelete={deletePage} classMap={surfaceClassMap} exportSelectionMode={exportPageScope === "selected"} exportPageIds={exportPageIds} onToggleExportPage={toggleExportPage} />
          </div>
        </main>
      </div>
      {toast && <div className={styles.toast} role="status"><span className={styles.toastText}>{toast}</span><button type="button" onClick={() => { setToast(null); undo(); }}>되돌리기</button></div>}
    </section>
  );
}

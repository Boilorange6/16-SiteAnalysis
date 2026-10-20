"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { Dispatch } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { defaultFrame, EMPTY_REPORT_DOC, newPageId, reportDocReducer, type MapFrameState, type PagePanels, type ReportDoc, type ReportDocAction, type ReportFontScale, type ReportFormat, type ReportPage, type TextBox } from "@/lib/v2/report/report-doc";
import { mapFrameScaleOptions, scaleForFrame } from "@/lib/v2/ui/report-scale";
import { SLIDE_OVERVIEW_FILL } from "@/lib/v2/ui/callout-layout";
import { slideSiteX } from "@/lib/v2/ui/overlay-layout";
import { importLegacyReport, hasLegacyReport, pagesForTile, planReportDoc, recommendedPages } from "@/lib/v2/report/report-doc-plan";
import { pageStripItems } from "@/lib/v2/report/report-page-strip";
import { reportFileName, tileReportSettingsFromBoard, type PlannedSlide } from "@/lib/v2/report/report-plan";
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
  const [rail, setRail] = useState<RailKey | null>("pages");
  const [compareMode, setCompareMode] = useState(false);
  const [compareGrid, setCompareGrid] = useState<"2x2" | "3x2" | "3x1">("2x2");
  const [compareSelected, setCompareSelected] = useState<string[]>([]);
  const [selection, setSelection] = useState<SurfaceSelection>(null);
  const [mapMoveActive, setMapMoveActive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPageScope, setExportPageScope] = useState<ExportPageScope | null>(null);
  const [exportPageIds, setExportPageIds] = useState<Set<string>>(new Set());
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const [mobileViewport, setMobileViewport] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerOpenerRef = useRef<HTMLElement | null>(null);
  const [reportActionsTarget, setReportActionsTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setReportActionsTarget(document.getElementById("v2-report-actions"));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const syncViewport = () => {
      setMobileViewport(media.matches);
      setRail((current) => media.matches ? initialReportRail(true) : current ?? initialReportRail(false));
    };
    syncViewport();
    media.addEventListener?.("change", syncViewport);
    return () => media.removeEventListener?.("change", syncViewport);
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
  }, [history.present.pages, selectedId]);

  const planContext = useMemo(() => ({ summary, analysisDate, views }), [analysisDate, summary, views]);
  const plan = useMemo(() => planReportDoc(history.present, views, planContext), [history.present, planContext, views]);
  const stripItems = useMemo<PageStripItem[]>(() => pageStripItems(history.present.pages, plan), [history.present.pages, plan]);
  const selectStripItem = useCallback((id: string, slideKey: string) => {
    setSelectedId(id);
    setSelectedSlideKey(slideKey);
    setSelection(null);
    setMapMoveActive(false);
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
    window.setTimeout(() => setToast((current) => current === message ? null : current), 1800);
  }, []);

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
        if (mapMoveActive) {
          event.preventDefault();
          setMapMoveActive(false);
        } else if (selection?.kind === "map") {
          event.preventDefault();
          setSelection(null);
          setRail("pages");
        }
        return;
      }
      if (event.key === "PageUp" || event.key === "PageDown") {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (isTypingTarget(event.target instanceof HTMLElement ? event.target : null) || mapMoveActive) return;
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
  }, [mapMoveActive, navigateStrip, redo, selectedId, selectedSlideKey, selection, stripItems, undo]);

  const addPages = useCallback((pages: ReportPage[], message?: string) => {
    if (pages.length === 0) return;
    const index = insertIndexAfter(history.present, selectedId);
    const first = pages[0]!;
    apply({ type: "add", pages, index }, message ?? `${pageTypeLabel(first)} 페이지를 ${index + 1}쪽에 추가했습니다.`);
    setSelectedId(pages[0].id);
    setSelectedSlideKey(null);
    setSelection(null);
    setMapMoveActive(false);
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
    setSelectedId(pages[0]?.id ?? null);
    setSelectedSlideKey(null);
    setSelection(null);
    setMapMoveActive(false);
  }, [board, commitDoc, history.present, planContext, views]);

  const importLegacy = useCallback(() => {
    const empty = { ...EMPTY_REPORT_DOC, pages: [] };
    const pages = importLegacyReport(empty, board, views, planContext);
    commitDoc({ ...history.present, pages }, "이전 보고서 구성을 불러왔습니다.");
    setSelectedId(pages[0]?.id ?? null);
    setSelectedSlideKey(null);
    setSelection(null);
    setMapMoveActive(false);
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
    const current = { selected: selection?.kind === "map", moveActive: mapMoveActive, settingsOpen: false };
    if (next?.kind === "map") {
      const page = history.present.pages.find((candidate) => candidate.id === selectedId);
      if (!reportPageMapSelectable(page)) return;
      rememberDrawerOpener();
      const transitioned = transitionMapInteraction(current, "select");
      setSelection(next);
      setMapMoveActive(transitioned.moveActive);
      setRail(null);
      return;
    }
    if (next === null) {
      const transitioned = transitionMapInteraction(current, "outside-slide");
      setMapMoveActive(transitioned.moveActive);
      if (!transitioned.selected) {
        setSelection(null);
        if (current.selected) setRail("pages");
      }
      return;
    }
    setMapMoveActive(false);
    setSelection(next);
  }, [history.present.pages, mapMoveActive, rememberDrawerOpener, selectedId, selection]);
  const toggleRail = useCallback((next: RailKey, opener?: HTMLElement | null) => {
    rememberDrawerOpener(opener);
    setSelection(null);
    setMapMoveActive(false);
    setRail((current) => current === next ? null : next);
  }, [rememberDrawerOpener]);
  const addTextBoxFromRail = useCallback((opener?: HTMLElement | null) => {
    rememberDrawerOpener(opener);
    const opening = rail !== "textbox";
    setSelection(null);
    setMapMoveActive(false);
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
  const mapEditing = !!mapFrame && !!mapModel && !!editableMapPage && selection?.kind === "map";
  const legacyAvailable = hasLegacyReport(board);
  const mapSelection = useCallback((cell = mapCell): SurfaceSelection => ({ kind: "map", ...(cell === undefined ? {} : { cell }) }), [mapCell]);
  const enterMapMove = useCallback(() => {
    if (!selectedPageMapSelectable) return;
    rememberDrawerOpener();
    setSelection((current) => current?.kind === "map" ? current : mapSelection());
    setRail(null);
    setMapMoveActive(true);
  }, [mapSelection, rememberDrawerOpener, selectedPageMapSelectable]);
  const setMapMoveFromSurface = useCallback((active: boolean) => {
    if (active) enterMapMove();
    else setMapMoveActive(false);
  }, [enterMapMove]);
  const openMapSettings = useCallback(() => {
    handleSurfaceSelect(mapSelection());
    setMapMoveActive(false);
  }, [handleSurfaceSelect, mapSelection]);
  const toggleMapMove = useCallback(() => {
    if (selection?.kind === "map") {
      const transitioned = transitionMapInteraction({ selected: true, moveActive: mapMoveActive, settingsOpen: false }, "toggle-move");
      setMapMoveActive(transitioned.moveActive);
      return;
    }
    enterMapMove();
  }, [enterMapMove, mapMoveActive, selection]);
  const toggleMapLock = useCallback(() => {
    if (!mapFrame) return;
    if (!mapFrame.locked) setMapMoveActive(false);
    applyFrame(mapCell, { locked: !mapFrame.locked });
  }, [applyFrame, mapCell, mapFrame]);

  const closeDrawer = useCallback(() => {
    setRail(null);
    setSelection(null);
    setMapMoveActive(false);
  }, []);
  const drawerOpen = rail !== null || mapEditing;
  const modalContentInert = exportOpen || (mobileViewport && drawerOpen);
  useFocusTrap({ ref: drawerRef, active: mobileViewport && drawerOpen, onClose: closeDrawer, restoreFocusRef: drawerOpenerRef });

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
  }, [plan]);

  return (
    <section className={styles.reportRoot} data-report-root aria-label="보고서 모드" onPointerDownCapture={(event) => {
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
          <button type="button" className={styles.secondaryButton} onClick={onPresentation} disabled={demo || busy || history.present.pages.length === 0}>발표 미리보기</button>
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
        <nav className={styles.reportRail} aria-label="보고서 요소" inert={modalContentInert || undefined}>
          <button type="button" className={`${styles.railButton} ${rail === "pages" ? styles.railButtonActive : ""}`} aria-pressed={rail === "pages"} onClick={(event) => toggleRail("pages", event.currentTarget)}><span aria-hidden="true">▤</span><span>페이지</span></button>
          <button type="button" className={`${styles.railButton} ${rail === "tiles" ? styles.railButtonActive : ""}`} aria-pressed={rail === "tiles"} onClick={(event) => toggleRail("tiles", event.currentTarget)}><span aria-hidden="true">◈</span><span>분석 타일</span></button>
          <button type="button" className={`${styles.railButton} ${rail === "textbox" ? styles.railButtonActive : ""}`} aria-pressed={rail === "textbox"} onClick={(event) => addTextBoxFromRail(event.currentTarget)}><span aria-hidden="true">T</span><span>글상자</span></button>
          <button type="button" className={`${styles.railButton} ${rail === "theme" ? styles.railButtonActive : ""}`} aria-pressed={rail === "theme"} onClick={(event) => toggleRail("theme", event.currentTarget)}><span aria-hidden="true">◌</span><span>테마</span></button>
          <button type="button" className={`${styles.railButton} ${styles.mobileOnlyRailButton} ${rail === "layout" ? styles.railButtonActive : ""}`} aria-pressed={rail === "layout"} onClick={(event) => toggleRail("layout", event.currentTarget)} disabled={!selectedPage}><span aria-hidden="true">▥</span><span>레이아웃</span></button>
        </nav>
        <aside
          ref={drawerRef}
          className={styles.drawerColumn}
          data-mobile-sheet={mobileViewport && drawerOpen ? "open" : "closed"}
          role={mobileViewport && drawerOpen ? "dialog" : undefined}
          aria-modal={mobileViewport && drawerOpen ? true : undefined}
          inert={exportOpen || undefined}
          aria-label={mapEditing ? "지도 설정" : rail === "tiles" ? "분석 타일 추가" : rail === "textbox" ? "글상자 추가" : rail === "theme" ? "테마 설정" : rail === "layout" ? "페이지 레이아웃" : "페이지 추가"}
        >
          {mobileViewport && drawerOpen && <button type="button" className={styles.sheetClose} onClick={closeDrawer}>닫기</button>}
          {mapEditing && editableMapPage && mapFrame && mapScaleOptions && <DrawerMap page={editableMapPage} frame={mapFrame} view={mapView} cell={mapCell} scaleOptions={mapScaleOptions} sameExtent={editableMapPage.kind === "compare" ? editableMapPage.sameExtent : undefined} onSameExtent={editableMapPage.kind === "compare" ? (value) => apply({ type: "sameExtent", id: editableMapPage.id, value }) : undefined} onFrame={(patch: Partial<MapFrameState>) => { if (patch.locked === true) setMapMoveActive(false); applyFrame(mapCell, patch); }} />}
          {!mapEditing && rail === "pages" && <DrawerPages open hasLegacy={legacyAvailable} onAdd={addPage} onRecommended={startRecommended} onLegacy={importLegacy} />}
          {!mapEditing && rail === "tiles" && <DrawerTiles open doc={history.present} views={views} mode={compareMode ? "compare" : "single"} compareGrid={compareGrid} compareSelected={compareSelected} onCompareGrid={setCompareGrid} onAdd={addTile} onToggleCompare={toggleCompareTile} onCreateCompare={addComparePage} onCancelCompare={() => { setCompareSelected([]); setCompareMode(false); }} />}
          {!mapEditing && rail === "textbox" && <TextBoxDrawer onAdd={addTextBox} />}
          {!mapEditing && rail === "theme" && <ThemeDrawer doc={history.present} onFormat={(format) => apply({ type: "format", format }, `${formatLabel(format)} 판형으로 바꿨습니다.`)} onFontScale={(fontScale) => apply({ type: "theme", fontScale }, `${fontScale}배 글자 크기를 적용했습니다.`)} onClose={() => mobileViewport ? closeDrawer() : setRail("pages")} />}
          {!mapEditing && rail === "layout" && selectedPage && <div className={styles.drawer}><LayoutSwitcher value={selectedPage.layout} onChange={(layout) => apply({ type: "layout", id: selectedPage.id, layout })} /></div>}
        </aside>
        <main className={styles.reportWorkspace} inert={modalContentInert || undefined}>
          {history.present.pages.length === 0 ? (
            <div className={styles.emptyReport}>
              <div className={styles.emptyCanvas}><span className={styles.emptyCanvasMark}>＋</span><strong>페이지를 추가하세요</strong><span>보고서의 첫 장을 선택해 작업을 시작합니다.</span></div>
              <div className={styles.emptyActions}><button type="button" className={styles.primaryButton} onClick={() => addPage("blank")}>＋ 페이지 추가</button><button type="button" className={styles.secondaryButton} onClick={startRecommended}>추천 구성으로 시작</button>{legacyAvailable && <button type="button" className={styles.linkButton} onClick={importLegacy}>이전 보고서 구성 불러오기</button>}</div>
            </div>
          ) : selectedSlide ? (
            <div className={styles.stageAndSettings}>
              <div className={styles.stageColumn}>
                <div className={styles.stageFrame} data-report-stage onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  handleSurfaceSelect(null);
                }}>
                  {mapFrame && mapModel && <>
                    <MapToolbar scale={mapScale} locked={mapFrame.locked} mapActive={mapMoveActive && selection?.kind === "map" && !mapFrame.locked} onZoom={(delta) => applyFrame(mapCell, { zoomDelta: mapFrame.zoomDelta + delta, scaleDenominator: null })} onFit={() => applyFrame(mapCell, { zoomDelta: 0, offsetM: [0, 0], scaleDenominator: null })} onToggleMove={toggleMapMove} onToggleLock={toggleMapLock} onOpen={openMapSettings} />
                    {mapMoveActive && selection?.kind === "map" && !mapFrame.locked && <p className={styles.mapHint}>지도를 끌어 옮기고 휠로 확대합니다 · Esc 또는 바깥을 누르면 끝납니다</p>}
                  </>}
                  <SlideSurface slide={selectedSlide} basemap={basemap} mode="edit" selection={selection} onSelect={handleSurfaceSelect} onMapMoveActive={setMapMoveFromSurface} onFrame={applyFrame} onPanels={applyPanels} onTextBox={applyTextBox} onText={editPanelText} onSheetCellActivate={(index) => { handleSurfaceSelect({ kind: "map", cell: index }); setMapMoveActive(false); }} mapActive={mapMoveActive} classMap={surfaceClassMap} />
                </div>
                {selectedPage && <NotesField pageId={selectedPage.id} value={selectedPage.notes} onChange={(notes) => apply({ type: "notes", id: selectedPage.id, notes })} />}
              </div>
              <aside className={styles.editorSide}>
                {selectedPage && <LayoutSwitcher value={selectedPage.layout} onChange={(layout) => apply({ type: "layout", id: selectedPage.id, layout })} />}
              </aside>
            </div>
          ) : <div className={styles.emptyCanvas}>이 페이지는 아직 미리보기를 준비하고 있습니다.</div>}
          <PageStrip items={stripItems} selectedId={selectedId} selectedSlideKey={selectedSlideKey} onSelect={selectStripItem} onNavigate={navigateStrip} onReorder={reorderPage} onDropMove={dropMovePage} onAddPage={() => { setRail("pages"); setSelection(null); setMapMoveActive(false); addPage("blank"); }} onDuplicate={duplicatePage} onDelete={deletePage} classMap={surfaceClassMap} exportSelectionMode={exportPageScope === "selected"} exportPageIds={exportPageIds} onToggleExportPage={toggleExportPage} />
        </main>
      </div>
      {toast && <div className={styles.toast} role="status">{toast} <button type="button" onClick={undo}>되돌리기</button></div>}
    </section>
  );
}

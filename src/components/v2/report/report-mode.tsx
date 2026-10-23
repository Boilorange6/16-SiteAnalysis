"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { Dispatch, RefObject } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { clampTextBox, defaultFrame, DEFAULT_REPORT_FONT_SIZES, EMPTY_REPORT_DOC, newPageId, REPORT_FONT_SIZE_KEYS, REPORT_FONT_SIZE_LIMITS, reportDocReducer, textBoxDefaults, TEXT_BOX_DEFAULTS, type FontSizeKey, type MapFrameState, type PageElementKey, type PagePanels, type ReportDoc, type ReportDocAction, type ReportFontSizeOverrides, type ReportFontSizes, type ReportFormat, type ReportPage, type TextBox, type TextBoxKind } from "@/lib/v2/report/report-doc";
import { mapFrameScaleOptions, scaleForFrame, scaleOptionsForFrame, siteAnchoredZoomPatch, siteFitPatch, zoomForScale } from "@/lib/v2/ui/report-scale";
import { SLIDE_OVERVIEW_FILL } from "@/lib/v2/ui/callout-layout";
import { layoutRects, slideGeometry, slideLayout, slideLegend, slidePanelRects, slideSiteX, slideSize, terrainSectionLayout } from "@/lib/v2/ui/overlay-layout";
import { importLegacyReport, hasLegacyReport, pagesForTile, planReportDoc, recommendedPages } from "@/lib/v2/report/report-doc-plan";
import { pageStripItems } from "@/lib/v2/report/report-page-strip";
import { reportFileName, tileReportSettingsFromBoard, type PlannedSlide } from "@/lib/v2/report/report-plan";
import type { ExportPageScope } from "@/lib/v2/report/export-runner";
import { deleteElementFramePatch, initialReportRail, insertIndexAfter, isTypingTarget, labelFramePatch, mapElementKindLabel, moveByKey, reorderMessage, reportPageMapSelectable, stripNavIndex, toggleLabelVisibility, transitionMapInteraction, type ReportRailKey } from "@/lib/v2/ui/report-mode-logic";
import type { BoardAction, BoardState } from "@/lib/v2/ui/board-state";
import type { SummaryView, TileView } from "@/lib/v2/ui/tile-view";
import { sheetCells } from "@/lib/v2/ui/sheet";
import { legendItemsForModel, type MapLegendLayerItem } from "@/lib/v2/ui/map-layers";
import { useFocusTrap } from "../use-focus-trap";
import { SlideSurface, type SurfaceSelection } from "./slide-surface";
import DrawerPages, { type PageAddKind } from "./drawer-pages";
import DrawerTiles from "./drawer-tiles";
import PageStrip, { type PageStripItem } from "./page-strip";
import DrawerMap from "./drawer-map";
import LayoutSwitcher, { type DeletedLayoutItem } from "./layout-switcher";
import MapScaleChip from "./map-scale-chip";
import NotesField from "./notes-field";
import ExportPanel from "./export-panel";
import TextBoxPopover from "./text-box-popover";
import SidePanelHeader from "./side-panel-header";
import styles from "./report-mode.module.css";
import legacySurfaceStyles from "../report-surface.module.css";
import localSurfaceStyles from "./slide-surface.module.css";

type ReportHistory = { past: ReportDoc[]; present: ReportDoc; future: ReportDoc[] };
type RailKey = ReportRailKey;
const surfaceClassMap = { ...legacySurfaceStyles, ...localSurfaceStyles };

type RailIconName = "pages" | "tiles" | "textbox" | "font" | "layout" | "notes";

function RailIcon({ name }: { name: RailIconName }) {
  return (
    <svg className={styles.railIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {name === "pages" && <><rect x="4" y="3" width="10" height="13" rx="1" /><path d="M7 6h4M7 9h4M7 12h3" /><path d="M6 16h9a1 1 0 0 0 1-1V5" /></>}
      {name === "tiles" && <><path d="m10 3 6 4-6 4-6-4 6-4Z" /><path d="m4 10 6 4 6-4M4 13l6 4 6-4" /></>}
      {name === "textbox" && <><path d="M4 4h12M10 4v12" /><path d="M7 16h6" /></>}
      {name === "font" && <><path d="m2.8 16.5 3.7-11h2l3.7 11M4.2 12h6.6" /><path d="m12.2 16.5 2.8-8.5h1.6l2.8 8.5M13.2 13h5.6" /></>}
      {name === "layout" && <><rect x="3" y="3" width="14" height="14" rx="1" /><path d="M3 8h14M11 8v9" /></>}
      {name === "notes" && <><path d="M5 3.5h7l3 3V16.5H5z" /><path d="M12 3.5v3h3M7.5 10h5M7.5 13h4" /></>}
    </svg>
  );
}

function RecommendedIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.2 5.3L20 9l-4.4 3.8L17 18.5 12 15.6 7 18.5l1.4-5.7L4 9l5.8-.7z" /></svg>;
}

function ImportReportIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></svg>;
}

function ResetIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4.5h4.5" /></svg>;
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
    deletedElementKeys: [],
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

export type FontSizeScope = "document" | "page";
type FontSizeMap = ReportFontSizes;
type FontSizePatch = ReportFontSizeOverrides;
type FontSizeAction =
  | { type: "fontSizes"; scope: FontSizeScope; id?: string; key: FontSizeKey; value: number }
  | { type: "clearPageFontSizes"; id: string; key?: FontSizeKey };

const FONT_SIZE_LABELS: Record<FontSizeKey, string> = { title: "제목", summary: "요약", legend: "범례", labels: "지도 라벨", source: "출처" };
const FONT_SIZE_ROWS: readonly { key: FontSizeKey; label: string; min: number; max: number; defaultValue: number }[] = REPORT_FONT_SIZE_KEYS.map((key) => ({ key, label: FONT_SIZE_LABELS[key], min: REPORT_FONT_SIZE_LIMITS[key].min, max: REPORT_FONT_SIZE_LIMITS[key].max, defaultValue: DEFAULT_REPORT_FONT_SIZES[key] }));
const DEFAULT_FONT_SIZES: FontSizeMap = DEFAULT_REPORT_FONT_SIZES;
type LegendContextMenuItem = Pick<MapLegendLayerItem, "layer" | "label" | "color" | "lineSwatch"> & { visible: boolean };

function fontSizesOf(value: unknown): FontSizePatch {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(FONT_SIZE_ROWS.flatMap(({ key }) => typeof record[key] === "number" && Number.isFinite(record[key]) ? [[key, record[key]]] : [])) as FontSizePatch;
}

function documentFontSizes(doc: ReportDoc): FontSizePatch {
  return fontSizesOf((doc as ReportDoc & { fontSizes?: unknown }).fontSizes);
}

function pageFontSizes(page: ReportPage | undefined): FontSizePatch {
  return fontSizesOf((page as (ReportPage & { fontSizes?: unknown }) | undefined)?.fontSizes);
}

function fontSizeRow(key: FontSizeKey) {
  return FONT_SIZE_ROWS.find((row) => row.key === key)!;
}

function clampFontSize(key: FontSizeKey, value: number): number {
  const row = fontSizeRow(key);
  return Math.max(row.min, Math.min(row.max, Math.round(value)));
}

function effectiveFontSize(doc: ReportDoc, page: ReportPage | undefined, key: FontSizeKey): number {
  return clampFontSize(key, pageFontSizes(page)[key] ?? documentFontSizes(doc)[key] ?? DEFAULT_FONT_SIZES[key]);
}

function pageOverrideCount(page: ReportPage | undefined): number {
  return FONT_SIZE_ROWS.filter(({ key }) => pageFontSizes(page)[key] !== undefined).length;
}

function FontSizeStepRow({ fontKey: key, label, value, pageOverride, onChange, onSelect, selected, menu = false }: { fontKey: FontSizeKey; label: string; value: number; pageOverride: boolean; onChange: (key: FontSizeKey, delta: number) => void; onSelect?: (key: FontSizeKey) => void; selected?: boolean; menu?: boolean }) {
  const row = fontSizeRow(key);
  const step = 1;
  return (
    <div className={`${styles.fontSizeRow} ${pageOverride ? styles.fontSizeRowPage : ""}`} data-font-size-key={key} data-menu-row={menu ? "true" : undefined}>
      {onSelect ? <button type="button" className={`${styles.fontSizeName} ${selected ? styles.fontSizeNameSelected : ""}`} onClick={() => onSelect(key)} aria-pressed={selected}>{label}</button> : <span className={styles.fontSizeName}>{label}</span>}
      <div className={styles.fontSizeStepper}>
        <button type="button" className={styles.fontSizeStep} onClick={() => onChange(key, -step)} disabled={value <= row.min} aria-label={`${label} 글자 작게`}>−</button>
        <output className={styles.fontSizeValue}>{value}pt</output>
        <button type="button" className={styles.fontSizeStep} onClick={() => onChange(key, step)} disabled={value >= row.max} aria-label={`${label} 글자 크게`}>+</button>
      </div>
    </div>
  );
}

function FontScopeSwitch({ scope, pageNumber, pageDisabled, onChange }: { scope: FontSizeScope; pageNumber: number | null; pageDisabled: boolean; onChange: (scope: FontSizeScope) => void }) {
  return <div className={styles.fontScopeSwitch} role="group" aria-label="글자 크기 적용 범위">
    <button type="button" className={scope === "document" ? styles.fontScopeActive : styles.fontScopeButton} aria-pressed={scope === "document"} onClick={() => onChange("document")}>모든 페이지</button>
    <button type="button" className={scope === "page" ? styles.fontScopeActive : styles.fontScopeButton} aria-pressed={scope === "page"} onClick={() => onChange("page")} disabled={pageDisabled}>{pageNumber ? `${pageNumber}쪽만` : "이 페이지만"}</button>
  </div>;
}

function FontSizePopover({ doc, page, pageNumber, scope, selectedKey, opacity, onOpacityChange, onScope, onChange, onSelect, onResetPage, onResetDefaults, onClose }: { doc: ReportDoc; page?: ReportPage; pageNumber: number | null; scope: FontSizeScope; selectedKey: FontSizeKey | null; opacity: number; onOpacityChange: (value: number) => void; onScope: (scope: FontSizeScope) => void; onChange: (scope: FontSizeScope, key: FontSizeKey, delta: number) => void; onSelect: (key: FontSizeKey) => void; onResetPage: () => void; onResetDefaults: () => void; onClose: () => void }) {
  const pageValues = pageFontSizes(page);
  const count = pageOverrideCount(page);
  return <section className={styles.popoverBody} aria-label="글자 크기">
    <SidePanelHeader title="글자 크기" opacity={opacity} onOpacityChange={onOpacityChange} onClose={onClose} closeLabel="글자 크기 창 닫기" />
    <FontScopeSwitch scope={scope} pageNumber={pageNumber} pageDisabled={!page} onChange={onScope} />
    <div className={`${styles.fontSizeRows} ${styles.sidePanelContent}`}>
      {FONT_SIZE_ROWS.map(({ key, label }) => <FontSizeStepRow key={key} fontKey={key} label={label} value={effectiveFontSize(doc, page, key)} pageOverride={scope === "page" && pageValues[key] !== undefined} onChange={(changedKey, delta) => onChange(scope, changedKey, delta)} onSelect={onSelect} selected={selectedKey === key} />)}
    </div>
    <div className={styles.fontPageReset}>
      {scope === "page" && count > 0 && <span>{pageNumber}쪽만 바뀐 값 {count}개</span>}
      {scope === "page" && count > 0 && <button type="button" className={styles.fontPageResetButton} onClick={onResetPage}>모든 페이지 값으로</button>}
      <button type="button" className={styles.secondaryAction} onClick={onResetDefaults}><ResetIcon />기본 크기로</button>
    </div>
  </section>;
}

function FontContextMenu({ menuRef, doc, page, pageNumber, state, scope, onScope, onChange, onResetPageKey, onResetPanel, onLegendVisibilityChange, onShowAllLegend, onHideLegendPanel, onDelete, onClose, legendItems = [] }: { menuRef: RefObject<HTMLDivElement | null>; doc: ReportDoc; page?: ReportPage; pageNumber: number | null; state: { key: FontSizeKey; x: number; y: number; opener: HTMLElement }; scope: FontSizeScope; onScope: (scope: FontSizeScope) => void; onChange: (scope: FontSizeScope, key: FontSizeKey, delta: number) => void; onResetPageKey: (key: FontSizeKey) => void; onResetPanel: () => void; legendItems?: readonly LegendContextMenuItem[]; onLegendVisibilityChange?: (layer: string, visible: boolean) => void; onShowAllLegend?: () => void; onHideLegendPanel?: () => void; onDelete?: () => void; onClose: () => void }) {
  const [position, setPosition] = useState({ x: state.x, y: state.y });
  const pageValues = pageFontSizes(page);
  const row = fontSizeRow(state.key);
  const panelChanged = state.key === "title" || state.key === "summary" || state.key === "legend"
    ? !!(page && Object.prototype.hasOwnProperty.call(page.panels, state.key))
    : false;
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(state.x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(state.y, window.innerHeight - rect.height - 8)) });
  }, [state.x, state.y]);
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
  }, []);
  return <div ref={menuRef} className={styles.fontContextMenu} role="menu" aria-label={`${fontSizeRow(state.key).label} 글자 크기`} style={{ left: position.x, top: position.y }}>
    {state.key === "legend" && legendItems.length > 0 && <>
      <div className={styles.fontLegendHeading}>범례에 표시</div>
      <div className={styles.fontLegendItems}>
        {legendItems.map((item) => <button key={item.layer} type="button" className={styles.fontLegendItem} role="menuitemcheckbox" aria-checked={item.visible} onClick={() => onLegendVisibilityChange?.(item.layer, !item.visible)}>
          <span className={styles.fontLegendSwatch} style={item.lineSwatch ? { background: "transparent", borderColor: item.color } : { background: item.color }} aria-hidden="true" />
          <span className={styles.fontLegendLabel}>{item.label}</span>
          <span className={styles.fontLegendCheck} aria-hidden="true">{item.visible ? "✓" : ""}</span>
        </button>)}
      </div>
      <div className={styles.fontLegendActions}>
        <button type="button" className={styles.fontMenuItem} role="menuitem" onClick={onShowAllLegend}>모두 표시</button>
        <button type="button" className={styles.fontMenuItem} role="menuitem" onClick={onHideLegendPanel}>범례 칸 숨기기</button>
      </div>
      <div className={styles.fontContextDivider} />
    </>}
    <FontSizeStepRow fontKey={state.key} label={row.label} value={effectiveFontSize(doc, page, state.key)} pageOverride={scope === "page" && pageValues[state.key] !== undefined} onChange={(key, delta) => onChange(scope, key, delta)} menu />
    <FontScopeSwitch scope={scope} pageNumber={pageNumber} pageDisabled={!page} onChange={onScope} />
    <div className={styles.fontContextDivider} />
    {pageValues[state.key] !== undefined && <button type="button" className={styles.fontMenuItem} role="menuitem" onClick={() => onResetPageKey(state.key)}>모든 페이지 값으로 되돌리기</button>}
    {panelChanged && <button type="button" className={styles.fontMenuItem} role="menuitem" onClick={onResetPanel}>위치·크기 처음대로</button>}
    {onDelete && <><div className={styles.fontContextDivider} /><button type="button" className={styles.fontMenuItemDanger ?? styles.fontMenuItem} role="menuitem" onClick={onDelete}>지우기</button></>}
  </div>;
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
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPageScope, setExportPageScope] = useState<ExportPageScope | null>(null);
  const [exportPageIds, setExportPageIds] = useState<Set<string>>(new Set());
  const [activePopover, setActivePopover] = useState<"layout" | "notes" | "font" | "textbox" | null>(null);
  const [sidePanelOpacity, setSidePanelOpacity] = useState(100);
  const [textBoxPlacement, setTextBoxPlacement] = useState<{ kind: TextBoxKind; x: number; y: number } | null>(null);
  const [textBoxEditingId, setTextBoxEditingId] = useState<string | null>(null);
  const [fontScope, setFontScope] = useState<FontSizeScope>("document");
  const [fontContextScope, setFontContextScope] = useState<FontSizeScope>("document");
  const [fontHighlight, setFontHighlight] = useState<FontSizeKey | null>(null);
  const [fontContext, setFontContext] = useState<{ key: FontSizeKey; x: number; y: number; opener: HTMLElement } | null>(null);
  const fontContextOpenerRef = useRef<HTMLElement | null>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const layoutTriggerRef = useRef<HTMLButtonElement>(null);
  const notesTriggerRef = useRef<HTMLButtonElement>(null);
  const fontSizeTriggerRef = useRef<HTMLButtonElement>(null);
  const textBoxTriggerRef = useRef<HTMLButtonElement>(null);
  const layoutPopoverRef = useRef<HTMLDivElement>(null);
  const notesPopoverRef = useRef<HTMLDivElement>(null);
  const fontSizePopoverRef = useRef<HTMLDivElement>(null);
  const textBoxPopoverRef = useRef<HTMLDivElement>(null);
  const fontContextMenuRef = useRef<HTMLDivElement>(null);
  const popoverOpenerRef = useRef<HTMLElement | null>(null);
  const [mobileViewport, setMobileViewport] = useState(false);
  const reportStageRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const settingsRef = useRef<HTMLElement>(null);
  const drawerOpenerRef = useRef<HTMLElement | null>(null);
  const lockAttentionTimerRef = useRef<number | null>(null);
  const [reportActionsTarget, setReportActionsTarget] = useState<HTMLElement | null>(null);
  const [overlayTailY, setOverlayTailY] = useState<number | null>(null);
  const drawerOpen = rail === "pages" || rail === "tiles";
  const layoutPopoverOpen = activePopover === "layout";
  const notesPopoverOpen = activePopover === "notes";
  const fontSizePopoverOpen = activePopover === "font";
  const textBoxPopoverOpen = activePopover === "textbox";

  useEffect(() => {
    if (typeof document === "undefined") return;
    setReportActionsTarget(document.getElementById("v2-report-actions"));
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("v2.report.sidePanelOpacity");
      const parsed = stored ? Number(stored) : 100;
      if (Number.isFinite(parsed)) setSidePanelOpacity(Math.max(40, Math.min(100, Math.round(parsed / 5) * 5)));
    } catch {
      setSidePanelOpacity(100);
    }
  }, []);

  const changeSidePanelOpacity = useCallback((value: number) => {
    const next = Math.max(40, Math.min(100, Math.round(value / 5) * 5));
    setSidePanelOpacity(next);
    try {
      window.localStorage.setItem("v2.report.sidePanelOpacity", String(next));
    } catch {
      // localStorage is optional; the in-memory value still applies for this session.
    }
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
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
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
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
    setActivePopover(null);
    setFontHighlight(null);
    setFontContext(null);
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

  const sidePanelStyle = useMemo(() => ({ "--side-panel-alpha": sidePanelOpacity / 100, "--side-panel-content-alpha": sidePanelOpacity / 100 } as CSSProperties), [sidePanelOpacity]);
  const getThumbnailSlide = useCallback((tileId: string): PlannedSlide | undefined => {
    const view = views.get(tileId);
    if (!view) return undefined;
    const page = pagesForTile(history.present, tileId, view, tileReportSettingsFromBoard(board, tileId), planContext)[0];
    if (!page) return undefined;
    return planReportDoc({ ...history.present, pages: [page] }, views, planContext).find((slide) => slide.page?.id === page.id);
  }, [board, history.present, planContext, views]);

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

  const closePopover = useCallback((restoreFocus = false) => {
    const opener = popoverOpenerRef.current;
    setActivePopover(null);
    popoverOpenerRef.current = null;
    if (restoreFocus) window.requestAnimationFrame(() => opener?.focus());
  }, []);

  const toggleLayoutPopover = useCallback((opener?: HTMLElement | null) => {
    if (activePopover === "layout") {
      closePopover(true);
      return;
    }
    popoverOpenerRef.current = opener ?? layoutTriggerRef.current;
    setRail(null);
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
    setActivePopover("layout");
  }, [activePopover, closePopover]);

  const toggleNotesPopover = useCallback((opener?: HTMLElement | null) => {
    if (activePopover === "notes") {
      closePopover(true);
      return;
    }
    popoverOpenerRef.current = opener ?? notesTriggerRef.current;
    setRail(null);
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
    setActivePopover("notes");
  }, [activePopover, closePopover]);

  const toggleFontSizePopover = useCallback((opener?: HTMLElement | null) => {
    if (activePopover === "font") {
      closePopover(true);
      return;
    }
    popoverOpenerRef.current = opener ?? fontSizeTriggerRef.current;
    setFontContext(null);
    setFontScope("document");
    setRail(null);
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
    setActivePopover("font");
  }, [activePopover, closePopover]);

  const toggleTextBoxPopover = useCallback((opener?: HTMLElement | null) => {
    if (activePopover === "textbox") {
      closePopover(true);
      return;
    }
    popoverOpenerRef.current = opener ?? textBoxTriggerRef.current;
    setTextBoxPlacement(null);
    setRail(null);
    setSelection(null);
    setTextBoxEditingId(null);
    setActivePopover("textbox");
  }, [activePopover, closePopover]);

  const closeFontContext = useCallback((restoreFocus = true) => {
    const opener = fontContextOpenerRef.current;
    setFontContext(null);
    if (restoreFocus) window.requestAnimationFrame(() => opener?.focus());
    fontContextOpenerRef.current = null;
  }, []);

  const closeDrawer = useCallback((restoreFocus = false) => {
    const opener = drawerOpenerRef.current;
    setRail(null);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
    setActivePopover(null);
    if (restoreFocus) window.requestAnimationFrame(() => opener?.focus());
  }, []);

  // 팝오버는 버튼 세로 가운데에 붙어 꼬리가 50%에 오고, 무대 높이 서랍만 버튼 위치를 재서 꼬리를 옮긴다.
  const anchoredCardStyle = overlayTailY === null ? undefined : { "--tail-y": `${overlayTailY}px` } as CSSProperties;

  useLayoutEffect(() => {
    const anchor = drawerOpen ? drawerOpenerRef.current : null;
    const stage = reportStageRef.current;
    if (!anchor || !stage) {
      setOverlayTailY(null);
      return;
    }
    const update = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      setOverlayTailY(anchorRect.top + anchorRect.height / 2 - stageRect.top - 16);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen && !activePopover && !fontContext) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (fontContext && (fontContextMenuRef.current?.contains(event.target) || fontContext.opener.contains(event.target))) return;
      if (drawerOpen && (drawerRef.current?.contains(event.target) || drawerOpenerRef.current?.contains(event.target))) return;
      if (activePopover && (
        layoutPopoverRef.current?.contains(event.target)
        || notesPopoverRef.current?.contains(event.target)
        || fontSizePopoverRef.current?.contains(event.target)
        || textBoxPopoverRef.current?.contains(event.target)
        || layoutTriggerRef.current?.contains(event.target)
        || notesTriggerRef.current?.contains(event.target)
        || fontSizeTriggerRef.current?.contains(event.target)
        || textBoxTriggerRef.current?.contains(event.target)
      )) return;
      if (fontContext) closeFontContext(true);
      if (drawerOpen) closeDrawer(true);
      if (activePopover) closePopover(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [activePopover, closeDrawer, closeFontContext, closePopover, drawerOpen, fontContext]);

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
        if (textBoxPlacement) {
          event.preventDefault();
          setTextBoxPlacement(null);
          return;
        }
        if (fontContext) {
          event.preventDefault();
          closeFontContext(true);
          return;
        }
        if (activePopover) {
          event.preventDefault();
          closePopover(true);
          return;
        }
        if (drawerOpen) {
          event.preventDefault();
          closeDrawer(true);
          return;
        }
        if (selection?.kind === "mapElement" || selection?.kind === "mapLabel") {
          event.preventDefault();
          setSelection(null);
          setMapMoveActive(false);
          setSettingsOpen(false);
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
  }, [activePopover, closeDrawer, closeFontContext, closePopover, drawerOpen, fontContext, mapMoveActive, navigateStrip, redo, selectedId, selectedSlideKey, selection, settingsOpen, stripItems, textBoxPlacement, undo]);

  const addPages = useCallback((pages: ReportPage[], message?: string) => {
    if (pages.length === 0) return;
    const index = insertIndexAfter(history.present, selectedId);
    const first = pages[0]!;
    apply({ type: "add", pages, index }, message ?? `${pageTypeLabel(first)} 페이지를 ${index + 1}쪽에 추가했습니다.`);
    setSelectedId(pages[0].id);
    setSelectedSlideKey(null);
    setSelection(null);
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
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
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
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
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
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
      setTextBoxPlacement(null);
      setTextBoxEditingId(null);
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
      sameExtent: false,
      cells,
    };
    addPages([page]);
    setCompareSelected([]);
    setCompareMode(false);
    setRail("pages");
  }, [addPages, board, compareGrid, compareSelected, history.present]);

  const placeTextBox = useCallback((kind: TextBoxKind, x: number, y: number) => {
    if (!selectedId) return;
    const page = history.present.pages.find((candidate) => candidate.id === selectedId);
    if (!page) return;
    const size = slideSize(history.present.format);
    const box = clampTextBox(textBoxDefaults(kind, `text-${Date.now().toString(36)}`, x, y), size.w, size.h);
    apply({ type: "textBox", id: selectedId, box }, "글상자를 추가했습니다.");
    setTextBoxPlacement(null);
    setActivePopover(null);
    setSelection({ kind: "textBox", id: box.id });
    setTextBoxEditingId(box.id);
  }, [apply, history.present.format, history.present.pages, selectedId]);

  const chooseTextBoxKind = useCallback((kind: TextBoxKind, keyboard = false) => {
    if (!selectedId) return;
    const size = slideSize(history.present.format);
    const defaults = TEXT_BOX_DEFAULTS[kind];
    const x = Math.max(0, (size.w - defaults.w) / 2);
    const y = Math.max(0, (size.h - defaults.h) / 2);
    if (keyboard) {
      placeTextBox(kind, x, y);
      return;
    }
    setTextBoxPlacement({ kind, x, y });
    setSelection(null);
    setTextBoxEditingId(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
    setActivePopover(null);
    setRail(null);
  }, [history.present.format, placeTextBox, selectedId]);

  const moveTextBoxPlacement = useCallback((x: number, y: number) => {
    setTextBoxPlacement((current) => {
      if (!current) return current;
      const size = slideSize(history.present.format);
      const next = clampTextBox(textBoxDefaults(current.kind, "preview", x, y), size.w, size.h);
      return { kind: current.kind, x: next.x, y: next.y };
    });
  }, [history.present.format]);

  const commitTextBoxPlacement = useCallback((x: number, y: number) => {
    if (!textBoxPlacement) return;
    placeTextBox(textBoxPlacement.kind, x, y);
  }, [placeTextBox, textBoxPlacement]);

  const applyTextBox = useCallback((box: TextBox | { id: string; remove: true }) => {
    if (!selectedId) return;
    apply({ type: "textBox", id: selectedId, box });
    if ("remove" in box) {
      setSelection(null);
      setTextBoxEditingId(null);
    }
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

  const applyFrame = useCallback((cell: number | undefined, patch: Partial<ReturnType<typeof defaultFrame>>, message?: string) => {
    if (!selectedId) return;
    const page = history.present.pages.find((candidate) => candidate.id === selectedId);
    if (!page) return;
    if (page.kind === "compare" && page.sameExtent && cell !== undefined && (patch.zoomDelta !== undefined || patch.offsetM !== undefined || patch.scaleDenominator !== undefined)) {
      let next = history.present;
      page.cells.forEach((_candidate, index) => {
        next = reportDocReducer(next, { type: "frame", id: selectedId, cell: index, patch });
      });
      commitDoc(next, message);
      return;
    }
    apply({ type: "frame", id: selectedId, cell, patch }, message);
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
    if (next?.kind === "mapElement" || next?.kind === "mapLabel") {
      const page = history.present.pages.find((candidate) => candidate.id === selectedId);
      if (!reportPageMapSelectable(page)) return;
      setFontHighlight(null);
      closeFontContext(false);
      setActivePopover(null);
      setSelection(next);
      setMapMoveActive(false);
      setSettingsOpen(false);
      setTextBoxEditingId(null);
      setRail(null);
      return;
    }
    if (next?.kind === "map") {
      const page = history.present.pages.find((candidate) => candidate.id === selectedId);
      if (!reportPageMapSelectable(page)) return;
      rememberDrawerOpener();
      const transitioned = transitionMapInteraction(current, "select");
      setFontHighlight(null);
      closeFontContext(false);
      setActivePopover(null);
      setSelection(next);
      setMapMoveActive(transitioned.moveActive);
      setSettingsOpen(transitioned.settingsOpen);
      setTextBoxEditingId(null);
      setRail(null);
      return;
    }
    if (next === null) {
      const transitioned = transitionMapInteraction(current, "outside-slide");
      setFontHighlight(null);
      closeFontContext(false);
      setMapMoveActive(transitioned.moveActive);
      setSettingsOpen(transitioned.settingsOpen);
      setTextBoxEditingId(null);
      if (!transitioned.selected) setSelection(null);
      return;
    }
    setFontHighlight(null);
    closeFontContext(false);
    setMapMoveActive(false);
    setSettingsOpen(false);
    if (next.kind !== "textBox") setTextBoxEditingId(null);
    setSelection(next);
  }, [closeFontContext, history.present.pages, mapMoveActive, rememberDrawerOpener, selectedId, selection, settingsOpen]);
  const toggleRail = useCallback((next: RailKey, opener?: HTMLElement | null) => {
    rememberDrawerOpener(opener);
    if (drawerOpen && rail === next) {
      setRail(null);
      setSelection(null);
      setMapMoveActive(false);
      setSettingsOpen(false);
      setTextBoxPlacement(null);
      setTextBoxEditingId(null);
      window.requestAnimationFrame(() => drawerOpenerRef.current?.focus());
      return;
    }
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
    setTextBoxPlacement(null);
    setTextBoxEditingId(null);
    setActivePopover(null);
    setRail(next);
  }, [drawerOpen, rail, rememberDrawerOpener]);
  const addTextBoxFromRail = useCallback((opener?: HTMLElement | null) => {
    if (textBoxPlacement) {
      setTextBoxPlacement(null);
      setTextBoxEditingId(null);
      setActivePopover(null);
      return;
    }
    toggleTextBoxPopover(opener);
  }, [textBoxPlacement, toggleTextBoxPopover]);
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
  const selectedPageNumber = selectedId ? history.present.pages.findIndex((page) => page.id === selectedId) + 1 : null;
  const changeFontSize = useCallback((scope: FontSizeScope, key: FontSizeKey, delta: number) => {
    if (!selectedId) return;
    const base = scope === "page"
      ? effectiveFontSize(history.present, selectedPage, key)
      : clampFontSize(key, documentFontSizes(history.present)[key] ?? DEFAULT_FONT_SIZES[key]);
    const value = clampFontSize(key, base + delta);
    const action: FontSizeAction = scope === "page"
      ? { type: "fontSizes", scope, id: selectedId, key, value }
      : { type: "fontSizes", scope, key, value };
    apply(action as ReportDocAction, `${fontSizeRow(key).label}를 ${value}pt로 바꿨습니다.`);
  }, [apply, history.present, selectedId, selectedPage]);
  const resetPageFontSizes = useCallback(() => {
    if (!selectedId) return;
    apply({ type: "clearPageFontSizes", id: selectedId } as ReportDocAction, "이 페이지 글자 크기를 모든 페이지 값으로 되돌렸습니다.");
  }, [apply, selectedId]);
  const resetFontDefaults = useCallback(() => {
    apply({ type: "resetFontSizes" }, "모든 글자 크기를 기본값으로 되돌렸습니다.");
  }, [apply]);
  const resetPageFontSize = useCallback((key: FontSizeKey) => {
    if (!selectedId) return;
    apply({ type: "clearPageFontSizes", id: selectedId, key } as ReportDocAction, `${fontSizeRow(key).label}를 모든 페이지 값으로 되돌렸습니다.`);
  }, [apply, selectedId]);
  const resetSelectedPanel = useCallback(() => {
    if (!selectedId || !selectedPage || (fontContext?.key !== "title" && fontContext?.key !== "summary" && fontContext?.key !== "legend")) return;
    const key = fontContext.key;
    const panels = Object.fromEntries(Object.entries(selectedPage.panels).filter(([panelKey]) => panelKey !== key)) as PagePanels;
    apply({ type: "panels", id: selectedId, panels });
    closeFontContext(true);
  }, [apply, closeFontContext, fontContext, selectedId, selectedPage]);
  const openFontContext = useCallback((key: FontSizeKey, x: number, y: number, opener: HTMLElement) => {
    setFontHighlight(key);
    setFontContextScope(pageFontSizes(selectedPage)[key] !== undefined ? "page" : "document");
    setFontContext({ key, x, y, opener });
    fontContextOpenerRef.current = opener;
    setActivePopover(null);
    setRail(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
    if (key === "title" || key === "summary" || key === "legend") setSelection({ kind: "panel", key });
    if (key === "source") setSelection({ kind: "element", key: "source" });
  }, [selectedPage]);
  const selectedPageMapSelectable = reportPageMapSelectable(selectedPage);
  const editableMapPage = selectedPage?.kind === "tile" || selectedPage?.kind === "compare" ? selectedPage : null;
  const mapCell = selectedPage?.kind === "compare"
    ? ((selection?.kind === "map" || selection?.kind === "mapElement" || selection?.kind === "mapLabel" || selection?.kind === "decoration") && selection.cell !== undefined ? selection.cell : 0)
    : undefined;
  const mapFrame = selectedPage?.kind === "tile"
    ? selectedPage.frame
    : selectedPage?.kind === "compare"
      ? selectedPage.cells[mapCell ?? 0]?.frame
      : undefined;
  const deleteMapElement = useCallback((key: string) => {
    if (!mapFrame) return;
    const patch = deleteElementFramePatch(mapFrame, key);
    if (!patch) return;
    applyFrame(mapCell, patch, `이 쪽에서 ${mapElementKindLabel(key)} 1개를 지웠습니다`);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
  }, [applyFrame, mapCell, mapFrame]);
  const hideMapLabel = useCallback((key: string) => {
    if (!mapFrame) return;
    const next = toggleLabelVisibility(mapFrame.pinnedKeys, mapFrame.hiddenLabelKeys, key, true);
    const patch = labelFramePatch(mapFrame, next);
    if (!patch) return;
    applyFrame(mapCell, patch, "라벨을 껐습니다");
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
  }, [applyFrame, mapCell, mapFrame]);
  const deletePageElement = useCallback((key: PageElementKey | "legend") => {
    if (!selectedId) return;
    if (key === "legend") {
      if (!mapFrame) return;
      applyFrame(mapCell, { legend: { ...mapFrame.legend, placement: "hidden" } }, "범례 칸을 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.");
    } else {
      const label = key === "title" ? "제목" : key === "summary" ? "요약" : "출처 줄";
      apply({ type: "pageElement", id: selectedId, key, deleted: true }, `${label}을 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.`);
    }
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
  }, [apply, applyFrame, mapCell, mapFrame, selectedId]);
  const deleteDecoration = useCallback((key: "north" | "scaleBar" | "locator") => {
    if (!mapFrame) return;
    const labels = { north: "방위표", scaleBar: "축척 막대", locator: "위치도" } as const;
    applyFrame(mapCell, { decorations: { ...mapFrame.decorations, [key]: false } }, `${labels[key]}를 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.`);
    setSelection(null);
    setMapMoveActive(false);
    setSettingsOpen(false);
  }, [applyFrame, mapCell, mapFrame]);
  const deleteFontContextElement = useCallback(() => {
    const key = fontContext?.key;
    if (!key) return;
    if (key === "title" || key === "summary" || key === "legend") deletePageElement(key);
    else if (key === "source") deletePageElement("source");
    else if (key === "labels" && (selection?.kind === "mapLabel" || selection?.kind === "mapElement")) hideMapLabel(selection.key);
    closeFontContext(true);
  }, [closeFontContext, deletePageElement, fontContext?.key, hideMapLabel, selection]);
  const layoutPageKind = selectedPage?.kind ?? "blank";
  const layoutHasMap = selectedSlide?.kind === "tile"
    ? !!selectedSlide.map
    : selectedSlide?.kind === "sheet"
      ? selectedSlide.cells.some((cell) => !!cell?.view.map)
      : false;
  const layoutHasSummary = selectedSlide?.kind === "tile"
    ? selectedSlide.style.summary !== false && !(selectedSlide.callout && selectedSlide.callout.page > 0)
    : false;
  const deletedLayoutItems = useMemo<DeletedLayoutItem[]>(() => {
    if (!selectedPage || !selectedId) return [];
    const items: DeletedLayoutItem[] = [];
    const pageLabels: Record<PageElementKey, string> = { title: "제목", summary: "요약", source: "출처 줄" };
    for (const key of selectedPage.deletedElementKeys ?? []) {
      items.push({ id: `page-${key}`, label: pageLabels[key], onRestore: () => { apply({ type: "pageElement", id: selectedId, key, deleted: false }, `${pageLabels[key]}을 되살렸습니다.`); } });
    }
    const frame = mapFrame;
    if (!frame) return items;
    if (frame.legend.placement === "hidden") items.push({ id: "legend", label: "범례", onRestore: () => applyFrame(mapCell, { legend: { ...frame.legend, placement: "below" } }, "범례 칸을 되살렸습니다.") });
    const decorationLabels = { north: "방위표", scaleBar: "축척 막대", locator: "위치도" } as const;
    for (const key of Object.keys(decorationLabels) as Array<keyof typeof decorationLabels>) {
      if (frame.decorations[key] !== false) continue;
      items.push({ id: `decoration-${key}`, label: decorationLabels[key], onRestore: () => applyFrame(mapCell, { decorations: { ...frame.decorations, [key]: true } }, `${decorationLabels[key]}를 되살렸습니다.`) });
    }
    for (const key of frame.deletedElementKeys) {
      const label = `지도 ${mapElementKindLabel(key)}`;
      items.push({ id: `map-${key}`, label, onRestore: () => applyFrame(mapCell, { deletedElementKeys: frame.deletedElementKeys.filter((candidate) => candidate !== key) }, `${label}를 되살렸습니다.`) });
    }
    return items;
  }, [apply, applyFrame, mapCell, mapFrame, selectedId, selectedPage]);
  const mapTileId = selectedPage?.kind === "tile"
    ? selectedPage.tileId
    : selectedPage?.kind === "compare"
      ? selectedPage.cells[mapCell ?? 0]?.tileId
      : undefined;
  const mapView = mapTileId ? views.get(mapTileId) ?? null : null;
  const mapModel = mapView?.map ?? mapView?.backdrop ?? null;
  const legendContextItems = useMemo<LegendContextMenuItem[]>(() => mapModel
    ? legendItemsForModel(mapModel).map((item) => ({
        layer: item.layer,
        label: item.label,
        color: item.color,
        lineSwatch: item.lineSwatch,
        visible: !(mapFrame?.legend.hidden ?? []).includes(item.layer),
      }))
    : [], [mapFrame?.legend.hidden, mapModel]);
  const setLegendItemVisibility = useCallback((layer: string, visible: boolean) => {
    if (!mapFrame) return;
    const hidden = visible
      ? mapFrame.legend.hidden.filter((candidate) => candidate !== layer)
      : [...new Set([...mapFrame.legend.hidden, layer])];
    applyFrame(mapCell, { legend: { ...mapFrame.legend, hidden } });
  }, [applyFrame, mapCell, mapFrame]);
  const showAllLegend = useCallback(() => {
    if (mapFrame) applyFrame(mapCell, { legend: { ...mapFrame.legend, hidden: [] } });
  }, [applyFrame, mapCell, mapFrame]);
  const hideLegendPanel = useCallback(() => {
    if (mapFrame) applyFrame(mapCell, { legend: { ...mapFrame.legend, placement: "hidden" } });
  }, [applyFrame, mapCell, mapFrame]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isTypingTarget(target) || target?.closest('[role="menu"], [role="dialog"], input, textarea, select, [contenteditable="true"]')) return;
      if (!selection) return;
      event.preventDefault();
      event.stopPropagation();
      if (selection.kind === "mapElement") deleteMapElement(selection.key);
      else if (selection.kind === "mapLabel") hideMapLabel(selection.key);
      else if (selection.kind === "decoration") deleteDecoration(selection.key);
      else if (selection.kind === "panel") deletePageElement(selection.key);
      else if (selection.kind === "element") deletePageElement(selection.key);
      else if (selection.kind === "textBox") applyTextBox({ id: selection.id, remove: true });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyTextBox, deleteDecoration, deleteMapElement, deletePageElement, hideMapLabel, selection]);
  const mapScaleOptions = selectedPage
    ? selectedPage.kind === "compare"
      ? (() => {
          const rect = sheetCells(selectedPage.grid)[mapCell ?? 0];
          return rect ? scaleOptionsForFrame(rect.w * 25.4, {
            width: 960,
            height: 960 * rect.h / rect.w,
            siteX: 0.5,
            siteY: 0.5,
            fill: 0.8,
          }) : null;
        })()
      : (() => {
          const format = history.present.format;
          const tile = selectedSlide?.kind === "tile" ? selectedSlide : null;
          const hasSummary = !!tile && tile.style.summary !== false && !(tile.callout && tile.callout.page > 0);
          const baseLegend = tile?.map ? slideLegend(tile.map, !tile.muted, undefined, hasSummary, format).rect : null;
          const legacyPanels = slidePanelRects(tile?.style, hasSummary, baseLegend, format);
          const customLayout = selectedPage.layout === "numbers-first" || selectedPage.layout === "side-by-side";
          const size = slideSize(format);
          const layout = customLayout ? layoutRects(selectedPage.layout, format) : null;
          const toRect = (rect: { x: number; y: number; w: number; h: number } | null) => rect
            ? { x: rect.x * size.w, y: rect.y * size.h, w: rect.w * size.w, h: rect.h * size.h }
            : null;
          const panels = layout
            ? { title: toRect(layout.title)!, summary: toRect(layout.summary), legend: toRect(layout.legend) }
            : legacyPanels;
          const terrainShown = !!tile && tile.view.code === "D17" && !!tile.view.terrainSections && !!tile.terrainSection;
          const terrainLayout = terrainShown ? terrainSectionLayout(panels, slideLayout(format), format) : null;
          return mapFrameScaleOptions(format, selectedPage.layout, {
            siteX: slideSiteX(tile?.style, panels.summary !== null, format),
            siteY: terrainLayout?.mapSiteY ?? 0.5,
            fill: terrainLayout?.mapFill ?? (tile?.callout?.page === 0 ? SLIDE_OVERVIEW_FILL : 0.8),
          });
        })()
    : null;
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
  }, [mapFrame?.locked, mapMoveActive, mapSelection, rememberDrawerOpener, selectedPageMapSelectable, selection, settingsOpen, signalLockAttention]);
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
    if (event.key !== "Escape" || activePopover || drawerOpen) return;
    const target = event.target as HTMLElement;
    if (target.closest("#report-map-scale-menu") || (target.closest("[data-map-scale-chip]") && document.getElementById("report-map-scale-menu"))) return;
    if (selection?.kind === "mapElement" || selection?.kind === "mapLabel") {
      event.preventDefault();
      event.stopPropagation();
      setSelection(null);
      setMapMoveActive(false);
      setSettingsOpen(false);
      return;
    }
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
      if (!target.closest("[data-preview-map], [data-map-scale-chip], #report-map-scale-menu")) setMapMoveActive(false);
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
          ref={reportStageRef}
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
                <div className={styles.emptyActions}><button type="button" className={styles.primaryButton} onClick={() => addPage("blank")}>＋ 페이지 추가</button><button type="button" className={styles.secondaryAction} onClick={startRecommended}><RecommendedIcon />추천 구성으로 시작</button>{legacyAvailable && <button type="button" className={styles.secondaryAction} onClick={importLegacy}><ImportReportIcon />이전 보고서 구성 불러오기</button>}</div>
              </div>
            ) : selectedSlide ? (
              <>
                <div className={styles.stageSlide}>
                   <SlideSurface slide={selectedSlide} basemap={basemap} mode="edit" selection={selection} fontHighlight={fontHighlight} onFontContextMenu={openFontContext} onSelect={handleSurfaceSelect} onMapMoveActive={setMapMoveFromSurface} onFrame={applyFrame} onPanels={applyPanels} onTextBox={applyTextBox} onText={editPanelText} textBoxEditingId={textBoxEditingId} textBoxPlacement={textBoxPlacement} onTextBoxPlacementMove={moveTextBoxPlacement} onTextBoxPlacementCommit={commitTextBoxPlacement} onTextBoxEditingChange={setTextBoxEditingId} onMapElementDelete={deleteMapElement} onMapLabelHide={hideMapLabel} onPanelDelete={deletePageElement} onDecorationSelect={(key) => handleSurfaceSelect({ kind: "decoration", key })} onDecorationDelete={deleteDecoration} onDirectStylePatch={() => undefined} onSheetCellActivate={(index) => { handleSurfaceSelect({ kind: "sheetCell", cell: index }); setMapMoveActive(false); }} mapActive={mapEditing} classMap={surfaceClassMap} />
                </div>
              </>
            ) : <div className={styles.emptyCanvas}>이 페이지는 아직 미리보기를 준비하고 있습니다.</div>}
          </div>

          {selection?.kind === "map" && mapFrame && mapModel && mapScaleOptions && <MapScaleChip
            stageRef={reportStageRef}
            format={history.present.format}
            frame={mapFrame}
            mapModel={mapModel}
            mapCell={mapCell}
            scale={mapScale}
            mapEditing={mapEditing}
            settingsOpen={settingsOpen}
            lockAttention={lockAttention}
            onZoom={(delta) => {
              if (mapFrame && mapModel && mapScaleOptions) {
                const currentZoomDelta = mapFrame.scaleDenominator !== null && Number.isFinite(mapFrame.scaleDenominator) && mapFrame.scaleDenominator > 0
                  ? zoomForScale(mapFrame.scaleDenominator, mapModel, mapScaleOptions)
                  : mapFrame.zoomDelta;
                applyFrame(mapCell, siteAnchoredZoomPatch(mapModel, mapFrame, mapScaleOptions, currentZoomDelta + delta, null));
              }
            }}
            onFit={() => {
              if (mapFrame && mapModel && mapScaleOptions) applyFrame(mapCell, siteFitPatch(mapModel, mapFrame, mapScaleOptions));
            }}
            onToggleLock={toggleMapLock}
            onEnterMapMove={enterMapMove}
            onOpenMapSettings={openMapSettings}
            onDone={endMapMove}
          />}

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
            <button type="button" className={`${styles.railButton} ${rail === "pages" && drawerOpen ? styles.railButtonActive : ""}`} aria-label="페이지" aria-pressed={rail === "pages" && drawerOpen} aria-expanded={rail === "pages" && drawerOpen} aria-controls="report-drawer" onClick={(event) => toggleRail("pages", event.currentTarget)}><span aria-hidden="true"><RailIcon name="pages" /></span><span className={styles.railTooltip} role="tooltip">페이지</span></button>
            <button type="button" className={`${styles.railButton} ${rail === "tiles" && drawerOpen ? styles.railButtonActive : ""}`} aria-label="분석 타일" aria-pressed={rail === "tiles" && drawerOpen} aria-expanded={rail === "tiles" && drawerOpen} aria-controls="report-drawer" onClick={(event) => toggleRail("tiles", event.currentTarget)}><span aria-hidden="true"><RailIcon name="tiles" /></span><span className={styles.railTooltip} role="tooltip">분석 타일</span></button>
            <button ref={textBoxTriggerRef} type="button" className={`${styles.railButton} ${textBoxPopoverOpen || textBoxPlacement ? styles.railButtonActive : ""}`} aria-label="글상자" aria-pressed={textBoxPopoverOpen || !!textBoxPlacement} aria-haspopup="dialog" aria-expanded={textBoxPopoverOpen} aria-controls={textBoxPopoverOpen ? "report-textbox-popover" : undefined} onClick={(event) => addTextBoxFromRail(event.currentTarget)} disabled={!selectedPage}><span aria-hidden="true"><RailIcon name="textbox" /></span><span className={styles.railTooltip} role="tooltip">글상자</span></button>
            <div className={styles.toolDivider} role="separator" aria-hidden="true" />
            <div className={styles.railPopoverRoot}>
              <button ref={fontSizeTriggerRef} type="button" className={`${styles.railButton} ${fontSizePopoverOpen ? styles.railButtonActive : ""}`} aria-pressed={fontSizePopoverOpen} aria-haspopup="dialog" aria-expanded={fontSizePopoverOpen} aria-controls={fontSizePopoverOpen ? "report-font-size-popover" : undefined} aria-label="글자 크기" onClick={(event) => toggleFontSizePopover(event.currentTarget)}><span aria-hidden="true"><RailIcon name="font" /></span><span className={styles.railTooltip} role="tooltip">글자 크기</span></button>
              {fontSizePopoverOpen && <div ref={fontSizePopoverRef} id="report-font-size-popover" className={`${styles.floatCard} ${styles.sidePanelCard} ${styles.anchoredCard} ${styles.railPopover} ${styles.fontSizePopover}`} style={{ ...anchoredCardStyle, ...sidePanelStyle }} role="dialog" aria-label="글자 크기"><FontSizePopover doc={history.present} page={selectedPage} pageNumber={selectedPageNumber} scope={fontScope} selectedKey={fontHighlight} opacity={sidePanelOpacity} onOpacityChange={changeSidePanelOpacity} onScope={setFontScope} onChange={changeFontSize} onSelect={setFontHighlight} onResetPage={resetPageFontSizes} onResetDefaults={resetFontDefaults} onClose={() => closePopover(true)} /></div>}
            </div>
            <div className={styles.railPopoverRoot}>
              <button ref={layoutTriggerRef} type="button" className={`${styles.railButton} ${layoutPopoverOpen ? styles.railButtonActive : ""}`} aria-haspopup="dialog" aria-pressed={layoutPopoverOpen} aria-expanded={layoutPopoverOpen} aria-controls={layoutPopoverOpen ? "report-layout-menu" : undefined} aria-label="페이지 레이아웃 메뉴" onClick={(event) => toggleLayoutPopover(event.currentTarget)} disabled={!selectedPage}><span aria-hidden="true"><RailIcon name="layout" /></span><span className={styles.railTooltip} role="tooltip">레이아웃</span></button>
               {layoutPopoverOpen && selectedPage && <div ref={layoutPopoverRef} id="report-layout-menu" className={`${styles.floatCard} ${styles.sidePanelCard} ${styles.anchoredCard} ${styles.railPopover}`} style={{ ...anchoredCardStyle, ...sidePanelStyle }} role="dialog" aria-label="페이지 레이아웃"><LayoutSwitcher compact pageNumber={selectedPageNumber ?? 1} value={selectedPage.layout} pageKind={layoutPageKind} hasMap={layoutHasMap} hasSummary={layoutHasSummary} grid={selectedPage.kind === "compare" ? selectedPage.grid : undefined} deletedItems={deletedLayoutItems} opacity={sidePanelOpacity} onOpacityChange={changeSidePanelOpacity} onChange={(layout) => apply({ type: "layout", id: selectedPage.id, layout })} onGridChange={(grid) => apply({ type: "grid", id: selectedPage.id, grid })} onClose={() => closePopover(true)} /></div>}
            </div>
            <div className={styles.railPopoverRoot}>
              <button ref={notesTriggerRef} type="button" className={`${styles.railButton} ${notesPopoverOpen ? styles.railButtonActive : ""}`} aria-haspopup="dialog" aria-pressed={notesPopoverOpen} aria-expanded={notesPopoverOpen} aria-controls={notesPopoverOpen ? "report-notes-popover" : undefined} aria-label={selectedPage?.notes.trim() ? "발표 메모 있음" : "발표 메모"} data-has-notes={selectedPage?.notes.trim() ? "true" : "false"} onClick={(event) => toggleNotesPopover(event.currentTarget)} disabled={!selectedPage}><span aria-hidden="true"><RailIcon name="notes" /></span><span className={styles.railTooltip} role="tooltip">메모</span>{selectedPage?.notes.trim() && <span className={styles.noteDot} aria-hidden="true" />}</button>
              {notesPopoverOpen && selectedPage && <div ref={notesPopoverRef} id="report-notes-popover" className={`${styles.floatCard} ${styles.sidePanelCard} ${styles.anchoredCard} ${styles.railPopover} ${styles.notesPopover}`} style={{ ...anchoredCardStyle, ...sidePanelStyle }} role="dialog" aria-label="발표 메모"><div className={styles.popoverBody}><SidePanelHeader title="발표 메모" context={`${selectedPageNumber ?? 1}쪽`} opacity={sidePanelOpacity} onOpacityChange={changeSidePanelOpacity} onClose={() => closePopover(true)} closeLabel="메모 창 닫기" /><NotesField compact pageId={selectedPage.id} value={selectedPage.notes} onChange={(notes) => apply({ type: "notes", id: selectedPage.id, notes })} /><div className={styles.notesMeta}><span aria-hidden="true">✓</span><span>저장됨</span></div></div></div>}
            </div>
            {textBoxPopoverOpen && <div ref={textBoxPopoverRef} id="report-textbox-popover" className={`${styles.floatCard} ${styles.sidePanelCard} ${styles.anchoredCard} ${styles.railPopover} ${styles.textBoxPopover}`} style={{ ...anchoredCardStyle, ...sidePanelStyle }} role="dialog" aria-label="글상자 종류"><TextBoxPopover opacity={sidePanelOpacity} onOpacityChange={changeSidePanelOpacity} onChoose={chooseTextBoxKind} onClose={() => closePopover(true)} /></div>}
          </nav>

          <aside
            ref={drawerRef}
            id="report-drawer"
            className={`${styles.floatCard} ${styles.sidePanelCard} ${styles.anchoredCard} ${styles.drawerCard}`}
            style={{ ...anchoredCardStyle, ...sidePanelStyle }}
            data-drawer-open={drawerOpen ? "true" : "false"}
            data-mobile-sheet={mobileViewport && drawerOpen ? "open" : "closed"}
            role={drawerOpen ? "dialog" : undefined}
            aria-modal={mobileViewport && drawerOpen ? true : undefined}
            aria-hidden={drawerOpen ? undefined : true}
            inert={exportOpen || !drawerOpen ? true : undefined}
            aria-label={rail === "tiles" ? "분석 타일 추가" : "페이지 추가"}
          >
            {rail === "pages" && <DrawerPages open afterPage={selectedPageNumber} hasLegacy={legacyAvailable} onAdd={addPage} onRecommended={startRecommended} onLegacy={importLegacy} onClose={() => closeDrawer(true)} opacity={sidePanelOpacity} onOpacityChange={changeSidePanelOpacity} />}
            {rail === "tiles" && <DrawerTiles open doc={history.present} views={views} mode={compareMode ? "compare" : "single"} compareGrid={compareGrid} compareSelected={compareSelected} onCompareGrid={setCompareGrid} onAdd={addTile} onToggleCompare={toggleCompareTile} onCreateCompare={addComparePage} onCancelCompare={() => { setCompareSelected([]); setCompareMode(false); }} onClose={() => closeDrawer(true)} opacity={sidePanelOpacity} onOpacityChange={changeSidePanelOpacity} getThumbnailSlide={getThumbnailSlide} classMap={surfaceClassMap} />}
          </aside>

          <div className={`${styles.floatCard} ${styles.pageDock}`} inert={modalContentInert || undefined}>
            <PageStrip items={stripItems} selectedId={selectedId} selectedSlideKey={selectedSlideKey} onSelect={selectStripItem} onNavigate={navigateStrip} onReorder={reorderPage} onDropMove={dropMovePage} onAddPage={() => { rememberDrawerOpener(); setActivePopover(null); setRail("pages"); setSelection(null); setMapMoveActive(false); setSettingsOpen(false); addPage("blank"); }} onDuplicate={duplicatePage} onDelete={deletePage} classMap={surfaceClassMap} exportSelectionMode={exportPageScope === "selected"} exportPageIds={exportPageIds} onToggleExportPage={toggleExportPage} />
          </div>
        </main>
      </div>
       {fontContext && <FontContextMenu menuRef={fontContextMenuRef} doc={history.present} page={selectedPage} pageNumber={selectedPageNumber} state={fontContext} scope={fontContextScope} onScope={setFontContextScope} onChange={changeFontSize} onResetPageKey={(key) => { resetPageFontSize(key); closeFontContext(true); }} onResetPanel={resetSelectedPanel} onDelete={deleteFontContextElement} legendItems={legendContextItems} onLegendVisibilityChange={setLegendItemVisibility} onShowAllLegend={showAllLegend} onHideLegendPanel={hideLegendPanel} onClose={() => closeFontContext(true)} />}
      {toast && <div className={styles.toast} role="status"><span className={styles.toastText}>{toast}</span><button type="button" onClick={() => { setToast(null); undo(); }}>되돌리기</button></div>}
    </section>
  );
}

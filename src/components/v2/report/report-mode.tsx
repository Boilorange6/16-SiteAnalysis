"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import type { Dispatch } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { defaultFrame, EMPTY_REPORT_DOC, newPageId, reportDocReducer, type MapFrameState, type PagePanels, type ReportDoc, type ReportDocAction, type ReportFontScale, type ReportFormat, type ReportLayout, type ReportPage, type TextBox } from "@/lib/v2/report/report-doc";
import { scaleForFrame } from "@/lib/v2/ui/report-scale";
import { importLegacyReport, hasLegacyReport, pagesForTile, planReportDoc, printedPageCount, recommendedPages } from "@/lib/v2/report/report-doc-plan";
import { tileReportSettingsFromBoard, type PlannedSlide } from "@/lib/v2/report/report-plan";
import { insertIndexAfter, moveByKey } from "@/lib/v2/ui/report-mode-logic";
import type { BoardAction, BoardState } from "@/lib/v2/ui/board-state";
import type { SummaryView, TileView } from "@/lib/v2/ui/tile-view";
import { SlideSurface, type SurfaceSelection } from "./slide-surface";
import DrawerPages, { type PageAddKind } from "./drawer-pages";
import DrawerTiles from "./drawer-tiles";
import PageStrip, { type PageStripItem } from "./page-strip";
import DrawerMap from "./drawer-map";
import LayoutSwitcher from "./layout-switcher";
import MapToolbar from "./map-toolbar";
import NotesField from "./notes-field";
import styles from "./report-mode.module.css";
import legacySurfaceStyles from "../report-preview.module.css";
import localSurfaceStyles from "./slide-surface.module.css";

type ReportHistory = { past: ReportDoc[]; present: ReportDoc; future: ReportDoc[] };
type RailKey = "pages" | "tiles" | "textbox" | "theme";
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

function mapWidthMm(format: ReportFormat, layout: ReportLayout): number {
  const base = format === "wide" ? 240 : format === "a3" ? 270 : 190;
  return layout === "numbers-first" || layout === "side-by-side" ? base * 0.45 : base;
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
        <div className={styles.themeScaleOptions} role="group" aria-label="글자 크기 배율">
          {([0.85, 1, 1.15] as const).map((scale) => <button key={scale} type="button" className={(doc.fontScale ?? 1) === scale ? styles.filterChipActive : styles.filterChip} aria-pressed={(doc.fontScale ?? 1) === scale} onClick={() => onFontScale(scale)}>{scale}×</button>)}
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

export default function ReportMode({ board, dispatch, views, summary, analysisDate, basemap, dirty, demo = false, busy = false, onPresentation }: ReportModeProps) {
  const [history, setHistory] = useState<ReportHistory>({ past: [], present: board.reportDoc, future: [] });
  const [selectedId, setSelectedId] = useState<string | null>(board.reportDoc.pages[0]?.id ?? null);
  const [rail, setRail] = useState<RailKey | null>("pages");
  const [compareMode, setCompareMode] = useState(false);
  const [compareGrid, setCompareGrid] = useState<"2x2" | "3x2" | "3x1">("2x2");
  const [compareSelected, setCompareSelected] = useState<string[]>([]);
  const [selection, setSelection] = useState<SurfaceSelection>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (history.present === board.reportDoc) return;
    setHistory({ past: [], present: board.reportDoc, future: [] });
  }, [board.reportDoc, history.present]);

  useEffect(() => {
    if (selectedId && history.present.pages.some((page) => page.id === selectedId)) return;
    setSelectedId(history.present.pages[0]?.id ?? null);
    setSelection(null);
  }, [history.present.pages, selectedId]);

  const planContext = useMemo(() => ({ summary, analysisDate, views }), [analysisDate, summary, views]);
  const plan = useMemo(() => planReportDoc(history.present, views, planContext), [history.present, planContext, views]);
  const printedCount = useMemo(() => printedPageCount(history.present, views, planContext), [history.present, planContext, views]);
  const stripItems = useMemo<PageStripItem[]>(() => history.present.pages.map((page) => {
    const matches = plan.filter((slide) => slide.page?.id === page.id);
    return { page, slide: matches[0], printedCount: matches.length || 1 };
  }), [history.present.pages, plan]);
  const selectedSlide = useMemo<PlannedSlide | undefined>(() => {
    if (!selectedId) return undefined;
    return plan.find((slide) => slide.page?.id === selectedId);
  }, [plan, selectedId]);

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
    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous) return current;
      dispatch({ type: "reportDoc", doc: previous });
      return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] };
    });
  }, [dispatch]);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      dispatch({ type: "reportDoc", doc: next });
      return { past: [...current.past, current.present], present: next, future: current.future.slice(1) };
    });
  }, [dispatch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
      if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  const addPages = useCallback((pages: ReportPage[], message?: string) => {
    if (pages.length === 0) return;
    const index = insertIndexAfter(history.present, selectedId);
    const first = pages[0]!;
    apply({ type: "add", pages, index }, message ?? `${pageTypeLabel(first)} 페이지를 ${index + 1}쪽에 추가했습니다.`);
    setSelectedId(pages[0].id);
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
    addPages(pages);
  }, [addPages, board, history.present, planContext, views]);

  const startRecommended = useCallback(() => {
    const empty = { ...EMPTY_REPORT_DOC, pages: [] };
    const pages = recommendedPages(empty, views, board, planContext);
    const next: ReportDoc = { ...history.present, pages };
    commitDoc(next, "추천 구성으로 시작했습니다.");
    setSelectedId(pages[0]?.id ?? null);
  }, [board, commitDoc, history.present, planContext, views]);

  const importLegacy = useCallback(() => {
    const empty = { ...EMPTY_REPORT_DOC, pages: [] };
    const pages = importLegacyReport(empty, board, views, planContext);
    commitDoc({ ...history.present, pages }, "이전 보고서 구성을 불러왔습니다.");
    setSelectedId(pages[0]?.id ?? null);
  }, [board, commitDoc, history.present, planContext, views]);

  const movePage = useCallback((id: string, key: "ArrowLeft" | "ArrowRight" | "Home" | "End") => {
    const action = moveByKey(history.present, id, key);
    if (action) apply(action);
  }, [apply, history.present]);

  const dropMovePage = useCallback((id: string, targetIndex: number) => {
    const sourceIndex = history.present.pages.findIndex((page) => page.id === id);
    if (sourceIndex < 0) return;
    const to = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    if (to === sourceIndex) return;
    apply({ type: "move", id, to });
  }, [apply, history.present.pages]);

  const deletePage = useCallback((id: string) => {
    const index = history.present.pages.findIndex((page) => page.id === id);
    const page = history.present.pages[index];
    apply({ type: "remove", id }, `${page ? pageTypeLabel(page) : "페이지"} 페이지를 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.`);
    if (selectedId === id) setSelectedId(history.present.pages[Math.max(0, index - 1)]?.id ?? history.present.pages[index + 1]?.id ?? null);
  }, [apply, history.present.pages, selectedId]);

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
    const box: TextBox = { id: `text-${Date.now().toString(36)}`, x: 4.4, y: 3.1, w: 4.4, h: 0.72, text: "글을 입력하세요", pt: 16 };
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

  const handleSurfaceSelect = useCallback((next: SurfaceSelection) => setSelection(next), []);
  const toggleRail = useCallback((next: RailKey) => setRail((current) => current === next ? null : next), []);
  const addTextBoxFromRail = useCallback(() => {
    const opening = rail !== "textbox";
    setRail(opening ? "textbox" : null);
    if (opening) addTextBox();
  }, [addTextBox, rail]);
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
  const mapWidth = selectedPage ? mapWidthMm(history.present.format, selectedPage.layout) : 240;
  const mapScale = mapFrame && mapModel ? scaleForFrame(mapFrame, mapWidth, mapModel.radiusM) : 1000;
  const legacyAvailable = hasLegacyReport(board);

  return (
    <section className={styles.reportRoot} aria-label="보고서 모드">
      <header className={styles.reportHeader}>
        <div className={styles.reportHeading}>
          <p className={styles.eyebrow}>대지분석 보고서</p>
          <h1>{summary.address} 보고서</h1>
        </div>
        <span className={styles.saveState} data-dirty={dirty ? "true" : "false"}>{dirty ? "저장 안 됨" : "저장됨"}</span>
        <div className={styles.reportHeaderSpacer} />
        <button type="button" className={styles.headerSelect} onClick={() => setRail("theme")} aria-label="보고서 판형">{formatLabel(history.present.format)}⌄</button>
        <button type="button" className={styles.secondaryButton} onClick={onPresentation} disabled={demo || busy || history.present.pages.length === 0}>발표 미리보기</button>
        <button type="button" className={styles.primaryDarkButton} disabled title="내보내기 패널은 Task 9에서 연결됩니다.">내보내기</button>
      </header>
      <div className={styles.reportBody} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <nav className={styles.reportRail} aria-label="보고서 요소">
          <button type="button" className={`${styles.railButton} ${rail === "pages" ? styles.railButtonActive : ""}`} aria-pressed={rail === "pages"} onClick={() => toggleRail("pages")}><span aria-hidden="true">▤</span><span>페이지</span></button>
          <button type="button" className={`${styles.railButton} ${rail === "tiles" ? styles.railButtonActive : ""}`} aria-pressed={rail === "tiles"} onClick={() => toggleRail("tiles")}><span aria-hidden="true">◈</span><span>분석 타일</span></button>
          <button type="button" className={`${styles.railButton} ${rail === "textbox" ? styles.railButtonActive : ""}`} aria-pressed={rail === "textbox"} onClick={addTextBoxFromRail}><span aria-hidden="true">T</span><span>글상자</span></button>
          <button type="button" className={`${styles.railButton} ${rail === "theme" ? styles.railButtonActive : ""}`} aria-pressed={rail === "theme"} onClick={() => toggleRail("theme")}><span aria-hidden="true">◌</span><span>테마</span></button>
        </nav>
        <aside className={styles.drawerColumn}>
          {rail === "pages" && <DrawerPages open hasLegacy={legacyAvailable} onAdd={addPage} onRecommended={startRecommended} onLegacy={importLegacy} />}
          {rail === "tiles" && <DrawerTiles open doc={history.present} views={views} mode={compareMode ? "compare" : "single"} compareGrid={compareGrid} compareSelected={compareSelected} onCompareGrid={setCompareGrid} onAdd={addTile} onToggleCompare={toggleCompareTile} onCreateCompare={addComparePage} onCancelCompare={() => { setCompareSelected([]); setCompareMode(false); }} />}
          {rail === "textbox" && <TextBoxDrawer onAdd={addTextBox} />}
          {rail === "theme" && <ThemeDrawer doc={history.present} onFormat={(format) => apply({ type: "format", format }, `${formatLabel(format)} 판형으로 바꿨습니다.`)} onFontScale={(fontScale) => apply({ type: "theme", fontScale }, `${fontScale}배 글자 크기를 적용했습니다.`)} onClose={() => setRail("pages")} />}
        </aside>
        <main className={styles.reportWorkspace}>
          <div className={styles.workspaceTools}>
            <div><span className={styles.workspaceKicker}>보고서 작업 공간</span><strong>{printedCount}쪽</strong></div>
            <div className={styles.workspaceActions}>
              <button type="button" className={styles.iconButton} onClick={undo} disabled={history.past.length === 0} aria-label="되돌리기" title="되돌리기">↶</button>
              <button type="button" className={styles.iconButton} onClick={redo} disabled={history.future.length === 0} aria-label="다시 실행" title="다시 실행">↷</button>
              {selectedPage && <span className={styles.selectedPageLabel}>{pageTypeLabel(selectedPage)}</span>}
            </div>
          </div>
          {history.present.pages.length === 0 ? (
            <div className={styles.emptyReport}>
              <div className={styles.emptyCanvas}><span className={styles.emptyCanvasMark}>＋</span><strong>페이지를 추가하세요</strong><span>보고서의 첫 장을 선택해 작업을 시작합니다.</span></div>
              <div className={styles.emptyActions}><button type="button" className={styles.primaryButton} onClick={() => addPage("blank")}>＋ 페이지 추가</button><button type="button" className={styles.secondaryButton} onClick={startRecommended}>추천 구성으로 시작</button>{legacyAvailable && <button type="button" className={styles.linkButton} onClick={importLegacy}>이전 보고서 구성 불러오기</button>}</div>
            </div>
          ) : selectedSlide ? (
            <div className={styles.stageAndSettings}>
              <div className={styles.stageColumn}>
                {mapFrame && mapModel && <>
                  <MapToolbar scale={mapScale} locked={mapFrame.locked} mapActive={selection?.kind === "map"} onZoom={(delta) => applyFrame(mapCell, { zoomDelta: mapFrame.zoomDelta + delta, scaleDenominator: null })} onFit={() => applyFrame(mapCell, { zoomDelta: 0, offsetM: [0, 0], scaleDenominator: null })} onToggleMove={() => setSelection((current) => current?.kind === "map" ? null : { kind: "map", ...(mapCell === undefined ? {} : { cell: mapCell }) })} onToggleLock={() => applyFrame(mapCell, { locked: !mapFrame.locked })} onOpen={() => setSelection({ kind: "map", ...(mapCell === undefined ? {} : { cell: mapCell }) })} />
                  {selection?.kind === "map" && <p className={styles.mapHint}>지도를 끌어 옮기고 휠로 확대합니다 · Esc 또는 바깥을 누르면 끝납니다</p>}
                </>}
                <div className={styles.stageFrame} data-report-stage>
                  <SlideSurface slide={selectedSlide} basemap={basemap} mode="edit" selection={selection} onSelect={handleSurfaceSelect} onFrame={applyFrame} onPanels={applyPanels} onTextBox={applyTextBox} onText={editPanelText} onSheetCellActivate={(index) => setSelection({ kind: "map", cell: index })} mapActive={selection?.kind === "map"} classMap={surfaceClassMap} />
                </div>
              </div>
              <aside className={styles.editorSide}>
                {mapFrame && selectedPage && (selectedPage.kind === "tile" || selectedPage.kind === "compare") && <DrawerMap page={selectedPage} frame={mapFrame} view={mapView} cell={mapCell} mapWidthMm={mapWidth} sameExtent={selectedPage.kind === "compare" ? selectedPage.sameExtent : undefined} onSameExtent={selectedPage.kind === "compare" ? (value) => apply({ type: "sameExtent", id: selectedPage.id, value }) : undefined} onFrame={(patch: Partial<MapFrameState>) => applyFrame(mapCell, patch)} />}
                {selectedPage && <LayoutSwitcher value={selectedPage.layout} onChange={(layout) => apply({ type: "layout", id: selectedPage.id, layout })} />}
                {selectedPage && <NotesField pageId={selectedPage.id} value={selectedPage.notes} onChange={(notes) => apply({ type: "notes", id: selectedPage.id, notes })} />}
              </aside>
            </div>
          ) : <div className={styles.emptyCanvas}>이 페이지는 아직 미리보기를 준비하고 있습니다.</div>}
          <PageStrip items={stripItems} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setSelection(null); }} onMove={movePage} onDropMove={dropMovePage} onAddPage={() => { setRail("pages"); addPage("blank"); }} onDuplicate={duplicatePage} onDelete={deletePage} classMap={surfaceClassMap} />
        </main>
      </div>
      {toast && <div className={styles.toast} role="status">{toast} <button type="button" onClick={undo}>되돌리기</button></div>}
    </section>
  );
}

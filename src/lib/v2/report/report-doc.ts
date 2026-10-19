import type { TileReportSettings } from "./report-plan";

export type ReportFormat = "wide" | "a3" | "a4";
export type ReportLayout = "map-full" | "map-summary" | "numbers-first" | "side-by-side";
export type ReportFontScale = 0.85 | 1 | 1.15;

export type LegendPlacement = "below" | "right" | "hidden";
export type LabelRule = "site-near" | "all-visible" | "off";
export type MapFrameState = {
  zoomDelta: number;
  offsetM: [number, number];
  scaleDenominator: number | null;
  locked: boolean;
  basemap: "base" | "road" | "air" | "none";
  hiddenLayers: string[];
  labelRule: LabelRule;
  pinnedKeys: string[];
  legend: { order: string[]; hidden: string[]; visibleOnly: boolean; placement: LegendPlacement };
  decorations: { north: boolean; scaleBar: boolean; locator: boolean };
};

export type PagePanels = Partial<Record<"title" | "summary" | "legend", { x: number; y: number; w: number; h: number }>>;
export type TextBox = { id: string; x: number; y: number; w: number; h: number; text: string; pt: number };
export type ReportPageBase = {
  id: string;
  layout: ReportLayout;
  panels: PagePanels;
  textBoxes: TextBox[];
  notes: string;
  titleOverride?: string;
  summaryOverride?: string;
};
export type TilePart =
  | { type: "single" }
  | { type: "face"; face: "front" | "back" }
  | { type: "callout"; page: number }
  | { type: "cutSheet"; index: number }
  | { type: "cutSingle" };
export type ReportPage = ReportPageBase & (
  | { kind: "cover" }
  | { kind: "tile"; tileId: string; part: TilePart; settings: TileReportSettings; frame: MapFrameState }
  | { kind: "compare"; grid: "2x2" | "3x2" | "3x1"; cells: { tileId: string; settings: TileReportSettings; frame: MapFrameState }[]; sameExtent: boolean }
  | { kind: "sources" }
  | { kind: "blank" }
);
export type ReportDoc = { v: 1; format: ReportFormat; pages: ReportPage[]; fontScale?: ReportFontScale };

export type ReportDocAction =
  | { type: "add"; pages: ReportPage[]; index: number }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; to: number }
  | { type: "duplicate"; id: string }
  | { type: "layout"; id: string; layout: ReportLayout }
  | { type: "frame"; id: string; cell?: number; patch: Partial<MapFrameState>; force?: boolean }
  | { type: "sameExtent"; id: string; value: boolean }
  | { type: "panels"; id: string; panels: PagePanels }
  | { type: "notes"; id: string; notes: string }
  | { type: "text"; id: string; title?: string; summary?: string }
  | { type: "textBox"; id: string; box: TextBox | { id: string; remove: true } }
  | { type: "format"; format: ReportFormat }
  | { type: "theme"; fontScale: ReportFontScale }
  | { type: "replaceAll"; pages: ReportPage[] };

export const EMPTY_REPORT_DOC: ReportDoc = { v: 1, format: "wide", pages: [] };

export function defaultFrame(): MapFrameState {
  return {
    zoomDelta: 0,
    offsetM: [0, 0],
    scaleDenominator: null,
    locked: false,
    basemap: "base",
    hiddenLayers: [],
    labelRule: "site-near",
    pinnedKeys: [],
    legend: { order: [], hidden: [], visibleOnly: true, placement: "below" },
    decorations: { north: true, scaleBar: true, locator: false },
  };
}

function clonePanels(panels: PagePanels): PagePanels {
  return Object.fromEntries(Object.entries(panels).map(([key, value]) => [key, value ? { ...value } : value])) as PagePanels;
}

function cloneFrame(frame: MapFrameState): MapFrameState {
  return {
    ...frame,
    offsetM: [...frame.offsetM] as [number, number],
    hiddenLayers: [...frame.hiddenLayers],
    pinnedKeys: [...frame.pinnedKeys],
    legend: { ...frame.legend, order: [...frame.legend.order], hidden: [...frame.legend.hidden] },
    decorations: { ...frame.decorations },
  };
}

function cloneSettings(settings: TileReportSettings): TileReportSettings {
  const filter = settings.a05Filter;
  const a05Filter = filter
    ? {
        ...filter,
        ...(filter.types ? { types: [...filter.types] } : {}),
        ...Object.fromEntries((['year', 'households', 'floors', 'buildings', 'distance'] as const)
          .filter((key) => filter[key])
          .map((key) => [key, { ...filter[key] }])),
      }
    : undefined;
  return {
    ...settings,
    ...(settings.cut ? { cut: { ...settings.cut } } : {}),
    ...(settings.camera ? { camera: { ...settings.camera } } : {}),
    ...(a05Filter ? { a05Filter } : {}),
    ...(settings.labels ? { labels: settings.labels.map((label) => ({ ...label })) } : {}),
  };
}

function clonePart(part: TilePart): TilePart {
  return { ...part };
}

function cloneBase(page: ReportPage): ReportPageBase {
  return {
    id: page.id,
    layout: page.layout,
    panels: clonePanels(page.panels),
    textBoxes: page.textBoxes.map((box) => ({ ...box })),
    notes: page.notes,
    ...(page.titleOverride !== undefined ? { titleOverride: page.titleOverride } : {}),
    ...(page.summaryOverride !== undefined ? { summaryOverride: page.summaryOverride } : {}),
  };
}

function clonePage(page: ReportPage): ReportPage {
  const base = cloneBase(page);
  if (page.kind === "tile") return { ...base, kind: "tile", tileId: page.tileId, part: clonePart(page.part), settings: cloneSettings(page.settings), frame: cloneFrame(page.frame) };
  if (page.kind === "compare") {
    return {
      ...base,
      kind: "compare",
      grid: page.grid,
      sameExtent: page.sameExtent,
      cells: page.cells.map((cell) => ({ tileId: cell.tileId, settings: cloneSettings(cell.settings), frame: cloneFrame(cell.frame) })),
    };
  }
  return { ...base, kind: page.kind };
}

function clonePages(pages: ReportPage[]): ReportPage[] {
  return pages.map(clonePage);
}

export function newPageId(doc: ReportDoc): string {
  const used = new Set(doc.pages.map((page) => page.id));
  for (let index = 1; ; index += 1) {
    const id = `p${index}`;
    if (!used.has(id)) return id;
  }
}

function updatePage(doc: ReportDoc, id: string, update: (page: ReportPage) => ReportPage): ReportDoc {
  const index = doc.pages.findIndex((page) => page.id === id);
  if (index < 0) return doc;
  const nextPage = update(doc.pages[index]);
  if (nextPage === doc.pages[index]) return doc;
  const pages = [...doc.pages];
  pages[index] = nextPage;
  return { ...doc, pages };
}

function mergeFrame(frame: MapFrameState, patch: Partial<MapFrameState>): MapFrameState {
  return {
    ...frame,
    ...(patch.zoomDelta !== undefined ? { zoomDelta: patch.zoomDelta } : {}),
    ...(patch.offsetM !== undefined ? { offsetM: [...patch.offsetM] as [number, number] } : {}),
    ...(patch.scaleDenominator !== undefined ? { scaleDenominator: patch.scaleDenominator } : {}),
    ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
    ...(patch.basemap !== undefined ? { basemap: patch.basemap } : {}),
    ...(patch.hiddenLayers !== undefined ? { hiddenLayers: [...patch.hiddenLayers] } : {}),
    ...(patch.labelRule !== undefined ? { labelRule: patch.labelRule } : {}),
    ...(patch.pinnedKeys !== undefined ? { pinnedKeys: [...patch.pinnedKeys] } : {}),
    ...(patch.legend !== undefined
      ? { legend: { ...patch.legend, order: [...patch.legend.order], hidden: [...patch.legend.hidden] } }
      : {}),
    ...(patch.decorations !== undefined ? { decorations: { ...patch.decorations } } : {}),
  };
}

function frameWithPatch(frame: MapFrameState, patch: Partial<MapFrameState>, force: boolean | undefined): MapFrameState {
  if (!frame.locked || force || patch.locked === false) return mergeFrame(frame, patch);
  const allowed = { ...patch };
  delete allowed.zoomDelta;
  delete allowed.offsetM;
  delete allowed.scaleDenominator;
  return mergeFrame(frame, allowed);
}

function updateFrame(page: ReportPage, cell: number | undefined, patch: Partial<MapFrameState>, force: boolean | undefined): ReportPage {
  const next = clonePage(page);
  if (next.kind === "tile" && cell === undefined) {
    next.frame = frameWithPatch(next.frame, patch, force);
    return next;
  }
  if (next.kind === "compare" && cell !== undefined && Number.isInteger(cell) && cell >= 0 && cell < next.cells.length) {
    next.cells[cell] = { ...next.cells[cell], frame: frameWithPatch(next.cells[cell].frame, patch, force) };
    return next;
  }
  return page;
}

function resetPanels(page: ReportPage): ReportPage {
  const next = clonePage(page);
  next.panels = {};
  return next;
}

export function reportDocReducer(doc: ReportDoc, action: ReportDocAction): ReportDoc {
  switch (action.type) {
    case "add": {
      if (action.pages.length === 0) return doc;
      const index = Math.max(0, Math.min(doc.pages.length, Math.trunc(action.index)));
      return { ...doc, pages: [...doc.pages.slice(0, index), ...clonePages(action.pages), ...doc.pages.slice(index)] };
    }
    case "remove": {
      if (!doc.pages.some((page) => page.id === action.id)) return doc;
      return { ...doc, pages: doc.pages.filter((page) => page.id !== action.id) };
    }
    case "move": {
      const from = doc.pages.findIndex((page) => page.id === action.id);
      if (from < 0) return doc;
      const pages = [...doc.pages];
      const [page] = pages.splice(from, 1);
      const to = Math.max(0, Math.min(pages.length, Math.trunc(action.to)));
      pages.splice(to, 0, page);
      return { ...doc, pages };
    }
    case "duplicate": {
      const index = doc.pages.findIndex((page) => page.id === action.id);
      if (index < 0) return doc;
      const duplicate = { ...clonePage(doc.pages[index]), id: newPageId(doc) };
      return { ...doc, pages: [...doc.pages.slice(0, index + 1), duplicate, ...doc.pages.slice(index + 1)] };
    }
    case "layout":
      return updatePage(doc, action.id, (page) => ({ ...resetPanels(page), layout: action.layout }));
    case "frame":
      return updatePage(doc, action.id, (page) => updateFrame(page, action.cell, action.patch, action.force));
    case "sameExtent":
      return updatePage(doc, action.id, (page) => page.kind === "compare" ? { ...page, sameExtent: action.value } : page);
    case "panels":
      return updatePage(doc, action.id, (page) => ({ ...clonePage(page), panels: clonePanels(action.panels) }));
    case "notes":
      return updatePage(doc, action.id, (page) => ({ ...clonePage(page), notes: action.notes }));
    case "text":
      return updatePage(doc, action.id, (page) => ({
        ...clonePage(page),
        ...(action.title !== undefined ? { titleOverride: action.title } : {}),
        ...(action.summary !== undefined ? { summaryOverride: action.summary } : {}),
      }));
    case "textBox":
      return updatePage(doc, action.id, (page) => {
        const next = clonePage(page);
        if ("remove" in action.box) next.textBoxes = next.textBoxes.filter((box) => box.id !== action.box.id);
        else {
          const index = next.textBoxes.findIndex((box) => box.id === action.box.id);
          if (index < 0) next.textBoxes.push({ ...action.box });
          else next.textBoxes[index] = { ...action.box };
        }
        return next;
      });
    case "format":
      return { ...doc, format: action.format, pages: doc.pages.map(resetPanels) };
    case "theme":
      return { ...doc, fontScale: action.fontScale };
    case "replaceAll":
      return { ...doc, pages: clonePages(action.pages) };
  }
}

export type ReportHistory = { past: ReportDoc[]; present: ReportDoc; future: ReportDoc[] };

export function historyApply(history: ReportHistory, action: ReportDocAction): ReportHistory {
  const present = reportDocReducer(history.present, action);
  if (present === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-100),
    present,
    future: [],
  };
}

export function historyUndo(history: ReportHistory): ReportHistory {
  if (history.past.length === 0) return history;
  const present = history.past.at(-1)!;
  return {
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
  };
}

export function historyRedo(history: ReportHistory): ReportHistory {
  if (history.future.length === 0) return history;
  const present = history.future[0]!;
  return {
    past: [...history.past, history.present].slice(-100),
    present,
    future: history.future.slice(1),
  };
}

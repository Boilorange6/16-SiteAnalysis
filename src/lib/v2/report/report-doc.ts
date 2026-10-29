import type { TileReportSettings } from "./report-plan";
import { normalizeA05Filter, type A05Filter } from "../engine/a05-filter";
import { clonePagePanels as clonePanelRects, type PagePanels } from "./report-geometry";
import { normalizeMapColors } from "../ui/map-colors";
import type { DiagramPaletteRef } from "../ui/map-palette";
import type { BaseThemeRef, BaseToggleLayer } from "../ui/map-theme";
export type { PagePanelKey, PagePanelRect, PagePanels } from "./report-geometry";

export type ReportFormat = "wide" | "a3" | "a4";
export type ReportLayout = "map-full" | "map-summary" | "map-charts" | "numbers-first" | "side-by-side";
export type ReportFontScale = 0.85 | 1 | 1.15;
export type FontSizeKey = "title" | "summary" | "legend" | "labels" | "source" | "scale";
export type ReportFontSizes = Record<FontSizeKey, number>;
export type ReportFontSizeOverrides = Partial<ReportFontSizes>;
export type PageElementKey = "title" | "summary" | "source";
export const PAGE_ELEMENT_KEYS: readonly PageElementKey[] = ["title", "summary", "source"];

export const DEFAULT_REPORT_FONT_SIZES: ReportFontSizes = {
  title: 18,
  summary: 13,
  legend: 10,
  labels: 10,
  source: 9,
  scale: 11,
};

export const REPORT_FONT_SIZE_LIMITS: Record<FontSizeKey, { min: number; max: number }> = {
  title: { min: 12, max: 32 },
  summary: { min: 10, max: 24 },
  legend: { min: 8, max: 16 },
  labels: { min: 8, max: 18 },
  source: { min: 7, max: 14 },
  scale: { min: 7, max: 14 },
};

export const REPORT_FONT_SIZE_KEYS: readonly FontSizeKey[] = ["title", "summary", "legend", "labels", "source", "scale"];

export function defaultReportFontSizes(): ReportFontSizes {
  return { ...DEFAULT_REPORT_FONT_SIZES };
}

export function clampReportFontSize(key: FontSizeKey, value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const limits = REPORT_FONT_SIZE_LIMITS[key];
  return Math.max(limits.min, Math.min(limits.max, Math.round(value)));
}

export function clampReportFontSizes(value: unknown): ReportFontSizeOverrides {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const output: ReportFontSizeOverrides = {};
  for (const key of REPORT_FONT_SIZE_KEYS) {
    const normalized = clampReportFontSize(key, source[key]);
    if (normalized !== null) output[key] = normalized;
  }
  return output;
}

export function mergeReportFontSizes(documentFontSizes?: unknown, pageFontSizes?: unknown): ReportFontSizes {
  const documentValues = clampReportFontSizes(documentFontSizes);
  const pageValues = clampReportFontSizes(pageFontSizes);
  const output = defaultReportFontSizes();
  for (const key of REPORT_FONT_SIZE_KEYS) {
    if (documentValues[key] !== undefined) output[key] = documentValues[key]!;
    if (pageValues[key] !== undefined) output[key] = pageValues[key]!;
  }
  return output;
}

export function reportFontSizesFromLegacyScale(scale: unknown): ReportFontSizes | undefined {
  if (scale !== 0.85 && scale !== 1 && scale !== 1.15) return undefined;
  const output = defaultReportFontSizes();
  for (const key of REPORT_FONT_SIZE_KEYS) output[key] = clampReportFontSize(key, DEFAULT_REPORT_FONT_SIZES[key] * scale)!;
  return output;
}

export type LegendPlacement = "below" | "right" | "hidden";
export type LabelRule = "site-near" | "all-visible" | "off";
export type MapLabelBox = { x: number; y: number; w: number; h: number };
export const MAP_LABEL_MIN_WIDTH = 0.06;
export const MAP_LABEL_MIN_HEIGHT = 0.05;

/** 지도 프레임 안의 정규화 라벨 상자. 옛 저장본과 UI 입력을 같은 규칙으로 맞춘다. */
export function normalizeMapLabelBox(value: Partial<MapLabelBox> | undefined): MapLabelBox {
  const width = Math.max(MAP_LABEL_MIN_WIDTH, Math.min(1, Number.isFinite(value?.w) ? value!.w! : MAP_LABEL_MIN_WIDTH));
  const height = Math.max(MAP_LABEL_MIN_HEIGHT, Math.min(1, Number.isFinite(value?.h) ? value!.h! : MAP_LABEL_MIN_HEIGHT));
  const x = Math.max(0, Math.min(1 - width, Number.isFinite(value?.x) ? value!.x! : 0));
  const y = Math.max(0, Math.min(1 - height, Number.isFinite(value?.y) ? value!.y! : 0));
  return { x, y, w: width, h: height };
}

export type MapFrameState = {
  zoomDelta: number;
  offsetM: [number, number];
  scaleDenominator: number | null;
  locked: boolean;
  basemap: "base" | "road" | "air" | "none";
  hiddenLayers: string[];
  labelRule: LabelRule;
  pinnedKeys: string[];
  hiddenLabelKeys: string[];
  deletedElementKeys: string[];
  labelBoxes: Record<string, MapLabelBox>;
  legend: { order: string[]; hidden: string[]; visibleOnly: boolean; placement: LegendPlacement };
  decorations: { north: boolean; scaleBar: boolean; locator: boolean };
};

export const TEXT_BOX_COLORS = ["#15171c", "#4a5160", "#2f6fdb", "#5b4fd6", "#d9480f", "#c92a2a", "#2e9e4a", "#fff"] as const;
export type TextBoxColor = typeof TEXT_BOX_COLORS[number];
export type TextBoxKind = "title" | "body" | "note";
export type TextBoxAlign = "left" | "center";
export type TextBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  pt: number;
  kind?: TextBoxKind;
  bold?: boolean;
  italic?: boolean;
  color?: TextBoxColor;
  align?: TextBoxAlign;
};
export const TEXT_BOX_DEFAULTS: Record<TextBoxKind, Omit<Pick<TextBox, "w" | "h" | "pt" | "bold" | "italic" | "color" | "align">, never>> = {
  title: { w: 4.8, h: 0.86, pt: 20, bold: true, italic: false, color: "#15171c", align: "left" },
  body: { w: 4.4, h: 0.72, pt: 14, bold: false, italic: false, color: "#15171c", align: "left" },
  note: { w: 3.8, h: 0.55, pt: 10, bold: false, italic: false, color: "#4a5160", align: "left" },
};
export const TEXT_BOX_MIN_WIDTH = 1;
export const TEXT_BOX_MIN_HEIGHT = 0.45;

export function textBoxDefaults(kind: TextBoxKind, id: string, x: number, y: number): TextBox {
  return { id, kind, x, y, text: "", ...TEXT_BOX_DEFAULTS[kind] };
}

export function clampTextBox(box: TextBox, maxWidth: number, maxHeight: number): TextBox {
  const widthLimit = Math.max(TEXT_BOX_MIN_WIDTH, Number.isFinite(maxWidth) ? maxWidth : TEXT_BOX_MIN_WIDTH);
  const heightLimit = Math.max(TEXT_BOX_MIN_HEIGHT, Number.isFinite(maxHeight) ? maxHeight : TEXT_BOX_MIN_HEIGHT);
  const w = Math.max(TEXT_BOX_MIN_WIDTH, Math.min(widthLimit, Number.isFinite(box.w) ? box.w : TEXT_BOX_MIN_WIDTH));
  const h = Math.max(TEXT_BOX_MIN_HEIGHT, Math.min(heightLimit, Number.isFinite(box.h) ? box.h : TEXT_BOX_MIN_HEIGHT));
  const x = Math.max(0, Math.min(Math.max(0, widthLimit - w), Number.isFinite(box.x) ? box.x : 0));
  const y = Math.max(0, Math.min(Math.max(0, heightLimit - h), Number.isFinite(box.y) ? box.y : 0));
  return { ...box, x, y, w, h };
}
/** 지도 색 선택. 없는 필드는 한 단계 위(쪽 → 보고서 → 보드 → 기본)를 따른다. */
export type MapColorChoice = { base?: BaseThemeRef; palette?: DiagramPaletteRef; hide?: BaseToggleLayer[] };

export type ReportPageBase = {
  id: string;
  layout: ReportLayout;
  panels: PagePanels;
  textBoxes: TextBox[];
  notes: string;
  /** 제목·요약·출처 줄처럼 지도 frame이 아닌 페이지 요소의 삭제 상태. 옛 저장본은 빈 목록이다. */
  deletedElementKeys?: PageElementKey[];
  titleOverride?: string;
  summaryOverride?: string;
  fontSizes?: ReportFontSizeOverrides;
  /** 이 쪽만 덮어쓰는 지도 색 */
  mapColors?: MapColorChoice;
};
export type TilePart =
  | { type: "single" }
  | { type: "face"; face: "front" | "back" }
  | { type: "callout"; page: number; shownKeys?: string[]; filter?: A05Filter | null }
  | { type: "cutSheet"; index: number }
  | { type: "cutSingle" };
export type ReportPage = ReportPageBase & (
  | { kind: "cover" }
  | { kind: "tile"; tileId: string; part: TilePart; settings: TileReportSettings; frame: MapFrameState }
  | { kind: "compare"; grid: "2x2" | "3x2" | "3x1"; cells: ({ tileId: string; settings: TileReportSettings; frame: MapFrameState; panels?: PagePanels } | null)[]; sameExtent: boolean }
  | { kind: "sources" }
  | { kind: "blank" }
);
export type ReportDoc = { v: 1; format: ReportFormat; pages: ReportPage[]; fontSizes?: ReportFontSizeOverrides; /** 보고서 전체의 지도 색 */ mapColors?: MapColorChoice; /** @deprecated legacy saves are migrated at restore. */ fontScale?: ReportFontScale };

export type ReportDocAction =
  | { type: "add"; pages: ReportPage[]; index: number }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; to: number }
  | { type: "duplicate"; id: string }
  | { type: "layout"; id: string; layout: ReportLayout }
  | { type: "grid"; id: string; grid: "2x2" | "3x2" | "3x1" }
  | { type: "frame"; id: string; cell?: number; patch: Partial<MapFrameState>; force?: boolean }
  | { type: "copyExtent"; id: string; cell: number }
  | { type: "removeCell"; id: string; cell: number }
  | { type: "sameExtent"; id: string; value: boolean }
  | { type: "pageElement"; id: string; key: PageElementKey; deleted: boolean }
  | { type: "panels"; id: string; panels: PagePanels }
  | { type: "cellPanels"; id: string; cell: number; panels: PagePanels }
  | { type: "notes"; id: string; notes: string }
  | { type: "text"; id: string; title?: string; summary?: string }
  | { type: "textBox"; id: string; box: TextBox | { id: string; remove: true } }
  | { type: "format"; format: ReportFormat }
  | { type: "fontSizes"; scope: "document" | "page"; id?: string; key: FontSizeKey; value: number }
  | { type: "clearPageFontSizes"; id: string; key?: FontSizeKey }
  | { type: "resetFontSizes" }
  | { type: "theme"; fontScale: ReportFontScale }
  /** patch는 필드 단위로 합친다. null은 그 범위의 선택을 모두 지운다. */
  | { type: "mapColors"; scope: "document" | "page"; id?: string; patch: MapColorChoice | null }
  | { type: "tileCallout"; id: string; pages: ReportPage[] }
  | { type: "calloutShown"; id: string; keys: string[] }
  | { type: "calloutFilter"; id: string; filter: A05Filter | null; keys?: string[] }
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
    hiddenLabelKeys: [],
    deletedElementKeys: [],
    labelBoxes: {},
    legend: { order: [], hidden: [], visibleOnly: true, placement: "below" },
    decorations: { north: true, scaleBar: true, locator: false },
  };
}

function clonePanels(panels: PagePanels): PagePanels {
  return clonePanelRects(panels) ?? {};
}

function cloneFrame(frame: MapFrameState): MapFrameState {
  return {
    ...frame,
    offsetM: [...frame.offsetM] as [number, number],
    hiddenLayers: [...frame.hiddenLayers],
    pinnedKeys: [...frame.pinnedKeys],
    hiddenLabelKeys: [...(frame.hiddenLabelKeys ?? [])],
    deletedElementKeys: [...(frame.deletedElementKeys ?? [])],
    labelBoxes: Object.fromEntries(Object.entries(frame.labelBoxes ?? {}).map(([key, box]) => [key, { ...box }])),
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
  if (part.type !== "callout") return { ...part };
  return {
    ...part,
    ...(part.shownKeys !== undefined ? { shownKeys: [...part.shownKeys] } : {}),
    ...(part.filter !== undefined ? { filter: normalizeA05Filter(part.filter) } : {}),
  };
}

function normalizeCalloutKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.filter((key): key is string => typeof key === "string"))].slice(0, 10);
}

function updateCalloutPart(doc: ReportDoc, id: string, update: (part: Extract<TilePart, { type: "callout" }>) => Extract<TilePart, { type: "callout" }>): ReportDoc {
  return updatePage(doc, id, (page) => {
    if (page.kind !== "tile" || page.part.type !== "callout") return page;
    return { ...clonePage(page), part: update(page.part) };
  });
}

function cloneBase(page: ReportPage): ReportPageBase {
  const fontSizes = clampReportFontSizes(page.fontSizes);
  const mapColors = normalizeMapColors(page.mapColors);
  return {
    id: page.id,
    layout: page.layout,
    panels: clonePanels(page.panels),
    textBoxes: page.textBoxes.map((box) => ({ ...box })),
    notes: page.notes,
    deletedElementKeys: [...(page.deletedElementKeys ?? [])],
    ...(page.titleOverride !== undefined ? { titleOverride: page.titleOverride } : {}),
    ...(page.summaryOverride !== undefined ? { summaryOverride: page.summaryOverride } : {}),
    ...(Object.keys(fontSizes).length > 0 ? { fontSizes } : {}),
    ...(mapColors ? { mapColors } : {}),
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
      cells: page.cells.map((cell) => cell ? { tileId: cell.tileId, settings: cloneSettings(cell.settings), frame: cloneFrame(cell.frame), ...(cell.panels ? { panels: clonePanels(cell.panels) } : {}) } : null),
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

function patchMapColors(current: MapColorChoice | undefined, patch: MapColorChoice | null): MapColorChoice | undefined {
  if (patch === null) return undefined;
  const clean = normalizeMapColors(patch);
  return clean ? normalizeMapColors({ ...current, ...clean }) : current;
}

const sameMapColors = (a: MapColorChoice | undefined, b: MapColorChoice | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function setMapColors(doc: ReportDoc, scope: "document" | "page", id: string | undefined, patch: MapColorChoice | null): ReportDoc {
  if (scope === "document") {
    const next = patchMapColors(doc.mapColors, patch);
    if (sameMapColors(next, doc.mapColors)) return doc;
    const { mapColors: _old, ...rest } = doc;
    return next ? { ...rest, mapColors: next } : rest;
  }
  return updatePage(doc, id ?? "", (page) => {
    const next = patchMapColors(page.mapColors, patch);
    if (sameMapColors(next, page.mapColors)) return page;
    const { mapColors: _old, ...rest } = clonePage(page);
    return (next ? { ...rest, mapColors: next } : rest) as ReportPage;
  });
}

function updateFontSizeOverrides(current: ReportFontSizeOverrides | undefined, key: FontSizeKey, value: unknown): ReportFontSizeOverrides {
  const next = clampReportFontSizes(current);
  const normalized = clampReportFontSize(key, value);
  if (normalized !== null) next[key] = normalized;
  return next;
}

function setDocumentFontSize(doc: ReportDoc, key: FontSizeKey, value: unknown): ReportDoc {
  const next = updateFontSizeOverrides(doc.fontSizes, key, value);
  if (doc.fontSizes?.[key] === next[key] && Object.keys(doc.fontSizes ?? {}).length === Object.keys(next).length) return doc;
  return { ...doc, fontSizes: next };
}

function setPageFontSize(doc: ReportDoc, id: string | undefined, key: FontSizeKey, value: unknown): ReportDoc {
  if (!id) return doc;
  return updatePage(doc, id, (page) => {
    const next = updateFontSizeOverrides(page.fontSizes, key, value);
    if (page.fontSizes?.[key] === next[key] && Object.keys(page.fontSizes ?? {}).length === Object.keys(next).length) return page;
    return { ...clonePage(page), fontSizes: next };
  });
}

function clearPageFontSize(doc: ReportDoc, id: string, key: FontSizeKey | undefined): ReportDoc {
  return updatePage(doc, id, (page) => {
    const current = clampReportFontSizes(page.fontSizes);
    if (key === undefined) return Object.keys(current).length > 0 ? { ...clonePage(page), fontSizes: undefined } : page;
    if (current[key] === undefined) return page;
    const next = { ...current };
    delete next[key];
    return { ...clonePage(page), ...(Object.keys(next).length > 0 ? { fontSizes: next } : { fontSizes: undefined }) };
  });
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
    ...(patch.hiddenLabelKeys !== undefined ? { hiddenLabelKeys: [...patch.hiddenLabelKeys] } : {}),
    ...(patch.deletedElementKeys !== undefined ? { deletedElementKeys: [...patch.deletedElementKeys] } : {}),
    ...(patch.labelBoxes !== undefined
      ? { labelBoxes: Object.fromEntries(Object.entries(patch.labelBoxes).map(([key, box]) => [key, normalizeMapLabelBox(box)])) }
      : {}),
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
    const candidate = next.cells[cell];
    if (!candidate) return next;
    next.cells[cell] = { ...candidate, frame: frameWithPatch(candidate.frame, patch, force) };
    return next;
  }
  return page;
}

function updatePageElement(page: ReportPage, key: PageElementKey, deleted: boolean): ReportPage {
  const current = [...(page.deletedElementKeys ?? [])];
  const next = deleted
    ? [...new Set([...current, key])]
    : current.filter((candidate) => candidate !== key);
  if (next.length === current.length && next.every((candidate, index) => candidate === current[index])) return page;
  return { ...clonePage(page), deletedElementKeys: next };
}

function updateCellPanels(page: ReportPage, cell: number, panels: PagePanels): ReportPage {
  if (page.kind !== "compare" || !Number.isInteger(cell) || cell < 0 || cell >= page.cells.length || !page.cells[cell]) return page;
  const next = clonePage(page) as Extract<ReportPage, { kind: "compare" }>;
  const candidate = next.cells[cell];
  if (!candidate) return page;
  const cloned = clonePanelRects(panels);
  next.cells[cell] = cloned ? { ...candidate, panels: cloned } : (() => {
    const { panels: _panels, ...withoutPanels } = candidate;
    return withoutPanels;
  })();
  return next;
}

export function pageElementDeleted(page: ReportPage | undefined, key: PageElementKey): boolean {
  return !!page?.deletedElementKeys?.includes(key);
}

export function restorePageElementPatch(page: Pick<ReportPageBase, "deletedElementKeys">, key: PageElementKey): Pick<ReportPageBase, "deletedElementKeys"> {
  return { deletedElementKeys: (page.deletedElementKeys ?? []).filter((candidate) => candidate !== key) };
}

export function deletePageElementPatch(page: Pick<ReportPageBase, "deletedElementKeys">, key: PageElementKey): Pick<ReportPageBase, "deletedElementKeys"> {
  return { deletedElementKeys: [...new Set([...(page.deletedElementKeys ?? []), key])] };
}

function copyExtent(page: ReportPage, cell: number): ReportPage {
  if (page.kind !== "compare" || !page.cells[cell]) return page;
  const source = page.cells[cell]!.frame;
  const next = clonePage(page) as Extract<ReportPage, { kind: "compare" }>;
  next.cells = next.cells.map((candidate) => candidate ? {
    ...candidate,
    frame: frameWithPatch(candidate.frame, {
      zoomDelta: source.zoomDelta,
      offsetM: source.offsetM,
      scaleDenominator: source.scaleDenominator,
    }, true),
  } : null);
  return next;
}

function removeCompareCell(page: ReportPage, cell: number): ReportPage {
  if (page.kind !== "compare" || !Number.isInteger(cell) || cell < 0 || cell >= page.cells.length || !page.cells[cell]) return page;
  const next = clonePage(page) as Extract<ReportPage, { kind: "compare" }>;
  next.cells[cell] = null;
  return next;
}

function resetPanels(page: ReportPage): ReportPage {
  const next = clonePage(page);
  next.panels = {};
  return next;
}

function isCalloutPageFor(page: ReportPage | undefined, tileId: string): page is Extract<ReportPage, { kind: "tile" }> {
  return page?.kind === "tile" && page.tileId === tileId && page.part.type === "callout";
}

function calloutPartOf(page: ReportPage | undefined): Extract<TilePart, { type: "callout" }> | null {
  return page?.kind === "tile" && page.part.type === "callout" ? page.part : null;
}

function preserveCalloutPageEdits(next: ReportPage, previous: Extract<ReportPage, { kind: "tile" }>): ReportPage {
  if (next.kind !== "tile") return next;
  const clonedPrevious = clonePage(previous) as Extract<ReportPage, { kind: "tile" }>;
  return {
    ...next,
    layout: clonedPrevious.layout,
    panels: clonedPrevious.panels,
    textBoxes: clonedPrevious.textBoxes,
    notes: clonedPrevious.notes,
    deletedElementKeys: clonedPrevious.deletedElementKeys,
    ...(clonedPrevious.titleOverride !== undefined ? { titleOverride: clonedPrevious.titleOverride } : {}),
    ...(clonedPrevious.summaryOverride !== undefined ? { summaryOverride: clonedPrevious.summaryOverride } : {}),
    ...(clonedPrevious.fontSizes !== undefined ? { fontSizes: clonedPrevious.fontSizes } : {}),
    ...(clonedPrevious.mapColors !== undefined ? { mapColors: clonedPrevious.mapColors } : {}),
    frame: clonedPrevious.frame,
  };
}

/** 설명선 장수 변경 시 같은 번호 장의 사용자 편집을 새 계획에 옮긴다. */
export function replaceTileCalloutPages(doc: ReportDoc, anchorId: string, replacementPages: ReportPage[]): ReportDoc {
  const anchorIndex = doc.pages.findIndex((page) => page.id === anchorId);
  const anchor = doc.pages[anchorIndex];
  if (!anchor || anchor.kind !== "tile" || anchor.part.type !== "callout") return doc;
  const tileId = anchor.tileId;
  if (replacementPages.length === 0 || replacementPages.some((page) => !isCalloutPageFor(page, tileId))) return doc;

  const replacesOverview = replacementPages.some((page) => page.kind === "tile" && page.part.type === "callout" && page.part.page === 0);
  let start = anchorIndex;
  while (start > 0 && isCalloutPageFor(doc.pages[start - 1], tileId)) {
    const previousPart = calloutPartOf(doc.pages[start - 1]);
    if (!replacesOverview && previousPart?.page === 0) break;
    start -= 1;
  }
  let end = anchorIndex + 1;
  while (end < doc.pages.length && isCalloutPageFor(doc.pages[end], tileId)) end += 1;
  const previousByPage = new Map<number, Extract<ReportPage, { kind: "tile" }>>();
  for (const page of doc.pages.slice(start, end)) {
    const part = calloutPartOf(page);
    if (part && isCalloutPageFor(page, tileId)) previousByPage.set(part.page, page);
  }
  const nextPages = replacementPages.map((page) => {
    const part = calloutPartOf(page);
    const previous = part ? previousByPage.get(part.page) : undefined;
    return previous ? preserveCalloutPageEdits(clonePage(page), previous) : clonePage(page);
  });
  return { ...doc, pages: [...doc.pages.slice(0, start), ...nextPages, ...doc.pages.slice(end)] };
}

export function reportDocReducer(doc: ReportDoc, action: ReportDocAction): ReportDoc {
  if (doc.fontScale !== undefined) {
    const { fontScale: _legacyFontScale, ...legacyFreeDoc } = doc;
    const legacyFontSizes = reportFontSizesFromLegacyScale(doc.fontScale);
    doc = legacyFontSizes
      ? { ...legacyFreeDoc, fontSizes: { ...legacyFontSizes, ...(doc.fontSizes ?? {}) } }
      : legacyFreeDoc;
  }
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
    case "layout": {
      const layout = action.layout === "side-by-side" ? "map-summary" : action.layout;
      return updatePage(doc, action.id, (page) => ({ ...resetPanels(page), layout }));
    }
    case "grid":
      return updatePage(doc, action.id, (page) => page.kind === "compare" && page.grid !== action.grid ? { ...clonePage(page), grid: action.grid } : page);
    case "frame":
      return updatePage(doc, action.id, (page) => updateFrame(page, action.cell, action.patch, action.force));
    case "copyExtent":
      return updatePage(doc, action.id, (page) => copyExtent(page, action.cell));
    case "removeCell":
      return updatePage(doc, action.id, (page) => removeCompareCell(page, action.cell));
    case "sameExtent":
      return updatePage(doc, action.id, (page) => page.kind === "compare" ? { ...page, sameExtent: action.value } : page);
    case "pageElement":
      return updatePage(doc, action.id, (page) => updatePageElement(page, action.key, action.deleted));
    case "panels":
      return updatePage(doc, action.id, (page) => ({ ...clonePage(page), panels: clonePanels(action.panels) }));
    case "cellPanels":
      return updatePage(doc, action.id, (page) => updateCellPanels(page, action.cell, action.panels));
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
    case "fontSizes":
      return action.scope === "document"
        ? setDocumentFontSize(doc, action.key, action.value)
        : setPageFontSize(doc, action.id, action.key, action.value);
    case "clearPageFontSizes":
      return clearPageFontSize(doc, action.id, action.key);
    case "resetFontSizes": {
      const pages = doc.pages.map((page) => page.fontSizes && Object.keys(page.fontSizes).length > 0
        ? { ...clonePage(page), fontSizes: undefined }
        : page);
      const hasPageOverrides = pages.some((page, index) => page !== doc.pages[index]);
      if (!doc.fontSizes && !hasPageOverrides) return doc;
      return { ...doc, fontSizes: undefined, pages };
    }
    case "theme":
      return { ...doc, fontSizes: reportFontSizesFromLegacyScale(action.fontScale) };
    case "mapColors":
      return setMapColors(doc, action.scope, action.id, action.patch);
    case "tileCallout":
      return replaceTileCalloutPages(doc, action.id, action.pages);
    case "calloutShown":
      return updateCalloutPart(doc, action.id, (part) => ({ ...part, shownKeys: normalizeCalloutKeys(action.keys) }));
    case "calloutFilter":
      return updateCalloutPart(doc, action.id, (part) => ({
        ...part,
        filter: normalizeA05Filter(action.filter),
        ...(action.keys !== undefined ? { shownKeys: normalizeCalloutKeys(action.keys) } : {}),
      }));
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

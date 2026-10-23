/** 독립 보고서 문서를 기존 PPT 슬라이드 계획으로 바꾸는 순수 어댑터. */
import { defaultFrame, DEFAULT_REPORT_FONT_SIZES, mergeReportFontSizes, newPageId, reportFontSizesFromLegacyScale, type MapFrameState, type ReportDoc, type ReportPage, type ReportFormat, type TilePart } from "./report-doc";
import {
  buildReportPlan,
  complexCounts,
  REPORT_SOURCE_ROWS_PER_SLIDE,
  sourcePageCount,
  tileReportSettingsFromBoard,
  tileSlides,
  type PlannedSlide,
  type ReportSlide,
  type ReportSourceRow,
  type TileReportSettings,
} from "./report-plan";
import { defaultCutForCode, isCutSpec, type BoardState, type PageKey, type PageStyle } from "../ui/board-state";
import { CUT_CODES } from "../tile/client";
import type { MapModel } from "../ui/map-layers";
import { catalogEntry, TILE_CODES } from "../ui/tile-catalog";
import type { SourceDetailRow, SourceMeta } from "../ui/source-details";
import { sourceDetailsFor, UNKNOWN_AS_OF } from "../ui/source-details";
import type { SummaryView, TileView } from "../ui/tile-view";
import { sheetView } from "../ui/sheet";

export type ReportDocPlanContext = {
  summary: SummaryView;
  analysisDate?: string;
  sourceMeta?: ReadonlyMap<string, SourceMeta>;
  /** pagesForTile 호출자가 이미 계산한 장수 컨텍스트를 재사용할 수 있다. */
  complexCounts?: Record<string, number>;
  views?: ReadonlyMap<string, TileView>;
  sourceLineFor?: (view: TileView) => string;
  settingsFor?: (tileId: string) => TileReportSettings;
};

const hasResult = (view: TileView): boolean => view.status === "complete" || view.status === "partial";

function parseSources(line: string): [string, string][] {
  if (line === "출처 없음") return [];
  return line.split(" · ").map((part) => {
    const match = /^(.*) (\d{4}(?:-\d{2}(?:-\d{2})?)?|기준일 미확인)$/.exec(part);
    return (match ? [match[1], match[2]] : [part, ""]) as [string, string];
  });
}

function fallbackSourceRows(view: TileView): SourceDetailRow[] {
  return parseSources(view.sourceLine).map(([source, asOf]) => ({
    sourceId: source,
    provider: "",
    name: source,
    role: "주 원천" as const,
    asOf: asOf || UNKNOWN_AS_OF,
    license: "미기록",
    url: "",
    usedFor: null,
  }));
}

function sourceRowsFor(view: TileView, sourceMeta: ReadonlyMap<string, SourceMeta>): SourceDetailRow[] | null {
  if (view.sourceRefs.length === 0) return null;
  const details = sourceDetailsFor({ code: view.code, tileType: view.tileType, provenance: { sources: view.sourceRefs } }, sourceMeta);
  if (details.rows.length === 0) return null;
  const legacyAsOf = new Map(parseSources(view.sourceLine).map(([name, asOf]) => [name, asOf]));
  return details.rows.map((row) => row.asOf === UNKNOWN_AS_OF && legacyAsOf.has(row.name)
    ? { ...row, asOf: legacyAsOf.get(row.name)! }
    : row);
}

function sourceLineFor(view: TileView, sourceMeta: ReadonlyMap<string, SourceMeta>): string {
  const rows = sourceRowsFor(view, sourceMeta);
  if (!rows || rows.length === 0) return view.sourceLine;
  return rows.map((row) => `${row.provider} · ${row.name} · ${row.asOf}`).join(" · ");
}

function sourceFooterFor(view: TileView, sourceMeta: ReadonlyMap<string, SourceMeta>): string {
  const line = sourceLineFor(view, sourceMeta);
  return line === "출처 없음" ? "출처 없음 · 기준일 해당 없음" : `출처 ${line}`;
}

function planContext(ctx: ReportDocPlanContext, views?: ReadonlyMap<string, TileView>, settingsFor?: (tileId: string) => TileReportSettings) {
  const viewMap = views ?? ctx.views;
  return {
    summary: ctx.summary,
    complexCounts: ctx.complexCounts ?? (viewMap ? complexCounts(new Map(viewMap)) : {}),
    ...(viewMap ? { views: viewMap } : {}),
    sourceLineFor: ctx.sourceLineFor ?? ((view: TileView) => sourceLineFor(view, ctx.sourceMeta ?? new Map<string, SourceMeta>())),
    ...(settingsFor ?? ctx.settingsFor ? { settingsFor: settingsFor ?? ctx.settingsFor } : {}),
  };
}

function cloneSettings(settings: TileReportSettings): TileReportSettings {
  const filter = settings.a05Filter;
  return {
    ...settings,
    ...(settings.cut ? { cut: { ...settings.cut } } : {}),
    ...(settings.camera ? { camera: { ...settings.camera } } : {}),
    ...(filter ? {
      a05Filter: {
        ...filter,
        ...(filter.types ? { types: [...filter.types] } : {}),
        ...Object.fromEntries((['year', 'households', 'floors', 'buildings', 'distance'] as const)
          .filter((key) => filter[key])
          .map((key) => [key, { ...filter[key] }])),
      },
    } : {}),
    ...(settings.labels ? { labels: settings.labels.map((label) => ({ ...label })) } : {}),
  };
}

function mapFrameForSlide(slide: ReportSlide): MapFrameState {
  const frame = defaultFrame();
  if (slide.kind === "tile") frame.pinnedKeys = [...(slide.pinnedKeys ?? [])];
  if (slide.kind === "sheet") {
    frame.pinnedKeys = [...new Set(slide.cells.flatMap((cell) => cell?.pinnedKeys ?? []))];
  }
  return frame;
}

function pageLayoutForSlide(slide: ReportSlide): ReportPage["layout"] {
  const hasMap = slide.kind === "tile"
    ? !!slide.map
    : slide.kind === "sheet"
      ? slide.cells.some((cell) => !!cell?.view.map)
      : slide.kind === "cover" || slide.kind === "sources"
        ? !!slide.map
        : false;
  return hasMap ? "map-summary" : "numbers-first";
}

function partForSlide(view: TileView, settings: TileReportSettings, slide: ReportSlide, sheetIndex: number): TilePart {
  if (slide.kind === "sheet") return { type: "cutSheet", index: sheetIndex };
  if (slide.kind !== "tile") return { type: "single" };
  if (slide.callout) return { type: "callout", page: slide.callout.page };
  const selectedCut = isCutSpec(settings.cut) && settings.cut.tile === view.code
    ? settings.cut
    : defaultCutForCode(view.code);
  if (selectedCut && CUT_CODES.has(view.code) && hasResult(view) && slide.body.face === "single") return { type: "cutSingle" };
  if (slide.body.face === "front" || slide.body.face === "back") return { type: "face", face: slide.body.face };
  return { type: "single" };
}

function pageForTileSlide(id: string, view: TileView, settings: TileReportSettings, slide: ReportSlide, sheetIndex: number): Extract<ReportPage, { kind: "tile" }> {
  return {
    id,
    layout: pageLayoutForSlide(slide),
    panels: {},
    textBoxes: [],
    notes: "",
    kind: "tile",
    tileId: view.tileId,
    part: partForSlide(view, settings, slide, sheetIndex),
    settings: cloneSettings(settings),
    frame: mapFrameForSlide(slide),
  };
}

function newSimplePage(doc: ReportDoc, kind: "cover" | "sources"): ReportPage {
  return { id: newPageId(doc), layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind };
}

function isTileResultView(view: TileView): boolean {
  return hasResult(view) && view.tileId !== "";
}

/** 타일 하나를 페이지 목록으로 펼친다. 페이지 설정은 보드에서 이 시점에 복사한다. */
export function pagesForTile(
  doc: ReportDoc,
  tileId: string,
  view: TileView,
  settings: TileReportSettings,
  ctx: ReportDocPlanContext,
): ReportPage[] {
  const slides = tileSlides(tileId, view, settings, planContext(ctx, ctx.views, ctx.settingsFor));
  const pages: ReportPage[] = [];
  let sheetIndex = 0;
  let working = doc;
  for (const slide of slides) {
    const page = pageForTileSlide(newPageId(working), view, settings, slide, slide.kind === "sheet" ? sheetIndex++ : 0);
    pages.push(page);
    working = { ...working, pages: [...working.pages, page] };
  }
  return pages;
}

/** 결과가 있는 원본 타일을 카탈로그 순서로 시작하는 기본 보고서 구성. */
export function recommendedPages(
  doc: ReportDoc,
  views: ReadonlyMap<string, TileView>,
  board: BoardState,
  ctx: ReportDocPlanContext,
): ReportPage[] {
  const pages: ReportPage[] = [];
  let working = doc;
  const resultIds = new Set(board.results.map((result) => result.tileId));
  const ordered = [...views.values()]
    .filter((view) => resultIds.has(view.tileId) && isTileResultView(view))
    .sort((a, b) => (TILE_CODES.indexOf(a.code as (typeof TILE_CODES)[number]) - TILE_CODES.indexOf(b.code as (typeof TILE_CODES)[number])) || a.tileId.localeCompare(b.tileId));
  const cover = newSimplePage(working, "cover");
  pages.push(cover);
  working = { ...working, pages: [...working.pages, cover] };
  for (const view of ordered) {
    const tilePages = pagesForTile(working, view.tileId, view, tileReportSettingsFromBoard(board, view.tileId), { ...ctx, views });
    pages.push(...tilePages);
    working = { ...working, pages: [...working.pages, ...tilePages] };
  }
  const sources = newSimplePage(working, "sources");
  pages.push(sources);
  return pages;
}

export function hasLegacyReport(board: BoardState): boolean {
  if (board.report.extra.length > 0 || Object.keys(board.report.styles).length > 0) return true;
  const defaults = new Map(board.results.map((result) => [result.tileId, result.status === "complete" || result.status === "partial"]));
  const ids = new Set([...defaults.keys(), ...Object.keys(board.included)]);
  return [...ids].some((id) => (board.included[id] ?? false) !== (defaults.get(id) ?? false));
}

function frameFromLegacyStyle(style: PageStyle | undefined, initial: MapFrameState): MapFrameState {
  if (!style) return initial;
  return {
    ...initial,
    ...(style.zoomDelta !== undefined ? { zoomDelta: style.zoomDelta } : {}),
    ...(style.offsetM !== undefined ? { offsetM: [...style.offsetM] as [number, number] } : {}),
    ...(style.pinnedKeys !== undefined ? { pinnedKeys: [...style.pinnedKeys] } : {}),
    legend: { ...initial.legend, ...(style.hiddenKeys !== undefined ? { hidden: [...style.hiddenKeys] } : {}) },
  };
}

function comparePageFromLegacy(id: string, extra: BoardState["report"]["extra"][number], board: BoardState): Extract<ReportPage, { kind: "compare" }> | null {
  if (!extra.sheet) return null;
  return {
    id,
    layout: "side-by-side",
    panels: {},
    textBoxes: [],
    notes: "",
    kind: "compare",
    grid: extra.sheet.grid,
    sameExtent: false,
    cells: extra.sheet.tiles.filter(Boolean).map((tileId) => ({ tileId, settings: cloneSettings(tileReportSettingsFromBoard(board, tileId)), frame: defaultFrame() })),
  };
}

/** v1/v2 보드의 buildReportPlan 결과를 독립 문서 페이지로 옮긴다. */
export function importLegacyReport(
  doc: ReportDoc,
  board: BoardState,
  views: ReadonlyMap<string, TileView>,
  ctx: ReportDocPlanContext,
): ReportPage[] {
  const oldPlan = buildReportPlan({ summary: ctx.summary, views: new Map(views), board, analysisDate: ctx.analysisDate, sourceMeta: ctx.sourceMeta });
  const pages: ReportPage[] = [];
  const used = new Set<string>(doc.pages.map((page) => page.id));
  let sourceAdded = false;
  let sheetIndex = 0;
  for (const slide of oldPlan) {
    if (slide.kind === "sources") {
      if (sourceAdded) continue;
      sourceAdded = true;
    }
    const extra = slide.key.startsWith("extra:")
      ? board.report.extra.find((candidate) => `extra:${candidate.id}` === slide.key)
      : undefined;
    const compare = extra ? comparePageFromLegacy(slide.key, extra, board) : null;
    if (compare) {
      const style = board.report.styles[slide.key];
      pages.push({ ...compare, panels: style?.panels ? { ...style.panels } : {}, cells: compare.cells.map((cell) => ({ ...cell, frame: frameFromLegacyStyle(style, cell.frame) })) });
      used.add(compare.id);
      continue;
    }
    const id = used.has(slide.key) ? newPageId({ ...doc, pages: [...doc.pages, ...pages] }) : slide.key;
    used.add(id);
    if (slide.kind === "cover" || slide.kind === "sources") {
      pages.push({ id, layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: slide.kind });
      continue;
    }
    const view = slide.view;
    const settings = tileReportSettingsFromBoard(board, view.tileId);
    const page = pageForTileSlide(id, view, settings, slide, slide.kind === "sheet" ? sheetIndex++ : 0);
    const style = board.report.styles[slide.key];
    page.panels = style?.panels ? { ...style.panels } : {};
    page.frame = frameFromLegacyStyle(style, page.frame);
    pages.push(page);
  }
  return pages;
}

function tileCodeFromId(tileId: string): string {
  return /(?:^|-)([ADS]\d{2})$/.exec(tileId)?.[1] ?? tileId;
}

function emptyMap(summary: SummaryView): MapModel {
  if (summary.map) return { ...summary.map, features: [], polygons: [], lines: [], total: 0, notes: [...summary.map.notes] };
  return { center: [0, 0], radiusM: 0, features: [], total: 0, notes: [] };
}

function missingView(tileId: string, summary: SummaryView): TileView {
  const code = tileCodeFromId(tileId);
  const entry = catalogEntry(code);
  const backdrop = emptyMap(summary);
  return {
    tileId,
    code,
    tileType: entry.kind,
    title: entry.title,
    color: entry.color,
    status: "no_data",
    badges: [{ text: "결과 없음", tone: "status" }],
    headline: null,
    headlineMetricId: null,
    rows: [],
    sentence: "결과 없음",
    grade: null,
    grades: [],
    caveats: [],
    notes: [],
    sourceLine: "출처 없음",
    sourceRefs: [],
    chart: null,
    hasFace: entry.kind === "diagram",
    retryable: false,
    map: null,
    backdrop,
    kindLabel: entry.kind === "analysis" ? "분석" : entry.kind === "diagram" ? "도판" : "시뮬레이션",
    filterChip: null,
    filterLine: null,
    a05Counts: null,
    callout: null,
    mass: null,
    rose: null,
    roses: null,
    stackLayers: null,
    sheetTiles: null,
    sheetGrid: null,
    layerOptions: [],
    defaultLayer: "",
  };
}

function pageStyleFor(doc: ReportDoc, page: ReportPage): PageStyle {
  const legacyFontSizes = reportFontSizesFromLegacyScale(doc.fontScale);
  const documentFontSizes = { ...(legacyFontSizes ?? {}), ...(doc.fontSizes ?? {}) };
  const fontSizes = mergeReportFontSizes(documentFontSizes, page.fontSizes);
  const scaleFor = (key: keyof typeof DEFAULT_REPORT_FONT_SIZES) => Math.max(0.7, Math.min(1.5, fontSizes[key] / DEFAULT_REPORT_FONT_SIZES[key]));
  const base: PageStyle = {
    fontSizes,
    titleScale: scaleFor("title"),
    summaryScale: scaleFor("summary"),
    legendScale: scaleFor("legend"),
  };
  if (page.kind !== "tile") return page.panels ? { ...base, panels: { ...page.panels } } : base;
  const frame = page.frame;
  return {
    ...base,
    summary: page.layout !== "map-full",
    zoomDelta: frame.zoomDelta,
    offsetM: [...frame.offsetM] as [number, number],
    pinnedKeys: [...frame.pinnedKeys],
    ...(frame.legend.hidden.length > 0 ? { hiddenKeys: [...frame.legend.hidden] } : {}),
    ...(Object.keys(page.panels).length > 0 ? { panels: { ...page.panels } } : {}),
  };
}

function slideForPart(page: Extract<ReportPage, { kind: "tile" }>, slides: ReportSlide[]): ReportSlide | null {
  const part = page.part;
  if (part.type === "callout") return slides.find((slide) => slide.kind === "tile" && slide.callout?.page === part.page) ?? null;
  if (part.type === "cutSheet") return slides.filter((slide) => slide.kind === "sheet")[part.index] ?? null;
  if (part.type === "cutSingle") return slides.find((slide) => slide.kind === "tile" && slide.body.face === "single") ?? null;
  if (part.type === "face") return slides.find((slide) => slide.kind === "tile" && slide.body.face === part.face) ?? null;
  return slides.find((slide) => slide.kind === "tile" && slide.body.face === "single")
    ?? slides.find((slide) => slide.kind === "tile")
    ?? slides[0]
    ?? null;
}

function missingSlide(page: Extract<ReportPage, { kind: "tile" }>, summary: SummaryView): ReportSlide {
  const view = missingView(page.tileId, summary);
  const face = page.part.type === "face" ? page.part.face : "single";
  return {
    kind: "tile",
    view,
    body: { kind: "state", face, message: "결과 없음 — 이 페이지의 분석 결과를 다시 확인하세요" },
    faceLabel: view.hasFace && face !== "single" ? (face === "front" ? "도판" : "구성비") : null,
    map: view.backdrop,
    muted: true,
    missing: true,
  };
}

function markMissing(slide: ReportSlide): ReportSlide {
  if (slide.kind !== "tile" || slide.body.kind !== "state") return slide;
  return { ...slide, missing: true, body: { ...slide.body, message: slide.body.message.includes("결과 없음") ? slide.body.message : `${slide.body.message} · 결과 없음` } };
}

function sourceRowsForViews(views: Iterable<TileView>, sourceMeta: ReadonlyMap<string, SourceMeta>): ReportSourceRow[] {
  type Accum = Omit<ReportSourceRow, "tiles"> & { tiles: string[] };
  const bySource = new Map<string, Accum>();
  for (const view of views) {
    const rows = sourceRowsFor(view, sourceMeta) ?? fallbackSourceRows(view);
    for (const row of rows) {
      const key = `${row.provider}|${row.name}|${row.asOf}`;
      const current = bySource.get(key) ?? { source: row.name, asOf: row.asOf, tiles: [], provider: row.provider, license: row.license, url: row.url };
      if (!current.tiles.includes(view.title)) current.tiles.push(view.title);
      if ((!current.provider || current.provider === "제공처 미기록") && row.provider) current.provider = row.provider;
      if ((!current.license || current.license === "미기록") && row.license) current.license = row.license;
      if (!current.url && row.url) current.url = row.url;
      bySource.set(key, current);
    }
  }
  return [...bySource.values()].map((row) => ({ ...row, tiles: row.tiles.join(", ") }));
}

function referencedViews(doc: ReportDoc, views: ReadonlyMap<string, TileView>): TileView[] {
  const ids = new Set<string>();
  for (const page of doc.pages) {
    if (page.kind === "tile") ids.add(page.tileId);
    if (page.kind === "compare") for (const cell of page.cells) ids.add(cell.tileId);
  }
  return [...ids].flatMap((id) => {
    const view = views.get(id);
    return view ? [view] : [];
  });
}

function plannedWithMeta(slide: ReportSlide, page: ReportPage, key: PageKey, footer: string, style: PageStyle, format: ReportFormat): PlannedSlide {
  return { ...slide, no: 0, total: 0, footer, key, style, page, format, notes: page.notes };
}

/** 독립 보고서 문서를 PPT 렌더러가 소비하는 슬라이드로 계획한다. */
export function planReportDoc(doc: ReportDoc, views: ReadonlyMap<string, TileView>, ctx: ReportDocPlanContext): PlannedSlide[] {
  const sourceMeta = ctx.sourceMeta ?? new Map<string, SourceMeta>();
  const viewContext = planContext({ ...ctx, views }, views);
  const sourceViews = referencedViews(doc, views);
  const sourceRows = sourceRowsForViews(sourceViews, sourceMeta);
  const sourcePages = sourcePageCount(sourceRows.length);
  const date = ctx.analysisDate ?? "미확인";
  const raw: PlannedSlide[] = [];
  for (const page of doc.pages) {
    if (page.kind === "cover") {
      raw.push(plannedWithMeta({
        kind: "cover",
        address: ctx.summary.address,
        metrics: [
          { label: "대지 면적", value: ctx.summary.area },
          { label: "용도지역", value: ctx.summary.zoning },
          { label: "분석 반경", value: ctx.summary.radius.replace(/^반경 /, "") },
          { label: "분석일", value: date },
        ],
        asOfLine: ctx.summary.asOfLine,
        incomplete: ctx.summary.incomplete ? `지역 자료 불완전 · ${ctx.summary.incompleteCount}개 타일` : null,
        lines: sourceViews.map((view) => ({ title: view.title, color: view.color, text: view.headline ? `${view.headline.label} ${view.headline.value}` : "결과 없음" })),
        map: ctx.summary.map,
      }, page, page.id, `${ctx.summary.asOfLine} · 출처와 기준일은 마지막 장 참조`, pageStyleFor(doc, page), doc.format));
      continue;
    }
    if (page.kind === "sources") {
      for (let index = 0; index < sourcePages; index += 1) {
        raw.push(plannedWithMeta({
          kind: "sources",
          rows: sourceRows.slice(index * REPORT_SOURCE_ROWS_PER_SLIDE, (index + 1) * REPORT_SOURCE_ROWS_PER_SLIDE),
          analysisDate: date,
          map: ctx.summary.map,
        }, page, `${page.id}:${index}`, `${ctx.summary.asOfLine} · 출처 ${sourceRows.length}건${sourcePages > 1 ? ` · 출처 ${index + 1}/${sourcePages}` : ""}`, pageStyleFor(doc, page), doc.format));
      }
      continue;
    }
    if (page.kind === "blank") {
      raw.push(plannedWithMeta({ kind: "cover", address: "", metrics: [], asOfLine: "", incomplete: null, lines: [], map: null }, page, page.id, "빈 페이지", pageStyleFor(doc, page), doc.format));
      continue;
    }
    if (page.kind === "tile") {
      const view = views.get(page.tileId);
      const slide = view
        ? slideForPart(page, tileSlides(page.tileId, view, page.settings, viewContext))
        : null;
      const selected = markMissing(slide ?? missingSlide(page, ctx.summary));
      const footerView = view ?? missingView(page.tileId, ctx.summary);
      const footer = selected.kind === "tile" && selected.callout?.filterLine
        ? `${selected.callout.filterLine} · ${sourceFooterFor(footerView, sourceMeta)}`
        : sourceFooterFor(footerView, sourceMeta);
      raw.push(plannedWithMeta(selected, page, page.id, footer, pageStyleFor(doc, page), doc.format));
      continue;
    }
    if (page.kind === "compare") {
      const style = pageStyleFor(doc, page);
      const cells = page.cells.map((cell, index) => {
        const view = views.get(cell.tileId);
        if (!view) return null;
        return {
          view,
          face: cell.settings.face === "back" ? "back" as const : "front" as const,
          mapKey: `${page.id}:cell:${index}`,
          sourceLine: sourceLineFor(view, sourceMeta),
          pinnedKeys: [...cell.frame.pinnedKeys],
          style,
          reportFrame: cell.frame,
        };
      });
      const cellViews = cells.flatMap((cell) => cell ? [cell.view] : []);
      raw.push(plannedWithMeta({ kind: "sheet", view: sheetView(page.id, cellViews, page.grid), grid: page.grid, cells }, page, page.id, `${ctx.summary.asOfLine} · 비교`, style, doc.format));
    }
  }
  return raw.map((slide, index) => ({ ...slide, no: index + 1, total: raw.length }));
}

export function printedPageCount(doc: ReportDoc, views: ReadonlyMap<string, TileView>, ctx: ReportDocPlanContext): number {
  return planReportDoc(doc, views, ctx).length;
}

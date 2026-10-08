/**
 * 보드 → 보고서 슬라이드 계획. 순수 함수 (pptx 라이브러리 의존 없음).
 * 슬라이드 수는 board-state의 reportPages(board).pages(표지+타일+출처 장)와 항상 같다.
 */
import { defaultCutForCode, isCutSpec, type BoardState, type CutSpec, type Season } from "../ui/board-state";
import { calloutReportPages, DEFAULT_CALLOUT_MODE, pageCount } from "../ui/callout-layout";
import type { MapModel } from "../ui/map-layers";
import { viewWithOnlyRaster, type CalloutModel, type SummaryView, type TileView } from "../ui/tile-view";
import type { MassModel } from "../ui/mass-projection";
import type { SheetGrid } from "../ui/sheet";
import { FACE_TEXT } from "../ui/tile-view";
import type { RoseModel } from "../ui/wind-rose";
import type { RoseSeason } from "../tile-result";
import { exportFileName } from "../export/download";
import { sourceDetailsFor, UNKNOWN_AS_OF, type SourceDetailRow, type SourceMeta } from "../ui/source-details";
import { CUT_DATE_LABEL, CUT_SEASONS, CUT_SEASON_LABEL, cutNote, cutReady, viewForCut } from "../ui/cut-selection";

export type TileSlideBody =
  | { kind: "result"; face: "single" | "front" | "back" }
  | { kind: "state"; face: "single" | "front" | "back"; message: string };

/** 출처 슬라이드 행. 메타가 연결되면 이용조건·원문 확인 열을 채울 수 있다. */
export type ReportSourceRow = {
  source: string;
  asOf: string;
  tiles: string;
  provider?: string | null;
  license?: string | null;
  url?: string | null;
};

export type ReportSlide =
  | {
      kind: "cover";
      address: string;
      metrics: { label: string; value: string }[];
      asOfLine: string;
      incomplete: string | null;
      lines: { title: string; color: string; text: string }[];
      /** 대지·반경 지도 (그림은 렌더 단계에서 mapKey로 받는다) */
      map: MapModel | null;
    }
  | {
      kind: "tile";
      view: TileView;
      body: TileSlideBody;
      faceLabel: string | null;
      /** 슬라이드 전면 지도. D04 구성비 면만 null (전면 차트). 상태 슬라이드는 흐린 대지 지도 */
      map: MapModel | null;
      /** true면 지도를 흐리게 (상태 화면) */
      muted: boolean;
      /** S01 축측 매스 이미지. PPT에는 3D 파일 자체를 넣지 않는다. */
      mass?: MassModel;
      /** D22 바람장미 이미지. PPT에는 SVG를 PNG로 바꿔 전면에 넣는다. */
      rose?: RoseModel;
      /** D22 화면에서 고른 계절. 저장값이 없으면 연간이다. */
      roseSeason?: RoseSeason;
      /** 주변 단지 설명선 장: page 0 = 개요, 1.. = 설명표 (지도 이미지는 단지 없이, 점·지시선·표는 pptx 도형) */
      callout?: { model: CalloutModel; page: number; pages: number; filterLine?: string | null };
      /** 보드에서 켜 둔 지도 요소 라벨만 보고서 이미지에 그린다. */
      pinnedKeys?: string[];
    }
  | {
      kind: "sheet";
      view: TileView;
      grid: SheetGrid;
      cells: Array<{
        view: TileView;
        face: "front" | "back";
        mapKey: string;
        sourceLine?: string;
        pinnedKeys?: string[];
        mass?: MassModel;
        rose?: RoseModel;
        roseSeason?: RoseSeason;
      }>;
    }
  | { kind: "sources"; rows: ReportSourceRow[]; analysisDate: string; /** 배경(흐린 대지 지도) */ map: MapModel | null };

export type PlannedSlide = ReportSlide & { no: number; total: number; footer: string };

/** 지도 이미지 키: 표지는 "cover", 타일 장은 tileId */
export const COVER_MAP_KEY = "cover";
export const mapKeysOf = (p: PlannedSlide): string[] => {
  if (p.kind === "sheet") return p.cells.map((cell) => cell.mapKey);
  if (p.kind === "tile") {
    if (p.mass) return [`${p.view.tileId}:mass`];
    if (p.rose) return [`${p.view.tileId}:rose`];
    return p.map ? [p.callout && p.callout.page > 0 ? `${p.view.tileId}:cp` : p.view.tileId] : [];
  }
  return p.map ? [COVER_MAP_KEY] : [];
};
export const mapKeyOf = (p: PlannedSlide): string | null => mapKeysOf(p)[0] ?? null;

const STATE_MESSAGE: Record<string, string> = {
  failed: "계산 실패 — 보고서에는 결과 없이 표시합니다",
  no_data: "자료 없음 — 이 조건에서는 표시할 결과가 없습니다",
  not_provided: "이 단계에서는 제공하지 않습니다 — 다음 단계에서 제공 예정",
  cancelled: "취소됨 — 보고서에는 결과 없이 표시합니다",
};

/** 설명선 타일의 단지 수 (board-state.reportPages에 넘겨 장수를 계획과 맞춘다) */
export const complexCounts = (views: Map<string, TileView>): Record<string, number> =>
  Object.fromEntries([...views].filter(([, v]) => v.callout).map(([id, v]) => [id, v.callout!.complexes.length]));

/** 한 출처 장에 담을 수 있는 원천 행 수. 긴 사용 타일 셀도 PPT 출처 띠를 침범하지 않게 한다. */
export const REPORT_SOURCE_ROWS_PER_SLIDE = 14;
export const sourcePageCount = (sourceRows: number): number => Math.max(1, Math.ceil(Math.max(0, sourceRows) / REPORT_SOURCE_ROWS_PER_SLIDE));

const hasResult = (v: TileView) => v.status === "complete" || v.status === "partial";
const pinnedKeysFor = (board: BoardState, tileId: string): string[] => (board.labels[tileId] ?? []).filter((label) => label.on).map((label) => label.key);

const CUT_CODES = new Set(["S01", "S02", "S03", "S04", "D22"]);
const RASTER_NAMES = (view: TileView): string[] => {
  const map = view.map as (NonNullable<TileView["map"]> & { rasterOptions?: { name: string }[] }) | null;
  return (map?.rasterOptions ?? map?.rasters ?? []).map((ref) => ref.name);
};

const hoursFor = (view: TileView, date: string): string[] => RASTER_NAMES(view)
  .filter((name) => name.startsWith(`shade_${date}_h`))
  .sort((a, b) => Number(a.slice(-2)) - Number(b.slice(-2)));

const legacyShadowHours = (view: TileView): string[] => ["09", "12", "15"].filter((hour) =>
  (view.map?.polygons ?? []).some((polygon) => polygon.layer === `shadow_${hour}`),
).map((hour) => `shadow_${hour}`);

type CutCell = {
  view: TileView;
  mapKey: string;
  rasterName?: string;
  rose?: RoseModel;
  roseSeason?: RoseSeason;
};

type CutPlan = {
  sheets: Array<{ grid: SheetGrid; cells: CutCell[] }>;
  single?: CutCell & { mass?: MassModel };
};

function rasterCell(view: TileView, name: string, note: string, key: string): CutCell {
  const next = name.startsWith("shadow_") ? viewWithOnlyLayer(view, name, note) : viewWithOnlyRaster(view, name, note);
  return { view: next, mapKey: `${view.tileId}:${key}`, rasterName: name };
}

function roseCell(view: TileView, season: RoseSeason, key: string): CutCell {
  const model = season === "annual" ? view.rose : view.roses?.[season];
  const next = model
    ? { ...view, rose: model, notes: [CUT_SEASON_LABEL[season], ...view.notes.filter((note) => note !== CUT_SEASON_LABEL[season])] }
    : view;
  return { view: next, mapKey: `${view.tileId}:rose-${season}`, rose: model ?? undefined, roseSeason: season };
}

function cutPlanFor(view: TileView, cut: CutSpec): CutPlan {
  switch (cut.tile) {
    case "S01": {
      const mass = view.mass
        ? { ...view.mass, exploded: cut.mode === "exploded" ? { spreadPct: 24, scheme: "use" as const } : undefined }
        : undefined;
      return { sheets: [], single: { view: viewForCut(view, cut), mapKey: `${view.tileId}:mass`, mass } };
    }
    case "S02": {
      const date = cut.date ?? "winter";
      if (cut.mode === "single") return { sheets: [], single: { view: viewForCut(view, cut), mapKey: `${view.tileId}:cut-${date}` } };
      if (cut.mode === "seasons4") {
        const cells = CUT_SEASONS.map((season) => `sun_hours_${season}`)
          .filter((name) => RASTER_NAMES(view).includes(name))
          .map((name) => rasterCell(view, name, CUT_DATE_LABEL[name.slice("sun_hours_".length) as keyof typeof CUT_DATE_LABEL], name.slice("sun_hours_".length)));
        return cells.length === 4 ? { sheets: [{ grid: "2x2", cells }] } : { sheets: [], single: { view: viewForCut(view, cut), mapKey: `${view.tileId}:cut-${date}` } };
      }
      const hourly = hoursFor(view, date);
      const legacy = hourly.length === 0 ? legacyShadowHours(view) : [];
      const names = hourly.length >= 3 ? [hourly[0]!, hourly[Math.floor(hourly.length / 2)]!, hourly[hourly.length - 1]!] : legacy;
      if (cut.mode === "hours3") {
        const cells = names.slice(0, 3).map((name) => rasterCell(view, name, name.startsWith("shadow_") ? `${CUT_DATE_LABEL[date]} ${name.slice(-2)}:00` : cutNote(cut, name), `cut${name.slice(-2)}`));
        return cells.length === 3 ? { sheets: [{ grid: "3x1", cells }] } : { sheets: [], single: { view: viewForCut(view, cut), mapKey: `${view.tileId}:cut-${date}` } };
      }
      const flow = `shade_${date}_flow`;
      const groups = hourly.reduce<CutCell[][]>((all, name, index) => {
        const group = Math.floor(index / 6);
        (all[group] ??= []).push(rasterCell(view, name, cutNote({ tile: "S02", mode: "flow", date }, name), `flow-${name.slice(-2)}`));
        return all;
      }, []);
      const sheets = groups.filter((group) => group.length > 0).map((cells) => ({ grid: "3x2" as const, cells }));
      const single = RASTER_NAMES(view).includes(flow)
        ? { view: viewWithOnlyRaster(view, flow, `${CUT_DATE_LABEL[date]} 그림자 흐름`), mapKey: `${view.tileId}:flow`, rasterName: flow }
        : undefined;
      return sheets.length > 0 || single ? { sheets, single } : { sheets: [], single: { view: viewForCut(view, cut), mapKey: `${view.tileId}:cut-${date}` } };
    }
    case "S03": {
      const layer = String(Math.round(cut.layerZ)).padStart(2, "0");
      if (cut.mode === "seasons4" && cutReady(view, cut)) {
        const cells = CUT_SEASONS.map((season) => `wind_${season}_z${layer}`).map((name) => rasterCell(view, name, `${CUT_SEASON_LABEL[name.split("_")[1] as Season]} ${cut.layerZ}m`, name));
        return { sheets: [{ grid: "2x2", cells }] };
      }
      return { sheets: [], single: { view: viewForCut(view, cut), mapKey: `${view.tileId}:wind-${cut.season ?? "annual"}-${layer}` } };
    }
    case "S04": {
      const season = cut.season ?? "summer";
      if (cut.mode === "seasons4" && cutReady(view, cut)) {
        const cells = CUT_SEASONS.map((candidate) => `utci_${candidate}_h14`).map((name) => rasterCell(view, name, `${CUT_SEASON_LABEL[name.split("_")[1] as Season]} 14시`, name));
        return { sheets: [{ grid: "2x2", cells }] };
      }
      if (cut.mode === "hours3" && cutReady(view, cut)) {
        const cells = [10, 14, 18].map((hour) => {
          const name = `utci_${season}_h${hour}`;
          return rasterCell(view, name, `${CUT_SEASON_LABEL[season]} ${hour}시`, name);
        });
        return { sheets: [{ grid: "3x1", cells }] };
      }
      const name = `utci_${season}_h${cut.hour ?? 14}`;
      return { sheets: [], single: { view: viewForCut(view, cut), mapKey: `${view.tileId}:${name}`, rasterName: name } };
    }
    case "D22": {
      if (cut.mode === "seasons4" && cutReady(view, cut)) {
        return { sheets: [{ grid: "2x2", cells: CUT_SEASONS.map((season) => roseCell(view, season, season)) }] };
      }
      return { sheets: [], single: { ...roseCell(view, "annual", "annual"), view: viewForCut(view, cut), mapKey: `${view.tileId}:rose` } };
    }
  }
}

function cutCellWithMeta(cell: CutCell, sourceLine: string, pinnedKeys: string[]) {
  return { ...cell, face: "front" as const, sourceLine, pinnedKeys };
}

/** S02 3컷 조판용으로 그림자 시각 하나와 수광면만 남긴다. 원본 뷰는 변경하지 않는다. */
export function viewWithOnlyLayer(view: TileView, layer: string, note: string): TileView {
  const polygons = (view.map?.polygons ?? []).filter((polygon) => polygon.layer === layer || polygon.layer === "sun_face");
  return {
    ...view,
    notes: [note, ...view.notes.filter((existing) => existing !== note)],
    map: view.map ? { ...view.map, polygons, polygonsTotal: polygons.length } : null,
  };
}

function oneLine(v: TileView): string {
  if (!hasResult(v)) return (v.badges[0]?.text ?? "결과 없음") + " · 결과 없음";
  if (!v.headline) return `결과 있음${v.filterLine ? " · 필터 적용" : ""}`;
  const line = `${v.headline.label} ${v.headline.value}${v.headline.aux ? ` ${v.headline.aux}` : ""}`;
  return `${line}${v.filterLine ? " · 필터 적용" : ""}`;
}

/** sourceLine("id 2026-09-01 · id2 기준일 미확인") → [id, 기준일] */
function parseSources(line: string): [string, string][] {
  if (line === "출처 없음") return [];
  return line.split(" · ").map((p) => {
    // 원천 이름에 공백이 있을 수 있어, 끝의 기준일("YYYY[-MM[-DD]]" 또는 "기준일 미확인")을 떼어 낸다
    const m = /^(.*) (\d{4}(?:-\d{2}(?:-\d{2})?)?|기준일 미확인)$/.exec(p);
    return (m ? [m[1], m[2]] : [p, ""]) as [string, string];
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
  } satisfies SourceDetailRow));
}

/**
 * 보드의 출처 장 수와 실제 보고서 계획이 같은 정규화 기준을 쓰도록 원천 행을 센다.
 * 같은 자료명·기준일을 여러 원천 ID가 공유하는 경우(예: 시설·구역)는 한 행이다.
 * 화면의 장수 추정 시점에는 서버 출처 메타데이터를 아직 받지 않았으므로 카탈로그 이름을 쓴다.
 */
export function sourceRowCountForViews(views: Iterable<TileView>): number {
  const keys = new Set<string>();
  const emptyMeta = new Map<string, SourceMeta>();
  for (const view of views) {
    const details = view.sourceRefs.length > 0
      ? sourceDetailsFor({ code: view.code, tileType: view.tileType, provenance: { sources: view.sourceRefs } }, emptyMeta)
      : null;
    const rows = details?.rows ?? fallbackSourceRows(view);
    for (const row of rows) keys.add(`${row.provider}|${row.name}|${row.asOf}`);
  }
  return keys.size;
}

export const sourcePageCountForViews = (views: Iterable<TileView>): number => sourcePageCount(sourceRowCountForViews(views));

export function buildReportPlan(input: {
  summary: SummaryView;
  views: Map<string, TileView>;
  board: BoardState;
  analysisDate?: string;
  sourceMeta?: ReadonlyMap<string, SourceMeta>;
}): PlannedSlide[] {
  const { summary, views, board } = input;
  const date = input.analysisDate ?? "미확인";
  const sourceMeta = input.sourceMeta ?? new Map<string, SourceMeta>();
  const tiles = board.order.filter((id) => board.included[id] && views.has(id)).map((id) => views.get(id)!);
  const raw: (ReportSlide & { footer: string })[] = [];

  const detailsFor = (view: TileView) => view.sourceRefs.length > 0
    ? sourceDetailsFor({ code: view.code, tileType: view.tileType, provenance: { sources: view.sourceRefs } }, sourceMeta)
    : null;
  const reportRowsFor = (view: TileView): SourceDetailRow[] | null => {
    const details = detailsFor(view);
    if (!details) return null;
    const legacyAsOf = new Map(parseSources(view.sourceLine).map(([name, asOf]) => [name, asOf]));
    return details.rows.map((row) => row.asOf === UNKNOWN_AS_OF && legacyAsOf.has(row.name)
      ? { ...row, asOf: legacyAsOf.get(row.name)! }
      : row);
  };
  const sourceLineFor = (view: TileView): string => {
    const rows = reportRowsFor(view);
    if (!rows || rows.length === 0) return view.sourceLine;
    return rows.map((row) => `${row.provider} · ${row.name} · ${row.asOf}`).join(" · ");
  };
  const sourceFooterFor = (view: TileView): string => {
    const line = sourceLineFor(view);
    return line === "출처 없음" ? "출처 없음 · 기준일 해당 없음" : `출처 ${line}`;
  };

  raw.push({
    kind: "cover",
    address: summary.address,
    metrics: [
      { label: "대지 면적", value: summary.area },
      { label: "용도지역", value: summary.zoning },
      { label: "분석 반경", value: summary.radius.replace(/^반경 /, "") },
      { label: "분석일", value: date },
    ],
    asOfLine: summary.asOfLine,
    incomplete: summary.incomplete ? `지역 자료 불완전 · ${summary.incompleteCount}개 타일` : null,
    lines: tiles.map((v) => ({ title: v.title, color: v.color, text: oneLine(v) })),
    map: summary.map,
    footer: `${summary.asOfLine} · 출처와 기준일은 마지막 장 참조`,
  });

  for (const v of tiles) {
    if (v.code === "SHEET" && v.sheetTiles && v.sheetGrid) {
      const cells = v.sheetTiles
        .map((id) => views.get(id))
        .filter((cell): cell is TileView => !!cell)
        .map((cell) => ({
          view: cell,
          face: cell.hasFace && board.faces[cell.tileId] === "back" ? "back" as const : "front" as const,
          mapKey: `${cell.tileId}:cell`,
          sourceLine: sourceLineFor(cell),
          pinnedKeys: pinnedKeysFor(board, cell.tileId),
        }));
      raw.push({
        kind: "sheet",
        view: v,
        grid: v.sheetGrid,
        cells,
        footer: sourceFooterFor(v),
      });
      continue;
    }
    const selectedCut = isCutSpec(board.cuts[v.tileId]) && board.cuts[v.tileId].tile === v.code
      ? board.cuts[v.tileId]
      : defaultCutForCode(v.code);
    if (selectedCut && CUT_CODES.has(v.code) && hasResult(v)) {
      const cutPlan = cutPlanFor(v, selectedCut);
      for (const sheetPlan of cutPlan.sheets) {
        raw.push({
          kind: "sheet",
          view: v,
          grid: sheetPlan.grid,
          cells: sheetPlan.cells.map((cell) => cutCellWithMeta(cell, sourceLineFor(v), pinnedKeysFor(board, v.tileId))),
          footer: sourceFooterFor(v),
        });
      }
      if (cutPlan.single) {
        const cell = cutPlan.single;
        raw.push({
          kind: "tile",
          view: cell.view,
          body: { kind: "result", face: "single" },
          faceLabel: cell.view.hasFace ? "도판" : null,
          map: cell.mass || cell.rose ? null : cell.view.map ?? cell.view.backdrop,
          muted: false,
          ...(cell.mass ? { mass: cell.mass } : {}),
          ...(cell.rose ? { rose: cell.rose, roseSeason: cell.roseSeason ?? "annual" } : {}),
          pinnedKeys: pinnedKeysFor(board, v.tileId),
          footer: sourceFooterFor(v),
        });
      }
      continue;
    }
    if (v.callout && hasResult(v)) {
      // 설명선 타일: 개요 1장 + 설명표 장 (설정: 개요만 / 상위 10 / 전체). 장수는 board-state.reportPages와 같은 함수
      const cm = v.callout;
      const count = calloutReportPages(board.callout[v.tileId] ?? DEFAULT_CALLOUT_MODE, cm.complexes.length);
      const sourceFooter = sourceFooterFor(v);
      for (let page = 0; page < count; page++) {
        raw.push({
          kind: "tile",
          view: v,
          body: { kind: "result", face: "single" },
          faceLabel: null,
          map: v.backdrop,
          muted: false,
          callout: { model: cm, page, pages: pageCount(cm.complexes.length), filterLine: v.filterLine },
          footer: v.filterLine ? `${v.filterLine} · ${sourceFooter}` : sourceFooter,
        });
      }
      continue;
    }
    const faces: ("single" | "front" | "back")[] = !v.hasFace ? ["single"] : board.faces[v.tileId] === "both" ? ["front", "back"] : [board.faces[v.tileId] === "back" ? "back" : "front"];
    for (const face of faces) {
      const message = STATE_MESSAGE[v.status];
      const result = hasResult(v);
      const mass = result && v.mass ? { ...v.mass } : undefined;
      const rose = result && face !== "back" ? v.rose ?? undefined : undefined;
      raw.push({
        kind: "tile",
        view: v,
        body: hasResult(v) ? { kind: "result", face } : { kind: "state", face, message: message ?? "결과 없음 — 보고서에는 결과 없이 표시합니다" },
        faceLabel: v.code === "STACK" ? "스택" : v.hasFace ? FACE_TEXT[face === "front" ? "front" : "back"] : null,
        // 모든 장은 지도(또는 주 시각물)가 전면: 지도 없는 결과는 지물 없는 대지 지도, 상태 장은 흐린 대지 지도
        map: mass || rose ? null : !result ? v.backdrop : v.hasFace && face === "back" ? null : (v.map ?? v.backdrop),
        muted: !result,
        pinnedKeys: pinnedKeysFor(board, v.tileId),
        ...(mass ? { mass } : {}),
        ...(rose ? { rose, roseSeason: "annual" as const } : {}),
        footer: sourceFooterFor(v),
      });
    }
  }

  type ReportSourceAccum = Omit<ReportSourceRow, "tiles"> & { tiles: string[] };
  const bySource = new Map<string, ReportSourceAccum>();
  for (const v of tiles) {
    const rows = reportRowsFor(v) ?? fallbackSourceRows(v);
    for (const row of rows) {
      const key = `${row.provider}|${row.name}|${row.asOf}`;
      const e = bySource.get(key) ?? { source: row.name, asOf: row.asOf, tiles: [], provider: row.provider, license: row.license, url: row.url };
      if (!e.tiles.includes(v.title)) e.tiles.push(v.title);
      if ((!e.provider || e.provider === "제공처 미기록") && row.provider) e.provider = row.provider;
      if ((!e.license || e.license === "미기록") && row.license) e.license = row.license;
      if (!e.url && row.url) e.url = row.url;
      bySource.set(key, e);
    }
  }
  const sourceRows = [...bySource.values()].map((row) => ({ ...row, tiles: row.tiles.join(", ") }));
  const sourcePages = sourcePageCount(sourceRows.length);
  for (let page = 0; page < sourcePages; page++) {
    raw.push({
      kind: "sources",
      rows: sourceRows.slice(page * REPORT_SOURCE_ROWS_PER_SLIDE, (page + 1) * REPORT_SOURCE_ROWS_PER_SLIDE),
      analysisDate: date,
      map: summary.map,
      footer: `${summary.asOfLine} · 출처 ${bySource.size}건${sourcePages > 1 ? ` · 출처 ${page + 1}/${sourcePages}` : ""}`,
    });
  }

  return raw.map((s, i) => ({ ...s, no: i + 1, total: raw.length }));
}

/** 다운로드 파일명: 사이트분석_<주소>_<YYYYMMDD>.pptx */
export function reportFileName(address: string, analysisDate: string): string {
  return exportFileName("pptx", address, analysisDate);
}

/** 보드 상태: 순서·제거/되돌리기·이동·보고서 포함·출력 면. 순수 reducer. */
import type { RoseSeason, TileResult } from "../tile-result";
import { normalizeA05Filter, type A05Filter } from "../engine/a05-filter";
import { calloutReportPages, DEFAULT_CALLOUT_MODE, type CalloutMode } from "./callout-layout";
import { CAMERA_PRESETS } from "./mass-projection";
import type { OutputFace } from "./tile-view";
import { layerOptionsForResult, normalizeLayerId } from "./tile-layers";
import { DEFAULT_PRESET_ID, isPresetId, TILE_PRESETS, type PresetId } from "./tile-catalog";
import { CUT_CODES, tileClientModuleFor } from "../tile/client";
import type { D22Cut } from "../tile/d22/cut";
import type { S01Cut } from "../tile/s01/cut";
import type { S02Cut, S02DateKey } from "../tile/s02/cut";
import type { S03Cut } from "../tile/s03/cut";
import type { S04Cut } from "../tile/s04/cut";
import { sheetCapacity, type SheetGrid as UiSheetGrid } from "./sheet";
import { clampReportFontSizes, EMPTY_REPORT_DOC, defaultFrame, mergeReportFontSizes, normalizeMapLabelBox, PAGE_ELEMENT_KEYS, reportFontSizesFromLegacyScale, TEXT_BOX_COLORS, type MapFrameState, type ReportDoc, type ReportPage, type ReportFontSizes, type TextBoxAlign, type TextBoxKind, type TilePart, type PageElementKey } from "../report/report-doc";
import { normalizePagePanels, clonePagePanels, type PagePanelKey, type PagePanelRect, type PagePanels } from "../report/report-geometry";
export type { PagePanelKey, PagePanelRect, PagePanels } from "../report/report-geometry";
import type { TileReportSettings } from "../report/report-plan";

export type TileSize = 1 | 2 | 4;
export type GridColumns = 2 | 3 | 4 | 5 | 6;
export type SheetGrid = UiSheetGrid;
export type SheetSpec = { tiles: string[]; grid: SheetGrid };
export type CameraPreset = { azimuthDeg: number; elevationDeg: number };
export type CutCount = 1 | 3;
export type SunDateKey = S02DateKey;
export type Season = Exclude<SunDateKey, "analysis">;
export type WindSeason = "annual" | Season;
/** 화면·보고서·내보내기가 공유하는 타일별 컷 선택. */
export type CutSpec =
  | S01Cut
  | S02Cut
  | S03Cut
  | S04Cut
  | D22Cut;
export type LegacyCutSpec = CutSpec | CutCount;
export type PinnedLabel = { key: string; on: boolean };

export type PageKey = string;
export type PageStyle = {
  pinnedKeys?: string[];
  hiddenKeys?: string[];
  legendFocus?: string | null;
  zoomDelta?: number;
  offsetM?: [number, number];
  summary?: boolean;
  titleScale?: number;
  summaryScale?: number;
  legendScale?: number;
  fontSizes?: ReportFontSizes;
  /** 슬라이드 비율(0..1)로 저장하는 제목·요약·범례 도형 자리. */
  panels?: PagePanels;
};
export type ExtraReportPage = {
  id: string;
  after: PageKey | null;
  tileId: string;
  face: "front" | "back";
  sheet?: { grid: SheetGrid; tiles: string[] };
};
export type ReportState = {
  styles: Record<PageKey, PageStyle>;
  extra: ExtraReportPage[];
};

const PAGE_STYLE_SCALE_MIN = 0.7;
const PAGE_STYLE_SCALE_MAX = 1.5;
const PAGE_STYLE_ZOOM_MIN = -3;
const PAGE_STYLE_ZOOM_MAX = 3;
const PAGE_STYLE_KEYS = [
  "pinnedKeys",
  "hiddenKeys",
  "legendFocus",
  "zoomDelta",
  "offsetM",
  "summary",
  "titleScale",
  "summaryScale",
  "legendScale",
  "fontSizes",
  "panels",
] as const;

export function extraPageKey(id: string): PageKey {
  return `extra:${id}`;
}

type TileSettingsSnapshot = {
  included?: boolean;
  faces?: OutputFace;
  callout?: CalloutMode;
  a05Filter?: A05Filter;
  view?: CardFace;
  size?: TileSize;
  tileKind?: TileResult["tileType"];
  camera?: CameraPreset;
  cut?: CutSpec;
  labels?: PinnedLabel[];
  mapLabels?: boolean;
  layer?: string;
  terrainSection?: TerrainSectionId;
};

/** 되돌리기 한 단계. 모든 편집(순서·크기·제거·더하기)이 여기 쌓인다. */
export type UndoEntry =
  | { kind: "order"; id: string; order: string[]; report?: ReportState }
  | { kind: "size"; id: string; size: TileSize }
  | { kind: "columns"; columns: GridColumns }
  | { kind: "remove"; id: string; index: number; report?: ReportState }
  | { kind: "removeCopy"; id: string; sourceId: string; index: number; settings: TileSettingsSnapshot; report?: ReportState }
  | { kind: "duplicate"; id: string; index: number; origin?: "addCopy" }
  | { kind: "add"; id: string; trayIndex: number }
  | { kind: "preset"; preset: PresetId; order: string[]; included: Record<string, boolean>; removed: { id: string; index: number }[] };

/** 보드 카드의 화면 면: 요약면(기본, 지도 없음) / 지도면(지도 몰입형). 보고서 출력 면(OutputFace)과 무관하다 */
export type CardFace = "summary" | "map";
export type TerrainSectionId = "A" | "B";
/** 대지 요약 카드의 view 키 */
export const SUMMARY_ID = "site-summary";
export const BOARD_STATE_VERSION = 4;
/** 타일 코드가 바뀌어도 저장 보드의 모든 참조를 한 번에 옮길 수 있는 자리. */
export const TILE_CODE_RENAMES: Record<string, string> = {
  D06: "D05",
  D07: "D05",
  D08: "A12",
  D09: "A04",
  D14: "A01",
  D20: "D19",
  D21: "S02",
  D23: "A09",
  D24: "A10",
  D25: "A07",
  D26: "A02",
  D27: "A11",
};
const LEGACY_LAYER_RENAMES: Record<string, string> = {
  D06: "height_tall",
  D07: "height_low",
  D08: "zoning_detail",
  D09: "green_space",
  D14: "transit",
  D20: "parcel_size",
  D21: "sun_hours_winter",
  D23: "maintenance_stage",
  D24: "planned_detail",
  D25: "trade_location",
  D26: "school_zone",
  D27: "density_detail",
};
export const boardStorageKey = (analysisId: string): string => `site-analysis:v2:board:${analysisId}`;

export type BoardState = {
  /** 폴링으로 갱신되는 최신 결과. 편집 상태와 분리해 replaceResults가 이것만 바꾼다. */
  results: TileResult[];
  /** 보드에 적용한 과제 프리셋. 계산 결과와 분리해 저장한다. */
  preset: PresetId;
  order: string[];
  included: Record<string, boolean>;
  faces: Record<string, OutputFace>;
  /** 주변 단지 설명선 타일의 보고서 설명표 장수: 개요만 / 상위 10 / 전체 */
  callout: Record<string, CalloutMode>;
  /** A05 타일별 재집계 필터. 결과(TileResult)와 분리해 저장한다. */
  a05Filter: Record<string, A05Filter>;
  /** 카드별 화면 면. 전체 전환 뒤 카드별로 뒤집으면 그 카드만 다음 전체 전환까지 따로 간다. 보고서·되돌리기에 들어가지 않는다 */
  view: Record<string, CardFace>;
  viewAll: CardFace;
  /** 사용자가 저장한 보드 열 수. 좁은 화면의 실제 열 수는 CSS/측정으로 줄어들 수 있다. */
  columns: GridColumns;
  sizes: Record<string, TileSize>;
  /** 원본 타일의 종류. 스택 reducer가 simulation/다른 스택을 걸러낼 때 사용한다. */
  tileKinds: Record<string, TileResult["tileType"]>;
  /** 스택 id → 층 타일 id(위→아래) */
  stacks: Record<string, string[]>;
  /** 조판 id → 셀 타일 id(왼쪽 위부터)와 격자 */
  sheets: Record<string, SheetSpec>;
  /** S01 타일 id → 저장된 카메라 프리셋 */
  cameras: Record<string, CameraPreset>;
  /** 시뮬레이션·바람장·바람장미 타일 id → 화면·보고서 컷 */
  cuts: Record<string, CutSpec>;
  /** 타일 id → 지도 요소 라벨의 고정·표시 상태 */
  labels: Record<string, PinnedLabel[]>;
  /** 타일 id → 지도 표현/래스터 레이어. 비어 있으면 타일 기본 레이어. */
  layers: Record<string, string>;
  /** 카드 지도 자동 라벨 표시. 누락된 옛 저장본은 기본 숨김(false)이다. */
  mapLabels: Record<string, boolean>;
  /** D17 수치지형도 단면 선택. 결과가 없거나 topo가 없으면 사용하지 않는다. */
  terrainSection: Record<string, TerrainSectionId>;
  /** copy:N → 원본 결과 타일 id. 복제본은 결과 배열을 늘리지 않고 보드 설정만 가진다. */
  instances: Record<string, string>;
  /** 보고서 페이지별 표시 설정과 보드 타일에서 파생한 추가 페이지. */
  report: ReportState;
  /** 보드와 독립된 보고서 모드의 페이지 문서. 옛 report는 불러오기용으로만 보존한다. */
  reportDoc: ReportDoc;
  /** 빼 둔 타일(더할 수 있는 타일). index는 빼기 전 위치 */
  removed: { id: string; index: number }[];
  undoStack: UndoEntry[];
};

export type BoardAction =
  | { type: "replaceResults"; results: TileResult[] }
  | { type: "restore"; snapshot: unknown; fallbackPreset?: PresetId }
  | { type: "preset"; preset: PresetId }
  | { type: "remove"; id: string }
  | { type: "duplicate"; id: string }
  | { type: "addCopy"; sourceId: string }
  | { type: "undo" }
  | { type: "move"; id: string; dir: -1 | 1 }
  | { type: "reorder"; from: number; to: number }
  | { type: "resize"; id: string; size: TileSize }
  | { type: "columns"; columns: GridColumns }
  | { type: "add"; id: string }
  | { type: "a05Filter"; id: string; filter: A05Filter | null }
  | { type: "view"; id: string; face: CardFace }
  | { type: "viewAll"; face: CardFace }
  | { type: "stack"; layers: string[] }
  | { type: "unstack"; id: string }
  | { type: "sheet"; tiles: string[]; grid: SheetGrid }
  | { type: "unsheet"; id: string }
  | { type: "camera"; id: string; camera: CameraPreset }
  | { type: "cut"; id: string; cut: CutSpec }
  /** W1 저장/컴포넌트 호환용 입력. reducer 안에서 CutSpec으로 즉시 승격한다. */
  | { type: "cuts"; id: string; cuts: LegacyCutSpec }
  /** W1 화면 입력 호환용. 새 상태에는 D22 seasons4/annual로만 저장한다. */
  | { type: "roseSeason"; id: string; season: RoseSeason }
  | { type: "pinLabel"; id: string; key: string }
  | { type: "unpinLabel"; id: string; key: string }
  | { type: "toggleLabel"; id: string; key: string }
  | { type: "setAllLabels"; id: string; on: boolean }
  | { type: "mapLabels"; id: string; show: boolean }
  | { type: "layer"; id: string; layer: string }
  | { type: "terrainSection"; id: string; section: TerrainSectionId }
  | { type: "reportDoc"; doc: ReportDoc };

/** 카드의 현재 면 (편집 중에는 화면이 항상 요약면을 쓴다) */
export const viewOf = (s: Pick<BoardState, "view" | "viewAll">, id: string): CardFace => s.view[id] ?? s.viewAll;

export function initBoard(results: TileResult[], preset: PresetId = DEFAULT_PRESET_ID): BoardState {
  const base: BoardState = {
    results: [...results],
    preset: DEFAULT_PRESET_ID,
    order: results.map((r) => r.tileId),
    // 결과가 있는 타일만 기본 포함
    included: Object.fromEntries(results.map((r) => [r.tileId, r.status === "complete" || r.status === "partial"])),
    faces: Object.fromEntries(results.map((r) => [r.tileId, r.presentation.outputFace])),
    callout: Object.fromEntries(results.flatMap((result) => {
      const mode = tileClientModuleFor(result.tileCode)?.board?.callout?.(result);
      return mode ? [[result.tileId, mode] as const] : [];
    })),
    a05Filter: {},
    view: {},
    viewAll: "summary",
    columns: 4,
    sizes: Object.fromEntries(results.map((result) => [result.tileId, tileClientModuleFor(result.tileCode)?.board?.size?.(result) ?? 1] as const)),
    tileKinds: Object.fromEntries(results.map((r) => [r.tileId, r.tileType])),
    stacks: {},
    sheets: {},
    cameras: {},
    cuts: {},
    labels: {},
    layers: {},
    mapLabels: {},
    terrainSection: {},
    instances: {},
    report: { styles: {}, extra: [] },
    reportDoc: { ...EMPTY_REPORT_DOC, pages: [] },
    removed: [],
    undoStack: [],
  };
  return applyPresetState(base, preset);
}

function applyPresetState(s: BoardState, requestedPreset: PresetId): BoardState {
  const preset = isPresetId(requestedPreset) ? requestedPreset : DEFAULT_PRESET_ID;
  const resultIds = new Set(s.results.map((result) => result.tileId));
  const resultByCode = new Map(s.results.map((result) => [result.tileCode, result]));
  const selectedIds = preset === DEFAULT_PRESET_ID
    ? s.results.map((result) => result.tileId)
    : TILE_PRESETS[preset].codes.flatMap((code) => {
        const result = resultByCode.get(code);
        return result ? [result.tileId] : [];
      });
  const selected = new Set(selectedIds);
  // 스택·조판처럼 결과 배열에 없는 사용자 구성은 프리셋 변경 뒤에도 끝에 남긴다.
  const customIds = s.order.filter((id) => !resultIds.has(id));
  const order = [...selectedIds, ...customIds.filter((id, index) => customIds.indexOf(id) === index)];
  const ordered = new Set(order);
  const included = { ...s.included };
  for (const result of s.results) {
    included[result.tileId] = selected.has(result.tileId) && (result.status === "complete" || result.status === "partial");
  }
  const existingIndex = new Map(s.order.map((id, index) => [id, index]));
  const allIds = [...new Set([
    ...s.results.map((result) => result.tileId),
    ...s.order,
    ...s.removed.map((item) => item.id),
  ])];
  const removed = allIds
    .filter((id) => !ordered.has(id))
    .map((id, index) => ({ id, index: existingIndex.get(id) ?? index }));
  return { ...s, preset, order, included, removed };
}

/** order 배열에서 from 위치 타일을 to 위치로 옮긴다. 범위 밖·제자리면 null. */
function reordered(order: string[], from: number, to: number): string[] | null {
  const n = order.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return null;
  const next = [...order];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

const COPY_ID = /^copy:\d+$/;

function sourceTileIdFromInstances(instances: Readonly<Record<string, string>>, id: string): string {
  let current = id;
  const seen = new Set<string>();
  while (instances[current] && !seen.has(current)) {
    seen.add(current);
    current = instances[current]!;
  }
  return current;
}

/** 복제본이 가리키는 실제 결과 타일 id. copy:N은 결과 배열에 들어가지 않는다. */
export function sourceTileId(s: Pick<BoardState, "instances">, id: string): string {
  return sourceTileIdFromInstances(s.instances, id);
}

function copyA05Filter(filter: A05Filter | undefined): A05Filter | undefined {
  if (!filter) return undefined;
  return {
    ...filter,
    ...(filter.types ? { types: [...filter.types] } : {}),
    ...Object.fromEntries((['year', 'households', 'floors', 'buildings', 'distance'] as const)
      .filter((key) => filter[key])
      .map((key) => [key, { ...filter[key] }])) as Partial<A05Filter>,
  };
}

function copyTileSettings(s: BoardState, id: string): TileSettingsSnapshot {
  return {
    included: s.included[id],
    faces: s.faces[id],
    callout: s.callout[id],
    a05Filter: copyA05Filter(s.a05Filter[id]),
    view: s.view[id],
    size: s.sizes[id],
    tileKind: s.tileKinds[id],
    camera: s.cameras[id] ? { ...s.cameras[id] } : undefined,
    cut: s.cuts[id] ? { ...s.cuts[id] } : undefined,
    labels: s.labels[id]?.map((label) => ({ ...label })),
    mapLabels: s.mapLabels[id],
    layer: s.layers[id],
    terrainSection: s.terrainSection[id],
  };
}

function withRecordValue<T>(record: Record<string, T>, id: string, value: T | undefined): Record<string, T> {
  return value === undefined ? record : { ...record, [id]: value };
}

function withoutRecordValue<T>(record: Record<string, T>, id: string): Record<string, T> {
  if (!(id in record)) return record;
  const next = { ...record };
  delete next[id];
  return next;
}

function clonePageStyle(style: PageStyle): PageStyle {
  const panels = clonePagePanels(style.panels);
  const fontSizes = style.fontSizes ? mergeReportFontSizes(undefined, style.fontSizes) : undefined;
  return {
    ...(style.pinnedKeys ? { pinnedKeys: [...style.pinnedKeys] } : {}),
    ...(style.hiddenKeys ? { hiddenKeys: [...style.hiddenKeys] } : {}),
    ...(style.legendFocus !== undefined ? { legendFocus: style.legendFocus } : {}),
    ...(style.zoomDelta !== undefined ? { zoomDelta: style.zoomDelta } : {}),
    ...(style.offsetM ? { offsetM: [style.offsetM[0], style.offsetM[1]] } : {}),
    ...(style.summary !== undefined ? { summary: style.summary } : {}),
    ...(style.titleScale !== undefined ? { titleScale: style.titleScale } : {}),
    ...(style.summaryScale !== undefined ? { summaryScale: style.summaryScale } : {}),
    ...(style.legendScale !== undefined ? { legendScale: style.legendScale } : {}),
    ...(fontSizes ? { fontSizes } : {}),
    ...(panels ? { panels } : {}),
  };
}

function cloneReport(report: ReportState): ReportState {
  return {
    styles: Object.fromEntries(Object.entries(report.styles).map(([key, style]) => [key, clonePageStyle(style)])),
    extra: report.extra.map((page) => ({
      ...page,
      ...(page.sheet ? { sheet: { grid: page.sheet.grid, tiles: [...page.sheet.tiles] } } : {}),
    })),
  };
}

function reportWithoutTile(s: BoardState, tileId: string): { report: ReportState; undo: ReportState | undefined } {
  let changed = false;
  const extra = s.report.extra.flatMap((page) => {
    if (page.sheet) {
      const tiles = page.sheet.tiles.map((candidate) => candidate === tileId ? "" : candidate);
      if (tiles.every((candidate, index) => candidate === page.sheet!.tiles[index])) return [page];
      changed = true;
      return [{ ...page, sheet: { ...page.sheet, tiles } }];
    }
    if (page.tileId === tileId) {
      changed = true;
      return [];
    }
    return [page];
  });
  if (!changed) return { report: s.report, undo: undefined };
  const styles: Record<PageKey, PageStyle> = {};
  for (const [key, style] of Object.entries(s.report.styles)) {
    const removed = s.report.extra.some((page) => page.tileId === tileId && key === extraPageKey(page.id));
    if (!removed) styles[key] = clonePageStyle(style);
  }
  return {
    report: { styles, extra: extra.map((page) => ({ ...page, ...(page.sheet ? { sheet: { ...page.sheet, tiles: [...page.sheet.tiles] } } : {}) })) },
    undo: cloneReport(s.report),
  };
}

function restoreReportUndo(report: ReportState, undo: ReportState | undefined): ReportState {
  return undo ? cloneReport(undo) : report;
}

function pageStyleValue(field: typeof PAGE_STYLE_KEYS[number], value: unknown): PageStyle | null {
  if (field === "fontSizes") {
    const fontSizes = clampReportFontSizes(value);
    return Object.keys(fontSizes).length > 0 ? { fontSizes: mergeReportFontSizes(undefined, fontSizes) } : null;
  }
  if (field === "panels") {
    const panels = normalizePagePanels(value);
    return panels ? { panels } : null;
  }
  if (field === "pinnedKeys" || field === "hiddenKeys") {
    const key = field;
    return Array.isArray(value)
      ? { [key]: [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))] } as PageStyle
      : null;
  }
  if (field === "offsetM") {
    return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number" && Number.isFinite(item))
      ? { offsetM: [value[0] as number, value[1] as number] }
      : null;
  }
  if (field === "legendFocus") return value === null || (typeof value === "string" && value.length > 0) ? { legendFocus: value } : null;
  if (field === "summary") return typeof value === "boolean" ? { summary: value } : null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (field === "zoomDelta") return { zoomDelta: Math.max(PAGE_STYLE_ZOOM_MIN, Math.min(PAGE_STYLE_ZOOM_MAX, value)) };
  const scale = Math.max(PAGE_STYLE_SCALE_MIN, Math.min(PAGE_STYLE_SCALE_MAX, value));
  return { [field]: scale } as PageStyle;
}

function restoreTileSettings(s: BoardState, id: string, settings: TileSettingsSnapshot): BoardState {
  return {
    ...s,
    included: withRecordValue(s.included, id, settings.included),
    faces: withRecordValue(s.faces, id, settings.faces),
    callout: withRecordValue(s.callout, id, settings.callout),
    a05Filter: withRecordValue(s.a05Filter, id, copyA05Filter(settings.a05Filter)),
    view: withRecordValue(s.view, id, settings.view),
    sizes: withRecordValue(s.sizes, id, settings.size),
    tileKinds: withRecordValue(s.tileKinds, id, settings.tileKind),
    cameras: withRecordValue(s.cameras, id, settings.camera ? { ...settings.camera } : undefined),
    cuts: withRecordValue(s.cuts, id, settings.cut ? { ...settings.cut } : undefined),
    labels: withRecordValue(s.labels, id, settings.labels?.map((label) => ({ ...label }))),
    mapLabels: withRecordValue(s.mapLabels, id, settings.mapLabels),
    layers: withRecordValue(s.layers, id, settings.layer),
    terrainSection: withRecordValue(s.terrainSection, id, settings.terrainSection),
  };
}

function removeInstance(s: BoardState, id: string): BoardState {
  const report = reportWithoutTile(s, id).report;
  return {
    ...s,
    order: s.order.filter((candidate) => candidate !== id),
    instances: withoutRecordValue(s.instances, id),
    included: withoutRecordValue(s.included, id),
    faces: withoutRecordValue(s.faces, id),
    callout: withoutRecordValue(s.callout, id),
    a05Filter: withoutRecordValue(s.a05Filter, id),
    view: withoutRecordValue(s.view, id),
    sizes: withoutRecordValue(s.sizes, id),
    tileKinds: withoutRecordValue(s.tileKinds, id),
    cameras: withoutRecordValue(s.cameras, id),
    cuts: withoutRecordValue(s.cuts, id),
    labels: withoutRecordValue(s.labels, id),
    mapLabels: withoutRecordValue(s.mapLabels, id),
    layers: withoutRecordValue(s.layers, id),
    terrainSection: withoutRecordValue(s.terrainSection, id),
    report,
  };
}

export function nextCopyId(s: BoardState): string {
  let number = 1;
  while (s.order.includes(`copy:${number}`) || s.instances[`copy:${number}`] || s.removed.some((item) => item.id === `copy:${number}`)) number += 1;
  return `copy:${number}`;
}

function duplicateTileSettings(s: BoardState, settingsId: string, sourceId: string, copyId: string): BoardState {
  const settings = copyTileSettings(s, settingsId);
  return restoreTileSettings({ ...s, instances: { ...s.instances, [copyId]: sourceId } }, copyId, {
    ...settings,
    included: settings.included ?? false,
    faces: settings.faces ?? "front",
    size: settings.size ?? 1,
    tileKind: settings.tileKind ?? "analysis",
  });
}

export function boardReducer(s: BoardState, a: BoardAction): BoardState {
  switch (a.type) {
    case "restore":
      return restoreBoardState(s.results, a.snapshot, a.fallbackPreset ?? s.preset);
    case "reportDoc":
      return a.doc === s.reportDoc ? s : { ...s, reportDoc: a.doc };
    case "preset": {
      const preset = isPresetId(a.preset) ? a.preset : DEFAULT_PRESET_ID;
      if (preset === s.preset) return s;
      const next = applyPresetState(s, preset);
      return {
        ...next,
        undoStack: [
          ...s.undoStack,
          {
            kind: "preset",
            preset: s.preset,
            order: [...s.order],
            included: { ...s.included },
            removed: s.removed.map((item) => ({ ...item })),
          },
        ],
      };
    }
    case "replaceResults":
      {
        const replacements = new Map(a.results.map((result) => [result.tileCode, result]));
        const existingCodes = new Set(s.results.map((result) => result.tileCode));
        return {
          ...s,
          results: [
            ...s.results.map((result) => replacements.get(result.tileCode) ?? result),
            ...a.results.filter((result) => !existingCodes.has(result.tileCode)),
          ],
        };
      }
    case "remove": {
      const index = s.order.indexOf(a.id);
      if (index < 0) return s;
      const sourceId = s.instances[a.id];
      if (sourceId) {
        const reportCleanup = reportWithoutTile(s, a.id);
        const next = { ...removeInstance(s, a.id), report: reportCleanup.report };
        return {
          ...next,
          undoStack: [...s.undoStack, { kind: "removeCopy", id: a.id, sourceId, index, settings: copyTileSettings(s, a.id), report: reportCleanup.undo }],
        };
      }
      const stacks = { ...s.stacks };
      delete stacks[a.id];
      const sheets = { ...s.sheets };
      delete sheets[a.id];
      const reportCleanup = reportWithoutTile(s, a.id);
      return {
        ...s,
        order: s.order.filter((x) => x !== a.id),
        stacks,
        sheets,
        report: reportCleanup.report,
        removed: [...s.removed, { id: a.id, index }],
        undoStack: [...s.undoStack, { kind: "remove", id: a.id, index, report: reportCleanup.undo }],
      };
    }
    case "duplicate": {
      const index = s.order.indexOf(a.id);
      const sourceId = sourceTileId(s, a.id);
      // stack/sheet는 결과 타일이 아니므로 복제 대상에서 제외한다.
      if (index < 0 || sourceId in s.stacks || sourceId in s.sheets || !s.results.some((result) => result.tileId === sourceId)) return s;
      const copyId = nextCopyId(s);
      const order = [...s.order];
      order.splice(index + 1, 0, copyId);
      const next = duplicateTileSettings(s, a.id, sourceId, copyId);
      return { ...next, order, undoStack: [...s.undoStack, { kind: "duplicate", id: copyId, index: index + 1 }] };
    }
    case "addCopy": {
      const sourceId = sourceTileId(s, a.sourceId);
      // stack/sheet는 결과 타일이 아니므로 복제 대상에서 제외한다.
      if (sourceId in s.stacks || sourceId in s.sheets || !s.results.some((result) => result.tileId === sourceId)) return s;
      const copyId = nextCopyId(s);
      const next = duplicateTileSettings(s, a.sourceId, sourceId, copyId);
      return {
        ...next,
        order: [...s.order, copyId],
        undoStack: [...s.undoStack, { kind: "duplicate", id: copyId, index: s.order.length, origin: "addCopy" }],
      };
    }
    case "add": {
      const trayIndex = s.removed.findIndex((r) => r.id === a.id);
      if (trayIndex < 0 || s.order.includes(a.id)) return s;
      return {
        ...s,
        order: [...s.order, a.id],
        removed: s.removed.filter((r) => r.id !== a.id),
        undoStack: [...s.undoStack, { kind: "add", id: a.id, trayIndex }],
      };
    }
    case "undo": {
      const u = s.undoStack[s.undoStack.length - 1];
      if (!u) return s;
      const rest = { undoStack: s.undoStack.slice(0, -1) };
      switch (u.kind) {
        case "order":
          return { ...s, ...rest, order: u.order, ...(u.report ? { report: cloneReport(u.report) } : {}) };
        case "size":
          return { ...s, ...rest, sizes: { ...s.sizes, [u.id]: u.size } };
        case "columns":
          return { ...s, ...rest, columns: u.columns };
        case "remove": {
          const order = [...s.order];
          order.splice(Math.min(u.index, order.length), 0, u.id);
          return { ...s, ...rest, order, report: restoreReportUndo(s.report, u.report), removed: s.removed.filter((r) => r.id !== u.id) };
        }
        case "removeCopy": {
          if (s.order.includes(u.id)) return { ...s, ...rest };
          const order = [...s.order];
          order.splice(Math.min(u.index, order.length), 0, u.id);
          const restored = restoreTileSettings({ ...s, order, instances: { ...s.instances, [u.id]: u.sourceId } }, u.id, u.settings);
          return { ...restored, report: restoreReportUndo(restored.report, u.report), undoStack: rest.undoStack };
        }
        case "duplicate":
          return { ...removeInstance(s, u.id), ...rest };
        case "add": {
          const removed = [...s.removed];
          const isComposite = u.trayIndex < 0 && (u.id in s.stacks || u.id in s.sheets);
          removed.splice(Math.min(u.trayIndex, removed.length), 0, { id: u.id, index: s.order.indexOf(u.id) });
          const stacks = { ...s.stacks };
          if (isComposite) {
            delete stacks[u.id];
            const sheets = { ...s.sheets };
            delete sheets[u.id];
            const included = { ...s.included };
            const faces = { ...s.faces };
            const sizes = { ...s.sizes };
            const tileKinds = { ...s.tileKinds };
            delete included[u.id];
            delete faces[u.id];
            delete sizes[u.id];
            delete tileKinds[u.id];
            return { ...s, ...rest, order: s.order.filter((x) => x !== u.id), included, faces, sizes, tileKinds, stacks, sheets };
          }
          return { ...s, ...rest, order: s.order.filter((x) => x !== u.id), removed };
        }
        case "preset":
          return {
            ...s,
            ...rest,
            preset: u.preset,
            order: [...u.order],
            included: { ...u.included },
            removed: u.removed.map((item) => ({ ...item })),
          };
      }
      return s;
    }
    case "reorder": {
      const order = reordered(s.order, a.from, a.to);
      if (!order) return s;
      return { ...s, order, undoStack: [...s.undoStack, { kind: "order", id: s.order[a.from], order: s.order }] };
    }
    case "move": {
      const i = s.order.indexOf(a.id);
      return i < 0 ? s : boardReducer(s, { type: "reorder", from: i, to: i + a.dir });
    }
    case "resize": {
      const prev = s.sizes[a.id];
      if (prev === undefined || prev === a.size) return s;
      return { ...s, sizes: { ...s.sizes, [a.id]: a.size }, undoStack: [...s.undoStack, { kind: "size", id: a.id, size: prev }] };
    }
    case "columns":
      if (s.columns === a.columns) return s;
      return { ...s, columns: a.columns, undoStack: [...s.undoStack, { kind: "columns", columns: s.columns }] };
    case "a05Filter": {
      const filter = normalizeA05Filter(a.filter);
      const a05Filter = { ...s.a05Filter };
      if (filter) a05Filter[a.id] = filter;
      else delete a05Filter[a.id];
      return { ...s, a05Filter };
    }
    case "view":
      return { ...s, view: { ...s.view, [a.id]: a.face } };
    case "viewAll":
      return { ...s, viewAll: a.face, view: {} };
    case "stack": {
      const layers = [...new Set(a.layers)].filter((id) => s.order.includes(id));
      if (layers.length < 2 || layers.some((id) => !stackable(s, id) || Object.values(s.stacks).some((stack) => stack.includes(id)))) return s;
      let number = Object.keys(s.stacks).length + 1;
      while (s.stacks[`stack:${number}`]) number += 1;
      const id = `stack:${number}`;
      return {
        ...s,
        order: [...s.order, id],
        included: { ...s.included, [id]: true },
        faces: { ...s.faces, [id]: "front" },
        sizes: { ...s.sizes, [id]: 1 },
        tileKinds: { ...s.tileKinds, [id]: "stack" },
        stacks: { ...s.stacks, [id]: layers },
        undoStack: [...s.undoStack, { kind: "add", id, trayIndex: -1 }],
      };
    }
    case "unstack": {
      if (!(a.id in s.stacks)) return s;
      const stacks = { ...s.stacks };
      delete stacks[a.id];
      const included = { ...s.included };
      const faces = { ...s.faces };
      const sizes = { ...s.sizes };
      const tileKinds = { ...s.tileKinds };
      delete included[a.id];
      delete faces[a.id];
      delete sizes[a.id];
      delete tileKinds[a.id];
      return { ...s, order: s.order.filter((id) => id !== a.id), included, faces, sizes, tileKinds, stacks };
    }
    case "sheet": {
      const capacity = sheetCapacity(a.grid);
      const tiles = [...new Set(a.tiles)].filter((id) => s.order.includes(id));
      if (tiles.length < 2 || tiles.length > capacity || tiles.some((id) => id in s.sheets)) return s;
      let number = Object.keys(s.sheets).length + 1;
      while (s.sheets[`sheet:${number}`]) number += 1;
      const id = `sheet:${number}`;
      return {
        ...s,
        order: [...s.order, id],
        included: { ...s.included, [id]: true },
        faces: { ...s.faces, [id]: "front" },
        sizes: { ...s.sizes, [id]: 1 },
        tileKinds: { ...s.tileKinds, [id]: "stack" },
        sheets: { ...s.sheets, [id]: { tiles, grid: a.grid } },
        undoStack: [...s.undoStack, { kind: "add", id, trayIndex: -1 }],
      };
    }
    case "unsheet": {
      if (!(a.id in s.sheets)) return s;
      const sheets = { ...s.sheets };
      delete sheets[a.id];
      const included = { ...s.included };
      const faces = { ...s.faces };
      const sizes = { ...s.sizes };
      const tileKinds = { ...s.tileKinds };
      delete included[a.id];
      delete faces[a.id];
      delete sizes[a.id];
      delete tileKinds[a.id];
      return { ...s, order: s.order.filter((id) => id !== a.id), included, faces, sizes, tileKinds, sheets };
    }
    case "camera":
      if (!isCameraPreset(a.camera)) return s;
      return { ...s, cameras: { ...s.cameras, [a.id]: { ...a.camera } } };
    case "cut":
      if (!isCutSpec(a.cut)) return s;
      return { ...s, cuts: { ...s.cuts, [a.id]: a.cut } };
    case "cuts": {
      if (typeof a.cuts === "number" && a.cuts !== 1 && a.cuts !== 3) return s;
      const cut = typeof a.cuts === "number" ? legacyCutForId(a.id, a.cuts, s.instances) : a.cuts;
      if (!cut || !isCutSpec(cut)) return s;
      return { ...s, cuts: { ...s.cuts, [a.id]: cut } };
    }
    case "roseSeason":
      if (a.season !== "annual" && a.season !== "spring" && a.season !== "summer" && a.season !== "autumn" && a.season !== "winter") return s;
      const cut = legacyCutForSeason(a.id, a.season, s.instances);
      return cut ? { ...s, cuts: { ...s.cuts, [a.id]: cut } } : s;
    case "pinLabel": {
      if (!a.key) return s;
      const current = s.labels[a.id] ?? [];
      const labels = current.some((label) => label.key === a.key)
        ? current.map((label) => label.key === a.key ? { ...label, on: true } : label)
        : [...current, { key: a.key, on: true }];
      return { ...s, labels: { ...s.labels, [a.id]: labels } };
    }
    case "unpinLabel": {
      const current = s.labels[a.id] ?? [];
      const labels = current.filter((label) => label.key !== a.key);
      if (labels.length === current.length) return s;
      const next = { ...s.labels };
      if (labels.length > 0) next[a.id] = labels;
      else delete next[a.id];
      return { ...s, labels: next };
    }
    case "toggleLabel": {
      if (!a.key) return s;
      const current = s.labels[a.id] ?? [];
      const found = current.some((label) => label.key === a.key);
      const labels = found
        ? current.map((label) => label.key === a.key ? { ...label, on: !label.on } : label)
        : [...current, { key: a.key, on: true }];
      return { ...s, labels: { ...s.labels, [a.id]: labels } };
    }
    case "setAllLabels": {
      const current = s.labels[a.id] ?? [];
      if (current.length === 0) return s;
      return { ...s, labels: { ...s.labels, [a.id]: current.map((label) => ({ ...label, on: a.on })) } };
    }
    case "mapLabels":
      return { ...s, mapLabels: { ...s.mapLabels, [a.id]: a.show } };
    case "layer": {
      if (!a.layer) return s;
      const result = s.results.find((candidate) => candidate.tileId === sourceTileId(s, a.id));
      const normalizedLayerId = result ? normalizeLayerId(result.tileCode, a.layer) : a.layer;
      if (result && !layerOptionsForResult(result).some((option) => option.id === normalizedLayerId)) return s;
      return { ...s, layers: { ...s.layers, [a.id]: normalizedLayerId } };
    }
    case "terrainSection":
      if (a.section !== "A" && a.section !== "B") return s;
      return { ...s, terrainSection: { ...s.terrainSection, [a.id]: a.section } };
  }
}

export type BoardStateSnapshot = {
  version: number;
  /** v2 이전 저장본에는 없으며, 없으면 전체로 이관한다. */
  preset?: PresetId;
  order: string[];
  included: Record<string, boolean>;
  faces: Record<string, OutputFace>;
  callout: Record<string, CalloutMode>;
  a05Filter: Record<string, A05Filter>;
  view: Record<string, CardFace>;
  viewAll: CardFace;
  columns: GridColumns;
  sizes: Record<string, TileSize>;
  tileKinds: Record<string, TileResult["tileType"]>;
  stacks: Record<string, string[]>;
  sheets: Record<string, SheetSpec>;
  cameras: Record<string, CameraPreset>;
  cuts: Record<string, LegacyCutSpec>;
  /** W1에서만 존재한 D22 필드. v3에서는 cuts로 이관하고 다시 저장하지 않는다. */
  roseSeasons?: Record<string, RoseSeason>;
  labels?: Record<string, PinnedLabel[]>;
  layers?: Record<string, string>;
  /** 카드 지도 자동 라벨 표시. 이전 저장본에는 없고 기본 false로 복원한다. */
  mapLabels?: Record<string, boolean>;
  /** D17 수치지형도 단면 선택. 이전 저장본에는 없다. */
  terrainSection?: Record<string, TerrainSectionId>;
  /** copy:N → 원본 결과 타일 id. 이전 저장본에는 없다. */
  instances?: Record<string, string>;
  /** 페이지별 보고서 설정. 기존 저장본에는 없다. */
  report?: ReportState;
  /** v4 보고서 모드 문서. v3 이하 저장본에는 없다. */
  reportDoc?: ReportDoc;
  removed: { id: string; index: number }[];
};

/** 프로젝트/브라우저 저장용 보드 설정. 분석 결과와 undo 기록은 현재 결과에 다시 붙인다. */
export function serializeBoardState(s: BoardState): BoardStateSnapshot {
  const a05Filter: Record<string, A05Filter> = {};
  for (const [id, filter] of Object.entries(s.a05Filter)) {
    const normalized = normalizeA05Filter(filter);
    if (normalized) a05Filter[id] = normalized;
  }
  return {
    version: BOARD_STATE_VERSION,
    preset: s.preset,
    order: [...s.order],
    included: { ...s.included },
    faces: { ...s.faces },
    callout: { ...s.callout },
    a05Filter,
    view: { ...s.view },
    viewAll: s.viewAll,
    columns: s.columns,
    sizes: { ...s.sizes },
    tileKinds: { ...s.tileKinds },
    stacks: Object.fromEntries(Object.entries(s.stacks).map(([id, layers]) => [id, [...layers]])),
    sheets: Object.fromEntries(Object.entries(s.sheets).map(([id, spec]) => [id, { tiles: [...spec.tiles], grid: spec.grid }])),
    cameras: Object.fromEntries(Object.entries(s.cameras).map(([id, camera]) => [id, { ...camera }])),
    cuts: { ...s.cuts },
    labels: Object.fromEntries(Object.entries(s.labels).map(([id, labels]) => [id, labels.map((label) => ({ ...label }))])),
    layers: { ...s.layers },
    mapLabels: { ...s.mapLabels },
    terrainSection: { ...s.terrainSection },
    instances: { ...s.instances },
    report: cloneReport(s.report),
    reportDoc: cloneReportDoc(s.reportDoc),
    removed: s.removed.map((item) => ({ ...item })),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const unique = (values: readonly string[]) => [...new Set(values)];
const isOutputFace = (value: unknown): value is OutputFace => value === "front" || value === "back" || value === "both";
const isCalloutMode = (value: unknown): value is CalloutMode => value === "overview" || value === "top10" || value === "all";
const isCardFace = (value: unknown): value is CardFace => value === "summary" || value === "map";
const isTerrainSection = (value: unknown): value is TerrainSectionId => value === "A" || value === "B";
const isTileSize = (value: unknown): value is TileSize => value === 1 || value === 2 || value === 4;
const isGridColumns = (value: unknown): value is GridColumns => value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
const isSheetGrid = (value: unknown): value is SheetGrid => value === "2x2" || value === "3x2" || value === "3x1";
const isTileKind = (value: unknown): value is TileResult["tileType"] => value === "analysis" || value === "diagram" || value === "simulation" || value === "stack";

const isReportFormat = (value: unknown): value is ReportDoc["format"] => value === "wide" || value === "a3" || value === "a4";
const isReportLayout = (value: unknown): value is ReportPage["layout"] => value === "map-full" || value === "map-summary" || value === "numbers-first" || value === "side-by-side";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const reportTileIdPattern = /^(?:[A-Za-z0-9._]+-)+[A-Za-z0-9_]+$/;
const reportPageIdPattern = /^\S+$/;

function isReportTileId(value: unknown, validTileIds: ReadonlySet<string>): value is string {
  return typeof value === "string" && value.length > 0 && reportPageIdPattern.test(value) && (validTileIds.has(value) || reportTileIdPattern.test(value));
}

function reportPanels(value: unknown): PagePanels {
  return normalizePagePanels(value) ?? {};
}

function reportTextBoxes(value: unknown): ReportPage["textBoxes"] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0 || !reportPageIdPattern.test(item.id) || ids.has(item.id)
      || !isFiniteNumber(item.x) || !isFiniteNumber(item.y) || !isFiniteNumber(item.w) || !isFiniteNumber(item.h)
      || typeof item.text !== "string" || !isFiniteNumber(item.pt)) return [];
    ids.add(item.id);
    const kind = item.kind === "title" || item.kind === "body" || item.kind === "note" ? item.kind as TextBoxKind : undefined;
    const align = item.align === "left" || item.align === "center" ? item.align as TextBoxAlign : undefined;
    const color = typeof item.color === "string" && (TEXT_BOX_COLORS as readonly string[]).includes(item.color) ? item.color as typeof TEXT_BOX_COLORS[number] : undefined;
    return [{
      id: item.id,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      text: item.text,
      pt: item.pt,
      ...(kind ? { kind } : {}),
      ...(typeof item.bold === "boolean" ? { bold: item.bold } : {}),
      ...(typeof item.italic === "boolean" ? { italic: item.italic } : {}),
      ...(color ? { color } : {}),
      ...(align ? { align } : {}),
    }];
  });
}

function reportSettings(value: unknown): TileReportSettings {
  const raw = isRecord(value) ? value : {};
  const settings: TileReportSettings = {
    face: isOutputFace(raw.face) ? raw.face : "front",
    callout: isCalloutMode(raw.callout) ? raw.callout : DEFAULT_CALLOUT_MODE,
  };
  if (isCutSpec(raw.cut)) settings.cut = { ...raw.cut } as CutSpec;
  if (isCameraPreset(raw.camera as CameraPreset)) settings.camera = { ...(raw.camera as CameraPreset) };
  const filter = isRecord(raw.a05Filter) ? normalizeA05Filter(raw.a05Filter as A05Filter) : null;
  if (filter) settings.a05Filter = copyA05Filter(filter);
  if (typeof raw.layer === "string" && raw.layer.length > 0) settings.layer = raw.layer;
  if (Array.isArray(raw.labels)) {
    const seen = new Set<string>();
    const labels = raw.labels.flatMap((item) => {
      if (!isRecord(item) || typeof item.key !== "string" || item.key.length === 0 || typeof item.on !== "boolean" || seen.has(item.key)) return [];
      seen.add(item.key);
      return [{ key: item.key, on: item.on }];
    });
    if (labels.length > 0) settings.labels = labels;
  }
  if (isTerrainSection(raw.terrainSection)) settings.terrainSection = raw.terrainSection;
  return settings;
}

function reportFrame(value: unknown): MapFrameState {
  const frame = defaultFrame();
  if (!isRecord(value)) return frame;
  if (isFiniteNumber(value.zoomDelta)) frame.zoomDelta = value.zoomDelta;
  if (Array.isArray(value.offsetM) && value.offsetM.length === 2 && isFiniteNumber(value.offsetM[0]) && isFiniteNumber(value.offsetM[1])) {
    frame.offsetM = [value.offsetM[0], value.offsetM[1]];
  }
  if (value.scaleDenominator === null) frame.scaleDenominator = null;
  else if (isFiniteNumber(value.scaleDenominator) && value.scaleDenominator > 0) frame.scaleDenominator = value.scaleDenominator;
  if (typeof value.locked === "boolean") frame.locked = value.locked;
  if (value.basemap === "base" || value.basemap === "road" || value.basemap === "air" || value.basemap === "none") frame.basemap = value.basemap;
  if (Array.isArray(value.hiddenLayers)) frame.hiddenLayers = unique(stringsOf(value.hiddenLayers));
  if (value.labelRule === "site-near" || value.labelRule === "all-visible" || value.labelRule === "off") frame.labelRule = value.labelRule;
  if (Array.isArray(value.pinnedKeys)) frame.pinnedKeys = unique(stringsOf(value.pinnedKeys));
  const legacyHidden = isRecord(value.legend) && Array.isArray(value.legend.hidden) ? unique(stringsOf(value.legend.hidden)) : [];
  if (Array.isArray(value.hiddenLabelKeys)) frame.hiddenLabelKeys = unique(stringsOf(value.hiddenLabelKeys));
  else frame.hiddenLabelKeys = legacyHidden.filter((key) => key.includes("|"));
  if (Array.isArray(value.deletedElementKeys)) frame.deletedElementKeys = unique(stringsOf(value.deletedElementKeys));
  if (isRecord(value.labelBoxes)) {
    frame.labelBoxes = Object.fromEntries(Object.entries(value.labelBoxes).flatMap(([key, rawBox]) => {
      if (!isRecord(rawBox) || !isFiniteNumber(rawBox.x) || !isFiniteNumber(rawBox.y) || !isFiniteNumber(rawBox.w) || !isFiniteNumber(rawBox.h)) return [];
      return [[key, normalizeMapLabelBox({ x: rawBox.x, y: rawBox.y, w: rawBox.w, h: rawBox.h })]];
    }));
  }
  if (isRecord(value.legend)) {
    frame.legend = {
      ...frame.legend,
      ...(Array.isArray(value.legend.order) ? { order: unique(stringsOf(value.legend.order)) } : {}),
      ...(Array.isArray(value.legend.hidden) ? { hidden: unique(stringsOf(value.legend.hidden).filter((key) => !key.includes("|"))) } : {}),
      ...(typeof value.legend.visibleOnly === "boolean" ? { visibleOnly: value.legend.visibleOnly } : {}),
      ...(value.legend.placement === "below" || value.legend.placement === "right" || value.legend.placement === "hidden" ? { placement: value.legend.placement } : {}),
    };
  }
  if (isRecord(value.decorations)) {
    frame.decorations = {
      ...frame.decorations,
      ...(typeof value.decorations.north === "boolean" ? { north: value.decorations.north } : {}),
      ...(typeof value.decorations.scaleBar === "boolean" ? { scaleBar: value.decorations.scaleBar } : {}),
      ...(typeof value.decorations.locator === "boolean" ? { locator: value.decorations.locator } : {}),
    };
  }
  return frame;
}

function reportPart(value: unknown): TilePart | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "single" || value.type === "cutSingle") return { type: value.type };
  if (value.type === "face" && (value.face === "front" || value.face === "back")) return { type: "face", face: value.face };
  if (value.type === "callout" && Number.isInteger(value.page) && (value.page as number) >= 0) {
    const hasShownKeys = Object.prototype.hasOwnProperty.call(value, "shownKeys");
    const hasFilter = Object.prototype.hasOwnProperty.call(value, "filter");
    return {
      type: "callout",
      page: value.page as number,
      ...(hasShownKeys ? { shownKeys: unique(stringsOf(value.shownKeys)).slice(0, 10) } : {}),
      ...(hasFilter ? { filter: isRecord(value.filter) ? normalizeA05Filter(value.filter as A05Filter) : null } : {}),
    };
  }
  if (value.type === "cutSheet" && Number.isInteger(value.index) && (value.index as number) >= 0) return { type: "cutSheet", index: value.index as number };
  return null;
}

function reportPageElements(value: unknown): PageElementKey[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key): key is PageElementKey => typeof key === "string" && (PAGE_ELEMENT_KEYS as readonly string[]).includes(key)))];
}

type RestoreReportDocOptions = {
  /** 내부 복제·마이그레이션에서는 새 선택적 필드를 구 저장 문서에 덧붙이지 않는다. */
  preserveMissingPageElementKeys?: boolean;
};

function restoreReportPage(value: unknown, validTileIds: ReadonlySet<string>, options: RestoreReportDocOptions = {}): ReportPage | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0 || !reportPageIdPattern.test(value.id) || !isReportLayout(value.layout)) return null;
  const fontSizes = clampReportFontSizes(value.fontSizes);
  const layout = value.kind === "tile" && value.layout === "side-by-side" ? "map-summary" : value.layout;
  const base = {
    id: value.id,
    layout,
    panels: reportPanels(value.panels),
    textBoxes: reportTextBoxes(value.textBoxes),
    notes: typeof value.notes === "string" ? value.notes : "",
    ...(options.preserveMissingPageElementKeys && !Object.prototype.hasOwnProperty.call(value, "deletedElementKeys")
      ? {}
      : { deletedElementKeys: reportPageElements(value.deletedElementKeys) }),
    ...(typeof value.titleOverride === "string" ? { titleOverride: value.titleOverride } : {}),
    ...(typeof value.summaryOverride === "string" ? { summaryOverride: value.summaryOverride } : {}),
    ...(Object.keys(fontSizes).length > 0 ? { fontSizes } : {}),
  };
  if (value.kind === "cover" || value.kind === "sources" || value.kind === "blank") return { ...base, kind: value.kind };
  if (value.kind === "tile") {
    const part = reportPart(value.part);
    if (!part || !isReportTileId(value.tileId, validTileIds)) return null;
    return { ...base, kind: "tile", tileId: value.tileId, part, settings: reportSettings(value.settings), frame: reportFrame(value.frame) };
  }
  if (value.kind === "compare" && (value.grid === "2x2" || value.grid === "3x2" || value.grid === "3x1")) {
    const cells = Array.isArray(value.cells)
      ? value.cells.map((item) => {
          if (!isRecord(item) || !isReportTileId(item.tileId, validTileIds)) return null;
          const panels = reportPanels(item.panels);
          return { tileId: item.tileId, settings: reportSettings(item.settings), frame: reportFrame(item.frame), ...(Object.keys(panels).length > 0 ? { panels } : {}) };
        })
      : [];
    return { ...base, kind: "compare", grid: value.grid, cells, sameExtent: typeof value.sameExtent === "boolean" ? value.sameExtent : false };
  }
  return null;
}

/** 보고서 문서를 안전하게 복원한다. 현재 결과에 없는 형식상 유효한 타일 id도 페이지를 남긴다. */
export function restoreReportDoc(value: unknown, validTileIds: ReadonlySet<string>, options: RestoreReportDocOptions = {}): ReportDoc {
  const raw = typeof value === "string" ? rawSnapshot(value) : isRecord(value) ? value : null;
  if (!raw || raw.v !== 1) return { ...EMPTY_REPORT_DOC, pages: [] };
  const ids = new Set<string>();
  const pages = Array.isArray(raw.pages)
    ? raw.pages.flatMap((item) => {
        const page = restoreReportPage(item, validTileIds, options);
        if (!page || ids.has(page.id)) return [];
        ids.add(page.id);
        return [page];
      })
    : [];
  const legacyFontSizes = reportFontSizesFromLegacyScale(raw.fontScale);
  const fontSizes = { ...(legacyFontSizes ?? {}), ...clampReportFontSizes(raw.fontSizes) };
  return {
    v: 1,
    format: isReportFormat(raw.format) ? raw.format : "wide",
    pages,
    ...(Object.keys(fontSizes).length > 0 ? { fontSizes } : {}),
  };
}

function cloneReportDoc(doc: ReportDoc): ReportDoc {
  return restoreReportDoc(doc, new Set(), { preserveMissingPageElementKeys: true });
}

function normalizePageStyle(value: unknown): PageStyle | null {
  if (!isRecord(value)) return null;
  const style: PageStyle = {};
  for (const field of PAGE_STYLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const normalized = pageStyleValue(field, value[field]);
    if (normalized) Object.assign(style, normalized);
  }
  return Object.keys(style).length > 0 ? style : null;
}

function normalizeReport(value: unknown): ReportState {
  const raw = isRecord(value) ? value : {};
  const styles: Record<PageKey, PageStyle> = {};
  for (const [key, style] of Object.entries(recordOf(raw.styles))) {
    if (!key) continue;
    const normalized = normalizePageStyle(style);
    if (normalized) styles[key] = normalized;
  }
  const extra: ExtraReportPage[] = [];
  const ids = new Set<string>();
  if (Array.isArray(raw.extra)) {
    for (const value of raw.extra) {
      if (!isRecord(value)) continue;
      const id = typeof value.id === "string" && value.id.length > 0 ? value.id : null;
      const after = value.after === null || typeof value.after === "string" ? value.after : null;
      const tileId = typeof value.tileId === "string" && value.tileId.length > 0 ? value.tileId : null;
      const face = value.face === "front" || value.face === "back" ? value.face : null;
      const rawSheet = isRecord(value.sheet) ? value.sheet : null;
      const grid = rawSheet && isSheetGrid(rawSheet.grid) ? rawSheet.grid : null;
      const rawSheetTiles = rawSheet && Array.isArray(rawSheet.tiles) ? rawSheet.tiles : null;
      const sheetTiles = rawSheetTiles && grid
        ? Array.from({ length: sheetCapacity(grid) }, (_, index) => typeof rawSheetTiles[index] === "string" ? rawSheetTiles[index] as string : "")
        : null;
      const sheet = grid && sheetTiles ? { grid, tiles: sheetTiles } : null;
      if (!id || ids.has(id) || face === null || (!sheet && tileId === null)) continue;
      ids.add(id);
      extra.push({ id, after, tileId: sheet ? "" : tileId!, face, ...(sheet ? { sheet } : {}) });
    }
  }
  return { styles, extra };
}

function restoreReport(value: unknown, validTileIds: ReadonlySet<string>): ReportState {
  const normalized = normalizeReport(value);
  const extra: ExtraReportPage[] = [];
  const ids = new Set<string>();
  for (const page of normalized.extra) {
    if (ids.has(page.id)) continue;
    if (page.sheet) {
      ids.add(page.id);
      extra.push({
        ...page,
        tileId: "",
        sheet: { grid: page.sheet.grid, tiles: page.sheet.tiles.map((tileId) => tileId && validTileIds.has(tileId) ? tileId : "") },
      });
      continue;
    }
    if (!validTileIds.has(page.tileId)) continue;
    ids.add(page.id);
    extra.push({ ...page });
  }
  const styles: Record<PageKey, PageStyle> = {};
  for (const [key, style] of Object.entries(normalized.styles)) {
    if (key.startsWith("extra:") && !ids.has(key.slice("extra:".length))) continue;
    styles[key] = clonePageStyle(style);
  }
  return { styles, extra };
}

function rawSnapshot(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(raw) ? raw : null;
}

export function renameTileId(id: string): string {
  const direct = TILE_CODE_RENAMES[id];
  if (direct) return direct;
  const separator = id.lastIndexOf("-");
  if (separator < 0) return id;
  const code = id.slice(separator + 1);
  const renamed = TILE_CODE_RENAMES[code];
  return renamed ? `${id.slice(0, separator + 1)}${renamed}` : id;
}

type IdMapper = (id: string) => string;

function rewritePageKey(key: string | null, mapId: IdMapper): string | null {
  if (key === null || key === "cover" || key.startsWith("sources:") || key.startsWith("extra:")) return key;
  const separator = key.indexOf(":");
  const tileId = separator < 0 ? key : key.slice(0, separator);
  const mapped = mapId(tileId);
  return separator < 0 ? mapped : `${mapped}${key.slice(separator)}`;
}

function rewriteReportDocIds(value: ReportDoc | undefined, mapId: IdMapper): ReportDoc | undefined {
  if (!value) return undefined;
  const doc = restoreReportDoc(value, new Set(), { preserveMissingPageElementKeys: true });
  return {
    ...doc,
    pages: doc.pages.map((page) => page.kind === "tile"
      ? { ...page, tileId: mapId(page.tileId) }
      : page.kind === "compare"
        ? { ...page, cells: page.cells.map((cell) => cell ? { ...cell, tileId: mapId(cell.tileId) } : null) }
        : page),
  };
}

function mapIdRecord<T>(value: unknown, mapId: IdMapper): Record<string, T> {
  const output: Record<string, T> = {};
  for (const [id, item] of Object.entries(recordOf(value))) {
    const mapped = mapId(id);
    if (!(mapped in output)) output[mapped] = item as T;
  }
  return output;
}

function codeFromTileId(id: string, instances: Readonly<Record<string, string>> = {}): string {
  const sourceId = sourceTileIdFromInstances(instances, id);
  const separator = sourceId.lastIndexOf("-");
  return separator < 0 ? sourceId : sourceId.slice(separator + 1);
}

function migratedLayer(id: string, value: string, instances: Readonly<Record<string, string>> = {}): string {
  return LEGACY_LAYER_RENAMES[codeFromTileId(id, instances)] ?? value;
}

/** Snapshot 안에서 id를 보관하는 모든 필드를 같은 규칙으로 다시 쓴다. */
export function rewriteSnapshotIds(snapshot: BoardStateSnapshot, mapId: IdMapper): BoardStateSnapshot {
  const stacks: Record<string, string[]> = {};
  for (const [id, layers] of Object.entries(recordOf(snapshot.stacks))) {
    const mapped = mapId(id);
    stacks[mapped] = unique([...(stacks[mapped] ?? []), ...stringsOf(layers).map(mapId)]);
  }
  const sheets: Record<string, SheetSpec> = {};
  for (const [id, spec] of Object.entries(recordOf(snapshot.sheets))) {
    if (!isRecord(spec)) continue;
    const mapped = mapId(id);
    const previous = sheets[mapped];
    sheets[mapped] = {
      tiles: unique([...(previous?.tiles ?? []), ...stringsOf(spec.tiles).map(mapId)]),
      grid: previous?.grid ?? spec.grid as SheetGrid,
    };
  }
  const layers: Record<string, string> = {};
  for (const [id, value] of Object.entries(recordOf(snapshot.layers))) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const mapped = mapId(id);
    // D06/D07처럼 한 survivor로 충돌하는 경우 첫 명시 선택을 유지한다.
    if (!(mapped in layers)) layers[mapped] = migratedLayer(id, value, snapshot.instances);
  }
  const instances: Record<string, string> = {};
  for (const [id, sourceId] of Object.entries(recordOf(snapshot.instances))) {
    if (!COPY_ID.test(id) || typeof sourceId !== "string") continue;
    const mapped = mapId(id);
    if (!(mapped in instances)) instances[mapped] = mapId(sourceId);
  }
  const report = normalizeReport(snapshot.report);
  const reportStyles: Record<PageKey, PageStyle> = {};
  for (const [key, style] of Object.entries(report.styles)) {
    const mappedKey = rewritePageKey(key, mapId)!;
    if (!(mappedKey in reportStyles)) reportStyles[mappedKey] = style;
  }
  return {
    ...snapshot,
    order: unique(stringsOf(snapshot.order).map(mapId)),
    included: mapIdRecord<boolean>(snapshot.included, mapId),
    faces: mapIdRecord<OutputFace>(snapshot.faces, mapId),
    callout: mapIdRecord<CalloutMode>(snapshot.callout, mapId),
    a05Filter: mapIdRecord<A05Filter>(snapshot.a05Filter, mapId),
    view: mapIdRecord<CardFace>(snapshot.view, mapId),
    sizes: mapIdRecord<TileSize>(snapshot.sizes, mapId),
    tileKinds: mapIdRecord<TileResult["tileType"]>(snapshot.tileKinds, mapId),
    stacks,
    sheets,
    cameras: mapIdRecord<CameraPreset>(snapshot.cameras, mapId),
    cuts: mapIdRecord<LegacyCutSpec>(snapshot.cuts, mapId),
    roseSeasons: mapIdRecord<RoseSeason>(snapshot.roseSeasons, mapId),
    labels: mapIdRecord<PinnedLabel[]>(snapshot.labels, mapId),
    layers,
    mapLabels: mapIdRecord<boolean>(snapshot.mapLabels, mapId),
    terrainSection: mapIdRecord<TerrainSectionId>(snapshot.terrainSection, mapId),
    instances,
    reportDoc: rewriteReportDocIds(snapshot.reportDoc, mapId),
    report: {
      styles: reportStyles,
      extra: report.extra.map((page) => page.sheet
        ? { ...page, after: rewritePageKey(page.after, mapId), tileId: "", sheet: { grid: page.sheet.grid, tiles: page.sheet.tiles.map((tileId) => tileId ? mapId(tileId) : "") } }
        : { ...page, after: rewritePageKey(page.after, mapId), tileId: mapId(page.tileId) }),
    },
    removed: Array.isArray(snapshot.removed)
      ? (() => {
          const seen = new Set<string>();
          return snapshot.removed
            .filter((item): item is { id: string; index: number } => !!item && typeof item.id === "string" && typeof item.index === "number")
            .map((item) => ({ ...item, id: mapId(item.id) }))
            .filter((item) => !seen.has(item.id) && (seen.add(item.id), true));
        })()
      : [],
  };
}

function migrateV1ToV2(snapshot: BoardStateSnapshot): BoardStateSnapshot {
  return { ...snapshot, layers: recordOf(snapshot.layers) as Record<string, string> };
}

function codeFromTileIdForCut(id: string, instances: Readonly<Record<string, string>> = {}): string {
  return codeFromTileId(id, instances);
}

export function defaultCutForCode(code: string): CutSpec | null {
  const moduleDefault = tileClientModuleFor(code)?.cut?.default?.();
  if (moduleDefault && isRecord(moduleDefault)) return moduleDefault as CutSpec;
  return null;
}

function legacyCutForId(id: string, value: CutCount, instances: Readonly<Record<string, string>> = {}): CutSpec | null {
  return tileClientModuleFor(codeFromTileIdForCut(id, instances))?.cut?.legacyForCount?.(value) as CutSpec | null ?? null;
}

function legacyCutForSeason(id: string, value: RoseSeason, instances: Readonly<Record<string, string>> = {}): CutSpec | null {
  return tileClientModuleFor(codeFromTileIdForCut(id, instances))?.cut?.legacyForSeason?.(value) as CutSpec | null ?? null;
}

const isSeason = (value: unknown): value is Season => value === "spring" || value === "summer" || value === "autumn" || value === "winter";

export function isCutSpec(value: unknown): value is CutSpec {
  if (!isRecord(value) || typeof value.tile !== "string" || typeof value.mode !== "string") return false;
  const moduleValidator = tileClientModuleFor(value.tile)?.cut?.isValid;
  return moduleValidator ? moduleValidator(value) : false;
}

function migrateV2ToV3(snapshot: BoardStateSnapshot): BoardStateSnapshot {
  const cuts: Record<string, CutSpec> = {};
  for (const [id, value] of Object.entries(recordOf(snapshot.cuts))) {
    const code = codeFromTileIdForCut(id, snapshot.instances);
    if (typeof value === "number" && (value === 1 || value === 3)) {
      const legacy = legacyCutForId(id, value, snapshot.instances);
      if (legacy) cuts[id] = legacy;
    } else if (isCutSpec(value) && value.tile === code) {
      cuts[id] = value;
    }
  }
  for (const [id, value] of Object.entries(recordOf(snapshot.roseSeasons))) {
    if ((!isSeason(value) && value !== "annual") || id in cuts) continue;
    const legacy = legacyCutForSeason(id, value, snapshot.instances);
    if (legacy) cuts[id] = legacy;
  }
  const migrated = { ...snapshot, cuts, version: 3 } as BoardStateSnapshot;
  delete migrated.roseSeasons;
  return migrated;
}

function migrateV3ToV4(snapshot: BoardStateSnapshot): BoardStateSnapshot {
  return {
    ...snapshot,
    reportDoc: snapshot.reportDoc ?? { ...EMPTY_REPORT_DOC, pages: [] },
    version: BOARD_STATE_VERSION,
  };
}

/** 저장본 버전을 단계별로 현재 버전까지 올린다. 미래 버전은 호출자가 기본 보드로 처리한다. */
export function migrateSnapshot(raw: unknown): BoardStateSnapshot | null {
  const saved = rawSnapshot(raw);
  if (!saved) return null;
  const version = saved.version === undefined ? 1 : typeof saved.version === "number" && Number.isInteger(saved.version) ? saved.version : null;
  if (version === null || version < 1 || version > BOARD_STATE_VERSION) return null;
  let migrated = saved as unknown as BoardStateSnapshot;
  if (version === 1) migrated = migrateV1ToV2(migrated);
  migrated = rewriteSnapshotIds(migrated, renameTileId);
  if (version <= 2) migrated = migrateV2ToV3(migrated);
  if (version <= 3) migrated = migrateV3ToV4(migrated);
  // 열 수는 컷 이관과 같은 v3에서 생겼다 — 컷만 가진 v3 저장본도 기본 4열로 읽는다. 프리셋이 없으면 '전체'.
  return {
    ...migrated,
    columns: isGridColumns(migrated.columns) ? migrated.columns : 4,
    preset: isPresetId(migrated.preset) ? migrated.preset : DEFAULT_PRESET_ID,
    report: normalizeReport(migrated.report),
    reportDoc: restoreReportDoc(migrated.reportDoc, new Set(), { preserveMissingPageElementKeys: true }),
    version: BOARD_STATE_VERSION,
  };
}

function mergeReportState(serverReport: ReportState, localReport: ReportState): ReportState {
  const extra = new Map(serverReport.extra.map((page) => [page.id, page]));
  for (const page of localReport.extra) extra.set(page.id, page);
  return {
    styles: { ...serverReport.styles, ...localReport.styles },
    extra: [...extra.values()],
  };
}

/** 서버 저장본과 브라우저 임시 저장본을 합쳐 새로고침 뒤에도 편집 중인 보고서를 복원한다. */
export function selectBoardSnapshotForLoad(serverRaw: unknown, localRaw: unknown): BoardStateSnapshot | null {
  const server = migrateSnapshot(serverRaw);
  const local = migrateSnapshot(localRaw);
  if (!server) return local;
  if (!local) return server;
  const serverPageCount = server.reportDoc?.pages.length ?? 0;
  const localPageCount = local.reportDoc?.pages.length ?? 0;
  if (localPageCount === 0 && serverPageCount > 0) return server;
  return {
    ...local,
    report: mergeReportState(server.report ?? { styles: {}, extra: [] }, local.report ?? { styles: {}, extra: [] }),
  };
}

/** 재분석으로 analysisId가 바뀐 프로젝트의 보드 배치를 새 타일 id에 연결한다. */
export function rebaseSnapshotAnalysisId(raw: unknown, fromAnalysisId: string, toAnalysisId: string): BoardStateSnapshot | null {
  const migrated = migrateSnapshot(raw);
  if (!migrated || !fromAnalysisId || !toAnalysisId || fromAnalysisId === toAnalysisId) return migrated;
  const prefix = `${fromAnalysisId}-`;
  return rewriteSnapshotIds(migrated, (id) => id.startsWith(prefix) ? `${toAnalysisId}-${id.slice(prefix.length)}` : id);
}

/** 옛 저장본(버전/필터 필드 없음 포함)을 현재 분석 결과에 안전하게 붙인다. */
export function restoreBoardState(results: TileResult[], raw: unknown, fallbackPreset: PresetId = DEFAULT_PRESET_ID): BoardState {
  const base = initBoard(results, fallbackPreset);
  const saved = migrateSnapshot(raw);
  if (!saved) return base;

  const baseIds = new Set(base.order);
  const savedInstances: Record<string, string> = {};
  const rawInstances = Object.fromEntries(Object.entries(recordOf(saved.instances)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  for (const [id, sourceId] of Object.entries(rawInstances)) {
    if (!COPY_ID.test(id) || typeof sourceId !== "string" || baseIds.has(id)) continue;
    const source = sourceTileIdFromInstances(rawInstances, sourceId);
    if (baseIds.has(source)) savedInstances[id] = source;
  }
  const validTileIds = new Set([...baseIds, ...Object.keys(savedInstances)]);
  const savedStacks: Record<string, string[]> = {};
  for (const [id, layers] of Object.entries(recordOf(saved.stacks))) {
    const valid = unique(stringsOf(layers)).filter((layer) => validTileIds.has(layer));
    if (valid.length >= 2) savedStacks[id] = valid;
  }
  const savedSheets: Record<string, SheetSpec> = {};
  for (const [id, spec] of Object.entries(recordOf(saved.sheets))) {
    if (!isRecord(spec)) continue;
    const tiles = unique(stringsOf(spec.tiles)).filter((tile) => validTileIds.has(tile));
    const grid = isSheetGrid(spec.grid) ? spec.grid : null;
    if (tiles.length >= 2 && grid) savedSheets[id] = { tiles, grid };
  }
  const compositeIds = new Set([...Object.keys(savedStacks), ...Object.keys(savedSheets)]);
  const validIds = new Set([...validTileIds, ...compositeIds]);
  const validReportTileIds = new Set([...validIds, ...results.map((result) => result.tileId)]);
  const report = restoreReport(saved.report, validReportTileIds);
  const reportDoc = restoreReportDoc(saved.reportDoc, validReportTileIds, { preserveMissingPageElementKeys: true });
  const savedOrder = unique(stringsOf(saved.order)).filter((id) => validIds.has(id));
  const order = savedOrder.length > 0 ? savedOrder : base.order;

  const included = { ...base.included };
  for (const [id, value] of Object.entries(recordOf(saved.included))) if (validIds.has(id) && typeof value === "boolean") included[id] = value;
  const faces = { ...base.faces };
  for (const [id, value] of Object.entries(recordOf(saved.faces))) if (validIds.has(id) && isOutputFace(value)) faces[id] = value;
  const callout = { ...base.callout };
  for (const [id, value] of Object.entries(recordOf(saved.callout))) if (validIds.has(id) && isCalloutMode(value)) callout[id] = value;
  const a05Filter: Record<string, A05Filter> = {};
  for (const [id, value] of Object.entries(recordOf(saved.a05Filter))) {
    if (!validIds.has(id)) continue;
    const normalized = normalizeA05Filter(isRecord(value) ? (value as A05Filter) : null);
    if (normalized) a05Filter[id] = normalized;
  }
  const view = { ...base.view };
  for (const [id, value] of Object.entries(recordOf(saved.view))) if (validIds.has(id) && isCardFace(value)) view[id] = value;
  const sizes = { ...base.sizes };
  for (const [id, value] of Object.entries(recordOf(saved.sizes))) if (validIds.has(id) && isTileSize(value)) sizes[id] = value;
  const tileKinds = { ...base.tileKinds };
  for (const [id, value] of Object.entries(recordOf(saved.tileKinds))) if (validIds.has(id) && isTileKind(value)) tileKinds[id] = value;
  for (const id of Object.keys(savedStacks)) {
    included[id] = included[id] ?? true;
    faces[id] = faces[id] ?? "front";
    sizes[id] = sizes[id] ?? 1;
    tileKinds[id] = "stack";
  }
  for (const id of Object.keys(savedSheets)) {
    included[id] = included[id] ?? true;
    faces[id] = faces[id] ?? "front";
    sizes[id] = sizes[id] ?? 1;
    tileKinds[id] = "stack";
  }
  const cameras: Record<string, CameraPreset> = {};
  for (const [id, value] of Object.entries(recordOf(saved.cameras))) if (validIds.has(id) && isRecord(value) && isCameraPreset(value as CameraPreset)) cameras[id] = { azimuthDeg: value.azimuthDeg as number, elevationDeg: value.elevationDeg as number };
  const cuts: Record<string, CutSpec> = {};
  for (const [id, value] of Object.entries(recordOf(saved.cuts))) if (validIds.has(id) && isCutSpec(value)) cuts[id] = value;
  const labels: Record<string, PinnedLabel[]> = {};
  for (const [id, value] of Object.entries(recordOf(saved.labels))) {
    if (!validTileIds.has(id) || !Array.isArray(value)) continue;
    const seen = new Set<string>();
    const restored = value.flatMap((item) => {
      if (!isRecord(item) || typeof item.key !== "string" || !item.key || typeof item.on !== "boolean" || seen.has(item.key)) return [];
      seen.add(item.key);
      return [{ key: item.key, on: item.on }];
    });
    if (restored.length > 0) labels[id] = restored;
  }
  const mapLabels: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(recordOf(saved.mapLabels))) {
    if (validTileIds.has(id) && typeof value === "boolean") mapLabels[id] = value;
  }
  const terrainSection: Record<string, TerrainSectionId> = {};
  for (const [id, value] of Object.entries(recordOf(saved.terrainSection))) {
    const result = base.results.find((candidate) => candidate.tileId === sourceTileIdFromInstances(savedInstances, id));
    if (validTileIds.has(id) && result?.tileCode === "D17" && isTerrainSection(value)) terrainSection[id] = value;
  }
  const layers: Record<string, string> = {};
  const resultById = new Map(base.results.map((result) => [result.tileId, result]));
  for (const [id, value] of Object.entries(recordOf(saved.layers))) {
    if (!validTileIds.has(id) || typeof value !== "string") continue;
    const result = resultById.get(sourceTileIdFromInstances(savedInstances, id));
    const normalizedLayerId = result ? normalizeLayerId(result.tileCode, value) : value;
    if (result && layerOptionsForResult(result).some((option) => option.id === normalizedLayerId)) layers[id] = normalizedLayerId;
  }
  const removed: { id: string; index: number }[] = [];
  const removedIds = new Set<string>();
  if (Array.isArray(saved.removed)) {
    for (const item of saved.removed) {
      if (!isRecord(item) || typeof item.id !== "string" || typeof item.index !== "number" || !baseIds.has(item.id) || order.includes(item.id) || removedIds.has(item.id)) continue;
      removedIds.add(item.id);
      removed.push({ id: item.id, index: item.index });
    }
  }

  return {
    ...base,
    preset: saved.preset ?? DEFAULT_PRESET_ID,
    order,
    included,
    faces,
    callout,
    a05Filter,
    view,
    viewAll: isCardFace(saved.viewAll) ? saved.viewAll : base.viewAll,
    columns: isGridColumns(saved.columns) ? saved.columns : base.columns,
    sizes,
    tileKinds,
    stacks: savedStacks,
    sheets: savedSheets,
    cameras,
    cuts,
    labels,
    mapLabels,
    layers,
    terrainSection,
    instances: savedInstances,
    report,
    reportDoc,
    removed,
    undoStack: [],
  };
}

function isCameraPreset(camera: CameraPreset): boolean {
  return (
    !!camera &&
    typeof camera.azimuthDeg === "number" &&
    typeof camera.elevationDeg === "number" &&
    CAMERA_PRESETS.azimuth.some((value) => value === camera.azimuthDeg) &&
    CAMERA_PRESETS.elevation.some((value) => value === camera.elevationDeg)
  );
}

function stackable(s: BoardState, id: string): boolean {
  const kind = s.tileKinds[id] ?? s.tileKinds[sourceTileId(s, id)];
  if (kind) return kind === "analysis" || kind === "diagram";
  const sourceId = sourceTileId(s, id);
  return !/(?:^|-)S\d{2}$/.test(sourceId) && !sourceId.startsWith("stack:");
}

function cutPagesForResult(result: TileResult, cut: CutSpec): number {
  if (result.status !== "complete" && result.status !== "partial") return 1;
  if (cut.tile !== result.tileCode) return 1;
  return tileClientModuleFor(cut.tile)?.cut?.pages?.(result, cut) ?? 1;
}

/**
 * 표지 1장 + 포함된 타일 + 출처 장. 출력 면 both는 2장.
 * 설명선 타일은 단지 수(complexCounts[tileId])와 설명표 설정에 따라 개요 + 설명표 장 수만큼 (report-plan과 같은 계산).
 * 추가 보고서 페이지는 여기서 한 장씩 더한다. 다음 report-plan 단계도 이 extra 규칙을 소비해야 한다.
 */
export function reportPages(s: BoardState, complexCounts: Record<string, number> = {}, sourcePages = 1): { tiles: number; pages: number } {
  let tiles = 0;
  let pages = 1 + Math.max(1, Math.floor(sourcePages)); // 표지 + 출처 장
  for (const id of s.order) {
    if (!s.included[id]) continue;
    tiles += 1;
    const result = s.results.find((candidate) => candidate.tileId === sourceTileId(s, id));
    const cut = result ? (isCutSpec(s.cuts[id]) && s.cuts[id].tile === result.tileCode ? s.cuts[id] : defaultCutForCode(result.tileCode)) : null;
    const cutPages = result && cut ? cutPagesForResult(result, cut) : 1;
    pages += id in complexCounts
      ? calloutReportPages(s.callout[id] ?? DEFAULT_CALLOUT_MODE, complexCounts[id])
      : cut && result && CUT_CODES.has(result.tileCode)
        ? cutPages
        : s.faces[id] === "both" ? 2 : 1;
  }
  pages += s.report.extra.length;
  return { tiles, pages };
}

// ── 분석 중 데모: 0.3초마다 step이 1씩 늘고, 타일은 대기 → 계산 중 → 끝 순서로 바뀐다 ──
export type DemoPhase = "pending" | "running" | "done";

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

export type TileSize = 1 | 2 | 4;
export type GridColumns = 2 | 3 | 4 | 5 | 6;
export type SheetGrid = "2x2" | "3x2";
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
  mapLegend?: boolean;
  layer?: string;
};

/** 되돌리기 한 단계. 모든 편집(순서·크기·제거·더하기)이 여기 쌓인다. */
export type UndoEntry =
  | { kind: "order"; id: string; order: string[] }
  | { kind: "size"; id: string; size: TileSize }
  | { kind: "columns"; columns: GridColumns }
  | { kind: "remove"; id: string; index: number }
  | { kind: "removeCopy"; id: string; sourceId: string; index: number; settings: TileSettingsSnapshot }
  | { kind: "duplicate"; id: string; index: number }
  | { kind: "add"; id: string; trayIndex: number }
  | { kind: "preset"; preset: PresetId; order: string[]; included: Record<string, boolean>; removed: { id: string; index: number }[] };

/** 보드 카드의 화면 면: 요약면(기본, 지도 없음) / 지도면(지도 몰입형). 보고서 출력 면(OutputFace)과 무관하다 */
export type CardFace = "summary" | "map";
/** 대지 요약 카드의 view 키 */
export const SUMMARY_ID = "site-summary";
export const BOARD_STATE_VERSION = 3;
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
  /** 카드 지도 범례 띠 표시. 누락된 옛 저장본은 기본 숨김(false)이다. */
  mapLegend: Record<string, boolean>;
  /** copy:N → 원본 결과 타일 id. 복제본은 결과 배열을 늘리지 않고 보드 설정만 가진다. */
  instances: Record<string, string>;
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
  | { type: "undo" }
  | { type: "move"; id: string; dir: -1 | 1 }
  | { type: "reorder"; from: number; to: number }
  | { type: "resize"; id: string; size: TileSize }
  | { type: "columns"; columns: GridColumns }
  | { type: "add"; id: string }
  | { type: "include"; id: string; value: boolean }
  | { type: "face"; id: string; face: OutputFace }
  | { type: "callout"; id: string; mode: CalloutMode }
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
  | { type: "mapLegend"; id: string; show: boolean }
  | { type: "layer"; id: string; layer: string };

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
    mapLegend: {},
    instances: {},
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
    mapLegend: s.mapLegend[id],
    layer: s.layers[id],
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
    mapLegend: withRecordValue(s.mapLegend, id, settings.mapLegend),
    layers: withRecordValue(s.layers, id, settings.layer),
  };
}

function removeInstance(s: BoardState, id: string): BoardState {
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
    mapLegend: withoutRecordValue(s.mapLegend, id),
    layers: withoutRecordValue(s.layers, id),
  };
}

function nextCopyId(s: BoardState): string {
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
        const next = removeInstance(s, a.id);
        return {
          ...next,
          undoStack: [...s.undoStack, { kind: "removeCopy", id: a.id, sourceId, index, settings: copyTileSettings(s, a.id) }],
        };
      }
      const stacks = { ...s.stacks };
      delete stacks[a.id];
      const sheets = { ...s.sheets };
      delete sheets[a.id];
      return {
        ...s,
        order: s.order.filter((x) => x !== a.id),
        stacks,
        sheets,
        removed: [...s.removed, { id: a.id, index }],
        undoStack: [...s.undoStack, { kind: "remove", id: a.id, index }],
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
          return { ...s, ...rest, order: u.order };
        case "size":
          return { ...s, ...rest, sizes: { ...s.sizes, [u.id]: u.size } };
        case "columns":
          return { ...s, ...rest, columns: u.columns };
        case "remove": {
          const order = [...s.order];
          order.splice(Math.min(u.index, order.length), 0, u.id);
          return { ...s, ...rest, order, removed: s.removed.filter((r) => r.id !== u.id) };
        }
        case "removeCopy": {
          if (s.order.includes(u.id)) return { ...s, ...rest };
          const order = [...s.order];
          order.splice(Math.min(u.index, order.length), 0, u.id);
          const restored = restoreTileSettings({ ...s, order, instances: { ...s.instances, [u.id]: u.sourceId } }, u.id, u.settings);
          return { ...restored, undoStack: rest.undoStack };
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
    case "include":
      return { ...s, included: { ...s.included, [a.id]: a.value } };
    case "face":
      return { ...s, faces: { ...s.faces, [a.id]: a.face } };
    case "callout":
      return { ...s, callout: { ...s.callout, [a.id]: a.mode } };
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
      const capacity = a.grid === "2x2" ? 4 : 6;
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
    case "mapLegend":
      return { ...s, mapLegend: { ...s.mapLegend, [a.id]: a.show } };
    case "layer": {
      if (!a.layer) return s;
      const result = s.results.find((candidate) => candidate.tileId === sourceTileId(s, a.id));
      const normalizedLayerId = result ? normalizeLayerId(result.tileCode, a.layer) : a.layer;
      if (result && !layerOptionsForResult(result).some((option) => option.id === normalizedLayerId)) return s;
      return { ...s, layers: { ...s.layers, [a.id]: normalizedLayerId } };
    }
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
  /** 카드 범례 띠 표시. 이전 저장본에는 없고 기본 false로 복원한다. */
  mapLegend?: Record<string, boolean>;
  /** copy:N → 원본 결과 타일 id. 이전 저장본에는 없다. */
  instances?: Record<string, string>;
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
    mapLegend: { ...s.mapLegend },
    instances: { ...s.instances },
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
const isTileSize = (value: unknown): value is TileSize => value === 1 || value === 2 || value === 4;
const isGridColumns = (value: unknown): value is GridColumns => value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
const isTileKind = (value: unknown): value is TileResult["tileType"] => value === "analysis" || value === "diagram" || value === "simulation" || value === "stack";

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
    mapLegend: mapIdRecord<boolean>(snapshot.mapLegend, mapId),
    instances,
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
  const migrated = { ...snapshot, cuts, version: BOARD_STATE_VERSION } as BoardStateSnapshot;
  delete migrated.roseSeasons;
  return migrated;
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
  // 열 수는 컷 이관과 같은 v3에서 생겼다 — 컷만 가진 v3 저장본도 기본 4열로 읽는다. 프리셋이 없으면 '전체'.
  return {
    ...migrated,
    columns: isGridColumns(migrated.columns) ? migrated.columns : 4,
    preset: isPresetId(migrated.preset) ? migrated.preset : DEFAULT_PRESET_ID,
    version: BOARD_STATE_VERSION,
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
    const grid = spec.grid === "2x2" || spec.grid === "3x2" ? spec.grid : null;
    if (tiles.length >= 2 && grid) savedSheets[id] = { tiles, grid };
  }
  const compositeIds = new Set([...Object.keys(savedStacks), ...Object.keys(savedSheets)]);
  const validIds = new Set([...validTileIds, ...compositeIds]);
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
  const mapLegend: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(recordOf(saved.mapLegend))) {
    if (validTileIds.has(id) && typeof value === "boolean") mapLegend[id] = value;
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
    mapLegend,
    layers,
    instances: savedInstances,
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
  return { tiles, pages };
}

// ── 분석 중 데모: 0.3초마다 step이 1씩 늘고, 타일은 대기 → 계산 중 → 끝 순서로 바뀐다 ──
export type DemoPhase = "pending" | "running" | "done";

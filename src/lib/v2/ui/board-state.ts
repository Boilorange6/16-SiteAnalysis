/** 보드 상태: 순서·제거/되돌리기·이동·보고서 포함·출력 면. 순수 reducer. */
import type { RoseSeason, TileResult } from "../tile-result";
import { normalizeA05Filter, type A05Filter } from "../engine/a05-filter";
import { calloutReportPages, DEFAULT_CALLOUT_MODE, type CalloutMode } from "./callout-layout";
import { CAMERA_PRESETS } from "./mass-projection";
import type { OutputFace } from "./tile-view";
import { layerOptionsForResult } from "./tile-layers";

export type TileSize = 1 | 2 | 4;
export type GridColumns = 2 | 3 | 4 | 5 | 6;
export type SheetGrid = "2x2" | "3x2";
export type SheetSpec = { tiles: string[]; grid: SheetGrid };
export type CameraPreset = { azimuthDeg: number; elevationDeg: number };
export type CutCount = 1 | 3;
export type PinnedLabel = { key: string; on: boolean };

/** 되돌리기 한 단계. 모든 편집(순서·크기·제거·더하기)이 여기 쌓인다. */
export type UndoEntry =
  | { kind: "order"; id: string; order: string[] }
  | { kind: "size"; id: string; size: TileSize }
  | { kind: "columns"; columns: GridColumns }
  | { kind: "remove"; id: string; index: number }
  | { kind: "add"; id: string; trayIndex: number };

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
  /** S02 타일 id → 보고서에 넣을 그림자 컷 수 */
  cuts: Record<string, CutCount>;
  /** D22 타일 id → 화면·보고서에 표시할 계절 */
  roseSeasons: Record<string, RoseSeason>;
  /** 타일 id → 지도 요소 라벨의 고정·표시 상태 */
  labels: Record<string, PinnedLabel[]>;
  /** 타일 id → 지도 표현/래스터 레이어. 비어 있으면 타일 기본 레이어. */
  layers: Record<string, string>;
  /** 빼 둔 타일(더할 수 있는 타일). index는 빼기 전 위치 */
  removed: { id: string; index: number }[];
  undoStack: UndoEntry[];
};

export type BoardAction =
  | { type: "replaceResults"; results: TileResult[] }
  | { type: "restore"; snapshot: unknown }
  | { type: "remove"; id: string }
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
  | { type: "cuts"; id: string; cuts: CutCount }
  | { type: "roseSeason"; id: string; season: RoseSeason }
  | { type: "pinLabel"; id: string; key: string }
  | { type: "unpinLabel"; id: string; key: string }
  | { type: "toggleLabel"; id: string; key: string }
  | { type: "setAllLabels"; id: string; on: boolean }
  | { type: "layer"; id: string; layer: string };

/** 카드의 현재 면 (편집 중에는 화면이 항상 요약면을 쓴다) */
export const viewOf = (s: Pick<BoardState, "view" | "viewAll">, id: string): CardFace => s.view[id] ?? s.viewAll;

export function initBoard(results: TileResult[]): BoardState {
  return {
    results: [...results],
    order: results.map((r) => r.tileId),
    // 결과가 있는 타일만 기본 포함
    included: Object.fromEntries(results.map((r) => [r.tileId, r.status === "complete" || r.status === "partial"])),
    faces: Object.fromEntries(results.map((r) => [r.tileId, r.presentation.outputFace])),
    callout: Object.fromEntries(results.filter((r) => r.tileCode === "A05" || r.tileCode === "A06").map((r) => [r.tileId, DEFAULT_CALLOUT_MODE])),
    a05Filter: {},
    view: {},
    viewAll: "summary",
    columns: 4,
    // 주변 단지 설명선(A05)은 좌우 칸이 필요해 기본 2칸
    sizes: Object.fromEntries(results.map((r) => [r.tileId, (r.tileCode === "A05" || r.tileCode === "A06" ? 2 : 1) as TileSize])),
    tileKinds: Object.fromEntries(results.map((r) => [r.tileId, r.tileType])),
    stacks: {},
    sheets: {},
    cameras: {},
    cuts: {},
    roseSeasons: {},
    labels: {},
    layers: {},
    removed: [],
    undoStack: [],
  };
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

export function boardReducer(s: BoardState, a: BoardAction): BoardState {
  switch (a.type) {
    case "restore":
      return restoreBoardState(s.results, a.snapshot);
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
    case "cuts":
      if (a.cuts !== 1 && a.cuts !== 3) return s;
      return { ...s, cuts: { ...s.cuts, [a.id]: a.cuts } };
    case "roseSeason":
      return { ...s, roseSeasons: { ...s.roseSeasons, [a.id]: a.season } };
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
    case "layer": {
      if (!a.layer) return s;
      const result = s.results.find((candidate) => candidate.tileId === a.id);
      if (result && !layerOptionsForResult(result).some((option) => option.id === a.layer)) return s;
      return { ...s, layers: { ...s.layers, [a.id]: a.layer } };
    }
  }
}

export type BoardStateSnapshot = {
  version: number;
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
  cuts: Record<string, CutCount>;
  roseSeasons?: Record<string, RoseSeason>;
  labels?: Record<string, PinnedLabel[]>;
  layers?: Record<string, string>;
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
    roseSeasons: { ...s.roseSeasons },
    labels: Object.fromEntries(Object.entries(s.labels).map(([id, labels]) => [id, labels.map((label) => ({ ...label }))])),
    layers: { ...s.layers },
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

function codeFromTileId(id: string): string {
  const separator = id.lastIndexOf("-");
  return separator < 0 ? id : id.slice(separator + 1);
}

function migratedLayer(id: string, value: string): string {
  return LEGACY_LAYER_RENAMES[codeFromTileId(id)] ?? value;
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
    if (!(mapped in layers)) layers[mapped] = migratedLayer(id, value);
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
    cuts: mapIdRecord<CutCount>(snapshot.cuts, mapId),
    roseSeasons: mapIdRecord<RoseSeason>(snapshot.roseSeasons, mapId),
    labels: mapIdRecord<PinnedLabel[]>(snapshot.labels, mapId),
    layers,
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

function migrateV2ToV3(snapshot: BoardStateSnapshot): BoardStateSnapshot {
  return { ...snapshot, columns: isGridColumns(snapshot.columns) ? snapshot.columns : 4 };
}

/** 저장본 버전을 단계별로 현재 버전까지 올린다. 미래 버전은 호출자가 기본 보드로 처리한다. */
export function migrateSnapshot(raw: unknown): BoardStateSnapshot | null {
  const saved = rawSnapshot(raw);
  if (!saved) return null;
  const version = saved.version === undefined ? 1 : typeof saved.version === "number" && Number.isInteger(saved.version) ? saved.version : null;
  if (version === null || version < 1 || version > BOARD_STATE_VERSION) return null;
  let migrated = saved as unknown as BoardStateSnapshot;
  if (version === 1) migrated = migrateV1ToV2(migrated);
  if (version <= 2) migrated = migrateV2ToV3(migrated);
  return { ...rewriteSnapshotIds(migrated, renameTileId), columns: isGridColumns(migrated.columns) ? migrated.columns : 4, version: BOARD_STATE_VERSION };
}

/** 재분석으로 analysisId가 바뀐 프로젝트의 보드 배치를 새 타일 id에 연결한다. */
export function rebaseSnapshotAnalysisId(raw: unknown, fromAnalysisId: string, toAnalysisId: string): BoardStateSnapshot | null {
  const migrated = migrateSnapshot(raw);
  if (!migrated || !fromAnalysisId || !toAnalysisId || fromAnalysisId === toAnalysisId) return migrated;
  const prefix = `${fromAnalysisId}-`;
  return rewriteSnapshotIds(migrated, (id) => id.startsWith(prefix) ? `${toAnalysisId}-${id.slice(prefix.length)}` : id);
}

/** 옛 저장본(버전/필터 필드 없음 포함)을 현재 분석 결과에 안전하게 붙인다. */
export function restoreBoardState(results: TileResult[], raw: unknown): BoardState {
  const base = initBoard(results);
  const saved = migrateSnapshot(raw);
  if (!saved) return base;

  const baseIds = new Set(base.order);
  const savedStacks: Record<string, string[]> = {};
  for (const [id, layers] of Object.entries(recordOf(saved.stacks))) {
    const valid = unique(stringsOf(layers)).filter((layer) => baseIds.has(layer));
    if (valid.length >= 2) savedStacks[id] = valid;
  }
  const savedSheets: Record<string, SheetSpec> = {};
  for (const [id, spec] of Object.entries(recordOf(saved.sheets))) {
    if (!isRecord(spec)) continue;
    const tiles = unique(stringsOf(spec.tiles)).filter((tile) => baseIds.has(tile));
    const grid = spec.grid === "2x2" || spec.grid === "3x2" ? spec.grid : null;
    if (tiles.length >= 2 && grid) savedSheets[id] = { tiles, grid };
  }
  const compositeIds = new Set([...Object.keys(savedStacks), ...Object.keys(savedSheets)]);
  const validIds = new Set([...baseIds, ...compositeIds]);
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
  const cuts: Record<string, CutCount> = {};
  for (const [id, value] of Object.entries(recordOf(saved.cuts))) if (validIds.has(id) && (value === 1 || value === 3)) cuts[id] = value;
  const roseSeasons: Record<string, RoseSeason> = {};
  for (const [id, value] of Object.entries(recordOf(saved.roseSeasons))) {
    if (!validIds.has(id)) continue;
    if (value === "annual" || value === "spring" || value === "summer" || value === "autumn" || value === "winter") roseSeasons[id] = value;
  }
  const labels: Record<string, PinnedLabel[]> = {};
  for (const [id, value] of Object.entries(recordOf(saved.labels))) {
    if (!baseIds.has(id) || !Array.isArray(value)) continue;
    const seen = new Set<string>();
    const restored = value.flatMap((item) => {
      if (!isRecord(item) || typeof item.key !== "string" || !item.key || typeof item.on !== "boolean" || seen.has(item.key)) return [];
      seen.add(item.key);
      return [{ key: item.key, on: item.on }];
    });
    if (restored.length > 0) labels[id] = restored;
  }
  const layers: Record<string, string> = {};
  const resultById = new Map(base.results.map((result) => [result.tileId, result]));
  for (const [id, value] of Object.entries(recordOf(saved.layers))) {
    if (!baseIds.has(id) || typeof value !== "string") continue;
    const result = resultById.get(id);
    if (result && layerOptionsForResult(result).some((option) => option.id === value)) layers[id] = value;
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
    roseSeasons,
    labels,
    layers,
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
  const kind = s.tileKinds[id];
  if (kind) return kind === "analysis" || kind === "diagram";
  return !/(?:^|-)S\d{2}$/.test(id) && !id.startsWith("stack:");
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
    const result = s.results.find((candidate) => candidate.tileId === id);
    const isS02Cuts = result?.tileCode === "S02" && (result.status === "complete" || result.status === "partial") && s.cuts[id] === 3;
    pages += id in complexCounts
      ? calloutReportPages(s.callout[id] ?? DEFAULT_CALLOUT_MODE, complexCounts[id])
      : isS02Cuts
        ? 1
        : s.faces[id] === "both" ? 2 : 1;
  }
  return { tiles, pages };
}

// ── 분석 중 데모: 0.3초마다 step이 1씩 늘고, 타일은 대기 → 계산 중 → 끝 순서로 바뀐다 ──
export type DemoPhase = "pending" | "running" | "done";
export function demoPhase(index: number, step: number): DemoPhase {
  return step <= index ? "pending" : step === index + 1 ? "running" : "done";
}
export const demoFinished = (total: number, step: number) => Math.max(0, Math.min(total, step - 1));

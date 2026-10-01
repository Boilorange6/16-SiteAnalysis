/** 보드 상태: 순서·제거/되돌리기·이동·보고서 포함·출력 면. 순수 reducer. */
import type { TileResult } from "../tile-result";
import { calloutReportPages, DEFAULT_CALLOUT_MODE, type CalloutMode } from "./callout-layout";
import { CAMERA_PRESETS } from "./mass-projection";
import type { OutputFace } from "./tile-view";

export type TileSize = 1 | 2;
export type SheetGrid = "2x2" | "3x2";
export type SheetSpec = { tiles: string[]; grid: SheetGrid };
export type CameraPreset = { azimuthDeg: number; elevationDeg: number };

/** 되돌리기 한 단계. 모든 편집(순서·크기·제거·더하기)이 여기 쌓인다. */
export type UndoEntry =
  | { kind: "order"; id: string; order: string[] }
  | { kind: "size"; id: string; size: TileSize }
  | { kind: "remove"; id: string; index: number }
  | { kind: "add"; id: string; trayIndex: number };

/** 보드 카드의 화면 면: 요약면(기본, 지도 없음) / 지도면(지도 몰입형). 보고서 출력 면(OutputFace)과 무관하다 */
export type CardFace = "summary" | "map";
/** 대지 요약 카드의 view 키 */
export const SUMMARY_ID = "site-summary";

export type BoardState = {
  order: string[];
  included: Record<string, boolean>;
  faces: Record<string, OutputFace>;
  /** 주변 단지 설명선 타일의 보고서 설명표 장수: 개요만 / 상위 10 / 전체 */
  callout: Record<string, CalloutMode>;
  /** 카드별 화면 면. 전체 전환 뒤 카드별로 뒤집으면 그 카드만 다음 전체 전환까지 따로 간다. 보고서·되돌리기에 들어가지 않는다 */
  view: Record<string, CardFace>;
  viewAll: CardFace;
  sizes: Record<string, TileSize>;
  /** 원본 타일의 종류. 스택 reducer가 simulation/다른 스택을 걸러낼 때 사용한다. */
  tileKinds: Record<string, TileResult["tileType"]>;
  /** 스택 id → 층 타일 id(위→아래) */
  stacks: Record<string, string[]>;
  /** 조판 id → 셀 타일 id(왼쪽 위부터)와 격자 */
  sheets: Record<string, SheetSpec>;
  /** S01 타일 id → 저장된 카메라 프리셋 */
  cameras: Record<string, CameraPreset>;
  /** 빼 둔 타일(더할 수 있는 타일). index는 빼기 전 위치 */
  removed: { id: string; index: number }[];
  undoStack: UndoEntry[];
};

export type BoardAction =
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "move"; id: string; dir: -1 | 1 }
  | { type: "reorder"; from: number; to: number }
  | { type: "resize"; id: string; size: TileSize }
  | { type: "add"; id: string }
  | { type: "include"; id: string; value: boolean }
  | { type: "face"; id: string; face: OutputFace }
  | { type: "callout"; id: string; mode: CalloutMode }
  | { type: "view"; id: string; face: CardFace }
  | { type: "viewAll"; face: CardFace }
  | { type: "stack"; layers: string[] }
  | { type: "unstack"; id: string }
  | { type: "sheet"; tiles: string[]; grid: SheetGrid }
  | { type: "unsheet"; id: string }
  | { type: "camera"; id: string; camera: CameraPreset };

/** 카드의 현재 면 (편집 중에는 화면이 항상 요약면을 쓴다) */
export const viewOf = (s: Pick<BoardState, "view" | "viewAll">, id: string): CardFace => s.view[id] ?? s.viewAll;

export function initBoard(results: TileResult[]): BoardState {
  return {
    order: results.map((r) => r.tileId),
    // 결과가 있는 타일만 기본 포함
    included: Object.fromEntries(results.map((r) => [r.tileId, r.status === "complete" || r.status === "partial"])),
    faces: Object.fromEntries(results.map((r) => [r.tileId, r.presentation.outputFace])),
    callout: Object.fromEntries(results.filter((r) => r.tileCode === "A05" || r.tileCode === "A06").map((r) => [r.tileId, DEFAULT_CALLOUT_MODE])),
    view: {},
    viewAll: "summary",
    // 주변 단지 설명선(A05)은 좌우 칸이 필요해 기본 2칸
    sizes: Object.fromEntries(results.map((r) => [r.tileId, (r.tileCode === "A05" || r.tileCode === "A06" ? 2 : 1) as TileSize])),
    tileKinds: Object.fromEntries(results.map((r) => [r.tileId, r.tileType])),
    stacks: {},
    sheets: {},
    cameras: {},
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
    case "include":
      return { ...s, included: { ...s.included, [a.id]: a.value } };
    case "face":
      return { ...s, faces: { ...s.faces, [a.id]: a.face } };
    case "callout":
      return { ...s, callout: { ...s.callout, [a.id]: a.mode } };
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
  }
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
 * 표지 1장 + 포함된 타일 + 출처 1장. 출력 면 both는 2장.
 * 설명선 타일은 단지 수(complexCounts[tileId])와 설명표 설정에 따라 개요 + 설명표 장 수만큼 (report-plan과 같은 계산).
 */
export function reportPages(s: BoardState, complexCounts: Record<string, number> = {}): { tiles: number; pages: number } {
  let tiles = 0;
  let pages = 2; // 표지 + 출처
  for (const id of s.order) {
    if (!s.included[id]) continue;
    tiles += 1;
    pages += id in complexCounts ? calloutReportPages(s.callout[id] ?? DEFAULT_CALLOUT_MODE, complexCounts[id]) : s.faces[id] === "both" ? 2 : 1;
  }
  return { tiles, pages };
}

// ── 분석 중 데모: 0.3초마다 step이 1씩 늘고, 타일은 대기 → 계산 중 → 끝 순서로 바뀐다 ──
export type DemoPhase = "pending" | "running" | "done";
export function demoPhase(index: number, step: number): DemoPhase {
  return step <= index ? "pending" : step === index + 1 ? "running" : "done";
}
export const demoFinished = (total: number, step: number) => Math.max(0, Math.min(total, step - 1));

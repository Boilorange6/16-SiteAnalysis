/** 보드 상태: 순서·제거/되돌리기·이동·보고서 포함·출력 면. 순수 reducer. */
import type { TileResult } from "../tile-result";
import type { OutputFace } from "./tile-view";

export type TileSize = 1 | 2;

/** 되돌리기 한 단계. 모든 편집(순서·크기·제거·더하기)이 여기 쌓인다. */
export type UndoEntry =
  | { kind: "order"; id: string; order: string[] }
  | { kind: "size"; id: string; size: TileSize }
  | { kind: "remove"; id: string; index: number }
  | { kind: "add"; id: string; trayIndex: number };

export type BoardState = {
  order: string[];
  included: Record<string, boolean>;
  faces: Record<string, OutputFace>;
  sizes: Record<string, TileSize>;
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
  | { type: "face"; id: string; face: OutputFace };

export function initBoard(results: TileResult[]): BoardState {
  return {
    order: results.map((r) => r.tileId),
    // 결과가 있는 타일만 기본 포함
    included: Object.fromEntries(results.map((r) => [r.tileId, r.status === "complete" || r.status === "partial"])),
    faces: Object.fromEntries(results.map((r) => [r.tileId, r.presentation.outputFace])),
    // 주변 단지 설명선(A05)은 좌우 칸이 필요해 기본 2칸
    sizes: Object.fromEntries(results.map((r) => [r.tileId, (r.tileCode === "A05" ? 2 : 1) as TileSize])),
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
      return {
        ...s,
        order: s.order.filter((x) => x !== a.id),
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
          removed.splice(Math.min(u.trayIndex, removed.length), 0, { id: u.id, index: s.order.indexOf(u.id) });
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
  }
}

/** 표지 1장 + 포함된 타일. 출력 면 both는 2장. */
export function reportPages(s: BoardState): { tiles: number; pages: number } {
  let tiles = 0;
  let pages = 2; // 표지 + 출처
  for (const id of s.order) {
    if (!s.included[id]) continue;
    tiles += 1;
    pages += s.faces[id] === "both" ? 2 : 1;
  }
  return { tiles, pages };
}

// ── 분석 중 데모: 0.3초마다 step이 1씩 늘고, 타일은 대기 → 계산 중 → 끝 순서로 바뀐다 ──
export type DemoPhase = "pending" | "running" | "done";
export function demoPhase(index: number, step: number): DemoPhase {
  return step <= index ? "pending" : step === index + 1 ? "running" : "done";
}
export const demoFinished = (total: number, step: number) => Math.max(0, Math.min(total, step - 1));

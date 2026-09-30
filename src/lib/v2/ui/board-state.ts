/** 보드 상태: 순서·제거/되돌리기·이동·보고서 포함·출력 면. 순수 reducer. */
import type { TileResult } from "../tile-result";
import type { OutputFace } from "./tile-view";

export type BoardState = {
  order: string[];
  included: Record<string, boolean>;
  faces: Record<string, OutputFace>;
  removed: { id: string; index: number }[];
};

export type BoardAction =
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "move"; id: string; dir: -1 | 1 }
  | { type: "include"; id: string; value: boolean }
  | { type: "face"; id: string; face: OutputFace };

export function initBoard(results: TileResult[]): BoardState {
  return {
    order: results.map((r) => r.tileId),
    // 결과가 있는 타일만 기본 포함
    included: Object.fromEntries(results.map((r) => [r.tileId, r.status === "complete" || r.status === "partial"])),
    faces: Object.fromEntries(results.map((r) => [r.tileId, r.presentation.outputFace])),
    removed: [],
  };
}

export function boardReducer(s: BoardState, a: BoardAction): BoardState {
  switch (a.type) {
    case "remove": {
      const index = s.order.indexOf(a.id);
      if (index < 0) return s;
      return { ...s, order: s.order.filter((x) => x !== a.id), removed: [...s.removed, { id: a.id, index }] };
    }
    case "undo": {
      const last = s.removed[s.removed.length - 1];
      if (!last) return s;
      const order = [...s.order];
      order.splice(Math.min(last.index, order.length), 0, last.id);
      return { ...s, order, removed: s.removed.slice(0, -1) };
    }
    case "move": {
      const i = s.order.indexOf(a.id);
      const j = i + a.dir;
      if (i < 0 || j < 0 || j >= s.order.length) return s;
      const order = [...s.order];
      [order[i], order[j]] = [order[j], order[i]];
      return { ...s, order };
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
  let pages = 1;
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

/**
 * 보드 → 보고서 슬라이드 계획. 순수 함수 (pptx 라이브러리 의존 없음).
 * 슬라이드 수는 board-state의 reportPages(board).pages(표지+타일+출처)와 항상 같다.
 */
import type { BoardState } from "../ui/board-state";
import type { SummaryView, TileView } from "../ui/tile-view";
import { FACE_TEXT } from "../ui/tile-view";

export type TileSlideBody =
  | { kind: "result"; face: "single" | "front" | "back" }
  | { kind: "state"; face: "single" | "front" | "back"; message: string };

export type ReportSlide =
  | {
      kind: "cover";
      address: string;
      metrics: { label: string; value: string }[];
      asOfLine: string;
      incomplete: string | null;
      lines: { title: string; color: string; text: string }[];
    }
  | { kind: "tile"; view: TileView; body: TileSlideBody; faceLabel: string | null }
  | { kind: "sources"; rows: { source: string; asOf: string; tiles: string }[] };

export type PlannedSlide = ReportSlide & { no: number; total: number; footer: string };

const STATE_MESSAGE: Record<string, string> = {
  failed: "계산 실패 — 보고서에는 결과 없이 표시합니다",
  no_data: "자료 없음 — 이 조건에서는 표시할 결과가 없습니다",
  not_provided: "이 단계에서는 제공하지 않습니다 — 다음 단계에서 제공 예정",
  cancelled: "취소됨 — 보고서에는 결과 없이 표시합니다",
};

const hasResult = (v: TileView) => v.status === "complete" || v.status === "partial";

function oneLine(v: TileView): string {
  if (!hasResult(v)) return (v.badges[0]?.text ?? "결과 없음") + " · 결과 없음";
  if (!v.headline) return "결과 있음";
  return `${v.headline.label} ${v.headline.value}${v.headline.aux ? ` ${v.headline.aux}` : ""}`;
}

/** sourceLine("id 2026-09-01 · id2 기준일 미확인") → [id, 기준일] */
function parseSources(line: string): [string, string][] {
  if (line === "출처 없음") return [];
  return line.split(" · ").map((p) => {
    const i = p.indexOf(" ");
    return [p.slice(0, i), p.slice(i + 1)] as [string, string];
  });
}

export function buildReportPlan(input: {
  summary: SummaryView;
  views: Map<string, TileView>;
  board: BoardState;
  analysisDate?: string;
}): PlannedSlide[] {
  const { summary, views, board } = input;
  const date = input.analysisDate ?? "미확인";
  const tiles = board.order.filter((id) => board.included[id] && views.has(id)).map((id) => views.get(id)!);
  const raw: (ReportSlide & { footer: string })[] = [];

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
    footer: `${summary.asOfLine} · 출처와 기준일은 마지막 장 참조`,
  });

  for (const v of tiles) {
    const faces: ("single" | "front" | "back")[] = !v.hasFace ? ["single"] : board.faces[v.tileId] === "both" ? ["front", "back"] : [board.faces[v.tileId] === "back" ? "back" : "front"];
    for (const face of faces) {
      const message = STATE_MESSAGE[v.status];
      raw.push({
        kind: "tile",
        view: v,
        body: hasResult(v) ? { kind: "result", face } : { kind: "state", face, message: message ?? "결과 없음 — 보고서에는 결과 없이 표시합니다" },
        faceLabel: v.hasFace ? FACE_TEXT[face === "front" ? "front" : "back"] : null,
        footer: v.sourceLine === "출처 없음" ? "출처 없음 · 기준일 해당 없음" : `출처 ${v.sourceLine}`,
      });
    }
  }

  const bySource = new Map<string, { asOf: string; tiles: string[] }>();
  for (const v of tiles) {
    for (const [id, asOf] of parseSources(v.sourceLine)) {
      const key = `${id}|${asOf}`;
      const e = bySource.get(key) ?? { asOf, tiles: [] };
      if (!e.tiles.includes(v.title)) e.tiles.push(v.title);
      bySource.set(key, e);
    }
  }
  raw.push({
    kind: "sources",
    rows: [...bySource].map(([k, e]) => ({ source: k.split("|")[0], asOf: e.asOf, tiles: e.tiles.join(", ") })),
    footer: `${summary.asOfLine} · 출처 ${bySource.size}건`,
  });

  return raw.map((s, i) => ({ ...s, no: i + 1, total: raw.length }));
}

/** 다운로드 파일명: 사이트분석_<주소>_<YYYYMMDD>.pptx */
export function reportFileName(address: string, analysisDate: string): string {
  const safe = address.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  return `사이트분석_${safe}_${analysisDate.replace(/-/g, "")}.pptx`;
}

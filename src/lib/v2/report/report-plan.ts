/**
 * 보드 → 보고서 슬라이드 계획. 순수 함수 (pptx 라이브러리 의존 없음).
 * 슬라이드 수는 board-state의 reportPages(board).pages(표지+타일+출처)와 항상 같다.
 */
import type { BoardState } from "../ui/board-state";
import { calloutReportPages, DEFAULT_CALLOUT_MODE, pageCount } from "../ui/callout-layout";
import type { MapModel } from "../ui/map-layers";
import type { CalloutModel, SummaryView, TileView } from "../ui/tile-view";
import type { MassModel } from "../ui/mass-projection";
import type { SheetGrid } from "../ui/sheet";
import { FACE_TEXT } from "../ui/tile-view";
import type { RoseModel } from "../ui/wind-rose";
import type { RoseSeason } from "../tile-result";
import { exportFileName } from "../export/download";

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
      cells: Array<{ view: TileView; face: "front" | "back"; mapKey: string; pinnedKeys?: string[] }>;
    }
  | { kind: "sources"; rows: { source: string; asOf: string; tiles: string }[]; /** 배경(흐린 대지 지도) */ map: MapModel | null };

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

const hasResult = (v: TileView) => v.status === "complete" || v.status === "partial";
const pinnedKeysFor = (board: BoardState, tileId: string): string[] => (board.labels[tileId] ?? []).filter((label) => label.on).map((label) => label.key);

const S02_CUTS = [
  { layer: "shadow_09", note: "09:00", key: "cut09" },
  { layer: "shadow_12", note: "12:00", key: "cut12" },
  { layer: "shadow_15", note: "15:00", key: "cut15" },
] as const;

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
          pinnedKeys: pinnedKeysFor(board, cell.tileId),
        }));
      raw.push({
        kind: "sheet",
        view: v,
        grid: v.sheetGrid,
        cells,
        footer: v.sourceLine === "출처 없음" ? "출처 없음 · 기준일 해당 없음" : `출처 ${v.sourceLine}`,
      });
      continue;
    }
    if (v.code === "S02" && board.cuts[v.tileId] === 3 && hasResult(v)) {
      const cells = S02_CUTS.map(({ layer, note, key }) => ({
        view: viewWithOnlyLayer(v, layer, note),
        face: "front" as const,
        mapKey: `${v.tileId}:${key}`,
        pinnedKeys: pinnedKeysFor(board, v.tileId),
      }));
      raw.push({
        kind: "sheet",
        view: v,
        grid: "3x1",
        cells,
        footer: v.sourceLine === "출처 없음" ? "출처 없음 · 기준일 해당 없음" : `출처 ${v.sourceLine}`,
      });
      continue;
    }
    if (v.callout && hasResult(v)) {
      // 설명선 타일: 개요 1장 + 설명표 장 (설정: 개요만 / 상위 10 / 전체). 장수는 board-state.reportPages와 같은 함수
      const cm = v.callout;
      const count = calloutReportPages(board.callout[v.tileId] ?? DEFAULT_CALLOUT_MODE, cm.complexes.length);
      const sourceFooter = v.sourceLine === "출처 없음" ? "출처 없음 · 기준일 해당 없음" : `출처 ${v.sourceLine}`;
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
      // S01 보고서는 화면 토글과 독립적으로 분해 면을 기본 포함한다. 화면·PPT가 같은 MassFigure 경로를 쓴다.
      const mass = v.mass ? { ...v.mass, exploded: v.mass.exploded ?? { spreadPct: 24, scheme: "use" as const } } : undefined;
      // D22의 뒷면은 사용자가 구성비를 선택할 수 있으므로 장미 그림은 도판 면에만 둔다.
      const rose = face === "back" ? undefined : v.rose ?? undefined;
      const roseSeason = board.roseSeasons[v.tileId] ?? "annual";
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
        ...(rose ? { rose, roseSeason } : {}),
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
    map: summary.map,
    footer: `${summary.asOfLine} · 출처 ${bySource.size}건`,
  });

  return raw.map((s, i) => ({ ...s, no: i + 1, total: raw.length }));
}

/** 다운로드 파일명: 사이트분석_<주소>_<YYYYMMDD>.pptx */
export function reportFileName(address: string, analysisDate: string): string {
  return exportFileName("pptx", address, analysisDate);
}

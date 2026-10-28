/**
 * 「지도 + 그래프」 요약 열의 글자 맞춤. 화면(analysis-column.tsx)과 PPT(analysis-column-pptx.ts)가 같은 값을 쓰도록
 * 큰 숫자 칸 배율(e)·배지 줄 배치·한 줄 통계/해석 문장의 pt와 줄 수를 한 곳에서 계산하는 순수 함수다.
 */
import type { ChartsColumn } from "../ui/overlay-layout";
import type { Badge, TileView } from "../ui/tile-view";
import { fitBlock, textIn } from "./pptx-kit";

/** fitBlock이 줄 높이로 가정하는 값 */
export const ANALYSIS_LINE = 1.25;

export type AnalysisFitInput = {
  col: ChartsColumn;
  /** 요약 글자 크기 / 기본 요약 글자 크기 */
  scale: number;
  summaryPt: number;
  badges: readonly Badge[];
  headline: TileView["headline"];
  statText: string;
  filterLine: string | null | undefined;
  sentence: string | null;
};

/** 큰 숫자 칸 안의 배지 한 개. x는 칸 왼쪽에서(inch), row는 0부터, w는 칩 폭(inch). */
export type AnalysisChip = { text: string; tone: Badge["tone"]; x: number; row: number; w: number };

export type AnalysisFit = {
  /** 큰 숫자 칸 배율(칸 높이를 넘으면 줄인다) */
  e: number;
  chips: AnalysisChip[];
  chipRows: number;
  labelPt: number | null;
  valuePt: number | null;
  statPt: number;
  /** 통계 줄이 쓸 수 있는 줄 수(필터 줄이 있으면 그 한 줄을 뺀다) */
  statClamp: number;
  sentPt: number;
  sentLines: number;
};

export function analysisColumnFit({ col, scale, summaryPt, badges, headline, statText, filterLine, sentence }: AnalysisFitInput): AnalysisFit {
  const hr = col.headline;
  const layoutChips = (e: number) => {
    const chips: AnalysisChip[] = [];
    let row = badges.length ? 0 : -1;
    let x = 0;
    for (const b of badges) {
      const w = Math.min(hr.w, textIn(b.text, 9 * e) + 0.24 * e);
      if (x > 0 && x + w > hr.w) { row += 1; x = 0; }
      chips.push({ text: b.text, tone: b.tone, x, row, w });
      x += w + 0.08 * e;
    }
    return { chips, rows: row + 1 };
  };
  // 큰 숫자 칸: 배지 줄 + 라벨 + 값. 칸 높이를 넘으면 배율을 줄여 맞춘다.
  const needed = (e: number) => layoutChips(e).rows * 0.32 * e + (headline ? 0.9 * e : 0);
  let e = scale;
  while (e > 0.4 && needed(e) > hr.h) e -= 0.05;
  const { chips, rows } = layoutChips(e);

  // 한 줄 통계 칸: 통계 + (있으면) 필터 줄. 같은 글자 크기로 칸에 맞추고, 그래도 넘치면 줄 수를 묶는다(필터 줄은 한 줄).
  const statPt = fitBlock(filterLine ? [statText, filterLine] : [statText], { w: col.stat.w, h: col.stat.h }, 10 * scale, 7);
  const statRows = Math.max(1, Math.floor(col.stat.h / ((statPt / 72) * ANALYSIS_LINE) + 1e-9));
  const statClamp = Math.max(1, statRows - (filterLine ? 1 : 0));

  // 해석 문장 칸: 요약 크기에서 시작해 10 pt까지 줄이고, 그래도 넘치면 줄 수를 묶는다.
  const sentPt = fitBlock([sentence ?? ""], { w: col.sentence.w, h: col.sentence.h }, summaryPt, 10);
  const sentLines = Math.max(1, Math.floor(col.sentence.h / ((sentPt / 72) * ANALYSIS_LINE) + 1e-9));

  return {
    e,
    chips,
    chipRows: rows,
    labelPt: headline ? fitBlock([headline.label], { w: hr.w, h: 0.24 * e }, 11 * e, 7) : null,
    valuePt: headline ? fitBlock([headline.value], { w: hr.w, h: 0.66 * e }, 36 * e, 7) : null,
    statPt,
    statClamp,
    sentPt,
    sentLines,
  };
}

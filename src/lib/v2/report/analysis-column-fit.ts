/**
 * 「지도 + 그래프」 요약 열의 글자 맞춤. 화면(analysis-column.tsx)과 PPT(analysis-column-pptx.ts)가 같은 값을 쓰도록
 * 큰 숫자 칸 배율(e)·배지 줄 배치·한 줄 통계/해석 문장의 pt와 줄 수를 한 곳에서 계산하는 순수 함수다.
 */
import type { ChartsColumn } from "../ui/overlay-layout";
import type { Badge, TileView } from "../ui/tile-view";
import { fitBlock, linesOf, textIn } from "./pptx-kit";

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

/**
 * 폭 width(inch)에 pt로 쓸 때 maxLines줄을 넘으면 뒤를 잘라 마지막 줄을 「…」로 닫는다. 줄 나눔은 fitBlock과 같은 글자 폭 어림(10 % 여유)에 공백 우선으로 한다.
 * 화면(CSS line-clamp)과 PPT(pptxgenjs는 fit:"shrink"를 편집 때만 적용)가 같은 글자를 그리도록 보이는 문자열 자체를 줄인다.
 */
export function clampToLines(text: string, pt: number, width: number, maxLines: number): string {
  if (linesOf(text, pt, width) <= maxLines) return text; // fitBlock이 맞는다고 본 글은 자르지 않는다(아래 줄 나눔이 한 줄 더 엄격하다)
  const chars = [...text];
  const w = Math.max(0.01, width) / 1.1;
  const fits = (from: number, to: number) => textIn(chars.slice(from, to).join(""), pt) <= w;
  const starts: number[] = [0];
  const ends: number[] = [];
  let lastSpace = -1;
  for (let i = 0; i < chars.length; i++) {
    const start = starts[starts.length - 1]!;
    if (chars[i] === " ") lastSpace = i;
    if (fits(start, i + 1)) continue;
    let at = lastSpace > start && chars[i] !== " " ? lastSpace : i; // 공백이 있으면 그 자리에서 줄을 바꾸고, 없으면 글자 단위로
    if (at === start) at = i + 1; // 글자 하나가 폭보다 넓은 극단: 한 줄에 한 글자씩
    ends.push(at);
    starts.push(chars[at] === " " ? at + 1 : at);
    lastSpace = -1;
    i = starts[starts.length - 1]! - 1; // 새 줄 처음부터 다시 잰다
  }
  if (starts.length <= maxLines) return text;
  const head = chars.slice(0, starts[maxLines - 1]!).join("");
  let last = chars.slice(starts[maxLines - 1]!, ends[maxLines - 1]!);
  while (last.length > 0 && textIn(`${last.join("")}…`, pt) > w) last = last.slice(0, -1);
  return `${head}${last.join("").trimEnd()}…`;
}

export type AnalysisFit = {
  /** 큰 숫자 칸 배율(칸 높이를 넘으면 줄인다) */
  e: number;
  /** 화면과 PPT가 똑같이 그릴 글: 줄 수를 넘으면 「…」로 자른 통계·필터 줄·해석 문장 */
  statText: string;
  filterLine: string | null;
  sentence: string | null;
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
    statText: clampToLines(statText, statPt, col.stat.w, statClamp),
    filterLine: filterLine ? clampToLines(filterLine, statPt, col.stat.w, 1) : null,
    sentence: sentence ? clampToLines(sentence, sentPt, col.sentence.w, sentLines) : sentence,
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

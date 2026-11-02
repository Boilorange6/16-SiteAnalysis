/**
 * 핵심 숫자 카드의 글자 맞춤과 높이(spec 2026-10-30 §4-1). 화면 카드와 PPT 카드가 같은 pt·줄·높이를 쓰도록 한 곳에서 계산하는 순수 함수다.
 * 글자 폭 어림은 pptx-kit의 textIn(한글 1 em·그 밖 0.56 em)과 linesOf의 10 % 여유를 그대로 쓴다.
 * 시안 pt(summaryPt 13일 때)는 질문 9.4 · 앞말 18 · 숫자 43.5 · 이름 답 23 · 대상 21 · 보조 줄 9.4 · 보조 숫자 15 / 8.25 · 해석 9.75이고, summaryPt / 13 배로 같이 커진다.
 * `width`는 카드 바깥 폭이다. columns 2는 ①(해석 한 줄이 카드 맨 아래), 3은 ②(해석은 열 맨 아래 카드 밖)이다.
 */
import type { KeyFigure } from "../tile/types";
import { linesOf, textIn } from "./pptx-kit";

export type KeyFigureFitInput = {
  figure: KeyFigure;
  /** view.badges의 표시 글 */
  badges: string[];
  /** view.grades의 `${target} ${label}` */
  grades: string[];
  filterLine: string | null;
  sentence: string | null;
  width: number;
  columns: 2 | 3;
  summaryPt: number;
};

export type KeyFigureFit = {
  /** 카드 바깥 높이(inch) */
  height: number;
  questionPt: number; prePt: number; valuePt: number; targetPt: number;
  subPt: number; statValuePt: number; statLabelPt: number; sentencePt: number;
  /** 큰 답이 넘쳐 대상 이름을 보조 줄로 내렸다 */
  targetOnSub: boolean;
  badgesShown: string[]; badgesMore: number;
  /** 해석 한 줄(최대 2줄, 넘치면 마지막 줄을 …로 닫는다) */
  sentenceLines: string[];
  /** 보조 줄(대상을 내렸으면 맨 앞에 붙는다, 최대 2줄) */
  subLines: string[];
};

const PAD_X = 0.1875; // 18 px
const PAD_TOP = 0.1875;
const PAD_BOTTOM = 0.1667; // 16 px
const LINE = 1.25; // fitBlock이 가정하는 줄 높이
const ANSWER_LINE = 1.05; // 큰 답은 줄 간격이 없다(한 줄)
const MAX_BADGES = 2;
const SENTENCE_BAR = 0.15; // 해석 줄 왼쪽 막대 + 간격
const NUMBER_MAX_PT = 43.5;
const NAME_MAX_PT = 23;
const VALUE_MIN_PT = 24; // 최소 32 px
const VALUE_HARD_MIN_PT = 14; // 대상을 내려도 넘칠 때만 더 줄인다

const pt = (value: number) => value / 72;

/** 폭 안에서 pt로 쓸 때 줄이 maxLines를 넘으면 마지막 줄을 …로 닫는다. 공백에서 먼저 나누고 없으면 글자 단위로 나눈다. */
function wrap(text: string, size: number, width: number, maxLines: number): string[] {
  const limit = Math.max(0.01, width) / 1.1;
  const fits = (value: string) => textIn(value, size) <= limit;
  const lines: string[] = [];
  let rest = text.trim();
  while (rest && lines.length < maxLines) {
    if (fits(rest)) { lines.push(rest); rest = ""; break; }
    const chars = [...rest];
    let n = 1;
    while (n < chars.length && fits(chars.slice(0, n + 1).join(""))) n++;
    const space = chars.slice(0, n).lastIndexOf(" ");
    const cut = space > 0 && chars[n] !== " " ? space : n;
    lines.push(chars.slice(0, cut).join("").trimEnd());
    rest = chars.slice(cut).join("").trimStart();
  }
  if (rest && lines.length > 0) {
    const last = [...lines.pop()!];
    while (last.length > 0 && !fits(`${last.join("")}…`)) last.pop();
    lines.push(`${last.join("").trimEnd()}…`);
  }
  return lines;
}

export function keyFigureFit({ figure, badges, grades, filterLine, sentence, width, columns, summaryPt }: KeyFigureFitInput): KeyFigureFit {
  const s = summaryPt / 13;
  const inner = Math.max(0.5, width - PAD_X * 2);
  const questionPt = 9.4 * s;
  const prePt = 18 * s;
  const targetPt = 21 * s;
  const subPt = 9.4 * s;
  const statLabelPt = 8.25 * s;
  const sentencePt = 9.75 * s;
  const { answer } = figure;

  // 큰 답: 한 줄. 숫자를 24 pt까지 줄이고, 그래도 넘치면 대상을 보조 줄로 내린다. 줄바꿈하지 않는다.
  const preText = answer.pre ? `${answer.pre} ` : "";
  const targetText = answer.target ? ` · ${answer.target}` : "";
  const valueMax = (answer.kind === "name" ? NAME_MAX_PT : NUMBER_MAX_PT) * s;
  const answerWidth = (value: number, withTarget: boolean) => (textIn(preText, prePt) + textIn(answer.value, value) + (withTarget ? textIn(targetText, targetPt) : 0)) * 1.1;
  const largest = (min: number, withTarget: boolean): number | null => {
    for (let p = valueMax; p >= Math.min(min, valueMax) - 1e-9; p -= 0.5) if (answerWidth(p, withTarget) <= inner) return p;
    return null;
  };
  const hardMin = VALUE_HARD_MIN_PT * s;
  let targetOnSub = false;
  let valuePt = largest(VALUE_MIN_PT * s, true);
  if (valuePt === null) {
    targetOnSub = !!answer.target;
    valuePt = largest(VALUE_MIN_PT * s, false) ?? largest(hardMin, false) ?? Math.min(hardMin, valueMax);
  }

  const badgesShown = badges.slice(0, MAX_BADGES);
  const badgesMore = badges.length - badgesShown.length;

  // 보조 줄: (내린 대상 ·) 보조 글 + 끝에 등급 칩. 칩이 줄 절반을 넘으면 칩만 한 줄 아래로 둔다.
  const subText = [targetOnSub ? answer.target : null, figure.sub].filter(Boolean).join(" · ");
  const chipsW = grades.reduce((sum, grade) => sum + textIn(grade, 8 * s) + 0.2 + 0.06, 0);
  const chipsOwnRow = chipsW > inner * 0.5;
  const subLines = subText ? wrap(subText, subPt, grades.length > 0 && !chipsOwnRow ? inner - chipsW : inner, 2) : [];
  const subRows = Math.max(subLines.length, grades.length > 0 && !chipsOwnRow ? 1 : 0) + (grades.length > 0 && chipsOwnRow ? 1 : 0);
  const subRowH = Math.max(pt(subPt) * LINE, 0.19 * s);

  // 보조 숫자(열 수만큼 칸, 넘치면 다음 줄) 또는 구성 막대(A12) + 항목 목록
  const parts = figure.parts ?? [];
  const stats = parts.length > 0 ? [] : figure.stats.slice(0, 3);
  const cellW = (inner - (columns - 1) * 0.02) / columns - 0.12;
  let statValuePt = 15 * s;
  while (statValuePt > 9 * s && stats.some((stat) => textIn(stat.value, statValuePt) * 1.1 > cellW)) statValuePt -= 0.5;
  const statRows = Math.ceil(stats.length / columns);
  const labelLines = stats.reduce((max, stat) => Math.max(max, Math.min(2, linesOf(stat.label, statLabelPt, cellW))), 1);
  const statsH = stats.length > 0 ? statRows * (pt(statValuePt) * 1.2 + labelLines * pt(statLabelPt) * LINE + 0.04) + (statRows - 1) * 0.08 : 0;
  const partsH = parts.length > 0 ? 0.14 + 0.08 + Math.min(parts.length, 6) * (pt(subPt) * LINE + 0.03) : 0;

  // 해석 한 줄: ①은 카드 맨 아래, ②는 열 맨 아래(카드 밖이라 카드 안쪽 여백이 없다)
  const sentenceLines = sentence ? wrap(sentence, sentencePt, (columns === 3 ? width : inner) - SENTENCE_BAR, 2) : [];
  const sentenceH = sentenceLines.length * pt(sentencePt) * LINE;

  let height = PAD_TOP + pt(questionPt) * LINE + 0.06 + pt(Math.max(prePt, valuePt, targetPt)) * ANSWER_LINE;
  if (subRows > 0) height += 0.04 + subRows * subRowH;
  if (filterLine) height += 0.03 + pt(subPt) * LINE;
  if (statsH + partsH > 0) height += 0.146 + 0.01 + 0.1 + statsH + partsH;
  if (columns === 2 && sentenceH > 0) height += 0.12 + sentenceH;
  height += PAD_BOTTOM;

  return { height, questionPt, prePt, valuePt, targetPt, subPt, statValuePt, statLabelPt, sentencePt, targetOnSub, badgesShown, badgesMore, sentenceLines, subLines };
}

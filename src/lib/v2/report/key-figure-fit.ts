/**
 * 핵심 숫자 카드의 글자 맞춤·높이·카드 안 칸(spec 2026-10-30 §4-1·§7). 화면 카드와 PPT 카드가 같은 pt·줄·사각형을 쓰도록 한 곳에서 계산하는 순수 함수다.
 * 글자 폭 어림은 pptx-kit의 textIn(한글 1 em·그 밖 0.56 em)이다. 큰 답은 여유 없이 안쪽 폭에 맞추고(어림 오차는 카드 오른쪽 안쪽 여백이 받는다), 보조 숫자 칸은 10 % 여유를 둔다.
 * 시안 pt(summaryPt 13일 때)는 질문 9.4 · 앞말 18 · 숫자 43.5 · 이름 답 23 · 대상·뒷말 21 · 보조 줄 9.4 · 보조 숫자 15 / 8.25 · 해석 9.75이고, summaryPt / 13 배로 같이 커진다.
 * `width`는 카드 바깥 폭이다. columns 2는 ①(해석 한 줄이 카드 맨 아래), 3은 ②(해석은 열 맨 아래 카드 밖)이다.
 * `rows`의 사각형은 모두 카드 왼쪽 위를 (0, 0)으로 한 inch다. 화면과 PPT는 이 사각형에 그리기만 한다.
 */
import type { KeyFigure } from "../tile/types";
import type { Rect } from "../ui/overlay-layout";
import { NOTES_CHIP_GAP, NOTES_CHIP_SIZE } from "./report-geometry";
import { wrapToLines } from "./analysis-column-fit";
import { textIn } from "./pptx-kit";

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
  /** 카드 높이 상한(저장한 카드 크기). 넘으면 높이가 맞을 때까지 글자 배율을 줄인다. 없으면 줄이지 않는다. */
  maxHeight?: number;
  /** `주석 N` 칩이 있으면(기본 true) ②의 해석 줄 폭에서 칩 자리를 뺀다. */
  notes?: boolean;
};

export type KeyFigureRows = {
  questionBar: Rect; question: Rect;
  /** 질문 줄 오른쪽 끝의 상태 배지(많으면 마지막이 `+n`) */
  badges: Array<{ text: string; rect: Rect }>;
  /** 큰 답 한 줄(run 셋의 한 텍스트 상자)과 그 기준선 y */
  answer: Rect; answerBaseline: number;
  sub: Rect | null;
  grades: Array<{ text: string; rect: Rect }>;
  filter: Rect | null;
  divider: Rect | null;
  stats: Array<{ cell: Rect; value: Rect; label: Rect }>;
  statSeparators: Rect[];
  /** 구성 막대(A12) 위의 큰 % 한 줄: 큰 값(`value`) 오른쪽에 두 줄 설명(`lines`). 보조 숫자 칸 대신이다. */
  lead: { value: Rect; text: string; desc: Rect; lines: string[] } | null;
  partsBar: Rect | null;
  partsSegments: Array<{ rect: Rect; color: string; site: boolean }>;
  /** `labelText`는 칸에 맞춰 자른 글(넘치면 …), `labelFull`은 전문(화면 title) */
  parts: Array<{ row: Rect; swatch: Rect; label: Rect; share: Rect; labelText: string; labelClipped: boolean; labelFull: string; shareText: string }>;
  /** ①만: 카드 맨 아래 해석 줄(막대 + 글). ②는 null이고 열이 `sentenceHeight`로 그린다. */
  sentenceBar: Rect | null; sentence: Rect | null;
};

export type KeyFigureFit = {
  /** 카드 바깥 높이(inch) */
  height: number;
  questionPt: number; prePt: number; valuePt: number; targetPt: number;
  /** 뒷말(`/㎡` 등). 대상과 같은 크기이고, 큰 답이 넘치면 숫자와 함께 줄어든다. */
  postPt: number;
  subPt: number; statValuePt: number; statLabelPt: number; sentencePt: number;
  /** 구성 막대 위 큰 % (시안 32 px) */
  leadPt: number;
  /** 상태 배지 칩 글자(시안 8 pt)·등급 칩 글자·구성 막대 항목 글자 — 화면과 PPT가 같은 값을 쓴다 */
  chipPt: number; gradePt: number; partPt: number;
  /** 큰 답이 넘쳐 대상 이름을 보조 줄로 내렸다 */
  targetOnSub: boolean;
  badgesShown: string[]; badgesMore: number;
  /** `+n`으로 접힌 배지 글(주석 칩 목록과 `+n` 칩의 title로 보인다) */
  badgesFolded: string[];
  /** 질문 글이 질문 칸보다 길어 …로 잘린다(화면은 질문 전체를 title로 단다). `questionText`가 화면·PPT가 그리는 글이다. */
  questionClipped: boolean; questionText: string;
  /** 보조 숫자 값(칸마다 한 줄, 넘치면 …)과 잘림 여부. 전문은 `figure.stats[i].value`다. */
  statValueText: string[]; statValueClipped: boolean[];
  /** 보조 줄이 두 줄을 넘어 마지막 줄을 …로 닫았다. 전문은 `subFull`(화면 title). */
  subClipped: boolean; subFull: string;
  /** 해석 줄(최대 3줄, 넘치면 마지막 줄을 …로 닫는다). 잘렸으면 `sentenceClipped`, 전문은 `sentenceFull`(화면 title). */
  sentenceLines: string[]; sentenceClipped: boolean; sentenceFull: string;
  /** 해석 줄 블록의 높이. ②는 이 값을 열의 `sentenceHeight`로 넘긴다. */
  sentenceHeight: number;
  /** 보조 줄(대상을 내렸으면 맨 앞에 붙는다, 최대 2줄) */
  subLines: string[];
  /** 보조 숫자 이름(칸마다 최대 2줄, 넘치면 마지막 줄을 …로 닫는다)과 잘림 여부. 전문은 `figure.stats[i].label`이다. */
  statLabelLines: string[][]; statLabelClipped: boolean[];
  /** 적용 필터 글(최대 2줄, 넘치면 마지막 줄을 …로 닫는다) */
  filterLines: string[];
  /** 필터 글이 두 줄을 넘어 잘렸다: 전문은 각주 한계 자리와 카드 줄의 title에 있다 */
  filterClipped: boolean;
  rows: KeyFigureRows;
};

const PAD_X = 0.1875; // 18 px
const PAD_TOP = 0.1875;
const PAD_BOTTOM = 0.1667; // 16 px
const LINE = 1.25; // fitBlock이 가정하는 줄 높이
const ANSWER_LINE = 1.05; // 큰 답은 줄 간격이 없다(한 줄)
const MAX_BADGES = 2;
/** 해석 줄 왼쪽 막대 + 간격. ②의 열 맨 아래 해석 줄도 화면·PPT가 이 값으로 막대와 글을 나눈다. */
export const SENTENCE_BAR = 0.15;
/** 해석 줄·질문 줄 왼쪽 타일 색 막대 폭(3 px) */
export const BAR_W = 0.031;
const HAIR = 0.0104; // 1 px
const NUMBER_MAX_PT = 43.5;
const NAME_MAX_PT = 23;
const VALUE_MIN_PT = 24; // 숫자의 최소 32 px. 이름 답은 23 pt에서 시작하므로 이 하한이 없다.
const MAX_SHRINK_STEPS = 12; // maxHeight 맞춤: 0.05씩 최대 0.4배까지

const pt = (value: number) => value / 72;
const floorHalf = (value: number) => Math.floor(value * 2 + 1e-9) / 2;

export function keyFigureFit(input: KeyFigureFitInput): KeyFigureFit {
  let fit = fitAt(input, input.summaryPt);
  if (input.maxHeight === undefined) return fit;
  for (let step = 1; step <= MAX_SHRINK_STEPS && fit.height > input.maxHeight + 1e-9; step++) fit = fitAt(input, input.summaryPt * (1 - step * 0.05));
  return fit;
}

function fitAt({ figure, badges, grades, filterLine, sentence, width, columns, notes = true }: KeyFigureFitInput, summaryPt: number): KeyFigureFit {
  const s = summaryPt / 13;
  const inner = Math.max(0.5, width - PAD_X * 2);
  const questionPt = 9.4 * s;
  const subPt = 9.4 * s;
  const statLabelPt = 8.25 * s;
  const sentencePt = 9.75 * s;
  const { answer } = figure;
  let prePt = 18 * s;
  const targetPt = 21 * s;
  let postPt = targetPt;

  // 큰 답: 한 줄. 숫자는 24 pt까지(이름 답은 23 pt 그대로) 줄이고, 그래도 넘치면 대상을 보조 줄로 내린다.
  // 그래도 넘치면 안쪽 폭에 맞게 직접 푼다(F1에 비례하는 하한을 두지 않는다). 줄바꿈하지 않는다.
  const preText = answer.pre ? `${answer.pre} ` : "";
  const postText = answer.post ?? "";
  const targetText = answer.target ? ` · ${answer.target}` : "";
  const valueMax = (answer.kind === "name" ? NAME_MAX_PT : NUMBER_MAX_PT) * s;
  const answerWidth = (value: number, withTarget: boolean) => textIn(preText, prePt) + textIn(answer.value, value) + textIn(postText, postPt) + (withTarget ? textIn(targetText, targetPt) : 0);
  const largest = (withTarget: boolean): number | null => {
    for (let p = valueMax; p >= Math.min(VALUE_MIN_PT * s, valueMax) - 1e-9; p -= 0.5) if (answerWidth(p, withTarget) <= inner) return p;
    return null;
  };
  let targetOnSub = false;
  let valuePt = largest(true);
  if (valuePt === null) {
    targetOnSub = !!answer.target;
    valuePt = largest(false);
  }
  if (valuePt === null) {
    const unit = textIn(answer.value, 1);
    const fixed = textIn(preText, prePt) + textIn(postText, postPt);
    if (unit > 0 && fixed <= inner * 0.5) valuePt = floorHalf((inner - fixed) / unit);
    else {
      // 앞말·뒷말만으로도 폭이 모자라면 세 글을 같은 비율로 줄인다.
      const factor = Math.floor((inner / Math.max(1e-9, answerWidth(valueMax, false))) * 100) / 100;
      valuePt = valueMax * factor;
      prePt *= factor;
      postPt *= factor;
    }
  }

  const chipW = (text: string) => textIn(text, 8 * s) + 0.2;
  // 배지 줄은 질문 글을 남긴 자리(질문이 길면 안쪽 폭의 35 %까지)를 넘으면 뒤에서부터 `+n`으로 접는다. 질문 줄이 카드 밖으로 나가지 않게 한다.
  // 첫 배지(상태·한계를 알리는 정직성 배지)는 자기 폭이 안쪽 폭의 절반 안이면 접지 않고 질문 줄이 말줄임을 받는다(Ruling 24).
  const badgeBudget = Math.max(inner * 0.35, inner - (textIn(figure.question, questionPt) + 0.14));
  const badgeRowW = (texts: string[]) => texts.reduce((sum, text) => sum + chipW(text) + 0.06, -0.06);
  const withMore = (shown: string[]) => (badges.length > shown.length ? [...shown, `+${badges.length - shown.length}`] : shown);
  const keepFirst = badges.length > 0 && chipW(badges[0]!) <= inner * 0.5;
  let badgesShown = badges.slice(0, MAX_BADGES);
  while (badgesShown.length > (keepFirst ? 1 : 0) && badgeRowW(withMore(badgesShown)) > badgeBudget) badgesShown = badgesShown.slice(0, -1);
  const badgesMore = badges.length - badgesShown.length;
  const badgesFolded = badges.slice(badgesShown.length);

  const subRowH = Math.max(pt(subPt) * LINE, 0.19 * s);

  // ── 위에서 아래로 쌓는다
  let y = PAD_TOP;
  const qH = pt(questionPt) * LINE;
  const badgeTexts = [...badgesShown, ...(badgesMore > 0 ? [`+${badgesMore}`] : [])];
  const badgeRects: KeyFigureRows["badges"] = [];
  let chipRight = PAD_X + inner;
  for (let i = badgeTexts.length - 1; i >= 0; i--) {
    const w = chipW(badgeTexts[i]!);
    badgeRects.unshift({ text: badgeTexts[i]!, rect: { x: chipRight - w, y, w, h: qH } });
    chipRight -= w + 0.06;
  }
  const qLeft = PAD_X + 0.08;
  const question: Rect = { x: qLeft, y, w: Math.max(0, (badgeRects[0]?.rect.x ?? PAD_X + inner + 0.06) - 0.06 - qLeft), h: qH };
  const questionText = wrapToLines(figure.question, questionPt, question.w, 1)[0] ?? "";
  const questionClipped = questionText !== figure.question.trim();
  const questionBar: Rect = { x: PAD_X, y: y + (qH - 0.125) / 2, w: 0.031, h: 0.125 };
  y += qH + 0.06;

  const answerH = pt(Math.max(prePt, valuePt, targetPt, postPt)) * ANSWER_LINE;
  const answerRect: Rect = { x: PAD_X, y, w: inner, h: answerH };
  const answerBaseline = y + answerH * 0.82;
  y += answerH;

  // 보조 줄: (내린 대상 ·) 보조 글 + 끝에 등급 칩. 칩이 줄 절반을 넘으면 칩만 한 줄 아래로 둔다.
  const subText = [targetOnSub ? answer.target : null, figure.sub].filter(Boolean).join(" · ");
  const chipsW = grades.reduce((sum, grade) => sum + chipW(grade) + 0.06, 0);
  const chipsOwnRow = chipsW > inner * 0.5;
  const subW = grades.length > 0 && !chipsOwnRow ? inner - chipsW : inner;
  const subLines = subText ? wrapToLines(subText, subPt, subW, 2) : [];
  const subClipped = !!subText && wrapToLines(subText, subPt, subW, 3).length > 2;
  const subRows = Math.max(subLines.length, grades.length > 0 && !chipsOwnRow ? 1 : 0) + (grades.length > 0 && chipsOwnRow ? 1 : 0);
  let sub: Rect | null = null;
  const gradeRects: KeyFigureRows["grades"] = [];
  if (subRows > 0) {
    y += 0.04;
    if (subLines.length > 0) sub = { x: PAD_X, y, w: grades.length > 0 && !chipsOwnRow ? inner - chipsW : inner, h: subLines.length * subRowH };
    const row = chipsOwnRow ? subLines.length : Math.max(0, subLines.length - 1);
    const shrink = Math.min(1, inner / Math.max(1e-9, chipsW));
    let right = PAD_X + inner;
    for (let i = grades.length - 1; i >= 0; i--) {
      const w = chipW(grades[i]!) * shrink;
      gradeRects.unshift({ text: grades[i]!, rect: { x: right - w, y: y + row * subRowH, w, h: subRowH } });
      right -= (chipW(grades[i]!) + 0.06) * shrink;
    }
    y += subRows * subRowH;
  }

  let filter: Rect | null = null;
  const filterLines = filterLine ? wrapToLines(filterLine, subPt, inner, 2) : [];
  const filterClipped = !!filterLine && wrapToLines(filterLine, subPt, inner, 3).length > 2;
  if (filterLines.length > 0) {
    y += 0.03;
    filter = { x: PAD_X, y, w: inner, h: filterLines.length * pt(subPt) * LINE };
    y += filter.h;
  }

  // 보조 숫자(열 수만큼 칸, 넘치면 다음 줄) 또는 구성 막대(A12) + 항목 목록
  const parts = (figure.parts ?? []).slice(0, 6);
  const stats = parts.length > 0 ? [] : figure.stats.slice(0, 3);
  let divider: Rect | null = null;
  if (stats.length > 0 || parts.length > 0) {
    y += 0.146;
    divider = { x: PAD_X, y, w: inner, h: HAIR };
    y += HAIR + 0.1;
  }

  const cellFullW = (inner - (columns - 1) * 0.02) / columns;
  const textW = cellFullW - 0.12;
  let statValuePt = 15 * s;
  while (statValuePt > 8 * s && stats.some((stat) => textIn(stat.value, statValuePt) * 1.1 > textW)) statValuePt -= 0.5;
  // 보조 숫자 값은 한 줄이다. 줄일 만큼 줄여도 넘치면 …로 닫는다(PPT 상자는 자르지 않으므로 여기서 자른다).
  const statValueText = stats.map((stat) => wrapToLines(stat.value, statValuePt, textW, 1)[0] ?? "");
  const statValueClipped = stats.map((stat, i) => statValueText[i] !== stat.value.trim());
  // 보조 숫자 이름은 최대 2줄: 줄을 여기서 나눠 화면과 PPT가 같은 줄을 그린다(PPT 상자가 다시 접지 않는다).
  const statLabelLines = stats.map((stat) => wrapToLines(stat.label, statLabelPt, textW, 2));
  const statLabelClipped = stats.map((stat) => wrapToLines(stat.label, statLabelPt, textW, 3).length > 2);
  const labelLines = statLabelLines.reduce((max, lines) => Math.max(max, lines.length), 1);
  const valueH = pt(statValuePt) * 1.2;
  const cellH = valueH + labelLines * pt(statLabelPt) * LINE + 0.04;
  const statCells: KeyFigureRows["stats"] = [];
  const statSeparators: Rect[] = [];
  stats.forEach((_, i) => {
    const r = Math.floor(i / columns);
    const c = i % columns;
    const cell: Rect = { x: PAD_X + c * (cellFullW + 0.02), y: y + r * (cellH + 0.08), w: cellFullW, h: cellH };
    statCells.push({ cell, value: { x: cell.x + 0.06, y: cell.y, w: textW, h: valueH }, label: { x: cell.x + 0.06, y: cell.y + valueH, w: textW, h: cell.h - valueH - 0.04 } });
    if (c < columns - 1 && i + 1 < stats.length) statSeparators.push({ x: cell.x + cell.w + 0.005, y: cell.y, w: HAIR, h: cellH - 0.04 });
  });
  if (stats.length > 0) {
    const rowCount = Math.ceil(stats.length / columns);
    y += rowCount * cellH + (rowCount - 1) * 0.08;
  }

  // 구성 막대가 있는 카드(A12)는 보조 숫자 대신 큰 % + 두 줄 설명(시안 A-zoning)을 막대 위에 둔다. 설명 둘째 줄은 둘째 보조 숫자의 이름(앞의 `반경 n 중` 뺀 것)과 값이다.
  const leadPt = 24 * s;
  let lead: KeyFigureRows["lead"] = null;
  if (parts.length > 0 && figure.stats.length > 0) {
    const [first, second] = figure.stats;
    const valueW = textIn(first!.value, leadPt) + 0.04;
    const descW = Math.max(0.3, inner - valueW - 0.12);
    const oneLine = (text: string) => wrapToLines(text, statLabelPt, descW, 1)[0] ?? "";
    const lines = [first!.label, ...(second ? [`${second.label.replace(/^반경 \S+ 중 /, "")} 전체 ${second.value}`] : [])].map(oneLine);
    const h = Math.max(pt(leadPt) * 1.05, lines.length * pt(statLabelPt) * LINE);
    lead = { value: { x: PAD_X, y, w: valueW, h }, text: first!.value, desc: { x: PAD_X + valueW + 0.12, y, w: descW, h }, lines };
    y += h + 0.08;
  }

  let partsBar: Rect | null = null;
  const partsSegments: KeyFigureRows["partsSegments"] = [];
  const partRows: KeyFigureRows["parts"] = [];
  if (parts.length > 0) {
    partsBar = { x: PAD_X, y, w: inner, h: 0.14 };
    const total = parts.reduce((sum, part) => sum + Math.max(0, part.share), 0);
    let x = PAD_X;
    parts.forEach((part, i) => {
      const w = i === parts.length - 1 ? PAD_X + inner - x : inner * (total > 0 ? Math.max(0, part.share) / total : 1 / parts.length);
      partsSegments.push({ rect: { x, y, w, h: partsBar!.h }, color: part.color, site: !!part.site });
      x += w;
    });
    y += partsBar.h + 0.08;
    const rowH = pt(subPt) * LINE + 0.03;
    const swatch = Math.min(0.1, rowH - 0.03);
    const shareW = Math.min(0.6, inner / 3);
    const partPt = statLabelPt * (11.5 / 11);
    for (const part of parts) {
      const label = { x: PAD_X + swatch + 0.06, y, w: Math.max(0, inner - swatch - 0.06 - shareW), h: rowH - 0.03 };
      // 이름의 「지역」은 줄인다(시안). 칸보다 길면 …로 닫는다. 몫은 소수 1자리 %.
      const shortLabel = part.label.replace(/지역$/, "");
      const labelText = wrapToLines(shortLabel, partPt, label.w, 1)[0] ?? "";
      partRows.push({
        row: { x: PAD_X, y, w: inner, h: rowH },
        swatch: { x: PAD_X, y: y + 0.015, w: swatch, h: swatch },
        label,
        share: { x: PAD_X + inner - shareW, y, w: shareW, h: rowH - 0.03 },
        labelText,
        labelClipped: labelText !== shortLabel.trim(),
        labelFull: part.label,
        shareText: `${part.share.toFixed(1)}%`,
      });
      y += rowH;
    }
  }

  // 해석 한 줄: ①은 카드 맨 아래, ②는 열 맨 아래(카드 밖이라 카드 안쪽 여백이 없고, 주석 칩이 있으면 칩 자리를 뺀다)
  const { lines: sentenceLines, height: sentenceHeight, clipped: sentenceClipped } = sentenceFit({ sentence, width, columns, summaryPt, notes });
  let sentenceBar: Rect | null = null;
  let sentenceRect: Rect | null = null;
  if (columns === 2 && sentenceHeight > 0) {
    y += 0.12;
    sentenceBar = { x: PAD_X, y, w: 0.031, h: sentenceHeight };
    sentenceRect = { x: PAD_X + SENTENCE_BAR, y, w: inner - SENTENCE_BAR, h: sentenceHeight };
    y += sentenceHeight;
  }

  const height = y + PAD_BOTTOM;
  const rows: KeyFigureRows = { questionBar, question, badges: badgeRects, answer: answerRect, answerBaseline, sub, grades: gradeRects, filter, divider, stats: statCells, statSeparators, lead, partsBar, partsSegments, parts: partRows, sentenceBar, sentence: sentenceRect };
  return { height, questionPt, prePt, valuePt, targetPt, postPt, subPt, statValuePt, statLabelPt, sentencePt, leadPt, chipPt: 8 * s, gradePt: subPt * (8.5 / 9.4), partPt: statLabelPt * (11.5 / 11), targetOnSub, badgesShown, badgesMore, badgesFolded, questionClipped, questionText, statValueText, statValueClipped, subClipped, subFull: subText, sentenceLines, sentenceClipped, sentenceFull: sentence ?? "", sentenceHeight, subLines, statLabelLines, statLabelClipped, filterLines, filterClipped, rows };
}

/**
 * 해석 줄(최대 3줄, 넘치면 …). 카드가 없는 ②(핵심 숫자 없음)도 사용자가 고친 요약 같은 해석 줄은 그리므로 카드 맞춤과 따로 부를 수 있다.
 * `width`는 ①이면 카드 바깥 폭, ②이면 열 폭이다.
 */
export function sentenceFit({ sentence, width, columns, summaryPt, notes = true }: { sentence: string | null; width: number; columns: 2 | 3; summaryPt: number; notes?: boolean }): { lines: string[]; pt: number; height: number; clipped: boolean } {
  const sentencePt = 9.75 * (summaryPt / 13);
  const inner = Math.max(0.5, width - PAD_X * 2);
  const sentenceW = (columns === 3 ? width - (notes ? NOTES_CHIP_SIZE.w + NOTES_CHIP_GAP : 0) : inner) - SENTENCE_BAR;
  const lines = sentence ? wrapToLines(sentence, sentencePt, sentenceW, 3) : [];
  return { lines, pt: sentencePt, height: lines.length * pt(sentencePt) * LINE, clipped: !!sentence && wrapToLines(sentence, sentencePt, sentenceW, 4).length > 3 };
}

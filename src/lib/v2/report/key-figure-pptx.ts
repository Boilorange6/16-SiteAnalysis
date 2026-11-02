/**
 * 핵심 숫자 카드(spec 2026-10-30 §4-1)를 PPT 도형으로 그린다. 화면 `key-figure-card.tsx`와 같은 `keyFigureFit` 값(`fit.rows` 자리·pt·줄)만 읽고
 * 배치 숫자를 새로 두지 않는다. 카드 = 둥근 사각형 1 + 칸마다 글상자·도형이고, 큰 답은 상자 하나에 run 셋(앞말·숫자·대상)이다.
 * 글은 모두 줄바꿈·자동 맞춤 없이 `fit`이 이미 줄을 나눈 대로 그린다(PowerPoint의 자동 줄임은 편집할 때만 적용돼 믿을 수 없다).
 */
import type { KeyFigureFit } from "./key-figure-fit";
import { CHIP, FONT, INK, MUTED, hex, textIn, type Slide } from "./pptx-kit";
import type { Rect } from "../ui/overlay-layout";
import type { TileView } from "../ui/tile-view";

const CARD_LINE = "E1E4E9";
const RULE = "ECECEA";
const GRADE_CHIP: Record<"good" | "fair" | "caution", { fill: string; color: string }> = {
  good: { fill: "E3F3E8", color: "17603A" },
  fair: CHIP.status,
  caution: { fill: "FBE3E1", color: "8A1F17" },
};

/** 한 줄 글을 폭 안에 닫는다(…). 화면은 CSS text-overflow인데 PPT에는 없으므로 같은 어림(textIn)으로 미리 자른다. */
function clip(text: string, pt: number, width: number): string {
  if (textIn(text, pt) <= width) return text;
  let cut = [...text];
  while (cut.length > 1 && textIn(`${cut.join("")}…`, pt) > width) cut = cut.slice(0, -1);
  return `${cut.join("").trimEnd()}…`;
}

export type KeyFigureCardInput = {
  view: TileView;
  fit: KeyFigureFit;
  /** 카드 자리(장 inch) */
  rect: Rect;
  /** 도형 이름: 부위를 받아 `GRP|panel-summary|핵심 숫자|부위`를 돌려준다 */
  tag: (part: string) => string;
};

export function drawKeyFigureCard(s: Slide, { view, fit, rect, tag }: KeyFigureCardInput): void {
  const figure = view.keyFigure;
  if (!figure) return;
  const { rows } = fit;
  const at = (r: Rect): Rect => ({ x: rect.x + r.x, y: rect.y + r.y, w: r.w, h: r.h });
  const text = (value: string | Array<{ text: string; options?: Record<string, unknown> }>, r: Rect, part: string, options: Record<string, unknown>) =>
    s.addText(value as never, { ...at(r), fontFace: FONT, margin: 0, wrap: false, objectName: tag(part), ...options } as never);
  const tone = (value: string) => view.badges.find((badge) => badge.text === value)?.tone ?? "limit";

  s.addShape("roundRect", {
    ...rect, rectRadius: 0.125, fill: { color: "FFFFFF" }, line: { color: CARD_LINE, width: 0.75 },
    shadow: { type: "outer", color: "15171C", opacity: 0.08, blur: 6, offset: 1.5, angle: 90 },
    objectName: tag("card"),
  });
  const bar = (r: Rect, part: string) => s.addShape("roundRect", { ...at(r), rectRadius: Math.min(r.w, r.h) / 2, fill: { color: hex(view.color) }, line: { color: hex(view.color), width: 0 }, objectName: tag(part) });
  const pill = (r: Rect, label: string, part: string, pt: number, colors: { fill: string; color: string }) => {
    s.addShape("roundRect", { ...at(r), rectRadius: r.h / 2, fill: { color: colors.fill }, line: { color: colors.fill, width: 0 }, objectName: tag(`${part}-bg`) });
    text(label, r, part, { fontSize: pt, bold: true, color: colors.color, align: "center", valign: "middle" });
  };
  // 여러 줄 글: 줄은 `fit`이 이미 나눴으므로 문단으로 잇고, 줄 간격(pt)은 화면 줄 높이와 같다.
  const lines = (list: readonly string[], r: Rect, part: string, pt: number, spacingPt: number, options: Record<string, unknown> = {}) =>
    text(list.map((line, i) => ({ text: line, options: { breakLine: i < list.length - 1 } })), r, part, { fontSize: pt, lineSpacing: spacingPt, valign: "top", ...options });

  // 질문 줄 + 상태 배지(많으면 마지막이 `+n`)
  bar(rows.questionBar, "question-bar");
  text(clip(figure.question, fit.questionPt, rows.question.w), rows.question, "question", { fontSize: fit.questionPt, bold: true, color: MUTED, valign: "middle" });
  rows.badges.forEach((badge, i) => {
    const folded = fit.badgesMore > 0 && i === rows.badges.length - 1;
    pill(badge.rect, badge.text, `badge-${i}`, fit.chipPt, CHIP[folded ? "limit" : tone(badge.text)]);
  });

  // 큰 답: 한 상자에 run 셋(앞말·숫자·대상). 숫자는 `fit.valuePt`다.
  const pre = figure.answer.pre ? `${figure.answer.pre} ` : "";
  const target = !fit.targetOnSub && figure.answer.target ? ` · ${figure.answer.target}` : "";
  const runs = [
    ...(pre ? [{ text: pre, options: { fontSize: fit.prePt, bold: true, color: INK } }] : []),
    { text: figure.answer.value, options: { fontSize: fit.valuePt, bold: true, color: INK } },
    ...(figure.answer.post ? [{ text: figure.answer.post, options: { fontSize: fit.postPt, bold: true, color: INK } }] : []),
    ...(target ? [{ text: target, options: { fontSize: fit.targetPt, bold: true, color: INK } }] : []),
  ];
  text(runs, rows.answer, "answer", { valign: "middle" });

  // 보조 줄(+ 등급 칩)·A05 필터 줄
  if (rows.sub) lines(fit.subLines, rows.sub, "sub", fit.subPt, (rows.sub.h / Math.max(1, fit.subLines.length)) * 72, { color: MUTED });
  rows.grades.forEach((grade, i) => pill(grade.rect, grade.text, `grade-${i}`, fit.gradePt, GRADE_CHIP[view.grades[i]?.level ?? "fair"]));
  if (rows.filter) lines(fit.filterLines, rows.filter, "filter", fit.subPt, (rows.filter.h / fit.filterLines.length) * 72, { color: MUTED });

  // 구분선·보조 숫자
  const rule = (r: Rect, part: string) => s.addShape("rect", { ...at(r), fill: { color: RULE }, line: { color: RULE, width: 0 }, objectName: tag(part) });
  if (rows.divider) rule(rows.divider, "divider");
  rows.stats.forEach((stat, i) => {
    text(figure.stats[i]?.value ?? "", stat.value, `stat-value-${i}`, { fontSize: fit.statValuePt, bold: true, color: INK, valign: "middle" });
    lines(fit.statLabelLines[i] ?? [], stat.label, `stat-label-${i}`, fit.statLabelPt, fit.statLabelPt * 1.25, { color: MUTED });
  });
  rows.statSeparators.forEach((sep, i) => rule(sep, `stat-separator-${i}`));

  // A12 구성 막대 위 큰 %(+ 두 줄 설명: 둘째 줄 끝의 %는 굵게)
  if (rows.lead) {
    text(rows.lead.text, rows.lead.value, "lead", { fontSize: fit.leadPt, bold: true, color: INK, valign: "middle" });
    const desc = rows.lead.lines.flatMap((line, i): Array<{ text: string; options: Record<string, unknown> }> => {
      const match = i > 0 ? /^(.*?)(\d[\d.,]*%)$/.exec(line) : null;
      const brk = i < rows.lead!.lines.length - 1;
      return match
        ? [{ text: match[1]!, options: { color: MUTED } }, { text: match[2]!, options: { color: INK, bold: true, breakLine: brk } }]
        : [{ text: line, options: { color: MUTED, breakLine: brk } }];
    });
    text(desc, rows.lead.desc, "lead-desc", { fontSize: fit.statLabelPt, lineSpacing: (rows.lead.desc.h / Math.max(1, rows.lead.lines.length)) * 72, valign: "top" });
  }

  // 구성 막대(칸 사이 흰 구분선, 대지 칸은 검은 테두리)와 항목 목록
  if (rows.partsBar) {
    rows.partsSegments.forEach((segment, i) => {
      s.addShape("rect", { ...at(segment.rect), fill: { color: hex(segment.color) }, line: { color: hex(segment.color), width: 0 }, objectName: tag(`parts-segment-${i}`) });
      if (i > 0) s.addShape("rect", { x: rect.x + segment.rect.x, y: rect.y + segment.rect.y, w: 0.0104, h: segment.rect.h, fill: { color: "FFFFFF" }, line: { color: "FFFFFF", width: 0 }, objectName: tag(`parts-gap-${i}`) });
      if (segment.site) s.addShape("rect", { ...at(segment.rect), fill: { color: "FFFFFF", transparency: 100 }, line: { color: "111111", width: 1.5 }, objectName: tag(`parts-site-${i}`) });
    });
  }
  rows.parts.forEach((row, i) => {
    const part = figure.parts?.[i];
    if (!part) return;
    const ink = part.site ? INK : MUTED;
    s.addShape("rect", { ...at(row.swatch), fill: { color: hex(part.color) }, line: { color: INK, width: 0.75, transparency: 88 }, objectName: tag(`part-swatch-${i}`) });
    text(row.labelText, row.label, `part-label-${i}`, { fontSize: fit.partPt, bold: !!part.site, color: ink, valign: "middle" });
    text(row.shareText, row.share, `part-share-${i}`, { fontSize: fit.partPt, bold: !!part.site, color: ink, valign: "middle", align: "right" });
  });

  // ① 카드 맨 아래 해석 한 줄(타일 색 막대 + 글)
  if (rows.sentenceBar) bar(rows.sentenceBar, "sentence-bar");
  if (rows.sentence) lines(fit.sentenceLines, rows.sentence, "sentence", fit.sentencePt, fit.sentencePt * 1.25, { bold: true, color: INK });
}

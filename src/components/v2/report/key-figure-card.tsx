"use client";

import * as React from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import { CHIP } from "@/lib/v2/report/pptx-kit";
import type { KeyFigureFit } from "@/lib/v2/report/key-figure-fit";
import type { Rect } from "@/lib/v2/ui/overlay-layout";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { fontStyle } from "./surface-style";

/**
 * 핵심 숫자 카드(spec 2026-10-30 §4-1). 안의 모든 칸은 `keyFigureFit`이 정한 `fit.rows`(카드 왼쪽 위 기준 inch) 자리에 그리기만 한다.
 * 카드 높이·글자 크기·줄바꿈은 PPT(Task 7)와 같은 값이라 여기서 다시 쌓지 않는다. 큰 답은 SVG 한 줄(기준선 `answerBaseline`)로 그린다.
 */

type Styles = Record<string, string>;

const INK = "#15171c";
const SUB = "#5b616b";
const GRADE_CHIP: Record<"good" | "fair" | "caution", { fill: string; color: string }> = {
  good: { fill: "#e3f3e8", color: "#17603a" },
  fair: { fill: `#${CHIP.status.fill}`, color: `#${CHIP.status.color}` },
  caution: { fill: "#fbe3e1", color: "#8a1f17" },
};

/** `rect`(카드 왼쪽 위 기준 inch)를 카드 안 절대 위치로 */
const at = (r: Rect, unit: number, extra: CSSProperties = {}): CSSProperties => ({ position: "absolute", left: r.x * unit, top: r.y * unit, width: r.w * unit, height: r.h * unit, ...extra });

/** 한 줄 글 칸: 칸 높이를 줄 높이로 써서 세로 가운데에 놓고, 넘치면 …로 자른다(fit이 이미 자른 글은 넘치지 않는다). */
const line = (r: Rect, unit: number, pt: number, extra: CSSProperties = {}): CSSProperties => ({ ...at(r, unit), ...fontStyle(pt, unit), lineHeight: `${r.h * unit}px`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...extra });

/** 잘려서 마우스 title에만 있던 전문을 스크린리더용 숨은 글로도 둔다(보이는 모양 변화 없음). 잘린 글 쪽은 aria-hidden으로 겹쳐 읽지 않게 한다. */
export function FullText({ styles, text }: { styles: Styles; text?: string | null }) {
  return text ? <span className={styles.srOnly}>{text}</span> : null;
}

export function KeyFigureCard({ styles, view, fit, rect, unit, interaction }: { styles: Styles; view: TileView; fit: KeyFigureFit; rect: Rect; unit: number; interaction?: HTMLAttributes<HTMLDivElement> & Record<string, unknown> }) {
  const figure = view.keyFigure;
  if (!figure) return null;
  const { rows } = fit;
  const color = view.color;
  const tone = (text: string) => view.badges.find((badge) => badge.text === text)?.tone ?? "limit";
  const ptPx = unit / 72;
  const answerBase = (rows.answerBaseline - rows.answer.y) * unit;
  const answerSize = (pt: number) => pt * ptPx;
  const pre = figure.answer.pre ? `${figure.answer.pre} ` : "";
  const target = !fit.targetOnSub && figure.answer.target ? ` · ${figure.answer.target}` : "";
  const leadDesc = rows.lead?.lines ?? [];
  return (
    <div
      className={styles.kfCard}
      data-part="key-figure"
      style={at(rect, unit, { borderRadius: 0.125 * unit })}
      {...interaction}
    >
      <span className={styles.kfBar} data-part="key-question-bar" style={at(rows.questionBar, unit, { background: color })} />
      <span className={styles.kfText} data-part="key-question" title={fit.questionClipped ? figure.question : undefined} aria-hidden={fit.questionClipped || undefined} style={line(rows.question, unit, fit.questionPt, { color: SUB, fontWeight: 700 })}>{fit.questionText}</span>
      <FullText styles={styles} text={fit.questionClipped ? figure.question : null} />
      {rows.badges.map((badge, i) => {
        const folded = fit.badgesMore > 0 && i === rows.badges.length - 1;
        const chip = CHIP[folded ? "limit" : tone(badge.text)];
        // `+n` 칩은 접힌 배지 글을 title·aria-label로 보인다(같은 글이 주석 칩에도 올라 있다).
        const foldedText = folded ? fit.badgesFolded.join(", ") : undefined;
        return <span key={badge.text + i} className={styles.kfChip} data-part="key-badge" title={foldedText} aria-label={foldedText ? `${badge.text}: ${foldedText}` : undefined} style={line(badge.rect, unit, fit.chipPt, { background: `#${chip.fill}`, color: `#${chip.color}`, fontWeight: 700, borderRadius: badge.rect.h * unit, textAlign: "center", textOverflow: "clip" })}>{badge.text}</span>;
      })}
      <svg className={styles.kfAnswer} data-part="key-answer" role="img" aria-label={`${pre}${figure.answer.value}${figure.answer.post ?? ""}${target}`} width={rows.answer.w * unit} height={rows.answer.h * unit} style={at(rows.answer, unit, { overflow: "visible" })}>
        <text x={0} y={answerBase} fill={INK} style={{ whiteSpace: "pre", fontVariantNumeric: "tabular-nums" }}>
          {pre && <tspan fontSize={answerSize(fit.prePt)} fontWeight={700}>{pre}</tspan>}
          <tspan fontSize={answerSize(fit.valuePt)} fontWeight={900}>{figure.answer.value}</tspan>
          {figure.answer.post && <tspan fontSize={answerSize(fit.postPt)} fontWeight={900}>{figure.answer.post}</tspan>}
          {target && <tspan fontSize={answerSize(fit.targetPt)} fontWeight={900}>{target}</tspan>}
        </text>
      </svg>
      {rows.sub && <span className={styles.kfText} data-part="key-sub" title={fit.subClipped ? fit.subFull : undefined} aria-hidden={fit.subClipped || undefined} style={{ ...at(rows.sub, unit), ...fontStyle(fit.subPt, unit), lineHeight: `${(rows.sub.h / Math.max(1, fit.subLines.length)) * unit}px`, color: SUB, fontWeight: 500, whiteSpace: "pre-line", overflow: "hidden" }}>{fit.subLines.join("\n")}</span>}
      {rows.sub && <FullText styles={styles} text={fit.subClipped ? fit.subFull : null} />}
      {rows.grades.map((grade, i) => {
        const level = view.grades[i]?.level ?? "fair";
        return <span key={grade.text} className={styles.kfChip} data-part="key-grade" data-level={level} style={line(grade.rect, unit, fit.gradePt, { background: GRADE_CHIP[level].fill, color: GRADE_CHIP[level].color, fontWeight: 700, borderRadius: grade.rect.h * unit, textAlign: "center", textOverflow: "clip" })}>{grade.text}</span>;
      })}
      {rows.filter && <span className={styles.kfText} data-part="key-filter" title={fit.filterClipped ? view.filterLine ?? undefined : undefined} aria-hidden={fit.filterClipped || undefined} style={{ ...at(rows.filter, unit), ...fontStyle(fit.subPt, unit), lineHeight: `${(rows.filter.h / fit.filterLines.length) * unit}px`, color: SUB, fontWeight: 500, whiteSpace: "pre-line", overflow: "hidden" }}>{fit.filterLines.join("\n")}</span>}
      {rows.filter && <FullText styles={styles} text={fit.filterClipped ? view.filterLine : null} />}
      {rows.divider && <span className={styles.kfRule} data-part="key-divider" style={at(rows.divider, unit)} />}
      {rows.stats.map((stat, i) => (
        <React.Fragment key={i}>
          <span className={styles.kfText} data-part="key-stat-value" title={fit.statValueClipped[i] ? figure.stats[i]?.value : undefined} aria-hidden={fit.statValueClipped[i] || undefined} style={line(stat.value, unit, fit.statValuePt, { color: INK, fontWeight: 900, fontVariantNumeric: "tabular-nums" })}>{fit.statValueText[i]}</span>
          <FullText styles={styles} text={fit.statValueClipped[i] ? figure.stats[i]?.value : null} />
          <span className={styles.kfText} data-part="key-stat-label" title={fit.statLabelClipped[i] ? figure.stats[i]?.label : undefined} aria-hidden={fit.statLabelClipped[i] || undefined} style={{ ...at(stat.label, unit), ...fontStyle(fit.statLabelPt, unit), lineHeight: 1.25, color: SUB, fontWeight: 500, whiteSpace: "pre", overflow: "hidden" }}>{fit.statLabelLines[i]?.join("\n")}</span>
          <FullText styles={styles} text={fit.statLabelClipped[i] ? figure.stats[i]?.label : null} />
        </React.Fragment>
      ))}
      {rows.statSeparators.map((sep, i) => <span key={i} className={styles.kfRule} style={at(sep, unit)} />)}
      {rows.lead && (
        <>
          <span className={styles.kfText} data-part="key-lead" style={line(rows.lead.value, unit, fit.leadPt, { color: INK, fontWeight: 900, fontVariantNumeric: "tabular-nums", overflow: "visible", textOverflow: "clip" })}>{rows.lead.text}</span>
          <span className={styles.kfText} data-part="key-lead-desc" style={{ ...at(rows.lead.desc, unit), ...fontStyle(fit.statLabelPt, unit), lineHeight: `${(rows.lead.desc.h / Math.max(1, leadDesc.length)) * unit}px`, color: SUB, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden" }}>
            {leadDesc.map((text, i) => {
              const match = i > 0 ? /^(.*?)(\d[\d.,]*%)$/.exec(text) : null;
              return <span key={i} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{match ? <>{match[1]}<strong style={{ color: INK, fontWeight: 900 }}>{match[2]}</strong></> : text}</span>;
            })}
          </span>
        </>
      )}
      {rows.partsBar && (
        <span className={styles.kfPartsBar} data-part="key-parts-bar" style={at(rows.partsBar, unit, { borderRadius: 0.052 * unit })}>
          {rows.partsSegments.map((segment, i) => (
            <span
              key={i}
              data-part="key-parts-segment"
              data-site={segment.site ? "true" : undefined}
              // 같은 색 조각(일반주거 세분)은 칸 사이 흰 구분선으로, 대지 칸은 검은 테두리로 가른다(Ruling 6).
              style={{ position: "absolute", left: (segment.rect.x - rows.partsBar!.x) * unit, top: 0, width: segment.rect.w * unit, height: segment.rect.h * unit, background: segment.color, boxShadow: [i > 0 ? "inset 1px 0 0 #fff" : "", segment.site ? "inset 0 0 0 2px #111" : ""].filter(Boolean).join(", ") || "none" }}
            />
          ))}
        </span>
      )}
      {rows.parts.map((row, i) => {
        const part = figure.parts?.[i];
        if (!part) return null;
        return (
          <React.Fragment key={i}>
            <span className={styles.kfSwatch} style={at(row.swatch, unit, { background: part.color, borderRadius: 0.02 * unit })} />
            <span className={styles.kfText} data-part="key-part-label" title={row.labelClipped ? row.labelFull : undefined} aria-hidden={row.labelClipped || undefined} style={line(row.label, unit, fit.partPt, { color: part.site ? INK : SUB, fontWeight: part.site ? 900 : 500 })}>{row.labelText}</span>
            <FullText styles={styles} text={row.labelClipped ? row.labelFull : null} />
            <span className={styles.kfText} data-part="key-part-share" style={line(row.share, unit, fit.partPt, { color: part.site ? INK : SUB, fontWeight: part.site ? 900 : 500, textAlign: "right", fontVariantNumeric: "tabular-nums" })}>{row.shareText}</span>
          </React.Fragment>
        );
      })}
      {rows.sentenceBar && <span className={styles.kfBar} style={at(rows.sentenceBar, unit, { background: color })} />}
      {rows.sentence && <span className={styles.kfText} data-part="key-sentence" title={fit.sentenceClipped ? fit.sentenceFull : undefined} aria-hidden={fit.sentenceClipped || undefined} style={{ ...at(rows.sentence, unit), ...fontStyle(fit.sentencePt, unit), lineHeight: 1.25, color: INK, fontWeight: 700, whiteSpace: "pre-line", overflow: "hidden", textWrap: "balance" } as CSSProperties}>{fit.sentenceLines.join("\n")}</span>}
      {rows.sentence && <FullText styles={styles} text={fit.sentenceClipped ? fit.sentenceFull : null} />}
    </div>
  );
}

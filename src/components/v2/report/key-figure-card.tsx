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

export function KeyFigureCard({ styles, view, fit, rect, unit, interaction }: { styles: Styles; view: TileView; fit: KeyFigureFit; rect: Rect; unit: number; interaction?: HTMLAttributes<HTMLDivElement> & Record<string, unknown> }) {
  const figure = view.keyFigure;
  if (!figure) return null;
  const { rows } = fit;
  const color = view.color;
  const chipPt = fit.questionPt * (8 / 9.4);
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
      <span className={styles.kfText} data-part="key-question" style={line(rows.question, unit, fit.questionPt, { color: SUB, fontWeight: 700 })}>{figure.question}</span>
      {rows.badges.map((badge, i) => {
        const chip = CHIP[badge.text.startsWith("+") && i === rows.badges.length - 1 && fit.badgesMore > 0 ? "limit" : tone(badge.text)];
        return <span key={badge.text + i} className={styles.kfChip} data-part="key-badge" style={line(badge.rect, unit, chipPt, { background: `#${chip.fill}`, color: `#${chip.color}`, fontWeight: 700, borderRadius: badge.rect.h * unit, textAlign: "center", textOverflow: "clip" })}>{badge.text}</span>;
      })}
      <svg className={styles.kfAnswer} data-part="key-answer" role="img" aria-label={`${pre}${figure.answer.value}${figure.answer.post ?? ""}${target}`} width={rows.answer.w * unit} height={rows.answer.h * unit} style={at(rows.answer, unit, { overflow: "visible" })}>
        <text x={0} y={answerBase} fill={INK} style={{ whiteSpace: "pre", fontVariantNumeric: "tabular-nums" }}>
          {pre && <tspan fontSize={answerSize(fit.prePt)} fontWeight={700}>{pre}</tspan>}
          <tspan fontSize={answerSize(fit.valuePt)} fontWeight={900}>{figure.answer.value}</tspan>
          {figure.answer.post && <tspan fontSize={answerSize(fit.postPt)} fontWeight={900}>{figure.answer.post}</tspan>}
          {target && <tspan fontSize={answerSize(fit.targetPt)} fontWeight={900}>{target}</tspan>}
        </text>
      </svg>
      {rows.sub && <span className={styles.kfText} data-part="key-sub" style={{ ...at(rows.sub, unit), ...fontStyle(fit.subPt, unit), lineHeight: `${(rows.sub.h / Math.max(1, fit.subLines.length)) * unit}px`, color: SUB, fontWeight: 500, whiteSpace: "pre-line", overflow: "hidden" }}>{fit.subLines.join("\n")}</span>}
      {rows.grades.map((grade, i) => {
        const level = view.grades[i]?.level ?? "fair";
        return <span key={grade.text} className={styles.kfChip} data-part="key-grade" data-level={level} style={line(grade.rect, unit, fit.subPt * (8.5 / 9.4), { background: GRADE_CHIP[level].fill, color: GRADE_CHIP[level].color, fontWeight: 700, borderRadius: grade.rect.h * unit, textAlign: "center", textOverflow: "clip" })}>{grade.text}</span>;
      })}
      {rows.filter && fit.filterText && <span className={styles.kfText} data-part="key-filter" style={line(rows.filter, unit, fit.subPt, { color: SUB, fontWeight: 500 })}>{fit.filterText}</span>}
      {rows.divider && <span className={styles.kfRule} data-part="key-divider" style={at(rows.divider, unit)} />}
      {rows.stats.map((stat, i) => (
        <React.Fragment key={i}>
          <span className={styles.kfText} data-part="key-stat-value" style={line(stat.value, unit, fit.statValuePt, { color: INK, fontWeight: 900, fontVariantNumeric: "tabular-nums" })}>{figure.stats[i]?.value}</span>
          <span className={styles.kfText} data-part="key-stat-label" style={{ ...at(stat.label, unit), ...fontStyle(fit.statLabelPt, unit), lineHeight: 1.25, color: SUB, fontWeight: 500, overflow: "hidden" }}>{figure.stats[i]?.label}</span>
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
            <span className={styles.kfText} data-part="key-part-label" style={line(row.label, unit, fit.statLabelPt * (11.5 / 11), { color: part.site ? INK : SUB, fontWeight: part.site ? 900 : 500 })}>{part.label.replace(/지역$/, "")}</span>
            <span className={styles.kfText} data-part="key-part-share" style={line(row.share, unit, fit.statLabelPt * (11.5 / 11), { color: part.site ? INK : SUB, fontWeight: part.site ? 900 : 500, textAlign: "right", fontVariantNumeric: "tabular-nums" })}>{`${part.share.toFixed(1)}%`}</span>
          </React.Fragment>
        );
      })}
      {rows.sentenceBar && <span className={styles.kfBar} style={at(rows.sentenceBar, unit, { background: color })} />}
      {rows.sentence && <span className={styles.kfText} data-part="key-sentence" style={{ ...at(rows.sentence, unit), ...fontStyle(fit.sentencePt, unit), lineHeight: 1.25, color: INK, fontWeight: 700, whiteSpace: "pre-line", overflow: "hidden", textWrap: "balance" } as CSSProperties}>{fit.sentenceLines.join("\n")}</span>}
    </div>
  );
}

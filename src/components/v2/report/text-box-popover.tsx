"use client";

import type { TextBoxKind } from "@/lib/v2/report/report-doc";
import styles from "./report-mode.module.css";
import SidePanelHeader from "./side-panel-header";

type TextBoxPopoverProps = {
  opacity: number;
  onOpacityChange: (value: number) => void;
  onChoose: (kind: TextBoxKind, keyboard: boolean) => void;
  onClose: () => void;
};

const OPTIONS: Array<{ kind: TextBoxKind; label: string; description: string; className: string }> = [
  { kind: "title", label: "제목", description: "20pt 굵게", className: "textBoxChoiceTitle" },
  { kind: "body", label: "본문 글", description: "14pt", className: "textBoxChoiceBody" },
  { kind: "note", label: "주석·출처", description: "10pt 회색", className: "textBoxChoiceNote" },
];

export default function TextBoxPopover({ opacity, onOpacityChange, onChoose, onClose }: TextBoxPopoverProps) {
  return (
    <section className={styles.textBoxPopoverBody} aria-label="글상자 종류">
      <SidePanelHeader title="글상자" opacity={opacity} onOpacityChange={onOpacityChange} onClose={onClose} closeLabel="글상자 창 닫기" />
      <div className={`${styles.textBoxChoices} ${styles.sidePanelContent}`}>
        {OPTIONS.map((option) => <button key={option.kind} type="button" className={styles.textBoxChoice} onClick={() => onChoose(option.kind, false)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onChoose(option.kind, true); } }}>
          <span className={styles[option.className]}>{option.label}</span>
          <small>{option.description}</small>
        </button>)}
      </div>
    </section>
  );
}

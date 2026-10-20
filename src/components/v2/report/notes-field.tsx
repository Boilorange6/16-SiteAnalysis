"use client";

import { useEffect, useState } from "react";
import styles from "./report-mode.module.css";

type NotesFieldProps = { pageId: string; value: string; onChange: (value: string) => void; compact?: boolean };

export default function NotesField({ pageId, value, onChange, compact = false }: NotesFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [pageId, value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => onChange(draft), 600);
    return () => window.clearTimeout(timer);
  }, [draft, onChange, value]);
  return (
    <label className={`${styles.notesField} ${compact ? styles.notesFieldCompact : ""}`}>
      <span className={styles.fieldLabelText}>발표 메모</span>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="이 페이지에서 말할 내용을 적으세요." rows={4} />
    </label>
  );
}

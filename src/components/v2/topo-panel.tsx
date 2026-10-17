"use client";

import { TOPO_ERROR_COPY } from "@/lib/v2/ui/topo-upload";
import type { TopoState } from "@/lib/v2/ui/topo-state";
import styles from "./topo-panel.module.css";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type TopoPanelProps = {
  state: TopoState;
  disabled?: boolean;
  onPick: () => void;
  onDropFile: (file: File) => void;
  onCancel: () => void;
  onRemove: () => void;
};

const TOPO_CHIPS = [
  { tone: "primary", label: "지형", detail: "원본 등고선·표고점" },
  { tone: "primary", label: "도로", detail: "폭원·차로수" },
  { tone: "new", label: "옹벽·절성토·담장", detail: "" },
  { tone: "support", label: "건물", detail: "빠진 도형·층수만" },
  { tone: "support", label: "하천·호소", detail: "" },
] as const;

function DropZone({ disabled, onPick, onDropFile }: { disabled: boolean; onPick: () => void; onDropFile: (file: File) => void }) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!disabled) onPick();
  };

  return (
    <div
      className={styles.dropzone}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="수치지형도 zip 추가"
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onPick();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!disabled) {
          const file = event.dataTransfer.files[0];
          if (file) onDropFile(file);
        }
      }}
      onKeyDown={onKeyDown}
    >
      <span className={styles.dropTitle}>수치지형도 zip 추가</span>
      <span className={styles.dropHint}>zip을 끌어 놓거나 눌러 선택</span>
    </div>
  );
}

function StepList({ progress }: { progress: number }) {
  const steps = ["목록 읽기", "필요한 레이어만 고르기", "올리기", "위치와 들어 있는 자료 확인"];
  const active = progress <= 0 ? 0 : progress >= 100 ? 3 : 2;
  return (
    <ol className={styles.steps} aria-label="수치지형도 업로드 단계">
      {steps.map((step, index) => (
        <li key={step} className={index < active ? styles.stepDone : index === active ? styles.stepActive : ""}>
          <span aria-hidden="true">{index < active ? "✓" : index + 1}</span>
          {step}{index === 2 && progress > 0 ? ` ${progress}%` : ""}
        </li>
      ))}
    </ol>
  );
}

export default function TopoPanel({ state, disabled = false, onPick, onDropFile, onCancel, onRemove }: TopoPanelProps) {
  if (state.s === "idle") {
    return (
      <section className={styles.root} aria-label="수치지형도 추가 자료">
        <p className={styles.helper}>원본 등고선과 필요한 지형 자료를 분석에 보강할 수 있습니다.</p>
        <DropZone disabled={disabled} onPick={onPick} onDropFile={onDropFile} />
        <a className={styles.sourceLink} href="https://map.ngii.go.kr/" target="_blank" rel="noreferrer">
          국토정보플랫폼에서 받는 방법
        </a>
      </section>
    );
  }

  if (state.s === "preparing" || state.s === "uploading") {
    const progress = state.s === "uploading" && state.total > 0 ? Math.round((state.loaded / state.total) * 100) : 0;
    return (
      <section className={styles.root} aria-label="수치지형도 업로드 중" aria-live="polite">
        <StepList progress={progress} />
        <progress className={styles.progress} max={100} value={progress} aria-label="수치지형도 업로드 진행률">{progress}%</progress>
        <p className={styles.progressText}>{state.s === "preparing" ? "zip을 준비하는 중…" : `올리기 ${progress}%`}</p>
        <button type="button" className={styles.secondaryButton} onClick={onCancel} disabled={disabled}>취소</button>
      </section>
    );
  }

  if (state.s === "ready") {
    return (
      <section className={styles.root} aria-label="수치지형도 추가 자료">
        <div className={styles.fileRow}>
          <span className={styles.fileName} title={state.fileName}>{state.fileName}</span>
          <span className={styles.readyTag}>준비됨</span>
        </div>
        <p className={styles.coverageCopy}>분석 반경의 {state.coveragePct}%를 덮습니다. 나머지는 기존 자료로 채웁니다.</p>
        <ul className={styles.chips} aria-label="수치지형도에서 보강하는 자료">
          {TOPO_CHIPS.map((chip) => (
            <li className={styles.chip} key={`${chip.label}-${chip.detail}`}>
              <span className={`${styles.chipTone} ${chip.tone === "primary" ? styles.chipTonePrimary : chip.tone === "new" ? styles.chipToneNew : styles.chipToneSupport}`}>{chip.tone === "primary" ? "주 원천" : chip.tone === "new" ? "새로 추가" : "보강"}</span>
              <span className={styles.chipText}>{chip.label}{chip.detail ? ` · ${chip.detail}` : ""}</span>
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" className={styles.secondaryButton} onClick={onRemove} disabled={disabled}>빼기</button>
          <button type="button" className={styles.primaryButton} onClick={onPick} disabled={disabled}>다른 파일</button>
        </div>
      </section>
    );
  }

  const copy = TOPO_ERROR_COPY[state.code];
  return (
    <section className={`${styles.root} ${styles.error}`} aria-label="수치지형도 추가 자료 오류" role="alert">
      <strong>{copy.title}</strong>
      <p>{copy.body}</p>
      <button type="button" className={styles.primaryButton} onClick={onPick} disabled={disabled}>다시 시도</button>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { AdminTile } from "@/lib/v2/admin/overview";
import type { TileRequest } from "@/lib/v2/admin/requests";
import styles from "@/app/v2/admin/admin.module.css";

type CompareDialogProps = {
  request: TileRequest;
  tile: AdminTile;
  currentImageSrc: string | null;
  onClose: () => void;
  onReopen: (request: TileRequest, note: string) => Promise<void>;
  reopening: boolean;
};

function dateTimeLabel(value: string | null): string {
  if (!value) return "날짜 미확인";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16).replace("T", " ");
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parsed);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, textarea, input, [href]")].filter((element) => !element.hasAttribute("disabled"));
}

export default function CompareDialog({ request, tile, currentImageSrc, onClose, onReopen, reopening }: CompareDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [beforeError, setBeforeError] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  const [reopenError, setReopenError] = useState("");

  useEffect(() => {
    setBeforeError(false);
    setReopenOpen(false);
    setReopenNote("");
    setReopenError("");
    window.requestAnimationFrame(() => closeRef.current?.focus());
  }, [request.id]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const elements = focusables(root);
    if (elements.length === 0) return;
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? index <= 0 ? elements.length - 1 : index - 1
      : index < 0 || index === elements.length - 1 ? 0 : index + 1;
    if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === elements.length - 1)) {
      event.preventDefault();
      elements[next]?.focus();
    }
  };

  const beforeImage = request.imagePath && !beforeError ? (
    <div className={styles.compareFrame}>
      <img
        src={`/site/api/v2/admin/requests/${request.id}/image`}
        alt="요청 당시 그림"
        className={styles.compareImage}
        onError={() => setBeforeError(true)}
      />
      {request.pins.map((pin, index) => <span key={`${pin.x}:${pin.y}:${index}`} className={styles.pin} style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }} aria-hidden="true">{index + 1}</span>)}
    </div>
  ) : (
    <div className={styles.comparePlaceholder}>요청 당시 그림이 없습니다<br />이 기능을 만들기 전에 처리한 요청입니다</div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={styles.compareOverlay} data-admin-compare>
      <section ref={dialogRef} className={styles.compareDialog} role="dialog" aria-modal="true" aria-labelledby="admin-compare-title" onKeyDown={onKeyDown}>
        <div className={styles.compareHeading}>
          <span className={styles.compareCode}>{tile.code}</span>
          <h2 id="admin-compare-title">{tile.title} · 전·후 비교</h2>
          <button ref={closeRef} type="button" className={styles.closeButton} aria-label="비교 닫기" onClick={onClose}>×</button>
        </div>
        <p className={styles.compareIntro}>요청 · {request.memo || "핀으로 표시한 위치를 확인해 주세요."}</p>
        <div className={styles.compareColumns}>
          <figure className={styles.compareFigure}>
            <figcaption>요청 당시 <span>{dateTimeLabel(request.createdAt)}</span></figcaption>
            {beforeImage}
          </figure>
          <figure className={styles.compareFigure}>
            <figcaption>지금 <span>{tile.resultStatus ? "현재 기준 분석 결과" : "기준 분석 확인 불가"}</span></figcaption>
            {currentImageSrc ? <div className={styles.compareFrame}><img src={currentImageSrc} alt="지금 그림" className={styles.compareImage} /></div> : <div className={styles.comparePlaceholder}>지금 그림을 불러오지 못했습니다</div>}
          </figure>
        </div>
        <div className={styles.compareMeta}>
          <span>처리 메모 · {request.resolvedNote || "없음"}</span>
          <span className={styles.muted}>{request.resolvedCommit ? `커밋 · ${request.resolvedCommit}` : "커밋 미기록"}</span>
          <span className={styles.muted}>{request.resolvedAt ? `처리일 · ${dateTimeLabel(request.resolvedAt)}` : "처리일 미확인"}</span>
          {!request.imagePath && <span className={styles.caveat}>요청 당시 저장된 그림 없음</span>}
        </div>
        {reopenOpen && (
          <div className={styles.reopenForm}>
            <label htmlFor="admin-compare-reopen-note">아직 아쉬운 점(선택)</label>
            <textarea id="admin-compare-reopen-note" value={reopenNote} onChange={(event) => setReopenNote(event.target.value)} maxLength={2000} />
            <div className={styles.compareActions}>
              <button type="button" className={`${styles.controlButton} ${styles.miniButtonPrimary}`} onClick={() => {
                setReopenError("");
                void onReopen(request, reopenNote).catch((error: unknown) => {
                  setReopenError(error instanceof Error ? error.message : "요청을 다시 열지 못했습니다");
                });
              }} disabled={reopening} aria-busy={reopening}>{reopening ? "저장 중…" : "대기로 되돌리기"}</button>
              <button type="button" className={styles.controlButton} onClick={() => setReopenOpen(false)}>취소</button>
            </div>
            {reopenError && <p className={`${styles.inlineNotice} ${styles.inlineNoticeError}`} role="alert">{reopenError}</p>}
          </div>
        )}
        <div className={styles.compareActions}>
          {!reopenOpen && <button type="button" className={styles.controlButton} onClick={() => setReopenOpen(true)}>다시 열기</button>}
          <button type="button" className={styles.controlButton} onClick={onClose}>확인했어요</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import SummaryCard from "@/components/v2/summary-card";
import TileCard from "@/components/v2/tile-card";
import TileDialog from "@/components/v2/tile-dialog";
import styles from "@/components/v2/board.module.css";
import { boardReducer, demoFinished, demoPhase, initBoard, reportPages } from "@/lib/v2/ui/board-state";
import { buildReportPlan, reportFileName } from "@/lib/v2/report/report-plan";
import { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } from "@/lib/v2/ui/fixtures/godeok";
import { toSummaryView, toTileView } from "@/lib/v2/ui/tile-view";
import type { TileResult } from "@/lib/v2/tile-result";

/** 예시 결과로 동작하는 타일 보드. P1b 결과로 바꿀 때는 results만 교체하면 된다. */
export default function V2BoardPage() {
  const [overrides, setOverrides] = useState<Record<string, TileResult>>({});
  const results = useMemo(() => GODEOK_RESULTS.map((r) => overrides[r.tileId] ?? r), [overrides]);
  const [board, dispatch] = useReducer(boardReducer, GODEOK_RESULTS, initBoard);
  const [editing, setEditing] = useState(false);
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const views = useMemo(() => new Map(results.map((r) => [r.tileId, toTileView(r)])), [results]);
  const summary = useMemo(() => toSummaryView(GODEOK_SUMMARY, results), [results]);
  const { tiles } = reportPages(board);
  const total = board.order.length;
  // 표지 + 타일 + 출처 장. reportPages 는 출처 장을 세지 않으므로 계획 길이를 그대로 쓴다.
  const analysisDate = new Date().toLocaleDateString("sv-SE");
  const reportPlan = useMemo(() => buildReportPlan({ summary, views, board, analysisDate }), [summary, views, board, analysisDate]);
  const [making, setMaking] = useState(false);
  const makeReport = async () => {
    setMaking(true);
    try {
      const { renderReportPptx } = await import("@/lib/v2/report/render-pptx");
      const bytes = await renderReportPptx(reportPlan);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = reportFileName(GODEOK_SUMMARY.address, analysisDate);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setMaking(false);
    }
  };

  useEffect(() => {
    if (demoStep === null || demoStep > total + 1) return;
    const t = setTimeout(() => setDemoStep(demoStep + 1), 300);
    return () => clearTimeout(t);
  }, [demoStep, total]);
  const demoOn = demoStep !== null && demoStep <= total + 1;
  const finished = demoStep === null ? total : demoFinished(total, demoStep);

  const retry = (id: string, code: string) => {
    const fixed = RECOVERED[code];
    if (!fixed) return;
    setOverrides((o) => ({ ...o, [id]: { ...fixed, tileId: id } }));
    dispatch({ type: "include", id, value: true });
  };

  const lastRemoved = board.removed[board.removed.length - 1];
  const openView = openId ? views.get(openId) : undefined;

  return (
    <main className={styles.root}>
      <div className={styles.page}>
        <header className={styles.topbar}>
          <span className={`${styles.display} ${styles.brand}`}>{editing ? "보드 편집" : "사이트 분석"}</span>
          {editing ? (
            <span className={styles.editHint}>순서를 바꾸거나 빼세요. 순서는 보고서 순서가 됩니다.</span>
          ) : (
            <span className={styles.topTitle}>
              {GODEOK_SUMMARY.address} · {summary.radius}
            </span>
          )}
          {demoOn && (
            <>
              <div className={styles.progress} role="progressbar" aria-label="분석 진행" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished}>
                <div className={styles.progressFill} style={{ width: `${(finished / total) * 100}%` }} />
              </div>
              <span className={styles.progressText}>
                {finished} / {total}
              </span>
            </>
          )}
          <span className={styles.spacer} />
          <span className={styles.demoTag}>예시 데이터</span>
          {editing ? (
            <button type="button" className={`${styles.pill} ${styles.pillDark}`} onClick={() => setEditing(false)}>
              완료
            </button>
          ) : (
            <>
              <button type="button" className={styles.pill} onClick={() => (demoOn ? setDemoStep(null) : setDemoStep(0))} aria-pressed={demoOn}>
                {demoOn ? "데모 끄기" : "분석 중 데모"}
              </button>
              <button type="button" className={styles.pill} onClick={() => setEditing(true)} disabled={demoOn}>
                보드 편집
              </button>
              <span className={styles.reportHint}>표지 1 + 타일 {tiles}</span>
              <button type="button" className={`${styles.pill} ${styles.pillDark}`} onClick={makeReport} disabled={making || demoOn} aria-busy={making}>
                {making ? "만드는 중…" : `보고서 만들기 · ${reportPlan.length}장`}
              </button>
            </>
          )}
        </header>

        <div className={styles.grid}>
          <SummaryCard view={summary} />
          {board.order.map((id, i) => {
            const view = views.get(id)!;
            return (
              <TileCard
                key={id}
                view={view}
                phase={demoOn ? demoPhase(i, demoStep!) : null}
                included={!!board.included[id]}
                face={board.faces[id]}
                editing={editing}
                canUp={i > 0}
                canDown={i < total - 1}
                onOpen={() => setOpenId(id)}
                onInclude={(value) => dispatch({ type: "include", id, value })}
                onFace={(face) => dispatch({ type: "face", id, face })}
                onRemove={() => dispatch({ type: "remove", id })}
                onMove={(dir) => dispatch({ type: "move", id, dir })}
                onRetry={() => retry(id, view.code)}
              />
            );
          })}
        </div>
      </div>

      {editing && lastRemoved && (
        <div className={styles.toast} role="status">
          삭제됨 · {views.get(lastRemoved.id)?.title}
          <button type="button" onClick={() => dispatch({ type: "undo" })}>
            되돌리기
          </button>
        </div>
      )}

      {openView && (
        <TileDialog
          view={openView}
          included={!!board.included[openView.tileId]}
          face={board.faces[openView.tileId]}
          onInclude={(value) => dispatch({ type: "include", id: openView.tileId, value })}
          onFace={(face) => dispatch({ type: "face", id: openView.tileId, face })}
          onClose={() => setOpenId(null)}
        />
      )}
    </main>
  );
}

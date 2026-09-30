"use client";

import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from "react";
import SummaryCard from "@/components/v2/summary-card";
import TileCard from "@/components/v2/tile-card";
import TileDialog from "@/components/v2/tile-dialog";
import { useTileDrag } from "@/components/v2/use-tile-drag";
import styles from "@/components/v2/board.module.css";
import { boardReducer, demoFinished, demoPhase, initBoard, reportPages } from "@/lib/v2/ui/board-state";
import { buildReportPlan, reportFileName } from "@/lib/v2/report/report-plan";
import { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } from "@/lib/v2/ui/fixtures/godeok";
import { toSummaryView, toTileView } from "@/lib/v2/ui/tile-view";
import type { TileResult } from "@/lib/v2/tile-result";

const UNDO_LABEL = { order: "옮김", size: "크기 바꿈", remove: "삭제됨", add: "더함" } as const;

/** 예시 결과로 동작하는 타일 보드. P1b 결과로 바꿀 때는 results만 교체하면 된다. */
export default function V2BoardPage() {
  const [overrides, setOverrides] = useState<Record<string, TileResult>>({});
  const results = useMemo(() => GODEOK_RESULTS.map((r) => overrides[r.tileId] ?? r), [overrides]);
  const [board, dispatch] = useReducer(boardReducer, GODEOK_RESULTS, initBoard);
  const [editing, setEditing] = useState(false);
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState(""); // 스크린리더 안내(aria-live)
  const gridRef = useRef<HTMLDivElement>(null);
  const { drag, order: shown, start, floatStyle } = useTileDrag(board.order, gridRef, (id, from, to) => {
    dispatch({ type: "reorder", from, to });
    setNote(`${views.get(id)?.title} 타일을 ${to + 1}번째로 옮김`);
  });

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

  const lastUndo = board.undoStack[board.undoStack.length - 1];
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

        <div className={styles.grid} ref={gridRef}>
          <SummaryCard view={summary} />
          {shown.map((id, i) => {
            const view = views.get(id)!;
            const size = board.sizes[id];
            const oi = board.order.indexOf(id);
            const dragged = drag?.id === id;
            return (
              <Fragment key={id}>
                {dragged && (
                  <div key="ph" className={`${styles.placeholder} ${size === 2 ? styles.span2 : ""}`} data-placeholder>
                    여기에 놓기
                  </div>
                )}
                <TileCard
                  key="card"
                  view={view}
                  phase={demoOn ? demoPhase(i, demoStep!) : null}
                  included={!!board.included[id]}
                  face={board.faces[id]}
                  editing={editing}
                  canUp={oi > 0}
                  canDown={oi < total - 1}
                  size={size}
                  dragging={dragged}
                  floatStyle={floatStyle(id)}
                  onHandleDown={start(id)}
                  onResize={(s) => {
                    dispatch({ type: "resize", id, size: s });
                    setNote(`${view.title} 타일을 ${s}칸으로 바꿈`);
                  }}
                  onOpen={() => setOpenId(id)}
                  onInclude={(value) => dispatch({ type: "include", id, value })}
                  onFace={(face) => dispatch({ type: "face", id, face })}
                  onRemove={() => {
                    dispatch({ type: "remove", id });
                    setNote(`${view.title} 타일을 뺌`);
                  }}
                  onMove={(dir) => {
                    dispatch({ type: "move", id, dir });
                    setNote(`${view.title} 타일을 ${oi + dir + 1}번째로 옮김`);
                  }}
                  onRetry={() => retry(id, view.code)}
                />
              </Fragment>
            );
          })}
        </div>
      </div>

      <div className={styles.srOnly} aria-live="polite">
        {note}
      </div>

      {editing && (
        <div className={styles.tray} role="region" aria-label="더할 수 있는 타일">
          <span className={styles.trayLabel}>더할 수 있는 타일</span>
          {board.removed.length === 0 && <span className={styles.trayLabel}>없음</span>}
          {board.removed.map((r) => {
            const v = views.get(r.id)!;
            return (
              <button
                key={r.id}
                type="button"
                className={styles.trayBtn}
                onClick={() => {
                  dispatch({ type: "add", id: r.id });
                  setNote(`${v.title} 타일을 끝에 더함`);
                }}
                aria-label={`${v.title} 더하기`}
              >
                <span className={styles.dot} style={{ background: v.color }} />
                {v.title} +
              </button>
            );
          })}
        </div>
      )}

      {editing && lastUndo && (
        <div className={styles.toast} role="status" style={{ bottom: 76 }}>
          {UNDO_LABEL[lastUndo.kind]} · {views.get(lastUndo.id)?.title}
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

"use client";

import { Fragment, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import SummaryCard from "@/components/v2/summary-card";
import TileCard from "@/components/v2/tile-card";
import TileDialog from "@/components/v2/tile-dialog";
import { useTileDrag } from "@/components/v2/use-tile-drag";
import { BASEMAPS, BasemapContext, SetBasemapContext } from "@/components/v2/map-box";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import styles from "@/components/v2/board.module.css";
import { boardReducer, demoFinished, demoPhase, initBoard, reportPages } from "@/lib/v2/ui/board-state";
import { buildReportPlan, reportFileName } from "@/lib/v2/report/report-plan";
import { DEFAULT_CALLOUT_MODE } from "@/lib/v2/ui/callout-layout";
import { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } from "@/lib/v2/ui/fixtures/godeok";
import { toSummaryView, toTileView, type SiteSummary } from "@/lib/v2/ui/tile-view";
import type { TileResult } from "@/lib/v2/tile-result";

const UNDO_LABEL ={ order: "옮김", size: "크기 바꿈", remove: "삭제됨", add: "더함" } as const;

type BoardProps = {
  baseResults: TileResult[];
  siteSummary: SiteSummary;
  /** true면 예시 데이터(실제 분석 전) */
  demo: boolean;
  /** 분석 요청 중 — 모든 타일이 계산 중으로 보인다 */
  busy: boolean;
  controls: ReactNode;
  /** 실패한 타일 다시 계산 (실제 분석일 때 전체 재실행) */
  onRerun: () => void;
};

/** 타일 보드. 결과가 바뀌면 부모가 key를 바꿔 새로 만든다. */
function Board({ baseResults, siteSummary, demo, busy, controls, onRerun }: BoardProps) {
  const [overrides, setOverrides] = useState<Record<string, TileResult>>({});
  const results = useMemo(() => baseResults.map((r) => overrides[r.tileId] ?? r), [baseResults, overrides]);
  const [board, dispatch] = useReducer(boardReducer, baseResults, initBoard);
  const [editing, setEditing] = useState(false);
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState(""); // 스크린리더 안내(aria-live)
  const [basemap, setBasemap] = useState<BasemapChoice>("white"); // 보드 상태(서버에 저장하지 않음). 화면과 PPT가 같이 따른다
  const gridRef = useRef<HTMLDivElement>(null);
  const { drag, order: shown, start, floatStyle } = useTileDrag(board.order, gridRef, (id, from, to) => {
    dispatch({ type: "reorder", from, to });
    setNote(`${views.get(id)?.title} 타일을 ${to + 1}번째로 옮김`);
  });

  const views = useMemo(() => new Map(results.map((r) => [r.tileId, toTileView(r)])), [results]);
  const summary = useMemo(() => toSummaryView(siteSummary, results), [siteSummary, results]);
  const { tiles } = reportPages(board);
  const total = board.order.length;
  const analysisDate = demo ? new Date().toLocaleDateString("sv-SE") : (results[0]?.conditions.analysisDate ?? new Date().toLocaleDateString("sv-SE"));
  const reportPlan = useMemo(() => buildReportPlan({ summary, views, board, analysisDate }), [summary, views, board, analysisDate]);
  const [making, setMaking] = useState(false);
  const makeReport = async () => {
    setMaking(true);
    try {
      const { renderReportPptx } = await import("@/lib/v2/report/render-pptx");
      // 지도 그림은 브라우저에서 SVG → PNG로 만든다. 못 만들면 자리표시로 계속한다.
      const { buildMapImages } = await import("@/lib/v2/report/map-image");
      const bytes = await renderReportPptx(reportPlan, await buildMapImages(reportPlan, basemap).catch(() => ({})));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = reportFileName(siteSummary.address, analysisDate);
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
    if (!demo) return onRerun();
    const fixed = RECOVERED[code];
    if (!fixed) return;
    setOverrides((o) => ({ ...o, [id]: { ...fixed, tileId: id } }));
    dispatch({ type: "include", id, value: true });
  };

  const lastUndo = board.undoStack[board.undoStack.length - 1];
  const openView = openId ? views.get(openId) : undefined;

  return (
    <BasemapContext.Provider value={basemap}>
    <SetBasemapContext.Provider value={setBasemap}>
    <main className={styles.root}>
      <div className={styles.page}>
        <header className={styles.topbar}>
          <span className={`${styles.display} ${styles.brand}`}>{editing ? "보드 편집" : "사이트 분석"}</span>
          {editing ? (
            <span className={styles.editHint}>순서를 바꾸거나 빼세요. 순서는 보고서 순서가 됩니다.</span>
          ) : (
            <span className={styles.topTitle}>
              {siteSummary.address} · {summary.radius}
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
          {demo && <span className={styles.demoTag}>예시 데이터</span>}
          {editing ? (
            <button type="button" className={`${styles.pill} ${styles.pillDark}`} onClick={() => setEditing(false)}>
              완료
            </button>
          ) : (
            <>
              {demo && (
                <button type="button" className={styles.pill} onClick={() => (demoOn ? setDemoStep(null) : setDemoStep(0))} aria-pressed={demoOn}>
                  {demoOn ? "데모 끄기" : "분석 중 데모"}
                </button>
              )}
              <span className={styles.seg} role="group" aria-label="배경지도">
                {BASEMAPS.map((b) => (
                  <button key={b.id} type="button" aria-pressed={basemap === b.id} onClick={() => setBasemap(b.id)}>
                    {b.label}
                  </button>
                ))}
              </span>
              <button type="button" className={styles.pill} onClick={() => setEditing(true)} disabled={demoOn || busy}>
                보드 편집
              </button>
              <span className={styles.reportHint}>표지 1 + 타일 {tiles}</span>
              <button type="button" className={`${styles.pill} ${styles.pillDark}`} onClick={makeReport} disabled={making || demoOn || busy} aria-busy={making}>
                {making ? "만드는 중…" : `보고서 만들기 · ${reportPlan.length}장`}
              </button>
            </>
          )}
        </header>

        {controls}

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
                  phase={busy ? "running" : demoOn ? demoPhase(i, demoStep!) : null}
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
          calloutMode={board.callout[openView.tileId] ?? DEFAULT_CALLOUT_MODE}
          onCalloutMode={(mode) => dispatch({ type: "callout", id: openView.tileId, mode })}
          onClose={() => setOpenId(null)}
        />
      )}
    </main>
    </SetBasemapContext.Provider>
    </BasemapContext.Provider>
  );
}

const RADII = [
  { m: 500, label: "500m" },
  { m: 800, label: "800m" },
  { m: 1000, label: "1km" },
  { m: 2000, label: "2km" },
  { m: 3000, label: "3km" },
] as const;
const API = "/site/api/v2/analyses";

type Live = { analysisId: string; summary: SiteSummary; results: TileResult[] };
type Problem = { text: string; login: boolean };

/** 주소 입력 → 분석 → 실제 결과 보드. 분석 전에는 예시 보드를 그대로 보여 준다. */
export default function V2BoardPage() {
  const [address, setAddress] = useState("");
  const [radiusM, setRadiusM] = useState(800);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [live, setLive] = useState<Live | null>(null);

  async function load(res: Response) {
    const body = (await res.json().catch(() => ({}))) as Partial<Live> & { error?: string };
    if (res.status === 401) return setProblem({ text: "로그인이 필요합니다.", login: true });
    if (!res.ok || !body.analysisId) return setProblem({ text: body.error ?? "분석하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", login: false });
    setLive(body as Live);
    history.replaceState(null, "", `?analysis=${body.analysisId}`);
    return undefined;
  }

  async function analyze(e?: { preventDefault(): void }) {
    e?.preventDefault();
    if (busy) return;
    if (!address.trim()) return setProblem({ text: "지번 주소로 입력해 주세요. 예: 서울 강동구 고덕동 123", login: false });
    setBusy(true);
    setProblem(null);
    try {
      await load(await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: address.trim(), radiusM }) }));
    } catch {
      setProblem({ text: "서버에 연결하지 못했습니다.", login: false });
    } finally {
      setBusy(false);
    }
  }

  // 주소창의 ?analysis=<id>로 저장된 분석을 다시 연다
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("analysis");
    if (!id) return;
    setBusy(true);
    fetch(`${API}/${encodeURIComponent(id)}`)
      .then(async (res) => {
        await load(res);
      })
      .catch(() => setProblem({ text: "서버에 연결하지 못했습니다.", login: false }))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (live) {
      setAddress(live.summary.address);
      setRadiusM(live.summary.radiusM);
    }
  }, [live]);

  const controls = (
    <div className={styles.analyzeWrap}>
      <form className={styles.analyzeBar} onSubmit={analyze}>
        <input
          className={styles.addrInput}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="지번 주소 (예: 서울 강동구 고덕동 123)"
          aria-label="지번 주소"
          disabled={busy}
        />
        <select className={styles.radiusSelect} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))} aria-label="분석 반경" disabled={busy}>
          {RADII.map((r) => (
            <option key={r.m} value={r.m}>
              {r.label}
            </option>
          ))}
        </select>
        <button type="submit" className={`${styles.pill} ${styles.pillDark}`} disabled={busy} aria-busy={busy}>
          {busy ? "분석 중…" : "분석"}
        </button>
      </form>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem.text}
          {problem.login && (
            <>
              {" "}
              <a href="/site/login">/site/login으로 로그인</a>해 주세요.
            </>
          )}
        </p>
      )}
    </div>
  );

  return (
    <Board
      key={live?.analysisId ?? "demo"}
      baseResults={live?.results ?? GODEOK_RESULTS}
      siteSummary={live?.summary ?? GODEOK_SUMMARY}
      demo={!live}
      busy={busy}
      controls={controls}
      onRerun={() => void analyze()}
    />
  );
}

"use client";

import { Fragment, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import SummaryCard from "@/components/v2/summary-card";
import TileCard from "@/components/v2/tile-card";
import TileDialog from "@/components/v2/tile-dialog";
import { useTileDrag } from "@/components/v2/use-tile-drag";
import { BASEMAPS, BasemapContext, SetBasemapContext } from "@/components/v2/map-box";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import styles from "@/components/v2/board.module.css";
import { SUMMARY_ID, boardReducer, demoFinished, demoPhase, initBoard, reportPages, viewOf } from "@/lib/v2/ui/board-state";
import { buildReportPlan, complexCounts, reportFileName } from "@/lib/v2/report/report-plan";
import { downloadBytes, exportFileName, EXPORT_MIME } from "@/lib/v2/export/download";
import { DEFAULT_CALLOUT_MODE } from "@/lib/v2/ui/callout-layout";
import { stackView } from "@/lib/v2/ui/stack";
import { sheetView } from "@/lib/v2/ui/sheet";
import { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } from "@/lib/v2/ui/fixtures/godeok";
import { toSummaryView, toTileView, type SiteSummary } from "@/lib/v2/ui/tile-view";
import type { TileResult } from "@/lib/v2/tile-result";
import type { Scene } from "@/lib/v2/scene";

const UNDO_LABEL ={ order: "옮김", size: "크기 바꿈", remove: "삭제됨", add: "더함" } as const;

type BoardProps = {
  baseResults: TileResult[];
  siteSummary: SiteSummary;
  scene: Scene | null;
  /** true면 예시 데이터(실제 분석 전) */
  demo: boolean;
  /** 분석 요청 중 — 모든 타일이 계산 중으로 보인다 */
  busy: boolean;
  controls: ReactNode;
  /** 실패한 타일 다시 계산 (실제 분석일 때 전체 재실행) */
  onRerun: () => void;
};

/** 타일 보드. 결과가 바뀌면 부모가 key를 바꿔 새로 만든다. */
function Board({ baseResults, siteSummary, scene, demo, busy, controls, onRerun }: BoardProps) {
  const [overrides, setOverrides] = useState<Record<string, TileResult>>({});
  const [board, dispatch] = useReducer(boardReducer, baseResults, initBoard);
  useEffect(() => {
    dispatch({ type: "replaceResults", results: baseResults });
  }, [baseResults]);
  const results = useMemo(() => board.results.map((r) => overrides[r.tileId] ?? r), [board.results, overrides]);
  const [editing, setEditing] = useState(false);
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stackSelection, setStackSelection] = useState<string[]>([]);
  const [sheetSelection, setSheetSelection] = useState<string[]>([]);
  const [note, setNote] = useState(""); // 스크린리더 안내(aria-live)
  const [basemap, setBasemap] = useState<BasemapChoice>("white"); // 보드 상태(서버에 저장하지 않음). 화면과 PPT가 같이 따른다
  const [rhinoUnavailable, setRhinoUnavailable] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const { drag, order: shown, start, floatStyle } = useTileDrag(board.order, gridRef, (id, from, to) => {
    dispatch({ type: "reorder", from, to });
    setNote(`${views.get(id)?.title} 타일을 ${to + 1}번째로 옮김`);
  });

  const baseViews = useMemo(() => new Map(results.map((r) => [r.tileId, toTileView(r, scene)])), [results, scene]);
  const views = useMemo(() => {
    const next = new Map(
      [...baseViews].map(([id, view]) => {
        const camera = board.cameras[id];
        if (!camera || !view.mass) return [id, view] as const;
        return [id, { ...view, mass: { ...view.mass, camera: { ...view.mass.camera, ...camera } } }] as const;
      }),
    );
    for (const [id, layers] of Object.entries(board.stacks)) {
      const layerViews = layers.map((layerId) => baseViews.get(layerId)).filter((view): view is NonNullable<typeof view> => !!view);
      if (layerViews.length > 0) next.set(id, stackView(id, layerViews));
    }
    for (const [id, spec] of Object.entries(board.sheets)) {
      const tileViews = spec.tiles.map((tileId) => next.get(tileId)).filter((view): view is NonNullable<typeof view> => !!view);
      if (tileViews.length > 0) next.set(id, sheetView(id, tileViews, spec.grid));
    }
    return next;
  }, [baseViews, board.cameras, board.sheets, board.stacks]);
  const stackableIds = useMemo(
    () => board.order.filter((id) => {
      const view = baseViews.get(id);
      return !!view && (view.kindLabel === "분석" || view.kindLabel === "도판") && !Object.values(board.stacks).some((layers) => layers.includes(id));
    }),
    [baseViews, board.order, board.stacks],
  );
  const sheetableIds = useMemo(() => board.order.filter((id) => views.has(id) && views.get(id)!.code !== "SHEET"), [board.order, views]);
  const summary = useMemo(() => toSummaryView(siteSummary, results), [siteSummary, results]);
  const { tiles } = reportPages(board, complexCounts(views));
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
      downloadBytes(reportFileName(siteSummary.address, analysisDate), bytes, EXPORT_MIME.pptx);
    } finally {
      setMaking(false);
    }
  };

  const makeDxf = async (origin: "site" | "utmk" = "site") => {
    if (!scene) return;
    setMaking(true);
    try {
      const { dxfFileName, sceneToDxf } = await import("@/lib/v2/export/dxf");
      const dxf = sceneToDxf(scene, { origin });
      downloadBytes(dxfFileName(siteSummary.address, analysisDate), dxf, EXPORT_MIME.dxf);
    } finally {
      setMaking(false);
    }
  };

  const makeGlb = async () => {
    if (!scene) return;
    setMaking(true);
    try {
      const { glbFileName, sceneToGlb } = await import("@/lib/v2/export/glb");
      downloadBytes(glbFileName(siteSummary.address, analysisDate), sceneToGlb(scene), EXPORT_MIME.glb);
    } finally {
      setMaking(false);
    }
  };

  const make3dm = async () => {
    if (!scene) return;
    setMaking(true);
    try {
      // rhino3dm은 브라우저 번들에 넣을 수 없어(Node 전용 ws·fs 참조) 서버에서 변환한다.
      const res = await fetch("/site/api/v2/export/3dm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scene) });
      if (!res.ok) throw new Error(`3dm ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      downloadBytes(exportFileName("3dm", siteSummary.address, analysisDate), bytes, EXPORT_MIME["3dm"]);
      setRhinoUnavailable(false);
    } catch {
      // 서버 변환 실패는 메뉴 옆의 상태로 알린다.
      setRhinoUnavailable(true);
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
            <>
              <span className={styles.editHint}>순서를 바꾸거나 빼세요. 순서는 보고서 순서가 됩니다.</span>
              {stackSelection.length >= 2 && (
                <button
                  type="button"
                  className={styles.pill}
                  onClick={() => {
                    dispatch({ type: "stack", layers: stackSelection });
                    setStackSelection([]);
                    setNote(`${stackSelection.length}개 층으로 스택을 만듦`);
                  }}
                >
                  스택 만들기 · {stackSelection.length}층
                </button>
              )}
              {sheetSelection.length >= 2 && (
                <>
                  <button
                    type="button"
                    className={styles.pill}
                    disabled={sheetSelection.length > 4}
                    onClick={() => {
                      dispatch({ type: "sheet", tiles: sheetSelection, grid: "2x2" });
                      setSheetSelection([]);
                      setNote(`${sheetSelection.length}개 타일로 2×2 조판을 만듦`);
                    }}
                  >
                    조판 만들기(2×2)
                  </button>
                  <button
                    type="button"
                    className={styles.pill}
                    disabled={sheetSelection.length > 6}
                    onClick={() => {
                      dispatch({ type: "sheet", tiles: sheetSelection, grid: "3x2" });
                      setSheetSelection([]);
                      setNote(`${sheetSelection.length}개 타일로 3×2 조판을 만듦`);
                    }}
                  >
                    조판 만들기(3×2)
                  </button>
                </>
              )}
            </>
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
              <span className={styles.seg} role="group" aria-label="카드 보기">
                {(["summary", "map"] as const).map((f) => (
                  <button key={f} type="button" aria-pressed={board.viewAll === f} onClick={() => dispatch({ type: "viewAll", face: f })}>
                    {f === "summary" ? "요약" : "지도"}
                  </button>
                ))}
              </span>
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
              {demo ? (
                <button type="button" className={`${styles.pill} ${styles.pillDark}`} disabled title="실제 분석 후 사용">
                  내보내기 ▾
                </button>
              ) : (
                <details style={{ position: "relative" }}>
                  <summary className={`${styles.pill} ${styles.pillDark}`} style={{ cursor: busy || making ? "not-allowed" : "pointer", listStyle: "none" }}>
                    {making ? "내보내는 중…" : "내보내기 ▾"}
                  </summary>
                  <div
                    role="menu"
                    aria-label="내보내기 형식"
                    style={{ position: "absolute", zIndex: 20, right: 0, top: "calc(100% + 8px)", minWidth: 250, padding: 10, borderRadius: 14, background: "#fff", boxShadow: "0 12px 32px rgba(0,0,0,.16)", display: "grid", gap: 6 }}
                  >
                    <button type="button" className={styles.pill} onClick={() => void makeReport()} disabled={making || busy}>
                      PPT · {reportPlan.length}장
                    </button>
                    <button type="button" className={styles.pill} onClick={() => void makeDxf("site")} disabled={!scene || making || busy} title={!scene ? "건물 도형 미적재" : "대지 중심 원점"}>
                      DXF · 대지 중심
                    </button>
                    <button type="button" className={styles.pill} onClick={() => void makeDxf("utmk")} disabled={!scene || making || busy} title={!scene ? "건물 도형 미적재" : "UTM-K 절대 좌표"}>
                      DXF · UTM-K
                    </button>
                    <button type="button" className={styles.pill} onClick={() => void makeGlb()} disabled={!scene || making || busy} title={!scene ? "건물 도형 미적재" : "GLB 내보내기"}>
                      GLB
                    </button>
                    <button type="button" className={styles.pill} onClick={() => void make3dm()} disabled={!scene || making || busy} title={!scene ? "건물 도형 미적재" : "3DM 내보내기"}>
                      3DM
                    </button>
                    {rhinoUnavailable && <span role="status" style={{ margin: "0 2px", fontSize: 11, color: "#9A3B2F" }}>3DM 변환 실패 — 잠시 뒤 다시 시도</span>}
                    <p style={{ margin: "4px 2px 0", fontSize: 11, lineHeight: 1.4, color: "#5B606B" }}>
                      DXF·GLB: 건물·필지·대지·반경. 래스터(항공사진·인구 격자·시뮬레이션 결과)는 대상 아님<br />
                      3DM: 건물(닫힌 솔리드)·필지·대지·반경·지형 메시
                    </p>
                  </div>
                </details>
              )}
            </>
          )}
        </header>

        {controls}

        <div className={styles.grid} ref={gridRef}>
          <SummaryCard view={summary} face={editing ? "summary" : viewOf(board, SUMMARY_ID)} onFace={(face) => dispatch({ type: "view", id: SUMMARY_ID, face })} />
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
                  cardFace={viewOf(board, id)}
                  onCardFace={(face) => {
                    dispatch({ type: "view", id, face });
                    setNote(`${view.title} ${face === "map" ? "지도면" : "요약면"}`);
                  }}
                  onRemove={() => {
                    dispatch({ type: "remove", id });
                    setNote(`${view.title} 타일을 뺌`);
                  }}
                  onMove={(dir) => {
                    dispatch({ type: "move", id, dir });
                    setNote(`${view.title} 타일을 ${oi + dir + 1}번째로 옮김`);
                  }}
                  onRetry={() => retry(id, view.code)}
                  stackable={stackableIds.includes(id)}
                  stackSelected={stackSelection.includes(id)}
                  onStackToggle={(selected) => setStackSelection((current) => selected ? [...new Set([...current, id])] : current.filter((selectedId) => selectedId !== id))}
                  onUnstack={view.code === "STACK" ? () => {
                    dispatch({ type: "unstack", id });
                    setStackSelection((current) => current.filter((selectedId) => selectedId !== id));
                    setNote(`${view.title}을 풀음`);
                  } : undefined}
                  sheetable={sheetableIds.includes(id)}
                  sheetSelected={sheetSelection.includes(id)}
                  onSheetToggle={(selected) => setSheetSelection((current) => selected ? [...new Set([...current, id])] : current.filter((selectedId) => selectedId !== id))}
                  onUnsheet={view.code === "SHEET" ? () => {
                    dispatch({ type: "unsheet", id });
                    setSheetSelection((current) => current.filter((selectedId) => selectedId !== id));
                    setNote(`${view.title}을 풀음`);
                  } : undefined}
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
          camera={openView.mass?.camera}
          onCamera={(camera) => dispatch({ type: "camera", id: openView.tileId, camera })}
          cuts={openView.code === "S02" ? (board.cuts[openView.tileId] ?? 1) : undefined}
          onCuts={openView.code === "S02" ? (cuts) => dispatch({ type: "cuts", id: openView.tileId, cuts }) : undefined}
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

type JobState = { code: string; status: "queued" | "running" | "done" | "failed"; elapsedMs: number | null };
type Live = { analysisId: string; summary: SiteSummary; results: TileResult[]; jobs: JobState[]; scene: Scene | null };
type Problem = { text: string; login: boolean };

/** 주소 입력 → 분석 → 실제 결과 보드. 분석 전에는 예시 보드를 그대로 보여 준다. */
export default function V2BoardPage() {
  const [address, setAddress] = useState("");
  const [radiusM, setRadiusM] = useState(800);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const activeJobs = live?.jobs.some((job) => job.status === "queued" || job.status === "running") ?? false;

  async function load(res: Response, refreshScene = true) {
    const body = (await res.json().catch(() => ({}))) as Partial<Live> & { error?: string };
    if (res.status === 401) return setProblem({ text: "로그인이 필요합니다.", login: true });
    if (!res.ok || !body.analysisId) return setProblem({ text: body.error ?? "분석하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", login: false });
    let scene: Scene | null = live?.analysisId === body.analysisId ? live.scene : null;
    if (refreshScene) {
      try {
        const sceneRes = await fetch(`${API}/${encodeURIComponent(body.analysisId)}/scene`);
        if (sceneRes.ok) scene = (await sceneRes.json()) as Scene;
      } catch {
        // 장면이 없어도 분석 결과 보드는 계속 연다. S01은 빈 매스 틀을 표시한다.
      }
    }
    setLive({ analysisId: body.analysisId, summary: body.summary!, results: body.results ?? [], jobs: body.jobs ?? [], scene });
    history.replaceState(null, "", `?analysis=${body.analysisId}`);
    return undefined;
  }

  async function analyze(e?: { preventDefault(): void }) {
    e?.preventDefault();
    if (busy || activeJobs) return;
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
    if (!live || !activeJobs) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`${API}/${encodeURIComponent(live.analysisId)}`);
        if (!cancelled) await load(response, false);
      } catch {
        // 다음 주기에 다시 시도한다. 이미 받은 결과 보드는 유지한다.
      }
      if (!cancelled) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // load는 렌더마다 새 함수지만, analysisId/jobs 상태가 바뀔 때만 폴링을 재설정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.analysisId, activeJobs]);

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
          disabled={busy || activeJobs}
        />
        <select className={styles.radiusSelect} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))} aria-label="분석 반경" disabled={busy || activeJobs}>
          {RADII.map((r) => (
            <option key={r.m} value={r.m}>
              {r.label}
            </option>
          ))}
        </select>
        <button type="submit" className={`${styles.pill} ${styles.pillDark}`} disabled={busy || activeJobs} aria-busy={busy || activeJobs}>
          {busy || activeJobs ? "분석 중…" : "분석"}
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
      scene={live?.scene ?? null}
      demo={!live}
      busy={busy || activeJobs}
      controls={controls}
      onRerun={() => void analyze()}
    />
  );
}

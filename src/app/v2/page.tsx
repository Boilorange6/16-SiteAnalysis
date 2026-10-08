"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import SummaryCard from "@/components/v2/summary-card";
import TileCard, { type TileCardAction } from "@/components/v2/tile-card";
import TileDialog from "@/components/v2/tile-dialog";
import { useTileDrag } from "@/components/v2/use-tile-drag";
import { BASEMAPS, BasemapContext, SetBasemapContext } from "@/components/v2/map-box";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import styles from "@/components/v2/board.module.css";
import { SUMMARY_ID, boardReducer, boardStorageKey, demoFinished, demoPhase, initBoard, rebaseSnapshotAnalysisId, reportPages, serializeBoardState, viewOf, type CardFace, type GridColumns, type PinnedLabel } from "@/lib/v2/ui/board-state";
import { buildReportPlan, complexCounts, reportFileName, sourcePageCountForViews } from "@/lib/v2/report/report-plan";
import { downloadBytes, exportFileName, EXPORT_MIME, DAE_MIME } from "@/lib/v2/export/download";
import { DEFAULT_CALLOUT_MODE } from "@/lib/v2/ui/callout-layout";
import { stackView } from "@/lib/v2/ui/stack";
import { sheetView } from "@/lib/v2/ui/sheet";
import { exportAvailability, formatElapsedMs, jobProgress } from "@/lib/v2/ui/board-status";
import { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } from "@/lib/v2/ui/fixtures/godeok";
import { toSummaryView, toTileView, viewWithLayer, type SiteSummary } from "@/lib/v2/ui/tile-view";
import { siteParcelFromResults } from "@/lib/v2/ui/site-parcel";
import { sourceIdsForRefs, sourceMetaMap, type SourceApiBody } from "@/lib/v2/ui/source-api";
import type { SourceMeta } from "@/lib/v2/ui/source-details";
import { toLngLat } from "@/lib/v2/crs";
import { jibunFromPnu, type SitePickerParcel } from "@/lib/v2/ui/site-picker";
import type { TileResult } from "@/lib/v2/tile-result";
import type { RoseSeason } from "@/lib/v2/tile-result";
import type { Scene } from "@/lib/v2/scene";
import { isRoadAddress, ROAD_ADDRESS_UNSUPPORTED_MESSAGE } from "@/lib/v2/site";
import { RADIUS_CAPTION, RADIUS_OPTIONS } from "@/lib/v2/ui/radius-options";
import ProjectMenu, { type V2Project } from "@/components/v2/project-menu";
import SitePicker from "@/components/v2/site-picker";
import type { SiteInput } from "@/lib/v2/site";

const UNDO_LABEL ={ order: "옮김", size: "크기 바꿈", columns: "열 수 바꿈", remove: "삭제됨", add: "더함" } as const;
const GRID_COLUMN_OPTIONS: GridColumns[] = [2, 3, 4, 5, 6];
const DEMO_START_LABEL = "분석 데모";
const EMPTY_PINNED_LABELS: PinnedLabel[] = [];

type BoardProps = {
  baseResults: TileResult[];
  siteSummary: SiteSummary;
  analysisId: string | null;
  scene: Scene | null;
  jobs: JobState[];
  /** true면 예시 데이터(실제 분석 전) */
  demo: boolean;
  /** 분석 요청 중 — 모든 타일이 계산 중으로 보인다 */
  busy: boolean;
  controls: ReactNode;
  /** 실패한 타일 다시 계산 (실제 분석일 때 전체 재실행) */
  onRerun: () => void;
  /** 진행 중인 실제 분석을 취소한다. */
  onCancel?: () => void;
  canceling?: boolean;
  currentProject: V2Project | null;
  initialProjectBoard: unknown | null;
  onProjectSaved: (project: V2Project) => void;
  onProjectDeleted: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
  onAuthExpired: () => void;
  /** 브라우저 S03 업로드·대체 요청 뒤 결과와 작업 폴링을 다시 연다. */
  onWindUploaded: () => void;
};

type JobState = { code: string; status: "queued" | "running" | "done" | "failed"; enqueuedAt?: string | null; startedAt?: string | null; elapsedMs: number | null };

/** 진행 경과 시계는 보드와 카드 트리 밖에서만 갱신한다. */
const AnalysisProgress = memo(function AnalysisProgress({ jobs, onCancel, canceling = false }: { jobs: JobState[]; onCancel?: () => void; canceling?: boolean }) {
  const activeJobs = jobs.some((job) => job.status === "queued" || job.status === "running");
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!activeJobs) {
      setNowMs(0);
      return;
    }
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeJobs]);
  const jobState = useMemo(() => jobProgress(jobs, nowMs || Date.now()), [jobs, nowMs]);
  if (!activeJobs || jobs.length === 0) return null;
  return (
    <div className={styles.progressRow}>
      <span className={styles.progressLabel}>분석 중</span>
      <div className={styles.progress} role="progressbar" aria-label="분석 진행" aria-valuemin={0} aria-valuemax={jobs.length} aria-valuenow={jobState.completed}>
        <div className={styles.progressFill} style={{ width: `${(jobState.completed / jobs.length) * 100}%` }} />
      </div>
      <span className={styles.progressText} aria-live="polite" aria-atomic="true">{jobState.completed} / {jobs.length} 계산 중</span>
      <span className={styles.progressMeta}>경과 {formatElapsedMs(jobState.elapsedMs)}</span>
      {jobState.waitingLabel && <span className={styles.progressQueue}>{jobState.waitingLabel}</span>}
      <span className={styles.progressRetry}>{jobState.retryLabel}</span>
      {onCancel && <button type="button" className={styles.progressCancel} onClick={onCancel} disabled={canceling} aria-busy={canceling}>{canceling ? "취소 중…" : "계산 취소"}</button>}
    </div>
  );
});

/** 타일 보드. 결과가 바뀌면 부모가 key를 바꿔 새로 만든다. */
function Board({ baseResults, siteSummary, analysisId, scene, jobs, demo, busy, controls, onRerun, onCancel, canceling = false, currentProject, initialProjectBoard, onProjectSaved, onProjectDeleted, onOpenProject, onAuthExpired, onWindUploaded }: BoardProps) {
  const [overrides, setOverrides] = useState<Record<string, TileResult>>({});
  const [board, dispatch] = useReducer(boardReducer, baseResults, initBoard);
  const storageKey = boardStorageKey(baseResults[0]?.analysisId ?? "demo");
  const initialSnapshotJson = useMemo(() => {
    if (initialProjectBoard === null) return null;
    try {
      return JSON.stringify(initialProjectBoard);
    } catch {
      return null;
    }
  }, [initialProjectBoard]);
  const [storageReady, setStorageReady] = useState(false);
  const [serverSnapshotJson, setServerSnapshotJson] = useState<string | null>(initialSnapshotJson);
  const pendingStorageRef = useRef<{ key: string; json: string } | null>(null);
  const scheduledStorageRef = useRef<{ kind: "idle" | "timeout"; handle: number } | null>(null);
  const flushStorage = useCallback(() => {
    const pending = pendingStorageRef.current;
    if (!pending) return;
    pendingStorageRef.current = null;
    try {
      window.localStorage.setItem(pending.key, pending.json);
    } catch {
      // 저장소가 막힌 브라우저에서는 현재 세션의 보드 상태만 유지한다.
    }
  }, []);
  useEffect(() => {
    dispatch({ type: "replaceResults", results: baseResults });
  }, [baseResults]);
  useEffect(() => {
    setStorageReady(false);
    let snapshot = initialSnapshotJson;
    if (snapshot === null) {
      try {
        snapshot = window.localStorage.getItem(storageKey);
      } catch {
        snapshot = null;
      }
    }
    dispatch({ type: "restore", snapshot });
    setStorageReady(true);
  }, [initialSnapshotJson, storageKey]);
  useEffect(() => {
    setServerSnapshotJson(initialSnapshotJson);
  }, [initialSnapshotJson]);
  useEffect(() => {
    window.addEventListener("pagehide", flushStorage);
    return () => window.removeEventListener("pagehide", flushStorage);
  }, [flushStorage]);
  useEffect(() => () => flushStorage(), [flushStorage]);
  const results = useMemo(() => board.results.map((r) => overrides[r.tileId] ?? r), [board.results, overrides]);
  const [editing, setEditing] = useState(false);
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialogTab, setDialogTab] = useState<"overview" | "sources">("overview");
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const [stackSelection, setStackSelection] = useState<string[]>([]);
  const [sheetSelection, setSheetSelection] = useState<string[]>([]);
  const [note, setNote] = useState(""); // 스크린리더 안내(aria-live)
  const [basemap, setBasemap] = useState<BasemapChoice>("white"); // 보드 상태(서버에 저장하지 않음). 화면과 PPT가 같이 따른다
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridLayout, setGridLayout] = useState({ columns: 4, rowHeight: 280 });
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => {
      const width = grid.clientWidth;
      if (width <= 0) return;
      const gap = 16;
      const capacity = Math.max(1, Math.floor((width + gap) / (260 + gap)));
      const columns = Math.max(1, Math.min(board.columns, capacity));
      const cellWidth = (width - (columns - 1) * gap) / columns;
      const rowHeight = Math.max(240, Math.round(cellWidth * (5 / 6)));
      setGridLayout((current) => current.columns === columns && current.rowHeight === rowHeight ? current : { columns, rowHeight });
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(grid);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [board.columns]);
  const { drag, order: shown, start, floatStyle } = useTileDrag(board.order, gridRef, (id, from, to) => {
    dispatch({ type: "reorder", from, to });
    setNote(`${views.get(id)?.title} 타일을 ${to + 1}번째로 옮김`);
  });

  const analysisSiteParcel = useMemo(() => (siteSummary.siteParcel === undefined ? siteParcelFromResults(results) : siteSummary.siteParcel), [siteSummary.siteParcel, results]);
  const baseViews = useMemo(() => new Map(results.map((r) => {
    const view = toTileView(r, scene, analysisSiteParcel, board.a05Filter[r.tileId] ?? null);
    return [r.tileId, viewWithLayer(view, board.layers[r.tileId] ?? view.defaultLayer)] as const;
  })), [results, scene, analysisSiteParcel, board.a05Filter, board.layers]);
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
  const reportSummary = useMemo(() => {
    const reportViews = board.order
      .filter((id) => board.included[id])
      .map((id) => views.get(id))
      .filter((view): view is NonNullable<typeof view> => !!view);
    return reportPages(board, complexCounts(views), sourcePageCountForViews(reportViews));
  }, [board, views]);
  const { tiles, pages: reportPageCount } = reportSummary;
  const total = board.order.length;
  const notProvidedIds = shown.filter((id) => views.get(id)?.status === "not_provided");
  const visibleShown = shown.filter((id) => views.get(id)?.status !== "not_provided");
  const activeJobs = jobs.some((job) => job.status === "queued" || job.status === "running");
  const actionBusy = busy || activeJobs;
  const jobState = useMemo(() => jobProgress(jobs), [jobs]);
  const analysisDate = results[0]?.conditions.analysisDate ?? "기준일 미확인";
  const boardSnapshot = useMemo(() => serializeBoardState(board), [board]);
  const boardSnapshotJson = useMemo(() => JSON.stringify(boardSnapshot), [boardSnapshot]);
  useEffect(() => {
    if (!storageReady) return;
    pendingStorageRef.current = { key: storageKey, json: boardSnapshotJson };
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const previous = scheduledStorageRef.current;
    if (previous) {
      if (previous.kind === "idle") win.cancelIdleCallback?.(previous.handle);
      else window.clearTimeout(previous.handle);
      scheduledStorageRef.current = null;
    }
    const write = () => {
      scheduledStorageRef.current = null;
      flushStorage();
    };
    if (win.requestIdleCallback) {
      scheduledStorageRef.current = { kind: "idle", handle: win.requestIdleCallback(write, { timeout: 500 }) };
    } else {
      scheduledStorageRef.current = { kind: "timeout", handle: window.setTimeout(write, 500) };
    }
    return () => {
      const scheduled = scheduledStorageRef.current;
      if (!scheduled) return;
      if (scheduled.kind === "idle") win.cancelIdleCallback?.(scheduled.handle);
      else window.clearTimeout(scheduled.handle);
      scheduledStorageRef.current = null;
    };
  }, [boardSnapshotJson, flushStorage, storageKey, storageReady]);
  const projectDirty = !!currentProject?.projectId && serverSnapshotJson !== null && boardSnapshotJson !== serverSnapshotJson;
  const [making, setMaking] = useState(false);
  const [makingKind, setMakingKind] = useState<string | null>(null);
  const [exportProblem, setExportProblem] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportState = exportAvailability({ activeJobs, making, requesting: busy, sceneReady: !!scene });

  useEffect(() => {
    if (openId !== null) return;
    const opener = dialogOpenerRef.current;
    if (!opener) return;
    const frame = window.requestAnimationFrame(() => {
      // TileDialog의 unmount cleanup은 page가 아직 inert일 때 실행될 수 있다.
      // inert 제거 뒤 한 프레임에 다시 잡아야 Esc/닫기 후 BODY로 빠지지 않는다.
      if (opener.isConnected && !opener.closest("[inert]")) opener.focus();
      dialogOpenerRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openId]);

  useEffect(() => {
    if (openId === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const current = document.activeElement;
      const index = current instanceof HTMLElement ? focusable.indexOf(current) : -1;
      if (event.shiftKey && (index <= 0 || !dialog.contains(current))) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && (index === focusable.length - 1 || !dialog.contains(current))) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openId]);
  const makeReport = async () => {
    setMaking(true);
    setMakingKind("PPT");
    setExportProblem(null);
    try {
      const sourceIds = sourceIdsForRefs([...views.values()].flatMap((view) => view.sourceRefs));
      let sourceMeta = new Map<string, SourceMeta>();
      if (sourceIds.length > 0) {
        const query = new URLSearchParams();
        for (const id of sourceIds) query.append("ids", id);
        const sourceResponse = await apiFetch(`/site/api/v2/sources?${query.toString()}`);
        if (sourceResponse.ok) {
          const body = (await sourceResponse.json()) as Partial<SourceApiBody>;
          sourceMeta = sourceMetaMap(Array.isArray(body.sources) ? body.sources : []);
        }
      }
      const reportPlan = buildReportPlan({ summary, views, board, analysisDate, sourceMeta });
      const { renderReportPptx } = await import("@/lib/v2/report/render-pptx");
      // 지도 그림은 브라우저에서 SVG → PNG로 만든다. 못 만들면 자리표시로 계속한다.
      const { buildMapImages } = await import("@/lib/v2/report/map-image");
      const bytes = await renderReportPptx(reportPlan, await buildMapImages(reportPlan, basemap).catch(() => ({})));
      downloadBytes(reportFileName(siteSummary.address, analysisDate), bytes, EXPORT_MIME.pptx);
    } catch {
      setExportProblem("PPT 내보내기에 실패했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setMaking(false);
      setMakingKind(null);
    }
  };

  const makeDxf = async (origin: "site" | "utmk" = "site") => {
    if (!scene) return;
    setMaking(true);
    setMakingKind(origin === "site" ? "DXF · 대지 중심" : "DXF · UTM-K");
    setExportProblem(null);
    try {
      const { dxfFileName, sceneToDxf } = await import("@/lib/v2/export/dxf");
      const dxf = sceneToDxf(scene, { origin });
      downloadBytes(dxfFileName(siteSummary.address, analysisDate), dxf, EXPORT_MIME.dxf);
    } catch {
      setExportProblem(`DXF 내보내기에 실패했습니다. 잠시 뒤 다시 시도해 주세요.`);
    } finally {
      setMaking(false);
      setMakingKind(null);
    }
  };

  const makeGlb = async () => {
    if (!scene) return;
    setMaking(true);
    setMakingKind("GLB");
    setExportProblem(null);
    try {
      const { glbFileName, sceneToGlb } = await import("@/lib/v2/export/glb");
      downloadBytes(glbFileName(siteSummary.address, analysisDate), sceneToGlb(scene), EXPORT_MIME.glb);
    } catch {
      setExportProblem("GLB 내보내기에 실패했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setMaking(false);
      setMakingKind(null);
    }
  };

  const makeDae = async () => {
    if (!scene) return;
    setMaking(true);
    try {
      const { daeFileName, sceneToDae } = await import("@/lib/v2/export/dae");
      downloadBytes(daeFileName(siteSummary.address, analysisDate), sceneToDae(scene), DAE_MIME);
    } finally {
      setMaking(false);
    }
  };

  const make3dm = async () => {
    if (!scene) return;
    setMaking(true);
    setMakingKind("3DM");
    setExportProblem(null);
    try {
      // rhino3dm은 브라우저 번들에 넣을 수 없어(Node 전용 ws·fs 참조) 서버에서 변환한다.
      const res = await fetch("/site/api/v2/export/3dm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scene) });
      if (!res.ok) throw new Error(`3dm ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      downloadBytes(exportFileName("3dm", siteSummary.address, analysisDate), bytes, EXPORT_MIME["3dm"]);
    } catch {
      setExportProblem("3DM 내보내기에 실패했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setMaking(false);
      setMakingKind(null);
    }
  };

  useEffect(() => {
    if (demoStep === null || demoStep > total + 1) return;
    const t = setTimeout(() => setDemoStep(demoStep + 1), 300);
    return () => clearTimeout(t);
  }, [demoStep, total]);
  const demoOn = demoStep !== null && demoStep <= total + 1;
  const finished = demoStep === null ? total : demoFinished(total, demoStep);

  const retry = useCallback((id: string, code: string) => {
    if (!demo) return onRerun();
    const fixed = RECOVERED[code];
    if (!fixed) return;
    setOverrides((o) => ({ ...o, [id]: { ...fixed, tileId: id } }));
    dispatch({ type: "include", id, value: true });
  }, [demo, onRerun]);

  const onTileAction = useCallback((id: string, action: TileCardAction) => {
    const title = views.get(id)?.title ?? "타일";
    switch (action.type) {
      case "resize":
        dispatch({ type: "resize", id, size: action.size });
        setNote(`${title} 타일을 ${action.size}칸으로 바꿈`);
        break;
      case "open":
        setDialogTab("overview");
        setOpenId(id);
        break;
      case "sources":
        setDialogTab("sources");
        setOpenId(id);
        break;
      case "include":
        dispatch({ type: "include", id, value: action.value });
        break;
      case "face":
        dispatch({ type: "face", id, face: action.face });
        break;
      case "roseSeason":
        dispatch({ type: "roseSeason", id, season: action.season });
        break;
      case "cardFace":
        dispatch({ type: "view", id, face: action.face });
        setNote(`${title} ${action.face === "map" ? "지도면" : "요약면"}`);
        break;
      case "remove":
        dispatch({ type: "remove", id });
        setNote(`${title} 타일을 뺌`);
        break;
      case "move": {
        const orderIndex = board.order.indexOf(id);
        dispatch({ type: "move", id, dir: action.dir });
        setNote(`${title} 타일을 ${orderIndex + action.dir + 1}번째로 옮김`);
        break;
      }
      case "retry":
        retry(id, views.get(id)?.code ?? "");
        break;
      case "toggleLabel":
        dispatch({ type: "toggleLabel", id, key: action.key });
        break;
      case "setAllLabels":
        dispatch({ type: "setAllLabels", id, on: action.on });
        break;
      case "stackToggle":
        setStackSelection((current) => action.selected
          ? current.includes(id) ? current : [...current, id]
          : current.filter((selectedId) => selectedId !== id));
        break;
      case "unstack":
        dispatch({ type: "unstack", id });
        setStackSelection((current) => current.filter((selectedId) => selectedId !== id));
        setNote(`${title}을 풀음`);
        break;
      case "sheetToggle":
        setSheetSelection((current) => action.selected
          ? current.includes(id) ? current : [...current, id]
          : current.filter((selectedId) => selectedId !== id));
        break;
      case "unsheet":
        dispatch({ type: "unsheet", id });
        setSheetSelection((current) => current.filter((selectedId) => selectedId !== id));
        setNote(`${title}을 풀음`);
        break;
    }
  }, [board.order, retry, views]);
  const onSummaryFace = useCallback((face: CardFace) => dispatch({ type: "view", id: SUMMARY_ID, face }), []);

  const lastUndo = board.undoStack[board.undoStack.length - 1];
  const openView = openId ? views.get(openId) : undefined;

  return (
    <BasemapContext.Provider value={basemap}>
    <SetBasemapContext.Provider value={setBasemap}>
    <main className={styles.root}>
      <div
        className={styles.page}
        inert={openView ? true : undefined}
        onClickCapture={(event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const sourceButton = target.closest<HTMLButtonElement>("[data-source-button]");
          if (sourceButton) {
            dialogOpenerRef.current = sourceButton;
            return;
          }
          const opener = target.closest<HTMLButtonElement>('button[aria-label$=" 펼치기"]');
          if (opener) {
            dialogOpenerRef.current = opener;
            return;
          }
          const card = target.closest<HTMLElement>("[data-tile-id]");
          if (card && card.tabIndex >= 0) dialogOpenerRef.current = card;
        }}
      >
        <a className={styles.skipLink} href="#v2-board-grid">
          보드로 건너뛰기
        </a>
        <header className={styles.topbar}>
          <span className={`${styles.display} ${styles.brand}`}>{editing ? "보드 편집" : "사이트 분석"}</span>
          <a className={styles.pill} href="/site/v2/guide">가이드</a>
          <ProjectMenu
            analysisId={analysisId}
            currentProjectId={currentProject?.projectId ?? null}
            currentProjectName={currentProject?.name ?? null}
            defaultName={`${siteSummary.address} · ${summary.radius}`}
            board={demo ? null : boardSnapshot}
            canSave={!demo && !!analysisId && !actionBusy}
            dirty={projectDirty}
            onSaved={(project) => {
              if (project.board !== undefined) setServerSnapshotJson(JSON.stringify(project.board));
              onProjectSaved(project);
            }}
            onDeleted={(projectId) => {
              setServerSnapshotJson(null);
              onProjectDeleted(projectId);
            }}
            onOpenProject={onOpenProject}
            onAuthExpired={onAuthExpired}
          />
          {editing ? (
            <>
              <span className={styles.editHint}>순서를 바꾸거나 빼세요. 순서는 보고서 순서가 됩니다.</span>
              <span className={styles.gridControls}>
                <span className={styles.segLabel}>열</span>
                <span className={styles.seg} role="group" aria-label="보드 열 수">
                  {GRID_COLUMN_OPTIONS.map((columns) => (
                    <button key={columns} type="button" aria-pressed={board.columns === columns} onClick={() => dispatch({ type: "columns", columns })}>
                      {columns}
                    </button>
                  ))}
                </span>
              </span>
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
            <span className={styles.topTitle} title={`${siteSummary.address} · ${summary.radius}`}>
              {siteSummary.address} · {summary.radius}
            </span>
          )}
          <span className={styles.spacer} />
          {demo && <span className={styles.demoTag}>데모 데이터</span>}
          {editing ? (
            <button type="button" className={`${styles.pill} ${styles.pillDark}`} onClick={() => setEditing(false)}>
              완료
            </button>
          ) : (
            <>
              {demo && (
                <button type="button" className={`${styles.pill} ${styles.demoToggle}`} onClick={() => (demoOn ? setDemoStep(null) : setDemoStep(0))} aria-pressed={demoOn}>
                  {demoOn ? "데모 끄기" : DEMO_START_LABEL}
                </button>
              )}
              <div className={styles.desktopTools}>
                <span className={styles.segGroup}>
                  <span className={styles.segLabel}>카드</span>
                  <span className={styles.seg} role="group" aria-label="카드 보기">
                    {(["summary", "map"] as const).map((f) => (
                      <button key={f} type="button" aria-pressed={board.viewAll === f} onClick={() => dispatch({ type: "viewAll", face: f })}>
                        {f === "summary" ? "요약" : "지도"}
                      </button>
                    ))}
                  </span>
                </span>
                <span className={styles.segGroup}>
                  <span className={styles.segLabel}>배경지도</span>
                  <span className={styles.seg} role="group" aria-label="배경지도">
                    {BASEMAPS.map((b) => (
                      <button key={b.id} type="button" aria-pressed={basemap === b.id} onClick={() => setBasemap(b.id)}>
                        {b.label}
                      </button>
                    ))}
                  </span>
                </span>
                <button type="button" className={styles.pill} onClick={() => setEditing(true)} disabled={demoOn || actionBusy}>
                  보드 편집
                </button>
                <span className={styles.reportHint}>표지 1 + 타일 {tiles}</span>
                {demo ? (
                  <button type="button" className={`${styles.pill} ${styles.pillDark}`} disabled title="실제 분석 후 사용">
                    내보내기 ▾
                  </button>
                ) : (
                  <details className={styles.exportDetails} open={exportOpen} onToggle={(event) => setExportOpen(event.currentTarget.open)}>
                    <summary
                      className={`${styles.pill} ${styles.pillDark}`}
                      aria-label="내보내기 형식"
                      aria-expanded={exportOpen}
                      aria-disabled={busy || making}
                      onClick={(e) => {
                        if (busy || making) e.preventDefault();
                      }}
                    >
                      {making ? `${makingKind ?? "파일"} 만드는 중…` : "내보내기 ▾"}
                    </summary>
                    <div className={styles.exportMenu} aria-label="내보내기 형식">
                      <button type="button" className={styles.pill} onClick={() => void makeReport()} disabled={!exportState.ppt.enabled} title={exportState.ppt.reason ?? exportState.ppt.pendingNote ?? undefined}>
                        PPT · {reportPageCount}장
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void makeDxf("site")} disabled={!exportState.dxf.enabled} title={exportState.dxf.reason ?? "대지 중심 원점"} aria-label={`DXF · 대지 중심${exportState.dxf.reason ? ` — ${exportState.dxf.reason}` : ""}`}>
                        DXF · 대지 중심
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void makeDxf("utmk")} disabled={!exportState.dxf.enabled} title={exportState.dxf.reason ?? "UTM-K 절대 좌표"} aria-label={`DXF · UTM-K${exportState.dxf.reason ? ` — ${exportState.dxf.reason}` : ""}`}>
                        DXF · UTM-K
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void makeGlb()} disabled={!exportState.glb.enabled} title={exportState.glb.reason ?? "GLB 내보내기"} aria-label={`GLB${exportState.glb.reason ? ` — ${exportState.glb.reason}` : ""}`}>
                        GLB
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void makeDae()} disabled={!exportState.dae.enabled} title={exportState.dae.reason ?? "SketchUp 가져오기용 DAE 내보내기"} aria-label={`DAE · SketchUp${exportState.dae.reason ? ` — ${exportState.dae.reason}` : ""}`}>
                        DAE · SketchUp
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void make3dm()} disabled={!exportState["3dm"].enabled} title={exportState["3dm"].reason ?? "3DM 내보내기"} aria-label={`3DM${exportState["3dm"].reason ? ` — ${exportState["3dm"].reason}` : ""}`}>
                        3DM
                      </button>
                      {exportState.ppt.pendingNote && <p className={styles.exportPendingNote}>{exportState.ppt.pendingNote}</p>}
                      <p className={styles.exportNote}>
                        DXF·GLB: 건물·필지·대지·반경. 래스터(항공사진·인구 격자·시뮬레이션 결과)는 대상 아님<br />
                        3DM: 건물(닫힌 솔리드)·필지·대지·반경·지형 메시
                      </p>
                    </div>
                  </details>
                )}
              </div>
              {exportProblem && <span className={styles.exportError} role="alert">{exportProblem}</span>}
              <details className={styles.mobileTools}>
                <summary className={`${styles.pill} ${styles.pillDark}`} aria-label="보기·편집·내보내기 메뉴">
                  더 보기
                </summary>
                <div className={styles.mobileToolsPanel}>
                  <span className={styles.segGroup}>
                    <span className={styles.segLabel}>카드</span>
                    <span className={styles.seg} role="group" aria-label="카드 보기">
                      {(["summary", "map"] as const).map((f) => (
                        <button key={f} type="button" aria-pressed={board.viewAll === f} onClick={() => dispatch({ type: "viewAll", face: f })}>
                          {f === "summary" ? "요약" : "지도"}
                        </button>
                      ))}
                    </span>
                  </span>
                  <span className={styles.segGroup}>
                    <span className={styles.segLabel}>배경지도</span>
                    <span className={styles.seg} role="group" aria-label="배경지도">
                      {BASEMAPS.map((b) => (
                        <button key={b.id} type="button" aria-pressed={basemap === b.id} onClick={() => setBasemap(b.id)}>
                          {b.label}
                        </button>
                      ))}
                    </span>
                  </span>
                  <button type="button" className={styles.pill} onClick={() => setEditing(true)} disabled={demoOn || actionBusy}>
                    보드 편집
                  </button>
                  <span className={styles.reportHint}>표지 1 + 타일 {tiles}</span>
                  {demo ? (
                    <button type="button" className={`${styles.pill} ${styles.pillDark}`} disabled title="실제 분석 후 사용">
                      내보내기 ▾
                    </button>
                  ) : (
                    <div className={styles.mobileExportActions}>
                      <button type="button" className={styles.pill} onClick={() => void makeReport()} disabled={!exportState.ppt.enabled} title={exportState.ppt.reason ?? exportState.ppt.pendingNote ?? undefined}>
                        PPT · {reportPageCount}장
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void makeDxf("site")} disabled={!exportState.dxf.enabled} title={exportState.dxf.reason ?? "대지 중심 원점"} aria-label={`DXF · 대지 중심${exportState.dxf.reason ? ` — ${exportState.dxf.reason}` : ""}`}>
                        DXF · 대지 중심
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void makeDxf("utmk")} disabled={!exportState.dxf.enabled} title={exportState.dxf.reason ?? "UTM-K 절대 좌표"} aria-label={`DXF · UTM-K${exportState.dxf.reason ? ` — ${exportState.dxf.reason}` : ""}`}>
                        DXF · UTM-K
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void makeGlb()} disabled={!exportState.glb.enabled} title={exportState.glb.reason ?? "GLB 내보내기"} aria-label={`GLB${exportState.glb.reason ? ` — ${exportState.glb.reason}` : ""}`}>
                        GLB
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void makeDae()} disabled={!exportState.dae.enabled} title={exportState.dae.reason ?? "SketchUp 가져오기용 DAE 내보내기"} aria-label={`DAE · SketchUp${exportState.dae.reason ? ` — ${exportState.dae.reason}` : ""}`}>
                        DAE · SketchUp
                      </button>
                      <button type="button" className={styles.pill} onClick={() => void make3dm()} disabled={!exportState["3dm"].enabled} title={exportState["3dm"].reason ?? "3DM 내보내기"} aria-label={`3DM${exportState["3dm"].reason ? ` — ${exportState["3dm"].reason}` : ""}`}>
                        3DM
                      </button>
                      {exportState.ppt.pendingNote && <p className={styles.exportPendingNote}>{exportState.ppt.pendingNote}</p>}
                    </div>
                  )}
                </div>
              </details>
            </>
          )}
        </header>

        {demoOn && (
          <div className={styles.progressRow}>
            <span className={styles.progressLabel}>분석 중</span>
            <div className={styles.progress} role="progressbar" aria-label="분석 진행" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished}>
              <div className={styles.progressFill} style={{ width: `${(finished / total) * 100}%` }} />
            </div>
            <span className={styles.progressText} aria-live="polite">{finished} / {total}</span>
          </div>
        )}

        {!demo && <AnalysisProgress jobs={jobs} onCancel={onCancel} canceling={canceling} />}

        {controls}

        <div className={styles.grid} id="v2-board-grid" ref={gridRef} tabIndex={-1} data-grid-cols={gridLayout.columns} style={{ "--grid-cols": gridLayout.columns, "--grid-row-height": `${gridLayout.rowHeight}px` } as CSSProperties}>
          <SummaryCard view={summary} face={editing ? "summary" : viewOf(board, SUMMARY_ID)} onFace={onSummaryFace} />
          {visibleShown.map((id, i) => {
            const view = views.get(id)!;
            const size = board.sizes[id];
            const oi = board.order.indexOf(id);
            const dragged = drag?.id === id;
            return (
              <Fragment key={id}>
                {dragged && (
                  <div key="ph" className={`${styles.placeholder} ${size === 2 ? styles.span2 : size === 4 ? styles.span4 : ""}`} data-placeholder>
                    여기에 놓기
                  </div>
                )}
                <TileCard
                  key="card"
                  view={view}
                  layer={view.defaultLayer}
                  onLayer={(layer) => dispatch({ type: "layer", id, layer })}
                  phase={demoOn ? demoPhase(i, demoStep!) : (jobState.byCode.get(view.code)?.phase ?? null)}
                  waitingNote={demoOn ? null : (jobState.byCode.get(view.code)?.note ?? null)}
                  included={!!board.included[id]}
                  face={board.faces[id]}
                  editing={editing}
                  canUp={oi > 0}
                  canDown={oi < total - 1}
                  size={size}
                  dragging={dragged}
                  floatStyle={floatStyle(id)}
                  onHandleDown={start(id)}
                  onAction={onTileAction}
                  roseSeason={board.roseSeasons[id] ?? "annual"}
                  pinnedLabels={board.labels[id] ?? EMPTY_PINNED_LABELS}
                  cardFace={viewOf(board, id)}
                  onWindUploaded={onWindUploaded}
                  stackable={stackableIds.includes(id)}
                  stackSelected={stackSelection.includes(id)}
                  sheetable={sheetableIds.includes(id)}
                  sheetSelected={sheetSelection.includes(id)}
                />
              </Fragment>
            );
          })}
        </div>
        {notProvidedIds.length > 0 && (
          <details className={styles.notProvidedGroup}>
            <summary className={styles.notProvidedSummary}>준비 중 {notProvidedIds.length}개</summary>
            <ul className={styles.notProvidedList} aria-label="준비 중인 타일">
              {notProvidedIds.map((id) => {
                const view = views.get(id)!;
                return <li key={id} className={styles.notProvidedItem}><span className={styles.dot} style={{ background: view.color }} />{view.title}<span>자료 확인 후 제공</span></li>;
              })}
            </ul>
          </details>
        )}
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
          {lastUndo.kind === "columns" ? `${UNDO_LABEL.columns} · ${lastUndo.columns}열` : `${UNDO_LABEL[lastUndo.kind]} · ${views.get(lastUndo.id)?.title}`}
          <button type="button" onClick={() => dispatch({ type: "undo" })}>
            되돌리기
          </button>
        </div>
      )}

      {openView && (
        <TileDialog
          view={openView}
          layer={openView.defaultLayer}
          onLayer={(layer) => {
            dispatch({ type: "layer", id: openView.tileId, layer });
            setNote(`${openView.title} 표현을 ${openView.layerOptions.find((option) => option.id === layer)?.label ?? layer}(으)로 변경`);
          }}
          initialTab={dialogTab}
          included={!!board.included[openView.tileId]}
          face={board.faces[openView.tileId]}
          onInclude={(value) => dispatch({ type: "include", id: openView.tileId, value })}
          onFace={(face) => dispatch({ type: "face", id: openView.tileId, face })}
          onRetry={() => retry(openView.tileId, openView.code)}
          roseSeason={board.roseSeasons[openView.tileId] ?? "annual"}
          onRoseSeason={(season) => dispatch({ type: "roseSeason", id: openView.tileId, season })}
          calloutMode={board.callout[openView.tileId] ?? DEFAULT_CALLOUT_MODE}
          onCalloutMode={(mode) => dispatch({ type: "callout", id: openView.tileId, mode })}
          a05Filter={board.a05Filter[openView.tileId] ?? null}
          a05Counts={openView.a05Counts ?? null}
          onA05Filter={(filter) => {
            dispatch({ type: "a05Filter", id: openView.tileId, filter });
            setNote(filter ? `${openView.title} 필터 적용` : `${openView.title} 필터 초기화`);
          }}
          pinnedLabels={board.labels[openView.tileId] ?? []}
          onToggleLabel={(key) => dispatch({ type: "toggleLabel", id: openView.tileId, key })}
          onUnpinLabel={(key) => dispatch({ type: "unpinLabel", id: openView.tileId, key })}
          onSetAllLabels={(on) => dispatch({ type: "setAllLabels", id: openView.tileId, on })}
          camera={openView.mass?.camera}
          onCamera={(camera) => dispatch({ type: "camera", id: openView.tileId, camera })}
          cuts={openView.code === "S02" ? (board.cuts[openView.tileId] ?? 1) : undefined}
          onCuts={openView.code === "S02" ? (cuts) => dispatch({ type: "cuts", id: openView.tileId, cuts }) : undefined}
          onWindUploaded={onWindUploaded}
          onClose={() => {
            setOpenId(null);
            setDialogTab("overview");
          }}
        />
      )}
    </main>
    </SetBasemapContext.Provider>
    </BasemapContext.Provider>
  );
}

const API = "/site/api/v2/analyses";
const PROJECTS_API = "/site/api/v2/projects";

/** 401이면 refresh 쿠키로 한 번 갱신하고 같은 요청을 다시 보낸다. */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, credentials: "include" });
  if (res.status !== 401) return res;
  const refreshed = await fetch("/site/api/auth/refresh", { method: "POST", credentials: "include" }).then((r) => r.ok, () => false);
  return refreshed ? fetch(url, { ...init, credentials: "include" }) : res;
}

type TileState = { code: string; status: TileResult["status"]; revision: string; elapsedMs?: number | null };
type Live = { analysisId: string; summary: SiteSummary; results: TileResult[]; jobs: JobState[]; tiles: TileState[]; revision: string; scene: Scene | null };
type Problem = { text: string; login: boolean };
const POLL_DELAYS_MS = [1000, 2000, 5000] as const;

const ADDRESS_INPUT_ID = "v2-address-input";

function readHydratedAddress(): string {
  if (typeof document === "undefined") return "";
  const input = document.getElementById(ADDRESS_INPUT_ID);
  return input instanceof HTMLInputElement ? input.value : "";
}

function mergeResults(existing: TileResult[], incoming: TileResult[]): TileResult[] {
  if (existing.length === 0) return [...incoming];
  const replacements = new Map(incoming.map((result) => [result.tileCode, result]));
  const existingCodes = new Set(existing.map((result) => result.tileCode));
  return [...existing.map((result) => replacements.get(result.tileCode) ?? result), ...incoming.filter((result) => !existingCodes.has(result.tileCode))];
}

function pickerParcelsFromScene(scene: Scene | null, site: SiteInput | null): SitePickerParcel[] {
  if (!scene || !site || !("pnus" in site)) return [];
  const selected = new Set(site.pnus);
  return scene.parcels.filter((parcel) => selected.has(parcel.pnu) && parcel.rings.length > 0).map((parcel) => ({
    pnu: parcel.pnu,
    label: jibunFromPnu(parcel.pnu),
    jimok: parcel.jimok,
    areaM2: parcel.areaM2,
    geometry: {
      type: "Polygon" as const,
      coordinates: parcel.rings.map((ring) => ring.map(([x, y]) => toLngLat([scene.origin.x + x, scene.origin.y + y]) as [number, number])),
    },
  }));
}

/** 주소 입력 → 분석 → 실제 결과 보드. 분석 전에는 예시 보드를 그대로 보여 준다. */
export default function V2BoardPage() {
  // React hydration can start after a user has typed into the server-rendered input.
  // Seed the controlled value from that DOM value so hydration does not erase it.
  const hydratedAddress = readHydratedAddress();
  const [address, setAddress] = useState(() => hydratedAddress);
  const addressDirtyRef = useRef(hydratedAddress.length > 0);
  const [radiusM, setRadiusM] = useState(1000);
  const [siteInput, setSiteInput] = useState<SiteInput | null>(null);
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [sitePickerValid, setSitePickerValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const activeJobs = live?.jobs.some((job) => job.status === "queued" || job.status === "running") ?? false;
  const [windRefresh, setWindRefresh] = useState(0);
  const [wantedId, setWantedId] = useState<string | null>(null);
  const [wantedProjectId, setWantedProjectId] = useState<string | null>(null);
  const [currentProject, setCurrentProject] = useState<V2Project | null>(null);
  const [projectBoard, setProjectBoard] = useState<unknown | null>(null);
  const [staleProject, setStaleProject] = useState<V2Project | null>(null);

  async function load(res: Response, refreshScene = true, update = true, base: Live | null = live, preserveProjectId: string | null = null): Promise<Live | undefined> {
    const body = (await res.json().catch(() => ({}))) as Partial<Live> & { error?: string };
    if (res.status === 401) {
      setProblem({ text: "로그인이 필요합니다.", login: true });
      return undefined;
    }
    if (!res.ok || !body.analysisId) {
      setProblem({ text: body.error ?? "분석하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", login: false });
      return undefined;
    }
    const prior = base?.analysisId === body.analysisId ? base : null;
    let scene: Scene | null = prior?.scene ?? null;
    if (refreshScene) {
      try {
        const sceneRes = await apiFetch(`${API}/${encodeURIComponent(body.analysisId)}/scene`);
        if (sceneRes.ok) scene = (await sceneRes.json()) as Scene;
      } catch {
        // 장면이 없어도 분석 결과 보드는 계속 연다. S01은 빈 매스 틀을 표시한다.
      }
    }
    const incoming = (body.results ?? []) as TileResult[];
    const next: Live = {
      analysisId: body.analysisId,
      summary: body.summary ?? prior!.summary,
      results: prior ? mergeResults(prior.results, incoming) : incoming,
      jobs: body.jobs ?? prior?.jobs ?? [],
      tiles: body.tiles ?? prior?.tiles ?? [],
      revision: body.revision ?? prior?.revision ?? "",
      scene,
    };
    if (update) {
      setLive(next);
      history.replaceState(null, "", preserveProjectId ? `?project=${encodeURIComponent(preserveProjectId)}` : `?analysis=${body.analysisId}`);
    }
    return next;
  }

  async function analyze(e?: { preventDefault(): void }, restoreProject: V2Project | null = null) {
    e?.preventDefault();
    if (busy || activeJobs) return;
    if (!address.trim()) return setProblem({ text: "지번 주소로 입력해 주세요. 예: 서울 강동구 고덕동 123", login: false });
    if (isRoadAddress(address)) return setProblem({ text: ROAD_ADDRESS_UNSUPPORTED_MESSAGE, login: false });
    setBusy(true);
    setProblem(null);
    if (!restoreProject) {
      setCurrentProject(null);
      setProjectBoard(null);
      setWantedProjectId(null);
      setStaleProject(null);
    }
    try {
      const requestedSite = restoreProject?.site ?? siteInput;
      const loaded = await load(await apiFetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: address.trim(), radiusM, ...(requestedSite ? { site: requestedSite } : {}) }) }), true, true, null, restoreProject?.projectId ?? null);
      if (!loaded || !restoreProject) return;
      const rebasedBoard = rebaseSnapshotAnalysisId(restoreProject.board, restoreProject.analysisId, loaded.analysisId);
      setProjectBoard(rebasedBoard);
      const saveResponse = await apiFetch(PROJECTS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: restoreProject.projectId, name: restoreProject.name, analysisId: loaded.analysisId, board: rebasedBoard ?? {} }),
      });
      const saveBody = await saveResponse.json().catch(() => ({})) as { project?: V2Project; error?: string };
      if (saveResponse.status === 401) {
        setProblem({ text: "로그인이 만료되었습니다.", login: true });
      } else if (!saveResponse.ok || !saveBody.project) {
        setProblem({ text: saveBody.error ?? "새 분석은 완료됐지만 프로젝트를 갱신하지 못했습니다.", login: false });
      } else {
        setCurrentProject(saveBody.project);
        setProjectBoard(saveBody.project.board ?? rebasedBoard);
        setWantedProjectId(saveBody.project.projectId);
        setStaleProject(null);
        history.replaceState(null, "", `?project=${encodeURIComponent(saveBody.project.projectId)}`);
      }
    } catch {
      setProblem({ text: "서버에 연결하지 못했습니다.", login: false });
    } finally {
      setBusy(false);
    }
  }

  async function cancelCurrentAnalysis() {
    if (!live || !activeJobs || canceling) return;
    setCanceling(true);
    setProblem(null);
    const id = live.analysisId;
    try {
      const response = await apiFetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
      const snapshot = await load(response, false, false, live);
      if (!snapshot) return;
      // DELETE 응답은 작업·타일 상태만 담으므로, 취소된 TileResult도 즉시 보드에 반영한다.
      await load(await apiFetch(`${API}/${encodeURIComponent(id)}`), false, true, snapshot);
    } catch {
      setProblem({ text: "계산을 취소하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", login: false });
    } finally {
      setCanceling(false);
    }
  }

  async function openProject(projectId: string) {
    setWantedProjectId(projectId);
    setWantedId(null);
    setLive(null);
    setCurrentProject(null);
    setProjectBoard(null);
    setStaleProject(null);
    setProblem(null);
    setBusy(true);
    history.pushState(null, "", `?project=${encodeURIComponent(projectId)}`);
    try {
      const projectResponse = await apiFetch(`${PROJECTS_API}/${encodeURIComponent(projectId)}`);
      const projectBody = await projectResponse.json().catch(() => ({})) as { project?: V2Project; error?: string; code?: string };
      if (projectResponse.status === 401) {
        setProblem({ text: "로그인이 만료되었습니다.", login: true });
        return;
      }
      if (projectResponse.status === 409 && projectBody.project) {
        setStaleProject(projectBody.project);
        addressDirtyRef.current = true;
        setAddress(projectBody.project.address);
        setRadiusM(projectBody.project.radiusM);
        setSiteInput(projectBody.project.site ?? null);
        setSitePickerValid(!!projectBody.project.site);
        setProjectBoard(projectBody.project.board ?? null);
        setProblem({ text: "데이터가 갱신되어 다시 분석이 필요합니다.", login: false });
        return;
      }
      if (!projectResponse.ok || !projectBody.project) {
        setProblem({ text: projectBody.error ?? "프로젝트를 불러오지 못했습니다.", login: false });
        return;
      }
      const project = projectBody.project;
      setCurrentProject(project);
      setProjectBoard(project.board ?? null);
      addressDirtyRef.current = true;
      setAddress(project.address);
      setRadiusM(project.radiusM);
      setSiteInput(project.site ?? null);
      setSitePickerValid(!!project.site);
      setStaleProject(null);
      await load(await apiFetch(`${API}/${encodeURIComponent(project.analysisId)}`), true, true, null, project.projectId);
    } catch {
      setProblem({ text: "서버에 연결하지 못했습니다.", login: false });
    } finally {
      setBusy(false);
    }
  }

  function handleProjectSaved(project: V2Project) {
    setCurrentProject((current) => project.board === undefined && current ? { ...current, ...project } : project);
    if (project.board !== undefined) setProjectBoard(project.board);
    if (project.site !== undefined) setSiteInput(project.site);
    setWantedProjectId(project.projectId);
    setWantedId(null);
    setStaleProject(null);
    history.replaceState(null, "", `?project=${encodeURIComponent(project.projectId)}`);
    setProblem(null);
  }

  function handleProjectDeleted(projectId: string) {
    if (currentProject?.projectId !== projectId) return;
    setCurrentProject(null);
    setProjectBoard(null);
    setWantedProjectId(null);
    history.replaceState(null, "", live ? `?analysis=${encodeURIComponent(live.analysisId)}` : "/site/v2");
  }

  // 주소창의 ?analysis=<id>로 저장된 분석을 다시 연다
  useEffect(() => {
    const queryAddress = new URLSearchParams(window.location.search).get("address");
    if (queryAddress && !addressDirtyRef.current) setAddress(queryAddress);
    const projectId = new URLSearchParams(window.location.search).get("project");
    if (projectId) {
      void openProject(projectId);
      return;
    }
    const id = new URLSearchParams(window.location.search).get("analysis");
    if (!id) return;
    setWantedId(id);
    setBusy(true);
    apiFetch(`${API}/${encodeURIComponent(id)}`)
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
    let currentLive = live;
    let delayIndex = 0;
    const poll = async () => {
      let shouldContinue = true;
      try {
        const headers: HeadersInit = currentLive.revision ? { "If-None-Match": `"${currentLive.revision}"` } : {};
        const response = await apiFetch(`${API}/${encodeURIComponent(currentLive.analysisId)}?status=1`, { headers });
        if (response.status === 304) {
          shouldContinue = currentLive.jobs.some((job) => job.status === "queued" || job.status === "running");
          delayIndex = Math.min(delayIndex + 1, POLL_DELAYS_MS.length - 1);
        } else if (response.ok) {
          const status = (await response.json()) as { revision: string; tiles: TileState[]; jobs: JobState[] };
          const changedCodes = status.tiles.filter((tile) => currentLive.tiles.find((old) => old.code === tile.code)?.revision !== tile.revision).map((tile) => tile.code);
          let next: Live = { ...currentLive, revision: status.revision, tiles: status.tiles, jobs: status.jobs };
          if (changedCodes.length > 0) {
            const resultResponse = await apiFetch(`${API}/${encodeURIComponent(currentLive.analysisId)}?tiles=${encodeURIComponent(changedCodes.join(","))}`);
            const loaded = await load(resultResponse, false, false, currentLive);
            if (loaded) next = loaded;
          }
          if (!cancelled) {
            const changed = next.revision !== currentLive.revision || changedCodes.length > 0;
            currentLive = next;
            if (changed) {
              setLive(next);
              delayIndex = 0;
            } else {
              delayIndex = Math.min(delayIndex + 1, POLL_DELAYS_MS.length - 1);
            }
          }
          shouldContinue = status.jobs.some((job) => job.status === "queued" || job.status === "running");
        }
      } catch {
        delayIndex = Math.min(delayIndex + 1, POLL_DELAYS_MS.length - 1);
      }
      if (!cancelled && shouldContinue) timer = setTimeout(poll, POLL_DELAYS_MS[delayIndex]);
    };
    timer = setTimeout(poll, POLL_DELAYS_MS[0]);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // load는 렌더마다 새 함수지만, analysisId/jobs 상태가 바뀔 때만 폴링을 재설정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.analysisId, activeJobs]);

  // Browser WebGPU uploads update S03 directly; fetch the fresh result once,
  // then the normal job poller continues if S04 was enqueued by the server.
  useEffect(() => {
    if (!live || windRefresh === 0) return;
    let cancelled = false;
    void apiFetch(`${API}/${encodeURIComponent(live.analysisId)}`)
      .then((response) => load(response, false, true, live))
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setWindRefresh(0);
      });
    return () => {
      cancelled = true;
    };
    // load is intentionally the current page loader; the refresh token is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.analysisId, windRefresh]);

  const pickerParcels = useMemo(() => pickerParcelsFromScene(live?.scene ?? null, siteInput), [live?.scene, siteInput]);

  useEffect(() => {
    if (live && !addressDirtyRef.current) {
      setAddress(live.summary.address);
      setRadiusM(live.summary.radiusM);
    }
  }, [live]);

  const controls = (
    <div className={styles.analyzeWrap}>
      {!live && <p className={styles.demoContext}>예시: 고덕동 123 · 반경 1km — 주소를 넣으면 실제 분석</p>}
      <form className={styles.analyzeBar} onSubmit={analyze}>
        <label className={styles.srOnly} htmlFor={ADDRESS_INPUT_ID}>지번 주소</label>
        <input
          id={ADDRESS_INPUT_ID}
          className={styles.addrInput}
          value={address}
          onChange={(e) => {
            addressDirtyRef.current = true;
            setAddress(e.target.value);
            setSiteInput(null);
            setSitePickerValid(false);
            if (problem && !problem.login) setProblem(null);
          }}
          placeholder="지번 주소 (예: 서울 강동구 고덕동 123)"
          aria-label="지번 주소"
          aria-invalid={problem && !problem.login ? true : undefined}
          aria-describedby={problem && !problem.login ? "v2-address-error" : undefined}
          disabled={busy || activeJobs}
        />
        <select className={styles.radiusSelect} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))} aria-label="분석 반경" aria-describedby="v2-radius-help" disabled={busy || activeJobs}>
          {RADIUS_OPTIONS.map((r) => (
            <option key={r.m} value={r.m}>
              {r.label}
            </option>
          ))}
        </select>
        <button type="button" className={styles.pill} onClick={() => setSitePickerOpen((open) => !open)} disabled={busy || activeJobs} aria-expanded={sitePickerOpen} aria-controls="v2-site-picker">
          {sitePickerOpen ? "대지 지정 닫기" : "대지 지정"}
        </button>
        <button type="submit" className={`${styles.pill} ${styles.pillDark}`} disabled={busy || activeJobs || (sitePickerOpen && !sitePickerValid)} aria-busy={busy || activeJobs}>
          {busy || activeJobs ? "분석 중…" : sitePickerOpen ? "이 대지로 분석" : "분석"}
        </button>
      </form>
      <p id="v2-radius-help" className={styles.radiusCaption}>반경 해석: {RADIUS_CAPTION}</p>
      {sitePickerOpen && (
        <div id="v2-site-picker">
          <SitePicker
            address={address}
            radiusM={radiusM}
            initialSite={siteInput}
            initialParcels={pickerParcels}
            disabled={busy || activeJobs}
            serverError={problem && !problem.login ? problem.text : null}
            onSiteChange={(site) => setSiteInput(site)}
            onValidityChange={setSitePickerValid}
          />
        </div>
      )}
      {problem && (
        <p id="v2-address-error" className={styles.problem} role="alert">
          {problem.text}
          {problem.login && (
            <>
              {" "}
              <a href={`/site/login?next=${encodeURIComponent(`/site/v2?address=${address.trim()}`)}`}>로그인하기</a>로 이동해 주세요.
            </>
          )}
        </p>
      )}
    </div>
  );

  // ?analysis=·?project= 주소는 불러오기 전·실패 시에도 예시 보드를 보여 주지 않는다.
  if ((wantedId || wantedProjectId) && !live) {
    const query = wantedProjectId ? `project=${wantedProjectId}` : `analysis=${wantedId}`;
    const loginHref = `/site/login?next=${encodeURIComponent(`/site/v2?${query}`)}`;
    return (
      <main style={{ maxWidth: 480, margin: "15vh auto", padding: "0 16px", textAlign: "center" }}>
        {busy || !problem ? (
          <p role="status">분석 결과를 불러오는 중…</p>
        ) : problem.login ? (
          <>
            <h1 style={{ fontSize: 20 }}>로그인이 만료되었습니다</h1>
            <p role="alert">저장된 분석을 보려면 다시 로그인해 주세요.</p>
            <a href={loginHref} style={{ display: "inline-block", minHeight: 44, lineHeight: "44px", padding: "0 20px", background: "#1b1b1b", color: "#fff", borderRadius: 8 }}>
              다시 로그인
            </a>
          </>
        ) : staleProject ? (
          <>
            <h1 style={{ fontSize: 20 }}>{staleProject.name}</h1>
            <p role="alert">데이터가 갱신되어 다시 분석이 필요합니다</p>
            <button type="button" onClick={() => void analyze(undefined, staleProject)} disabled={busy} style={{ minHeight: 44, padding: "0 20px", border: 0, borderRadius: 8, background: "#1b1b1b", color: "#fff", fontWeight: 700 }}>
              같은 조건으로 다시 분석
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20 }}>분석을 불러오지 못했습니다</h1>
            <p role="alert">{problem.text}</p>
            <a href="/site/v2">새 분석 시작</a>
          </>
        )}
      </main>
    );
  }

  return (
    <Board
      key={live?.analysisId ?? "demo"}
      baseResults={live?.results ?? GODEOK_RESULTS}
      siteSummary={live?.summary ?? GODEOK_SUMMARY}
      analysisId={live?.analysisId ?? null}
      scene={live?.scene ?? null}
      demo={!live}
      jobs={live?.jobs ?? []}
      busy={busy}
      controls={controls}
      onRerun={() => void analyze()}
      onCancel={() => void cancelCurrentAnalysis()}
      canceling={canceling}
      currentProject={currentProject}
      initialProjectBoard={projectBoard}
      onProjectSaved={handleProjectSaved}
      onProjectDeleted={handleProjectDeleted}
      onOpenProject={(projectId) => void openProject(projectId)}
      onAuthExpired={() => setProblem({ text: "로그인이 만료되었습니다.", login: true })}
      onWindUploaded={() => setWindRefresh((value) => value + 1)}
    />
  );
}

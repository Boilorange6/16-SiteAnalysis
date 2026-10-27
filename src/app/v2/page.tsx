"use client";

import { Fragment, memo, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import SummaryCard from "@/components/v2/summary-card";
import TileCard, { type TileCardAction } from "@/components/v2/tile-card";
import TileDialog from "@/components/v2/tile-dialog";
import Presentation from "@/components/v2/presentation";
import ReportMode from "@/components/v2/report/report-mode";
import { useTileDrag } from "@/components/v2/use-tile-drag";
import { BASEMAPS, BasemapContext, SetBasemapContext } from "@/components/v2/map-box";
import { BaseThemeContext } from "@/components/v2/base-theme-context";
import { baseUsable, mapBaseFromScene } from "@/lib/v2/ui/basemap";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import styles from "@/components/v2/board.module.css";
import { SUMMARY_ID, boardReducer, boardStorageKey, initBoard, nextCopyId, rebaseSnapshotAnalysisId, selectBoardSnapshotForLoad, serializeBoardState, sourceTileId, viewOf, type CardFace, type CutSpec, type GridColumns, type PinnedLabel } from "@/lib/v2/ui/board-state";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import { planReportDoc, printedPageCount } from "@/lib/v2/report/report-doc-plan";
import { downloadBytes, exportFileName, EXPORT_MIME, DAE_MIME } from "@/lib/v2/export/download";
import { stackView } from "@/lib/v2/ui/stack";
import { sheetView } from "@/lib/v2/ui/sheet";
import { exportAvailability, formatElapsedMs, jobProgress } from "@/lib/v2/ui/board-status";
import { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } from "@/lib/v2/ui/fixtures/godeok";
import { toSummaryView, toTileView, viewWithLayer, type SiteSummary, type TileView } from "@/lib/v2/ui/tile-view";
import { siteParcelFromResults } from "@/lib/v2/ui/site-parcel";
import { toLngLat } from "@/lib/v2/crs";
import { jibunFromPnu, type SitePickerParcel } from "@/lib/v2/ui/site-picker";
import type { TileResult } from "@/lib/v2/tile-result";
import type { Scene } from "@/lib/v2/scene";
import { isRoadAddress, ROAD_ADDRESS_UNSUPPORTED_MESSAGE } from "@/lib/v2/site";
import { RADIUS_CAPTION, RADIUS_OPTIONS } from "@/lib/v2/ui/radius-options";
import ProjectMenu, { type V2Project } from "@/components/v2/project-menu";
import SitePicker from "@/components/v2/site-picker";
import TopoPanel from "@/components/v2/topo-panel";
import { useFocusTrap } from "@/components/v2/use-focus-trap";
import AddressSuggest from "@/components/v2/address-suggest";
import type { SiteInput } from "@/lib/v2/site";
import { DEFAULT_PRESET_ID, PRESET_IDS, TILE_PRESETS, type PresetId } from "@/lib/v2/ui/tile-catalog";
import { getRovingTargetIndex, type RovingGridItem } from "@/lib/v2/ui/roving-grid";
import { topoReducer, type TopoState } from "@/lib/v2/ui/topo-state";
import { prepareTopoZip, TOPO_ERROR_COPY, TopoClientError, uploadTopo, type TopoErrorCopyCode } from "@/lib/v2/ui/topo-upload";
import { useAuth } from "@/providers/auth-provider";

const UNDO_LABEL = { order: "옮김", size: "크기 바꿈", columns: "열 수 바꿈", remove: "삭제됨", removeCopy: "복제 삭제됨", duplicate: "복제됨", add: "추가됨", preset: "프리셋 적용" } as const;
const UNDO_TOAST_MS = 5000;
const GRID_COLUMN_OPTIONS: GridColumns[] = [2, 3, 4, 5, 6];
const EMPTY_PINNED_LABELS: PinnedLabel[] = [];
const TOPO_NUDGE_RELIEF_M = 10;

type BoardProps = {
  baseResults: TileResult[];
  siteSummary: SiteSummary;
  analysisId: string | null;
  scene: Scene | null;
  jobs: JobState[];
  refreshSummary: RefreshSummary | null;
  refreshing?: boolean;
  refreshError: RefreshError | null;
  onRefresh: () => void;
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
  /** 주소 입력부에서 고른 초기 프리셋과 보드 배치부의 현재 프리셋을 맞춘다. */
  requestedPreset: PresetId;
  initialPreset: PresetId;
  onPresetChange: (preset: PresetId) => void;
  topoState: TopoState;
  topoUsed?: boolean;
  onTopoPick: () => void;
  onTopoNudge: () => void;
  onTopoRemove: () => void;
};

type JobState = {
  code: string;
  status: "queued" | "running" | "done" | "failed";
  enqueuedAt?: string | null;
  startedAt?: string | null;
  elapsedMs: number | null;
  error?: string | null;
  retryable?: boolean;
};
type RefreshSummary = { staleTiles: number; canRefresh: boolean };
type RefreshError = { text: string; retryable: boolean };

type RefreshApiPayload = {
  refresh?: unknown;
  refreshSummary?: unknown;
  staleTiles?: unknown;
  canRefresh?: unknown;
};

/** 서버가 갱신 요약을 보내지 않는 기존 응답은 이전 요약을 유지한다. */
function refreshSummaryFromPayload(payload: RefreshApiPayload, prior: Live | null): RefreshSummary | null {
  const nested = payload.refreshSummary && typeof payload.refreshSummary === "object" && !Array.isArray(payload.refreshSummary)
    ? payload.refreshSummary as Record<string, unknown>
    : payload.refresh && typeof payload.refresh === "object" && !Array.isArray(payload.refresh)
      ? payload.refresh as Record<string, unknown>
      : null;
  // 현재 API는 refresh.staleCodes를, 호환 응답은 staleTiles를 사용할 수 있다.
  const staleValue = nested?.staleTiles ?? payload.staleTiles ?? nested?.staleCodes;
  const staleTiles = typeof staleValue === "number" && Number.isFinite(staleValue)
    ? Math.max(0, Math.floor(staleValue))
    : Array.isArray(staleValue)
      ? staleValue.length
      : null;
  const canRefreshValue = nested?.canRefresh ?? payload.canRefresh;
  const canRefresh = typeof canRefreshValue === "boolean" ? canRefreshValue : prior?.refreshSummary?.canRefresh;
  if (staleTiles === null && canRefresh === undefined) return prior?.refreshSummary ?? null;
  return {
    staleTiles: staleTiles ?? prior?.refreshSummary?.staleTiles ?? 0,
    canRefresh: canRefresh === true,
  };
}

const AnalysisRefreshBanner = memo(function AnalysisRefreshBanner({
  summary,
  activeJobs,
  busy,
  refreshing = false,
  error,
  onRefresh,
}: {
  summary: RefreshSummary | null;
  activeJobs: boolean;
  busy: boolean;
  refreshing?: boolean;
  error: RefreshError | null;
  onRefresh: () => void;
}) {
  const staleTiles = summary?.staleTiles ?? 0;
  const authorized = summary?.canRefresh === true;
  const visible = staleTiles > 0 && !busy && !activeJobs && (authorized || !!error);
  if (!visible) return null;
  const canRetry = authorized && (error?.retryable ?? true);
  return (
    <section
      className={`${styles.refreshBanner} ${error ? styles.refreshBannerError : ""}`}
      aria-live={error ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className={styles.refreshCopy}>
        <p className={styles.refreshMessage}>
          {error ? "최신 엔진으로 갱신하지 못했습니다." : `이 분석은 이전 엔진·데이터로 계산됐습니다 (타일 ${staleTiles}개)`}
        </p>
        {error && <p className={styles.refreshError}>{error.text}</p>}
      </div>
      {canRetry && (
        <button
          type="button"
          className={`${styles.pill} ${styles.refreshButton}`}
          onClick={onRefresh}
          disabled={refreshing || busy || activeJobs}
          aria-busy={refreshing}
        >
          {refreshing ? "갱신 중…" : error ? "다시 시도" : "최신 엔진으로 갱신"}
        </button>
      )}
    </section>
  );
});

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

type ColumnPickerProps = {
  columns: GridColumns;
  onColumns: (columns: GridColumns) => void;
};

function ColumnPicker({ columns, onColumns }: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const [keyboardOpened, setKeyboardOpened] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const keyboardOpenRef = useRef(false);
  const menuId = `v2-columns-${useId().replace(/:/g, "")}`;

  const focusOption = useCallback((index: number) => {
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  }, []);
  const openMenu = useCallback((byKeyboard: boolean) => {
    setKeyboardOpened(byKeyboard);
    setOpen(true);
    focusOption(GRID_COLUMN_OPTIONS.indexOf(columns));
  }, [columns, focusOption]);
  const closeMenu = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closeMenu, open]);

  const select = (option: GridColumns) => {
    onColumns(option);
    closeMenu(true);
  };

  return (
    <div ref={rootRef} className={styles.columnPicker}>
      <span className={styles.srOnly}>보드 열 수</span>
      <button
        ref={triggerRef}
        type="button"
        className={styles.columnTrigger}
        aria-label={`보드 열 수, 현재 ${columns}열`}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="listbox"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") keyboardOpenRef.current = true;
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            keyboardOpenRef.current = true;
            openMenu(true);
          }
        }}
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }
          const byKeyboard = keyboardOpenRef.current;
          keyboardOpenRef.current = false;
          openMenu(byKeyboard);
        }}
      >
        {columns}
      </button>
      {open && (
        <div id={menuId} className={`${styles.columnMenu} ${keyboardOpened ? styles.columnMenuKeyboard : ""}`} role="listbox" aria-label="보드 열 수 선택">
          {GRID_COLUMN_OPTIONS.map((option, index) => (
            <button
              key={option}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={columns === option}
              onClick={() => select(option)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(option);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeMenu(true);
                  return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  const next = (index + direction + GRID_COLUMN_OPTIONS.length) % GRID_COLUMN_OPTIONS.length;
                  optionRefs.current[next]?.focus();
                }
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type BoardRailProps = {
  columns: GridColumns;
  onColumns: (columns: GridColumns) => void;
  stackSelection: string[];
  sheetSelection: string[];
  onCreateStack: () => void;
  onCreateSheet: (grid: "2x2" | "3x2") => void;
  onClearSelections: () => void;
};

const BoardRail = memo(function BoardRail({ columns, onColumns, stackSelection, sheetSelection, onCreateStack, onCreateSheet, onClearSelections }: BoardRailProps) {
  const selectedTotal = stackSelection.length + sheetSelection.length;
  return (
    <div className={styles.railContent}>
      <section className={styles.railSection} aria-label="보드 열 수">
        <ColumnPicker columns={columns} onColumns={onColumns} />
      </section>

      {selectedTotal > 0 && (
        <section className={styles.railSection} aria-label="선택한 타일">
          <div className={styles.railSelection}>
            <span>선택 {selectedTotal}개</span>
            <span className={styles.railSelectionDetail}>스택 {stackSelection.length} · 조판 {sheetSelection.length}</span>
          </div>
          <button type="button" className={styles.railClear} onClick={onClearSelections}>선택 해제</button>
        </section>
      )}

      {(stackSelection.length >= 2 || sheetSelection.length >= 2) && (
        <section className={styles.railSection} aria-label="선택한 타일로 만들기">
          {stackSelection.length >= 2 && (
            <button type="button" className={styles.railAction} onClick={onCreateStack}>
              스택 만들기 · {stackSelection.length}층
            </button>
          )}
          {sheetSelection.length >= 2 && (
            <>
              <button type="button" className={styles.railAction} disabled={sheetSelection.length > 4} onClick={() => onCreateSheet("2x2")}>
                조판 만들기(2×2)
              </button>
              <button type="button" className={styles.railAction} disabled={sheetSelection.length > 6} onClick={() => onCreateSheet("3x2")}>
                조판 만들기(3×2)
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
});

type AddTileItem = {
  id: string;
  title: string;
  color: string;
  category: string;
  boardCount: number;
  index: number;
};

const ADD_TILE_CATEGORIES = ["분석", "도판", "시뮬레이션"] as const;

function AddTileCell({ items, onAdd }: { items: readonly AddTileItem[]; onAdd: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pickerId = `v2-add-tile-${useId().replace(/:/g, "")}`;
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return normalized.length === 0 ? [...items] : items.filter((item) => item.title.toLocaleLowerCase("ko-KR").includes(normalized));
  }, [items, query]);
  const groups = useMemo(() => ADD_TILE_CATEGORIES.map((category) => ({
    category,
    items: filteredItems.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0), [filteredItems]);
  const flatItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  const closePicker = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const focusOption = useCallback((index: number) => {
    if (flatItems.length === 0) return;
    const next = (index + flatItems.length) % flatItems.length;
    setActiveIndex(next);
    window.requestAnimationFrame(() => optionRefs.current[next]?.focus());
  }, [flatItems.length]);
  const selectItem = useCallback((item: AddTileItem) => {
    closePicker();
    onAdd(item.id);
  }, [closePicker, onAdd]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    optionRefs.current = [];
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePicker();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [closePicker, open]);
  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, flatItems.length - 1)));
  }, [flatItems.length]);

  return (
    <div ref={rootRef} className={`${styles.addTileCell} ${open ? styles.addTileCellOpen : ""}`} data-v2-add-cell>
      {!open ? (
        <button ref={triggerRef} type="button" className={styles.addTileTrigger} aria-label="타일 추가" aria-expanded={false} aria-controls={pickerId} onClick={() => setOpen(true)}>
          <span className={styles.addTilePlus} aria-hidden>+</span>
          <span>타일 추가</span>
        </button>
      ) : (
        <section id={pickerId} className={styles.addTilePicker} aria-label="타일 추가" onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closePicker();
          }
        }}>
          <div className={styles.addTilePickerHead}>
            <label className={styles.addTileSearchLabel}>
              <span>타일 검색</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption(0);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption(flatItems.length - 1);
                  } else if (event.key === "Enter" && flatItems[activeIndex]) {
                    event.preventDefault();
                    selectItem(flatItems[activeIndex]!);
                  }
                }}
                placeholder="제목으로 찾기"
                autoComplete="off"
              />
            </label>
            <button type="button" className={styles.addTileClose} aria-label="타일 추가 닫기" onClick={closePicker}>×</button>
          </div>
          {flatItems.length === 0 ? (
            <p className={styles.addTileEmpty}>검색 결과가 없습니다.</p>
          ) : (
            <div className={styles.addTileList} role="listbox" aria-label="추가할 타일">
              {groups.map((group) => (
                <div key={group.category} className={styles.addTileGroup} role="group" aria-label={group.category}>
                  <h3>{group.category}</h3>
                  {group.items.map((item) => {
                    const index = flatItems.indexOf(item);
                    return (
                      <button
                        key={item.id}
                        ref={(element) => { optionRefs.current[index] = element; }}
                        type="button"
                        role="option"
                        aria-selected={activeIndex === index}
                        className={`${styles.addTileOption} ${activeIndex === index ? styles.addTileOptionActive : ""}`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => selectItem(item)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            event.preventDefault();
                            focusOption(index + (event.key === "ArrowDown" ? 1 : -1));
                          } else if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectItem(item);
                          }
                        }}
                      >
                        <span className={styles.dot} style={{ background: item.color }} aria-hidden />
                        <span className={styles.addTileOptionTitle}>{item.title}</span>
                        <span className={styles.addTileOptionCount}>보드에 {item.boardCount}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** 타일 보드. 결과가 바뀌면 부모가 key를 바꿔 새로 만든다. */
function Board({ baseResults, siteSummary, analysisId, scene, jobs, refreshSummary, refreshing = false, refreshError, onRefresh, demo, busy, controls, onRerun, onCancel, canceling = false, currentProject, initialProjectBoard, onProjectSaved, onProjectDeleted, onOpenProject, onAuthExpired, onWindUploaded, requestedPreset, initialPreset, onPresetChange, topoState, topoUsed = false, onTopoPick, onTopoNudge, onTopoRemove }: BoardProps) {
  const { user } = useAuth();
  const [overrides, setOverrides] = useState<Record<string, TileResult>>({});
  const [board, dispatch] = useReducer(boardReducer, baseResults, (results) => initBoard(results, initialPreset));
  const requestedPresetRef = useRef(requestedPreset);
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
  const [persistedStorageJson, setPersistedStorageJson] = useState<string | null>(null);
  const [storageWriteFailed, setStorageWriteFailed] = useState(false);
  const [serverSnapshotJson, setServerSnapshotJson] = useState<string | null>(initialSnapshotJson);
  const pendingStorageRef = useRef<{ key: string; json: string } | null>(null);
  const scheduledStorageRef = useRef<{ kind: "idle" | "timeout"; handle: number } | null>(null);
  const flushStorage = useCallback(() => {
    const pending = pendingStorageRef.current;
    if (!pending) return;
    pendingStorageRef.current = null;
    try {
      window.localStorage.setItem(pending.key, pending.json);
      setPersistedStorageJson(pending.json);
      setStorageWriteFailed(false);
    } catch {
      // 저장소가 막힌 브라우저에서는 현재 세션의 보드 상태만 유지한다.
      setStorageWriteFailed(true);
    }
  }, []);
  useEffect(() => {
    dispatch({ type: "replaceResults", results: baseResults });
  }, [baseResults]);
  useEffect(() => {
    setStorageReady(false);
    let localSnapshot: string | null = null;
    try {
      localSnapshot = window.localStorage.getItem(storageKey);
    } catch {
      localSnapshot = null;
    }
    setPersistedStorageJson(localSnapshot);
    setStorageWriteFailed(false);
    dispatch({ type: "restore", snapshot: selectBoardSnapshotForLoad(initialSnapshotJson, localSnapshot), fallbackPreset: initialPreset });
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [topoDialogOpen, setTopoDialogOpen] = useState(false);
  const topoDialogRef = useRef<HTMLDivElement>(null);
  const topoTriggerRef = useRef<HTMLButtonElement>(null);
  const [dialogTab, setDialogTab] = useState<"overview" | "sources">("overview");
  const [stackSelection, setStackSelection] = useState<string[]>([]);
  const [sheetSelection, setSheetSelection] = useState<string[]>([]);
  const [boardMode, setBoardMode] = useState<"tile" | "report">(() => {
    if (typeof window === "undefined") return "tile";
    return new URLSearchParams(window.location.search).get("mode") === "report" ? "report" : "tile";
  });
  const [note, setNote] = useState(""); // 스크린리더 안내(aria-live)
  const [highlightedTileId, setHighlightedTileId] = useState<string | null>(null);
  const vectorAvailable = useMemo(() => (scene?.origin ? baseUsable(mapBaseFromScene(scene)) : false), [scene]);
  const [basemap, setBasemap] = useState<BasemapChoice>("vector");
  // 기본 지도 자료가 없으면 그려지는 것은 일반지도이므로 선택 표시도 그쪽에 둔다.
  const shownBasemap: BasemapChoice = basemap === "vector" && !vectorAvailable ? "white" : basemap; // 보드 상태(서버에 저장하지 않음). 화면과 PPT가 같이 따른다. 기본은 분석 장면으로 그린 기본 지도(자료가 없는 옛 분석은 일반지도로 돌아간다)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (boardMode === "report") params.set("mode", "report");
    else params.delete("mode");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [boardMode]);
  useEffect(() => {
    const syncModeFromLocation = () => setBoardMode(new URLSearchParams(window.location.search).get("mode") === "report" ? "report" : "tile");
    window.addEventListener("popstate", syncModeFromLocation);
    return () => window.removeEventListener("popstate", syncModeFromLocation);
  }, []);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridLayout, setGridLayout] = useState({ columns: 4, rowHeight: 377, cellWidth: 0 });
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => {
      const width = grid.clientWidth;
      if (width <= 0) return;
      const gap = 16;
      const capacity = Math.max(1, Math.floor((width + gap) / (200 + gap)));
      const columns = Math.max(1, Math.min(board.columns, capacity));
      const cellWidth = (width - (columns - 1) * gap) / columns;
      // 지도 영역(행 높이 − 카드 머리·지표줄·바닥 약 86px)만 1.5배: 1.5·row − 0.5·86
      const rowHeight = Math.round(Math.max(280, cellWidth * (5 / 6)) * 1.5 - 43);
      setGridLayout((current) => current.columns === columns && current.rowHeight === rowHeight && current.cellWidth === cellWidth ? current : { columns, rowHeight, cellWidth });
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
  const reportResults = useMemo(() => new Map(results.map((result) => [result.tileId, result] as const)), [results]);
  const reportResultFor = useCallback((tileId: string) => reportResults.get(tileId) ?? reportResults.get(sourceTileId(board, tileId)), [board, reportResults]);
  const sourceViews = useMemo(() => new Map(results.map((r) => {
    const view = toTileView(r, scene, analysisSiteParcel, board.a05Filter[r.tileId] ?? null);
    return [r.tileId, view] as const;
  })), [results, scene, analysisSiteParcel, board.a05Filter, board.layers]);
  const baseViews = useMemo(() => {
    const next = new Map([...sourceViews].map(([id, view]) => [id, viewWithLayer(view, board.layers[id] ?? view.defaultLayer)] as const));
    const resultById = new Map(results.map((result) => [result.tileId, result]));
    for (const [id] of Object.entries(board.instances)) {
      const sourceId = sourceTileId(board, id);
      const result = resultById.get(sourceId);
      if (!result) continue;
      const raw = toTileView(result, scene, analysisSiteParcel, board.a05Filter[id] ?? null);
      const copy = { ...raw, tileId: id };
      next.set(id, viewWithLayer(copy, board.layers[id] ?? copy.defaultLayer));
    }
    return next;
  }, [analysisSiteParcel, board.a05Filter, board.instances, board.layers, results, scene, sourceViews]);
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
  const addTileItems = useMemo<AddTileItem[]>(() => {
    const resultIds = new Set(results.map((result) => result.tileId));
    const boardCounts = new Map<string, number>();
    for (const id of board.order) {
      const sourceId = sourceTileId(board, id);
      if (resultIds.has(sourceId)) boardCounts.set(sourceId, (boardCounts.get(sourceId) ?? 0) + 1);
    }
    const categoryIndex = new Map(ADD_TILE_CATEGORIES.map((category, index) => [category, index]));
    return results.flatMap((result, index) => {
      const view = views.get(result.tileId);
      // 엔진 결과가 없는 타일과 스택·조판 구성물은 추가 목록의 원천 타일이 아니다.
      if (!view || view.status === "not_provided" || view.code === "STACK" || view.code === "SHEET" || view.stackLayers || view.sheetTiles) return [];
      return [{ id: result.tileId, title: view.title, color: view.color, category: view.kindLabel, boardCount: boardCounts.get(result.tileId) ?? 0, index }];
    }).sort((a, b) => (categoryIndex.get(a.category as typeof ADD_TILE_CATEGORIES[number]) ?? ADD_TILE_CATEGORIES.length) - (categoryIndex.get(b.category as typeof ADD_TILE_CATEGORIES[number]) ?? ADD_TILE_CATEGORIES.length) || a.index - b.index);
  }, [board, results, views]);
  const stackableIds = useMemo(
    () => board.order.filter((id) => {
      const view = baseViews.get(id);
      return !!view && (view.kindLabel === "분석" || view.kindLabel === "도판") && !Object.values(board.stacks).some((layers) => layers.includes(id));
    }),
    [baseViews, board.order, board.stacks],
  );
  const sheetableIds = useMemo(() => board.order.filter((id) => views.has(id) && views.get(id)!.code !== "SHEET"), [board.order, views]);
  const summary = useMemo(() => toSummaryView(siteSummary, results, scene), [siteSummary, results, scene]);
  const analysisDate = results[0]?.conditions.analysisDate ?? "기준일 미확인";
  const reportPlanContext = useMemo(() => ({ summary, analysisDate, views, results: reportResults, scene, analysisSiteParcel, resultFor: reportResultFor }), [analysisDate, analysisSiteParcel, reportResultFor, reportResults, scene, summary, views]);
  const reportDocPageCount = useMemo(() => printedPageCount(board.reportDoc, views, reportPlanContext), [board.reportDoc, reportPlanContext, views]);
  const total = board.order.length;
  const notProvidedIds = shown.filter((id) => views.get(id)?.status === "not_provided");
  const visibleShown = shown.filter((id) => views.get(id)?.status !== "not_provided");
  const rovingItems = useMemo<RovingGridItem[]>(() => [{ id: SUMMARY_ID }, ...visibleShown.map((id) => ({ id }))], [visibleShown]);
  const [rovingId, setRovingId] = useState<string>(SUMMARY_ID);
  const activeRovingId = rovingItems.some((item) => item.id === rovingId) ? rovingId : (rovingItems[0]?.id ?? SUMMARY_ID);
  useEffect(() => {
    if (rovingId !== activeRovingId) setRovingId(activeRovingId);
  }, [activeRovingId, rovingId]);
  useEffect(() => {
    if (!highlightedTileId) return;
    const timer = window.setTimeout(() => setHighlightedTileId(null), 1200);
    return () => window.clearTimeout(timer);
  }, [highlightedTileId]);
  const focusRovingCard = useCallback((id: string) => {
    setRovingId(id);
    window.requestAnimationFrame(() => {
      const card = Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-v2-roving-card]") ?? []).find((element) => (element.dataset.v2RovingId ?? element.dataset.tileId) === id);
      card?.focus();
    });
  }, []);
  const onRovingFocus = useCallback((id: string) => setRovingId(id), []);
  const onRovingMove = useCallback((currentId: string, key: string, event: ReactKeyboardEvent<HTMLElement>) => {
    event.preventDefault();
    const index = getRovingTargetIndex(rovingItems, currentId, key, gridLayout.columns);
    const target = index < 0 ? undefined : rovingItems.filter((item) => item.navigable !== false)[index];
    if (!target || target.id === currentId) return;
    focusRovingCard(target.id);
  }, [focusRovingCard, gridLayout.columns, rovingItems]);
  const activeJobs = jobs.some((job) => job.status === "queued" || job.status === "running");
  const actionBusy = busy || activeJobs;
  const hasTopo = topoUsed || results.some((result) => result.presentation.polygons?.some((polygon) => polygon.layer === "topo_coverage") ?? false);
  const d17 = results.find((result) => result.tileCode === "D17");
  const d17ReliefMin = d17?.metrics.find((metric) => metric.id === "relief_min_m")?.value;
  const d17ReliefMax = d17?.metrics.find((metric) => metric.id === "relief_max_m")?.value;
  const showTopoNudge = topoState.s !== "ready" && !hasTopo && topoState.s !== "preparing" && topoState.s !== "uploading" && d17ReliefMin !== null && d17ReliefMin !== undefined && d17ReliefMax !== null && d17ReliefMax !== undefined && d17ReliefMax - d17ReliefMin >= TOPO_NUDGE_RELIEF_M;
  const closeTopoDialog = useCallback(() => setTopoDialogOpen(false), []);
  useFocusTrap({ ref: topoDialogRef, active: topoDialogOpen, onClose: closeTopoDialog, restoreFocusRef: topoTriggerRef });
  const jobState = useMemo(() => jobProgress(jobs), [jobs]);
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
  const storageDirty = storageReady && (storageWriteFailed || persistedStorageJson !== boardSnapshotJson);
  const projectDirty = !!currentProject?.projectId && serverSnapshotJson !== null && boardSnapshotJson !== serverSnapshotJson;
  const boardDirty = projectDirty || storageDirty;
  const changePreset = useCallback((preset: PresetId) => {
    if (preset === board.preset) return;
    dispatch({ type: "preset", preset });
    onPresetChange(preset);
    setNote(`과제 프리셋을 ${TILE_PRESETS[preset].label}(으)로 바꿨습니다. 수동 포함·순서를 덮어썼습니다. 되돌리기로 복원할 수 있습니다.`);
  }, [board.preset, onPresetChange]);
  useEffect(() => {
    if (requestedPresetRef.current === requestedPreset) return;
    requestedPresetRef.current = requestedPreset;
    // 저장 프로젝트를 여는 동안에는 부모의 초기값(전체)이 snapshot 복원을 덮어쓰지 않는다.
    // 저장본이 없는 새 분석·데모에서만 주소 입력부의 선택을 보드에 적용한다.
    if (initialProjectBoard !== null) return;
    if (requestedPreset !== board.preset) changePreset(requestedPreset);
  }, [board.preset, changePreset, initialProjectBoard, requestedPreset]);
  useEffect(() => {
    onPresetChange(board.preset);
  }, [board.preset, onPresetChange]);
  const [making, setMaking] = useState(false);
  const [makingKind, setMakingKind] = useState<string | null>(null);
  const [exportProblem, setExportProblem] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportState = exportAvailability({ making, requesting: busy, sceneReady: !!scene });
  const [presentationPlan, setPresentationPlan] = useState<PlannedSlide[] | null>(null);

  const openReportPresentation = () => {
    if (demo || actionBusy || board.reportDoc.pages.length === 0) return;
    setPresentationPlan(planReportDoc(board.reportDoc, views, reportPlanContext));
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

  const retry = useCallback((id: string, code: string) => {
    if (!demo) return onRerun();
    const fixed = RECOVERED[code];
    if (!fixed) return;
    setOverrides((o) => ({ ...o, [id]: { ...fixed, tileId: id } }));
  }, [demo, onRerun]);

  const onTileAction = useCallback((id: string, action: TileCardAction) => {
    const title = views.get(id)?.title ?? "타일";
    switch (action.type) {
      case "duplicate":
        dispatch({ type: "duplicate", id });
        setNote(`${title} 타일을 원본 바로 뒤에 복제`);
        break;
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
      case "cut":
        dispatch({ type: "cut", id, cut: action.cut });
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
      case "mapLabels":
        dispatch({ type: "mapLabels", id, show: action.show });
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
  const createStack = useCallback(() => {
    if (stackSelection.length < 2) return;
    const count = stackSelection.length;
    dispatch({ type: "stack", layers: stackSelection });
    setStackSelection([]);
    setNote(`${count}개 층으로 스택을 만듦`);
  }, [stackSelection]);
  const createSheet = useCallback((grid: "2x2" | "3x2") => {
    if (sheetSelection.length < 2) return;
    const count = sheetSelection.length;
    dispatch({ type: "sheet", tiles: sheetSelection, grid });
    setSheetSelection([]);
    setNote(`${count}개 타일로 ${grid === "2x2" ? "2×2" : "3×2"} 조판을 만듦`);
  }, [sheetSelection]);
  const clearSelections = useCallback(() => {
    setStackSelection([]);
    setSheetSelection([]);
    setNote("선택을 해제함");
  }, []);
  const addTile = useCallback((sourceId: string) => {
    const view = views.get(sourceId);
    const title = view?.title ?? "타일";
    const alreadyOnBoard = board.order.some((id) => sourceTileId(board, id) === sourceId);
    if (alreadyOnBoard) {
      const copyId = nextCopyId(board);
      dispatch({ type: "addCopy", sourceId });
      setHighlightedTileId(copyId);
    } else if (board.removed.some((item) => item.id === sourceId)) {
      dispatch({ type: "add", id: sourceId });
      setHighlightedTileId(sourceId);
    } else {
      return;
    }
    setNote(`${title} 타일이 보드 끝에 추가됨`);
  }, [board, views]);

  const undoDepth = board.undoStack.length;
  const lastUndo = board.undoStack[undoDepth - 1];
  // 토스트는 새 편집이 쌓인 순간에만 잠깐 띄운다. 되돌리면 바로 닫는다.
  const [toastUndo, setToastUndo] = useState<typeof lastUndo>();
  const undoDepthRef = useRef(undoDepth);
  useEffect(() => {
    const pushed = undoDepth > undoDepthRef.current;
    undoDepthRef.current = undoDepth;
    setToastUndo(pushed ? lastUndo : undefined);
    if (!pushed) return;
    const timer = window.setTimeout(() => setToastUndo(undefined), UNDO_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [lastUndo, undoDepth]);
  const openView = openId ? views.get(openId) : undefined;

  return (
    <BasemapContext.Provider value={basemap}>
    <SetBasemapContext.Provider value={setBasemap}>
    <BaseThemeContext.Provider value={board.baseTheme}>
    <main className={styles.root}>
      <div
        className={`${styles.page} ${boardMode === "report" ? styles.reportPage : ""}`}
        data-v2-page
        inert={openView || presentationPlan || topoDialogOpen ? true : undefined}
        onClickCapture={(event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const card = target.closest<HTMLElement>("[data-v2-roving-id], [data-tile-id]");
          const id = card?.dataset.v2RovingId ?? card?.dataset.tileId;
          if (id) setRovingId(id);
        }}
      >
        <a className={styles.skipLink} href="#v2-board-grid">
          보드로 건너뛰기
        </a>
        {boardMode === "tile" && <aside className={styles.boardRail} aria-label="보드 설정">
          <BoardRail
            columns={board.columns}
            onColumns={(columns) => dispatch({ type: "columns", columns })}
            stackSelection={stackSelection}
            sheetSelection={sheetSelection}
            onCreateStack={createStack}
            onCreateSheet={createSheet}
            onClearSelections={clearSelections}
          />
        </aside>}
        <header className={styles.topbar}>
          <span className={`${styles.display} ${styles.brand}`}>사이트 분석</span>
          <a className={styles.pill} href="/site/v2/guide">가이드</a>
          {user?.role === "admin" && <a className={styles.pill} href="/site/v2/admin">관리</a>}
          <ProjectMenu
            analysisId={analysisId}
            currentProjectId={currentProject?.projectId ?? null}
            currentProjectName={currentProject?.name ?? null}
            defaultName={`${siteSummary.address} · ${summary.radius}`}
            board={demo ? null : boardSnapshot}
            canSave={!demo && !!analysisId && !actionBusy}
            dirty={boardDirty}
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
          <span className={styles.topTitle} title={`${siteSummary.address} · ${summary.radius}`}>
            {siteSummary.address} · {summary.radius}
          </span>
          <div className={styles.modeTabs} role="tablist" aria-label="작업 모드">
            <button type="button" className={styles.modeTab} role="tab" aria-selected={boardMode === "tile"} onClick={() => setBoardMode("tile")}>타일</button>
            <button type="button" className={styles.modeTab} role="tab" aria-selected={boardMode === "report"} aria-label={`보고서, ${reportDocPageCount}쪽`} onClick={() => setBoardMode("report")}>보고서<span className={styles.modeCount}>{reportDocPageCount}</span></button>
          </div>
          <span className={styles.spacer} />
          {boardMode === "report" && <div id="v2-report-actions" className={styles.reportActionsSlot} />}
          {demo && <span className={styles.demoTag}>데모 데이터</span>}
          <button
            ref={topoTriggerRef}
            type="button"
            className={`${styles.pill} ${styles.topoHeaderButton}`}
            onClick={() => {
              if (hasTopo) setTopoDialogOpen(true);
              else onTopoPick();
            }}
            disabled={actionBusy}
            aria-label={hasTopo ? "추가 자료 · 수치지형도" : "수치지형도 추가"}
            aria-haspopup={hasTopo ? "dialog" : undefined}
          >
            {hasTopo ? "추가 자료 · 수치지형도" : "수치지형도 추가"}
          </button>
          {boardMode === "tile" && <>
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
                      <button key={b.id} type="button" aria-pressed={shownBasemap === b.id} disabled={b.id === "vector" && !vectorAvailable} title={b.id === "vector" && !vectorAvailable ? "이 분석에는 기본 지도 자료가 없습니다" : undefined} onClick={() => setBasemap(b.id)}>
                        {b.label}
                      </button>
                    ))}
                  </span>
                </span>
                {demo ? (
                  <button type="button" className={`${styles.pill} ${styles.pillDark}`} disabled title="실제 분석 후 사용">
                    파일 ▾
                  </button>
                ) : (
                  <details className={styles.exportDetails} open={exportOpen} onToggle={(event) => setExportOpen(event.currentTarget.open)}>
                    <summary
                      className={`${styles.pill} ${styles.pillDark}`}
                      aria-label="파일 형식"
                      aria-expanded={exportOpen}
                      aria-disabled={busy || making}
                      onClick={(e) => {
                        if (busy || making) e.preventDefault();
                      }}
                    >
                      {making ? `${makingKind ?? "파일"} 만드는 중…` : "파일 ▾"}
                    </summary>
                    <div className={styles.exportMenu} aria-label="파일 형식">
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
                <summary className={`${styles.pill} ${styles.pillDark}`} aria-label="보기·내보내기 메뉴">
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
                        <button key={b.id} type="button" aria-pressed={shownBasemap === b.id} disabled={b.id === "vector" && !vectorAvailable} title={b.id === "vector" && !vectorAvailable ? "이 분석에는 기본 지도 자료가 없습니다" : undefined} onClick={() => setBasemap(b.id)}>
                          {b.label}
                        </button>
                      ))}
                    </span>
                  </span>
                  <div className={styles.mobileRail}>
                    <BoardRail
                      columns={board.columns}
                      onColumns={(columns) => dispatch({ type: "columns", columns })}
                      stackSelection={stackSelection}
                      sheetSelection={sheetSelection}
                      onCreateStack={createStack}
                      onCreateSheet={createSheet}
                      onClearSelections={clearSelections}
                    />
                  </div>
                  {demo ? (
                    <button type="button" className={`${styles.pill} ${styles.pillDark}`} disabled title="실제 분석 후 사용">
                      파일 ▾
                    </button>
                  ) : (
                    <div className={styles.mobileExportActions}>
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
                    </div>
                  )}
                </div>
              </details>
          </>}
        </header>

        {boardMode === "report" && <ReportMode board={board} dispatch={dispatch} views={views} summary={summary} analysisDate={analysisDate} basemap={basemap} dirty={boardDirty} demo={demo} busy={actionBusy} onPresentation={openReportPresentation} results={reportResults} scene={scene} analysisSiteParcel={analysisSiteParcel} resultFor={reportResultFor} />}

        {boardMode === "tile" && <>
        {!demo && <AnalysisProgress jobs={jobs} onCancel={onCancel} canceling={canceling} />}
        {!demo && <AnalysisRefreshBanner summary={refreshSummary} activeJobs={activeJobs} busy={busy} refreshing={refreshing} error={refreshError} onRefresh={onRefresh} />}

        {controls}

        <div className={styles.grid} id="v2-board-grid" ref={gridRef} tabIndex={-1} data-grid-cols={gridLayout.columns} style={{ "--grid-cols": gridLayout.columns, "--grid-row-height": `${gridLayout.rowHeight}px` } as CSSProperties}>
          <SummaryCard
            view={summary}
            face={viewOf(board, SUMMARY_ID)}
            onFace={onSummaryFace}
            rovingTabIndex={activeRovingId === SUMMARY_ID ? 0 : -1}
            onRovingFocus={onRovingFocus}
            onRovingMove={onRovingMove}
          />
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
                  analysisId={analysisId}
                  layer={view.defaultLayer}
                  onLayer={(layer) => dispatch({ type: "layer", id, layer })}
                  phase={jobState.byCode.get(view.code)?.phase ?? null}
                  waitingNote={jobState.byCode.get(view.code)?.note ?? null}
                  topoNudge={view.code === "D17" && showTopoNudge ? { onClick: onTopoNudge, disabled: actionBusy } : undefined}
                  canUp={oi > 0}
                  canDown={oi < total - 1}
                  size={size}
                  cellW={gridLayout.cellWidth}
                  rowH={gridLayout.rowHeight}
                  dragging={dragged}
                  floatStyle={floatStyle(id)}
                  onHandleDown={start(id)}
                  onAction={onTileAction}
                  cut={board.cuts[id] ?? null}
                  pinnedLabels={board.labels[id] ?? EMPTY_PINNED_LABELS}
                  showMapLabels={!!board.mapLabels[id]}
                  terrainSection={board.terrainSection[id] ?? "A"}
                  onTerrainSection={(section) => dispatch({ type: "terrainSection", id, section })}
                  cardFace={viewOf(board, id)}
                  highlighted={highlightedTileId === id}
                  onWindUploaded={onWindUploaded}
                  stackable={stackableIds.includes(id)}
                  stackSelected={stackSelection.includes(id)}
                  sheetable={sheetableIds.includes(id)}
                  sheetSelected={sheetSelection.includes(id)}
                  rovingTabIndex={activeRovingId === id ? 0 : -1}
                  onRovingFocus={onRovingFocus}
                  onRovingMove={onRovingMove}
                />
              </Fragment>
            );
          })}
          <AddTileCell items={addTileItems} onAdd={addTile} />
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
        </>}
      </div>

      <div className={styles.srOnly} aria-live="polite">
        {note}
      </div>

      {toastUndo && boardMode === "tile" && (
        <div className={styles.toast} role="status" style={{ bottom: 76 }}>
          <span className={styles.toastText}>
            {toastUndo.kind === "columns"
              ? `${UNDO_LABEL.columns} · ${toastUndo.columns}열`
              : toastUndo.kind === "preset"
                ? `${UNDO_LABEL.preset} · ${TILE_PRESETS[board.preset].label}`
                : toastUndo.kind === "duplicate" && toastUndo.origin === "addCopy"
                  ? `${views.get(toastUndo.id)?.title ?? "타일"} 추가됨`
                : `${UNDO_LABEL[toastUndo.kind]} · ${views.get(toastUndo.id)?.title}`}
          </span>
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
          onRetry={() => retry(openView.tileId, openView.code)}
          cut={board.cuts[openView.tileId] ?? null}
          onCut={(cut) => dispatch({ type: "cut", id: openView.tileId, cut })}
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
          onWindUploaded={onWindUploaded}
          address={siteSummary.address}
          analysisDate={analysisDate}
          terrainSection={board.terrainSection[openView.tileId] ?? "A"}
          onTerrainSection={(section) => dispatch({ type: "terrainSection", id: openView.tileId, section })}
          onClose={() => {
            setOpenId(null);
            setDialogTab("overview");
          }}
        />
      )}
      {topoDialogOpen && hasTopo && (
        <div className={styles.overlay}>
          <div
            ref={topoDialogRef}
            className={`${styles.dialog} ${styles.topoDialog}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="v2-topo-dialog-title"
            tabIndex={-1}
          >
            <div className={styles.topoDialogHead}>
              <h2 id="v2-topo-dialog-title">추가 자료 · 수치지형도</h2>
              <button type="button" className={styles.closeBtn} onClick={closeTopoDialog}>닫기</button>
            </div>
            <p className={styles.topoDialogFile}>{topoState.s === "ready" ? topoState.fileName : "수치지형도 추가 자료"}</p>
            <p className={styles.topoDialogSummary}>
              {topoState.s === "ready" ? topoState.coveragePct === null ? "대지를 정하면 분석 반경을 얼마나 덮는지 알려 드립니다." : `분석 반경의 ${topoState.coveragePct}%를 덮습니다.${topoState.coveragePct === 100 ? "" : " 나머지는 기존 자료로 채웁니다."}` : "이 분석에 수치지형도 추가 자료가 사용되었습니다."}<br />
              원본 등고선·표고점과 필요한 도로·건물 자료를 우선 사용합니다.<br />
              {(topoState.s !== "ready" || topoState.coveragePct !== 100) && "범위 밖은 기존 자료로 채웁니다."}
            </p>
            <div className={styles.topoDialogActions}>
              <button type="button" className={styles.pill} onClick={() => { closeTopoDialog(); onTopoRemove(); }}>빼고 다시 분석</button>
              <button type="button" className={`${styles.pill} ${styles.pillDark}`} onClick={() => { closeTopoDialog(); window.setTimeout(onTopoPick, 0); }}>다른 파일로</button>
            </div>
          </div>
        </div>
      )}
      {presentationPlan && <Presentation plan={presentationPlan} onClose={() => setPresentationPlan(null)} />}
    </main>
    </BaseThemeContext.Provider>
    </SetBasemapContext.Provider>
    </BasemapContext.Provider>
  );
}

const API = "/site/api/v2/analyses";
const PROJECTS_API = "/site/api/v2/projects";

function boardLocation(kind: "project" | "analysis", id: string): string {
  const params = new URLSearchParams(window.location.search);
  params.delete(kind === "project" ? "analysis" : "project");
  params.set(kind, id);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

/** 401이면 refresh 쿠키로 한 번 갱신하고 같은 요청을 다시 보낸다. */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, credentials: "include" });
  if (res.status !== 401) return res;
  const refreshed = await fetch("/site/api/auth/refresh", { method: "POST", credentials: "include" }).then((r) => r.ok, () => false);
  return refreshed ? fetch(url, { ...init, credentials: "include" }) : res;
}

type TileState = { code: string; status: TileResult["status"]; revision: string; elapsedMs?: number | null };
type Live = { analysisId: string; summary: SiteSummary; results: TileResult[]; jobs: JobState[]; tiles: TileState[]; revision: string; scene: Scene | null; refreshSummary: RefreshSummary | null };
type Problem = { text: string; login: boolean };
const POLL_DELAYS_MS = [1000, 2000, 5000] as const;

function refreshErrorForStatus(status: number): RefreshError {
  switch (status) {
    case 401:
      return { text: "로그인이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요.", retryable: true };
    case 403:
      return { text: "이 저장 분석을 갱신할 권한이 없습니다.", retryable: false };
    case 404:
      return { text: "저장된 분석을 찾지 못했습니다. 프로젝트 목록에서 다시 열어 주세요.", retryable: false };
    case 409:
      return { text: "이 분석은 이미 갱신 중이거나 현재 상태에서 갱신할 수 없습니다. 잠시 뒤 다시 시도해 주세요.", retryable: true };
    case 429:
      return { text: "갱신 요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.", retryable: true };
    case 500:
      return { text: "최신 엔진으로 갱신하는 중 서버 오류가 발생했습니다. 잠시 뒤 다시 시도해 주세요.", retryable: true };
    case 503:
      return { text: "최신 운영 데이터가 아직 준비되지 않았습니다. 잠시 뒤 다시 시도해 주세요.", retryable: true };
    default:
      return { text: "최신 엔진으로 갱신하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", retryable: true };
  }
}

function refreshErrorForNetwork(): RefreshError {
  return { text: "서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.", retryable: true };
}

function refreshErrorForJob(job: JobState): RefreshError {
  const reason = typeof job.error === "string" && job.error.trim().length > 0 ? ` (${job.error.trim()})` : "";
  return { text: `타일 ${job.code} 갱신에 실패했습니다${reason}. 다시 시도해 주세요.`, retryable: job.retryable !== false };
}

const ADDRESS_INPUT_ID = "v2-address-input";
const TOPO_STORAGE_PREFIX = "v2-topo:";

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

function isTopoErrorCode(value: string): value is TopoErrorCopyCode {
  return Object.prototype.hasOwnProperty.call(TOPO_ERROR_COPY, value);
}

function topoStorageKey(analysisId: string): string {
  return `${TOPO_STORAGE_PREFIX}${analysisId}`;
}

function storedTopoState(raw: string | null): TopoState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Extract<TopoState, { s: "ready" }>>;
    if (value.s !== "ready" || typeof value.topoId !== "string" || typeof value.fileName !== "string" || (typeof value.coveragePct !== "number" && value.coveragePct !== null) || !value.summary || typeof value.summary !== "object") return null;
    return value as Extract<TopoState, { s: "ready" }>;
  } catch {
    return null;
  }
}

/** 주소 입력 → 분석 → 실제 결과 보드. 분석 전에는 예시 보드를 그대로 보여 준다. */
export default function V2BoardPage() {
  // React hydration can start after a user has typed into the server-rendered input.
  // Seed the controlled value from that DOM value so hydration does not erase it.
  const hydratedAddress = readHydratedAddress();
  const [address, setAddress] = useState(() => hydratedAddress);
  const addressDirtyRef = useRef(hydratedAddress.length > 0);
  const [radiusM, setRadiusM] = useState(1000);
  const [preset, setPreset] = useState<PresetId>(DEFAULT_PRESET_ID);
  const [siteInput, setSiteInput] = useState<SiteInput | null>(null);
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [sitePickerValid, setSitePickerValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [topoState, setTopoState] = useState<TopoState>({ s: "idle" });
  const topoStateRef = useRef<TopoState>({ s: "idle" });
  const topoInputRef = useRef<HTMLInputElement>(null);
  const topoAbortRef = useRef<AbortController | null>(null);
  const topoRecheckAbortRef = useRef<AbortController | null>(null);
  const topoAfterUploadAnalyzeRef = useRef(false);
  const topoAddressDirtyRef = useRef(false);
  const topoCenterRef = useRef<readonly [number, number] | null>(null);
  const activeJobs = live?.jobs.some((job) => job.status === "queued" || job.status === "running") ?? false;
  const [windRefresh, setWindRefresh] = useState(0);
  const [wantedId, setWantedId] = useState<string | null>(null);
  const [wantedProjectId, setWantedProjectId] = useState<string | null>(null);
  const [currentProject, setCurrentProject] = useState<V2Project | null>(null);
  const [projectBoard, setProjectBoard] = useState<unknown | null>(null);
  const [staleProject, setStaleProject] = useState<V2Project | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<RefreshError | null>(null);

  useEffect(() => {
    topoStateRef.current = topoState;
  }, [topoState]);

  async function load(res: Response, refreshScene = true, update = true, base: Live | null = live, preserveProjectId: string | null = null): Promise<Live | undefined> {
    const body = (await res.json().catch(() => ({}))) as Partial<Live> & RefreshApiPayload & { error?: string };
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
      refreshSummary: refreshSummaryFromPayload(body, prior),
    };
    const center = next.results.find((result) => Array.isArray(result.conditions.center))?.conditions.center;
    if (center) topoCenterRef.current = center;
    if (update) {
      setLive(next);
      history.replaceState(null, "", preserveProjectId ? boardLocation("project", preserveProjectId) : boardLocation("analysis", body.analysisId));
    }
    return next;
  }

  async function resolveAddressCenter(value: string): Promise<readonly [number, number] | null> {
    if (!value.trim()) return null;
    try {
      const response = await apiFetch(`/site/api/v2/site/resolve?address=${encodeURIComponent(value.trim())}`);
      const body = await response.json().catch(() => ({})) as { lng?: unknown; lat?: unknown };
      if (!response.ok || typeof body.lng !== "number" || typeof body.lat !== "number") return null;
      return [body.lng, body.lat];
    } catch {
      return null;
    }
  }

  async function handleTopoFile(file: File | null, autoAnalyze = false) {
    if (!file || busy || activeJobs) return;
    const addressAtStart = address.trim();
    topoAfterUploadAnalyzeRef.current = autoAnalyze;
    topoAbortRef.current?.abort();
    const controller = new AbortController();
    topoAbortRef.current = controller;
    setProblem(null);
    let current: TopoState = topoReducer(topoStateRef.current, { type: "pick", fileName: file.name });
    setTopoState(current);
    try {
      let center = topoCenterRef.current;
      if (!center) {
        center = await resolveAddressCenter(addressAtStart);
        if (center) topoCenterRef.current = center;
      }
      const prepared = await prepareTopoZip(file);
      if (controller.signal.aborted) return;
      current = topoReducer(current, { type: "progress", loaded: 0, total: prepared.blob.size });
      setTopoState(current);
      const uploaded = await uploadTopo(prepared.blob, (loaded, total) => {
        setTopoState((state) => topoReducer(state, { type: "progress", loaded, total }));
      }, controller.signal);
      if (controller.signal.aborted) return;
      current = topoReducer(current, {
        type: "done",
        topoId: uploaded.topoId,
        fileName: file.name,
        summary: uploaded.summary,
        center: center ?? null,
        radiusM,
      });
      const currentCenter = topoCenterRef.current;
      if (current.s === "ready" && currentCenter && (current.coveragePct === null || topoAddressDirtyRef.current)) {
        current = topoReducer(current, { type: "recheck", center: currentCenter, radiusM });
        topoAddressDirtyRef.current = false;
      }
      setTopoState(current);
      if (current.s === "error") {
        const copy = TOPO_ERROR_COPY[current.code];
        setProblem({ text: `${copy.title}. ${copy.body}`, login: false });
        return;
      }
      if (autoAnalyze && current.s === "ready" && !topoAddressDirtyRef.current) await analyze(undefined, null, current.topoId);
    } catch (error: unknown) {
      if (controller.signal.aborted || error instanceof DOMException && error.name === "AbortError") {
        setTopoState({ s: "idle" });
        return;
      }
      const rawCode = error instanceof TopoClientError ? error.code : "topo_bad_zip";
      const code: TopoErrorCopyCode = isTopoErrorCode(rawCode) ? rawCode : "topo_bad_zip";
      setTopoState({ s: "error", code });
      const copy = TOPO_ERROR_COPY[code];
      setProblem({ text: `${copy.title}. ${copy.body}`, login: false });
    } finally {
      if (topoAbortRef.current === controller) topoAbortRef.current = null;
      topoAfterUploadAnalyzeRef.current = false;
    }
  }

  async function analyze(e?: { preventDefault(): void }, restoreProject: V2Project | null = null, topoIdOverride?: string | null) {
    e?.preventDefault();
    if (busy || activeJobs) return;
    if (!address.trim()) return setProblem({ text: "지번 주소로 입력해 주세요. 예: 서울 강동구 고덕동 123", login: false });
    if (isRoadAddress(address)) return setProblem({ text: ROAD_ADDRESS_UNSUPPORTED_MESSAGE, login: false });
    const stateAtAnalyze = topoStateRef.current;
    const requestedTopoId = topoIdOverride !== undefined
      ? topoIdOverride ?? undefined
      : stateAtAnalyze.s === "ready" && !topoAddressDirtyRef.current
        ? stateAtAnalyze.topoId
        : undefined;
    setBusy(true);
    setProblem(null);
    setRefreshing(false);
    setRefreshError(null);
    if (!restoreProject) {
      setCurrentProject(null);
      setProjectBoard(null);
      setWantedProjectId(null);
      setStaleProject(null);
    }
    try {
      const requestedSite = restoreProject?.site ?? siteInput;
      const response = await apiFetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: address.trim(), radiusM, ...(requestedSite ? { site: requestedSite } : {}), ...(requestedTopoId ? { topoId: requestedTopoId } : {}) }) });
      if (requestedTopoId && (response.status === 404 || response.status === 422)) {
        const code: TopoErrorCopyCode = response.status === 422 ? "topo_outside" : "topo_not_topo";
        setTopoState({ s: "error", code });
        const copy = TOPO_ERROR_COPY[code];
        setProblem({ text: `${copy.title}. ${copy.body}`, login: false });
        return;
      }
      const loaded = await load(response, true, true, null, restoreProject?.projectId ?? null);
      if (requestedTopoId === undefined && stateAtAnalyze.s === "ready") {
        topoAddressDirtyRef.current = false;
        setTopoState({ s: "idle" });
      }
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
        history.replaceState(null, "", boardLocation("project", saveBody.project.projectId));
      }
    } catch {
      setProblem({ text: "서버에 연결하지 못했습니다.", login: false });
    } finally {
      setBusy(false);
    }
  }

  async function refreshCurrentAnalysis() {
    const current = live;
    if (!current || busy || activeJobs || refreshing || current.refreshSummary?.canRefresh !== true) return;
    const id = current.analysisId;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await apiFetch(`${API}/${encodeURIComponent(id)}/refresh`, { method: "POST" });
      if (response.status !== 200 && response.status !== 202) {
        setRefreshError(refreshErrorForStatus(response.status));
        setRefreshing(false);
        return;
      }
      const accepted = await response.json().catch(() => ({})) as { analysisId?: unknown };
      if (typeof accepted.analysisId === "string" && accepted.analysisId !== id) {
        setRefreshError({ text: "갱신 결과가 현재 분석과 달라 반영하지 않았습니다. 다시 시도해 주세요.", retryable: true });
        setRefreshing(false);
        return;
      }
      // POST가 202를 반환해도 같은 분석 ID의 최신 작업·타일 상태를 즉시 읽는다.
      const latestResponse = await apiFetch(`${API}/${encodeURIComponent(id)}`);
      if (!latestResponse.ok) {
        setRefreshError(refreshErrorForStatus(latestResponse.status));
        setRefreshing(false);
        return;
      }
      const next = await load(latestResponse, false, true, current, currentProject?.projectId ?? null);
      if (!next) {
        setRefreshError({ text: "갱신 상태를 불러오지 못했습니다. 다시 시도해 주세요.", retryable: true });
        setRefreshing(false);
        return;
      }
      const nextActiveJobs = next.jobs.some((job) => job.status === "queued" || job.status === "running");
      if (nextActiveJobs) return;
      const failedJob = next.jobs.find((job) => job.status === "failed");
      if (failedJob) {
        setRefreshError(refreshErrorForJob(failedJob));
      } else if (next.refreshSummary?.staleTiles === 0) {
        setRefreshError(null);
      } else {
        setRefreshError({ text: "갱신 결과가 최신 상태로 반영되지 않았습니다. 다시 시도해 주세요.", retryable: true });
      }
      setRefreshing(false);
    } catch {
      setRefreshError(refreshErrorForNetwork());
      setRefreshing(false);
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
    topoAbortRef.current?.abort();
    topoRecheckAbortRef.current?.abort();
    topoAfterUploadAnalyzeRef.current = false;
    topoAddressDirtyRef.current = false;
    topoCenterRef.current = null;
    setTopoState({ s: "idle" });
    setWantedProjectId(projectId);
    setWantedId(null);
    setLive(null);
    setCurrentProject(null);
    setProjectBoard(null);
    setStaleProject(null);
    setProblem(null);
    setRefreshing(false);
    setRefreshError(null);
    setBusy(true);
    history.pushState(null, "", boardLocation("project", projectId));
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
    history.replaceState(null, "", boardLocation("project", project.projectId));
    setProblem(null);
  }

  function handleProjectDeleted(projectId: string) {
    if (currentProject?.projectId !== projectId) return;
    setCurrentProject(null);
    setProjectBoard(null);
    setWantedProjectId(null);
    history.replaceState(null, "", live ? boardLocation("analysis", live.analysisId) : "/site/v2");
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
          const status = (await response.json()) as { revision: string; tiles: TileState[]; jobs: JobState[] } & RefreshApiPayload;
          const changedCodes = status.tiles.filter((tile) => currentLive.tiles.find((old) => old.code === tile.code)?.revision !== tile.revision).map((tile) => tile.code);
          let next: Live = {
            ...currentLive,
            revision: status.revision,
            tiles: status.tiles,
            jobs: status.jobs,
            refreshSummary: refreshSummaryFromPayload(status, currentLive),
          };
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

  useEffect(() => {
    if (!refreshing || !live || activeJobs) return;
    const failedJob = live.jobs.find((job) => job.status === "failed");
    if (failedJob) setRefreshError(refreshErrorForJob(failedJob));
    else if (live.refreshSummary?.staleTiles === 0) setRefreshError(null);
    else setRefreshError({ text: "갱신 결과가 최신 상태로 반영되지 않았습니다. 다시 시도해 주세요.", retryable: true });
    setRefreshing(false);
  }, [activeJobs, live, refreshing]);

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

  useEffect(() => {
    if (!live?.analysisId || topoStateRef.current.s !== "idle") return;
    try {
      const restored = storedTopoState(window.localStorage.getItem(topoStorageKey(live.analysisId)));
      if (restored) setTopoState(restored);
    } catch {
      // localStorage가 막힌 브라우저에서는 서버 결과와 현재 세션만 사용한다.
    }
  }, [live?.analysisId]);

  useEffect(() => {
    if (!live?.analysisId || topoState.s !== "ready") return;
    try {
      window.localStorage.setItem(topoStorageKey(live.analysisId), JSON.stringify(topoState));
    } catch {
      // 저장소가 막힌 브라우저에서는 현재 세션의 추가 자료만 유지한다.
    }
  }, [live?.analysisId, topoState]);

  useEffect(() => {
    if (topoState.s !== "ready" || !topoCenterRef.current) return;
    setTopoState((state) => state.s === "ready" ? topoReducer(state, { type: "recheck", center: topoCenterRef.current!, radiusM }) : state);
  }, [radiusM]);

  const pickerParcels = useMemo(() => pickerParcelsFromScene(live?.scene ?? null, siteInput), [live?.scene, siteInput]);

  const handleTopoCenterChange = useCallback((center: readonly [number, number] | null) => {
    topoCenterRef.current = center;
    if (!center) return;
    const state = topoStateRef.current;
    if (state.s !== "ready" || (!topoAddressDirtyRef.current && state.coveragePct !== null)) return;
    const next = topoReducer(state, { type: "recheck", center, radiusM });
    topoAddressDirtyRef.current = false;
    setTopoState(next);
    if (next.s === "error") {
      const copy = TOPO_ERROR_COPY[next.code];
      setProblem({ text: `${copy.title}. ${copy.body}`, login: false });
    }
  }, [radiusM]);

  useEffect(() => {
    const center = topoCenterRef.current;
    const coveragePct = topoState.s === "ready" ? topoState.coveragePct : null;
    if (topoState.s !== "ready" || !center || (!topoAddressDirtyRef.current && coveragePct !== null)) return;
    handleTopoCenterChange(center);
  }, [handleTopoCenterChange, topoState.s, topoState.s === "ready" ? topoState.coveragePct : null]);

  function handleAddressChange(value: string) {
    addressDirtyRef.current = true;
    setAddress(value);
    setSiteInput(null);
    setSitePickerValid(false);
    if (problem && !problem.login) setProblem(null);
    topoRecheckAbortRef.current?.abort();
    const state = topoStateRef.current;
    if (state.s === "preparing" || state.s === "uploading") {
      topoAddressDirtyRef.current = true;
      topoCenterRef.current = null;
      return;
    }
    if (state.s !== "ready") {
      topoAddressDirtyRef.current = false;
      return;
    }
    topoAddressDirtyRef.current = true;
    if (!value.trim()) {
      setTopoState({ s: "idle" });
      return;
    }
    const topoIdAtChange = state.topoId;
    const controller = new AbortController();
    topoRecheckAbortRef.current = controller;
    void resolveAddressCenter(value).then((center) => {
      if (controller.signal.aborted || topoRecheckAbortRef.current !== controller || !center) return;
      topoCenterRef.current = center;
      const current = topoStateRef.current;
      if (current.s !== "ready" || current.topoId !== topoIdAtChange) return;
      handleTopoCenterChange(center);
    });
  }

  useEffect(() => {
    if (live && !addressDirtyRef.current) {
      setAddress(live.summary.address);
      setRadiusM(live.summary.radiusM);
    }
  }, [live]);

  function openTopoPicker(autoAnalyze = false) {
    if (busy || activeJobs) return;
    topoAfterUploadAnalyzeRef.current = autoAnalyze;
    topoInputRef.current?.click();
  }

  function cancelTopoUpload() {
    topoAfterUploadAnalyzeRef.current = false;
    topoAbortRef.current?.abort();
    topoAbortRef.current = null;
    setTopoState({ s: "idle" });
  }

  function removeTopo() {
    topoAfterUploadAnalyzeRef.current = false;
    topoAbortRef.current?.abort();
    topoAbortRef.current = null;
    setTopoState({ s: "idle" });
  }

  function removeTopoAndAnalyze() {
    removeTopo();
    void analyze(undefined, null, null);
  }

  const topoProblemText = topoState.s === "error" ? `${TOPO_ERROR_COPY[topoState.code].title}. ${TOPO_ERROR_COPY[topoState.code].body}` : null;
  const topoProblemVisible = !!problem && !problem.login && problem.text === topoProblemText;
  const showGlobalProblem = !!problem && (!sitePickerOpen || !topoProblemVisible);

  const controls = (
    <div className={styles.analyzeWrap}>
      {!live && <p className={styles.demoContext}>예시: 고덕동 123 · 반경 1km — 주소를 넣으면 실제 분석</p>}
      <input
        ref={topoInputRef}
        className={styles.srOnly}
        type="file"
        accept=".zip"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] ?? null;
          const autoAnalyze = topoAfterUploadAnalyzeRef.current;
          event.currentTarget.value = "";
          void handleTopoFile(file, autoAnalyze);
        }}
      />
      <form className={styles.analyzeBar} onSubmit={analyze}>
        <label className={styles.srOnly} htmlFor={ADDRESS_INPUT_ID}>지번 주소</label>
        <AddressSuggest
          id={ADDRESS_INPUT_ID}
          inputClassName={styles.addrInput}
          value={address}
          onChange={handleAddressChange}
          ariaInvalid={showGlobalProblem && problem && !problem.login ? true : undefined}
          ariaDescribedBy={showGlobalProblem && problem && !problem.login ? "v2-address-error" : undefined}
          disabled={busy || activeJobs}
        />
        <select className={styles.radiusSelect} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))} aria-label="분석 반경" aria-describedby="v2-radius-help" disabled={busy || activeJobs}>
          {RADIUS_OPTIONS.map((r) => (
            <option key={r.m} value={r.m}>
              {r.label}
            </option>
          ))}
        </select>
        <label className={styles.presetField} htmlFor="v2-analysis-preset">
          <span className={styles.presetLabel}>과제</span>
          <select
            id="v2-analysis-preset"
            className={styles.presetSelect}
            value={preset}
            onChange={(event) => setPreset(event.currentTarget.value as PresetId)}
            aria-label="과제 프리셋"
            aria-describedby="v2-preset-help"
            disabled={busy || activeJobs || !!live}
          >
            {PRESET_IDS.map((id) => <option key={id} value={id}>{TILE_PRESETS[id].label}</option>)}
          </select>
        </label>
        <button type="button" className={styles.pill} onClick={() => setSitePickerOpen((open) => !open)} disabled={busy || activeJobs} aria-expanded={sitePickerOpen} aria-controls="v2-site-picker">
          {sitePickerOpen ? "대지 지정 닫기" : "대지 지정"}
        </button>
        <button
          type="button"
          className={`${styles.pill} ${styles.topoAddressButton}`}
          onClick={() => {
            if (topoState.s === "ready") setSitePickerOpen(true);
            else openTopoPicker();
          }}
          disabled={busy || activeJobs}
          aria-label="수치지형도 추가"
        >
          {topoState.s === "ready" ? "수치지형도 1개" : "수치지형도 추가"}
        </button>
        <button type="submit" className={`${styles.pill} ${styles.pillDark}`} disabled={busy || activeJobs || (sitePickerOpen && !sitePickerValid)} aria-busy={busy || activeJobs}>
          {busy || activeJobs ? "분석 중…" : sitePickerOpen ? "이 대지로 분석" : "분석"}
        </button>
      </form>
      <p id="v2-radius-help" className={styles.radiusCaption}>반경 해석: {RADIUS_CAPTION}</p>
      <p id="v2-preset-help" className={styles.radiusCaption}>분석은 모든 타일을 계산하고, 보드는 {TILE_PRESETS[preset].label} 구성으로 시작합니다. 분석 후에는 카드 ⋯ 메뉴와 모서리 핸들로 바꿀 수 있습니다.</p>
      {sitePickerOpen && (
        <div id="v2-site-picker">
          <SitePicker
            address={address}
            radiusM={radiusM}
            initialSite={siteInput}
            initialParcels={pickerParcels}
            disabled={busy || activeJobs}
            serverError={problem && !problem.login && !topoProblemVisible ? problem.text : null}
            extra={<TopoPanel state={topoState} disabled={busy || activeJobs} onPick={openTopoPicker} onCancel={cancelTopoUpload} onRemove={removeTopo} onDropFile={(file) => void handleTopoFile(file)} />}
            topoCoverage={topoState.s === "ready" ? topoState.summary.coverageWgs84 : []}
            onSiteChange={(site) => setSiteInput(site)}
            onCenterChange={handleTopoCenterChange}
            onValidityChange={setSitePickerValid}
          />
        </div>
      )}
      {showGlobalProblem && problem && (
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
      refreshSummary={live?.refreshSummary ?? null}
      refreshing={refreshing}
      refreshError={refreshError}
      onRefresh={() => void refreshCurrentAnalysis()}
      busy={busy}
      controls={controls}
      onRerun={() => void analyze()}
      onCancel={() => void cancelCurrentAnalysis()}
      canceling={canceling}
      currentProject={currentProject}
      initialProjectBoard={projectBoard}
      requestedPreset={preset}
      initialPreset={preset}
      onPresetChange={setPreset}
      topoState={topoState}
      topoUsed={!!live?.results.some((result) => result.presentation.polygons?.some((polygon) => polygon.layer === "topo_coverage") ?? false)}
      onTopoPick={() => openTopoPicker()}
      onTopoNudge={() => openTopoPicker(true)}
      onTopoRemove={removeTopoAndAnalyze}
      onProjectSaved={handleProjectSaved}
      onProjectDeleted={handleProjectDeleted}
      onOpenProject={(projectId) => void openProject(projectId)}
      onAuthExpired={() => setProblem({ text: "로그인이 만료되었습니다.", login: true })}
      onWindUploaded={() => setWindRefresh((value) => value + 1)}
    />
  );
}

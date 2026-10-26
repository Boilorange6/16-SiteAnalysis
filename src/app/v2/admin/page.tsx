"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type { AdminOverview } from "@/lib/v2/admin/overview";
import type { TileRequest } from "@/lib/v2/admin/requests";
import {
  filterTiles,
  groupSources,
  tilesForSource,
  type SourceRow,
  type TileFilter,
} from "@/lib/v2/admin/admin-view";
import type { TileResult } from "@/lib/v2/tile-result";
import SourceList from "@/components/v2/admin/source-list";
import TileGrid from "@/components/v2/admin/tile-grid";
import TileDrawer from "@/components/v2/admin/tile-drawer";
import CompareDialog from "@/components/v2/admin/compare-dialog";
import styles from "./admin.module.css";

type LoadState = "loading" | "ready" | "forbidden" | "error";
type ProjectOption = {
  projectId: string;
  analysisId: string;
  name: string;
  address: string;
  radiusM: number;
  analysisDate: string;
};

const FILTERS: Array<{ value: TileFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "analysis", label: "분석" },
  { value: "diagram", label: "도판" },
  { value: "simulation", label: "시뮬레이션" },
  { value: "mismatch", label: "원천 불일치" },
  { value: "pending", label: "계산 대기" },
  { value: "requests", label: "요청 대기" },
];

const PENDING_RESULT_STATUSES = new Set(["pending", "running", "no_data", "failed"]);

function radiusLabel(radiusM: number): string {
  return radiusM >= 1000 ? `${radiusM / 1000} km` : `${radiusM} m`;
}

function projectFromUnknown(value: unknown): ProjectOption | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.projectId !== "string" || typeof row.analysisId !== "string" || typeof row.name !== "string" || typeof row.address !== "string" || typeof row.analysisDate !== "string" || typeof row.radiusM !== "number") return null;
  return { projectId: row.projectId, analysisId: row.analysisId, name: row.name, address: row.address, radiusM: row.radiusM, analysisDate: row.analysisDate };
}

function dateTimeLabel(value: string): string {
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

function pendingRequestCounts(requests: TileRequest[]): Record<string, number> {
  return requests.reduce<Record<string, number>>((counts, request) => {
    if (request.status === "대기") counts[request.tileCode] = (counts[request.tileCode] ?? 0) + 1;
    return counts;
  }, {});
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json().catch(() => ({})) as T;
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [results, setResults] = useState<TileResult[]>([]);
  const [requests, setRequests] = useState<TileRequest[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorText, setErrorText] = useState("");
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [analysisPickerOpen, setAnalysisPickerOpen] = useState(false);
  const [filter, setFilter] = useState<TileFilter>("all");
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [compareRequestId, setCompareRequestId] = useState<number | null>(null);
  const [drawerImageSrc, setDrawerImageSrc] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<number | null>(null);
  const selectedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const compareTriggerRef = useRef<HTMLButtonElement | null>(null);

  const loadData = useCallback(async (requestedAnalysisId: string | null) => {
    setLoadState("loading");
    setErrorText("");
    try {
      const query = requestedAnalysisId ? `?analysis=${encodeURIComponent(requestedAnalysisId)}` : "";
      const [overviewResponse, projectsResponse] = await Promise.all([
        authFetch(`/site/api/v2/admin/overview${query}`),
        authFetch("/site/api/v2/projects"),
      ]);
      if (overviewResponse.status === 403) {
        setLoadState("forbidden");
        return;
      }
      if (!overviewResponse.ok) {
        const body = await readJson<{ error?: string }>(overviewResponse);
        throw new Error(body.error ?? "관리 데이터를 불러오지 못했습니다");
      }
      const nextOverview = await readJson<AdminOverview>(overviewResponse);
      setOverview(nextOverview);
      setAnalysisId(nextOverview.analysis?.id ?? null);

      if (projectsResponse.ok) {
        const body = await readJson<{ projects?: unknown }>(projectsResponse);
        setProjects(Array.isArray(body.projects) ? body.projects.map(projectFromUnknown).filter((project): project is ProjectOption => project !== null) : []);
      }

      if (nextOverview.analysis) {
        const analysisResponse = await authFetch(`/site/api/v2/analyses/${encodeURIComponent(nextOverview.analysis.id)}`);
        if (analysisResponse.ok) {
          const body = await readJson<{ results?: unknown }>(analysisResponse);
          setResults(Array.isArray(body.results) ? body.results as TileResult[] : []);
        } else {
          setResults([]);
        }
      } else {
        setResults([]);
      }

      const requestResponse = await authFetch("/site/api/v2/admin/requests");
      if (requestResponse.ok) {
        const body = await readJson<{ requests?: unknown }>(requestResponse);
        setRequests(Array.isArray(body.requests) ? body.requests as TileRequest[] : []);
      } else {
        setRequests([]);
      }
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setErrorText(error instanceof Error ? error.message : "관리 데이터를 불러오지 못했습니다");
    }
  }, []);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("v2-admin-analysis");
    } catch {
      stored = null;
    }
    void loadData(stored);
  }, [loadData]);

  const sourceRows = useMemo(() => groupSources(overview?.sources ?? []), [overview]);
  const selectedSource = sourceRows.find((row) => row.key === selectedSourceKey) ?? null;
  const selectedTile = overview?.tiles.find((tile) => tile.code === selectedCode) ?? null;
  const selectedResult = results.find((result) => result.tileCode === selectedCode);
  const compareRequest = requests.find((request) => request.id === compareRequestId) ?? null;
  const pendingByTile = useMemo(() => pendingRequestCounts(requests), [requests]);
  const sourceTileCodes = useMemo(
    () => selectedSource && overview ? tilesForSource(selectedSource, overview.tiles) : null,
    [overview, selectedSource],
  );
  const visibleTiles = useMemo(() => {
    const filtered = filterTiles(overview?.tiles ?? [], filter, pendingByTile);
    return sourceTileCodes ? filtered.filter((tile) => sourceTileCodes.has(tile.code)) : filtered;
  }, [filter, overview, pendingByTile, sourceTileCodes]);
  const warningCount = sourceRows.filter((row) => row.warn === "stale").length;
  const missingCount = sourceRows.filter((row) => row.warn === "missing").length;
  const mismatchCount = overview?.tiles.filter((tile) => tile.check.status === "mismatch").length ?? 0;
  const pendingResultCount = overview?.tiles.filter((tile) => tile.resultStatus === null || (tile.resultStatus && PENDING_RESULT_STATUSES.has(tile.resultStatus))).length ?? 0;
  const pendingRequestCount = Object.values(pendingByTile).reduce((sum, count) => sum + count, 0);

  const chooseAnalysis = (nextId: string) => {
    setAnalysisPickerOpen(false);
    try {
      window.localStorage.setItem("v2-admin-analysis", nextId);
    } catch {
      // localStorage가 막혀도 현재 선택은 서버 조회로 반영한다.
    }
    void loadData(nextId);
  };

  const toggleSource = (row: SourceRow) => {
    setSelectedSourceKey((current) => current === row.key ? null : row.key);
  };

  const updateRequest = useCallback((request: TileRequest) => {
    setRequests((current) => current.some((item) => item.id === request.id)
      ? current.map((item) => item.id === request.id ? request : item)
      : [request, ...current]);
  }, []);

  const closeCompare = useCallback(() => {
    setCompareRequestId(null);
    window.requestAnimationFrame(() => compareTriggerRef.current?.focus());
  }, []);

  const closeDrawer = useCallback(() => {
    setCompareRequestId(null);
    setSelectedCode(null);
    setDrawerImageSrc(null);
    window.requestAnimationFrame(() => selectedTriggerRef.current?.focus());
  }, []);

  const reopenFromCompare = useCallback(async (request: TileRequest, note: string) => {
    setReopeningId(request.id);
    try {
      const response = await authFetch(`/site/api/v2/admin/requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reopen", note }),
      });
      const body = await response.json().catch(() => ({})) as { request?: TileRequest; error?: string };
      if (!response.ok || !body.request) throw new Error(body.error ?? "요청을 다시 열지 못했습니다");
      updateRequest(body.request);
      closeCompare();
    } finally {
      setReopeningId(null);
    }
  }, [closeCompare, updateRequest]);

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (compareRequestId !== null) {
        event.preventDefault();
        closeCompare();
      } else if (selectedCode !== null) {
        event.preventDefault();
        closeDrawer();
      }
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [closeCompare, closeDrawer, compareRequestId, selectedCode]);

  return (
    <div className={styles.root} data-admin-root>
      <a className={styles.skipLink} href="#admin-content">본문으로 건너뛰기</a>
      <div className={styles.page}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <a className={styles.backButton} href="/site/v2">← 보드로</a>
            <h1>데이터·타일 관리</h1>
            <span className={styles.topTitle}>원천 → 타일 → 실제 결과</span>
          </div>
          {overview && (
            <div className={styles.summaryMeta} aria-label="관리 요약">
              <span>게시 <strong>{overview.manifest.version ?? "미확인"}</strong></span>
              <span>원천 <strong>{overview.sources.length}</strong></span>
              <span>타일 <strong>{overview.tiles.length}</strong></span>
              <span className={styles.summaryMetaWarning}>주의 {warningCount} · 미기록 {missingCount} · 불일치 {mismatchCount} · 계산 대기 {pendingResultCount}</span>
              <span className={styles.pendingCount}>대기 요청 {pendingRequestCount}</span>
            </div>
          )}
        </header>

        <main id="admin-content" inert={selectedCode !== null ? true : undefined}>
          {loadState === "loading" && <p className={styles.loadingState} role="status">관리 데이터를 불러오는 중…</p>}
          {loadState === "forbidden" && (
            <section className={`${styles.inlineCard} ${styles.inlineCardError}`} role="alert" data-admin-state="forbidden">
              <h2>관리자 권한이 필요합니다</h2>
              <p>이 화면은 관리자 계정만 볼 수 있습니다. 현재 계정의 권한을 확인해 주세요.</p>
            </section>
          )}
          {loadState === "error" && (
            <section className={`${styles.inlineCard} ${styles.inlineCardError}`} role="alert" data-admin-state="error">
              <h2>관리 데이터를 불러오지 못했습니다</h2>
              <p>{errorText || "잠시 뒤 다시 시도해 주세요."}</p>
              <div className={styles.inlineCardActions}>
                <button type="button" className={styles.controlButton} onClick={() => void loadData(analysisId)}>다시 시도</button>
              </div>
            </section>
          )}

          {loadState === "ready" && overview && (
            <>
              <section className={styles.summaryPanel} aria-label="관리 현황 요약">
                <div className={styles.summaryIntro}>
                  <p>현재 게시본과 기준 분석을 한 화면에서 점검합니다.</p>
                  <strong>{overview.manifest.createdAt ? `게시 자료 확인 ${dateTimeLabel(overview.manifest.createdAt)}` : "게시 자료 확인일 미확인"}</strong>
                </div>
                <dl className={styles.summaryMetrics}>
                  <div className={`${styles.metric} ${warningCount > 0 ? styles.metricAttention : ""}`}><dt>오래됨</dt><dd>{warningCount}</dd></div>
                  <div className={`${styles.metric} ${missingCount > 0 ? styles.metricAttention : ""}`}><dt>미기록</dt><dd>{missingCount}</dd></div>
                  <div className={`${styles.metric} ${mismatchCount > 0 ? styles.metricAttention : ""}`}><dt>불일치</dt><dd>{mismatchCount}</dd></div>
                  <div className={`${styles.metric} ${pendingResultCount > 0 ? styles.metricAttention : ""}`}><dt>계산 대기</dt><dd>{pendingResultCount}</dd></div>
                </dl>
              </section>

              <section className={styles.analysisBar} aria-label="기준 분석">
                <span className={styles.analysisLabel}>기준 분석</span>
                {overview.analysis ? (
                  <>
                    <strong className={styles.analysisValue}>{overview.analysis.address} · 반경 {radiusLabel(overview.analysis.radiusM)}</strong>
                    <span className={styles.analysisNote}>썸네일은 이 분석을 지금 코드로 그린 결과</span>
                  </>
                ) : (
                  <strong className={styles.analysisValue}>기준 분석 없음</strong>
                )}
                <div className={styles.analysisPicker} data-admin-analysis-picker>
                  <button
                    type="button"
                    className={styles.controlButton}
                    aria-expanded={analysisPickerOpen}
                    aria-controls="admin-analysis-options"
                    onClick={() => setAnalysisPickerOpen((open) => !open)}
                  >
                    기준 분석 바꾸기
                  </button>
                  {analysisPickerOpen && (
                    <div id="admin-analysis-options" className={styles.analysisPickerMenu} role="listbox" aria-label="저장된 기준 분석">
                      {projects.length > 0 ? projects.map((project) => (
                        <button
                          key={project.projectId}
                          type="button"
                          role="option"
                          aria-selected={project.analysisId === analysisId}
                          className={`${styles.analysisOption} ${project.analysisId === analysisId ? styles.analysisOptionSelected : ""}`}
                          onClick={() => chooseAnalysis(project.analysisId)}
                        >
                          <strong>{project.name}</strong>
                          <span>{project.address} · 반경 {radiusLabel(project.radiusM)} · {project.analysisDate}</span>
                        </button>
                      )) : <p className={styles.emptyHint}>저장된 분석이 없습니다.</p>}
                    </div>
                  )}
                </div>
              </section>

              <div className={styles.filterBar} data-admin-filters>
                {FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={styles.filterButton}
                    aria-pressed={filter === item.value}
                    data-admin-filter={item.value}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
                {selectedSource && (
                  <button type="button" className={`${styles.filterButton} ${styles.clearSource}`} onClick={() => setSelectedSourceKey(null)}>
                    원천 선택 해제 · {selectedSource.label}
                  </button>
                )}
              </div>

              <div className={styles.contentGrid}>
                <SourceList rows={sourceRows} selectedKey={selectedSourceKey} selectedTile={selectedTile} onSelect={toggleSource} />
                <TileGrid
                  tiles={visibleTiles}
                  results={results}
                  selectedCode={selectedCode}
                  sourceTileCodes={sourceTileCodes}
                  pendingByTile={pendingByTile}
                  onSelect={(tile, trigger) => {
                    selectedTriggerRef.current = trigger;
                    setDrawerImageSrc(null);
                    setCompareRequestId(null);
                    setSelectedCode(tile.code);
                  }}
                />
              </div>
              {!overview.analysis && <p className={styles.inlineNotice} data-admin-state="no-analysis">기준 분석이 없어 원천 점검과 썸네일을 확인할 수 없습니다. 타일은 확인 불가 상태로 표시됩니다.</p>}
            </>
          )}
        </main>
      </div>
      {selectedTile && overview && (
        <TileDrawer
          key={selectedTile.code}
          tile={selectedTile}
          result={selectedResult}
          overview={overview}
          requests={requests}
          compareOpen={compareRequestId !== null}
          onImageReady={setDrawerImageSrc}
          onClose={closeDrawer}
          onRequestCreated={updateRequest}
          onRequestUpdated={updateRequest}
          onOpenCompare={(request, trigger) => {
            compareTriggerRef.current = trigger;
            setCompareRequestId(request.id);
          }}
        />
      )}
      {compareRequest && selectedTile && (
        <CompareDialog
          request={compareRequest}
          tile={selectedTile}
          currentImageSrc={drawerImageSrc}
          onClose={closeCompare}
          onReopen={reopenFromCompare}
          reopening={reopeningId === compareRequest.id}
        />
      )}
    </div>
  );
}

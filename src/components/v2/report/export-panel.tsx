"use client";

import { createRoot, type Root } from "react-dom/client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { downloadBytes } from "@/lib/v2/export/download";
import { preflightReport, type PreflightIssue } from "@/lib/v2/report/preflight";
import { rasterizePages } from "@/lib/v2/report/raster-export";
import { writeImagePdf } from "@/lib/v2/report/pdf-writer";
import { createZip, measureLegendOverflow, pngBlobToJpeg, runReportExport, selectReportPlan, type ExportPageScope, type ExportPurpose, type MapDrawingMode, type RasterizeForExport } from "@/lib/v2/report/export-runner";
import type { ReportFormat } from "@/lib/v2/report/report-doc";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import { SlideSurface } from "./slide-surface";
import { useFocusTrap } from "../use-focus-trap";
import styles from "./report-mode.module.css";
import surfaceStyles from "../report-surface.module.css";
import localSurfaceStyles from "./slide-surface.module.css";

const surfaceClassMap = { ...surfaceStyles, ...localSurfaceStyles };

type ExportPanelProps = {
  plan: PlannedSlide[];
  format: ReportFormat;
  basemap: BasemapChoice;
  currentPageId: string | null;
  selectedPageIds: ReadonlySet<string>;
  defaultFileName: string;
  dialogRef: RefObject<HTMLDivElement | null>;
  restoreFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onPageScopeChange: (scope: ExportPageScope | null) => void;
  onEnterSelectedPages: () => void;
  onToggleSelectedPage: (pageId: string) => void;
  onViewPage: (pageId: string) => void;
};

const PURPOSES: readonly { id: ExportPurpose; label: string; detail: string; icon: "ppt" | "print" | "image" | "all" }[] = [
  { id: "ppt", label: "발표", detail: "PPT · 발표 메모 포함 · 도형 편집 가능", icon: "ppt" },
  { id: "pdf", label: "인쇄·제출", detail: "PDF · 판형 그대로 · 300 dpi", icon: "print" },
  { id: "png", label: "메신저·문서에 붙이기", detail: "PNG · 쪽마다 한 장 · 여러 쪽은 zip", icon: "image" },
  { id: "all", label: "모두 한 번에", detail: "PPT + PDF + PNG 폴더 · zip", icon: "all" },
];

function ExportIcon({ kind }: { kind: "ppt" | "print" | "image" | "all" }) {
  if (kind === "ppt") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
  if (kind === "print") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 14h10v7H7z" /></svg>;
  if (kind === "image") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="8" height="7" rx="1" /><rect x="13" y="4" width="8" height="7" rx="1" /><rect x="3" y="13" width="8" height="7" rx="1" /><rect x="13" y="13" width="8" height="7" rx="1" /></svg>;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function pageIdOf(slide: PlannedSlide): string | undefined {
  return slide.page?.id ?? slide.key;
}

function pageCountLabel(count: number): string {
  return `${count}쪽`;
}

function renderExportSurfaceFactory(basemap: BasemapChoice, format: ReportFormat, roots: Map<HTMLElement, Root>) {
  return async (slide: PlannedSlide): Promise<HTMLElement> => {
    const slideFormat = slide.format ?? format;
    const width = 1200;
    const height = Math.max(1, Math.round(width * (slideFormat === "wide" ? 7.5 / 13.333 : slideFormat === "a3" ? 11.693 / 16.535 : 8.268 / 11.693)));
    const host = document.createElement("div");
    host.dataset.exportSurface = "true";
    host.dataset.exportKey = slide.key;
    Object.assign(host.style, {
      position: "fixed",
      left: "0px",
      top: "0",
      width: `${width}px`,
      height: `${height}px`,
      pointerEvents: "none",
      opacity: "0",
      overflow: "hidden",
    });
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.set(host, root);
    root.render(<SlideSurface slide={slide} basemap={basemap} mode="export" classMap={surfaceClassMap} />);
    await nextFrame();
    await nextFrame();
    return host;
  };
}

export default function ExportPanel({ plan, format, basemap, currentPageId, selectedPageIds, defaultFileName, dialogRef, restoreFocusRef, onClose, onPageScopeChange, onEnterSelectedPages, onToggleSelectedPage, onViewPage }: ExportPanelProps) {
  const [purpose, setPurpose] = useState<ExportPurpose>("ppt");
  const [scope, setScope] = useState<ExportPageScope>("all");
  const [mapDrawing, setMapDrawing] = useState<MapDrawingMode>("editable");
  const [fileName, setFileName] = useState(defaultFileName);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: plan.length });
  const [preflight, setPreflight] = useState<PreflightIssue[]>([]);
  const [preflightBusy, setPreflightBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterRunRef = useRef(false);
  const rootsRef = useRef(new Map<HTMLElement, Root>());
  const renderSurface = useMemo(() => renderExportSurfaceFactory(basemap, format, rootsRef.current), [basemap, format]);
  const disposeSurface = useCallback((node: HTMLElement) => {
    rootsRef.current.get(node)?.unmount();
    rootsRef.current.delete(node);
    node.remove();
  }, []);
  const rasterize: RasterizeForExport = useCallback((slides, options) => rasterizePages(slides, {
    ...options,
    render: renderSurface,
    dispose: disposeSurface,
  }), [disposeSurface, renderSurface]);

  useFocusTrap({ ref: dialogRef, onClose, restoreFocusRef });

  useLayoutEffect(() => {
    if (!focusAfterRunRef.current) {
      focusAfterRunRef.current = true;
      return;
    }
    const target = running ? cancelButtonRef.current : runButtonRef.current;
    if (target && dialogRef.current?.contains(target)) target.focus({ preventScroll: true });
  }, [dialogRef, running]);

  useEffect(() => {
    setFileName(defaultFileName);
  }, [defaultFileName]);

  useEffect(() => {
    setScope("all");
    onPageScopeChange(null);
  }, [onPageScopeChange, plan]);

  useEffect(() => {
    const controller = new AbortController();
    const measures = new Map<string, { legendOverflow: boolean }>();
    setPreflightBusy(true);
    setError(null);
    setPreflight([]);
    const measure = async () => {
      try {
        for await (const _page of rasterizePages(plan, {
          dpi: 150,
          format,
          signal: controller.signal,
          render: renderSurface,
          toBlob: async (node) => {
            const key = node.dataset.exportKey;
            if (key) measures.set(key, { legendOverflow: measureLegendOverflow(node) });
            return new Blob(["preflight"], { type: "image/png" });
          },
          dispose: disposeSurface,
        })) {
          if (controller.signal.aborted) return;
        }
        if (!controller.signal.aborted) setPreflight(preflightReport(plan, measures));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "내보내기 전 확인에 실패했습니다.");
      } finally {
        if (!controller.signal.aborted) setPreflightBusy(false);
      }
    };
    if (plan.length === 0) {
      setPreflight([]);
      setPreflightBusy(false);
    } else {
      void measure();
    }
    return () => controller.abort();
  }, [disposeSurface, format, plan, renderSurface]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    const roots = [...rootsRef.current];
    rootsRef.current.clear();
    // 패널이 내려가는 렌더 도중에는 다른 루트를 동기로 내릴 수 없다.
    setTimeout(() => {
      for (const [node, root] of roots) {
        root.unmount();
        node.remove();
      }
    }, 0);
  }, []);

  const selectedPlan = useMemo(() => selectReportPlan(plan, scope, currentPageId, selectedPageIds), [currentPageId, plan, scope, selectedPageIds]);
  const needsPpt = purpose === "ppt" || purpose === "all";
  const runLabel = purpose === "all" ? "모두 내려받기" : `${purpose === "ppt" ? "PPT" : purpose === "pdf" ? "PDF" : "이미지"} 내려받기 · ${pageCountLabel(selectedPlan.length)}`;

  const chooseScope = (next: ExportPageScope) => {
    setScope(next);
    setStatus(null);
    if (next === "selected") onEnterSelectedPages();
    onPageScopeChange(next);
  };

  const handleRun = async () => {
    if (running || preflightBusy || selectedPlan.length === 0) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setError(null);
    setStatus(null);
    setProgress({ done: 0, total: selectedPlan.length });
    try {
      const { cancelled } = await runReportExport({
        purpose,
        plan: selectedPlan,
        format,
        fileName,
        mapDrawing,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      }, {
        renderPptx: async (exportPlan, drawing) => {
          const [{ renderReportPptx }, { buildMapImages }] = await Promise.all([
            import("@/lib/v2/report/render-pptx"),
            import("@/lib/v2/report/map-image"),
          ]);
          const images = await buildMapImages(exportPlan, basemap).catch(() => ({}));
          return renderReportPptx(exportPlan, images, { mapDrawing: drawing });
        },
        rasterize,
        pngToJpeg: pngBlobToJpeg,
        writePdf: writeImagePdf,
        zip: createZip,
        download: (name, bytes, mime) => downloadBytes(name, bytes as Uint8Array, mime),
      });
      if (cancelled) setStatus("내보내기를 취소했습니다.");
      else setStatus("내보냈습니다.");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "내보내기에 실패했습니다.");
    } finally {
      controllerRef.current = null;
      setRunning(false);
    }
  };

  const cancel = () => controllerRef.current?.abort();

  return (
    <div id="report-export-panel" ref={dialogRef} className={styles.exportPanel} role="dialog" aria-modal="true" aria-labelledby="report-export-title" tabIndex={-1}>
      <div className={styles.exportPanelHeader}>
        <div><p className={styles.eyebrow}>파일 만들기</p><h2 id="report-export-title">어디에 쓰실 건가요?</h2></div>
        <button type="button" className={styles.exportCloseButton} onClick={onClose} aria-label="내보내기 닫기">×</button>
      </div>

      <div className={styles.exportPurposeGrid} role="radiogroup" aria-label="쓰임">
        {PURPOSES.map((option) => <button key={option.id} type="button" role="radio" aria-checked={purpose === option.id} className={`${styles.exportPurposeCard} ${purpose === option.id ? styles.exportPurposeCardActive : ""}`} onClick={() => { setPurpose(option.id); setStatus(null); }}>
          <ExportIcon kind={option.icon} />
          <strong>{option.label}</strong>
          <span>{option.detail}</span>
        </button>)}
      </div>

      <fieldset className={styles.exportFieldset}>
        <legend>페이지</legend>
        <div className={styles.exportScopeGrid} role="radiogroup" aria-label="내보낼 페이지">
          <button type="button" role="radio" aria-checked={scope === "all"} className={scope === "all" ? styles.exportOptionActive : styles.exportOption} onClick={() => chooseScope("all")}>전체 {plan.length}쪽</button>
          <button type="button" role="radio" aria-checked={scope === "current"} className={scope === "current" ? styles.exportOptionActive : styles.exportOption} onClick={() => chooseScope("current")} disabled={!currentPageId}>지금 쪽만</button>
          <button type="button" role="radio" aria-checked={scope === "selected"} className={scope === "selected" ? styles.exportOptionActive : styles.exportOption} onClick={() => chooseScope("selected")}>골라서</button>
        </div>
        {scope === "selected" && <p className={styles.exportHelper}>페이지 줄에서 포함할 쪽을 체크하세요. 현재 {selectedPlan.length}쪽이 선택되었습니다.</p>}
      </fieldset>

      {needsPpt && <fieldset className={styles.exportFieldset}>
        <legend>지도 그리기</legend>
        <div className={styles.exportScopeGrid} role="radiogroup" aria-label="PPT 지도 그리기">
          <button type="button" role="radio" aria-checked={mapDrawing === "editable"} className={mapDrawing === "editable" ? styles.exportOptionActive : styles.exportOption} onClick={() => setMapDrawing("editable")}>편집 가능한 도형</button>
          <button type="button" role="radio" aria-checked={mapDrawing === "image"} className={mapDrawing === "image" ? styles.exportOptionActive : styles.exportOption} onClick={() => setMapDrawing("image")}>이미지 한 장</button>
        </div>
      </fieldset>}

      <label className={styles.exportFileField}><span>파일 이름</span><input value={fileName} onChange={(event) => setFileName(event.target.value)} aria-label="파일 이름" /></label>

      <section className={styles.exportPreflight} aria-labelledby="report-export-preflight-title">
        <h3 id="report-export-preflight-title">내보내기 전 확인</h3>
        {preflightBusy ? <p className={styles.exportHelper}>페이지를 확인하는 중…</p> : <ul>
          {preflight.map((issue) => <li key={`${issue.pageId}-${issue.text}`} className={issue.level === "warn" ? styles.exportWarning : styles.exportOk}>
            <span aria-hidden="true" className={styles.exportIssueMark}>{issue.level === "warn" ? "!" : "✓"}</span>
            <span>{issue.text}</span>
            {issue.level === "warn" && issue.pageNo > 0 && <button type="button" onClick={() => onViewPage(issue.pageId)}>{issue.pageNo}쪽 보기</button>}
          </li>)}
        </ul>}
      </section>

      {error && <p className={styles.exportPanelError} role="alert">{error}</p>}
      {status && !running && <p className={styles.exportPanelStatus} role="status">{status}</p>}
      {running && <div className={styles.exportProgress} role="status" aria-live="polite" tabIndex={-1}><span>{progress.done}/{progress.total}쪽 만드는 중…</span><button ref={cancelButtonRef} type="button" onClick={cancel}>취소</button></div>}
      {!running && <button ref={runButtonRef} type="button" className={styles.exportRunButton} onClick={() => void handleRun()} disabled={preflightBusy || selectedPlan.length === 0}>{runLabel}</button>}
    </div>
  );
}

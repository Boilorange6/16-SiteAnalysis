"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { CALLOUT_MODES, calloutReportPages, type CalloutMode } from "@/lib/v2/ui/callout-layout";
import type { A05Counts, A05Filter } from "@/lib/v2/engine/a05-filter";
import { detailSiteX, OV } from "@/lib/v2/ui/overlay-layout";
import type { CameraPreset, CutSpec, PinnedLabel } from "@/lib/v2/ui/board-state";
import { faceLabel, type OutputFace, type TileView } from "@/lib/v2/ui/tile-view";
import { BadgeList, CutSelect, FaceSelect, Headline, RowList, SourceStrip, Stage, StatusPlate, TitleChip } from "./tile-card";
import { LayerSelect } from "./layer-select";
import { cutOwnsRaster, normalizedCut, viewForCut } from "@/lib/v2/ui/cut-selection";
import { CUT_CODES } from "@/lib/v2/tile/client";
import { downloadBytes, EXPORT_MIME } from "@/lib/v2/export/download";
import { BASEMAPS, BasemapContext, SetBasemapContext } from "./map-box";
import { mapLabelEntries } from "./map-figure";
import SourcePanel from "./source-panel";
import styles from "./board.module.css";
import { dialogPanelFor } from "@/lib/v2/tile/components";

type Props = {
  view: TileView;
  layer: string;
  onLayer: (layer: string) => void;
  included: boolean;
  face: OutputFace;
  onInclude: (v: boolean) => void;
  onFace: (f: OutputFace) => void;
  onRetry?: () => void;
  cut?: CutSpec | null;
  onCut?: (cut: CutSpec) => void;
  calloutMode: CalloutMode;
  onCalloutMode: (m: CalloutMode) => void;
  camera?: CameraPreset | null;
  onCamera?: (camera: CameraPreset) => void;
  onWindUploaded?: () => void;
  onClose: () => void;
  a05Filter?: A05Filter | null;
  a05Counts?: A05Counts | null;
  onA05Filter?: (filter: A05Filter | null) => void;
  pinnedLabels: PinnedLabel[];
  onToggleLabel: (key: string) => void;
  onUnpinLabel: (key: string) => void;
  onSetAllLabels: (on: boolean) => void;
  initialTab?: "overview" | "sources";
  address?: string;
  analysisDate?: string;
};

const PANEL_W = 360;
const insetOf = (w: number) => (w <= 720 ? 0 : PANEL_W + 2 * OV.edge);
function PinnedLabelPanel({ view, labels, onToggle, onUnpin, onSetAll, onFocusLabel }: { view: TileView; labels: PinnedLabel[]; onToggle: (key: string) => void; onUnpin: (key: string) => void; onSetAll: (on: boolean) => void; onFocusLabel: (key: string | null) => void }) {
  if (view.callout || !view.map) return null;
  const entries = mapLabelEntries(view.map);
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const textCount = new Map<string, number>();
  for (const label of labels) {
    const text = entryByKey.get(label.key)?.text ?? label.key;
    textCount.set(text, (textCount.get(text) ?? 0) + 1);
  }
  const textSeen = new Map<string, number>();
  const onCount = labels.filter((label) => label.on && entryByKey.has(label.key)).length;
  return (
    <section className={styles.pinPanel} aria-labelledby={`pin-labels-${view.tileId}`}>
      <div className={styles.pinPanelHead}>
        <h3 id={`pin-labels-${view.tileId}`}>고정 라벨</h3>
        <span>{onCount}개 표시</span>
      </div>
      {labels.length === 0 ? (
        <p className={styles.pinPanelEmpty}>지도 요소를 눌러 라벨을 고정하세요.</p>
      ) : (
        <ul className={styles.pinList}>
          {labels.map((label) => {
            const entry = entryByKey.get(label.key);
            const baseText = entry?.text ?? label.key;
            const count = textCount.get(baseText) ?? 1;
            const ordinal = (textSeen.get(baseText) ?? 0) + 1;
            textSeen.set(baseText, ordinal);
            const displayText = count > 1 ? `${baseText} (${ordinal})` : baseText;
            return (
              <li
                key={label.key}
                className={styles.pinRow}
                tabIndex={0}
                onMouseEnter={() => onFocusLabel(label.key)}
                onMouseLeave={() => onFocusLabel(null)}
                onFocus={() => onFocusLabel(label.key)}
                onBlur={(event) => {
                  const next = event.relatedTarget;
                  if (!(next instanceof Node) || !event.currentTarget.contains(next)) onFocusLabel(null);
                }}
              >
                <span className={styles.pinRowText} title={displayText}>{displayText}</span>
                <button type="button" className={styles.pinRowButton} aria-pressed={label.on} onClick={() => onToggle(label.key)}>
                  {label.on ? "끄기" : "보이기"}
                </button>
                <button type="button" className={styles.pinRowDelete} onClick={() => onUnpin(label.key)} aria-label={`${displayText} 고정 삭제`}>삭제</button>
              </li>
            );
          })}
        </ul>
      )}
      <div className={styles.pinPanelActions}>
        <button type="button" onClick={() => onSetAll(false)} disabled={onCount === 0}>모두 끄기</button>
        <button type="button" onClick={() => onSetAll(true)} disabled={labels.length === 0}>모두 보이기</button>
      </div>
    </section>
  );
}

/** 펼침: 화면 거의 전체가 지도. 오른쪽에 떠 있는 정보 판. Esc로 닫고, 닫으면 열기 전 초점으로 돌아간다. */
export default function TileDialog({ view, layer, onLayer, included, face, onInclude, onFace, onRetry, cut, onCut, calloutMode, onCalloutMode, camera, onCamera, onWindUploaded, onClose, a05Filter, a05Counts, onA05Filter, pinnedLabels, onToggleLabel, onUnpinLabel, onSetAllLabels, initialTab = "overview", address, analysisDate }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [back, setBack] = useState(false);
  const [more, setMore] = useState(false); // 모바일 시트 확장
  const [page, setPage] = useState(0); // 설명선 타일: 0 = 개요
  const [focusedLabelKey, setFocusedLabelKey] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"overview" | "sources">(initialTab);
  const [tileExporting, setTileExporting] = useState<"png" | "svg" | "plate" | null>(null);
  const [tileExportError, setTileExportError] = useState<string | null>(null);
  const basemap = useContext(BasemapContext);
  const setBasemap = useContext(SetBasemapContext);

  useEffect(() => {
    setPanelTab(initialTab);
  }, [initialTab, view.tileId]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = view.headline === null;
  const selectedCut = normalizedCut(view, cut);
  const cutOwnsS02 = cutOwnsRaster(view, selectedCut);
  const displayView = cutOwnsS02 ? viewForCut(view, selectedCut!) : view;
  const titleId = `dlg-${view.tileId}`;
  const DialogPanel = dialogPanelFor(view.code);
  const saveTile = async (kind: "png" | "svg" | "plate") => {
    if (!address || !analysisDate || state || (!view.map && !view.mass && !view.rose)) return;
    setTileExporting(kind);
    setTileExportError(null);
    try {
      const { tileFileName, tilePng, tileSvgForView } = await import("@/lib/v2/export/tile-image");
      const cutView = selectedCut ? viewForCut(view, selectedCut) : view;
      const exportView = cutView;
      const withFrame = kind !== "plate";
      if (kind === "svg") {
        const svg = await tileSvgForView(exportView, { width: 1600, height: 1200, withFrame: true, layer: basemap });
        downloadBytes(tileFileName(view.code, view.title, address, analysisDate, "svg"), svg, EXPORT_MIME.svg);
      } else {
        const png = await tilePng(exportView, { width: 1600, height: 1200, withFrame, scale: 2, layer: basemap });
        downloadBytes(tileFileName(view.code, withFrame ? view.title : `${view.title} 도판`, address, analysisDate, "png"), png, EXPORT_MIME.png);
      }
    } catch (error) {
      setTileExportError(error instanceof Error ? error.message : "타일 저장에 실패했습니다.");
    } finally {
      setTileExporting(null);
    }
  };
  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className={styles.stage}>
          <Stage view={view} state={state} chart={view.hasFace && back && !state} frame="detail" siteX={detailSiteX} rightInset={insetOf} legendY={OV.edge + 38 + 8} page={page} onPage={setPage} cut={selectedCut} pinnedKeys={pinnedLabels.filter((label) => label.on).map((label) => label.key)} hoverKey={focusedLabelKey} emphasisKey={focusedLabelKey} onFeaturePin={(feature) => onToggleLabel(feature.key)} />
        </div>

        {state && <StatusPlate view={view} phase={null} onRetry={onRetry} />}
        <TitleChip view={view} as="h2" headingId={titleId} />

        <div className={styles.dlgTop}>
          <span className={`${styles.plate} ${styles.seg}`} role="group" aria-label="배경지도">
            {BASEMAPS.map((b) => (
              <button key={b.id} type="button" aria-pressed={basemap === b.id} onClick={() => setBasemap(b.id)}>
                {b.label}
              </button>
            ))}
          </span>
          <button type="button" className={`${styles.plate} ${styles.closeBtn}`} onClick={onClose} aria-label="닫기">
            닫기 ×
          </button>
        </div>

        <aside className={`${styles.plate} ${styles.dlgPanel} ${more ? styles.dlgPanelOpen : ""}`} aria-label={`${view.title} 정보`}>
          <div className={styles.dlgTabs} role="tablist" aria-label="타일 상세 구역">
            <button type="button" role="tab" aria-selected={panelTab === "overview"} className={panelTab === "overview" ? styles.dlgTabActive : styles.dlgTab} onClick={() => setPanelTab("overview")}>개요</button>
            <button type="button" role="tab" aria-selected={panelTab === "sources"} className={panelTab === "sources" ? styles.dlgTabActive : styles.dlgTab} onClick={() => setPanelTab("sources")}>출처·기준일 <span aria-hidden>{view.sourceRefs.length}</span></button>
          </div>
          {panelTab === "sources" ? <SourcePanel view={view} /> : <>
            <BadgeList badges={view.badges} />
            {!cutOwnsS02 && <LayerSelect view={view} value={layer} onChange={onLayer} />}
            <PinnedLabelPanel view={view} labels={pinnedLabels} onToggle={onToggleLabel} onUnpin={onUnpinLabel} onSetAll={onSetAllLabels} onFocusLabel={setFocusedLabelKey} />
            {DialogPanel && <DialogPanel view={view} filter={a05Filter} counts={a05Counts} onChange={onA05Filter} titleId={`a05-${view.tileId}-reaggregate-title`} cut={selectedCut} onCut={onCut} camera={camera} onCamera={onCamera} onWindUploaded={onWindUploaded} />}
            {onCut && CUT_CODES.has(view.code) && <CutSelect view={view} value={selectedCut} onChange={onCut} />}
            {view.headline && (
              <div className={styles.stat}>
                <Headline view={displayView} />
              </div>
            )}
            {displayView.sentence && <p className={styles.dlgSentence}>{displayView.sentence}</p>}
            {view.grades.length > 0 ? (
            <div className={styles.gradeList}>
              <div className={styles.gradeChips}>
                {view.grades.map((g) => (
                  <b key={g.target} className={styles.gradeChip} data-level={g.level}>
                    {g.label}
                  </b>
                ))}
              </div>
              {view.grades.map((g) => (
                <div key={g.target} className={styles.grade}>
                  {g.target} · {g.criteria}
                </div>
              ))}
            </div>
            ) : (
            view.grade && (
              <div className={styles.grade}>
                <b>{view.grade.label}</b>
                {view.grade.criteria}
              </div>
            )
            )}
            {view.caveats.map((c) => (
            <p key={c} className={styles.caveat}>
              {c}
            </p>
            ))}
            {view.hasFace && (
            <div className={styles.seg} role="group" aria-label="보기">
              보기
              <button type="button" aria-pressed={!back} onClick={() => setBack(false)}>
                도판
              </button>
              <button type="button" aria-pressed={back} onClick={() => setBack(true)}>
                구성비
              </button>
            </div>
            )}
            {displayView.rows.length > 0 && <RowList rows={displayView.rows} className={styles.list} />}
            {displayView.notes.length > 0 && (
            <ul className={styles.notes}>
              {displayView.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            )}
            <div className={styles.source}>출처 · {view.sourceLine}</div>
            <div className={styles.dlgReport}>
            <strong>보고서 {view.title}</strong>
            {view.hasFace && <div className={styles.sub}>출력 면: {faceLabel(face)}</div>}
            {view.hasFace && <FaceSelect view={view} value={face} onChange={onFace} />}
            {view.callout && (
              <div className={styles.seg} role="group" aria-label="보고서 설명표 페이지 수">
                설명표 장
                {CALLOUT_MODES.map((m) => (
                  <button key={m.id} type="button" aria-pressed={calloutMode === m.id} onClick={() => onCalloutMode(m.id)}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            {view.callout && <div className={styles.sub}>보고서 {calloutReportPages(calloutMode, view.callout.complexes.length)}장 (개요 포함)</div>}
            <label className={styles.check}>
              <input type="checkbox" checked={included} onChange={(e) => onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
              포함
            </label>
            {!state && (view.map || view.mass || view.rose) && (
              <div className={styles.tileExportActions} aria-label={`${view.title} 타일 저장`}>
                <button type="button" onClick={() => saveTile("png")} disabled={tileExporting !== null} aria-busy={tileExporting === "png"}>
                  {tileExporting === "png" ? "PNG 준비 중…" : "PNG 저장"}
                </button>
                <button type="button" onClick={() => saveTile("svg")} disabled={tileExporting !== null} aria-busy={tileExporting === "svg"}>
                  {tileExporting === "svg" ? "SVG 준비 중…" : "SVG 저장"}
                </button>
                <button type="button" onClick={() => saveTile("plate")} disabled={tileExporting !== null} aria-busy={tileExporting === "plate"}>
                  {tileExporting === "plate" ? "도판 준비 중…" : "도판만 PNG"}
                </button>
              </div>
            )}
            {tileExportError && <p className={styles.tileExportError} role="status">{tileExportError}</p>}
            </div>
            <button type="button" className={styles.moreBtn} onClick={() => setMore((m) => !m)} aria-expanded={more}>
              {more ? "접기" : "더 보기"}
            </button>
          </>}
        </aside>

        <SourceStrip view={view} />
      </div>
    </div>
  );
}

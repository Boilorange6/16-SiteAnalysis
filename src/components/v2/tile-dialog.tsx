"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { CALLOUT_MODES, calloutReportPages, type CalloutMode } from "@/lib/v2/ui/callout-layout";
import { CAMERA_PRESETS } from "@/lib/v2/ui/mass-projection";
import { detailSiteX, OV } from "@/lib/v2/ui/overlay-layout";
import type { CameraPreset, CutCount } from "@/lib/v2/ui/board-state";
import { faceLabel, type OutputFace, type TileView } from "@/lib/v2/ui/tile-view";
import { BadgeList, FaceSelect, Headline, RowList, SourceStrip, Stage, StatusPlate, TitleChip } from "./tile-card";
import WindPanel from "./wind-panel";
import { BASEMAPS, BasemapContext, SetBasemapContext } from "./map-box";
import styles from "./board.module.css";

type Props = {
  view: TileView;
  included: boolean;
  face: OutputFace;
  onInclude: (v: boolean) => void;
  onFace: (f: OutputFace) => void;
  calloutMode: CalloutMode;
  onCalloutMode: (m: CalloutMode) => void;
  camera?: CameraPreset | null;
  onCamera?: (camera: CameraPreset) => void;
  cuts?: CutCount;
  onCuts?: (cuts: CutCount) => void;
  onWindUploaded?: () => void;
  onClose: () => void;
};

const PANEL_W = 360;
const insetOf = (w: number) => (w <= 720 ? 0 : PANEL_W + 2 * OV.edge);

/** 펼침: 화면 거의 전체가 지도. 오른쪽에 떠 있는 정보 판. Esc로 닫고, 닫으면 열기 전 초점으로 돌아간다. */
export default function TileDialog({ view, included, face, onInclude, onFace, calloutMode, onCalloutMode, camera, onCamera, cuts, onCuts, onWindUploaded, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [back, setBack] = useState(false);
  const [more, setMore] = useState(false); // 모바일 시트 확장
  const [page, setPage] = useState(0); // 설명선 타일: 0 = 개요
  const [windLayerZ, setWindLayerZ] = useState(6);
  const basemap = useContext(BasemapContext);
  const setBasemap = useContext(SetBasemapContext);

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
  const titleId = `dlg-${view.tileId}`;
  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className={styles.stage}>
          <Stage view={view} state={state} chart={view.hasFace && back && !state} frame="detail" siteX={detailSiteX} rightInset={insetOf} legendY={OV.edge + 38 + 8} page={page} onPage={setPage} windLayerZ={windLayerZ} />
        </div>

        {state && <StatusPlate view={view} phase={null} />}
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
          <BadgeList badges={view.badges} />
          {view.code === "S03" && <WindPanel view={view} layerZ={windLayerZ} onLayerZ={setWindLayerZ} onUploaded={onWindUploaded} />}
          {view.headline && (
            <div className={styles.stat}>
              <Headline view={view} />
            </div>
          )}
          {view.sentence && <p className={styles.dlgSentence}>{view.sentence}</p>}
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
          {view.code === "S01" && camera && onCamera && (
            <div className={styles.seg} role="group" aria-label="카메라">
              <span>카메라</span>
              <label>
                방위
                <select
                  aria-label="카메라 방위"
                  value={camera.azimuthDeg}
                  onChange={(e) => onCamera({ azimuthDeg: Number(e.target.value), elevationDeg: camera.elevationDeg })}
                >
                  {CAMERA_PRESETS.azimuth.map((azimuthDeg, index) => (
                    <option key={azimuthDeg} value={azimuthDeg}>
                      {["북동 상공", "남동 상공", "남서 상공", "북서 상공"][index]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                앙각
                <select
                  aria-label="카메라 앙각"
                  value={camera.elevationDeg}
                  onChange={(e) => onCamera({ azimuthDeg: camera.azimuthDeg, elevationDeg: Number(e.target.value) })}
                >
                  {CAMERA_PRESETS.elevation.map((elevationDeg) => (
                    <option key={elevationDeg} value={elevationDeg}>
                      {elevationDeg}°
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {view.rows.length > 0 && <RowList rows={view.rows} className={styles.list} />}
          {view.notes.length > 0 && (
            <ul className={styles.notes}>
              {view.notes.map((n) => (
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
            {view.code === "S02" && cuts !== undefined && onCuts && (
              <label className={styles.seg}>
                슬라이드 컷
                <select aria-label="슬라이드 컷" value={cuts} onChange={(e) => onCuts(Number(e.target.value) === 3 ? 3 : 1)}>
                  <option value={1}>1컷</option>
                  <option value={3}>09·12·15 3컷</option>
                </select>
              </label>
            )}
            <label className={styles.check}>
              <input type="checkbox" checked={included} onChange={(e) => onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
              포함
            </label>
          </div>
          <button type="button" className={styles.moreBtn} onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? "접기" : "더 보기"}
          </button>
        </aside>

        <SourceStrip view={view} />
      </div>
    </div>
  );
}

"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { CALLOUT_MODES, calloutReportPages, type CalloutMode } from "@/lib/v2/ui/callout-layout";
import { A05_TYPE_LABEL, A05_TYPES, normalizeA05Filter, type A05Counts, type A05Filter, type A05Type } from "@/lib/v2/engine/a05-filter";
import { CAMERA_PRESETS } from "@/lib/v2/ui/mass-projection";
import { detailSiteX, OV } from "@/lib/v2/ui/overlay-layout";
import type { CameraPreset, CutCount, PinnedLabel } from "@/lib/v2/ui/board-state";
import { faceLabel, type OutputFace, type TileView } from "@/lib/v2/ui/tile-view";
import { BadgeList, FaceSelect, Headline, RoseSeasonSelect, RowList, SourceStrip, Stage, StatusPlate, TitleChip } from "./tile-card";
import type { RoseSeason } from "@/lib/v2/tile-result";
import WindPanel from "./wind-panel";
import { BASEMAPS, BasemapContext, SetBasemapContext } from "./map-box";
import { mapLabelEntries } from "./map-figure";
import styles from "./board.module.css";

type Props = {
  view: TileView;
  included: boolean;
  face: OutputFace;
  onInclude: (v: boolean) => void;
  onFace: (f: OutputFace) => void;
  onRetry?: () => void;
  roseSeason: RoseSeason;
  onRoseSeason: (season: RoseSeason) => void;
  calloutMode: CalloutMode;
  onCalloutMode: (m: CalloutMode) => void;
  camera?: CameraPreset | null;
  onCamera?: (camera: CameraPreset) => void;
  cuts?: CutCount;
  onCuts?: (cuts: CutCount) => void;
  onWindUploaded?: () => void;
  onClose: () => void;
  a05Filter?: A05Filter | null;
  a05Counts?: A05Counts | null;
  onA05Filter?: (filter: A05Filter | null) => void;
  pinnedLabels: PinnedLabel[];
  onToggleLabel: (key: string) => void;
  onUnpinLabel: (key: string) => void;
  onSetAllLabels: (on: boolean) => void;
};

const PANEL_W = 360;
const insetOf = (w: number) => (w <= 720 ? 0 : PANEL_W + 2 * OV.edge);

const A05_RANGE_FIELDS = [
  { key: "year", label: "준공연도", unit: "년" },
  { key: "households", label: "세대수", unit: "세대" },
  { key: "floors", label: "층수", unit: "층" },
] as const;
type A05RangeKey = (typeof A05_RANGE_FIELDS)[number]["key"];
type A05Bound = "min" | "max";

const safeA05Count = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const a05CountText = (value: number | null | undefined) => safeA05Count(value).toLocaleString("ko-KR");

function A05FilterPanel({ filter, counts, onChange, titleId }: { filter: A05Filter | null | undefined; counts: A05Counts | null | undefined; onChange?: (next: A05Filter | null) => void; titleId: string }) {
  const selectedTypeSet = new Set(filter?.types ?? []);
  const hasPartialTypeFilter = selectedTypeSet.size > 0 && selectedTypeSet.size < A05_TYPES.length;
  const allTypesSelected = !hasPartialTypeFilter;

  const commit = (next: A05Filter) => onChange?.(normalizeA05Filter(next));
  const selectAllTypes = () => commit({ ...(filter ?? {}), types: undefined });
  const toggleType = (type: A05Type) => {
    const currentTypes = hasPartialTypeFilter ? A05_TYPES.filter((candidate) => selectedTypeSet.has(candidate)) : [];
    const nextTypes = hasPartialTypeFilter
      ? currentTypes.includes(type)
        ? currentTypes.filter((candidate) => candidate !== type)
        : [...currentTypes, type]
      : [type];
    commit({ ...(filter ?? {}), types: nextTypes.length === 0 || nextTypes.length === A05_TYPES.length ? undefined : nextTypes });
  };
  const rangeValue = (field: A05RangeKey, bound: A05Bound) => {
    const value = filter?.[field]?.[bound];
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  };
  const updateRange = (field: A05RangeKey, bound: A05Bound, rawValue: string) => {
    const parsed = rawValue === "" ? null : Number(rawValue);
    const value = parsed === null || !Number.isFinite(parsed) ? null : parsed;
    const range = filter?.[field];
    commit({ ...(filter ?? {}), [field]: { min: range?.min ?? null, max: range?.max ?? null, [bound]: value } });
  };

  const total = safeA05Count(counts?.total);
  const kept = safeA05Count(counts?.kept);
  const unknownKept = safeA05Count(counts?.unknownKept);

  return (
    <section className={styles.a05Panel} aria-labelledby={titleId}>
      <div className={styles.a05PanelHeader}>
        <h3 id={titleId} className={styles.a05PanelTitle}>
          재집계
        </h3>
        <button type="button" className={styles.a05Reset} onClick={() => onChange?.(null)} aria-label="A05 필터 초기화">
          초기화
        </button>
      </div>

      <div className={styles.a05TypeBlock}>
        <span id={`${titleId}-types-label`} className={styles.a05SectionLabel}>
          주택 유형
        </span>
        <div className={styles.a05Types} role="group" aria-labelledby={`${titleId}-types-label`}>
          <button type="button" className={styles.a05Chip} aria-pressed={allTypesSelected} onClick={selectAllTypes}>
            전체
          </button>
          {A05_TYPES.map((type) => (
            <button type="button" key={type} className={styles.a05Chip} aria-pressed={hasPartialTypeFilter && selectedTypeSet.has(type)} onClick={() => toggleType(type)}>
              {A05_TYPE_LABEL[type]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.a05Ranges}>
        {A05_RANGE_FIELDS.map(({ key, label, unit }) => {
          const minId = `${titleId}-${key}-min`;
          const maxId = `${titleId}-${key}-max`;
          const unknown = counts?.unknownByField[key];
          return (
            <fieldset key={key} className={styles.a05Range}>
              <legend className={styles.a05RangeLegend}>
                <span>{label}</span>
                <span className={styles.a05RangeUnknown}>정보 없음 {a05CountText(unknown)}건 포함</span>
              </legend>
              <div className={styles.a05RangeInputs}>
                <div className={styles.a05Bound}>
                  <label className={styles.a05BoundLabel} htmlFor={minId}>
                    최소
                  </label>
                  <input
                    id={minId}
                    className={styles.a05Input}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    aria-label={`${label} 최소`}
                    value={rangeValue(key, "min")}
                    onChange={(event) => updateRange(key, "min", event.currentTarget.value)}
                  />
                  <span className={styles.a05Unit} aria-hidden="true">
                    {unit}
                  </span>
                </div>
                <div className={styles.a05Bound}>
                  <label className={styles.a05BoundLabel} htmlFor={maxId}>
                    최대
                  </label>
                  <input
                    id={maxId}
                    className={styles.a05Input}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    aria-label={`${label} 최대`}
                    value={rangeValue(key, "max")}
                    onChange={(event) => updateRange(key, "max", event.currentTarget.value)}
                  />
                  <span className={styles.a05Unit} aria-hidden="true">
                    {unit}
                  </span>
                </div>
              </div>
            </fieldset>
          );
        })}
      </div>

      <p className={styles.a05Summary} aria-live="polite" aria-atomic="true">
        {a05CountText(total)}건 중 {a05CountText(kept)}건 · 정보 없음 {a05CountText(unknownKept)}건 포함
      </p>
    </section>
  );
}

function PinnedLabelPanel({ view, labels, onToggle, onUnpin, onSetAll }: { view: TileView; labels: PinnedLabel[]; onToggle: (key: string) => void; onUnpin: (key: string) => void; onSetAll: (on: boolean) => void }) {
  if (view.callout || !view.map) return null;
  const entries = mapLabelEntries(view.map);
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
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
            return (
              <li key={label.key} className={styles.pinRow}>
                <span className={styles.pinRowText} title={entry?.text ?? label.key}>{entry?.text ?? label.key}</span>
                <button type="button" className={styles.pinRowButton} aria-pressed={label.on} onClick={() => onToggle(label.key)}>
                  {label.on ? "끄기" : "보이기"}
                </button>
                <button type="button" className={styles.pinRowDelete} onClick={() => onUnpin(label.key)} aria-label={`${entry?.text ?? label.key} 고정 삭제`}>삭제</button>
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
export default function TileDialog({ view, included, face, onInclude, onFace, onRetry, roseSeason, onRoseSeason, calloutMode, onCalloutMode, camera, onCamera, cuts, onCuts, onWindUploaded, onClose, a05Filter, a05Counts, onA05Filter, pinnedLabels, onToggleLabel, onUnpinLabel, onSetAllLabels }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [back, setBack] = useState(false);
  const [more, setMore] = useState(false); // 모바일 시트 확장
  const [page, setPage] = useState(0); // 설명선 타일: 0 = 개요
  const [windLayerZ, setWindLayerZ] = useState(6);
  const [massExploded, setMassExploded] = useState(false);
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
          <Stage view={view} state={state} chart={view.hasFace && back && !state} frame="detail" siteX={detailSiteX} rightInset={insetOf} legendY={OV.edge + 38 + 8} page={page} onPage={setPage} windLayerZ={windLayerZ} massExploded={massExploded} roseSeason={roseSeason} pinnedKeys={pinnedLabels.filter((label) => label.on).map((label) => label.key)} onFeaturePin={(feature) => onToggleLabel(feature.key)} />
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
          <BadgeList badges={view.badges} />
          <PinnedLabelPanel view={view} labels={pinnedLabels} onToggle={onToggleLabel} onUnpin={onUnpinLabel} onSetAll={onSetAllLabels} />
          {view.code === "A05" && <A05FilterPanel filter={a05Filter} counts={a05Counts} onChange={onA05Filter} titleId={`a05-${view.tileId}-reaggregate-title`} />}
          {view.code === "S03" && <WindPanel view={view} layerZ={windLayerZ} onLayerZ={setWindLayerZ} onUploaded={onWindUploaded} />}
          {view.code === "D22" && !state && <RoseSeasonSelect view={view} value={roseSeason} onChange={onRoseSeason} />}
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
          {view.code === "S01" && view.mass && (
            <div className={styles.seg} role="group" aria-label="S01 매스 보기">
              <span>표현</span>
              <button type="button" aria-pressed={!massExploded} onClick={() => setMassExploded(false)}>
                기본 매스
              </button>
              <button type="button" aria-pressed={massExploded} onClick={() => setMassExploded(true)}>
                분해
              </button>
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

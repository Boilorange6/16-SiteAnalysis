"use client";

import { useEffect, useMemo, useState } from "react";
import type { MapFrameState, ReportPage } from "@/lib/v2/report/report-doc";
import { parseScaleInput, SCALE_PRESETS, scaleForFrame, zoomForScale, type ReportScaleOptions } from "@/lib/v2/ui/report-scale";
import { legendItemsForModel } from "@/lib/v2/ui/map-layers";
import type { TileView } from "@/lib/v2/ui/tile-view";
import styles from "./report-mode.module.css";

type DrawerMapProps = {
  page: Extract<ReportPage, { kind: "tile" | "compare" }>;
  frame: MapFrameState;
  view: TileView | null;
  cell?: number;
  scaleOptions: ReportScaleOptions;
  sameExtent?: boolean;
  onSameExtent?: (value: boolean) => void;
  onFrame: (patch: Partial<MapFrameState>) => void;
};

const BASEMAPS: Array<{ value: MapFrameState["basemap"]; label: string }> = [
  { value: "base", label: "일반" },
  { value: "road", label: "도로" },
  { value: "air", label: "항공" },
  { value: "none", label: "없음" },
];

function hasMapData(view: TileView | null): boolean {
  const model = view?.map ?? view?.backdrop;
  return !!model && Number.isFinite(model.radiusM) && model.radiusM > 0 && Number.isFinite(model.center[0]) && Number.isFinite(model.center[1]);
}

export default function DrawerMap({ page, frame, view, cell, scaleOptions, sameExtent = false, onSameExtent, onFrame }: DrawerMapProps) {
  const model = view?.map ?? view?.backdrop ?? null;
  const [scaleText, setScaleText] = useState(String(model ? scaleForFrame(model, frame, scaleOptions) : 1));
  const [scaleError, setScaleError] = useState<string | null>(null);
  const scale = useMemo(() => model ? scaleForFrame(model, frame, scaleOptions) : 1, [frame, model, scaleOptions]);
  const locatorAvailable = hasMapData(view);
  useEffect(() => setScaleText(String(scale)), [scale]);
  const layers = useMemo(() => {
    if (view?.layerOptions && view.layerOptions.length > 0) return view.layerOptions.map((item) => ({ id: item.id, label: item.label }));
    return model ? legendItemsForModel(model).map((item) => ({ id: item.layer, label: item.label })) : [];
  }, [model, view?.layerOptions]);
  const legendItems = useMemo(() => {
    if (!model) return [];
    const items = legendItemsForModel(model);
    const order = new Map(frame.legend.order.map((id, index) => [id, index]));
    return [...items].sort((a, b) => (order.get(a.layer) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.layer) ?? Number.MAX_SAFE_INTEGER));
  }, [frame.legend.order, model]);
  const submitScale = () => {
    const next = parseScaleInput(scaleText);
    if (next === null) {
      setScaleError("1:500부터 1:50,000까지 입력합니다");
      return;
    }
    if (frame.locked) {
      setScaleText(String(scale));
      return;
    }
    setScaleError(null);
    if (!model) return;
    onFrame({ scaleDenominator: next, zoomDelta: zoomForScale(next, model, scaleOptions) });
  };
  const toggleHidden = (id: string) => {
    const hidden = frame.hiddenLayers.includes(id) ? frame.hiddenLayers.filter((layer) => layer !== id) : [...frame.hiddenLayers, id];
    onFrame({ hiddenLayers: hidden });
  };
  const toggleDecoration = (key: keyof MapFrameState["decorations"]) => onFrame({ decorations: { ...frame.decorations, [key]: !frame.decorations[key] } });
  const legend = (patch: Partial<MapFrameState["legend"]>) => onFrame({ legend: { ...frame.legend, ...patch, order: patch.order ?? frame.legend.order, hidden: patch.hidden ?? frame.legend.hidden } });
  const moveLegend = (layer: string, direction: -1 | 1) => {
    const order = legendItems.map((item) => item.layer);
    const index = order.indexOf(layer);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    [order[index], order[nextIndex]] = [order[nextIndex]!, order[index]!];
    legend({ order });
  };
  const toggleLegendHidden = (layer: string) => legend({ hidden: frame.legend.hidden.includes(layer) ? frame.legend.hidden.filter((id) => id !== layer) : [...frame.legend.hidden, layer] });
  const moveLegendTo = (source: string, target: string) => {
    if (source === target) return;
    const order = legendItems.map((item) => item.layer).filter((layer) => layer !== source);
    const index = Math.max(0, order.indexOf(target));
    order.splice(index, 0, source);
    legend({ order });
  };
  return (
    <section className={styles.drawer} aria-label="지도 설정">
      <div className={styles.drawerHeader}><div><p className={styles.eyebrow}>선택한 지도</p><h2>지도 설정</h2></div><span className={styles.lockBadge}>{frame.locked ? "잠김" : "편집 가능"}</span></div>
      {page.kind === "compare" && onSameExtent && <label className={styles.switchRow}><input type="checkbox" checked={sameExtent} onChange={(event) => onSameExtent(event.target.checked)} /><span>같은 위치·확대 적용</span></label>}
      <fieldset className={styles.mapFieldset}><legend>배경지도</legend><div className={styles.basemapGrid}>{BASEMAPS.map((item) => <button key={item.value} type="button" className={frame.basemap === item.value ? styles.basemapActive : styles.basemapCell} aria-pressed={frame.basemap === item.value} onClick={() => onFrame({ basemap: item.value })}><span className={`${styles.basemapPreview} ${styles["basemap" + item.value]}`} aria-hidden="true" /><span>{item.label}</span></button>)}</div></fieldset>
      <fieldset className={styles.mapFieldset}><legend>범위</legend><div className={styles.scaleRow}><button type="button" className={styles.iconButton} onClick={() => { if (!frame.locked) { setScaleError(null); onFrame({ zoomDelta: frame.zoomDelta - 0.25, scaleDenominator: null }); } }} disabled={frame.locked} aria-label="축척 줄이기">−</button><label className={styles.scaleInput}><span>1 :</span><input value={scaleText} onChange={(event) => { setScaleText(event.target.value); setScaleError(null); }} onBlur={submitScale} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitScale(); } }} inputMode="numeric" aria-label="축척 분모" disabled={frame.locked} /></label><button type="button" className={styles.iconButton} onClick={() => { if (!frame.locked) { setScaleError(null); onFrame({ zoomDelta: frame.zoomDelta + 0.25, scaleDenominator: null }); } }} disabled={frame.locked} aria-label="축척 키우기">＋</button></div>{scaleError && <p className={styles.scaleError} role="alert">{scaleError}</p>}<div className={styles.presetRow}>{SCALE_PRESETS.map((preset) => <button type="button" key={preset} className={styles.presetButton} onClick={() => { if (!frame.locked && model) { setScaleError(null); onFrame({ scaleDenominator: preset, zoomDelta: zoomForScale(preset, model, scaleOptions) }); } }} disabled={frame.locked}>1:{preset.toLocaleString("ko-KR")}</button>)}</div><div className={styles.numberGrid}><label><span>동쪽 이동(m)</span><input type="number" value={Math.round(frame.offsetM[0])} disabled={frame.locked} onChange={(event) => onFrame({ offsetM: [Number(event.target.value) || 0, frame.offsetM[1]] })} /></label><label><span>북쪽 이동(m)</span><input type="number" value={Math.round(frame.offsetM[1])} disabled={frame.locked} onChange={(event) => onFrame({ offsetM: [frame.offsetM[0], Number(event.target.value) || 0] })} /></label></div><div className={styles.inlineActions}><button type="button" className={styles.secondaryButton} disabled={frame.locked} onClick={() => onFrame({ zoomDelta: 0, offsetM: [0, 0], scaleDenominator: null })}>대지 맞춤</button><button type="button" className={styles.secondaryButton} disabled={frame.locked} onClick={() => onFrame({ zoomDelta: -1, offsetM: [0, 0], scaleDenominator: null })}>반경 전체</button></div><label className={styles.switchRow}><input type="checkbox" checked={frame.locked} onChange={(event) => onFrame({ locked: event.target.checked })} /><span>지도 위치 고정</span></label>{frame.locked && <p className={styles.helper}>지도가 잠겨 있어 드래그·축척·이동 입력은 무시됩니다. 판형과 레이아웃만 바꿀 수 있습니다.</p>}</fieldset>
      <fieldset className={styles.mapFieldset}><legend>라벨</legend><div className={styles.radioList}>{(["site-near", "all-visible", "off"] as const).map((rule) => <label key={rule}><input type="radio" name={`label-rule-${page.id}-${cell ?? "page"}`} checked={frame.labelRule === rule} onChange={() => onFrame({ labelRule: rule })} /><span>{rule === "site-near" ? "대지 주변 지번만" : rule === "all-visible" ? "보이는 지번 모두" : "끄기"}</span></label>)}</div></fieldset>
      <fieldset className={styles.mapFieldset}><legend>지도 레이어</legend><div className={styles.layerList}>{layers.map((layer) => <label key={layer.id}><input type="checkbox" checked={!frame.hiddenLayers.includes(layer.id)} onChange={() => toggleHidden(layer.id)} /><span>{layer.label}</span></label>)}{layers.length === 0 && <span className={styles.helper}>이 지도에는 선택할 레이어가 없습니다.</span>}</div></fieldset>
      <fieldset className={styles.mapFieldset}><legend>범례</legend><div className={styles.legendEditList}>{legendItems.map((item, index) => <div className={styles.legendEditRow} key={item.layer} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/report-legend", item.layer); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData("text/report-legend"); if (source) moveLegendTo(source, item.layer); }}><span className={styles.legendDragHandle} aria-label={`${item.label} 순서 이동`} title="끌어서 순서 변경">⋮⋮</span><label><input type="checkbox" checked={!frame.legend.hidden.includes(item.layer)} onChange={() => toggleLegendHidden(item.layer)} /><span>{item.label}</span></label><span className={styles.legendMoveButtons}><button type="button" className={styles.tinyButton} disabled={index === 0} onClick={() => moveLegend(item.layer, -1)} aria-label={`${item.label} 위로`}>↑</button><button type="button" className={styles.tinyButton} disabled={index === legendItems.length - 1} onClick={() => moveLegend(item.layer, 1)} aria-label={`${item.label} 아래로`}>↓</button></span></div>)}</div><label className={styles.fieldLabel}><span>위치</span><select value={frame.legend.placement} onChange={(event) => legend({ placement: event.target.value as MapFrameState["legend"]["placement"] })}><option value="below">지도 아래</option><option value="right">오른쪽</option><option value="hidden">숨김</option></select></label><label className={styles.switchRow}><input type="checkbox" checked={frame.legend.visibleOnly} onChange={(event) => legend({ visibleOnly: event.target.checked })} /><span>보이는 것만</span></label></fieldset>
      <fieldset className={styles.mapFieldset}><legend>장식</legend><div className={styles.layerList}><label><input type="checkbox" checked={frame.decorations.north} onChange={() => toggleDecoration("north")} /><span>방위표</span></label><label><input type="checkbox" checked={frame.decorations.scaleBar} onChange={() => toggleDecoration("scaleBar")} /><span>축척 막대</span></label><label><input type="checkbox" checked={frame.decorations.locator} disabled={!locatorAvailable} onChange={() => toggleDecoration("locator")} /><span>위치도 (넓은 범위에 대지 표시)</span></label></div>{!locatorAvailable && <p className={styles.disabledReason}>위치도는 대지 중심과 분석 반경 데이터가 필요해 현재 사용할 수 없습니다.</p>}</fieldset>
    </section>
  );
}

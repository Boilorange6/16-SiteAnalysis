"use client";

import { useEffect, useMemo, useState } from "react";
import { type MapFrameState, type ReportPage } from "@/lib/v2/report/report-doc";
import { cardName, dotColor, fmtInt, fmtMonth, isHollowComplexMarker, type CalloutSort, type Complex } from "@/lib/v2/ui/callout-layout";
import { A05FilterPanel } from "@/lib/v2/tile/a05/Panel";
import type { A05Filter } from "@/lib/v2/engine/a05-filter";
import { formatScaleDenominator, parseScaleInput, SCALE_PRESETS, scaleForFrame, siteAnchoredZoomPatch, siteFitPatch, zoomForScale, type ReportScaleOptions } from "@/lib/v2/ui/report-scale";
import { legendItemsForModel } from "@/lib/v2/ui/map-layers";
import type { TileView } from "@/lib/v2/ui/tile-view";
import styles from "./report-mode.module.css";

export type CalloutDrawerConfig = {
  pageId: string;
  pageNumber: number;
  model: NonNullable<TileView["callout"]>;
  view: TileView;
  shownKeys: string[];
  numberStart: number;
  otherPageLabels: ReadonlyMap<string, string>;
  canAddOverview: boolean;
  filter: A05Filter | null;
  onShownKeys: (keys: string[]) => void;
  onFilter: (filter: A05Filter | null) => void;
  onAutoGenerate: (by: CalloutSort) => void;
  onAddBlank: () => void;
  onAddOverview: () => void;
  onMessage: (message: string) => void;
};

type DrawerMapProps = {
  page: Extract<ReportPage, { kind: "tile" | "compare" }>;
  frame: MapFrameState;
  view: TileView | null;
  cell?: number;
  scaleOptions: ReportScaleOptions;
  sameExtent?: boolean;
  onSameExtent?: (value: boolean) => void;
  onFrame: (patch: Partial<MapFrameState>) => void;
  callout?: CalloutDrawerConfig;
};

const BASEMAPS: Array<{ value: MapFrameState["basemap"]; label: string }> = [
  { value: "base", label: "기본 지도" },
  { value: "road", label: "도로" },
  { value: "air", label: "항공" },
  { value: "none", label: "없음" },
];

const LEGEND_PLACEMENTS: Array<{ value: MapFrameState["legend"]["placement"]; label: string }> = [
  { value: "below", label: "지도 아래" },
  { value: "right", label: "오른쪽" },
  { value: "hidden", label: "숨김" },
];

const LABEL_RULES: Array<{ value: MapFrameState["labelRule"]; label: string }> = [
  { value: "site-near", label: "대지 주변 지번만" },
  { value: "all-visible", label: "보이는 지번 모두" },
  { value: "off", label: "끄기" },
];

function hasMapData(view: TileView | null): boolean {
  const model = view?.map ?? view?.backdrop;
  return !!model && Number.isFinite(model.radiusM) && model.radiusM > 0 && Number.isFinite(model.center[0]) && Number.isFinite(model.center[1]);
}

function labelRuleSummary(rule: MapFrameState["labelRule"]): string {
  return LABEL_RULES.find((item) => item.value === rule)?.label ?? "없음";
}

function calloutMeta(complex: Complex): string {
  const unit = complex.type === "오피스텔" ? "호" : "세대";
  const households = complex.households === null ? "세대수 확인필요" : `${fmtInt(complex.households)}${unit}`;
  if (complex.supply) return `${households} · ${complex.supply.plannedMonth ? fmtMonth(complex.supply.plannedMonth) : "입주 시기 확인필요"}`;
  const year = complex.approvalYear === null ? "준공 확인필요" : `${complex.approvalYear}년`;
  const floors = complex.floorsMax === null ? "최고층 확인필요" : `최고 ${fmtInt(complex.floorsMax)}층`;
  return `${households} · ${year} · ${floors}`;
}

function CalloutSettings({ config }: { config: CalloutDrawerConfig }) {
  const [autoOpen, setAutoOpen] = useState(false);
  const [sortBy, setSortBy] = useState<CalloutSort>(config.model.kind === "supply" ? "supply" : "year");
  const shown = new Set(config.shownKeys);
  const order = useMemo(() => {
    const position = new Map(config.shownKeys.map((key, index) => [key, index]));
    return [...config.model.complexes].sort((a, b) => (position.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.key) ?? Number.MAX_SAFE_INTEGER));
  }, [config.model.complexes, config.shownKeys]);
  const sortOptions: Array<{ value: CalloutSort; label: string }> = config.model.kind === "supply"
    ? [{ value: "supply", label: "입주 시기" }, { value: "households", label: "세대수" }]
    : [{ value: "year", label: "준공연대" }, { value: "households", label: "세대수" }, { value: "floors", label: "최고층수" }];

  useEffect(() => {
    if (!sortOptions.some((option) => option.value === sortBy)) setSortBy(sortOptions[0].value);
  }, [sortBy, sortOptions]);

  const toggle = (complex: Complex) => {
    if (shown.has(complex.key)) {
      config.onShownKeys(config.shownKeys.filter((key) => key !== complex.key));
      return;
    }
    if (config.shownKeys.length >= 10) {
      config.onMessage("한 장에 10개까지입니다. 다른 라벨을 끄거나 새 장에서 켜세요");
      return;
    }
    config.onShownKeys([...config.shownKeys, complex.key]);
  };
  const move = (key: string, direction: -1 | 1) => {
    const index = config.shownKeys.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= config.shownKeys.length) return;
    const next = [...config.shownKeys];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    config.onShownKeys(next);
  };

  return <section className={styles.mapSection} aria-labelledby={`map-callout-pages-heading-${config.pageId}`}>
    <h3 id={`map-callout-pages-heading-${config.pageId}`} className={styles.mapSectionTitle}>설명표 장</h3>
    <div className={styles.inlineActions}>
      {config.canAddOverview && <button type="button" className={styles.secondaryButton} onClick={config.onAddOverview} aria-label="개요 장 추가">개요 장 추가</button>}
      <button type="button" className={styles.secondaryButton} onClick={() => setAutoOpen((open) => !open)} aria-expanded={autoOpen} aria-label="라벨 자동 생성">라벨 자동 생성</button>
      <button type="button" className={styles.secondaryButton} onClick={config.onAddBlank} aria-label="빈 설명 장 추가">빈 설명 장 추가</button>
    </div>
    {autoOpen && <div className={styles.calloutAutoOptions} role="group" aria-label="자동 생성 기준">
      {sortOptions.map((option) => <button key={option.value} type="button" className={sortBy === option.value ? styles.legendPlacementActive : styles.legendPlacementButton} aria-pressed={sortBy === option.value} onClick={() => { setSortBy(option.value); setAutoOpen(false); config.onAutoGenerate(option.value); }}>{option.label}</button>)}
    </div>}
    <div className={styles.calloutLabelHeader}><span>라벨 목록</span><strong>켠 라벨 {config.shownKeys.length}/10</strong></div>
    <div className={styles.calloutLabelList} role="list" aria-label="설명선 라벨 목록">
      {order.map((complex) => {
        const enabled = shown.has(complex.key);
        const index = config.shownKeys.indexOf(complex.key);
        const name = cardName(complex);
        const hollow = isHollowComplexMarker(complex);
        const number = enabled && index >= 0 ? config.numberStart + index : null;
        const otherPageLabel = config.otherPageLabels.get(complex.key);
        return <div key={complex.key} className={styles.calloutLabelRow} role="listitem">
          <label className={styles.calloutLabelCheck}>
            <input type="checkbox" checked={enabled} onChange={() => toggle(complex)} aria-label={`${name} 설명선 ${enabled ? "끄기" : "켜기"}`} />
            <span className={styles.calloutLabelDot} style={{ background: hollow ? "#fff" : dotColor(complex), borderColor: dotColor(complex) }} aria-hidden="true" />
            <span className={styles.calloutLabelText}><span className={styles.calloutLabelName}>{name}{number !== null ? ` · ${number}번` : ""}{otherPageLabel ? ` · ${otherPageLabel}` : ""}</span><span className={styles.calloutLabelMeta}>{calloutMeta(complex)}</span></span>
          </label>
          {enabled && <span className={styles.calloutLabelOrder}><button type="button" className={styles.tinyButton} disabled={index <= 0} onClick={() => move(complex.key, -1)} aria-label={`${name} 라벨 위로`}>↑</button><button type="button" className={styles.tinyButton} disabled={index < 0 || index >= config.shownKeys.length - 1} onClick={() => move(complex.key, 1)} aria-label={`${name} 라벨 아래로`}>↓</button></span>}
        </div>;
      })}
      {order.length === 0 && <p className={styles.helper}>이 장에서 확인된 단지가 없습니다.</p>}
    </div>
    {config.model.kind === "stock" && <A05FilterPanel view={config.view} filter={config.filter} counts={config.view.a05Counts} onChange={config.onFilter} titleId={`callout-filter-${config.pageId}`} />}
  </section>;
}

export default function DrawerMap({ page, frame, view, cell, scaleOptions, sameExtent = false, onSameExtent, onFrame, callout }: DrawerMapProps) {
  const model = view?.map ?? view?.backdrop ?? null;
  const [scaleText, setScaleText] = useState(formatScaleDenominator(model ? scaleForFrame(model, frame, scaleOptions) : 1));
  const [scaleEditing, setScaleEditing] = useState(false);
  const [scaleError, setScaleError] = useState<string | null>(null);
  const scale = useMemo(() => model ? scaleForFrame(model, frame, scaleOptions) : 1, [frame, model, scaleOptions]);
  const currentZoomDelta = model && frame.scaleDenominator !== null && Number.isFinite(frame.scaleDenominator) && frame.scaleDenominator > 0
    ? zoomForScale(frame.scaleDenominator, model, scaleOptions)
    : frame.zoomDelta;
  const locatorAvailable = hasMapData(view);

  useEffect(() => {
    if (!scaleEditing) setScaleText(formatScaleDenominator(scale));
  }, [scale, scaleEditing]);

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

  const visibleLayerCount = layers.filter((layer) => !frame.hiddenLayers.includes(layer.id)).length;
  const layerSummary = layers.length > 0 ? `${visibleLayerCount}개 켬` : "없음";
  const visibleLegendCount = legendItems.filter((item) => !frame.legend.hidden.includes(item.layer)).length;
  const legendSummary = legendItems.length > 0 ? `${visibleLegendCount}개 켬` : "없음";
  const decorationSummary = [
    frame.decorations.north ? "방위표" : null,
    frame.decorations.scaleBar ? "축척 막대" : null,
    frame.decorations.locator ? "위치도" : null,
  ].filter((item): item is string => item !== null).join(", ") || "없음";
  const movementSummary = `동 ${Math.round(frame.offsetM[0])} m, 북 ${Math.round(frame.offsetM[1])} m`;

  const submitScale = (): boolean => {
    const next = parseScaleInput(scaleText);
    if (next === null) {
      setScaleError("1:500부터 1:50,000까지 입력합니다");
      return false;
    }
    if (frame.locked) {
      setScaleText(formatScaleDenominator(scale));
      setScaleEditing(false);
      return true;
    }
    setScaleError(null);
    if (!model) {
      setScaleText(formatScaleDenominator(scale));
      setScaleEditing(false);
      return true;
    }
    setScaleText(formatScaleDenominator(next));
    setScaleEditing(false);
    onFrame(siteAnchoredZoomPatch(model, frame, scaleOptions, zoomForScale(next, model, scaleOptions), next));
    return true;
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
    <section className={`${styles.drawer} ${styles.mapDrawer}`} aria-label="지도 설정">
      <div className={`${styles.drawerHeader} ${styles.mapDrawerHeader}`}>
        <div>
          <p className={styles.eyebrow}>선택한 지도</p>
          <h2>지도 설정</h2>
        </div>
        <button
          type="button"
          className={styles.lockToggle}
          aria-pressed={frame.locked}
          aria-label="지도 위치 고정"
          title={frame.locked ? "지도 위치 고정 해제" : "지도 위치 고정"}
          onClick={() => onFrame({ locked: !frame.locked })}
        >
          고정
        </button>
      </div>

      <div className={styles.mapSettingsGroups}>
        <section className={styles.mapSection} aria-labelledby="map-scale-heading">
          <h3 id="map-scale-heading" className={styles.mapSectionTitle}>축척</h3>
          <div className={styles.scaleRow}>
            <button type="button" className={styles.iconButton} onClick={() => { if (!frame.locked && model) { setScaleError(null); onFrame(siteAnchoredZoomPatch(model, frame, scaleOptions, currentZoomDelta - 0.25, null)); } }} disabled={frame.locked} aria-label="축척 줄이기">−</button>
            <label className={styles.scaleInput}>
              <span>1:</span>
              <input value={scaleEditing ? scaleText : formatScaleDenominator(scale)} onFocus={() => { if (!frame.locked) { setScaleEditing(true); setScaleText(String(scale)); } }} onChange={(event) => { setScaleText(event.target.value); setScaleError(null); }} onBlur={() => { submitScale(); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (submitScale()) event.currentTarget.blur(); } }} inputMode="numeric" aria-label="축척 분모" disabled={frame.locked} />
            </label>
            <button type="button" className={styles.iconButton} onClick={() => { if (!frame.locked && model) { setScaleError(null); onFrame(siteAnchoredZoomPatch(model, frame, scaleOptions, currentZoomDelta + 0.25, null)); } }} disabled={frame.locked} aria-label="축척 키우기">＋</button>
          </div>
          {scaleError && <p className={styles.scaleError} role="alert">{scaleError}</p>}
          <div className={styles.presetRow}>
            {SCALE_PRESETS.map((preset) => <button type="button" key={preset} className={styles.presetButton} onClick={() => { if (!frame.locked && model) { setScaleError(null); setScaleEditing(false); setScaleText(formatScaleDenominator(preset)); onFrame(siteAnchoredZoomPatch(model, frame, scaleOptions, zoomForScale(preset, model, scaleOptions), preset)); } }} disabled={frame.locked}>1:{formatScaleDenominator(preset)}</button>)}
          </div>
        </section>

        <section className={styles.mapSection} aria-labelledby="map-basemap-heading">
          <h3 id="map-basemap-heading" className={styles.mapSectionTitle}>배경지도</h3>
          <div className={styles.basemapGrid}>
            {/* 프레임의 "기본 지도"는 늘 그려진다: 바탕 자료가 있으면 벡터, 없으면 VWorld 기본 지도(frameBasemap). 그래서 막지 않는다. */}
            {BASEMAPS.map((item) => <button key={item.value} type="button" className={frame.basemap === item.value ? styles.basemapActive : styles.basemapCell} aria-pressed={frame.basemap === item.value} onClick={() => onFrame({ basemap: item.value })}>
              <span className={`${styles.basemapPreview} ${styles["basemap" + item.value]}`} aria-hidden="true" />
              <span>{item.label}</span>
            </button>)}
          </div>
        </section>

        <section className={styles.mapSection} aria-labelledby="map-legend-placement-heading">
          <h3 id="map-legend-placement-heading" className={styles.mapSectionTitle}>범례 위치</h3>
          <div className={styles.legendPlacement} role="group" aria-label="범례 위치">
            {LEGEND_PLACEMENTS.map((item) => <button key={item.value} type="button" className={frame.legend.placement === item.value ? styles.legendPlacementActive : styles.legendPlacementButton} aria-pressed={frame.legend.placement === item.value} onClick={() => legend({ placement: item.value })}>{item.label}</button>)}
          </div>
        </section>

        {callout && view?.callout && <CalloutSettings config={callout} />}

        <details className={styles.mapDetails}>
          <summary className={styles.mapSummary}><span className={styles.mapSummaryText}>레이어 · {layerSummary}</span></summary>
          <div className={styles.mapDetailsBody}>
            <div className={styles.layerList}>
              {layers.map((layer) => <label key={layer.id}><input type="checkbox" checked={!frame.hiddenLayers.includes(layer.id)} onChange={() => toggleHidden(layer.id)} /><span>{layer.label}</span></label>)}
              {layers.length === 0 && <span className={styles.helper}>이 지도에는 선택할 레이어가 없습니다.</span>}
            </div>
            {frame.deletedElementKeys.length > 0 && <div className={styles.deletedElementsRow}>
              <span>지운 요소 {frame.deletedElementKeys.length}개</span>
              <button type="button" className={styles.deletedElementsRestore} onClick={() => onFrame({ deletedElementKeys: [] })}>모두 되살리기</button>
            </div>}
          </div>
        </details>

        <details className={styles.mapDetails}>
          <summary className={styles.mapSummary}><span className={styles.mapSummaryText}>지번 라벨 · {labelRuleSummary(frame.labelRule)}</span></summary>
          <div className={styles.mapDetailsBody}>
            <div className={styles.radioList}>
              {LABEL_RULES.map((rule) => <label key={rule.value}><input type="radio" name={`label-rule-${page.id}-${cell ?? "page"}`} checked={frame.labelRule === rule.value} onChange={() => onFrame({ labelRule: rule.value })} /><span>{rule.label}</span></label>)}
            </div>
          </div>
        </details>

        <details className={styles.mapDetails}>
          <summary className={styles.mapSummary}><span className={styles.mapSummaryText}>범례 항목 · {legendSummary}</span></summary>
          <div className={styles.mapDetailsBody}>
            <div className={styles.legendEditList}>
              {legendItems.map((item, index) => <div className={styles.legendEditRow} key={`${item.layer}|${item.label}`} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/report-legend", item.layer); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData("text/report-legend"); if (source) moveLegendTo(source, item.layer); }}>
                <span className={styles.legendDragHandle} aria-label={`${item.label} 순서 이동`} title="끌어서 순서 변경">⋮⋮</span>
                <label><input type="checkbox" checked={!frame.legend.hidden.includes(item.layer)} onChange={() => toggleLegendHidden(item.layer)} /><span>{item.label}</span></label>
                <span className={styles.legendMoveButtons}><button type="button" className={styles.tinyButton} disabled={index === 0} onClick={() => moveLegend(item.layer, -1)} aria-label={`${item.label} 위로`}>↑</button><button type="button" className={styles.tinyButton} disabled={index === legendItems.length - 1} onClick={() => moveLegend(item.layer, 1)} aria-label={`${item.label} 아래로`}>↓</button></span>
              </div>)}
            </div>
            <label className={styles.switchRow}><input type="checkbox" checked={frame.legend.visibleOnly} onChange={(event) => legend({ visibleOnly: event.target.checked })} /><span>보이는 것만</span></label>
          </div>
        </details>

        <details className={styles.mapDetails}>
          <summary className={styles.mapSummary}><span className={styles.mapSummaryText}>장식 · {decorationSummary}</span></summary>
          <div className={styles.mapDetailsBody}>
            <div className={styles.layerList}>
              <label><input type="checkbox" checked={frame.decorations.north} onChange={() => toggleDecoration("north")} /><span>방위표</span></label>
              <label><input type="checkbox" checked={frame.decorations.scaleBar} onChange={() => toggleDecoration("scaleBar")} /><span>축척 막대</span></label>
              <label><input type="checkbox" checked={frame.decorations.locator} disabled={!locatorAvailable} onChange={() => toggleDecoration("locator")} /><span>위치도 (넓은 범위에 대지 표시)</span></label>
            </div>
            {!locatorAvailable && <p className={styles.disabledReason}>위치도는 대지 중심과 분석 반경 데이터가 필요해 현재 사용할 수 없습니다.</p>}
          </div>
        </details>

        <details className={styles.mapDetails}>
          <summary className={styles.mapSummary}><span className={styles.mapSummaryText}>중심 이동 · {movementSummary}</span></summary>
          <div className={styles.mapDetailsBody}>
            <div className={styles.numberGrid}>
              <label><span>동쪽 이동(m)</span><input type="number" value={Math.round(frame.offsetM[0])} disabled={frame.locked} onChange={(event) => onFrame({ offsetM: [Number(event.target.value) || 0, frame.offsetM[1]] })} /></label>
              <label><span>북쪽 이동(m)</span><input type="number" value={Math.round(frame.offsetM[1])} disabled={frame.locked} onChange={(event) => onFrame({ offsetM: [frame.offsetM[0], Number(event.target.value) || 0] })} /></label>
            </div>
            <div className={styles.inlineActions}>
              <button type="button" className={styles.secondaryButton} disabled={frame.locked} onClick={() => onFrame(model ? siteFitPatch(model, frame, scaleOptions) : {})}>대지 맞춤</button>
              <button type="button" className={styles.secondaryButton} disabled={frame.locked} onClick={() => onFrame({ zoomDelta: -1, offsetM: [0, 0], scaleDenominator: null })}>반경 전체</button>
            </div>
          </div>
        </details>

        {page.kind === "compare" && onSameExtent && <details className={styles.mapDetails}>
          <summary className={styles.mapSummary}><span className={styles.mapSummaryText}>같은 위치·확대 · {sameExtent ? "적용" : "해제"}</span></summary>
          <div className={styles.mapDetailsBody}>
            <label className={styles.switchRow}><input type="checkbox" checked={sameExtent} onChange={(event) => onSameExtent(event.target.checked)} /><span>같은 위치·확대 적용</span></label>
          </div>
        </details>}
      </div>
    </section>
  );
}

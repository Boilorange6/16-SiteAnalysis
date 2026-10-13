"use client";

import { createContext, memo, useCallback, useContext, useEffect, useRef, useState } from "react";
import { buildingStyleForRaster, legendItemsForModel, normalizeLegendStripLabels, RASTER_STYLES, type MapModel } from "@/lib/v2/ui/map-layers";
import { catalogEntry } from "@/lib/v2/ui/tile-catalog";
import { activeLegendLabel, appendUniqueLegendItems, mapLegendStripVisible, toggleLegendPin } from "@/lib/v2/ui/map-legend";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { applyView, framedViewport, maxZoomFor, metersPerPixel, scaleBar, tileUrl, tilesFor } from "@/lib/v2/ui/map-projection";
import { inflateRaster, paintRaster, rasterLegendColor, rasterLegendEntries, rasterLegendTitle, resolveRasterStyle } from "@/lib/v2/ui/raster-image";
import MapFigure, { type MapFigureElementPick, type MapFigureProps } from "./map-figure";
import { MapLegendStrip, type LegendSwatchKind, type MapLegendItem } from "./map-legend-strip";
import { MapControls } from "./map-controls";
import { useMapView, type MapTouchPan, type MapWheelMode } from "./use-map-view";
import styles from "./board.module.css";

/** 보드가 고른 배경지도 종류. 카드·상세·요약의 모든 지도가 같이 따른다. */
export const BasemapContext = createContext<BasemapChoice>("white");
/** 상세 화면 위쪽 전환 버튼이 보드의 배경지도를 바꾼다 */
export const SetBasemapContext = createContext<(b: BasemapChoice) => void>(() => {});

type Box = NonNullable<MapFigureProps["avoid"]>;
/** avoid·siteX는 실측 크기를 받아 계산하는 함수도 받는다 */
type InteractionOpts = Pick<MapFigureProps, "pinnedKeys" | "onFeatureClick" | "hoverKey" | "emphasisKey"> & {
  onFeaturePin?: (feature: MapFigureElementPick) => void;
};
type Opts = Pick<MapFigureProps, "legend" | "legendY" | "north" | "scale" | "credit" | "bottomInset" | "muted" | "rightInset" | "scaleLeft" | "fill" | "scaleX" | "siteY"> & InteractionOpts & {
  avoid?: Box | ((w: number, h: number) => Box);
  siteX?: number | ((w: number) => number);
  /** 반경 원 위아래 여백(px): 지도 높이에서 fill을 정한다(카드). fill보다 우선 */
  pad?: number;
  mapInteractive?: boolean;
  mapWheel?: MapWheelMode;
  mapTouchPan?: MapTouchPan;
  /** 카드 타일은 기본 false, 상세·발표는 생략하면 true */
  showLegendStrip?: boolean;
};
type Opts2 = Omit<Opts, "rightInset"> & { rightInset?: number | ((w: number) => number) };

export const BASEMAPS: Array<{ id: BasemapChoice; label: string }> = [
  { id: "white", label: "일반지도" },
  { id: "Base", label: "도로" },
  { id: "Satellite", label: "항공" },
];

/** 항공 영상 위의 VWorld POI 글자 레이어를 제외하고 우리 표기만 남긴다. */
export const satelliteTileHref = (url: string): string | undefined => (url.includes("/Hybrid/") ? undefined : url);

/**
 * 부모 크기에 맞춰 MapFigure를 그린다 (반경 원은 항상 높이의 80%).
 * 화면 밖 카드는 가까이 올 때까지 그리지 않는다 (보드 12장 × 배경 타일).
 */
/** 부모를 채우는 상자의 실측 크기와 "화면에 가까워졌는가". 서버에서는 크기를 모르고 부동소수 결과도 브라우저와 미세하게 달라, 마운트 뒤 실측 크기로만 그린다. */
export function useMeasured() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    // 스크롤 컨테이너(보드 root) 기준으로 가까워지면 한 번 켠다
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "400px" });
    if (io) io.observe(el);
    else setNear(true);
    return () => {
      ro.disconnect();
      io?.disconnect();
    };
  }, []);
  return { ref, size, near };
}

function rasterBoundary(value: number, palette: string): string {
  if (palette === "svf") return `${Math.round(value * 100)}%`;
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/** MapFigure와 같은 선택 래스터를 지도 아래 범례 띠로 옮긴다. */
function rasterLegendItemsForModel(model: MapModel): MapLegendItem[] {
  const raster = model.rasters?.[0];
  const baseStyle = raster ? RASTER_STYLES[raster.palette] : undefined;
  if (!raster || !baseStyle) return [];
  const style = resolveRasterStyle(raster, baseStyle);
  const title = rasterLegendTitle(raster, style);
  if (style.mode === "continuous") {
    const range = style.min !== undefined && style.max !== undefined
      ? ` · ${rasterBoundary(style.min, raster.palette)}~${rasterBoundary(style.max, raster.palette)}`
      : "";
    return [{
      layer: `raster:${raster.name}`,
      id: `raster:${raster.name}:continuous`,
      label: `${title}${range}`,
      color: style.colors[0] ?? "#43566B",
      colors: style.colors,
      swatch: "raster",
      static: true,
    }];
  }
  if (style.mode === "mask") {
    return [{
      layer: `raster:${raster.name}`,
      id: `raster:${raster.name}:mask`,
      label: title,
      color: style.colors[0] ?? "#43566B",
      swatch: "raster",
      static: true,
    }];
  }
  const entries = rasterLegendEntries(raster, style, model.legend ?? []);
  return entries.map((entry, index) => ({
    layer: `raster:${raster.name}`,
    id: `raster:${raster.name}:step-${index}`,
    label: entry.label,
    color: rasterLegendColor(raster, style, entry) ?? style.colors[index] ?? "#43566B",
    swatch: "raster" as const,
    static: true,
  }));
}

function MapBox({ model, bare, label, avoid, siteX, rightInset, pad, mapInteractive = true, mapWheel = "plain", mapTouchPan = "one", showLegendStrip = true, ...optsIn }: { model: MapModel; bare?: boolean; label?: string } & Opts2) {
  const { ref, size, near } = useMeasured();
  const opts = { ...optsIn, fill: pad && size ? Math.max(0.3, (size.h - 2 * pad) / size.h) : optsIn.fill };
  const layer = useContext(BasemapContext);
  const requestedLayer = model.basemap ?? layer;
  const resolvedSiteX = size ? (typeof siteX === "function" ? siteX(size.w) : (siteX ?? 0.5)) : 0.5;
  const baseViewport = size ? framedViewport(model.center, model.radiusM, size.w, size.h, resolvedSiteX, opts.fill ?? 0.8, opts.siteY ?? 0.5) : undefined;
  const maxZoom = baseViewport ? maxZoomFor(baseViewport, catalogEntry(model.tileCode ?? "").mapZoom, model.rasters?.[0]?.cellM) : 0;
  const resetKey = `${model.analysisId ?? ""}:${model.tileCode ?? ""}:${model.center[0]}:${model.center[1]}:${model.radiusM}`;
  const controller = useMapView({ baseViewport, radiusM: model.radiusM, maxZoom, resetKey, enabled: mapInteractive && !opts.muted, wheel: mapWheel, touchPan: mapTouchPan });
  const setViewportRef = useCallback((element: HTMLDivElement | null) => {
    ref.current = element;
    controller.bind.ref(element);
  }, [controller.bind, ref]);
  const [fallbackLayer, setFallbackLayer] = useState<BasemapChoice | null>(null);
  const [rasterHrefs, setRasterHrefs] = useState<Record<string, string>>({});
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const [legendPinned, setLegendPinned] = useState<string | null>(null);
  const [featureHover, setFeatureHover] = useState<string | null>(null);
  const activeHighlight = activeLegendLabel(legendHover, legendPinned);
  const toggleLegend = (label: string) => {
    setLegendHover(null);
    setLegendPinned((current) => toggleLegendPin(current, label));
  };
  const clearInteraction = () => {
    setLegendHover(null);
    setLegendPinned(null);
    setFeatureHover(null);
  };
  useEffect(() => {
    if (!activeHighlight && !featureHover) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      clearInteraction();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeHighlight, featureHover]);
  useEffect(() => {
    let alive = true;
    setFallbackLayer(null);
    // D01은 결과가 지정한 Satellite를 유지한다. 사용자가 고른 넓은 항공 지도만
    // 일부 타일 결손 시 도로 지도로 대체해 회색 빈 칸을 피한다.
    if (!near || !size || requestedLayer !== "Satellite" || model.basemap === "Satellite" || model.radiusM < 1000) return () => { alive = false; };
    const viewport = applyView(framedViewport(model.center, model.radiusM, size.w, size.h, resolvedSiteX, opts.fill ?? 0.8, opts.siteY ?? 0.5), model.center[1], controller.view);
    const tiles = tilesFor(viewport).slice(0, 6);
    void Promise.all(tiles.map((tile) => fetch(tileUrl("Satellite", tile.z, tile.x, tile.y), { cache: "force-cache" }).then((response) => response.ok).catch(() => false))).then((ok) => {
      if (alive && ok.length > 0 && ok.some((value) => !value)) setFallbackLayer("Base");
    });
    return () => { alive = false; };
  }, [controller.view, model.basemap, model.center, model.radiusM, near, requestedLayer, size, resolvedSiteX, opts.fill, opts.siteY]);
  useEffect(() => {
    let alive = true;
    const rasters = model.rasters ?? [];
    setRasterHrefs({});
    if (!near || !model.analysisId || !model.tileCode || rasters.length === 0) return () => { alive = false; };
    void Promise.all(
      rasters.map(async (raster) => {
        const style = RASTER_STYLES[raster.palette];
        if (!style) return null;
        try {
          const response = await fetch(`/site/api/v2/analyses/${encodeURIComponent(model.analysisId!)}/tiles/${encodeURIComponent(model.tileCode!)}/rasters/${encodeURIComponent(raster.name)}`);
          if (!response.ok) return null;
          const values = await inflateRaster(raster, await response.arrayBuffer());
          return [raster.name, paintRaster(raster, values, style)] as const;
        } catch {
          return null;
        }
      }),
    ).then((items) => {
      if (!alive) return;
      setRasterHrefs(Object.fromEntries(items.filter((item): item is readonly [string, string] => item !== null)));
    });
    return () => {
      alive = false;
    };
  }, [model.analysisId, model.tileCode, model.rasters, near]);
  const renderLayer = fallbackLayer ?? requestedLayer;
  const renderModel = fallbackLayer ? { ...model, basemap: fallbackLayer } : model;
  const activeRasterName = model.rasters?.[0]?.name;
  const hasDecodedActiveRaster = !!activeRasterName && !!rasterHrefs[activeRasterName];
  const swatchKind = (layerName: string): LegendSwatchKind => {
    if (model.lines?.some((line) => line.layer === layerName)) return "line";
    if (model.polygons?.some((polygon) => polygon.layer === layerName)) return "polygon";
    return "point";
  };
  const rawLegendItems: MapLegendItem[] = !bare && opts.legend === false
    ? appendUniqueLegendItems<MapLegendItem>(
        [
          ...(!opts.muted ? [{ layer: "__site_marker", label: "대지", color: "#111", count: 1, site: true as const, swatch: "site" as const }] : []),
          ...legendItemsForModel(model)
            .filter((item) => item.layer !== "parcel_site" && item.layer !== "pnu")
            .map((item) => {
              const swatchStyle = buildingStyleForRaster(item.layer, hasDecodedActiveRaster);
              return {
                ...item,
                site: false as const,
                swatch: swatchKind(item.layer),
                ...(swatchStyle.fill ? { fill: swatchStyle.fill } : {}),
                ...(swatchStyle.stroke ? { stroke: swatchStyle.stroke } : {}),
                ...(swatchStyle.fillOpacity !== undefined ? { fillOpacity: swatchStyle.fillOpacity } : {}),
                ...(swatchStyle.strokeWidth !== undefined ? { strokeWidth: swatchStyle.strokeWidth } : {}),
                ...(swatchStyle.hatch ? { hatch: true } : {}),
              };
            }),
        ],
        rasterLegendItemsForModel(model),
      )
    : [];
  const legendPresentation = normalizeLegendStripLabels(rawLegendItems);
  const legendItems = legendPresentation.items;
  const useLegendStrip = mapLegendStripVisible({ bare, legend: opts.legend, muted: opts.muted, itemCount: legendItems.length, showLegendStrip });
  // 상세 창의 출처 띠는 MapBox 바깥에 겹쳐 있으므로, 범례가 그 위에서 끝나게 한다.
  // 범례를 띠로 옮긴 뒤에는 MapFigure에 같은 inset을 다시 예약하지 않는다.
  const mapBottomInset = useLegendStrip ? (opts.bottomInset ?? 0) : 0;
  const scale = size
    ? (() => {
        const viewport = applyView(framedViewport(model.center, model.radiusM, size.w, size.h, resolvedSiteX, opts.fill ?? 0.8, opts.siteY ?? 0.5), model.center[1], controller.view);
        const u = Math.min(1.5, Math.max(1, size.h / 360));
        return scaleBar(metersPerPixel(model.center[1], viewport.zoom), 88 * u);
      })()
    : null;
  const mapSurfaceContent = (
    <>
      {size && near && (
        <div className={styles.mapPreview} style={controller.previewTransform}>
          <MapFigure
            model={renderModel}
            width={size.w}
            height={size.h}
            bare={bare}
            label={label}
            layer={renderLayer}
            tileHref={renderLayer === "Satellite" ? satelliteTileHref : undefined}
            rasterHref={(raster) => rasterHrefs[raster.name] ?? null}
            avoid={typeof avoid === "function" ? avoid(size.w, size.h) : avoid}
            siteX={typeof siteX === "function" ? siteX(size.w) : siteX}
            rightInset={typeof rightInset === "function" ? rightInset(size.w) : rightInset}
            {...opts}
            scaleLeft={pad !== undefined || !!opts.scaleLeft}
            view={controller.view}
            dragging={controller.dragging}
            highlightLabel={activeHighlight}
            highlightPinnedLabel={legendPinned}
            hoverKey={opts.hoverKey ?? featureHover}
            emphasisKey={opts.emphasisKey ?? null}
            onFeatureHover={(key) => { if (!controller.dragging) setFeatureHover(key); }}
            onLegendHover={(value) => setLegendHover(value)}
            onLegendPin={(value) => setLegendPinned((current) => value === null ? null : toggleLegendPin(current, value))}
            bottomInset={useLegendStrip ? 0 : opts.bottomInset}
          />
        </div>
      )}
      {size && near && <MapControls controller={controller} disabled={!mapInteractive || !!opts.muted} className={pad !== undefined ? styles.mapControlsCard : styles.mapControlsExpanded} resetVariant={pad !== undefined ? "icon" : "label"} />}
      {size && near && scale && scale.meters >= 1000 && opts.legend !== false && (
        <span aria-label={`지도 축척 ${scale.label}`} style={{ position: "absolute", zIndex: 3, top: 44, right: 8, padding: "4px 7px", borderRadius: 999, background: "rgba(255,255,255,.92)", color: "#16181d", fontSize: 10, lineHeight: 1.2, fontWeight: 700, boxShadow: "0 1px 3px rgba(21,23,28,.12)" }}>
          축척 {scale.label}
        </span>
      )}
      {size && near && fallbackLayer && (
        <span role="status" style={{ position: "absolute", zIndex: 3, left: 8, ...(opts.legend === false ? { top: 8 } : { bottom: (opts.bottomInset ?? 0) + 7 }), padding: "3px 7px", borderRadius: 999, background: "rgba(255,255,255,.92)", color: "#7A3E12", fontSize: 10, lineHeight: 1.2, fontWeight: 700 }}>
          항공 타일 결손 · 일반지도
        </span>
      )}
    </>
  );
  if (useLegendStrip) {
    return (
      <div data-map-box-root="true" style={{ position: "absolute", top: 0, right: 0, bottom: mapBottomInset, left: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div data-map-viewport="true" {...controller.bind} ref={setViewportRef} style={{ ...controller.bind.style, position: "relative", flex: "1 1 auto", minHeight: 0, width: "100%" }}>
          {mapSurfaceContent}
        </div>
        {size && near && <MapLegendStrip items={legendItems} hoverLabel={legendHover} pinnedLabel={legendPinned} onHover={setLegendHover} onToggle={toggleLegend} leadingLabel={legendPresentation.leadingLabel} />}
      </div>
    );
  }
  return (
    <div data-map-viewport="true" {...controller.bind} ref={setViewportRef} style={{ ...controller.bind.style, position: "absolute", inset: 0 }}>
      {mapSurfaceContent}
    </div>
  );
}

export default memo(MapBox);

"use client";

import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { compactLegendItems, RASTER_STYLES, type MapModel } from "@/lib/v2/ui/map-layers";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { framedViewport, metersPerPixel, scaleBar, tileUrl, tilesFor } from "@/lib/v2/ui/map-projection";
import { inflateRaster, paintRaster } from "@/lib/v2/ui/raster-image";
import MapFigure, { type MapFigureElementPick, type MapFigureProps } from "./map-figure";
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

function MapBox({ model, bare, label, avoid, siteX, rightInset, pad, ...optsIn }: { model: MapModel; bare?: boolean; label?: string } & Opts2) {
  const { ref, size, near } = useMeasured();
  const opts = { ...optsIn, fill: pad && size ? Math.max(0.3, (size.h - 2 * pad) / size.h) : optsIn.fill };
  const layer = useContext(BasemapContext);
  const requestedLayer = model.basemap ?? layer;
  const [fallbackLayer, setFallbackLayer] = useState<BasemapChoice | null>(null);
  const [rasterHrefs, setRasterHrefs] = useState<Record<string, string>>({});
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const [legendPinned, setLegendPinned] = useState<string | null>(null);
  const [featureHover, setFeatureHover] = useState<string | null>(null);
  const [legendMoreOpen, setLegendMoreOpen] = useState(false);
  const legendPointerType = useRef<string | null>(null);
  const legendMoreRef = useRef<HTMLButtonElement>(null);
  const legendWrapRef = useRef<HTMLDivElement>(null);
  const activeHighlight = legendHover ?? legendPinned;
  const toggleLegend = (label: string) => {
    setLegendHover(null);
    setLegendPinned((current) => current === label ? null : label);
  };
  const clearInteraction = () => {
    setLegendHover(null);
    setLegendPinned(null);
    setFeatureHover(null);
    setLegendMoreOpen(false);
  };
  useEffect(() => {
    if (!legendMoreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!legendWrapRef.current?.contains(event.target as Node)) setLegendMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [legendMoreOpen]);
  useEffect(() => {
    if (!activeHighlight && !featureHover && !legendMoreOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      clearInteraction();
      legendMoreRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeHighlight, featureHover, legendMoreOpen]);
  useEffect(() => {
    let alive = true;
    setFallbackLayer(null);
    // D01은 결과가 지정한 Satellite를 유지한다. 사용자가 고른 넓은 항공 지도만
    // 일부 타일 결손 시 도로 지도로 대체해 회색 빈 칸을 피한다.
    if (!near || !size || requestedLayer !== "Satellite" || model.basemap === "Satellite" || model.radiusM < 1000) return () => { alive = false; };
    const resolvedSiteX = typeof siteX === "function" ? siteX(size.w) : (siteX ?? 0.5);
    const viewport = framedViewport(model.center, model.radiusM, size.w, size.h, resolvedSiteX, opts.fill ?? 0.8, opts.siteY ?? 0.5);
    const tiles = tilesFor(viewport).slice(0, 6);
    void Promise.all(tiles.map((tile) => fetch(tileUrl("Satellite", tile.z, tile.x, tile.y), { cache: "force-cache" }).then((response) => response.ok).catch(() => false))).then((ok) => {
      if (alive && ok.length > 0 && ok.some((value) => !value)) setFallbackLayer("Base");
    });
    return () => { alive = false; };
  }, [model.basemap, model.center, model.radiusM, near, requestedLayer, size, siteX, opts.fill, opts.siteY]);
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
  // 카드 범례: 왼쪽 아래 한 줄 알약. 축척 막대(오른쪽 아래) 앞까지 들어가는 만큼만 보이고 나머지는 "+n".
  const allLegend = !bare && opts.legend === false
    ? [
        ...(!opts.muted ? [{ layer: "__site_marker", label: "대지", color: "#111", count: 1, order: -1, site: true as const }] : []),
        ...compactLegendItems(model, 99)
          .filter((item) => item.layer !== "parcel_site" && item.layer !== "pnu")
          .map((item) => ({ ...item, site: false as const })),
      ]
    : [];
  const legendRoom = size ? size.w - 8 - 112 - 40 : 0;
  let fitted = 0;
  for (let used = 0, i = 0; i < Math.min(3, allLegend.length); i++) {
    used += 18 + [...allLegend[i]!.label].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 11 : 6.4), 0);
    if (used > legendRoom) break;
    fitted = i + 1;
  }
  const compactItems = allLegend.slice(0, Math.max(1, fitted));
  const legendMore = allLegend.length - compactItems.length;
  const mapHasCompactLegend = compactItems.length > 0;
  // 래스터 범례(SVG 알약)가 같은 자리를 쓰면 그 위로 올린다
  const legendBottom = model.rasters?.length ? 38 : 8;
  const scale = size
    ? (() => {
        const resolvedSiteX = typeof siteX === "function" ? siteX(size.w) : (siteX ?? 0.5);
        const viewport = framedViewport(model.center, model.radiusM, size.w, size.h, resolvedSiteX, opts.fill ?? 0.8, opts.siteY ?? 0.5);
        const u = Math.min(1.5, Math.max(1, size.h / 360));
        return scaleBar(metersPerPixel(model.center[1], viewport.zoom), 88 * u);
      })()
    : null;
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      {size && near && (
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
          highlightLabel={activeHighlight}
          highlightPinnedLabel={legendPinned}
          hoverKey={opts.hoverKey ?? featureHover}
          emphasisKey={opts.emphasisKey ?? null}
          onFeatureHover={(key) => setFeatureHover(key)}
          onLegendHover={(value) => setLegendHover(value)}
          onLegendPin={(value) => setLegendPinned((current) => value === null ? null : current === value ? null : value)}
        />
      )}
      {size && near && mapHasCompactLegend && (
        <div ref={legendWrapRef} role="group" aria-label="범례" style={{ position: "absolute", zIndex: 4, bottom: legendBottom, left: 8, maxWidth: "calc(100% - 128px)", display: "flex", alignItems: "center", gap: 5, padding: "2px 5px", borderRadius: 999, background: "rgba(255,255,255,.94)", color: "#16181d", fontSize: 11, lineHeight: 1.3, whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(21,23,28,.12)" }}>
          {compactItems.map((item) => item.site ? (
            <span className={styles.mapLegendStatic} key={item.layer} aria-hidden>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false">
                <rect x="1.8" y="1.8" width="6.4" height="6.4" fill="#fff" stroke="#111" strokeWidth="1" transform="rotate(45 5 5)" />
                <circle cx="5" cy="5" r="1.2" fill="#111" />
              </svg>
              {item.label}
            </span>
          ) : (
            <button data-map-legend={item.label} className={styles.mapLegendButton} key={item.layer} type="button" aria-label={`${item.label} 범례 강조`} aria-pressed={legendPinned === item.label} onClick={() => toggleLegend(item.label)} onPointerDown={(event) => { legendPointerType.current = event.pointerType; }} onPointerEnter={(event) => { legendPointerType.current = event.pointerType; if (event.pointerType !== "touch") setLegendHover(item.label); }} onPointerLeave={() => { legendPointerType.current = null; setLegendHover(null); }} onFocus={() => { if (legendPointerType.current !== "touch") setLegendHover(item.label); }} onBlur={() => { legendPointerType.current = null; setLegendHover(null); }} style={{ borderColor: activeHighlight === item.label ? "#111" : "transparent", background: activeHighlight === item.label ? "#eef0f3" : "transparent" }}>
              <i aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: item.color, border: "1px solid rgba(21,23,28,.35)" }} />
              {item.label}
            </button>
          ))}
          {legendMore > 0 && <button className={styles.mapLegendMore} ref={legendMoreRef} type="button" aria-label={`전체 범례 ${legendMore}개 더 보기`} aria-expanded={legendMoreOpen} onClick={() => setLegendMoreOpen((open) => !open)}>+{legendMore}</button>}
          {legendMoreOpen && <div role="dialog" aria-label="전체 범례" style={{ position: "absolute", left: 0, bottom: 34, minWidth: 180, maxWidth: "min(280px, calc(100vw - 24px))", display: "grid", gap: 2, padding: 6, border: "1px solid #c9ccd2", borderRadius: 10, background: "#fff", boxShadow: "0 6px 20px rgba(0,0,0,.14)" }}>
            {allLegend.map((item) => item.site ? (
              <span className={styles.mapLegendStatic} key={`all-${item.layer}`} aria-hidden>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden focusable="false"><rect x="2.2" y="2.2" width="7.6" height="7.6" fill="#fff" stroke="#111" strokeWidth="1" transform="rotate(45 6 6)" /><circle cx="6" cy="6" r="1.3" fill="#111" /></svg>
                <span>{item.label}</span><span style={{ marginLeft: "auto", color: "#676c76", fontVariantNumeric: "tabular-nums" }}>{item.count}</span>
              </span>
            ) : (
              <button data-map-legend={item.label} className={styles.mapLegendButton} key={`all-${item.layer}`} type="button" aria-label={`${item.label} 범례 강조`} aria-pressed={legendPinned === item.label} onClick={() => toggleLegend(item.label)} onPointerDown={(event) => { legendPointerType.current = event.pointerType; }} onPointerEnter={(event) => { legendPointerType.current = event.pointerType; if (event.pointerType !== "touch") setLegendHover(item.label); }} onPointerLeave={() => { legendPointerType.current = null; setLegendHover(null); }} onFocus={() => { if (legendPointerType.current !== "touch") setLegendHover(item.label); }} onBlur={() => { legendPointerType.current = null; setLegendHover(null); }} style={{ display: "flex", width: "100%", minHeight: 36, padding: "4px 8px", border: 0, borderRadius: 6, background: activeHighlight === item.label ? "#eef0f3" : "transparent", color: "#15171c", textAlign: "left" }}>
                <i aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, border: "1px solid rgba(21,23,28,.35)" }} />
                <span>{item.label}</span><span style={{ marginLeft: "auto", color: "#676c76", fontVariantNumeric: "tabular-nums" }}>{item.count}</span>
              </button>
            ))}
          </div>}
        </div>
      )}
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
    </div>
  );
}

export default memo(MapBox);

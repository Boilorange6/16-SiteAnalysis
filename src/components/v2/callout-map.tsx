"use client";

import { Fragment, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { OTHER_HOUSING_COLOR, OTHER_HOUSING_LABEL, STRIP_H, calloutLegendMatches, cardName, cardRows, clusterPoints, compactCalloutLegend, compactNameNeedsExtraHeight, displayComplexName, dotColor, dotRadius, fmtInt, inkOn, isHollowComplexMarker, overlapChip, pageCount, pageRange, stripCards, type CalloutFrame, type Complex, type Placed, type StripCard } from "@/lib/v2/ui/callout-layout";
import { calloutScene, type CalloutFrameKind } from "@/lib/v2/ui/callout-scene";
import { OV } from "@/lib/v2/ui/overlay-layout";
import { applyView, framedViewport, maxZoomFor, metersPerPixel, scaleBar } from "@/lib/v2/ui/map-projection";
import type { CalloutModel } from "@/lib/v2/ui/tile-view";
import { UNIT_TYPE_BASIS } from "@/lib/v2/unit-types";
import MapFigure from "./map-figure";
import { MapLegendStrip, type MapLegendItem } from "./map-legend-strip";
import { BasemapContext, satelliteTileHref, useMeasured } from "./map-box";
import styles from "./board.module.css";
import tileStyles from "@/lib/v2/tile/a05/tile.module.css";
import UnitTypeSummary from "./unit-type-summary";
import { MapControls } from "./map-controls";
import { useMapView, type MapTouchPan, type MapWheelMode } from "./use-map-view";

const INK = "#16181d";

function Card({ c, siblings, p, frame, year, hover, dim, onHover, onPick }: { c: Complex; siblings: readonly Complex[]; p: Placed; frame: CalloutFrame; year: number; hover: boolean; dim?: boolean; onHover: (id: string | null) => void; onPick: (id: string) => void }) {
  const color = dotColor(c);
  const rows = cardRows(c, year);
  const full = frame.variant === "full";
  const chip = overlapChip(c);
  const nameWrap = compactNameNeedsExtraHeight(c, siblings, frame.cardW);
  const typeRow = c.supply ? rows[2] : rows[1];
  return (
    <div
      className={`${styles.plate} ${tileStyles.cCard} ${hover ? tileStyles.cCardOn : ""}`}
      role="group"
      aria-label={`${c.rank}번 ${cardName(c)}`}
      data-narrow={frame.cardW < 112 ? "true" : undefined}
      style={{ left: p.x, top: p.y, width: frame.cardW, height: frame.cardH, opacity: dim ? 0.2 : 1 }}
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPick(c.id)}
    >
      <div className={tileStyles.cHead} data-compact={!full || undefined} data-name-wrap={nameWrap ? "true" : undefined}>
        <span className={tileStyles.cNum} style={{ background: isHollowComplexMarker(c) ? "transparent" : color, color: isHollowComplexMarker(c) ? color : inkOn(color), borderColor: color }}>
          {c.rank}
        </span>
        <span className={`${tileStyles.cName} ${c.name ? "" : tileStyles.cMissing}`} title={cardName(c)}>
          {displayComplexName(c, siblings)}
        </span>
        {chip && (
          <span className={tileStyles.cChip} title={chip}>
            {full ? chip : "중복"}
          </span>
        )}
      </div>
      {full ? (
        <ul className={tileStyles.cRows}>
          {rows.map((r) => (
            <li key={r.label} data-unit-type={r.unitType || undefined}>
              <span>{r.label}</span>
              <b className={r.missing ? tileStyles.cMissing : undefined} title={r.value}>
                {r.unitType ? <UnitTypeSummary value={r.value} pairClassName={styles.cTypePair} /> : r.value}
              </b>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className={tileStyles.cSub} style={c.supply ? { paddingLeft: 10 } : undefined}>
            {c.supply ? (
              <>
                <span className={c.supply.plannedMonth === null ? tileStyles.cMissing : undefined}>{c.supply.plannedMonth ? c.supply.plannedMonth.replace("-", ".") : "일정 확인필요"}</span>
                <span className={rows[1].missing ? tileStyles.cMissing : tileStyles.cYear}>{rows[1].value}</span>
              </>
            ) : (
              <>
                <span className={rows[0].missing ? tileStyles.cMissing : undefined}>{rows[0].value}</span>
                {c.approvalYear !== null && frame.cardW >= 112 && <span className={tileStyles.cYear}>{c.approvalYear}</span>}
              </>
            )}
          </div>
          <div className={tileStyles.cTypeLine} title={`${typeRow.value} · ${UNIT_TYPE_BASIS}`}>
            <span>타입</span>
            <b className={typeRow.missing ? tileStyles.cMissing : undefined}>{typeRow.value}</b>
          </div>
        </>
      )}
    </div>
  );
}

/** 범례: A05 준공 연대 / A06 입주 시기 색 + 크기 = 세대·호실 */
export function CalloutLegend({ model, compact = false, style, activeLabel = null, pinnedLabel = null, onHover, onPin }: { model: CalloutModel; compact?: boolean; style?: React.CSSProperties; activeLabel?: string | null; pinnedLabel?: string | null; onHover?: (label: string | null) => void; onPin?: (label: string | null) => void }) {
  const items = compact ? compactCalloutLegend(model.legend, model.complexes, 3) : model.legend.items;
  const legendPointerType = useRef<string | null>(null);
  return (
    <div className={`${styles.plate} ${tileStyles.cLegend}`} style={style} role="group" aria-label={compact ? `범례 ${items.length}색` : "범례"}>
      {!compact && <span className={tileStyles.cLegendT}>{model.legend.title}</span>}
      {items.map((it) => {
        const active = activeLabel === it.label;
        const content = <><i style={{ background: it.hollow ? "transparent" : it.color, borderColor: it.color }} />{it.label}</>;
        if (!onHover && !onPin) return <span key={it.label} className={tileStyles.cLegendI}>{content}</span>;
        return (
          <button
            key={it.label}
            type="button"
            className={tileStyles.cLegendI}
            data-active={active || undefined}
            aria-label={`${it.label} 범례 강조`}
            aria-pressed={pinnedLabel === it.label}
            onClick={() => { onHover?.(null); onPin?.(it.label); }}
            onPointerDown={(event) => { legendPointerType.current = event.pointerType; }}
            onPointerEnter={(event) => { legendPointerType.current = event.pointerType; if (event.pointerType !== "touch") onHover?.(it.label); }}
            onPointerLeave={() => { legendPointerType.current = null; onHover?.(null); }}
            onFocus={() => { if (legendPointerType.current !== "touch") onHover?.(it.label); }}
            onBlur={() => { legendPointerType.current = null; onHover?.(null); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onHover?.(null);
                onPin?.(null);
              }
            }}
          >
            {content}
          </button>
        );
      })}
      {!compact && <span className={tileStyles.cLegendT}>{model.legend.sizeLabel}</span>}
    </div>
  );
}

/** 개요 페이지 왼쪽 아래 핵심 값 카드 */
export function CalloutValueCard({ model }: { model: CalloutModel }) {
  const stat = (value: string, unit: string, label: string) => (
    <div>
      <div>
        <span className={`${styles.display} ${styles.big} ${styles.bigSmall}`}>{value}</span>
        <span className={styles.aux}>{unit}</span>
      </div>
      <div className={styles.sub}>{label}</div>
    </div>
  );
  return (
    <div className={`${styles.plate} ${styles.valueCard} ${tileStyles.cValue}`}>
      <div className={tileStyles.cValueRow}>
        {model.stats.map((s) => (
          <Fragment key={s.label}>{stat(s.value, s.unit, s.label)}</Fragment>
        ))}
      </div>
      {model.statNote && <div className={styles.sub}>{model.statNote}</div>}
    </div>
  );
}

/** 보드 카드 왼쪽 아래 한 줄 값 판 */
export function CalloutPill({ model }: { model: CalloutModel }) {
  return (
    <div className={`${styles.plate} ${tileStyles.cPill}`}>
      {model.pill.map((p) => (
        <Fragment key={p.unit}>
          <span className={`${styles.display} ${tileStyles.cPillN}`}>{p.value}</span>
          <span className={styles.aux}>{p.unit}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** 모바일 가로 띠: 번호 카드가 옆으로 밀리고, 누르면 지도의 같은 번호 점이 강조된다 */
function Strip({ cards, active, onPick, top }: { cards: StripCard[]; active: string | null; onPick: (id: string) => void; top: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const el = ref.current?.querySelector<HTMLElement>(`[data-card="${active}"]`);
    // 띠 안에서만 굴린다 (페이지 전체가 흔들리지 않게 scrollIntoView 대신 scrollTo)
    if (el && ref.current) ref.current.scrollTo({ left: el.offsetLeft - 8, behavior: "smooth" });
  }, [active]);
  return (
    <div ref={ref} className={tileStyles.cStrip} style={{ top, height: STRIP_H }} role="list" aria-label="단지 설명 카드">
      {cards.map((c) => (
        <button key={c.id} type="button" role="listitem" data-card={c.id} className={`${styles.plate} ${tileStyles.cStripCard} ${active === c.id ? tileStyles.cCardOn : ""}`} onClick={() => onPick(c.id)} aria-pressed={active === c.id}>
          <span className={tileStyles.cStripHead}>
            <span className={tileStyles.cNum} style={{ background: c.hollow ? "transparent" : c.color, color: c.hollow ? c.color : inkOn(c.color), borderColor: c.color }}>
              {c.rank}
            </span>
            <span className={`${tileStyles.cName} ${c.nameMissing ? tileStyles.cMissing : ""}`} title={c.fullName}>{c.name}</span>
            {c.chip && <span className={tileStyles.cChip}>{c.chip}</span>}
          </span>
          {c.lines.map((line, i) => <span key={i} className={`${tileStyles.cStripLine} ${i === 1 ? tileStyles.cStripType : ""}`}>{line}</span>)}
        </button>
      ))}
    </div>
  );
}

/** 페이지 넘김 칩 (‹ 개요 / 1/3 ›) */
function Pager({ model, page, onPage }: { model: CalloutModel; page: number; onPage: (p: number) => void }) {
  const pages = pageCount(model.complexes.length);
  const label = page === 0 ? "개요" : `${page} / ${pages}`;
  const supply = model.kind === "supply";
  const range =
    page === 0
      ? supply
        ? `전체 ${fmtInt(model.complexes.length)}${model.unit} · 입주 시기순`
        : `전체 ${fmtInt(model.summary.count)}단지 (아파트 ${fmtInt(model.summary.apartments)} · 오피스텔 ${fmtInt(model.summary.count - model.summary.apartments)}) · 세대수 순`
      : pageRange(page, model.complexes.length, undefined, supply);
  return (
    <div className={tileStyles.cPagerWrap}>
      <div className={`${styles.plate} ${tileStyles.cPager}`} role="group" aria-label="설명표 페이지">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0} aria-label="이전 페이지">
          ‹
        </button>
        <b aria-live="polite">{label}</b>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="다음 페이지">
          ›
        </button>
        <span className={tileStyles.cPagerRange}>{range}</span>
      </div>
    </div>
  );
}

export type CalloutMapProps = {
  model: CalloutModel;
  kind: CalloutFrameKind;
  /** 0 = 개요, 1.. = 설명표 페이지 (카드는 상위 6 고정) */
  page?: number;
  onPage?: (p: number) => void;
  label: string;
  mapInteractive?: boolean;
  mapWheel?: MapWheelMode;
  mapTouchPan?: MapTouchPan;
  resetKey?: string;
  /** 카드 전용 자동 말풍선·지시선 표시. 생략하면 상세/PPT 호환을 위해 표시. */
  showMapLabels?: boolean;
};

function calloutLegendStripItems(model: CalloutModel, compact: boolean): MapLegendItem[] {
  const items = compact ? compactCalloutLegend(model.legend, model.complexes, 3) : model.legend.items;
  return items.map((item, index) => ({
    layer: `callout:${model.kind}:${index}:${item.label}`,
    label: item.label,
    color: item.color,
    hollow: item.hollow,
    swatch: "point" as const,
  }));
}

/**
 * 주변 단지 설명선 지도 (A05, 이후 A06). 지도는 MapFigure(단지 없이), 점·지시선은 SVG, 표는 HTML 판.
 * 카드는 두 칸에만 놓이고 지도 원은 두 칸 사이에 들어가, 점이 카드에 가려지지 않는다.
 */
function CalloutMap({ model, kind, page = 0, onPage, label, mapInteractive = true, mapWheel = "plain", mapTouchPan = "one", resetKey = "", showMapLabels = true }: CalloutMapProps) {
  const { ref, size, near } = useMeasured();
  const layer = useContext(BasemapContext);
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [legendHover, setLegendHover] = useState<string | null>(null);
  const [legendPinned, setLegendPinned] = useState<string | null>(null);
  const detail = kind === "detail";
  const pages = pageCount(model.complexes.length);

  useEffect(() => {
    setPicked(null);
    setLegendHover(null);
    setLegendPinned(null);
  }, [page]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!legendHover && !legendPinned)) return;
      event.preventDefault();
      event.stopPropagation();
      setLegendHover(null);
      setLegendPinned(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [legendHover, legendPinned]);
  useEffect(() => {
    if (!detail || !onPage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && page > 0) onPage(page - 1);
      else if (e.key === "ArrowRight" && page < pages) onPage(page + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detail, onPage, page, pages]);

  // 상세 화면의 출처 띠는 부모가 지도 위에 고정하므로, 측정된 지도 영역에서는 이미 빠졌다.
  const layoutScene = useMemo(() => (size ? calloutScene(model, kind, size.w, size.h, page, 0, undefined, showMapLabels) : null), [model, kind, size, page, showMapLabels]);
  const baseViewport = size && layoutScene ? framedViewport(model.center, model.radiusM, size.w, size.h, layoutScene.frame.siteX, layoutScene.frame.fill, layoutScene.siteY) : undefined;
  const maxZoom = baseViewport ? maxZoomFor(baseViewport, { maxDelta: 2 }) : 0;
  const controller = useMapView({ baseViewport, radiusM: model.radiusM, maxZoom, resetKey, enabled: mapInteractive, wheel: mapWheel, touchPan: mapTouchPan });
  const scene = useMemo(() => (size ? calloutScene(model, kind, size.w, size.h, page, 0, controller.view, showMapLabels) : null), [controller.view, kind, model, page, size, showMapLabels]);
  const setViewportRef = useCallback((element: HTMLDivElement | null) => {
    ref.current = element;
    controller.bind.ref(element);
  }, [controller.bind, ref]);
  const clusters = useMemo(() => {
    if (!scene) return null;
    return clusterPoints(
      model.complexes.map((c) => {
        const [x, y] = scene.pos.get(c.id)!;
        return { id: c.id, x, y, radius: dotRadius(c.households, scene.hMax, scene.frame.m.rMin, scene.frame.m.rMax) };
      }),
    );
  }, [model.complexes, scene]);
  const displayPosition = (id: string): [number, number] => clusters?.positions.get(id) ?? scene?.pos.get(id) ?? [0, 0];
  const displayedPlaced = scene?.placed.map((p) => ({ ...p, dot: displayPosition(p.id) })) ?? [];
  const active = hover ?? picked;
  const activeLegend = legendHover ?? legendPinned;
  const activeLegendColor = model.legend.items.find((item) => item.label === activeLegend)?.color ?? null;
  const empty = model.complexes.length === 0;
  const sat = layer === "Satellite";
  // 카드 축척은 우측 하단 줌 버튼과 겹치지 않게 왼쪽 아래, 상세는 오른쪽 설명선 칸 앞에 둔다.
  const scaleX = scene && kind !== "card" ? scene.frame.right.x0 - 18 - 92 : undefined;
  const backdrop = useMemo(() => ({ center: model.center, radiusM: model.radiusM, features: [], total: 0, notes: [] }), [model]);
  const scale = scene && size
    ? (() => {
        const viewport = applyView(framedViewport(model.center, model.radiusM, size.w, size.h, scene.frame.siteX, scene.frame.fill, scene.siteY), model.center[1], controller.view);
        const u = Math.min(1.5, Math.max(1, size.h / 360));
        return scaleBar(metersPerPixel(model.center[1], viewport.zoom), 88 * u);
      })()
    : null;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", minHeight: 0, paddingBottom: detail ? OV.stripH : 0 }} data-callout-map-root="true">
      <div {...controller.bind} ref={setViewportRef} style={{ ...controller.bind.style, position: "relative", flex: "1 1 auto", minHeight: 0, width: "100%" }}>
        {size && near && scene && (
        <>
          <div className={styles.mapPreview} style={controller.previewTransform}>
          <MapFigure
              model={backdrop}
              width={size.w}
              height={size.h}
              layer={layer}
              label={label}
              legend={false}
              north={22}
              credit={false}
              bottomInset={0}
              tileHref={sat ? satelliteTileHref : undefined}
              siteX={scene.frame.siteX}
              fill={scene.frame.fill}
              siteY={scene.siteY}
              rightInset={scene.panel}
              scaleX={scaleX}
              scaleLeft={kind === "card"}
              view={controller.view}
              dragging={controller.dragging}
          />
          <svg width={size.w} height={size.h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden fontFamily='"Noto Sans KR","Malgun Gothic",sans-serif'>
            {clusters?.groups.map((group) => (
              <g key={group.id} aria-hidden>
                <circle cx={group.center[0]} cy={group.center[1]} r={group.radius} fill="#fff" fillOpacity={0.2} stroke={sat ? "#fff" : "#16181d"} strokeOpacity={sat ? 0.75 : 0.55} strokeWidth={1.2} strokeDasharray="3 3" />
                {showMapLabels && <text x={group.center[0]} y={group.center[1] - group.radius - 3} textAnchor="middle" fontSize={9} fontWeight={700} fill={sat ? "#fff" : "#16181d"} stroke="#fff" strokeWidth={3} paintOrder="stroke">
                  {group.members.length}개 겹침
                </text>}
              </g>
            ))}
            {/* 연립·다세대 등 기타 공동주택: 번호·라벨 없는 작은 회색 점 */}
            {scene.otherPts.map(([x, y], i) => (
              <circle key={`o${i}`} cx={x} cy={y} r={2} fill={OTHER_HOUSING_COLOR} fillOpacity={activeLegend === OTHER_HOUSING_LABEL ? 0.7 : activeLegendColor ? 0.2 : 0.7} />
            ))}
            {/* 카드 없는 단지: 점만 (앞뒤 페이지·보드 카드의 나머지) */}
            {model.complexes
              .filter((c) => !scene.numbered.includes(c))
              .map((c) => (
                <circle key={c.id} cx={displayPosition(c.id)[0]} cy={displayPosition(c.id)[1]} r={4} fill={dotColor(c)} fillOpacity={0.6} stroke="#fff" strokeWidth={1} />
              ))}
            {(showMapLabels || !!active) && displayedPlaced.filter((p) => showMapLabels || p.id === active).map((p) => {
              const on = active === p.id;
              const pts = [p.dot, p.knee, p.edge].map((q) => q.join(",")).join(" ");
              return (
                <g key={p.id}>
                  {!controller.dragging && <polyline points={pts} fill="none" stroke={sat ? INK : "#fff"} strokeOpacity={sat ? 0.4 : 0.92} strokeWidth={3.4} strokeLinejoin="round" />}
                  {!controller.dragging && <polyline points={pts} fill="none" stroke={sat ? "#fff" : INK} strokeWidth={on ? 1.8 : 1} strokeLinejoin="round" />}
                </g>
              );
            })}
            {scene.numbered.map((c) => {
              const [x, y] = displayPosition(c.id);
              const r = dotRadius(c.households, scene.hMax, scene.frame.m.rMin, scene.frame.m.rMax);
              const color = dotColor(c);
              const hollow = isHollowComplexMarker(c);
              const legendMatch = calloutLegendMatches(c, activeLegendColor);
              const on = activeLegendColor ? legendMatch : active === c.id;
              return (
                  <g
                   key={c.id}
                   style={{ pointerEvents: "all", cursor: detail ? "pointer" : undefined }}
                   role="button"
                   tabIndex={0}
                   aria-label={`${c.rank}번 ${cardName(c)}`}
                   opacity={activeLegendColor && !legendMatch ? 0.2 : 1}
                   onMouseEnter={() => { if (!controller.dragging) setHover(c.id); }}
                   onMouseLeave={() => { if (!controller.dragging) setHover(null); }}
                   onFocus={() => { if (!controller.dragging) setHover(c.id); }}
                   onBlur={() => { if (!controller.dragging) setHover(null); }}
                   onKeyDown={(event) => {
                     if (event.key !== "Enter" && event.key !== " ") return;
                     event.preventDefault();
                     if (page === 0 && detail && onPage) onPage(Math.ceil(c.rank / 10));
                     else setPicked((v) => (v === c.id ? null : c.id));
                   }}
                   onClick={() => (page === 0 && detail && onPage ? onPage(Math.ceil(c.rank / 10)) : setPicked((v) => (v === c.id ? null : c.id)))}
                 >
                   <title>{`${c.rank}번 ${cardName(c)}`}</title>
                  {on && <circle cx={x} cy={y} r={r + 5} fill="none" stroke={sat ? "#fff" : INK} strokeWidth={2} />}
                  <circle cx={x} cy={y} r={r + 1.4} fill={sat ? INK : "#fff"} fillOpacity={sat ? 0.45 : 0.95} />
                  <circle cx={x} cy={y} r={r} fill={hollow ? "transparent" : color} stroke={sat ? "#fff" : color} strokeOpacity={sat ? 0.9 : 0.8} strokeWidth={0.8} />
                  <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(12, Math.max(8.5, r * 1.05))} fontWeight={700} fill={hollow ? (sat ? "#fff" : color) : inkOn(color)}>
                    {c.rank}
                  </text>
                </g>
              );
            })}
          </svg>
          {(showMapLabels || !!active) && displayedPlaced.filter((p) => showMapLabels || p.id === active).map((p) => {
            const complex = model.complexes.find((c) => c.id === p.id)!;
            const legendMatch = calloutLegendMatches(complex, activeLegendColor);
            return <Card key={p.id} c={complex} siblings={model.complexes} p={p} frame={scene.labelFrame} year={model.analysisYear} hover={activeLegendColor ? legendMatch : active === p.id} dim={!!activeLegendColor && !legendMatch} onHover={(id) => { if (!controller.dragging) setHover(id); }} onPick={(id) => setPicked((v) => (v === id ? null : id))} />;
          })}
          {detail && <Pager model={model} page={page} onPage={(p) => onPage?.(Math.max(0, Math.min(pages, p)))} />}
          {showMapLabels && scene.strip && page > 0 && <Strip cards={stripCards(scene.withCards, model.analysisYear)} active={active} onPick={(id) => setPicked((v) => (v === id ? null : id))} top={scene.stripTop} />}
          {detail && page === 0 && !empty && (
            <div className={styles.ovBL}>
              <CalloutValueCard model={model} />
            </div>
          )}
          {empty && (
            <div className={styles.statusWrap} style={{ right: scene.panel, placeItems: "end center", paddingBottom: Math.round(size.h * 0.2) }}>
              <div className={`${styles.plate} ${styles.statusPlate}`}>
                <b className={styles.statusHead}>반경 안 확인된 {model.unit === "곳" ? "사업" : "단지"} 0</b>
                <p className={styles.statusNote}>기준 {model.sourceLine}</p>
              </div>
            </div>
          )}
          </div>
          <MapControls
            controller={controller}
            disabled={!mapInteractive}
            className={styles.calloutMapControls}
            resetVariant="icon"
            style={{
              top: "auto",
              left: "auto",
              bottom: 4,
              ...(detail && scene.panel > 0 ? { right: scene.panel + 12 } : {}),
            }}
          />
        </>
        )}
      </div>
      {size && near && scene && !empty && ((detail && size.w > 560) || (!detail && size.w >= 240)) && (
        <MapLegendStrip
          items={calloutLegendStripItems(model, !detail)}
          hoverLabel={legendHover}
          pinnedLabel={legendPinned}
          onHover={setLegendHover}
          onToggle={(labelValue) => {
            setLegendHover(null);
            setLegendPinned((current) => current === labelValue ? null : labelValue);
          }}
          leadingLabel={detail ? model.legend.title : null}
          trailingLabel={detail ? model.legend.sizeLabel : null}
          ariaLabel={`${model.legend.title} 지도 범례`}
        />
      )}
    </div>
  );
}

export default memo(CalloutMap);

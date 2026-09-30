"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import { BOARD_TOP, PX, calloutFrame, cardHeight, cardName, cardRows, decadeColor, dotRadius, fmtInt, inkOn, layoutCallouts, pageCount, pageItems, pageRange, rowsFor, DECADE_LAYERS, type CalloutFrame, type Complex, type Placed } from "@/lib/v2/ui/callout-layout";
import { LAYER_STYLES } from "@/lib/v2/ui/map-layers";
import { framedViewport, makeProjector } from "@/lib/v2/ui/map-projection";
import { OV } from "@/lib/v2/ui/overlay-layout";
import type { CalloutModel } from "@/lib/v2/ui/tile-view";
import MapFigure from "./map-figure";
import { BasemapContext, useMeasured } from "./map-box";
import styles from "./board.module.css";

const INK = "#16181d";
const PANEL_W = 360;
/** 보드 카드 왼쪽 아래 값 판 높이 */
const PILL_H = 32;

export type CalloutFrameKind = "card" | "detail";

/** 설명선 배치를 만드는 순수 계산: 프레임 종류·크기·페이지 → 점·카드 자리 */
export function calloutScene(model: CalloutModel, kind: CalloutFrameKind, W: number, H: number, page: number) {
  const detail = kind === "detail";
  const mobile = W <= 520;
  const panel = detail && W > 720 ? PANEL_W + OV.edge : 0;
  const top = detail ? OV.edge + 34 + 6 + 32 + 8 : OV.edge + 34 + 6;
  const bottom = detail ? H - OV.stripH - OV.edge + (mobile ? -(0.4 * H + 20) : 0) : H - OV.stripH - 8;
  const numbered = !detail ? model.complexes.slice(0, BOARD_TOP) : page === 0 ? model.complexes : pageItems(model.complexes, page);
  const withCards = page !== 0 || !detail ? numbered : [];
  const rows = rowsFor(withCards);
  const perSide = detail ? 5 : 3;
  const spec = { W, H, m: PX, edge: OV.edge, top, bottom, leftBottom: detail ? undefined : bottom - PILL_H - 6, rightInset: panel, perSide, rows };
  // 세로 여유가 되면 4행 카드, 아니면 이름+세대수 2줄 카드
  const fullFits = detail && !mobile && (bottom - top + PX.gap) >= perSide * (cardHeight(PX, "full", rows) + PX.gap) - 1e-6;
  const frame: CalloutFrame = calloutFrame({ ...spec, variant: fullFits ? "full" : "compact" });
  const vp = framedViewport(model.center, model.radiusM, W, H, frame.siteX, frame.fill);
  const proj = makeProjector(vp);
  const hMax = Math.max(0, ...model.complexes.map((c) => c.households ?? 0));
  const pos = new Map(model.complexes.map((c) => [c.id, proj(c.lng, c.lat)]));
  const { placed, overflow } = layoutCallouts(
    frame,
    withCards.map((c) => ({ id: c.id, x: pos.get(c.id)![0], y: pos.get(c.id)![1] })),
  );
  return { frame, pos, hMax, placed, overflow, numbered, withCards, panel };
}

function Card({ c, p, frame, year, hover, onHover, onPick }: { c: Complex; p: Placed; frame: CalloutFrame; year: number; hover: boolean; onHover: (id: string | null) => void; onPick: (id: string) => void }) {
  const color = decadeColor(c.approvalYear);
  const rows = cardRows(c, year);
  const full = frame.variant === "full";
  return (
    <div
      className={`${styles.plate} ${styles.cCard} ${hover ? styles.cCardOn : ""}`}
      role="group"
      aria-label={`${c.rank}번 ${cardName(c)}`}
      style={{ left: p.x, top: p.y, width: frame.cardW, height: frame.cardH }}
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onPick(c.id)}
    >
      <div className={styles.cHead} data-compact={!full || undefined}>
        <span className={styles.cNum} style={{ background: color, color: inkOn(color) }}>
          {c.rank}
        </span>
        <span className={`${styles.cName} ${c.name ? "" : styles.cMissing}`} title={cardName(c)}>
          {cardName(c)}
        </span>
      </div>
      {full ? (
        <ul className={styles.cRows}>
          {rows.map((r) => (
            <li key={r.label}>
              <span>{r.label}</span>
              <b className={r.missing ? styles.cMissing : undefined}>{r.value}</b>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.cSub}>
          <span className={rows[0].missing ? styles.cMissing : undefined}>{rows[0].value}</span>
          {c.approvalYear !== null && <span className={styles.cYear}>{c.approvalYear}</span>}
        </div>
      )}
    </div>
  );
}

const DECADE_SHORT = ["~79", "80년대", "90년대", "00년대", "10년대", "20년~", "미상"];

/** 범례: 준공 연대 색 + 크기 = 세대수 */
export function CalloutLegend({ style }: { style?: React.CSSProperties }) {
  return (
    <div className={`${styles.plate} ${styles.cLegend}`} style={style} aria-label="범례">
      <span className={styles.cLegendT}>준공 연대</span>
      {DECADE_LAYERS.map((k, i) => (
        <span key={k} className={styles.cLegendI}>
          <i style={{ background: LAYER_STYLES[k].color }} />
          {DECADE_SHORT[i]}
        </span>
      ))}
      <span className={styles.cLegendT}>크기 = 세대수</span>
    </div>
  );
}

/** 개요 페이지 왼쪽 아래 핵심 값 카드 */
export function CalloutValueCard({ model }: { model: CalloutModel }) {
  const s = model.summary;
  const unknown = s.apartments - s.householdsKnown;
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
    <div className={`${styles.plate} ${styles.valueCard} ${styles.cValue}`}>
      <div className={styles.cValueRow}>
        {stat(fmtInt(s.count), "단지", "반경 안 단지 수")}
        {stat(fmtInt(s.households), "세대", "확인 세대(아파트)")}
        {stat(s.medianYear === null ? "확인필요" : String(s.medianYear), s.medianYear === null ? "" : "년", "준공 중앙값")}
      </div>
      {unknown > 0 && <div className={styles.sub}>세대수 미확인 {unknown}곳은 합계에서 제외</div>}
    </div>
  );
}

/** 보드 카드 왼쪽 아래 한 줄 값 판 */
export function CalloutPill({ model }: { model: CalloutModel }) {
  const s = model.summary;
  return (
    <div className={`${styles.plate} ${styles.cPill}`}>
      <span className={`${styles.display} ${styles.cPillN}`}>{fmtInt(s.count)}</span>
      <span className={styles.aux}>단지</span>
      <span className={`${styles.display} ${styles.cPillN}`}>{fmtInt(s.households)}</span>
      <span className={styles.aux}>세대(아파트)</span>
    </div>
  );
}

/** 페이지 넘김 칩 (‹ 개요 / 1/3 ›) */
function Pager({ model, page, onPage }: { model: CalloutModel; page: number; onPage: (p: number) => void }) {
  const pages = pageCount(model.complexes.length);
  const label = page === 0 ? "개요" : `${page} / ${pages}`;
  const range = page === 0 ? `전체 ${fmtInt(model.complexes.length)}단지 · 세대수 순` : pageRange(page, model.complexes.length);
  return (
    <div className={styles.cPagerWrap}>
      <div className={`${styles.plate} ${styles.cPager}`} role="group" aria-label="설명표 페이지">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 0} aria-label="이전 페이지">
          ‹
        </button>
        <b aria-live="polite">{label}</b>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="다음 페이지">
          ›
        </button>
        <span className={styles.cPagerRange}>{range}</span>
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
};

/**
 * 주변 단지 설명선 지도 (A05, 이후 A06). 지도는 MapFigure(단지 없이), 점·지시선은 SVG, 표는 HTML 판.
 * 카드는 두 칸에만 놓이고 지도 원은 두 칸 사이에 들어가, 점이 카드에 가려지지 않는다.
 */
export default function CalloutMap({ model, kind, page = 0, onPage, label }: CalloutMapProps) {
  const { ref, size, near } = useMeasured();
  const layer = useContext(BasemapContext);
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const detail = kind === "detail";
  const pages = pageCount(model.complexes.length);

  useEffect(() => {
    if (!detail || !onPage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && page > 0) onPage(page - 1);
      else if (e.key === "ArrowRight" && page < pages) onPage(page + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detail, onPage, page, pages]);

  const scene = useMemo(() => (size ? calloutScene(model, kind, size.w, size.h, page) : null), [model, kind, size, page]);
  const active = hover ?? picked;
  const empty = model.complexes.length === 0;
  const sat = layer === "Satellite";
  // 아래 줄: [왼쪽 아래 값 카드(개요)] [범례] ... [축척] — 축척은 두 칸 사이 지도 영역의 오른쪽 끝
  const scaleX = scene ? scene.frame.right.x0 - 18 - 92 : 0;
  const legendX = scene ? (page === 0 ? 356 : scene.frame.left.x1 + 18) : 0;
  const backdrop = useMemo(() => ({ center: model.center, radiusM: model.radiusM, features: [], total: 0, notes: [] }), [model]);

  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      {size && near && scene && (
        <>
          <MapFigure
            model={backdrop}
            width={size.w}
            height={size.h}
            layer={layer}
            label={label}
            legend={false}
            north={detail ? 22 : OV.edge + 34 + 8 + 13}
            credit={false}
            bottomInset={OV.stripH}
            siteX={scene.frame.siteX}
            fill={scene.frame.fill}
            rightInset={scene.panel}
            scaleX={scaleX}
          />
          <svg width={size.w} height={size.h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden fontFamily='"Noto Sans KR","Malgun Gothic",sans-serif'>
            {/* 카드 없는 단지: 점만 (앞뒤 페이지·보드 카드의 나머지) */}
            {model.complexes
              .filter((c) => !scene.numbered.includes(c))
              .map((c) => (
                <circle key={c.id} cx={scene.pos.get(c.id)![0]} cy={scene.pos.get(c.id)![1]} r={4} fill={decadeColor(c.approvalYear)} fillOpacity={0.6} stroke="#fff" strokeWidth={1} />
              ))}
            {scene.placed.map((p) => {
              const on = active === p.id;
              const pts = [p.dot, p.knee, p.edge].map((q) => q.join(",")).join(" ");
              return (
                <g key={p.id}>
                  <polyline points={pts} fill="none" stroke={sat ? INK : "#fff"} strokeOpacity={sat ? 0.4 : 0.92} strokeWidth={3.4} strokeLinejoin="round" />
                  <polyline points={pts} fill="none" stroke={sat ? "#fff" : INK} strokeWidth={on ? 1.8 : 1} strokeLinejoin="round" />
                </g>
              );
            })}
            {scene.numbered.map((c) => {
              const [x, y] = scene.pos.get(c.id)!;
              const r = dotRadius(c.households, scene.hMax, PX.rMin, PX.rMax);
              const color = decadeColor(c.approvalYear);
              const on = active === c.id;
              return (
                <g
                  key={c.id}
                  style={{ pointerEvents: "all", cursor: detail ? "pointer" : undefined }}
                  onMouseEnter={() => setHover(c.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => (page === 0 && detail && onPage ? onPage(Math.ceil(c.rank / 10)) : setPicked((v) => (v === c.id ? null : c.id)))}
                >
                  {on && <circle cx={x} cy={y} r={r + 5} fill="none" stroke={sat ? "#fff" : INK} strokeWidth={2} />}
                  <circle cx={x} cy={y} r={r + 1.4} fill={sat ? INK : "#fff"} fillOpacity={sat ? 0.45 : 0.95} />
                  <circle cx={x} cy={y} r={r} fill={color} stroke={sat ? "#fff" : INK} strokeOpacity={sat ? 0.9 : 0.5} strokeWidth={0.8} />
                  <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(12, Math.max(8.5, r * 1.05))} fontWeight={700} fill={inkOn(color)}>
                    {c.rank}
                  </text>
                </g>
              );
            })}
          </svg>
          {scene.placed.map((p) => (
            <Card key={p.id} c={model.complexes.find((c) => c.id === p.id)!} p={p} frame={scene.frame} year={model.analysisYear} hover={active === p.id} onHover={setHover} onPick={(id) => setPicked((v) => (v === id ? null : id))} />
          ))}
          {detail && <Pager model={model} page={page} onPage={(p) => onPage?.(Math.max(0, Math.min(pages, p)))} />}
          {detail && size.w > 560 && !empty && <CalloutLegend style={{ left: legendX, maxWidth: Math.max(160, scaleX - 12 - legendX), bottom: OV.stripH + 12 }} />}
          {detail && page === 0 && !empty && (
            <div className={styles.ovBL}>
              <CalloutValueCard model={model} />
            </div>
          )}
          {empty && (
            <div className={styles.statusWrap} style={{ right: scene.panel }}>
              <div className={`${styles.plate} ${styles.statusPlate}`}>
                <b className={styles.statusHead}>반경 안 확인된 단지 0</b>
                <p className={styles.statusNote}>기준 {model.sourceLine}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

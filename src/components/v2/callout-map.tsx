"use client";

import { Fragment, useContext, useEffect, useMemo, useRef, useState } from "react";
import { STRIP_H, cardName, cardRows, dotColor, dotRadius, fmtInt, inkOn, overlapChip, pageCount, pageRange, stripCards, type CalloutFrame, type Complex, type Placed, type StripCard } from "@/lib/v2/ui/callout-layout";
import { calloutScene, type CalloutFrameKind } from "@/lib/v2/ui/callout-scene";
import { OV } from "@/lib/v2/ui/overlay-layout";
import type { CalloutModel } from "@/lib/v2/ui/tile-view";
import MapFigure from "./map-figure";
import { BasemapContext, useMeasured } from "./map-box";
import styles from "./board.module.css";

const INK = "#16181d";

function Card({ c, p, frame, year, hover, onHover, onPick }: { c: Complex; p: Placed; frame: CalloutFrame; year: number; hover: boolean; onHover: (id: string | null) => void; onPick: (id: string) => void }) {
  const color = dotColor(c);
  const rows = cardRows(c, year);
  const full = frame.variant === "full";
  const chip = overlapChip(c);
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
        {chip && (
          <span className={styles.cChip} title={chip}>
            {full ? chip : "중복"}
          </span>
        )}
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
        <div className={styles.cSub} style={c.supply ? { paddingLeft: 10 } : undefined}>
          {c.supply ? (
            <>
              <span className={c.supply.plannedMonth === null ? styles.cMissing : undefined}>{c.supply.plannedMonth ? c.supply.plannedMonth.replace("-", ".") : "일정 확인필요"}</span>
              <span className={rows[1].missing ? styles.cMissing : styles.cYear}>{rows[1].value}</span>
            </>
          ) : (
            <>
              <span className={rows[0].missing ? styles.cMissing : undefined}>{rows[0].value}</span>
              {c.approvalYear !== null && frame.cardW >= 112 && <span className={styles.cYear}>{c.approvalYear}</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 범례: A05 준공 연대 / A06 입주 시기 색 + 크기 = 세대수 */
export function CalloutLegend({ model, style }: { model: CalloutModel; style?: React.CSSProperties }) {
  return (
    <div className={`${styles.plate} ${styles.cLegend}`} style={style} aria-label="범례">
      <span className={styles.cLegendT}>{model.legend.title}</span>
      {model.legend.items.map((it) => (
        <span key={it.label} className={styles.cLegendI}>
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
      <span className={styles.cLegendT}>{model.legend.sizeLabel}</span>
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
    <div className={`${styles.plate} ${styles.valueCard} ${styles.cValue}`}>
      <div className={styles.cValueRow}>
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
    <div className={`${styles.plate} ${styles.cPill}`}>
      {model.pill.map((p) => (
        <Fragment key={p.unit}>
          <span className={`${styles.display} ${styles.cPillN}`}>{p.value}</span>
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
    <div ref={ref} className={styles.cStrip} style={{ top, height: STRIP_H }} role="list" aria-label="단지 설명 카드">
      {cards.map((c) => (
        <button key={c.id} type="button" role="listitem" data-card={c.id} className={`${styles.plate} ${styles.cStripCard} ${active === c.id ? styles.cCardOn : ""}`} onClick={() => onPick(c.id)} aria-pressed={active === c.id}>
          <span className={styles.cStripHead}>
            <span className={styles.cNum} style={{ background: c.color, color: inkOn(c.color) }}>
              {c.rank}
            </span>
            <span className={`${styles.cName} ${c.nameMissing ? styles.cMissing : ""}`}>{c.name}</span>
            {c.chip && <span className={styles.cChip}>{c.chip}</span>}
          </span>
          <span className={styles.cStripLine}>{c.lines[0]}</span>
          <span className={styles.cStripLine}>{c.lines[1]}</span>
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

  useEffect(() => setPicked(null), [page]);
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
  // 아래 줄: [왼쪽 아래 값 카드(개요)] [범례] ... [축척]. 모바일 카드에서는 값 판과
  // 축척이 같은 가로 영역을 쓰지 않도록 축척을 오른쪽 끝으로 보낸다.
  const scaleX = scene
    ? kind === "card" && size && size.w <= 520
      ? Math.max(12, size.w - 100)
      : scene.frame.right.x0 - 18 - 92
    : 0;
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
            siteY={scene.siteY}
            rightInset={scene.panel}
            scaleX={scaleX}
          />
          <svg width={size.w} height={size.h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden fontFamily='"Noto Sans KR","Malgun Gothic",sans-serif'>
            {/* 연립·다세대 등 기타 공동주택: 번호·라벨 없는 작은 회색 점 */}
            {scene.otherPts.map(([x, y], i) => (
              <circle key={`o${i}`} cx={x} cy={y} r={2} fill="#9AA0AA" fillOpacity={0.7} />
            ))}
            {/* 카드 없는 단지: 점만 (앞뒤 페이지·보드 카드의 나머지) */}
            {model.complexes
              .filter((c) => !scene.numbered.includes(c))
              .map((c) => (
                <circle key={c.id} cx={scene.pos.get(c.id)![0]} cy={scene.pos.get(c.id)![1]} r={4} fill={dotColor(c)} fillOpacity={0.6} stroke="#fff" strokeWidth={1} />
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
              const r = dotRadius(c.households, scene.hMax, scene.frame.m.rMin, scene.frame.m.rMax);
              const color = dotColor(c);
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
          {scene.strip && page > 0 && <Strip cards={stripCards(scene.withCards, model.analysisYear)} active={active} onPick={(id) => setPicked((v) => (v === id ? null : id))} top={scene.stripTop} />}
          {detail && size.w > 560 && !empty && <CalloutLegend model={model} style={{ left: legendX, maxWidth: Math.max(160, scaleX - 12 - legendX), bottom: OV.stripH + 12 }} />}
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
        </>
      )}
    </div>
  );
}

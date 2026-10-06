"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { CardFace, DemoPhase, TileSize } from "@/lib/v2/ui/board-state";
import { STRIP_COLORS } from "@/lib/v2/ui/map-layers";
import { OV, badgesToShow, cardReserved, stripText } from "@/lib/v2/ui/overlay-layout";
import { faceLabel, type Badge, type OutputFace, type TileView } from "@/lib/v2/ui/tile-view";
import { viewWithOnlyRaster } from "@/lib/v2/ui/tile-view";
import { windRasterName, WIND_LAYER_HEIGHTS } from "@/lib/v2/ui/wind-upload";
import { ROSE_SEASONS, type RoseSeason } from "@/lib/v2/tile-result";
import MassFigure from "./mass-figure";
import WindRoseFigure from "./wind-rose-figure";
import CalloutMap from "./callout-map";
import MapBox from "./map-box";
import DetailWindow from "./detail-window";
import WindPanel, { mapOptions } from "./wind-panel";
import styles from "./board.module.css";
import { hasDetail } from "@/lib/v2/ui/detail-state";

const BADGE_CLASS = { status: styles.badgeStatus, limit: styles.badgeLimit, model: styles.badgeModel } as const;
const FACES: OutputFace[] = ["front", "back", "both"];
const ROSE_SEASON_LABEL: Record<RoseSeason, string> = { annual: "연간", spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };

export function RoseSeasonSelect({ view, value, onChange }: { view: TileView; value: RoseSeason; onChange: (season: RoseSeason) => void }) {
  if (view.code !== "D22" || !view.rose) return null;
  const options = ROSE_SEASONS.filter((season) => season === "annual" ? !!view.rose : !!view.roses?.[season]);
  const selected = options.includes(value) ? value : "annual";
  return (
    <div className={styles.mfWind} data-wind-season>
      <label className={styles.mfWindLabel}>
        <span>계절</span>
        <select value={selected} onChange={(event) => onChange(event.currentTarget.value as RoseSeason)} aria-label={`${view.title} 계절`}>
          {options.map((season) => <option key={season} value={season}>{ROSE_SEASON_LABEL[season]}</option>)}
        </select>
      </label>
    </div>
  );
}

export function BadgeList({ badges, extra }: { badges: Badge[]; extra?: string }) {
  if (badges.length === 0 && !extra) return null;
  return (
    <div className={styles.badges}>
      {badges.map((b, i) => (
        <span key={`${b.text}-${i}`} className={`${styles.badge} ${BADGE_CLASS[b.tone]}`} title={b.note}>
          {b.text}
        </span>
      ))}
      {extra && <span className={styles.badge}>{extra}</span>}
    </div>
  );
}

/** 카드 핵심 값 카드 아래 배지: 최대 2개, 나머지는 "+n" (전부는 펼침에서) */
export function ValueBadges({ badges }: { badges: Badge[] }) {
  const { shown, more } = badgesToShow(badges);
  if (shown.length === 0) return null;
  const hidden = badges.slice(shown.length);
  return (
    <div className={styles.badges}>
      {shown.map((b, i) => (
        <span key={`${b.text}-${i}`} className={`${styles.badge} ${BADGE_CLASS[b.tone]}`} title={b.note}>
          {b.text}
        </span>
      ))}
      {more > 0 && (
        <span className={styles.badge} title={hidden.map((b) => b.text).join(" · ")}>
          +{more}
        </span>
      )}
    </div>
  );
}

export function Headline({ view, small }: { view: TileView; small?: boolean }) {
  const h = view.headline;
  if (!h) return <div className={styles.sub}>표시할 결과가 없습니다</div>;
  const longAux = !!h.aux && h.aux.length > 4; // "직선" 같은 짧은 보조어만 숫자 옆에 둔다
  return (
    <div className={styles.bigWrap}>
      <div>
        <span className={`${styles.display} ${styles.big} ${small || h.value.length > 5 ? styles.bigSmall : ""}`}>{h.value}</span>
        {h.aux && !longAux && <span className={styles.aux}>{h.aux}</span>}
        {h.tag && <span className={styles.tag}>{h.tag}</span>}
      </div>
      <div className={styles.sub}>
        {h.label}
        {longAux && ` · ${h.aux}`}
      </div>
    </div>
  );
}

export function RowList({ rows, className }: { rows: TileView["rows"]; className?: string }) {
  return (
    <ul className={className ?? styles.rows}>
      {rows.map((r) => (
        <li key={r.label}>
          <span>{r.label}</span>
          <span>
            {r.value}
            {r.aux && <span className={styles.aux}>{r.aux}</span>}
            {r.tag && <span className={styles.tag}>{r.tag}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FaceSelect({ view, value, onChange }: { view: TileView; value: OutputFace; onChange: (f: OutputFace) => void }) {
  return (
    <div className={styles.seg} role="group" aria-label={`${view.title} 보고서 출력`}>
      보고서 출력
      {FACES.map((f) => (
        <button key={f} type="button" aria-pressed={value === f} onClick={() => onChange(f)}>
          {faceLabel(f)}
        </button>
      ))}
    </div>
  );
}

/** 도판 뒤집은 면: 연한 타일색 바탕에 구성비 막대가 가득 (카드·펼침 공통) */
export function FaceChart({ view }: { view: TileView }) {
  const chart = view.chart ?? [];
  const max = Math.max(1, ...chart.map((c) => c.value));
  const valueText = (c: (typeof chart)[number]) => `${c.value}${c.unit === "%" ? "%" : ` ${c.unit}`}`;
  return (
    <div className={styles.faceChart} style={{ background: `${view.color}10` }} role="img" aria-label={`${view.title} 구성비: ${chart.map((c) => `${c.label} ${valueText(c)}`).join(", ")}`}>
      {chart.map((c, i) => (
        <div key={c.label} className={styles.fcRow}>
          <span className={styles.fcLabel}>{c.label}</span>
          <span className={styles.fcTrack}>
            <i style={{ width: `${(c.value / max) * 100}%`, background: STRIP_COLORS[i % STRIP_COLORS.length] }} />
          </span>
          <b className={styles.fcVal}>{valueText(c)}</b>
        </div>
      ))}
    </div>
  );
}

// ── 오버레이 조각 (카드·펼침 공통 문법) ──

/** 왼쪽 위: 타일 색 점 + 타일명 + 종류 배지 */
export function TitleChip({ view, lead, tail, headingId, as: H = "h3" }: { view: TileView; lead?: ReactNode; tail?: ReactNode; headingId?: string; as?: "h2" | "h3" }) {
  return (
    <div className={styles.ovTL}>
      <div className={`${styles.plate} ${styles.titleChip}`}>
        {lead}
        <span className={styles.dot} style={{ background: view.color }} />
        <H id={headingId} className={styles.title}>
          {view.title}
        </H>
        <span className={styles.kindTag}>{view.kindLabel}</span>
        {tail}
      </div>
    </div>
  );
}

/** 맨 아래: 출처·기준일 띠 */
export function SourceStrip({ view }: { view: TileView }) {
  const text = stripText(view.sourceLine);
  return (
    <div className={styles.srcStrip} title={text}>
      {text}
    </div>
  );
}

/** 왼쪽 아래: 핵심 값 카드 */
export function ValueCard({ view }: { view: TileView }) {
  if (!view.headline) return null;
  return (
    <div className={`${styles.plate} ${styles.valueCard}`}>
      <Headline view={view} />
      <ValueBadges badges={view.badges} />
    </div>
  );
}

/** 상태 화면 가운데 판: 미제공·실패·자료 없음·대기·계산 중 */
export function StatusPlate({ view, phase, onRetry, waitingNote }: { view: TileView; phase: DemoPhase | null; onRetry?: () => void; waitingNote?: string | null }) {
  const waiting = phase === "pending" || phase === "running";
  const head = waiting ? (phase === "running" ? "계산 중" : "대기") : (view.badges.find((b) => b.tone === "status")?.text ?? "표시할 결과가 없습니다");
  const rest = view.badges.filter((b) => b.tone !== "status");
  const retryText = view.status === "cancelled" ? "다시 계산" : "이 타일 다시 계산";
  return (
    <div className={styles.statusWrap}>
      <div className={`${styles.plate} ${styles.statusPlate}`}>
        {waiting && <span className={styles.spinner} role="status" aria-label={`${view.title} ${head}`} />}
        <b className={styles.statusHead}>{head}</b>
        {waiting && waitingNote && <p className={styles.statusNote}>{waitingNote}</p>}
        {!waiting && view.notes[0] && <p className={styles.statusNote}>{view.notes[0]}</p>}
        {!waiting && rest.length > 0 && <ValueBadges badges={rest} />}
        {!waiting && view.retryable && onRetry && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            {retryText}
          </button>
        )}
      </div>
    </div>
  );
}

/** 전면 시각물: 지도(또는 흐린 대지 지도, 또는 D04 구성비 차트) */
function stageViewForWind(view: TileView, layerZ: number | undefined): TileView {
  if (view.code !== "S03" || layerZ === undefined) return view;
  const name = windRasterName(view, layerZ);
  return name ? viewWithOnlyRaster(view, name, "") : view;
}

export function Stage({ view, state, chart, frame, siteX, rightInset, legendY, page, onPage, windLayerZ, massExploded = false, roseSeason = "annual" }: { view: TileView; state: boolean; chart: boolean; frame: "card" | "detail"; siteX?: number | ((w: number) => number); rightInset?: number | ((w: number) => number); legendY?: number; page?: number; onPage?: (p: number) => void; windLayerZ?: number; massExploded?: boolean; roseSeason?: RoseSeason }) {
  const displayView = stageViewForWind(view, windLayerZ);
  if (chart) return <FaceChart view={view} />;
  const card = frame === "card";
  const label = `${view.title} 지도`;
  if (state) return <MapBox model={displayView.backdrop} muted legend={false} north={false} scale={false} credit={false} label={label} siteX={siteX} />;
  if (view.code === "S01" && view.mass) {
    return <MassFigure scene={view.mass.scene} camera={view.mass.camera} width={960} height={540} label={label} exploded={massExploded ? { spreadPct: 24, scheme: "use" } : undefined} />;
  }
  const seasonalRose = view.roses?.[roseSeason];
  if (seasonalRose || view.rose) {
    return <WindRoseFigure model={seasonalRose ?? view.rose!} width={960} height={540} label={label} season={seasonalRose ? roseSeason : "annual"} />;
  }
  if (view.callout) return <CalloutMap model={view.callout} kind={frame} page={page} onPage={onPage} label={label} />;
  return (
    <MapBox
      model={displayView.map ?? displayView.backdrop}
      label={label}
      legend={!card}
      legendY={legendY}
      north={22}
      credit={false}
      bottomInset={card ? 0 : OV.stripH}
      pad={card ? 7 : undefined}
      avoid={(w, h) => {
        const inset = typeof rightInset === "function" ? rightInset(w) : (rightInset ?? 0);
        // 카드: 지도 위에는 북쪽(오른쪽 위)·범례 알약(왼쪽 아래)·축척(오른쪽 아래)만 있다
        const reserved = card
          ? [{ x0: w - 44, y0: 0, x1: w, y1: 44 }, { x0: 0, y0: h - 34, x1: w, y1: h }]
          : cardReserved(w, h, { valueH: 0, right: 0 });
        return [...reserved, ...(inset ? [{ x0: w - inset, y0: 0, x1: w, y1: h }] : [])];
      }}
      siteX={siteX}
      rightInset={rightInset}
      scaleLeft={!card}
    />
  );
}

export type TileCardProps = {
  view: TileView;
  phase: DemoPhase | null;
  included: boolean;
  face: OutputFace;
  editing: boolean;
  canUp: boolean;
  canDown: boolean;
  size: TileSize;
  dragging: boolean;
  floatStyle?: CSSProperties;
  onHandleDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onResize: (size: TileSize) => void;
  onOpen: () => void;
  /** queued/running 타일에 표시할 대기 위치·경과 시간 안내 */
  waitingNote?: string | null;
  onInclude: (v: boolean) => void;
  onFace: (f: OutputFace) => void;
  roseSeason: RoseSeason;
  onRoseSeason: (season: RoseSeason) => void;
  /** 화면 면 (요약면/지도면). 보고서 출력 면(face)과 무관 */
  cardFace: CardFace;
  onCardFace: (f: CardFace) => void;
  onWindUploaded?: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onRetry: () => void;
  stackable?: boolean;
  stackSelected?: boolean;
  onStackToggle?: (selected: boolean) => void;
  onUnstack?: () => void;
  sheetable?: boolean;
  sheetSelected?: boolean;
  onSheetToggle?: (selected: boolean) => void;
  onUnsheet?: () => void;
};

const INTERACTIVE = "button,input,label,a,select,[data-handle],[role=menu]";

const Svg = ({ children, size = 16, fill }: { children: ReactNode; size?: number; fill?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
    {children}
  </svg>
);

/** ⋯ 더 보기: 상세 보기 · 지도에 보기(도판/구성비) · 보고서에 넣을 그림(도판/구성비/둘 다). Esc·바깥 누름·Tab으로 닫히고 닫힐 때 ⋯ 버튼으로 포커스가 돌아온다. */
function MoreMenu({ view, active, back, onBack, face, onFace, onDetail }: { view: TileView; active: boolean; back: boolean; onBack: (v: boolean) => void; face: OutputFace; onFace: (f: OutputFace) => void; onDetail?: () => void }) {
  const [open, setOpen] = useState(false);
  const trigRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: Event) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !trigRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => {
    if (!active) setOpen(false); // 카드가 뒤집히면 메뉴도 닫는다
  }, [active]);
  if (!onDetail && !view.hasFace) return null;
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    }
  };
  const seg = (label: string, on: boolean, pick: () => void, wide?: boolean) => (
    <button key={label} type="button" role="menuitemradio" aria-checked={on} className={`${styles.mfSegBtn} ${wide ? styles.mfSegWide : ""}`} onClick={pick}>
      {label}
    </button>
  );
  return (
    <>
      <button ref={trigRef} type="button" className={`${styles.mfBtn} ${open ? styles.mfBtnOn : ""}`} data-more-button aria-haspopup="menu" aria-expanded={open} aria-label={`${view.title} 더 보기`} title="더 보기" onClick={() => setOpen((v) => !v)}>
        <Svg fill>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </Svg>
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={`${view.title} 더 보기`} className={styles.mfMenu} onKeyDown={onKeyDown}>
          {onDetail && (
            <button
              type="button"
              role="menuitem"
              className={styles.mfMenuItem}
              onClick={() => {
                close(true); // 상세 창이 닫힐 때 돌아갈 자리를 ⋯ 버튼으로 둔다
                onDetail();
              }}
            >
              상세 보기<span>표·출처 전체</span>
            </button>
          )}
          {view.hasFace && (
            <>
              <div className={styles.mfMenuHead} id={`mf-view-${view.tileId}`}>지도에 보기</div>
              <div role="group" aria-labelledby={`mf-view-${view.tileId}`} className={styles.mfSeg}>
                {seg("도판", !back, () => onBack(false))}
                {seg("구성비", back, () => onBack(true))}
              </div>
              <div className={styles.mfMenuHead} id={`mf-out-${view.tileId}`}>보고서에 넣을 그림</div>
              <div role="group" aria-labelledby={`mf-out-${view.tileId}`} className={styles.mfSeg}>
                {FACES.map((f) => seg(f === "both" ? "둘 다" : faceLabel(f), face === f, () => onFace(f), f === "both"))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** S03: 바람장 표시 높이만 카드에서 바로 고른다. 계산·업로드 같은 큰 패널은 펼침에 있다. */
function WindStrip({ view, layerZ, onLayerZ, onOpen }: { view: TileView; layerZ: number; onLayerZ: (z: number) => void; onOpen: () => void }) {
  const options = mapOptions(view);
  const z = options.find((o) => o.z === layerZ)?.z ?? options[0]?.z ?? layerZ;
  return (
    <div className={styles.mfWind} data-wind-strip>
      <label className={styles.mfWindLabel}>
        <span>높이</span>
        <input
          type="range"
          min={0}
          max={WIND_LAYER_HEIGHTS.length - 1}
          step={1}
          value={Math.max(0, WIND_LAYER_HEIGHTS.indexOf(z as (typeof WIND_LAYER_HEIGHTS)[number]))}
          onChange={(e) => onLayerZ(WIND_LAYER_HEIGHTS[Number(e.target.value)] ?? z)}
          disabled={options.length === 0}
          aria-label="바람장 표시 높이"
          aria-valuetext={`${z} m`}
        />
        <output data-wind-height>{z} m</output>
      </label>
      <button type="button" className={styles.mfWindBtn} onClick={onOpen} title="바람 계산·업로드는 펼침에서">
        계산·설정 ↗
      </button>
    </div>
  );
}

/** 지도 면: 헤더 40px(지도 밖) · 지도(남은 높이 전부) · 출처 24px(지도 밖). 지도 위에는 북쪽·축척·한 줄 범례만 둔다. */
function MapFace({ p, active, state, back, onBack, windLayerZ, onWindLayerZ, massExploded, onMassExploded, onFlip, onDetail }: { p: TileCardProps; active: boolean; state: boolean; back: boolean; onBack: (v: boolean) => void; windLayerZ: number; onWindLayerZ: (z: number) => void; massExploded: boolean; onMassExploded: (value: boolean) => void; onFlip: () => void; onDetail?: () => void }) {
  const { view } = p;
  const h = view.headline;
  const shortAux = h?.aux && h.aux.length <= 4 ? h.aux : "";
  const extra = view.stackLayers ? view.stackLayers.join(" + ") : view.sheetGrid;
  const text = stripText(view.sourceLine);
  // 제목과 핵심 숫자가 함께 들어가지 않으면 숫자를 통째로 숨긴다(잘린 숫자는 오독되고, 숫자는 요약 면에 있다).
  const headRef = useRef<HTMLElement>(null);
  const [keyHidden, setKeyHidden] = useState(false);
  useEffect(() => {
    const head = headRef.current;
    if (!head) return;
    const measure = () => {
      const title = head.querySelector<HTMLElement>("h3");
      const key = head.querySelector<HTMLElement>("[data-mf-key]");
      if (!title || !key) return;
      let used = 0;
      for (const c of head.children) if (c !== title && c !== key) used += (c as HTMLElement).offsetWidth;
      const pad = parseFloat(getComputedStyle(head).paddingLeft) + parseFloat(getComputedStyle(head).paddingRight);
      setKeyHidden(title.scrollWidth + key.scrollWidth + 8 + used + pad > head.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    return () => ro.disconnect();
  }, [view.title, h?.value]);
  return (
    <div className={styles.mf}>
      <header ref={headRef} className={styles.mfHead}>
        <span className={styles.dot} style={{ background: view.color }} />
        <h3 className={styles.mfTitle} title={view.title}>{view.title}</h3>
        {view.filterChip && <span className={styles.filterChip} title={view.filterChip}>{view.filterChip}</span>}
        {h && (
          <span data-mf-key className={`${styles.mfKey} ${keyHidden ? styles.mfKeyHidden : ""}`} aria-hidden={keyHidden || undefined} title={`${h.label}${h.aux ? ` · ${h.aux}` : ""}`}>
            <b>{h.value}</b>
            {shortAux && <small className={styles.mfKeyLabel}>{shortAux}</small>}
            <small className={styles.mfKeyLabel}>{h.label}</small>
          </span>
        )}
        {extra && <span className={`${styles.kindTag} ${styles.mfKeyLabel}`}>{extra}</span>}
        <label className={`${styles.check} ${styles.mfCheck}`} title="보고서에 포함">
          <input type="checkbox" checked={p.included} onChange={(e) => p.onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
          <span className={styles.mfCheckText}>보고서</span>
        </label>
        <button type="button" className={`${styles.mfBtn} ${styles.mfBtnDark}`} onClick={p.onOpen} aria-label={`${view.title} 펼치기`} title="펼치기">
          <Svg size={14}>
            <path d="M7 17L17 7" />
            <path d="M8 7h9v9" />
          </Svg>
        </button>
        {view.code === "S01" && !state && view.mass && (
          <button type="button" className={`${styles.mfWindBtn} ${massExploded ? styles.mfBtnOn : ""}`} aria-pressed={massExploded} onClick={() => onMassExploded(!massExploded)}>
            {massExploded ? "기본 매스" : "분해"}
          </button>
        )}
        <MoreMenu view={view} active={active} back={back} onBack={onBack} face={p.face} onFace={p.onFace} onDetail={onDetail} />
        <button type="button" className={styles.mfBtn} data-card-face-button="summary" onClick={onFlip} aria-pressed aria-label={`${view.title} 요약/지도 보기 전환`} title="요약 보기">
          <Svg size={15}>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </Svg>
        </button>
      </header>
      {view.code === "S03" && !state && <WindStrip view={view} layerZ={windLayerZ} onLayerZ={onWindLayerZ} onOpen={p.onOpen} />}
      {view.code === "D22" && !state && <RoseSeasonSelect view={view} value={p.roseSeason} onChange={p.onRoseSeason} />}
      <div className={styles.mfMap}>
        <div className={styles.stage}>
          <Stage view={view} state={state} chart={view.hasFace && back && !state} frame="card" windLayerZ={windLayerZ} massExploded={massExploded} roseSeason={p.roseSeason} />
        </div>
      </div>
      <footer className={styles.mfFoot} title={text}>
        <span>{text}</span>
      </footer>
    </div>
  );
}

/** 요약면: 지도 없는 흰 카드. 제목 줄 · 큰 숫자 + 한 줄 라벨 · 사실 3줄 · 상태 배지(최대 2개) · 출처 한 줄 · "지도 ↻" */
function SummaryFace({ p, state, waiting, onFlip, onDetail }: { p: TileCardProps; state: boolean; waiting: boolean; onFlip: () => void; onDetail?: () => void }) {
  const { view, phase } = p;
  const facts = view.rows.filter((r) => r.label !== view.headline?.label).slice(0, 3);
  const head = waiting ? (phase === "running" ? "계산 중" : "대기") : (view.badges.find((b) => b.tone === "status")?.text ?? "표시할 결과가 없습니다");
  const rest = view.badges.filter((b) => b.tone !== "status");
  const retryText = view.status === "cancelled" ? "다시 계산" : "이 타일 다시 계산";
  return (
    <div className={styles.sf}>
      <div className={styles.sfTop}>
        {p.editing && (
          <span className={styles.handle} data-handle onPointerDown={p.onHandleDown} title="끌어서 옮기기 (키보드는 위로·아래로 버튼)" aria-hidden>
            ⠿
          </span>
        )}
        <span className={styles.dot} style={{ background: view.color }} />
        <h3 className={styles.title}>{view.title}</h3>
        <span className={styles.kindTag}>{view.kindLabel}</span>
        {view.filterChip && <span className={styles.filterChip} title={view.filterChip}>{view.filterChip}</span>}
        {view.stackLayers && <span className={styles.kindTag}>{view.stackLayers.join(" + ")}</span>}
        {view.sheetGrid && <span className={styles.kindTag}>{view.sheetGrid}</span>}
        {p.editing && p.stackable && p.onStackToggle && (
          <label className={styles.check}>
            <input type="checkbox" checked={!!p.stackSelected} onChange={(e) => p.onStackToggle!(e.target.checked)} aria-label={`${view.title} 스택에 넣기`} />
            스택에 넣기
          </label>
        )}
        {p.editing && p.sheetable && p.onSheetToggle && (
          <label className={styles.check}>
            <input type="checkbox" checked={!!p.sheetSelected} onChange={(e) => p.onSheetToggle!(e.target.checked)} aria-label={`${view.title} 조판에 넣기`} />
            조판에 넣기
          </label>
        )}
        {!waiting && (
          <>
            <label className={styles.check}>
              <input type="checkbox" checked={p.included} onChange={(e) => p.onInclude(e.target.checked)} aria-label={`${view.title} 보고서 포함`} />
              보고서
            </label>
            {!p.editing && (
              <button type="button" className={styles.open} onClick={p.onOpen} aria-label={`${view.title} 펼치기`} title="펼치기">
                ↗
              </button>
            )}
            {onDetail && (
              <button type="button" className={styles.open} data-detail-button onClick={onDetail} aria-label={`${view.title} 상세 열기`} title="상세">
                상세
              </button>
            )}
          </>
        )}
      </div>

      {state ? (
        <div className={styles.sfState}>
          {waiting && <span className={styles.spinner} role="status" aria-label={`${view.title} ${head}`} />}
          <b className={styles.statusHead}>{head}</b>
          {waiting && p.waitingNote && <p className={styles.statusNote}>{p.waitingNote}</p>}
          {!waiting && view.notes[0] && <p className={styles.statusNote}>{view.notes[0]}</p>}
          {!waiting && rest.length > 0 && <ValueBadges badges={rest} />}
          {!waiting && view.retryable && (
            <button type="button" className={styles.retry} onClick={p.onRetry}>
              {retryText}
            </button>
          )}
          {view.code === "S03" && (view.status === "pending" || view.status === "running") && (
            <WindPanel view={view} compact phase={phase} onUploaded={p.onWindUploaded} />
          )}
        </div>
      ) : (
        <div className={styles.sfMain}>
          <Headline view={view} />
          {facts.length > 0 && <RowList rows={facts} className={styles.sfRows} />}
        </div>
      )}

      <div className={styles.sfFoot}>
        {p.editing ? (
          <div className={styles.editRow}>
            <button type="button" className={styles.iconBtn} onClick={() => p.onMove(-1)} disabled={!p.canUp} aria-label={`${view.title} 위로 이동`}>
              위로
            </button>
            <button type="button" className={styles.iconBtn} onClick={() => p.onMove(1)} disabled={!p.canDown} aria-label={`${view.title} 아래로 이동`}>
              아래로
            </button>
            <span className={styles.seg} role="group" aria-label={`${view.title} 크기`}>
              {([1, 2] as const).map((n) => (
                <button key={n} type="button" aria-pressed={p.size === n} onClick={() => p.onResize(n)} aria-label={`${view.title} ${n}칸`}>
                  {n}칸
                </button>
              ))}
            </span>
            {view.code === "STACK" && p.onUnstack && (
              <button type="button" className={styles.iconBtn} onClick={p.onUnstack} aria-label={`${view.title} 풀기`}>
                풀기
              </button>
            )}
            {view.code === "SHEET" && p.onUnsheet && (
              <button type="button" className={styles.iconBtn} onClick={p.onUnsheet} aria-label={`${view.title} 풀기`}>
                풀기
              </button>
            )}
            <button type="button" className={styles.iconBtn} onClick={p.onRemove} aria-label={`${view.title} 제거`}>
              ×
            </button>
          </div>
        ) : (
          <>
            {!state && <ValueBadges badges={view.badges} />}
            <div className={styles.sfLine}>
              <span className={styles.sfSrc} title={stripText(view.sourceLine, false)}>
                {stripText(view.sourceLine, false)}
              </span>
              {!state && (
                <button type="button" className={styles.flipBtn} data-card-face-button="map" onClick={onFlip} aria-pressed={false} aria-label={`${view.title} 요약/지도 보기 전환`}>
                  지도 ↻
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function TileCard(p: TileCardProps) {
  const { view, phase } = p;
  const [back, setBack] = useState(false);
  const [windLayerZ, setWindLayerZ] = useState(6);
  const [massExploded, setMassExploded] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const focusFace = useRef<CardFace | null>(null);
  const waiting = phase === "pending" || phase === "running";
  const noResult = !waiting && view.headline === null;
  const state = waiting || noResult;
  // 편집 중·결과 없음·계산 중에는 요약면만 (지도면에 보여 줄 것이 없다)
  const shown: CardFace = state || p.editing ? "summary" : p.cardFace;
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (shown === "map") setSeen(true);
  }, [shown]);
  const mountMap = shown === "map" || seen; // 지도는 처음 뒤집을 때 만들고 그 뒤에는 유지한다
  useEffect(() => {
    if (focusFace.current !== shown) return;
    const buttonFace = shown === "map" ? "summary" : "map";
    cardRef.current?.querySelector<HTMLButtonElement>(`[data-on="true"] [data-card-face-button="${buttonFace}"]`)?.focus();
    focusFace.current = null;
  }, [shown]);
  const onCardFace = (face: CardFace) => {
    focusFace.current = face;
    p.onCardFace(face);
  };
  const cls = [styles.tile, p.size === 2 && styles.span2, p.editing && styles.tileEdit, p.dragging && styles.tileDrag, state && styles.tileState, !waiting && view.status === "failed" && styles.tileFail]
    .filter(Boolean)
    .join(" ");
  const openable = !p.editing && !waiting;
  // 결과가 빈 상태여도 T34 상세 API는 분석 ID로 요약/결측을 보여 줄 수 있다.
  // 지도 모델이 없는 타일(D19/D20/D22/D28/D29)도 현재 분석 URL을 사용해 상세를 연다.
  const hasAnalysisContext = !!view.map?.analysisId || (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("analysis"));
  const detailable = openable && hasDetail(view.code) && hasAnalysisContext;
  const [detailOpen, setDetailOpen] = useState(false);
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (openable && !(e.target as HTMLElement).closest(INTERACTIVE)) p.onOpen();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (openable && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      p.onOpen();
    }
  };

  return (
    <article
      ref={cardRef}
      className={cls}
      aria-label={view.title}
      data-tile={view.code}
      data-tile-id={view.tileId}
      style={p.floatStyle}
      tabIndex={openable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className={styles.flipInner} data-face={shown}>
        <div className={`${styles.face} ${styles.faceSummary}`} data-on={shown === "summary"} inert={shown !== "summary"} aria-hidden={shown !== "summary"}>
          <SummaryFace p={p} state={state} waiting={waiting} onFlip={() => onCardFace("map")} onDetail={detailable ? () => setDetailOpen(true) : undefined} />
        </div>
      <div className={`${styles.face} ${styles.faceMap}`} data-on={shown === "map"} inert={shown !== "map"} aria-hidden={shown !== "map"}>
          {mountMap && (
            <MapFace p={p} active={shown === "map"} state={state} back={back} onBack={setBack} windLayerZ={windLayerZ} onWindLayerZ={setWindLayerZ} massExploded={massExploded} onMassExploded={setMassExploded} onFlip={() => onCardFace("summary")} onDetail={detailable ? () => setDetailOpen(true) : undefined} />
          )}
        </div>
      </div>
      {detailOpen && detailable && <DetailWindow view={view} onClose={() => setDetailOpen(false)} />}
    </article>
  );
}
